"""Builds the FrameCut caption benchmark: real speech with human transcripts (LibriSpeech, Earnings-22),
real speech-free audio (Openverse: instrumental, synth, orchestral, game SFX), sung vocals, and TTS
cases with exact per-word timing. Writes <bench>/cases/*.wav (48 kHz mono) and <bench>/cases.json.

Usage: python build.py <bench_dir> <ffmpeg>
Inputs expected in <bench_dir>/src: librispeech_asr_dummy.parquet, earnings22.parquet, openverse.json
"""
import io, json, os, subprocess, sys, urllib.request
import numpy as np, pyarrow.parquet as pq, soundfile as sf

BENCH, FFMPEG = sys.argv[1], sys.argv[2]
SRC, CASES, TMP = os.path.join(BENCH, 'src'), os.path.join(BENCH, 'cases'), os.path.join(BENCH, 'tmp')
SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
for d in (CASES, TMP): os.makedirs(d, exist_ok=True)

def decode(data):
    """Any audio bytes -> float32 mono at SR, via ffmpeg."""
    p = subprocess.run([FFMPEG, '-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', str(SR), '-f', 'f32le', 'pipe:1'], input=data, capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()
def silence(sec): return np.zeros(int(sec * SR), np.float32)
def gain_db(x, db): return x * (10 ** (db / 20))
def rms(x): return float(np.sqrt(np.mean(x ** 2) + 1e-12))
def at_rms_db(x, db): return x * (10 ** (db / 20) / rms(x))
def fit(x, n): return np.tile(x, int(np.ceil(n / max(1, len(x)))))[:n]
def write(name, audio, meta):
    audio = np.clip(audio, -1, 1).astype(np.float32)
    sf.write(os.path.join(CASES, name + '.wav'), audio, SR, subtype='PCM_16')
    meta.update(id=name, file=name + '.wav', duration=round(len(audio) / SR, 3)); cases.append(meta)
    print(f'{name:22s} {meta["duration"]:7.1f}s  {meta["kind"]}')

# ---- sources ----
libri = pq.read_table(os.path.join(SRC, 'librispeech_asr_dummy.parquet')).to_pylist()
libri = [{'audio': decode(r['audio']['bytes']), 'text': r['text'].lower(), 'speaker': r['speaker_id']} for r in libri]
earn = pq.read_table(os.path.join(SRC, 'earnings22.parquet'), columns=['audio', 'transcription', 'file_id']).to_pylist()
ov = {r['id'][:8]: r for r in json.load(open(os.path.join(SRC, 'openverse.json')))}
def openverse(short, start=0, dur=None):
    r = ov[short]; cache = os.path.join(SRC, short + '.audio')
    if not os.path.exists(cache):
        req = urllib.request.Request(r['url'], headers={'User-Agent': 'FrameCutStudio-benchmark'})
        open(cache, 'wb').write(urllib.request.urlopen(req, timeout=120).read())
    x = decode(open(cache, 'rb').read()); x = x[int(start * SR):]
    return (x[:int(dur * SR)] if dur else x), {'title': r['title'], 'creator': r['creator'], 'license': r['license'], 'landing': r['landing']}
def tts(name, text, voice='Microsoft David Desktop', rate=0):
    wav, js = os.path.join(TMP, name + '.wav'), os.path.join(TMP, name + '.json')
    subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(HERE, 'tts.ps1'), '-Out', wav, '-Json', js, '-Voice', voice, '-Rate', str(rate), '-Text', text], check=True)
    meta = json.load(open(js, encoding='utf-8-sig'))
    return decode(open(wav, 'rb').read()), meta

def speech_track(utts, gap=0.6, lead=0.5):
    """Concatenate utterances; returns audio and reference segments with times."""
    parts, segs, t = [silence(lead)], [], lead
    for u in utts:
        segs.append({'start': round(t, 3), 'end': round(t + len(u['audio']) / SR, 3), 'text': u['text'], 'speaker': str(u.get('speaker', ''))})
        parts += [u['audio'], silence(gap)]; t += len(u['audio']) / SR + gap
    parts.append(silence(0.5)); return np.concatenate(parts), segs
