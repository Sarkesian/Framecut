"""FrameCut speech worker: accurate local captions with protection against invented words.

Runs as a long-lived child of the FrameCut service and speaks JSON lines on stdin/stdout:
  -> {"id": 1, "op": "transcribe", "audio": "C:/.../mix.wav", "quality": "best"|"fast", "language": "", "lyrics": false, "vocabulary": ""}
  -> {"id": 2, "op": "align", "audio": "...", "text": "corrected words ..."}
  -> {"id": 3, "op": "status"} | {"op": "unload"} | {"op": "cancel", "target": 1}
  <- {"id": 1, "type": "progress", "progress": 0.4, "message": "Transcribing…"}
  <- {"id": 1, "type": "result", ...}  |  {"id": 1, "type": "error", "message": "..."}

Pipeline (the choices are justified by tests/captions-bench; see docs in desktop/speech.cjs):
  1. Audio analysis   Silero VAD speech regions + AudioSet classifier (AST) per second: speech vs music/singing.
  2. Transcription    Only speech regions (with context padding) go to the recognizer: Qwen3-ASR 1.7B (Best)
                      or a faster engine (Fast). Vocabulary is passed as context, never inserted.
  3. Alignment        Qwen3-ForcedAligner word timings, mapped onto the punctuated transcript.
  4. Checks           Words without acoustic support, repeated loops, implausible speaking rates, language
                      switches and words heard over music are flagged - not silently deleted.
  5. Verification     Best quality re-checks flagged stretches with an independent engine (Parakeet TDT v3).
"""
import json, math, os, re, sys, threading, time, traceback
import numpy as np

OUT_LOCK = threading.Lock()
CHANNEL = {'out': sys.stdout}
def send(msg):
    with OUT_LOCK: CHANNEL['out'].write(json.dumps(msg) + '\n'); CHANNEL['out'].flush()

SR = 16000
MODELS = {}
CANCELLED = set()
def device():
    import torch
    return 'cuda:0' if torch.cuda.is_available() else 'cpu'

def load(name, progress=lambda m: None):
    if name in MODELS: return MODELS[name]
    import torch
    dev = device(); dt = torch.bfloat16 if dev.startswith('cuda') else torch.float32
    if name == 'vad':
        from silero_vad import load_silero_vad
        MODELS[name] = load_silero_vad()
    elif name == 'tagger':
        progress('Loading the sound classifier…')
        from transformers import ASTFeatureExtractor, ASTForAudioClassification
        n = 'MIT/ast-finetuned-audioset-10-10-0.4593'
        m = ASTForAudioClassification.from_pretrained(n).to(dev).eval()
        if dev.startswith('cuda'): m = m.half()
        MODELS[name] = (ASTFeatureExtractor.from_pretrained(n), m)
    elif name.startswith('qwen'):
        progress('Loading the speech model…')
        from qwen_asr import Qwen3ASRModel
        size = '1.7B' if name == 'qwen' else '0.6B'
        MODELS[name] = Qwen3ASRModel.from_pretrained(f'Qwen/Qwen3-ASR-{size}', forced_aligner='Qwen/Qwen3-ForcedAligner-0.6B',
                                                     forced_aligner_kwargs=dict(dtype=dt, device_map=dev), dtype=dt, device_map=dev, max_inference_batch_size=8, max_new_tokens=1024)
    elif name == 'aligner':
        if 'qwen' in MODELS: MODELS[name] = MODELS['qwen'].forced_aligner
        else:
            from qwen_asr import Qwen3ForcedAligner
            MODELS[name] = Qwen3ForcedAligner.from_pretrained('Qwen/Qwen3-ForcedAligner-0.6B', dtype=dt, device_map=dev)
    elif name == 'parakeet':
        progress('Loading the verification model…')
        import onnx_asr
        MODELS[name] = onnx_asr.load_model('nemo-parakeet-tdt-0.6b-v3').with_timestamps()
    return MODELS[name]

