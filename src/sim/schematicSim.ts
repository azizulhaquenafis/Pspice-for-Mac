// Runs a schematic through the engine. Shared by the GUI and the test suite.
//
// PSpice semantics for IC= on capacitors/inductors (without "Skip initial transient solution"):
// the bias point is computed with each C(IC) held at its voltage and each L(IC) at its current,
// and the transient starts from that state. ngspice ignores device IC= unless UIC is used, so:
//   pass 1: .op with C(IC) -> V source (+1 mΩ) and L(IC) -> I source
//   pass 2: transient with UIC and explicit IC= for every C and L taken from pass 1.
import { SchematicDoc } from '../core/model';
import { generateNetlist, NetlistResult, NetlistOptions, steppedDc } from '../core/netlist';
import { getDef } from '../core/library';
import { sweepValues, MAX_DC_POINTS } from '../core/sweep';
import { formatEng } from '../core/units';
import { combineOpPlots } from './sweepPlot';
import { SimulationEngine, SimResult, getVector } from './types';

export interface SchematicRun { result: SimResult; netlist: NetlistResult; deck: string }

export async function runSchematic(doc: SchematicDoc, engine: SimulationEngine, signal?: AbortSignal, base: NetlistOptions = {}): Promise<SchematicRun> {
  if (doc.profile.dc.enabled && steppedDc(doc.profile.dc)) return runSteppedDc(doc, engine, signal, base);
  return runOnce(doc, engine, signal, base);
}

/** Unit of a global parameter, from the property it sets ({RL} as a resistor VALUE → Ω). */
export function paramUnit(doc: SchematicDoc, name: string): string {
  const n = name.trim().toLowerCase();
  for (const p of doc.parts) for (const pd of getDef(p.type).props)
    if ((p.props[pd.name] ?? '').replace(/\s/g, '').toLowerCase() === `{${n}}`) return pd.unit ?? '';
  return '';
}

/**
 * DC sweep of a global parameter (PSpice "Global Parameter"), or an octave/decade/list DC sweep: one bias
 * point per value (ngspice .dc cannot sweep a .param), assembled into a DC plot. Other enabled analyses
 * run once at the PARAMETERS value, as in PSpice.
 */
async function runSteppedDc(doc: SchematicDoc, engine: SimulationEngine, signal: AbortSignal | undefined, base: NetlistOptions): Promise<SchematicRun> {
  const d = doc.profile.dc, vt = d.varType ?? 'source', name = d.source.trim();
  const main = await runOnce(doc, engine, signal, base);       // validates; .op (+ tran/ac) at nominal values
  if (!main.result.ok) return main;
  const { values, error } = sweepValues({ sweep: d.sweep ?? 'lin', start: d.start, end: d.end, incr: d.incr, values: d.values ?? '' }, MAX_DC_POINTS);
  if (error) return { ...main, result: { ...main.result, ok: false, errors: [`DC Sweep: ${error}`] } };
  const opOnly: SchematicDoc = { ...doc, profile: { ...doc.profile, dc: { ...d, enabled: false }, tran: { ...doc.profile.tran, enabled: false }, ac: { ...doc.profile.ac, enabled: false } } };
  const points: { value: number; plot: SimResult['plots'][number] | undefined }[] = [];
  let log = main.result.log, elapsed = main.result.elapsedMs;
  for (const v of values) {
    if (signal?.aborted) return { ...main, result: { ...main.result, ok: false, errors: ['Simulation cancelled'] } };
    let dv = opOnly;
    if (vt === 'source') dv = { ...opOnly, parts: opOnly.parts.map(p => p.ref.toUpperCase() !== name.toUpperCase() ? p
      : { ...p, props: { ...p.props, [getDef(p.type).props.some(q => q.name === 'DC') ? 'DC' : getDef(p.type).valueProp ?? 'DC']: String(v) } }) };
    const overrides = new Map(base.paramOverrides ?? []);
    if (vt === 'global') overrides.set(name.toLowerCase(), v);
    const r = await runOnce(dv, engine, signal, { ...base, paramOverrides: overrides, temp: vt === 'temp' ? v : base.temp });
    const label = `${vt === 'temp' ? 'TEMP' : name} = ${formatEng(v, 5)}`;
    if (!r.result.ok) return { ...main, result: { ...main.result, ok: false, errors: [`DC Sweep at ${label}: ${r.result.errors[0] ?? 'failed'}`] } };
    points.push({ value: v, plot: r.result.plots.find(p => p.kind === 'op') });
    log += `\n===== DC sweep ${label} =====\n${r.result.log}`; elapsed += r.result.elapsedMs;
  }
  const xLabel = vt === 'temp' ? 'TEMP' : vt === 'global' ? name : `${/^I/i.test(name) ? 'I' : 'V'}_${name.toUpperCase()}`;
  const unit = vt === 'temp' ? '°C' : vt === 'global' ? paramUnit(doc, name) : /^I/i.test(name) ? 'A' : 'V';
  const plot = combineOpPlots(points, `DC Sweep of ${xLabel} (${values.length} bias points)`, xLabel, unit);
  const plots = plot ? [...main.result.plots, plot] : main.result.plots;
  const deck = `${main.deck}* DC sweep of ${xLabel}: ${values.length} bias-point runs (${formatEng(values[0], 5)} … ${formatEng(values[values.length - 1], 5)})\n`;
  return { ...main, result: { ...main.result, plots, log, elapsedMs: elapsed }, deck };
}

async function runOnce(doc: SchematicDoc, engine: SimulationEngine, signal: AbortSignal | undefined, base: NetlistOptions): Promise<SchematicRun> {
  const nl = generateNetlist(doc, base);
  const fail = (errors: string[], deck = nl.text): SchematicRun =>
    ({ result: { ok: false, plots: [], log: '', errors, elapsedMs: 0 }, netlist: nl, deck });
  if (!nl.ok) return fail(nl.diagnostics.filter(d => d.level === 'error').map(d => d.message));
  if (!nl.needsIcPass) return { result: await engine.run(nl.text, signal), netlist: nl, deck: nl.text };

  const p1 = generateNetlist(doc, { ...base, icPass: true });
  const r1 = await engine.run(p1.text, signal);
  const op = r1.plots.find(p => p.kind === 'op');
  if (!r1.ok || !op) return { result: { ...r1, ok: false, errors: ['Bias point with initial conditions failed', ...r1.errors] }, netlist: nl, deck: p1.text };
  const volt = (n: string) => n === '0' ? 0 : getVector(op, `v(${n})`)?.re[0];
  const state = new Map<string, number>();
  for (const r of nl.reactive) {
    if (r.ic !== null) { state.set(r.partId, r.ic); continue; }
    const v = r.kind === 'C'
      ? (volt(r.nodes[0]) ?? NaN) - (volt(r.nodes[1]) ?? NaN)
      : getVector(op, `i(@${r.name.toLowerCase()}[i])`)?.re[0] ?? NaN;
    if (!isFinite(v)) return fail([`Could not determine initial state of ${r.name} from the bias point`], p1.text);
    state.set(r.partId, v);
  }
  const p2 = generateNetlist(doc, { ...base, initialState: state });
  const r2 = await engine.run(p2.text, signal);
  // Bias-point display uses the IC-constrained bias point, as PSpice does.
  const result: SimResult = { ...r2, plots: [op, ...r2.plots.filter(p => p.kind !== 'op')], log: r1.log + '\n' + r2.log, elapsedMs: r1.elapsedMs + r2.elapsedMs };
  return { result, netlist: nl, deck: `${p1.text}\n${p2.text}` };
}
