// Transient analysis planning shared by schematic netlists and hand-written decks.
//
// .TRAN TSTEP TSTOP [TSTART [TMAX]] [UIC]
//  * TSTEP (Print Step) is the output spacing. PSpice uses it only for printing; ngspice also caps the
//    internal step at it unless TMAX is given, so OpenSpice always passes an explicit TMAX.
//  * TMAX (Step Ceiling) omitted or 0 = automatic: (TSTOP)/200. Zero never means an infinitesimal step.
//  * Workload: ngspice takes at least TSTOP/TMAX internal steps per run (limit MAX_TRAN_POINTS). When the
//    output of all runs (× parametric/.STEP runs) would exceed MAX_OUTPUT_POINTS, output is interpolated
//    to the Print Step (.option interp) — the internal accuracy (TMAX, switch breakpoints) is unchanged.
import { formatEng } from './units';

export const MAX_TRAN_POINTS = 2_000_000;   // internal steps per run
export const MAX_OUTPUT_POINTS = 200_000;   // stored points across all runs of one simulation
export const AUTO_TMAX_DIVISOR = 200;

export interface TranPlan {
  tstep: number; tstop: number; tstart: number; tmax: number;
  tmaxAuto: boolean; interp: boolean; notes: string[]; error?: string;
}

const s = (v: number) => `${formatEng(v, 4)}s`;

export function planTran(tstep: number, tstop: number, tstart: number, tmaxIn: number | undefined, runs = 1): TranPlan {
  const notes: string[] = [];
  const fail = (error: string): TranPlan => ({ tstep, tstop, tstart, tmax: tmaxIn ?? 0, tmaxAuto: false, interp: false, notes, error });
  if (!(tstop > 0)) return fail('Final Time (TSTOP) must be greater than 0');
  if (!(tstep > 0)) return fail('Print Step (TSTEP) must be greater than 0');
  if (tstep > tstop) return fail(`Print Step ${s(tstep)} is larger than Final Time ${s(tstop)}`);
  if (tstart < 0 || tstart >= tstop) return fail(`No-Print Delay (TSTART) ${s(tstart)} must be ≥ 0 and less than Final Time ${s(tstop)}`);
  if (tmaxIn !== undefined && (tmaxIn < 0 || !isFinite(tmaxIn))) return fail(`Step Ceiling (TMAX) ${tmaxIn} is invalid: use a positive time, or 0 / omit it for automatic`);
  const tmaxAuto = tmaxIn === undefined || tmaxIn === 0;
  const tmax = tmaxAuto ? tstop / AUTO_TMAX_DIVISOR : tmaxIn!;
  if (tmaxAuto && tmaxIn === 0) notes.push(`Step Ceiling 0 means automatic — using ${s(tmax)} (Final Time / ${AUTO_TMAX_DIVISOR})`);
  else if (tmaxAuto) notes.push(`No Step Ceiling given — using ${s(tmax)} (Final Time / ${AUTO_TMAX_DIVISOR}); Print Step only sets the output spacing`);
  const internal = tstop / tmax;
  if (internal > MAX_TRAN_POINTS) {
    return fail(`Step Ceiling ${s(tmax)} over ${s(tstop)} needs about ${Math.round(internal).toLocaleString()} internal steps per run ` +
      `(limit ${MAX_TRAN_POINTS.toLocaleString()} per run). Use a Step Ceiling of at least ${s(tstop / MAX_TRAN_POINTS)}.`);
  }
  let interp = false;
  if (runs * internal > MAX_OUTPUT_POINTS) {
    const out = tstop / tstep;
    if (runs * out > MAX_OUTPUT_POINTS) {
      const where = runs > 1 ? `across the sweep (${runs} runs × ${Math.round(out).toLocaleString()} points)` : `for this run (${Math.round(out).toLocaleString()} points)`;
      return fail(`Output would be ${Math.round(runs * out).toLocaleString()} points ${where}, over the limit of ${MAX_OUTPUT_POINTS.toLocaleString()}. ` +
        `Use a Print Step of at least ${s((tstop * runs) / MAX_OUTPUT_POINTS)}${runs > 1 ? ' or fewer sweep values' : ''}.`);
    }
    interp = true;
    notes.push(`Results stored every Print Step (${s(tstep)}, ${Math.round(out).toLocaleString()} points per run${runs > 1 ? ` × ${runs} runs` : ''}); ` +
      `the solver still uses Step Ceiling ${s(tmax)} internally`);
  }
  return { tstep, tstop, tstart, tmax, tmaxAuto, interp, notes };
}
