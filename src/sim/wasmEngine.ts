// Main-thread simulation engine adapter delegating ngspice WASM execution to a dedicated Web Worker.
//
// Features:
// - Lazy worker creation and reuse across simulations.
// - Serialized requests with monotonic request IDs to prevent stale results.
// - Immediate cancellation both while queued and while running (terminating worker + auto-recovery).
// - Timeout enforcement (default 30s) via worker termination + auto-recovery.
// - Browser WebAssembly/Worker compatibility detection and lightweight read-only diagnostics.

import { SimulationEngine, SimResult } from './types';
import { formatEngineError } from './deckBuilder';
import type { WorkerRequest, WorkerResponse } from './ngspiceWorker';

export interface WorkerLike {
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  onmessageerror?: ((ev: MessageEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export interface WasmEngineOptions {
  /** Per-run timeout in milliseconds (default: 30000). */
  timeoutMs?: number;
  /** Optional status callback for non-intrusive engine lifecycle feedback (e.g. WASM init). */
  onStatus?: (message: string) => void;
  /** Optional custom worker factory (for testing or custom bundling). */
  workerFactory?: () => WorkerLike;
}

export type EngineInitState = 'idle' | 'initializing' | 'ready' | 'error';

export interface EngineDiagnostics {
  engineName: string;
  ngspiceVersion: string;
  state: EngineInitState;
  initMs: number | null;
  lastRunMs: number | null;
  totalRuns: number;
  workerRestarts: number;
  lastError: string | null;
  browserSupport: {
    webAssembly: boolean;
    webWorker: boolean;
    streamingCompile: boolean;
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;

function detectBrowserSupport(): EngineDiagnostics['browserSupport'] {
  const webAssembly = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  const webWorker = typeof Worker === 'function';
  const streamingCompile = webAssembly && typeof WebAssembly.compileStreaming === 'function';
  return { webAssembly, webWorker, streamingCompile };
}

export class WasmNgspiceEngine implements SimulationEngine {
  readonly name = 'ngspice 46 (WebAssembly)';

  private worker: WorkerLike | null = null;
  private nextId = 1;
  private queue: Promise<void> = Promise.resolve();
  private readonly timeoutMs: number;
  private readonly onStatus?: (message: string) => void;
  private readonly hasCustomFactory: boolean;
  private readonly workerFactory: () => WorkerLike;

  // Lightweight local diagnostics (no external telemetry)
  private state: EngineInitState = 'idle';
  private initMs: number | null = null;
  private lastRunMs: number | null = null;
  private totalRuns = 0;
  private workerRestarts = 0;
  private lastError: string | null = null;

  constructor(options: WasmEngineOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onStatus = options.onStatus;
    this.hasCustomFactory = Boolean(options.workerFactory);
    this.workerFactory =
      options.workerFactory ??
      (() => new Worker(new URL('./ngspiceWorker.ts', import.meta.url), { type: 'module' }));
  }

  getDiagnostics(): EngineDiagnostics {
    return {
      engineName: this.name,
      ngspiceVersion: 'ngspice-46 (@o.z/ngspice-wasm@0.0.0)',
      state: this.state,
      initMs: this.initMs,
      lastRunMs: this.lastRunMs,
      totalRuns: this.totalRuns,
      workerRestarts: this.workerRestarts,
      lastError: this.lastError,
      browserSupport: detectBrowserSupport(),
    };
  }

  private ensureWorker(): WorkerLike {
    if (!this.worker) {
      if (!this.hasCustomFactory) {
        const sup = detectBrowserSupport();
        if (!sup.webAssembly) {
          throw new Error('This browser does not support WebAssembly, which is required to run ngspice locally.');
        }
        if (!sup.webWorker) {
          throw new Error('This browser does not support Web Workers, which are required for circuit simulation.');
        }
      }
      this.worker = this.workerFactory();
    }
    return this.worker;
  }

  private terminateWorker(countAsRestart = false): void {
    if (this.worker) {
      try {
        this.worker.onmessage = null;
        this.worker.onerror = null;
        if ('onmessageerror' in this.worker) this.worker.onmessageerror = null;
        this.worker.terminate();
      } catch {
        // ignore termination errors on already-dead workers
      }
      this.worker = null;
      if (countAsRestart) this.workerRestarts++;
    }
  }

  /** Terminate the underlying Web Worker immediately (it will be recreated lazily on next run). */
  dispose(): void {
    this.terminateWorker(false);
    this.state = 'idle';
  }

  run(netlist: string, signal?: AbortSignal): Promise<SimResult> {
    if (signal?.aborted) {
      return Promise.resolve({
        ok: false,
        plots: [],
        log: '',
        errors: ['Simulation cancelled'],
        elapsedMs: 0,
      });
    }

    // If a queued call is aborted before it reaches the head of the queue, resolve cancelled immediately.
    const waitTurn = signal
      ? new Promise<'ready' | 'aborted'>(resolve => {
          let done = false;
          const onAbort = () => {
            if (done) return;
            done = true;
            resolve('aborted');
          };
          signal.addEventListener('abort', onAbort, { once: true });
          this.queue.then(() => {
            if (done) return;
            done = true;
            signal.removeEventListener('abort', onAbort);
            resolve('ready');
          });
        })
      : this.queue.then(() => 'ready' as const);

    const exec = waitTurn.then(turn => {
      if (turn === 'aborted' || signal?.aborted) {
        return {
          ok: false,
          plots: [],
          log: '',
          errors: ['Simulation cancelled'],
          elapsedMs: 0,
        };
      }
      return this.runOnce(netlist, signal);
    });

    this.queue = exec.then(
      () => undefined,
      () => undefined,
    );
    return exec;
  }

  private runOnce(netlist: string, signal?: AbortSignal): Promise<SimResult> {
    const t0 = performance.now();
    if (signal?.aborted) {
      return Promise.resolve({
        ok: false,
        plots: [],
        log: '',
        errors: ['Simulation cancelled'],
        elapsedMs: 0,
      });
    }

    const requestId = this.nextId++;

    let worker: WorkerLike;
    try {
      worker = this.ensureWorker();
    } catch (err) {
      const msg = formatEngineError(err);
      this.state = 'error';
      this.lastError = msg;
      return Promise.resolve({
        ok: false,
        plots: [],
        log: '',
        errors: [msg],
        elapsedMs: performance.now() - t0,
      });
    }

    return new Promise<SimResult>(resolve => {
      let settled = false;

      const finish = (result: SimResult, killWorker = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.totalRuns++;
        this.lastRunMs = result.elapsedMs;
        if (!result.ok && result.errors.length) {
          this.lastError = result.errors[0];
        } else if (result.ok) {
          this.lastError = null;
        }
        if (killWorker) {
          this.terminateWorker(true);
          this.state = result.errors[0]?.includes('cancelled') ? 'idle' : 'error';
        } else if (this.worker === worker) {
          worker.onmessage = null;
          worker.onerror = null;
          if ('onmessageerror' in worker) worker.onmessageerror = null;
        }
        resolve(result);
      };

      const onAbort = () => {
        finish(
          {
            ok: false,
            plots: [],
            log: '',
            errors: ['Simulation cancelled'],
            elapsedMs: performance.now() - t0,
          },
          true,
        );
      };

      const timer = setTimeout(() => {
        const secs = this.timeoutMs >= 1000 ? `${+(this.timeoutMs / 1000).toFixed(1)}s` : `${this.timeoutMs}ms`;
        finish(
          {
            ok: false,
            plots: [],
            log: '',
            errors: [`Simulation timed out after ${secs}. Worker terminated and reset.`],
            elapsedMs: performance.now() - t0,
          },
          true,
        );
      }, this.timeoutMs);

      signal?.addEventListener('abort', onAbort, { once: true });

      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        // Ignore stale messages belonging to previous/cancelled requests.
        if (!msg || msg.id !== requestId) return;

        if (msg.type === 'status') {
          if (msg.phase === 'initializing') {
            this.state = 'initializing';
            this.onStatus?.('Initializing ngspice WebAssembly engine…');
          } else if (msg.phase === 'running') {
            this.state = 'ready';
            if (typeof msg.initMs === 'number') this.initMs = msg.initMs;
            this.onStatus?.(`Simulating with ${this.name}…`);
          }
          return;
        }

        if (msg.type === 'result') {
          if (typeof msg.initMs === 'number') this.initMs = msg.initMs;
          const r = msg.result;
          const validPlots = Array.isArray(r.plots) && r.plots.length > 0;
          if (r.ok && validPlots) this.state = 'ready';
          finish({
            ...r,
            ok: Boolean(r.ok && validPlots),
            elapsedMs: performance.now() - t0,
          });
        }
      };

      worker.onerror = (ev: ErrorEvent) => {
        const detail = ev?.message || 'Web Worker crashed unexpectedly';
        finish(
          {
            ok: false,
            plots: [],
            log: '',
            errors: [`Simulation worker error: ${formatEngineError(detail)}`],
            elapsedMs: performance.now() - t0,
          },
          true,
        );
      };

      if ('onmessageerror' in worker) {
        worker.onmessageerror = () => {
          finish(
            {
              ok: false,
              plots: [],
              log: '',
              errors: ['Simulation worker failed to deserialize simulation output'],
              elapsedMs: performance.now() - t0,
            },
            true,
          );
        };
      }

      try {
        worker.postMessage({ type: 'run', id: requestId, netlist });
      } catch (err) {
        finish(
          {
            ok: false,
            plots: [],
            log: '',
            errors: [`Failed to dispatch simulation to Web Worker: ${formatEngineError(err)}`],
            elapsedMs: performance.now() - t0,
          },
          true,
        );
      }
    });
  }
}
