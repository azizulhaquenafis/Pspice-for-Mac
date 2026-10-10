// Engineering axis ticks and precision-aware labels for Probe.
// Ticks are integer multiples of a 1-2-5 step (no accumulated float error). Label precision is
// derived from the step, never fixed, and is increased until every displayed label is distinct.
// When a tiny interval sits at a large value (2.2000–2.2010 ms) the prefix follows the step
// (2200 … 2202 µs) instead of printing many decimals.

const PREFIX: [number, string][] = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];

export function niceStep(span: number, target: number): number {
  if (!(span > 0) || !isFinite(span)) return 1;
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * mag >= raw * (1 - 1e-9)) return m * mag;
  return 10 * mag;
}

export function linearTicks(a: number, b: number, target: number): { ticks: number[]; step: number } {
  if (!(b > a)) return { ticks: [a], step: 1 };
  const step = niceStep(b - a, target);
  const i0 = Math.ceil(a / step - 1e-9), i1 = Math.floor(b / step + 1e-9);
  const ticks: number[] = [];
  for (let i = i0; i <= i1 && ticks.length < 1000; i++) {
    const t = i * step;
    ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return { ticks, step };
}

const prefixFor = (v: number): [number, string] => {
  const a = Math.abs(v);
  if (a === 0) return [1, ''];
  return PREFIX.find(([m]) => a >= m * (1 - 1e-12)) ?? PREFIX[PREFIX.length - 1];
};

/** Decimals needed so `x` (in display units) is written exactly to ~1e-6 relative. */
function decimalsFor(x: number): number {
  for (let d = 0; d <= 12; d++) {
    const s = x * Math.pow(10, d);
    if (Math.abs(s - Math.round(s)) < 1e-6 * Math.max(1, Math.abs(s))) return d;
  }
  return 12;
}

export interface TickLabels { labels: string[]; prefix: string; mult: number; decimals: number }

/** Labels for ticks with the given step, e.g. unit "s" -> "2.002ms". */
export function formatTicks(ticks: number[], step: number, unit = ''): TickLabels {
  const maxAbs = Math.max(...ticks.map(Math.abs), 0);
  let [mult, prefix] = prefixFor(maxAbs || step);
  let decimals = decimalsFor(step / mult);
  if (decimals > 3) { [mult, prefix] = prefixFor(step * 10); decimals = decimalsFor(step / mult); }
  const make = (d: number) => ticks.map(t => {
    const s = (t / mult).toFixed(d);
    return (/^-0(\.0+)?$/.test(s) ? s.slice(1) : s) + prefix + unit;
  });
  let labels = make(decimals);
  while (new Set(labels).size < labels.length && decimals < 15) labels = make(++decimals);
  return { labels, prefix, mult, decimals };
}

/** Readout value with enough digits to resolve `resolution` (e.g. cursor positions, Δt). */
export function formatPrecise(v: number, resolution: number, unit = ''): string {
  if (!isFinite(v)) return String(v);
  if (v === 0) return `0${unit}`;
  const [mult, prefix] = prefixFor(v);
  const d = Math.min(12, Math.max(0, Math.ceil(-Math.log10(Math.abs(resolution / mult) || 1e-12) - 1e-9)));
  return (v / mult).toFixed(d) + prefix + unit;
}
