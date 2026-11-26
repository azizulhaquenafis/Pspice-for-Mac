// Client-side ngspice WebAssembly runner powered by @o.z/ngspice-wasm (ngspice-46).
// Runs inside a dedicated Web Worker in the browser, and directly in Node.js for tests.
//
// Design:
// - In browser builds, streams and compiles the separate hashed `ngspice-46-*.wasm` asset ONCE
//   via `WebAssembly.compileStreaming(fetch(wasmUrl))` and caches the compiled `WebAssembly.Module`.
// - Each simulation pass instantiates a clean `WebAssembly.Instance` from the cached module
//   (~1–2 ms) with a fresh in-memory filesystem (MEMFS) and clean global C state, guaranteeing
//   zero state leakage between runs (.option interp, .temp, .param, previous plots).
// - Reuses the exact same .control + ASCII rawfile + AC zero-volt sensing pipeline
//   (deckBuilder + parseRawAscii + normalizePlots) as the native ngspice reference runner.

import createNgspiceModule, { NgspiceModule, NgspiceModuleOptions } from '@o.z/ngspice-wasm';
import wasmAssetUrl from 'virtual:ngspice-wasm-url';
import { buildDecks, extractNgspiceErrors, formatEngineError, normalizePlots } from './deckBuilder';
import { parseRawAscii } from './rawParser';
import { Plot, SimResult, SimulationEngine } from './types';

export const WASM_NGSPICE_VERSION = 'ngspice-46';

// Safety bounds preventing runaway logs or rawfiles from exhausting browser memory.
export const MAX_LOG_CHARS = 512_000;
export const MAX_RAW_CHARS = 64_000_000;

// Emscripten MEMFS /proc/meminfo stub: ngspice reads /proc/meminfo before allocating
// output vectors; without it, ngspice aborts with "Setting the output memory is not possible."
const MEMINFO_STUB =
  'MemTotal: 2097152 kB\nMemFree: 2097152 kB\nMemAvailable: 2097152 kB\n';
const SPINIT_STUB = '* OpenSpice ngspice initialization\n';

let cachedWasmModule: WebAssembly.Module | null = null;
let compilingPromise: Promise<WebAssembly.Module | null> | null = null;
let lastCompileMs: number | null = null;

export function isWasmCompiled(): boolean {
  return cachedWasmModule !== null;
}

export function getWasmCompileMs(): number | null {
  return lastCompileMs;
}

/**
 * Compile the split ngspice-46 `.wasm` asset via streaming compilation when running in a browser.
 * Validates HTTP status, content type (catching accidental HTML SPA fallbacks), and WASM magic bytes.
 */
