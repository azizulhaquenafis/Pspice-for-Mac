// Simulation results model, independent of the engine and of presentation.

export type PlotKind = 'op' | 'tran' | 'dc' | 'ac' | 'other';
export interface Vector { name: string; type: string; re: Float64Array; im?: Float64Array }
export interface Plot { title: string; kind: PlotKind; complex: boolean; vectors: Vector[] }
/** One run of a parametric sweep. */
export interface SimStep {
  label: string; value: number; ok: boolean; plots: Plot[]; errors: string[];
  /** Swept quantity, for Probe "Section Information". */
  sweep?: { kind: 'param' | 'source' | 'temp'; name: string };
  temp?: number;     // circuit temperature of this run (°C)
  time?: number;     // wall-clock time the run finished (ms since epoch)
  deck?: string;     // netlist that produced this run
}
export interface SimResult { ok: boolean; plots: Plot[]; log: string; errors: string[]; elapsedMs: number; steps?: SimStep[]; time?: number; temp?: number }

export interface SimulationEngine {
  readonly name: string;
  run(netlist: string, signal?: AbortSignal): Promise<SimResult>;
}

export function getVector(plot: Plot, name: string): Vector | undefined {
  const n = name.toLowerCase();
  return plot.vectors.find(v => v.name.toLowerCase() === n);
}
