// Browser engine: ngspice-WebAssembly in a Web Worker. Works on any static host (Vercel) — nothing runs
// on a server and nothing needs to be installed on the visitor's computer.
import { SimulationEngine, SimResult } from './types';

export class WasmNgspiceEngine implements SimulationEngine {
  readonly name = 'ngspice (WebAssembly, in your browser)';
  private worker: Worker | null = null;
  private seq = 0;

  private getWorker(): Worker {
    this.worker ??= new Worker(new URL('./wasmWorker.ts', import.meta.url), { type: 'module' });
    return this.worker;
  }
  /** Start loading the engine early (it is a large download the first time). */
  warm() { const w = this.getWorker(); w.postMessage({ id: -1, warm: true }); }

  run(netlist: string, signal?: AbortSignal): Promise<SimResult> {
    const t0 = performance.now();
    const fail = (msg: string): SimResult => ({ ok: false, plots: [], log: '', errors: [msg], elapsedMs: performance.now() - t0 });
    if (signal?.aborted) return Promise.resolve(fail('Simulation cancelled'));
    return new Promise(resolve => {
      let w: Worker;
      try { w = this.getWorker(); } catch (e) { resolve(fail(`Cannot start the WebAssembly simulator: ${(e as Error).message}`)); return; }
      const id = ++this.seq;
      const kill = (msg: string) => { w.terminate(); if (this.worker === w) this.worker = null; cleanup(); resolve(fail(msg)); };
      const timer = setTimeout(() => kill('Simulation timed out after 120 s (the circuit may be too large or not converging)'), 120_000);
      const onAbort = () => kill('Simulation cancelled');
      const onMsg = (e: MessageEvent) => {
        if (e.data?.id !== id) return;
        cleanup();
        resolve(e.data.error ? fail(`WebAssembly simulator error: ${e.data.error}`) : e.data.result as SimResult);
      };
      const onErr = (e: ErrorEvent) => kill(`WebAssembly simulator crashed: ${e.message || 'unknown error'}`);
      const cleanup = () => { clearTimeout(timer); w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); signal?.removeEventListener('abort', onAbort); };
      w.addEventListener('message', onMsg);
      w.addEventListener('error', onErr);
      signal?.addEventListener('abort', onAbort);
      w.postMessage({ id, netlist });
    });
  }
}
