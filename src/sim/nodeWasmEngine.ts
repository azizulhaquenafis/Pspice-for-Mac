// The WebAssembly engine without a worker, for the Node test suite (OPENSPICE_ENGINE=wasm npm test).
import { WasmNgspice } from './wasmCore';
import { SimulationEngine, SimResult } from './types';

export class NodeWasmEngine implements SimulationEngine {
  readonly name = 'ngspice (WebAssembly, node)';
  private core = new WasmNgspice(() => import('eecircuit-engine'));
  run(netlist: string, signal?: AbortSignal): Promise<SimResult> {
    if (signal?.aborted) return Promise.resolve({ ok: false, plots: [], log: '', errors: ['Simulation cancelled'], elapsedMs: 0 });
    return this.core.run(netlist);
  }
}