async function compileSplitWasmAsset(url: string): Promise<WebAssembly.Module> {
  const t0 = performance.now();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ngspice WASM binary (${response.status} ${response.statusText}) from ${url}`);
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(`WASM asset request (${url}) returned HTML instead of WebAssembly binary (check SPA rewrite rules)`);
  }

  let mod: WebAssembly.Module;
  if (typeof WebAssembly.compileStreaming === 'function' && contentType.includes('application/wasm')) {
    try {
      mod = await WebAssembly.compileStreaming(response.clone());
    } catch {
      const bytes = new Uint8Array(await response.arrayBuffer());
      assertWasmMagic(bytes, url);
      mod = await WebAssembly.compile(bytes);
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertWasmMagic(bytes, url);
    mod = await WebAssembly.compile(bytes);
  }
  lastCompileMs = Math.round(performance.now() - t0);
  return mod;
}

function assertWasmMagic(bytes: Uint8Array, url: string): void {
  if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`Invalid WebAssembly binary from ${url} (missing \\0asm magic header)`);
  }
}

/** Ensure the WebAssembly.Module is compiled and cached once. */
async function ensureWasmModule(): Promise<WebAssembly.Module | null> {
  if (cachedWasmModule) return cachedWasmModule;
  if (!wasmAssetUrl) return null; // Node/Vitest path: captured on first createNgspiceModule call
  if (!compilingPromise) {
    compilingPromise = compileSplitWasmAsset(wasmAssetUrl)
      .then(mod => {
        cachedWasmModule = mod;
        return mod;
      })
      .finally(() => {
        compilingPromise = null;
      });
  }
  return compilingPromise;
}

/**
 * Instantiate a fresh ngspice-46 Emscripten module from the cached WebAssembly.Module.
 */
async function createFreshModule(
  onStdout: (line: string) => void,
  onStderr: (line: string) => void,
): Promise<NgspiceModule> {
  if (wasmAssetUrl) {
    await ensureWasmModule();
  } else if (!cachedWasmModule && compilingPromise) {
    await compilingPromise;
  }

  let abortReason: unknown = null;
  let rejectInstantiation: ((err: unknown) => void) | null = null;
  const instFail = new Promise<never>((_resolve, reject) => {
    rejectInstantiation = reject;
  });
  instFail.catch(() => {});

  const opts: NgspiceModuleOptions = {
    noInitialRun: true,
    print: onStdout,
    printErr: onStderr,
    onAbort: (reason: unknown) => {
      abortReason = reason;
      rejectInstantiation?.(new Error(String(reason ?? 'ngspice WebAssembly aborted')));
    },
    preRun: [
      (mod: NgspiceModule) => {
        if (mod.ENV) mod.ENV.SPICE_SCRIPTS = '/';
      },
    ],
  };

  if (cachedWasmModule) {
    const mod = cachedWasmModule;
    opts.instantiateWasm = (
      imports: WebAssembly.Imports,
      receiveInstance: (inst: WebAssembly.Instance, mod?: WebAssembly.Module) => void,
    ) => {
      WebAssembly.instantiate(mod, imports)
        .then(instance => receiveInstance(instance, mod))
        .catch(err => rejectInstantiation?.(err));
      return {};
    };
    const instance = await Promise.race([createNgspiceModule(opts), instFail]);
    if (abortReason) throw new Error(String(abortReason));
    return instance;
  }

  // Node/Vitest fallback when `virtual:ngspice-wasm-url` is null: capture compiled module on first run.
  let resolveCompile!: (m: WebAssembly.Module | null) => void;
  compilingPromise = new Promise<WebAssembly.Module | null>(r => {
    resolveCompile = r;
  });

  const t0 = performance.now();
  const originalInstantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = (async function (
    source: BufferSource | WebAssembly.Module,
    imports?: WebAssembly.Imports,
  ) {
    const res = await (originalInstantiate as Function).call(WebAssembly, source, imports);
    if (res && typeof res === 'object' && 'module' in res && res.module instanceof WebAssembly.Module) {
      cachedWasmModule = res.module;
      lastCompileMs = Math.round(performance.now() - t0);
    }
    return res;
  }) as typeof WebAssembly.instantiate;

  try {
    const instance = await Promise.race([createNgspiceModule(opts), instFail]);
    if (abortReason) throw new Error(String(abortReason));
    return instance;
  } finally {
    WebAssembly.instantiate = originalInstantiate;
    const mod = cachedWasmModule;
    compilingPromise = null;
    resolveCompile(mod);
  }
}

/** Invoke C `main(argc, argv)` using Emscripten's stack allocator (zero heap leaks). */
function invokeMain(mod: NgspiceModule, argv: string[]): number {
  const sp = mod.stackSave();
  try {
    const ptrs = argv.map(arg => mod.stringToUTF8OnStack(arg));
    const argvPtr = mod.stackAlloc((ptrs.length + 1) * 4);
    for (let i = 0; i < ptrs.length; i++) {
      mod.setValue(argvPtr + i * 4, ptrs[i], 'i32');
    }
    mod.setValue(argvPtr + ptrs.length * 4, 0, 'i32');
    try {
      return mod._main(ptrs.length, argvPtr);
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
        return (e as { status: number }).status;
      }
      throw e;
    }
  } finally {
    mod.stackRestore(sp);
  }
}

/** Pre-compile the ngspice WASM module without running a circuit. */
export async function warmupWasm(): Promise<number> {
  if (cachedWasmModule) return lastCompileMs ?? 0;
  const t0 = performance.now();
  if (wasmAssetUrl) {
    await ensureWasmModule();
  } else {
    await createFreshModule(() => {}, () => {});
  }
  return lastCompileMs ?? Math.round(performance.now() - t0);
}

/** Run a validated SPICE netlist through ngspice-46 WebAssembly and return OpenSpice SimResult. */
export async function runNgspiceWasm(netlist: string): Promise<SimResult> {
  const t0 = performance.now();
  const { decks, errors: buildErrors, acSenseMap } = buildDecks(netlist);
  if (buildErrors.length) {
    return { ok: false, plots: [], log: '', errors: buildErrors, elapsedMs: performance.now() - t0 };
  }

  let combinedLog = '';
  let logTruncated = false;
  let combinedRaw = '';
  let exitFailed = false;

  const appendLogLine = (line: string) => {
    if (logTruncated) return;
    if (combinedLog.length + line.length + 1 > MAX_LOG_CHARS) {
      combinedLog += '\n[Output log truncated at 512 KB limit]\n';
      logTruncated = true;
      return;
    }
    combinedLog += line + '\n';
  };

  try {
    for (const deck of decks) {
      const mod = await createFreshModule(appendLogLine, appendLogLine);

      // Prepare clean MEMFS for this pass
      try {
        mod.FS.mkdir('/proc');
      } catch {
        // /proc already exists only if created earlier
      }
      mod.FS.writeFile('/proc/meminfo', MEMINFO_STUB);
      mod.FS.writeFile('/spinit', SPINIT_STUB);
      mod.FS.writeFile('/circuit.cir', deck.replace(/__OUT__/g, '/out.raw'));

      const exitCode = invokeMain(mod, ['ngspice', '-b', '/circuit.cir']);
      if (exitCode !== 0) exitFailed = true;

      try {
        const raw = mod.FS.readFile('/out.raw', { encoding: 'utf8' });
        if (typeof raw === 'string' && raw.length > 0) {
          if (combinedRaw.length + raw.length > MAX_RAW_CHARS) {
            return {
              ok: false,
              plots: [],
              log: combinedLog,
              errors: [`Simulation output exceeded ${(MAX_RAW_CHARS / (1024 * 1024)).toFixed(0)} MB limit. Increase Print Step / Step Ceiling or reduce sweep points.`],
              elapsedMs: performance.now() - t0,
            };
          }
          combinedRaw += raw;
          if (!raw.endsWith('\n')) combinedRaw += '\n';
        }
      } catch {
        // ngspice did not produce /out.raw for this pass (error captured from log)
      }
    }
  } catch (err) {
    const msg = formatEngineError(err);
    const { errors: logErrs } = extractNgspiceErrors(combinedLog, false);
    const errors =
      logErrs.length && logErrs[0] !== 'ngspice produced no simulation results'
        ? [msg, ...logErrs]
        : [msg];
    return {
      ok: false,
      plots: [],
      log: combinedLog,
      errors,
      elapsedMs: performance.now() - t0,
    };
  }

  let plots: Plot[] = [];
  let parseError: string | null = null;
  if (combinedRaw.trim()) {
    try {
      plots = normalizePlots(parseRawAscii(combinedRaw), acSenseMap);
    } catch (e) {
      parseError = `Failed to parse ngspice output: ${(e as Error).message}`;
    }
  }

  const { errors: logErrors, fatal } = extractNgspiceErrors(combinedLog, plots.length > 0);
  const errors = parseError ? [parseError, ...logErrors] : logErrors;
  const ok = !parseError && !fatal && !exitFailed && plots.length > 0;

  if (!ok && errors.length === 0) {
    errors.push('Simulation did not produce valid results');
  }

  return {
    ok,
    plots: ok ? plots : [],
    log: combinedLog,
    errors,
    elapsedMs: performance.now() - t0,
  };
}

/**
 * Direct in-process ngspice WASM engine (no Web Worker wrapper).
 * Used in Node.js Vitest suites to test the exact same ngspice-46 WASM binary that runs in browsers.
 */
export class WasmCoreNgspiceEngine implements SimulationEngine {
  readonly name = 'ngspice 46 (WebAssembly)';

  async run(netlist: string, signal?: AbortSignal): Promise<SimResult> {
    if (signal?.aborted) {
      return { ok: false, plots: [], log: '', errors: ['Simulation cancelled'], elapsedMs: 0 };
    }
    return runNgspiceWasm(netlist);
  }
}
