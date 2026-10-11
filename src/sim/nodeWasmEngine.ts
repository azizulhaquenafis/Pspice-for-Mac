// The WebAssembly engine without a worker, for the Node test suite (OPENSPICE_ENGINE=wasm npm test).
import { WasmNgspice } from './wasmCore';
import { SimulationEngine, SimResult } from './types';

export class NodeWasmEngine implements SimulationEngine {
  readonly name = 'ngspice (WebAssembly, node)';
  private core = new WasmNgspice(() => import('eecircuit-engine'));
  run(netlist: string): Promise<SimResult> { return this.core.run(netlist); }
}
