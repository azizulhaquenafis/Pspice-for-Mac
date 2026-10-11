// Web Worker hosting ngspice-WebAssembly, so simulations never freeze the editor.
import { WasmNgspice } from './wasmCore';

const core = new WasmNgspice(() => import('eecircuit-engine'));

self.onmessage = async (e: MessageEvent<{ id: number; netlist?: string; warm?: boolean }>) => {
  const { id, netlist, warm } = e.data;
  try {
    if (warm) { await core.init(); (self as unknown as Worker).postMessage({ id, ready: true }); return; }
    const result = await core.run(netlist ?? '');
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
