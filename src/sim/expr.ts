// Probe trace expressions (PSpice-style), evaluated element-wise on simulation vectors.
//   Signals:   V(node)  V(n1,n2)  V(R1:1)  V(R1:1,R1:2)  V(R1) (= across R1, pin1 - pin2)
//              I(R1) (into pin 1 / + terminal)  I(R1:2) (= -I(R1))  W(R1) (absorbed power = V across · I)
//              TIME, FREQUENCY (the x axis)
//   Operators: + - * / ^ and parentheses; numbers accept SPICE suffixes (1k, 2m, 3Meg).
//   Functions: DB() P() (phase, deg) M() (magnitude) R() (real) IMG() ABS() SQRT() LOG() LOG10() EXP() SIN() COS()
// AC vectors are complex; arithmetic is complex.
import { Plot, getVector } from './types';
import { parseSpiceNumber } from '../core/units';

export interface Device { name: string; nodes: string[] }
export interface Val { re: Float64Array; im: Float64Array | null }

/** Device name -> nodes, parsed from the simulated deck (works for schematic and .cir runs). */
export function parseDeckDevices(deck: string): Map<string, Device> {
  const m = new Map<string, Device>();
  deck.split('\n').forEach((raw, i) => {
    const l = raw.trim();
    if (i === 0 || !l || '*.;+'.includes(l[0])) return;
    const t = l.split(/\s+/);
    if (t.length < 3 || t[0].includes('__') || !/^[rclvidegfhs]/i.test(t[0])) return;
    m.set(t[0].toLowerCase(), { name: t[0], nodes: [t[1].toLowerCase(), t[2].toLowerCase()] });
  });
  return m;
}

/** ngspice vector holding the current into a device's first terminal. */
export function deviceCurrentVec(name: string): string | null {
  const n = name.toLowerCase();
  switch (n[0]) {
    case 'r': case 'c': case 'l': case 'g': case 's': case 'f': return `i(@${n}[i])`;
    case 'v': case 'e': case 'h': return `i(${n})`;
    case 'i': return `i(@${n}[current])`;
    case 'd': return `i(@${n}[id])`;
    default: return null;
  }
}

export class ExprError extends Error {}

