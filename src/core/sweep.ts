// Sweep value generation shared by the Parametric analysis and netlist .STEP.
import { ParamSetup } from './model';
import { parseSpiceNumber } from './units';

export const MAX_SWEEP_RUNS = 50;

export function sweepValues(ps: ParamSetup): { values: number[]; error?: string } {
  const n = (s: string, what: string) => { const r = parseSpiceNumber(s); if (!r.ok) throw new Error(`${what}: ${r.error}`); return r.value; };
  try {
    let values: number[] = [];
    if (ps.sweep === 'list') {
      values = ps.values.split(/[\s,;]+/).filter(Boolean).map(t => n(t, 'Value list'));
    } else if (ps.sweep === 'lin') {
      const a = n(ps.start, 'Start Value'), b = n(ps.end, 'End Value'), d = n(ps.incr, 'Increment');
      if (d === 0 || Math.sign(d) !== Math.sign(b - a || d)) throw new Error('Increment must be non-zero and point from Start to End');
      const count = Math.floor((b - a) / d + 1e-9) + 1;
      if (count > MAX_SWEEP_RUNS) throw new Error(`Sweep has ${count} runs (limit ${MAX_SWEEP_RUNS})`);
      values = Array.from({ length: count }, (_, i) => a + i * d);
    } else {
      const a = n(ps.start, 'Start Value'), b = n(ps.end, 'End Value'), pts = n(ps.incr, 'Points');
      if (a <= 0 || b <= 0) throw new Error('Logarithmic sweeps need positive Start and End values');
      if (!(pts >= 1) || !Number.isInteger(pts)) throw new Error('Points per decade/octave must be a positive integer');
      const base = ps.sweep === 'dec' ? 10 : 2;
      const steps = Math.floor((Math.log(b / a) / Math.log(base)) * pts + 1e-9);
      if (steps + 1 > MAX_SWEEP_RUNS) throw new Error(`Sweep has ${steps + 1} runs (limit ${MAX_SWEEP_RUNS})`);
      values = Array.from({ length: steps + 1 }, (_, i) => a * Math.pow(base, i / pts));
    }
    if (!values.length) throw new Error('No sweep values');
    if (values.length > MAX_SWEEP_RUNS) throw new Error(`Sweep has ${values.length} runs (limit ${MAX_SWEEP_RUNS})`);
    return { values };
  } catch (e) { return { values: [], error: (e as Error).message }; }
}

