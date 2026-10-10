// Probe "Evaluate Measurement" functions (PSpice goal-function style) on one trace (x, y).
// All results are computed from the plotted simulation data with linear interpolation.
export interface MeasureDef { name: string; args: string[]; help: string }
export const MEASUREMENTS: MeasureDef[] = [
  { name: 'Max', args: [], help: 'Largest value' },
  { name: 'Min', args: [], help: 'Smallest value' },
  { name: 'Peak_to_Peak', args: [], help: 'Max − Min' },
  { name: 'Average', args: [], help: 'Time average (trapezoidal integral / span)' },
  { name: 'RMS', args: [], help: 'Root mean square' },
  { name: 'YatX', args: ['X'], help: 'Value at the given X' },
  { name: 'XatNthY', args: ['Y', 'N'], help: 'X of the N-th crossing of level Y' },
  { name: 'Risetime_NoOvershoot', args: [], help: '10 % → 90 % rise time between initial and final value' },
  { name: 'Falltime_NoOvershoot', args: [], help: '90 % → 10 % fall time between initial and final value' },
  { name: 'Overshoot', args: [], help: 'Overshoot above the final value, % of the step' },
  { name: 'Period', args: [], help: 'Average period between rising crossings of the mid level' },
];

const crossings = (x: Float64Array, y: Float64Array, level: number, dir: 0 | 1 | -1 = 0): number[] => {
  const out: number[] = [];
  for (let i = 1; i < x.length; i++) {
    const a = y[i - 1] - level, b = y[i] - level;
    if (a === 0 && i === 1 && dir === 0) out.push(x[0]);
    if ((a < 0 && b >= 0 && dir >= 0) || (a > 0 && b <= 0 && dir <= 0)) out.push(x[i - 1] + (x[i] - x[i - 1]) * (a / (a - b)));
  }
  return out;
};

export function measure(name: string, x: Float64Array, y: Float64Array, args: number[] = []): number {
  const n = x.length;
  if (n < 2) return NaN;
  let mx = -Infinity, mn = Infinity;
  for (const v of y) { if (v > mx) mx = v; if (v < mn) mn = v; }
  const integ = (f: (v: number) => number) => { let s = 0; for (let i = 1; i < n; i++) s += (x[i] - x[i - 1]) * (f(y[i]) + f(y[i - 1])) / 2; return s; };
  const span = x[n - 1] - x[0];
  const y0 = y[0], yf = y[n - 1], step = yf - y0;
  switch (name) {
    case 'Max': return mx;
    case 'Min': return mn;
    case 'Peak_to_Peak': return mx - mn;
    case 'Average': return integ(v => v) / span;
    case 'RMS': return Math.sqrt(integ(v => v * v) / span);
    case 'YatX': {
      const X = args[0]; if (!(X >= x[0] && X <= x[n - 1])) return NaN;
      let i = 1; while (i < n - 1 && x[i] < X) i++;
      return y[i - 1] + (y[i] - y[i - 1]) * ((X - x[i - 1]) / (x[i] - x[i - 1] || 1));
    }
    case 'XatNthY': { const c = crossings(x, y, args[0]); return c[(args[1] ?? 1) - 1] ?? NaN; }
    case 'Risetime_NoOvershoot': case 'Falltime_NoOvershoot': {
      const rising = name.startsWith('Rise');
      if (step === 0 || (step > 0) !== rising) return NaN;
      const a = crossings(x, y, y0 + 0.1 * step, rising ? 1 : -1)[0], b = crossings(x, y, y0 + 0.9 * step, rising ? 1 : -1)[0];
      return a !== undefined && b !== undefined ? b - a : NaN;
    }
    case 'Overshoot': return step === 0 ? NaN : ((step > 0 ? mx - yf : yf - mn) / Math.abs(step)) * 100;
    case 'Period': {
      const c = crossings(x, y, (mx + mn) / 2, 1);
      return c.length < 2 ? NaN : (c[c.length - 1] - c[0]) / (c.length - 1);
    }
    default: throw new Error(`Unknown measurement ${name}`);
  }
}
