"""Runs FrameCut's production speech pipeline (desktop/speech/worker.py) over the benchmark.
Usage: python run_pipeline.py <bench_dir> <best|fast> [lyrics|nolyrics] [case ...]"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'desktop', 'speech'))
import worker  # noqa: E402

bench, quality = sys.argv[1], sys.argv[2]
lyrics = (sys.argv[3] if len(sys.argv) > 3 else 'lyrics') != 'nolyrics'
only = set(sys.argv[4:])
cases = json.load(open(os.path.join(bench, 'cases.json')))['cases']
out = os.path.join(bench, 'results', f'pipeline_{quality}' + ('' if lyrics else '_nolyrics')); os.makedirs(out, exist_ok=True)
for c in cases:
    if only and c['id'] not in only: continue
    t0 = time.time()
    r = worker.transcribe({'audio': os.path.join(bench, 'cases', c['file']), 'quality': quality, 'lyrics': lyrics}, lambda *a, **k: None, lambda: False)
    dt = time.time() - t0
    json.dump({'words': r['words'], 'info': {k: r[k] for k in ('language', 'engine', 'skipped', 'verified') if k in r}, 'regions': r['regions'], 'seconds': dt}, open(os.path.join(out, c['id'] + '.json'), 'w'))
    kinds = {}
    for g in r['regions']: kinds[g['kind']] = kinds.get(g['kind'], 0) + 1
    flags = sum(1 for w in r['words'] if w.get('flag'))
    print(f"{c['id']:24s} {len(r['words']):5d} words  {flags:3d} flagged  {dt:6.1f}s  regions={kinds}" + ('' if c['kind'] == 'speech' else '  | ' + ' '.join(w['text'] for w in r['words'])[:110]), flush=True)