def ref_text(segs): return ' '.join(s['text'] for s in segs)
def shift_words(words, offset): return [{'text': w['text'], 'start': round(w['start'] + offset, 3)} for w in words]

cases = []
# 1 clean narration
a, segs = speech_track(libri[:8]); write('01_clean_narration', at_rms_db(a, -20), {'kind': 'speech', 'text': ref_text(segs), 'segments': segs, 'source': 'LibriSpeech (CC BY 4.0)'})
clean = at_rms_db(a, -20)
# 2 conversation with accents (Earnings-22: real company calls, varied accents)
by_file = {}
for r in earn: by_file.setdefault(r['file_id'], []).append(r)
conv_file = sorted(by_file, key=lambda k: -len(by_file[k]))[0]
conv = [{'audio': decode(r['audio']['bytes']), 'text': r['transcription'].lower()} for r in by_file[conv_file][:10]]
a, segs = speech_track(conv, gap=0.25); write('02_conversation_accents', at_rms_db(a, -20), {'kind': 'speech', 'text': ref_text(segs), 'segments': segs, 'source': f'Earnings-22 {conv_file} (CC BY-SA 4.0)'})
other = [f for f in by_file if f != conv_file][:1]
if other:
    acc = [{'audio': decode(r['audio']['bytes']), 'text': r['transcription'].lower()} for r in by_file[other[0]][:8]]
    a, segs = speech_track(acc, gap=0.3); write('10a_accented_speech', at_rms_db(a, -20), {'kind': 'speech', 'text': ref_text(segs), 'segments': segs, 'source': f'Earnings-22 {other[0]} (CC BY-SA 4.0)'})
# 3 quiet speech
write('03_quiet_speech', at_rms_db(clean, -42), {'kind': 'speech', 'text': ref_text(cases[0]['segments']), 'segments': cases[0]['segments'], 'source': 'LibriSpeech at -42 dBFS RMS'})
# 4 speech over loud music (music only 3 dB under the voice) and 17 under quiet music
music, credit = openverse('486c6daa', 20)
write('04_speech_loud_music', clean + at_rms_db(fit(music, len(clean)), -23), {'kind': 'speech', 'text': ref_text(cases[0]['segments']), 'segments': cases[0]['segments'], 'music': credit, 'source': 'LibriSpeech + synthwave at -3 dB'})
piano, credit2 = openverse('d96921f3', 30)
write('17_speech_quiet_music', clean + at_rms_db(fit(piano, len(clean)), -36), {'kind': 'speech', 'text': ref_text(cases[0]['segments']), 'segments': cases[0]['segments'], 'music': credit2, 'source': 'LibriSpeech + piano at -16 dB'})
# 5–8, 16: speech-free
x, c = openverse('d96921f3', 40, 90); write('05_instrumental_piano', at_rms_db(x, -18), {'kind': 'nospeech', 'music': c})
s1, c1 = openverse('486c6daa', 0, 60); s2, c2 = openverse('d087661f', 0, 45); s3, c3 = openverse('6e1e9a2a', 0, 60)
write('06_synth_electronic', at_rms_db(np.concatenate([s1, s2, s3]), -16), {'kind': 'nospeech', 'music': [c1, c2, c3]})
amb, ca = openverse('4c140c7e', 0, 50)
sfx = []
for k in ['494c1e6a', '4a2c1136', '4f33f989', '7d06b595', 'c4b1aaeb', '4a2c1136', '494c1e6a']:
    y, _ = openverse(k); sfx += [at_rms_db(y, -14), silence(1.5)]
