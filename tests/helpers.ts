import { runSchematic } from '../src/sim/schematicSim';
import { NodeNgspiceEngine } from '../src/sim/nodeEngine';
import { NodeWasmEngine } from '../src/sim/nodeWasmEngine';
import { getVector, Plot } from '../src/sim/types';
import { SchematicDoc } from '../src/core/model';
export { Builder, divider, stepSeries, rcLowpass, switchedRL } from '../src/core/examples';

/** OPENSPICE_ENGINE=wasm runs the whole suite on ngspice-WebAssembly (the production backend). */
export const engine = process.env.OPENSPICE_ENGINE === 'wasm' ? new NodeWasmEngine() : new NodeNgspiceEngine();

/** Same path as the GUI: runSchematic (incl. PSpice-style IC handling) on real ngspice. */
export async function simulate(doc: SchematicDoc): Promise<Plot[]> {
  const run = await runSchematic(doc, engine);
  if (!run.result.ok) throw new Error(run.result.errors.join('; ') + '\n' + run.deck);
  return run.result.plots;
}

export function vec(plots: Plot[], kind: string, name: string): Float64Array {
  const p = plots.find(p => p.kind === kind)!;
  const v = getVector(p, name);
  if (!v) throw new Error(`No vector ${name} in ${kind}: ${p.vectors.map(v => v.name).join(',')}`);
  return v.re;
}

/** Linear interpolation of y at x. */
export function at(xs: Float64Array, ys: Float64Array, x: number): number {
  for (let i = 1; i < xs.length; i++) if (xs[i] >= x) {
    const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + f * (ys[i] - ys[i - 1]);
  }
  return ys[ys.length - 1];
}

