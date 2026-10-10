// SPICE engineering-notation parsing and formatting.
// SPICE is case-insensitive: "m"/"M" = milli, "meg"/"MEG" = mega, "mil" = 25.4e-6.
// Trailing unit letters (V, A, Hz, F, H, s, ohm) are ignored, as in SPICE.

const SUFFIXES: [string, number][] = [
  ['meg', 1e6], ['mil', 25.4e-6],
  ['t', 1e12], ['g', 1e9], ['k', 1e3], ['m', 1e-3],
  ['u', 1e-6], ['µ', 1e-6], ['n', 1e-9], ['p', 1e-12], ['f', 1e-15],
];

const UNIT_WORDS = /^(v|a|hz|f|h|s|ohms?|ω|w|sec)?$/i;

export interface ParseResult { ok: boolean; value: number; error?: string; warning?: string }

export function parseSpiceNumber(input: string): ParseResult {
  const s = input.trim();
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(.*)$/i.exec(s);
  if (!m) return { ok: false, value: NaN, error: `"${input}" is not a number` };
  let value = parseFloat(m[1]);
  let rest = m[2];
  let warning: string | undefined;
  const lower = rest.toLowerCase();
  for (const [suf, mult] of SUFFIXES) {
    if (lower.startsWith(suf)) {
      value *= mult;
      if (suf === 'm' && rest[0] === 'M' && !lower.startsWith('meg')) {
        warning = `"M" means milli (1e-3) in SPICE. Use "Meg" for mega.`;
      }
      rest = rest.slice(suf.length);
      break;
    }
  }
  if (!UNIT_WORDS.test(rest)) {
    return { ok: false, value: NaN, error: `Unrecognised suffix "${rest}" in "${input}"` };
  }
  if (!isFinite(value)) return { ok: false, value: NaN, error: `"${input}" is out of range` };
  return { ok: true, value, warning };
}

const FMT: [number, string][] = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'Meg'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];

/** Format a number in engineering notation, e.g. 0.002 -> "2m", 6 -> "6". */
export function formatEng(v: number, digits = 4, unit = ''): string {
  if (!isFinite(v)) return String(v);
  if (v === 0) return '0' + unit;
  const a = Math.abs(v);
  for (const [mult, suf] of FMT) {
    if (a >= mult * 0.9999999) {
      const n = v / mult;
      return trimNum(n.toPrecision(digits)) + suf + unit;
    }
  }
  return v.toExponential(digits - 1) + unit;
}

function trimNum(s: string): string {
  if (s.includes('e')) return s;
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Canonical numeric string for the netlist (unambiguous, no suffix). */
export function spiceNum(v: number): string {
  if (v === 0) return '0';
  const s = v.toPrecision(12);
  return trimNum(s.includes('e') ? s.replace(/\.?0+e/, 'e') : s);
}
