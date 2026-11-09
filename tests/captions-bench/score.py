"""Scores saved engine outputs (results/<engine>/<case>.json) with one normalizer for every engine, so
formatting choices (Mr./mister, 25/twenty five, colour/color) don't count as recognition errors.
Usage: python score.py <bench_dir> [engine_dir ...]   -> prints a table and writes results/scores.json
"""
import json, os, re, sys
import numpy as np, jiwer

BENCH = sys.argv[1]
CASES = {c['id']: c for c in json.load(open(os.path.join(BENCH, 'cases.json')))['cases']}
RES = os.path.join(BENCH, 'results')
ENGINES = sys.argv[2:] or sorted(d for d in os.listdir(RES) if os.path.isdir(os.path.join(RES, d)))

ABBR = {'mr': 'mister', 'mrs': 'missus', 'dr': 'doctor', 'st': 'saint', 'vs': 'versus', 'ok': 'okay', 'etc': 'etcetera', 'percent': 'percent'}
UK = {'recognise': 'recognize', 'recognising': 'recognizing', 'colour': 'color', 'favourite': 'favorite', 'organisation': 'organization', 'realise': 'realize', 'centre': 'center', 'behaviour': 'behavior', 'analyse': 'analyze', 'honour': 'honor'}
ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split()
def spell(n):
    n = int(n)
    if n < 20: return ONES[n]
    if n < 100: return TENS[n // 10 - 2] + ('' if n % 10 == 0 else ' ' + ONES[n % 10])
    if n < 1000: return ONES[n // 100] + ' hundred' + ('' if n % 100 == 0 else ' ' + spell(n % 100))
    if n < 1_000_000: return spell(n // 1000) + ' thousand' + ('' if n % 1000 == 0 else ' ' + spell(n % 1000))
    return str(n)
def norm(s):
    s = s.lower().replace('%', ' percent').replace('&', ' and ').replace('-', ' ')
    s = re.sub(r'(\d),(\d{3})', r'\1\2', s)
    s = re.sub(r'\d+', lambda m: ' ' + spell(m.group()) + ' ', s)
    s = re.sub(r"[^a-z' ]+", ' ', s)
    s = re.sub(r"'(?!\w)|(?<!\w)'", ' ', s)
    out = []
    for w in s.split():
        w = ABBR.get(w, w); w = UK.get(w, w)
        if w in ('uh', 'um', 'hmm', 'mm', 'ah', 'er', 'erm'): continue  # disfluencies are optional in references
        out.append(w)
    return ' '.join(out)

def pairs(ref_words, hyp_words):
    def flat(ws):
        toks, own = [], []
        for i, w in enumerate(ws):
            for t in norm(w).split(): toks.append(t); own.append(i)
        return toks, own
    rt, ro = flat(ref_words); ht, ho = flat(hyp_words)
    if not rt or not ht: return []
    o = jiwer.process_words(' '.join(rt), ' '.join(ht)); out = []
    for ch in o.alignments[0]:
        if ch.type == 'equal':
            for k in range(ch.ref_end_idx - ch.ref_start_idx):
                pr = (ro[ch.ref_start_idx + k], ho[ch.hyp_start_idx + k])
                if not out or out[-1] != pr: out.append(pr)
    return out

table = {}
for eng in ENGINES:
    rows = {}; err = ref_n = 0; false_words = 0; secs = 0; dur = 0; tim = []; outside = 0; song = None
    for cid, c in CASES.items():
        f = os.path.join(RES, eng, cid + '.json')
        if not os.path.exists(f): continue
        h = json.load(open(f)); words = h['words']; secs += h['seconds']; dur += c['duration']
        hyp = norm(' '.join(w['text'] for w in words)); r = {'words': len(hyp.split()) if hyp else 0}
        if c['kind'] == 'speech':
            ref = norm(c['text']); m = jiwer.process_words(ref, hyp or 'x')
            r['wer'] = round(m.wer, 4); e = m.insertions + m.deletions + m.substitutions; err += e; ref_n += len(ref.split())
            if c.get('segments'):
                out = [w for w in words if not any(s['start'] - 0.35 <= (w['start'] + w['end']) / 2 <= s['end'] + 0.35 for s in c['segments'])]
                r['outside'] = len(out); outside += len(out)
            if c.get('words'):
                pr = pairs([w['text'] for w in c['words']], [w['text'] for w in words])
                errs = [abs(words[h_]['start'] - c['words'][i]['start']) for i, h_ in pr]
                if errs: r['timing_ms'] = round(1000 * float(np.mean(errs)), 1); tim += errs
        elif c['kind'] == 'nospeech': false_words += r['words']
        else: song = r['words']
        rows[cid] = r
    if not rows: continue
    table[eng] = {'pooled_wer': round(err / max(1, ref_n), 4), 'false_words_nospeech': false_words, 'song_words': song, 'words_outside_speech': outside, 'timing_mae_ms': round(1000 * float(np.mean(tim)), 1) if tim else None, 'rtf': round(secs / max(1, dur), 4), 'cases': rows}
json.dump(table, open(os.path.join(RES, 'scores.json'), 'w'), indent=1)
ids = [c for c in CASES if CASES[c]['kind'] == 'speech']
print(f"{'engine':42s} {'WER':>6s} {'false':>5s} {'outside':>7s} {'timing':>7s} {'RTF':>6s}  " + ' '.join(i[:5] for i in ids))
for eng, t in sorted(table.items(), key=lambda kv: kv[1]['pooled_wer']):
    print(f"{eng:42s} {t['pooled_wer']*100:5.1f}% {t['false_words_nospeech']:5d} {t['words_outside_speech']:7d} {str(t['timing_mae_ms']):>7s} {t['rtf']:6.3f}  " + ' '.join(f"{t['cases'].get(i, {}).get('wer', float('nan'))*100:5.1f}" for i in ids))
