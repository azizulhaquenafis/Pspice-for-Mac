// ngspice compiled to WebAssembly (npm "eecircuit-engine", MIT, by the EEcircuit project).
// Used in the browser (inside a Web Worker, see wasmWorker.ts) and by the test suite in Node.
//
// eecircuit-engine runs `source test.cir; destroy all; run; write out.raw` and returns the LAST plot only,
// so every analysis of a deck is run as its own pass (body + one analysis card) and the plots are
// collected in deck order — the same plots the native runner writes to its rawfile.
import type { ResultType, Simulation as SimulationT } from 'eecircuit-engine';
import { splitDeck, bodyFor, measFilter, PLOT_TITLE, LOG_PROBLEM } from './deck';
import { Plot, SimResult, Vector } from './types';

type EngineModule = { Simulation: new () => SimulationT };
export const WASM_RUN_TIMEOUT_MS = 60_000;

/**
 * The WebAssembly build hangs on any non-ASCII character in the deck (verified: an em dash in the title
 * line), so decks are converted to plain ASCII first. Element lines are ASCII anyway; this only touches
 * titles, comments and quoted text.
 */
export function toAscii(deck: string): string {
  const map: Record<string, string> = { 'µ': 'u', 'μ': 'u', 'Ω': 'ohm', '°': 'deg', '—': '-', '–': '-', '−': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '×': 'x', '≈': '~' };
  return deck.replace(/[^\x00-\x7f]/g, c => map[c] ?? '?');
}

function toPlot(r: ResultType, kind: keyof typeof PLOT_TITLE): Plot {
  const complex = r.dataType === 'complex';
  const vectors: Vector[] = r.data.map(d => {
    if (r.dataType === 'complex') {
      const vals = d.values as { real: number; img: number }[];
      return { name: d.name, type: d.type, re: Float64Array.from(vals, v => v.real), im: Float64Array.from(vals, v => v.img) };
    }
    return { name: d.name, type: d.type, re: Float64Array.from(d.values as number[]) };
  });
  return { title: PLOT_TITLE[kind], kind, complex, vectors };
}

export class WasmNgspice {
  private sim: SimulationT | null = null;
  private ready: Promise<void> | null = null;
  constructor(private load: () => Promise<EngineModule>) {}

  init(): Promise<void> {
    this.ready ??= (async () => {
      const { Simulation } = await this.load();
      const sim = new Simulation();
      await sim.start();
      this.sim = sim;
    })();
    return this.ready;
  }

  async run(netlist: string): Promise<SimResult> {
    const t0 = Date.now();
    const { body, analyses, errors } = splitDeck(netlist);
    if (errors.length) return { ok: false, plots: [], log: '', errors, elapsedMs: 0 };
    await this.init();
    const sim = this.sim!;
    // Remove the previous output so a failed run can never return stale results.
    const fs = (sim as unknown as { __getSpiceModuleForTests(): { FS?: { unlink(p: string): void } } | null }).__getSpiceModuleForTests()?.FS;
    const plots: Plot[] = [], problems: string[] = [];
    let log = '';
    for (const a of analyses) {
      try { fs?.unlink('out.raw'); } catch { /* not there yet */ }
      const deck = [...measFilter(bodyFor(body, a.kind), a.kind), `.${a.kind}${a.args}`, '.end'].join('\n') + '\n';
      // eecircuit-engine keeps a 2,000,000-character rolling log; reset it (and the error list) per pass
      // so this pass's output is complete (relies on eecircuit-engine 1.8.0 internals — version pinned).
      const internals = sim as unknown as { info: string; error: string[] };
      internals.info = ''; internals.error = [];
      sim.setNetList(toAscii(deck));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const r = await Promise.race([
        sim.runSim(),
        new Promise<null>(res => { timer = setTimeout(() => res(null), WASM_RUN_TIMEOUT_MS); }),
      ]);
      clearTimeout(timer);
      const info = sim.getInfo();
      log += `\n----- ${PLOT_TITLE[a.kind]} -----\n${info}`;
      const errs = sim.getError();
      problems.push(...errs.filter(e => LOG_PROBLEM.test(e)), ...info.split('\n').filter(l => LOG_PROBLEM.test(l) && !errs.includes(l)));
      if (r === null) {
        // a stuck WebAssembly instance never recovers: drop it so the next run starts a fresh one
        this.sim = null; this.ready = null;
        problems.push(`${PLOT_TITLE[a.kind]}: simulation timed out after ${WASM_RUN_TIMEOUT_MS / 1000}s`); break;
      }
      if (!r.variableNames.length) { if (!errs.length) problems.push(`${PLOT_TITLE[a.kind]}: ngspice produced no results`); continue; }
      plots.push(toPlot(r, a.kind));
    }
    const uniq = [...new Set(problems.map(p => p.trim()).filter(Boolean))];
    return { ok: plots.length > 0, plots, log, errors: plots.length ? uniq : (uniq.length ? uniq : ['ngspice produced no results']), elapsedMs: Date.now() - t0 };
  }
}
