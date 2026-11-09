"""Runs candidate speech-recognition pipelines over the caption benchmark and scores them.

Usage: python run_models.py <bench_dir> <engine> [case_id ...]
Engines:
  fw:<model>[:vad]     faster-whisper (CTranslate2, CUDA float16); ':vad' adds Silero VAD + hardened decoding
  parakeet:<v2|v3>     NVIDIA Parakeet TDT 0.6B via onnx-asr, Silero VAD segmentation
  qwen:<1.7B|0.6B>     Qwen3-ASR with Qwen3-ForcedAligner timestamps
Writes <bench>/results/<engine>/<case>.json (words with times) and <bench>/results/<engine>/summary.json.
"""
import json, os, re, subprocess, sys, threading, time
import numpy as np, soundfile as sf, jiwer

BENCH, ENGINE = sys.argv[1], sys.argv[2]
ONLY = set(sys.argv[3:])
CASES = json.load(open(os.path.join(BENCH, 'cases.json')))['cases']
OUT = os.path.join(BENCH, 'results', ENGINE.replace(':', '_'))
os.makedirs(OUT, exist_ok=True)

def load16k(path):
    x, sr = sf.read(path, dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    if sr != 16000:
        import scipy.signal as ss
        x = ss.resample_poly(x, 16000, sr).astype(np.float32)
    return x

class GpuPeak:
    """Peak GPU memory in use (MiB) during a block, sampled with nvidia-smi."""
    def __enter__(self):
        self.peak, self.stop = 0, False
        def poll():
            while not self.stop:
                try: self.peak = max(self.peak, int(subprocess.run(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], capture_output=True, text=True).stdout.split()[0]))
                except Exception: pass
                time.sleep(0.25)
        self.base = int(subprocess.run(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'], capture_output=True, text=True).stdout.split()[0])
        self.t = threading.Thread(target=poll, daemon=True); self.t.start(); return self
    def __exit__(self, *a): self.stop = True; self.t.join()

# ------------------------------------------------------------------ engines -> [{'text','start','end','p'}]
def engine_fw(model, vad):
    import torch  # noqa: F401 - puts torch's CUDA DLLs (cuBLAS, cuDNN) on the search path for CTranslate2
    from faster_whisper import WhisperModel
    m = WhisperModel(model, device='cuda', compute_type='float16')
    def run(audio):
        kw = dict(word_timestamps=True, beam_size=5)
        if vad: kw.update(vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=300), condition_on_previous_text=False, no_speech_threshold=0.6, log_prob_threshold=-1.0, compression_ratio_threshold=2.4, hallucination_silence_threshold=2.0)
        segs, info = m.transcribe(audio, **kw)
        out = []
        for s in segs:
            for w in s.words or []: out.append({'text': w.word.strip(), 'start': w.start, 'end': w.end, 'p': w.probability})
        return out, {'language': info.language, 'language_p': info.language_probability}
    return run

def engine_parakeet(ver):
    import onnx_asr
    vad = onnx_asr.load_vad('silero')
    m = onnx_asr.load_model(f'nemo-parakeet-tdt-0.6b-{ver}').with_vad(vad, min_silence_duration_ms=500, speech_pad_ms=300).with_timestamps()
    def run(audio):
        out = []
        for seg in m.recognize(audio, sample_rate=16000):
            toks, ts = seg.tokens or [], seg.timestamps or []
            cur = None
            for tok, t in zip(toks, ts):
                t = seg.start + t
                if tok.startswith(' ') or tok.startswith('▁') or cur is None:
                    if cur: out.append(cur)
                    cur = {'text': tok.strip().lstrip('▁'), 'start': t, 'end': t + 0.08, 'p': None}
                else: cur['text'] += tok; cur['end'] = t + 0.08
            if cur: out.append(cur)
        for i, w in enumerate(out[:-1]): w['end'] = min(max(w['end'], w['start'] + 0.05), out[i + 1]['start'])
        return [w for w in out if w['text']], {}
    return run

def engine_qwen(size):
    import torch
    from qwen_asr import Qwen3ASRModel
    m = Qwen3ASRModel.from_pretrained(f'Qwen/Qwen3-ASR-{size}', forced_aligner='Qwen/Qwen3-ForcedAligner-0.6B', forced_aligner_kwargs=dict(dtype=torch.bfloat16, device_map='cuda:0'), dtype=torch.bfloat16, device_map='cuda:0', max_inference_batch_size=8, max_new_tokens=1024)
    def run(audio):
        r = m.transcribe(audio=(audio, 16000), return_time_stamps=True)[0]
        out = [{'text': it.text, 'start': float(it.start_time), 'end': float(it.end_time), 'p': None} for it in (r.time_stamps or [])]
        return out, {'language': r.language, 'text': r.text}
    return run

kind, *rest = ENGINE.split(':')
run = {'fw': lambda: engine_fw(rest[0], len(rest) > 1 and rest[1] == 'vad'), 'parakeet': lambda: engine_parakeet(rest[0]), 'qwen': lambda: engine_qwen(rest[0])}[kind]()

# ------------------------------------------------------------------ scoring
NUM = {'%': ' percent'}
def norm(s):
    s = s.lower()
    for k, v in NUM.items(): s = s.replace(k, v)
    s = re.sub(r"[^a-z0-9' ]+", ' ', s.replace('-', ' '))
    s = re.sub(r"'(?!\w)|(?<!\w)'", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def align_pairs(ref_words, hyp_words):
    """Pairs of (ref word index, hyp word index) whose normalized tokens match (edit-distance alignment).
    Words may normalize to zero or several tokens, so tokens are mapped back to their source word."""
    def flat(ws):
        toks, owner = [], []
        for i, w in enumerate(ws):
            for t in w.split(): toks.append(t); owner.append(i)
        return toks, owner
    rt, ro = flat(ref_words); ht, ho = flat(hyp_words)
    if not rt or not ht: return []
    o = jiwer.process_words(' '.join(rt), ' '.join(ht)); pairs = []
    for ch in o.alignments[0]:
        if ch.type == 'equal':
            for k in range(ch.ref_end_idx - ch.ref_start_idx):
                pr = (ro[ch.ref_start_idx + k], ho[ch.hyp_start_idx + k])
                if not pairs or pairs[-1] != pr: pairs.append(pr)
    return pairs

summary = {'engine': ENGINE, 'cases': {}}
with GpuPeak() as gpu:
    for c in CASES:
        if ONLY and c['id'] not in ONLY: continue
        audio = load16k(os.path.join(BENCH, 'cases', c['file']))
        t0 = time.time(); words, info = run(audio); dt = time.time() - t0
        json.dump({'words': words, 'info': info, 'seconds': dt}, open(os.path.join(OUT, c['id'] + '.json'), 'w'), indent=0)
        hyp = norm(' '.join(w['text'] for w in words)); r = {'seconds': round(dt, 2), 'rtf': round(dt / c['duration'], 4), 'words': len(hyp.split()) if hyp else 0}
        if c['kind'] == 'speech':
            ref = norm(c['text']); m = jiwer.process_words(ref, hyp or '<empty>')
            r.update(wer=round(m.wer, 4), ins=m.insertions, dele=m.deletions, sub=m.substitutions, ref_words=len(ref.split()))
            if c.get('segments'):   # words placed where nobody speaks (outside every reference utterance)
                segs = c['segments']; out = [w for w in words if not any(s['start'] - 0.35 <= (w['start'] + w['end']) / 2 <= s['end'] + 0.35 for s in segs)]
                r['words_outside_speech'] = len(out); r['outside_sample'] = ' '.join(w['text'] for w in out[:12])
            if c.get('words'):      # word timing vs exact TTS word starts
                rw = [norm(w['text']) for w in c['words']]; hw = [norm(w['text']) for w in words]
                pairs = align_pairs(rw, hw)
                errs = [abs(words[h]['start'] - c['words'][i]['start']) for i, h in pairs]
                if errs: r.update(timing_mae_ms=round(1000 * float(np.mean(errs)), 1), timing_p90_ms=round(1000 * float(np.percentile(errs, 90)), 1), timed_words=len(errs))
        else:
            r['false_text'] = ' '.join(w['text'] for w in words)[:240]
        summary['cases'][c['id']] = r
        print(f"{c['id']:24s} {json.dumps(r)[:200]}", flush=True)
    summary['gpu_peak_mib'] = gpu.peak; summary['gpu_base_mib'] = gpu.base
sp = [v for k, v in summary['cases'].items() if 'wer' in v]
if sp:
    tot_err = sum(v['ins'] + v['dele'] + v['sub'] for v in sp); tot_ref = sum(v['ref_words'] for v in sp)
    summary['pooled_wer'] = round(tot_err / tot_ref, 4)
summary['false_words_nospeech'] = sum(v['words'] for k, v in summary['cases'].items() if next(c for c in CASES if c['id'] == k)['kind'] == 'nospeech')
json.dump(summary, open(os.path.join(OUT, 'summary.json'), 'w'), indent=1)
print('SUMMARY', json.dumps({k: summary.get(k) for k in ('engine', 'pooled_wer', 'false_words_nospeech', 'gpu_peak_mib', 'gpu_base_mib')}))
