// Transient analysis planning shared by schematic netlists and hand-written decks.
//
// .TRAN TSTEP TSTOP [TSTART [TMAX]] [UIC]
//  * TSTEP (Print Step) is the output spacing. PSpice uses it only for printing; ngspice also caps the
//    internal step at it unless TMAX is given, so OpenSpice always passes an explicit TMAX.
//  * TMAX (Step Ceiling) omitted or 0 = automatic: (TSTOP)/200. Zero never means an infinitesimal step.
//  * Workload: ngspice takes at least TSTOP/TMAX internal steps per run (limit MAX_TRAN_POINTS). When the
//    output of all runs (× parametric/.STEP runs) would exceed MAX_OUTPUT_POINTS, output is interpolated
//    to the Print Step (.option interp) — the internal accuracy (TMAX, switch breakpoints) is unchanged.
//  * Print Step auto-fix: 0/negative, larger than Final Time, or absurdly fine for the run (more than
//    MAX_PRINT_RATIO points, e.g. 1 ns for a 1 ms run) becomes a 1-2-5 value near Final Time / 1000
//    (1 ms → 1 µs). A Print Step that would overflow MAX_OUTPUT_POINTS across a sweep is raised to the
//    finest 1-2-5 value that fits. Each fix is reported in `stepFix` and the notes.
import { formatEng } from './units';

export const MAX_TRAN_POINTS = 2_000_000;   // internal steps per run
export const MAX_OUTPUT_POINTS = 200_000;   // stored points across all runs of one simulation
export const AUTO_TMAX_DIVISOR = 200;
export const MAX_PRINT_RATIO = 100_000;     // Final Time / Print Step above this is treated as a mistake
export const AUTO_PRINT_POINTS = 1000;

/** Smallest value of the 1-2-5 series that is ≥ v. */
export function niceCeil(v: number): number {
  const e = Math.floor(Math.log10(v)), b = 10 ** e;
  for (const m of [1, 2, 5, 10]) if (m * b >= v * (1 - 1e-12)) return m * b;
  return 10 * b;
}

export interface TranPlan {
  tstep: number; tstop: number; tstart: number; tmax: number;
  tmaxAuto: boolean; interp: boolean; notes: string[]; error?: string;
  /** Set when the Print Step was replaced automatically: the explanation shown to the user. */
  stepFix?: string;
}

const s = (v: number) => `${formatEng(v, 4)}s`;

export function planTran(tstep: number, tstop: number, tstart: number, tmaxIn: number | undefined, runs = 1): TranPlan {
  const notes: string[] = [];
  let stepFix: string | undefined;
  const fail = (error: string): TranPlan => ({ tstep, tstop, tstart, tmax: tmaxIn ?? 0, tmaxAuto: false, interp: false, notes, error, stepFix });
  if (!(tstop > 0) || !isFinite(tstop)) return fail('Final Time (TSTOP) must be greater than 0');
  const budget = (tstop * runs) / MAX_OUTPUT_POINTS;   // finest Print Step whose output fits across all runs
  const fixStep = (why: string, target: number) => {
    const given = tstep;
    tstep = niceCeil(Math.max(target, budget));
    stepFix = `Print Step ${isFinite(given) ? s(given) : String(given)} ${why} — using ${s(tstep)}`;
    notes.push(stepFix);
  };
  const auto = tstop / AUTO_PRINT_POINTS;
  if (!(tstep > 0) || !isFinite(tstep)) fixStep('is not a positive time', auto);
  else if (tstep > tstop) fixStep(`is larger than Final Time ${s(tstop)}`, auto);
  else if (tstop / tstep > MAX_PRINT_RATIO) fixStep(`is far finer than needed for Final Time ${s(tstop)}`, auto);
  else if ((runs * tstop) / tstep > MAX_OUTPUT_POINTS)
    fixStep(`would store ${Math.round((runs * tstop) / tstep).toLocaleString()} points${runs > 1 ? ` across ${runs} runs` : ''} (limit ${MAX_OUTPUT_POINTS.toLocaleString()})`, 0);
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
    const out = tstop / tstep;   // ≤ MAX_OUTPUT_POINTS / runs after the Print Step check above
    interp = true;
    notes.push(`Results stored every Print Step (${s(tstep)}, ${Math.round(out).toLocaleString()} points per run${runs > 1 ? ` × ${runs} runs` : ''}); ` +
      `the solver still uses Step Ceiling ${s(tmax)} internally`);
  }
  return { tstep, tstop, tstart, tmax, tmaxAuto, interp, notes, stepFix };
}