export function evaluateExpr(expr: string, plot: Plot, devices: Map<string, Device>): Val {
  const N = plot.vectors[0].re.length;
  const src = expr.trim();
  let pos = 0;
  const fail = (msg: string): never => { throw new ExprError(msg); };
  const skip = () => { while (pos < src.length && /\s/.test(src[pos])) pos++; };
  const peek = () => { skip(); return src[pos]; };
  const scalar = (v: number): Val => ({ re: Float64Array.of(v), im: null });
  const idx = (a: Val, i: number) => (a.re.length === 1 ? 0 : i);

  function zip(a: Val, b: Val, f: (ar: number, ai: number, br: number, bi: number) => [number, number]): Val {
    const n = Math.max(a.re.length, b.re.length);
    const complex = !!(a.im || b.im);
    const re = new Float64Array(n), im = complex ? new Float64Array(n) : null;
    for (let i = 0; i < n; i++) {
      const ia = idx(a, i), ib = idx(b, i);
      const [r, j] = f(a.re[ia], a.im ? a.im[ia] : 0, b.re[ib], b.im ? b.im[ib] : 0);
      re[i] = r; if (im) im[i] = j;
    }
    return { re, im };
  }
  const map = (a: Val, f: (r: number, i: number) => [number, number], realOut = false): Val => {
    const re = new Float64Array(a.re.length), im = a.im && !realOut ? new Float64Array(a.re.length) : null;
    for (let i = 0; i < a.re.length; i++) { const [r, j] = f(a.re[i], a.im ? a.im[i] : 0); re[i] = r; if (im) im[i] = j; }
    return { re, im };
  };
  const vec = (name: string): Val | null => {
    const v = getVector(plot, name);
    return v ? { re: v.re, im: v.im ?? null } : null;
  };
  const device = (ref: string): Device | undefined => {
    const r = ref.toLowerCase();
    return devices.get(r) ?? [...devices.values()].find(d => d.name.toLowerCase().endsWith('_' + r));
  };
  const pinIndex = (pin: string) => {
    const p = pin.toLowerCase();
    if (['1', '+', 'a', 'p', 'n+'].includes(p)) return 0;
    if (['2', '-', 'k', 'n', 'n-'].includes(p)) return 1;
    return fail(`Unknown pin "${pin}" (use 1/2, +/-, A/K)`);
  };
  const nodeV = (spec: string): Val => {
    const s = spec.trim();
    if (s === '0' || s.toLowerCase() === 'gnd') return scalar(0);
    const pm = /^(.+):(.+)$/.exec(s);
    if (pm) {
      const d = device(pm[1]) ?? fail(`No device "${pm[1]}"`);
      return nodeV(d.nodes[pinIndex(pm[2])]);
    }
    const v = vec(`v(${s})`);
    if (v) return v;
    const d = device(s);
    if (d) return sub(nodeV(d.nodes[0]), nodeV(d.nodes[1]));
    return fail(`No node or device named "${s}"`);
  };
  const current = (spec: string): Val => {
    const pm = /^(.+):(.+)$/.exec(spec.trim());
    const d = device(pm ? pm[1] : spec) ?? fail(`No device "${pm ? pm[1] : spec}"`);
    const vn = deviceCurrentVec(d.name);
    const v = (vn ? vec(vn) : null) ?? fail(`Current of ${d.name} is not available in this analysis`);
    return pm && pinIndex(pm[2]) === 1 ? neg(v) : v;
  };
  const sub = (a: Val, b: Val) => zip(a, b, (ar, ai, br, bi) => [ar - br, ai - bi]);
  const neg = (a: Val) => map(a, (r, i) => [-r, -i]);
  const mul = (a: Val, b: Val) => zip(a, b, (ar, ai, br, bi) => [ar * br - ai * bi, ar * bi + ai * br]);

  const FUNCS: Record<string, (a: Val) => Val> = {
    db: a => map(a, (r, i) => [20 * Math.log10(Math.hypot(r, i)), 0], true),
    p: a => map(a, (r, i) => [Math.atan2(i, r) * 180 / Math.PI, 0], true),
    m: a => map(a, (r, i) => [Math.hypot(r, i), 0], true),
    abs: a => map(a, (r, i) => [Math.hypot(r, i), 0], true),
    r: a => map(a, r => [r, 0], true),
    img: a => map(a, (_r, i) => [i, 0], true),
    sqrt: a => a.im ? map(a, (r, i) => { const m = Math.sqrt(Math.hypot(r, i)), t = Math.atan2(i, r) / 2; return [m * Math.cos(t), m * Math.sin(t)]; }) : map(a, r => [Math.sqrt(r), 0]),
    log: a => map(a, (r, i) => [Math.log(Math.hypot(r, i)), Math.atan2(i, r)]),
    log10: a => map(a, (r, i) => [Math.log10(Math.hypot(r, i)), Math.atan2(i, r) / Math.LN10]),
    exp: a => map(a, (r, i) => [Math.exp(r) * Math.cos(i), Math.exp(r) * Math.sin(i)]),
    sin: a => map(a, r => [Math.sin(r), 0]),
    cos: a => map(a, r => [Math.cos(r), 0]),
  };

  function rawArgs(): string[] {
    // after '(' : read to matching ')' and split on top-level commas
    let depth = 1, start = pos;
    while (pos < src.length && depth) { if (src[pos] === '(') depth++; else if (src[pos] === ')') depth--; pos++; }
    if (depth) fail('Missing ")"');
    return src.slice(start, pos - 1).split(',').map(s => s.trim());
  }

  function primary(): Val {
    const c = peek();
    if (c === undefined) return fail('Unexpected end of expression');
    if (c === '(') { pos++; const v = sum(); if (peek() !== ')') fail('Missing ")"'); pos++; return v; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?[a-z]*/i.exec(src.slice(pos));
    if (num) {
      const r = parseSpiceNumber(num[0]);
      if (!r.ok) fail(`Bad number "${num[0]}"`);
      pos += num[0].length; return scalar(r.value);
    }
    const id = /^[a-z_]\w*/i.exec(src.slice(pos));
    if (!id) return fail(`Unexpected "${c}" at position ${pos + 1}`);
    pos += id[0].length;
    const name = id[0].toLowerCase();
    if (peek() !== '(') {
      if (name === 'time' || name === 'frequency' || name === 'freq') return { re: plot.vectors[0].re, im: null };
      return fail(`Unknown name "${id[0]}" — signals are written V(...), I(...), W(...)`);
    }
    pos++;
    if (name === 'v' || name === 'i' || name === 'w') {
      const args = rawArgs();
      if (name === 'v') {
        if (args.length === 1) return nodeV(args[0]);
        if (args.length === 2) return sub(nodeV(args[0]), nodeV(args[1]));
        return fail('V() takes one or two nodes');
      }
      if (args.length !== 1) fail(`${name.toUpperCase()}() takes one device`);
      if (name === 'i') return current(args[0]);
      const d = device(args[0]) ?? fail(`No device "${args[0]}"`);
      return mul(sub(nodeV(d.nodes[0]), nodeV(d.nodes[1])), current(d.name));
    }
    const f = FUNCS[name] ?? fail(`Unknown function "${id[0]}"`);
    const v = sum();
    if (peek() !== ')') fail('Missing ")"');
    pos++;
    return f(v);
  }
  function power(): Val {
    const b = primary();
    if (peek() === '^') {
      pos++; const e = unary();
      return zip(b, e, (br, bi, er) => {
        if (!bi) return [Math.pow(br, er), 0];
        const m = Math.pow(Math.hypot(br, bi), er), t = Math.atan2(bi, br) * er;
        return [m * Math.cos(t), m * Math.sin(t)];
      });
    }
    return b;
  }
  function unary(): Val {
    const c = peek();
    if (c === '-') { pos++; return neg(unary()); }
    if (c === '+') { pos++; return unary(); }
    return power();
  }
  function product(): Val {
    let v = unary();
    for (;;) {
      const c = peek();
      if (c === '*') { pos++; v = mul(v, unary()); }
      else if (c === '/') {
        pos++;
        v = zip(v, unary(), (ar, ai, br, bi) => { const d = br * br + bi * bi; return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d]; });
      } else return v;
    }
  }
  function sum(): Val {
    let v = product();
    for (;;) {
      const c = peek();
      if (c === '+') { pos++; const b = product(); v = zip(v, b, (ar, ai, br, bi) => [ar + br, ai + bi]); }
      else if (c === '-') { pos++; v = sub(v, product()); }
      else return v;
    }
  }

  if (!src) fail('Empty expression');
  const out = sum();
  if (peek() !== undefined) fail(`Unexpected "${src.slice(pos)}"`);
  if (out.re.length === 1 && N > 1) return { re: new Float64Array(N).fill(out.re[0]), im: out.im ? new Float64Array(N).fill(out.im[0]) : null };
  return out;
}