def read_audio(path):
    import soundfile as sf
    x, sr = sf.read(path, dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    if sr != SR:
        import scipy.signal as ss
        x = ss.resample_poly(x, SR, sr).astype(np.float32)
    return x

# ------------------------------------------------------------------ 1. audio analysis
def vad_regions(x):
    import torch
    from silero_vad import get_speech_timestamps
    ts = get_speech_timestamps(torch.from_numpy(x), load('vad'), sampling_rate=SR, threshold=0.4, min_speech_duration_ms=180, min_silence_duration_ms=350, speech_pad_ms=250, return_seconds=True)
    return [(float(t['start']), float(t['end'])) for t in ts]

SPEECH_LABELS = ['Speech', 'Male speech, man speaking', 'Female speech, woman speaking', 'Child speech, kid speaking', 'Conversation', 'Narration, monologue', 'Speech synthesizer', 'Whispering']
SING_LABELS = ['Singing', 'Song', 'Vocal music', 'Male singing', 'Female singing', 'Child singing', 'Choir', 'Chant', 'Rapping', 'Humming', 'A capella', 'Yodeling']
def sound_profile(x):
    """Per-second probabilities: speech, music, singing (2 s windows, 1 s hop)."""
    import torch
    fe, m = load('tagger'); lab = {v: k for k, v in m.config.id2label.items()}
    sp = [lab[l] for l in SPEECH_LABELS if l in lab]; sg = [lab[l] for l in SING_LABELS if l in lab]; mu = lab['Music']
    n = max(1, int(math.ceil(len(x) / SR))); prof = np.zeros((n, 3), np.float32)
    starts = list(range(0, max(1, len(x) - SR), SR)) or [0]
    for b in range(0, len(starts), 64):
        wins = [x[s:s + 2 * SR] if len(x[s:s + 2 * SR]) >= SR // 2 else np.pad(x[s:s + 2 * SR], (0, SR)) for s in starts[b:b + 64]]
        inp = fe(wins, sampling_rate=SR, return_tensors='pt')['input_values'].to(m.device)
        if m.dtype == torch.float16: inp = inp.half()
        with torch.no_grad(): p = torch.sigmoid(m(inp).logits).float().cpu().numpy()
        for k, s in enumerate(starts[b:b + 64]):
            sec = s // SR; row = np.array([p[k, sp].max(), p[k, mu], p[k, sg].max()])
            for j in (sec, sec + 1):
                if j < n: prof[j] = np.maximum(prof[j], row)
    return prof

def voice_runs(prof, total, covered, thr=0.06, min_len=1.5):
    """Sung passages speech detection missed: seconds where the classifier hears singing (or a voice over
    music) that no VAD region covers. Speech keeps its natural VAD boundaries."""
    out, start = [], None
    inside = lambda i: any(a - 0.5 <= i + 0.5 <= b + 0.5 for a, b in covered)
    for i, (sp, mu, sg) in enumerate(prof):
        on = (sg >= 0.05 or (mu >= 0.3 and sp + sg >= thr)) and not inside(i)
        if on and start is None: start = i
        if not on and start is not None:
            if i - start >= min_len: out.append((float(start), float(min(i, total))))
            start = None
    if start is not None and len(prof) - start >= min_len: out.append((float(start), float(total)))
    return out

def merge_regions(rs, gap=0.3):
    out = []
    for a, b in sorted(rs):
        if out and a <= out[-1][1] + gap: out[-1] = (out[-1][0], max(out[-1][1], b))
        else: out.append((a, b))
    return out

def classify(regions, prof):
    """Label each VAD region: speech | speech_music | singing | music | noise (by mean per-second scores)."""
    out = []
    for a, b in regions:
        seg = prof[int(a):max(int(a) + 1, int(math.ceil(b)))]
        speech, music, sing = (float(seg[:, i].mean()) for i in range(3))
        voice = float(np.max(seg[:, 0] + seg[:, 2])) if len(seg) else 0.0   # strongest vocal evidence in the region
        if speech >= 0.25: kind = 'speech_music' if music >= 0.35 else 'speech'
        elif speech >= 0.12 and music < 0.3: kind = 'speech'
        elif voice >= 0.05: kind = 'singing'            # genuine vocals over music
        elif music >= 0.2: kind = 'music'               # instrumental: never captioned
        else: kind = 'noise'
        out.append({'start': round(a, 3), 'end': round(b, 3), 'kind': kind, 'speech': round(speech, 3), 'music': round(music, 3), 'singing': round(sing, 3), 'voice': round(voice, 3)})
    return out

def chunks(regs, total, max_len=28.0, join_gap=1.2, pad=0.25):
    """Merge nearby regions into recognition windows of at most max_len seconds (with context padding)."""
    out = []
    for r in regs:
        a, b = max(0.0, r['start'] - pad), min(total, r['end'] + pad)
        if out and a - out[-1][1] < join_gap and b - out[-1][0] <= max_len: out[-1][1] = max(out[-1][1], b)
        else:
            while b - a > max_len: out.append([a, a + max_len]); a += max_len - 1.0
            out.append([a, b])
    return out

# ------------------------------------------------------------------ 2+3. recognition and alignment
TOKEN = re.compile(r"\S+")
def clean(t): return re.sub(r"[^\w']+", '', t.lower())
def attach(text, items, offset):
    """Map aligner words (no punctuation) onto the punctuated transcript tokens, keeping their timing."""
    toks = TOKEN.findall(text); words = []; j = 0
    for it in items:
        target = clean(it.text)
        if not target: continue
        k = j
        while k < len(toks) and clean(toks[k]) != target and k - j < 4: k += 1
        if k < len(toks) and clean(toks[k]) == target:
            for extra in toks[j:k]:      # tokens the aligner skipped (e.g. "-") join the previous word
                if words and not clean(extra): words[-1]['text'] += ' ' + extra
            words.append({'text': toks[k], 'start': offset + float(it.start_time), 'end': offset + float(it.end_time)}); j = k + 1
        else: words.append({'text': it.text, 'start': offset + float(it.start_time), 'end': offset + float(it.end_time)})
    return words

def recognize_qwen(x, wins, language, vocabulary, size, cancel, prog):
    m = load('qwen' if size == '1.7B' else 'qwen-small', prog)
    ctx = ('Terms that may appear: ' + vocabulary.strip()) if vocabulary.strip() else ''
    words, langs = [], []
    for k, (a, b) in enumerate(wins):
        if cancel(): raise KeyboardInterrupt
        prog(f'Transcribing… {k + 1} of {len(wins)}', 0.25 + 0.55 * k / max(1, len(wins)))
        seg = x[int(a * SR):int(b * SR)]
        r = m.transcribe(audio=(seg, SR), context=ctx, language=language or None, return_time_stamps=True)[0]
        if not r.text.strip(): continue
        w = attach(r.text, r.time_stamps or [], a)
        for it in w: it['chunk'] = k
        words += w; langs.append((r.language or '', len(w)))
    return words, langs

def recognize_parakeet(x, wins, cancel, prog, offset_progress=(0.25, 0.55)):
    m = load('parakeet', prog); words = []
    for k, (a, b) in enumerate(wins):
        if cancel(): raise KeyboardInterrupt
        prog(f'Transcribing… {k + 1} of {len(wins)}', offset_progress[0] + offset_progress[1] * k / max(1, len(wins)))
        r = m.recognize(x[int(a * SR):int(b * SR)], sample_rate=SR)
        cur = None
        for tok, t in zip(r.tokens or [], r.timestamps or []):
            t = a + t
            if tok.startswith(' ') or tok.startswith('\u2581') or cur is None:
                if cur: words.append(cur)
                cur = {'text': tok.strip().lstrip('\u2581'), 'start': t, 'end': t + 0.1, 'chunk': k}
            else: cur['text'] += tok; cur['end'] = t + 0.1
        if cur: words.append(cur)
    words = [w for w in words if w['text']]
    for i in range(len(words) - 1): words[i]['end'] = max(words[i]['start'] + 0.05, min(words[i]['end'], words[i + 1]['start']))
    return words

# ------------------------------------------------------------------ 4. hallucination checks
def checks(words, regs, prof, main_lang, langs_by_chunk):
    speechy = [r for r in regs if r['kind'] in ('speech', 'speech_music', 'singing')]
    out = []
    for w in words:
        mid = (w['start'] + w['end']) / 2
        reg = next((r for r in regs if r['start'] - 0.3 <= mid <= r['end'] + 0.3), None)
        if reg and reg['kind'] == 'singing': w['sung'] = True; w['voice'] = reg['voice']
        near = min((max(r['start'] - mid, mid - r['end'], 0) for r in speechy), default=99)
        sec = min(len(prof) - 1, max(0, int(mid))); sp, mu = float(prof[sec, 0]), float(prof[sec, 1])
        if near > 1.0 and sp < 0.1: continue           # no speech anywhere near: the recognizer invented it
        if near > 0.3 or sp < 0.08: w['flag'] = 'unsupported'
        elif mu > 0.45 and sp < 0.4 and not w.get('sung'): w['flag'] = 'music'   # lyrics are expected over music
        out.append(w)
    # repeated loops ("thank you thank you thank you ...") are a classic recognizer failure
    norm = [clean(w['text']) for w in out]
    for n in (1, 2, 3, 4):
        i = 0
        while i + n * 3 <= len(norm):
            gram = norm[i:i + n]; reps = 1
            while norm[i + reps * n:i + (reps + 1) * n] == gram: reps += 1
            if reps >= (4 if n == 1 else 3) and any(gram):
                for w in out[i + n:i + reps * n]: w['flag'] = 'repeat'
                i += reps * n
            else: i += 1
    # implausible speaking rate inside a chunk (more than ~7 words/s sustained)
    by_chunk = {}
    for w in out: by_chunk.setdefault(w.get('chunk'), []).append(w)
    for ch, ws in by_chunk.items():
        span = ws[-1]['end'] - ws[0]['start']
        if len(ws) >= 8 and span > 0 and len(ws) / span > 7.5:
            for w in ws: w.setdefault('flag', 'rate')
        lang = langs_by_chunk.get(ch)
        if lang and main_lang and lang.split(',')[0] != main_lang and len(ws) < 6:
            for w in ws: w.setdefault('flag', 'language')
    return out

def verify(x, words, cancel, prog):
    """Second, independent recognizer on flagged stretches: words it confirms are unflagged; the rest stay flagged."""
    flagged = [w for w in words if w.get('flag') and w['flag'] != 'repeat' or w.get('sung')]
    if not flagged: return words, 0
    spans = []
    for w in flagged:
        a, b = max(0, w['start'] - 1.5), w['end'] + 1.5
        if spans and a <= spans[-1][1]: spans[-1][1] = max(spans[-1][1], b)
        else: spans.append([a, b])
    try: other = recognize_parakeet(x, spans, cancel, prog, (0.85, 0.1))
    except KeyboardInterrupt: raise
    except Exception: return words, 0
    confirmed = 0
    for w in flagged:
        t = clean(w['text'])
        if any(clean(o['text']) == t and abs(o['start'] - w['start']) < 0.6 for o in other): w.pop('flag', None); w['verified'] = True; confirmed += 1
        elif w.get('sung') and w.get('voice', 1) < 0.08: w['drop'] = True     # lyrics nobody else hears over weak vocals
        elif w.get('sung') and w.get('voice', 1) < 0.15: w.setdefault('flag', 'singing')   # strong vocals: trust the lyrics
    return [w for w in words if not w.pop('drop', False)], confirmed

# ------------------------------------------------------------------ ops
def transcribe(req, prog, cancel):
    t0 = time.time(); x = read_audio(req['audio']); total = len(x) / SR
    quality = req.get('quality', 'best'); lyrics = req.get('lyrics', True) is not False; language = req.get('language') or ''
    prog('Finding speech…', 0.03)
    regions = vad_regions(x)
    prog('Separating speech from music…', 0.12)
    prof = sound_profile(x)
    if lyrics: regions = sorted(regions + voice_runs(prof, total, regions))   # sung passages VAD misses under music
    regs = classify(regions, prof)
    keep = [r for r in regs if r['kind'] in ('speech', 'speech_music') or (lyrics and r['kind'] == 'singing')]
    skipped = [r for r in regs if r not in keep and r['kind'] in ('singing', 'music')]
    if not keep: return {'words': [], 'regions': regs, 'language': '', 'engine': None, 'seconds': time.time() - t0, 'skipped': len(skipped), 'duration': total}
    wins = chunks(keep, total)
    engine = 'Qwen3-ASR 1.7B + Qwen3-ForcedAligner' if quality == 'best' else 'Qwen3-ASR 0.6B + Qwen3-ForcedAligner'
    words, langs = recognize_qwen(x, wins, language, req.get('vocabulary') or '', '1.7B' if quality == 'best' else '0.6B', cancel, prog)
    counts = {}
    for lang, n in langs: counts[lang.split(',')[0]] = counts.get(lang.split(',')[0], 0) + n
    main_lang = max(counts, key=counts.get) if counts else language
    lang_by_chunk = {k: l for k, (l, _) in enumerate(langs)}
    prog('Checking for invented words…', 0.82)
    words = checks(words, regs, prof, main_lang, lang_by_chunk)
    confirmed = 0
    if quality == 'best' and main_lang in ('', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Polish'):
        prog('Double-checking uncertain words…', 0.86)
        words, confirmed = verify(x, words, cancel, prog)
    elif quality != 'best':   # Fast: sung words still need clear vocal evidence
        words = [w for w in words if not (w.get('sung') and w.get('voice', 1) < 0.08)]
    for w in words: w['start'] = round(w['start'], 3); w['end'] = round(max(w['end'], w['start'] + 0.04), 3); w.pop('chunk', None); w.pop('voice', None)
    return {'words': words, 'regions': regs, 'language': main_lang, 'engine': engine, 'seconds': round(time.time() - t0, 2), 'skipped': len(skipped), 'verified': confirmed, 'duration': round(total, 3)}

def align(req, prog, cancel):
    """Word timings for given text (corrected transcript or a script) against the recording."""
    x = read_audio(req['audio']); total = len(x) / SR
    a = load('aligner', prog); text = req['text']; lang = req.get('language') or 'English'
    prog('Aligning words…', 0.4)
    r = a.align(audio=(x, SR), text=text, language=lang)[0]
    return {'words': [{'text': w['text'], 'start': round(w['start'], 3), 'end': round(w['end'], 3)} for w in attach(text, list(r), 0.0)], 'duration': total}

def status(_req, *_):
    import torch
    return {'device': device(), 'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None, 'loaded': list(MODELS),
            'gpu_mem_mb': int(torch.cuda.memory_allocated() / 2**20) if torch.cuda.is_available() else 0}

def unload():
    MODELS.clear()
    try:
        import gc, torch; gc.collect(); torch.cuda.empty_cache()
    except Exception: pass

def handle(req):
    rid = req.get('id'); op = req.get('op')
    prog = lambda message, progress=None: send({'id': rid, 'type': 'progress', 'message': message, **({'progress': progress} if progress is not None else {})})
    cancel = lambda: rid in CANCELLED
    try:
        fn = {'transcribe': transcribe, 'align': align, 'status': status}[op]
        send({'id': rid, 'type': 'result', **fn(req, prog, cancel)})
    except KeyboardInterrupt: send({'id': rid, 'type': 'error', 'message': 'Cancelled', 'cancelled': True})
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        msg = str(e)
        if 'out of memory' in msg.lower(): msg = 'The graphics card ran out of memory. Close other GPU-heavy apps, or choose Fast quality.'
        send({'id': rid, 'type': 'error', 'message': msg})
    finally: CANCELLED.discard(rid)

def main():
    # Requests arrive on a localhost socket when FrameCut passes --port (stdin stays detached: on Windows a
    # thread blocked reading a stdin pipe stalls other threads that query that handle, e.g. during imports).
    src = sys.stdin
    if '--port' in sys.argv:
        import socket
        s = socket.create_connection(('127.0.0.1', int(sys.argv[sys.argv.index('--port') + 1])))
        src = s.makefile('r', encoding='utf-8'); CHANNEL['out'] = s.makefile('w', encoding='utf-8')
    q = []; cv = threading.Condition()
    def reader():
        for line in src:
            try: req = json.loads(line)
            except Exception: continue
            if req.get('op') == 'cancel': CANCELLED.add(req.get('target')); continue
            if req.get('op') == 'unload':
                with cv: q.append(req); cv.notify(); continue
            with cv: q.append(req); cv.notify()
        with cv: q.append(None); cv.notify()
    threading.Thread(target=reader, daemon=True).start()
    send({'type': 'ready'})
    while True:
        with cv:
            while not q: cv.wait()
            req = q.pop(0)
        if req is None: break
        if req.get('op') == 'unload': unload(); send({'id': req.get('id'), 'type': 'result', 'unloaded': True}); continue
        handle(req)

if __name__ == '__main__':
    if os.environ.get('FRAMECUT_SPEECH_DEBUG'):
        import faulthandler; faulthandler.dump_traceback_later(int(os.environ['FRAMECUT_SPEECH_DEBUG']), repeat=True)
    main()
