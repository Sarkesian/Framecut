// A tiny evaluator for the subset of FFmpeg's expression language that FrameCut uses.
// The same expression strings drive the live preview (evaluated here) and the export
// (passed verbatim to FFmpeg), so motion in the preview matches the rendered file.

const FUNCS = {
  if: (a, b, c = 0) => (a ? b : c),
  ifnot: (a, b, c = 0) => (a ? c : b),
  lt: (a, b) => +(a < b), lte: (a, b) => +(a <= b), gt: (a, b) => +(a > b), gte: (a, b) => +(a >= b),
  eq: (a, b) => +(a === b), min: Math.min, max: Math.max, abs: Math.abs, sin: Math.sin, cos: Math.cos,
  pow: Math.pow, sqrt: Math.sqrt, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc,
  clip: (x, lo, hi) => Math.min(hi, Math.max(lo, x)), mod: (a, b) => a - Math.trunc(a / b) * b,
  between: (x, lo, hi) => +(x >= lo && x <= hi), hypot: Math.hypot, sgn: Math.sign,
};
const CONSTS = { PI: Math.PI, E: Math.E };

const cache = new Map();

// Sticky patterns match at an exact position, so a long baked expression is tokenized without copying
// the rest of the string for every token.
const NUM = /(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/iy, ID = /[A-Za-z_][A-Za-z0-9_]*/y;
function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    NUM.lastIndex = i; const num = NUM.exec(src);
    if (num) { out.push({ t: 'n', v: +num[0] }); i += num[0].length; continue; }
    ID.lastIndex = i; const id = ID.exec(src);
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw Error(`Unexpected "${c}" in expression ${src}`);
  }
  return out;
}

function parse(src) {
  const tk = tokenize(src); let pos = 0;
  const peek = () => tk[pos], take = t => { const x = tk[pos]; if (!x || (t && x.t !== t)) throw Error('Bad expression: ' + src); pos++; return x; };
  function expr() { let n = term(); while (peek() && (peek().t === '+' || peek().t === '-')) { const op = take().t, r = term(), l = n; n = op === '+' ? v => l(v) + r(v) : v => l(v) - r(v); } return n; }
  function term() { let n = power(); while (peek() && (peek().t === '*' || peek().t === '/')) { const op = take().t, r = power(), l = n; n = op === '*' ? v => l(v) * r(v) : v => l(v) / r(v); } return n; }
  function power() { const b = unary(); if (peek()?.t === '^') { take(); const e = power(); return v => Math.pow(b(v), e(v)); } return b; }
  function unary() { if (peek()?.t === '-') { take(); const u = unary(); return v => -u(v); } if (peek()?.t === '+') { take(); return unary(); } return primary(); }
  function primary() {
    const x = take();
    if (x.t === 'n') return () => x.v;
    if (x.t === '(') { const e = expr(); take(')'); return e; }
    if (x.t === 'id') {
      if (peek()?.t === '(') {
        take('('); const args = [];
        if (peek()?.t !== ')') { args.push(expr()); while (peek()?.t === ',') { take(); args.push(expr()); } }
        take(')'); const f = FUNCS[x.v]; if (!f) throw Error('Unknown function ' + x.v);
        return v => f(...args.map(a => a(v)));
      }
      if (x.v in CONSTS) return () => CONSTS[x.v];
      return v => { const r = v[x.v]; if (r === undefined) throw Error('Unknown variable ' + x.v); return r; };
    }
    throw Error('Bad expression: ' + src);
  }
  const fn = expr(); if (pos !== tk.length) throw Error('Trailing tokens in ' + src); return fn;
}

export function evaluate(src, vars = {}) {
  if (typeof src === 'number') return src;
  // Every edit to an animated clip bakes new expression strings, so the cache is bounded: a long session
  // of dragging keyframed clips must not keep every expression it ever compiled.
  let fn = cache.get(src); if (!fn) { fn = parse(src); if (cache.size >= 4000) cache.clear(); cache.set(src, fn); }
  const v = fn(vars); return Number.isFinite(v) ? v : 0;
}

// Replace whole-word variables with sub-expressions (used to bake timing into FFmpeg expressions).
export function substitute(src, map) {
  return String(src).replace(/[A-Za-z_][A-Za-z0-9_]*/g, w => (w in map ? `(${map[w]})` : w));
}

export const EASE = {
  // cubic ease-in-out of p
  inout: 'if(lt(p,0.5),4*p*p*p,1-pow(-2*p+2,3)/2)',
  out: '1-pow(1-p,3)',
  in: 'p*p*p',
  back: '1+2.70158*pow(p-1,3)+1.70158*pow(p-1,2)',
  linear: 'p',
  // quintic ease-in-out: fast through the middle, gentle at both ends
  snappy: 'if(lt(p,0.5),16*pow(p,5),1-pow(-2*p+2,5)/2)',
};
// Transition easing presets: every easing helper a transition uses is replaced by the chosen curve.
export const EASE_PRESET = { smooth: EASE.inout, linear: EASE.linear, in: EASE.in, out: EASE.out, snappy: EASE.snappy, bounce: EASE.back };
export const fmtNum = n => (Math.abs(n) < 1e-9 ? '0' : String(+n.toFixed(6)));
