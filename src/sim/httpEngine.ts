// Browser-side engine: sends the netlist to the local ngspice service.
import { SimulationEngine, SimResult } from './types';
import { parseRawAscii } from './rawParser';

export class LocalNgspiceEngine implements SimulationEngine {
  readonly name = 'ngspice (local native)';
  async run(netlist: string, signal?: AbortSignal): Promise<SimResult> {
    const t0 = performance.now();
    try {
      const r = await fetch('/api/simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ netlist }), signal,
      });
      const out = await r.json();
      const plots = out.raw ? parseRawAscii(out.raw) : [];
      return { ok: !!out.ok && plots.length > 0, plots, log: out.log ?? '', errors: out.errors ?? [], elapsedMs: performance.now() - t0 };
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? 'Simulation cancelled' : `Simulation service unreachable: ${(e as Error).message}`;
      return { ok: false, plots: [], log: '', errors: [msg], elapsedMs: performance.now() - t0 };
    }
  }
}
