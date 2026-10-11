// Sweeps that run one bias point per value (DC sweep of a global parameter, parametric / .STEP with only
// the bias point) are assembled into a DC-style plot: x = swept value, one vector per signal, so Probe
// can draw e.g. W(RL) against RL for maximum power transfer. Every number comes from an ngspice run.
import { Plot } from './types';

export function combineOpPlots(points: { value: number; plot: Plot | undefined }[], title: string, xLabel: string, xUnit = ''): Plot | null {
  const ok = points.filter(p => p.plot && p.plot.kind === 'op');
  if (ok.length < 2) return null;
  const names = ok[0].plot!.vectors.map(v => v.name);
  const col = (name: string) => Float64Array.from(ok, p => p.plot!.vectors.find(v => v.name === name)?.re[0] ?? NaN);
  return {
    title, kind: 'dc', complex: false, xLabel, xUnit,
    vectors: [{ name: `${xLabel}-sweep`, type: 'sweep', re: Float64Array.from(ok, p => p.value) }, ...names.map(n => ({ name: n, type: 'op', re: col(n) }))],
  };
}
