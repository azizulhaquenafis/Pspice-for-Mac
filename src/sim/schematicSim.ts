// Runs a schematic through the engine. Shared by the GUI and the test suite.
//
// PSpice semantics for IC= on capacitors/inductors (without "Skip initial transient solution"):
// the bias point is computed with each C(IC) held at its voltage and each L(IC) at its current,
// and the transient starts from that state. ngspice ignores device IC= unless UIC is used, so:
//   pass 1: .op with C(IC) -> V source (+1 mΩ) and L(IC) -> I source
//   pass 2: transient with UIC and explicit IC= for every C and L taken from pass 1.
import { SchematicDoc } from '../core/model';
import { generateNetlist, NetlistResult, NetlistOptions } from '../core/netlist';
import { SimulationEngine, SimResult, getVector } from './types';

export interface SchematicRun { result: SimResult; netlist: NetlistResult; deck: string }

export async function runSchematic(doc: SchematicDoc, engine: SimulationEngine, signal?: AbortSignal, base: NetlistOptions = {}): Promise<SchematicRun> {
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