sfx = np.concatenate(sfx); bed = at_rms_db(fit(amb, len(sfx)), -32)
write('07_game_sfx', sfx + bed, {'kind': 'nospeech', 'music': [ov[k]['title'] for k in ['494c1e6a', '4a2c1136', '4f33f989', '7d06b595', 'c4b1aaeb']] + [ca['title']]})
write('08_silence_noise', np.concatenate([silence(10), gain_db(np.random.default_rng(1).normal(0, 1, SR * 20).astype(np.float32), -70)]), {'kind': 'nospeech'})
x, c = openverse('b80fd751', 0, 90); write('16_orchestral_choir', at_rms_db(x, -18), {'kind': 'nospeech', 'music': c, 'note': 'wordless choir pads'})
# 11 sung vocals (no reference lyrics: in dialogue-only mode we expect no captions, or flagged ones)
x, c = openverse('22a0cd91', 15, 60); write('11_song_vocals', at_rms_db(x, -16), {'kind': 'song', 'music': c})
# 9 rapid speech, 10b uncommon words, 14 pauses, 15 script realignment (TTS with exact word timing)
a, m = tts('rapid', 'So here is the plan. We grab the loot, we sprint to the extraction point, we hold the ridge for thirty seconds, and then we pull out before the storm closes in. Ready? Go go go!', rate=6)
write('09_rapid_speech', np.concatenate([silence(0.5), at_rms_db(a, -20), silence(0.5)]), {'kind': 'speech', 'text': m['text'], 'words': shift_words(m['words'], 0.5), 'source': 'Windows TTS, rate +6'})
a, m = tts('uncommon', 'Today we are testing FrameCut with Kubernetes, Nvidia CUDA, and the Ghibli inspired level Ys Origin. Our guest Siobhan Nguyen explains why Wraith and Xerath are her favourite picks.', voice='Microsoft Zira Desktop')
write('10b_uncommon_words', np.concatenate([silence(0.5), at_rms_db(a, -20), silence(0.5)]), {'kind': 'speech', 'text': m['text'], 'words': shift_words(m['words'], 0.5), 'source': 'Windows TTS', 'vocabulary': ['FrameCut', 'Kubernetes', 'Nvidia', 'CUDA', 'Ghibli', 'Ys Origin', 'Siobhan Nguyen', 'Wraith', 'Xerath']})
a, m = tts('pauses', 'Welcome back. [[pause:3500]] Today I want to show you something. [[pause:2500]] Watch closely. [[pause:4000]] There it is.')
write('14_intentional_pauses', np.concatenate([silence(0.5), at_rms_db(a, -20), silence(1)]), {'kind': 'speech', 'text': m['text'], 'words': shift_words(m['words'], 0.5), 'source': 'Windows TTS with pauses'})
spoken = 'Okay so in this video we are going to build a tiny cabin, and honestly it took me about three hours to get the roof right.'
script = 'In this video we are going to build a small cabin, and it took me about three hours to get the roof right.'
a, m = tts('script', spoken)
write('15_script_realign', np.concatenate([silence(0.5), at_rms_db(a, -20), silence(0.5)]), {'kind': 'speech', 'text': m['text'], 'words': shift_words(m['words'], 0.5), 'script': script, 'source': 'Windows TTS; written script differs from what was said'})
# 12 multiple speakers: LibriSpeech speakers alternating with two TTS voices
d1, md1 = tts('spk_a', 'Did you see that jump? That was incredible.', voice='Microsoft David Desktop')
z1, mz1 = tts('spk_b', 'I know, I almost missed the ledge completely.', voice='Microsoft Zira Desktop')
spk = [libri[10], {'audio': d1, 'text': md1['text'].lower(), 'speaker': 'tts-david'}, libri[20], {'audio': z1, 'text': mz1['text'].lower(), 'speaker': 'tts-zira'}, libri[30]]
a, segs = speech_track(spk, gap=0.4); write('12_multiple_speakers', at_rms_db(a, -20), {'kind': 'speech', 'text': ref_text(segs), 'segments': segs, 'source': 'LibriSpeech speakers + 2 TTS voices'})
# 13 long recording: every LibriSpeech dummy utterance with a quiet music bed
a, segs = speech_track(libri, gap=0.8); a = at_rms_db(a, -20) + at_rms_db(fit(piano, len(a)), -40)
write('13_long_recording', a, {'kind': 'speech', 'text': ref_text(segs), 'segments': segs, 'source': 'All 73 LibriSpeech dummy utterances + piano bed at -20 dB'})

json.dump({'sr': SR, 'cases': cases}, open(os.path.join(BENCH, 'cases.json'), 'w'), indent=1)
print(len(cases), 'cases ->', os.path.join(BENCH, 'cases.json'))
