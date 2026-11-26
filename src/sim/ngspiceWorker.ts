// Dedicated Web Worker hosting the ngspice-46 WebAssembly simulation engine.
// Keeps all computationally intensive circuit simulation completely off the main UI thread.

import { getWasmCompileMs, isWasmCompiled, runNgspiceWasm, warmupWasm } from './wasmCore';
import { formatEngineError } from './deckBuilder';
import { SimResult } from './types';

export type WorkerRequest =
  | { type: 'warmup'; id: number }
  | { type: 'run'; id: number; netlist: string };

export type WorkerResponse =
  | { type: 'ready'; id: number; initMs: number }
  | { type: 'status'; id: number; phase: 'initializing' | 'running'; initMs?: number }
  | { type: 'result'; id: number; result: SimResult; initMs?: number };

function collectTransferables(result: SimResult): Transferable[] {
  const seen = new Set<ArrayBuffer>();
  for (const plot of result.plots) {
    for (const vec of plot.vectors) {
      if (vec.re.buffer instanceof ArrayBuffer) seen.add(vec.re.buffer);
      if (vec.im?.buffer instanceof ArrayBuffer) seen.add(vec.im.buffer);
    }
  }
  return [...seen];
}

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

workerScope.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === 'warmup') {
    try {
      const initMs = await warmupWasm();
      workerScope.postMessage({ type: 'ready', id: msg.id, initMs });
    } catch (err) {
      workerScope.postMessage({
        type: 'result',
        id: msg.id,
        result: {
          ok: false,
          plots: [],
          log: '',
          errors: [formatEngineError(err)],
          elapsedMs: 0,
        },
      });
    }
    return;
  }

  if (msg.type === 'run') {
    const t0 = performance.now();
    try {
      let initMs = getWasmCompileMs() ?? undefined;
      if (!isWasmCompiled()) {
        workerScope.postMessage({ type: 'status', id: msg.id, phase: 'initializing' });
        initMs = await warmupWasm();
      }
      workerScope.postMessage({ type: 'status', id: msg.id, phase: 'running', initMs });
      const result = await runNgspiceWasm(msg.netlist);
      const transfer = collectTransferables(result);
      workerScope.postMessage({ type: 'result', id: msg.id, result, initMs }, transfer);
    } catch (err) {
      workerScope.postMessage({
        type: 'result',
        id: msg.id,
        result: {
          ok: false,
          plots: [],
          log: '',
          errors: [formatEngineError(err)],
          elapsedMs: performance.now() - t0,
        },
      });
    }
  }
};
