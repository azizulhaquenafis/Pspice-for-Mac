// Parametric sweep controller (PSpice "Parametric" analysis). ngspice has no .STEP, so every value
// is an independent, complete ngspice run (including the IC bias-point pass when needed).
import { SchematicDoc, ParamSetup } from '../core/model';
import { formatEng } from '../core/units';
import { getDef } from '../core/library';
import { runSchematic } from './schematicSim';
import { SimulationEngine, SimResult, SimStep } from './types';

export { sweepValues, MAX_SWEEP_RUNS } from '../core/sweep';
import { sweepValues } from '../core/sweep';

export function stepLabel(ps: ParamSetup, v: number): string {
  if (ps.varType === 'temp') return `TEMP = ${formatEng(v, 5)}°C`;
  return `${ps.name} = ${formatEng(v, 5)}`;
}

export async function runParametric(
  doc: SchematicDoc, engine: SimulationEngine, signal?: AbortSignal,
  onProgress?: (i: number, n: number, label: string) => void,
): Promise<{ result: SimResult; deck: string }> {
  const ps = doc.profile.param;
  const fail = (e: string) => ({ result: { ok: false, plots: [], log: '', errors: [e], elapsedMs: 0 }, deck: '' });
  const { values, error } = sweepValues(ps);
  if (error) return fail(`Parametric: ${error}`);
  if (ps.varType === 'source') {
    const src = doc.parts.find(p => p.ref.toUpperCase() === ps.name.trim().toUpperCase());
    if (!src || !['V', 'I'].includes(getDef(src.type).spiceLetter)) return fail(`Parametric: no independent source named "${ps.name}"`);
  }
  if (ps.varType === 'global' && !/^[a-z_]\w*$/i.test(ps.name.trim())) return fail('Parametric: enter the global parameter name');
  if (ps.varType === 'global' && !doc.parts.some(p => getDef(p.type).isParam && Object.entries(p.props).some(([k, val]) => k.startsWith('NAME') && val.trim().toLowerCase() === ps.name.trim().toLowerCase())))
    return fail(`Parametric: global parameter "${ps.name}" is not defined — place a PARAMETERS block (part PARAM) and declare it`);
  const steps: SimStep[] = [];
  let log = '', deck = '', elapsed = 0;
  for (let i = 0; i < values.length; i++) {
    if (signal?.aborted) return { result: { ok: false, plots: [], log, errors: ['Simulation cancelled'], elapsedMs: elapsed, steps }, deck };
    const v = values[i], label = stepLabel(ps, v);
    onProgress?.(i + 1, values.length, label);
    let d = doc;
    if (ps.varType === 'source') {
      d = { ...doc, parts: doc.parts.map(p => {
        if (p.ref.toUpperCase() !== ps.name.trim().toUpperCase()) return p;
        const key = getDef(p.type).valueProp ?? 'DC';
        return { ...p, props: { ...p.props, [key]: String(v) } };
      }) };
    }
    const run = await runSchematic(d, engine, signal, {
      paramOverrides: ps.varType === 'global' ? new Map([[ps.name.trim().toLowerCase(), v]]) : undefined,
      temp: ps.varType === 'temp' ? v : undefined,
    });
    steps.push({ label, value: v, ok: run.result.ok, plots: run.result.plots, errors: run.result.errors,
      sweep: { kind: ps.varType === 'global' ? 'param' : ps.varType, name: ps.varType === 'temp' ? 'TEMP' : ps.name.trim() },
      temp: ps.varType === 'temp' ? v : 27, time: Date.now(), deck: run.deck });
    log += `\n===== Run ${i + 1}/${values.length}: ${label} =====\n${run.result.log}`;
    deck += `* ===== Run ${i + 1}/${values.length}: ${label} =====\n${run.deck}\n`;
    elapsed += run.result.elapsedMs;
  }
  const first = steps.find(s => s.ok);
  const errors = steps.filter(s => !s.ok).map(s => `${s.label}: ${s.errors[0] ?? 'failed'}`);
  return { result: { ok: !!first, plots: first?.plots ?? [], log, errors, elapsedMs: elapsed, steps }, deck };
}
