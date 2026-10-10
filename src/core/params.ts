// Global parameters (PSpice PARAMETERS block / .PARAM) and {expression} property values.
// Expressions: numbers with SPICE suffixes, parameter names, + - * / ^ ( ) and the functions below.
import { parseSpiceNumber, spiceNum } from './units';

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, min: Math.min, max: Math.max, pow: Math.pow,
};

type Tok = { t: 'num'; v: number; s: string } | { t: 'id'; s: string } | { t: 'op'; s: string };

export function tokenize(expr: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?[a-zµ]*/i.exec(expr.slice(i));
    if (num) {
      const r = parseSpiceNumber(num[0]);
      if (!r.ok) throw new Error(`Bad number "${num[0]}"`);
      out.push({ t: 'num', v: r.value, s: num[0] }); i += num[0].length; continue;
    }
    const id = /^[a-z_][\w]*/i.exec(expr.slice(i));
    if (id) { out.push({ t: 'id', s: id[0] }); i += id[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: 'op', s: c }); i++; continue; }
    throw new Error(`Unexpected "${c}" in expression "${expr}"`);
  }
  return out;
}

/** Evaluate an expression; `lookup` resolves parameter names (case-insensitive). */
export function evalExpr(expr: string, lookup: (name: string) => number): number {
  const toks = tokenize(expr);
  let k = 0;
  const peek = () => toks[k];
  const take = (s?: string) => { const t = toks[k]; if (s && (!t || t.s !== s)) throw new Error(`Expected "${s}" in "${expr}"`); k++; return t; };
  const prim = (): number => {
    const t = take();
    if (!t) throw new Error(`Incomplete expression "${expr}"`);
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.s === '(') { const v = sum(); take(')'); return v; }
    if (t.t === 'op' && t.s === '-') return -pow();
    if (t.t === 'op' && t.s === '+') return pow();
    if (t.t === 'id') {
      if (peek()?.s === '(') {
        const f = FUNCS[t.s.toLowerCase()];
        if (!f) throw new Error(`Unknown function "${t.s}"`);
        take('('); const args = [sum()];
        while (peek()?.s === ',') { take(','); args.push(sum()); }
        take(')'); return f(...args);
      }
      return lookup(t.s);
    }
    throw new Error(`Unexpected "${t.s}" in "${expr}"`);
  };
  const pow = (): number => { const b = prim(); if (peek()?.s === '^') { take('^'); return Math.pow(b, pow()); } return b; };
  const prod = (): number => { let v = pow(); while (peek()?.s === '*' || peek()?.s === '/') { const o = take().s; const r = pow(); v = o === '*' ? v * r : v / r; } return v; };
  const sum = (): number => { let v = prod(); while (peek()?.s === '+' || peek()?.s === '-') { const o = take().s; const r = prod(); v = o === '+' ? v + r : v - r; } return v; };
  if (!toks.length) throw new Error('Empty expression');
  const v = sum();
  if (k < toks.length) throw new Error(`Unexpected "${toks[k].s}" in "${expr}"`);
  if (!isFinite(v)) throw new Error(`Expression "${expr}" is not finite`);
  return v;
}

/** Rewrite for ngspice: numeric literals normalized (1k -> 1000), names/operators kept. */
export function exprToSpice(expr: string): string {
  return tokenize(expr).map(t => (t.t === 'num' ? spiceNum(t.v) : t.s)).join('');
}

export const isBraced = (s: string) => /^\{.*\}$/s.test(s.trim());
export const unbrace = (s: string) => s.trim().slice(1, -1);

export interface ParamDef { name: string; expr: string }
export interface ParamTable { values: Map<string, number>; defs: ParamDef[]; errors: string[] }

/** Resolve parameter definitions (with optional sweep overrides), detecting undefined names and cycles. */
export function resolveParams(defs: ParamDef[], overrides: Map<string, number> = new Map()): ParamTable {
  const errors: string[] = [];
  const byName = new Map<string, ParamDef>();
  for (const d of defs) {
    const k = d.name.toLowerCase();
    if (!/^[a-z_]\w*$/i.test(d.name)) { errors.push(`Invalid parameter name "${d.name}"`); continue; }
    if (FUNCS[k]) { errors.push(`Parameter name "${d.name}" is a function name`); continue; }
    if (byName.has(k)) errors.push(`Parameter "${d.name}" is defined more than once`);
    byName.set(k, d);
  }
  const values = new Map<string, number>();
  const state = new Map<string, 'busy' | 'done'>();
  const get = (name: string, chain: string[]): number => {
    const k = name.toLowerCase();
    if (overrides.has(k)) return overrides.get(k)!;
    if (values.has(k)) return values.get(k)!;
    const d = byName.get(k);
    if (!d) throw new Error(`Undefined parameter "${name}"`);
    if (state.get(k) === 'busy') throw new Error(`Circular parameter definition: ${[...chain, d.name].join(' → ')}`);
    state.set(k, 'busy');
    const v = evalExpr(isBraced(d.expr) ? unbrace(d.expr) : d.expr, n => get(n, [...chain, d.name]));
    state.set(k, 'done'); values.set(k, v);
    return v;
  };
  for (const d of byName.values()) { try { get(d.name, []); } catch (e) { errors.push((e as Error).message); } }
  for (const [k, v] of overrides) values.set(k, v);
  return { values, defs: [...byName.values()], errors };
}
