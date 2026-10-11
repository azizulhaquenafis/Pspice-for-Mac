// Picks the simulation backend:
//  * ?engine=wasm / ?engine=native in the URL, or localStorage "openspice.engine", force a choice;
//  * otherwise the native local service when it answers (npm run dev on a machine with ngspice),
//    else ngspice-WebAssembly in the browser (production / Vercel / any static host).
// If the native service disappears mid-session, it falls back to WebAssembly instead of failing.
import { SimulationEngine, SimResult } from './types';
import { LocalNgspiceEngine, ServiceUnavailable } from './httpEngine';
import { WasmNgspiceEngine } from './wasmEngine';

export class AutoEngine implements SimulationEngine {
  private chosen: SimulationEngine | null = null;
  private choosing: Promise<SimulationEngine> | null = null;
  private wasm: WasmNgspiceEngine | null = null;
  get name() { return this.chosen?.name ?? 'ngspice'; }

  private getWasm() { return (this.wasm ??= new WasmNgspiceEngine()); }

  private preference(): 'native' | 'wasm' | null {
    try {
      const q = new URLSearchParams(location.search).get('engine') ?? localStorage.getItem('openspice.engine');
      return q === 'native' || q === 'wasm' ? q : null;
    } catch { return null; }
  }

  choose(): Promise<SimulationEngine> {
    this.choosing ??= (async () => {
      const pref = this.preference();
      if (pref === 'wasm') return (this.chosen = this.getWasm());
      if (pref === 'native' || await LocalNgspiceEngine.available()) return (this.chosen = new LocalNgspiceEngine());
      const w = this.getWasm(); w.warm();
      return (this.chosen = w);
    })();
    return this.choosing;
  }

  async run(netlist: string, signal?: AbortSignal): Promise<SimResult> {
    const e = await this.choose();
    // cancelled while the backend was being chosen
    if (signal?.aborted) return { ok: false, plots: [], log: '', errors: ['Simulation cancelled'], elapsedMs: 0 };
    try {
      return await e.run(netlist, signal);
    } catch (err) {
      if (err instanceof ServiceUnavailable && e !== this.wasm) {
        this.chosen = this.getWasm(); this.choosing = Promise.resolve(this.chosen);
        const r = await this.chosen.run(netlist, signal);
        return { ...r, errors: r.errors, log: `[${err.message} Using ngspice-WebAssembly instead.]\n${r.log}` };
      }
      return { ok: false, plots: [], log: '', errors: [`Simulation engine error: ${(err as Error).message}`], elapsedMs: 0 };
    }
  }
}
