// Optional development/reference runner invoking native `ngspice -b` via Node.js.
// Not used by the browser application (which runs ngspice-46 WebAssembly in a Web Worker).
// Retained strictly for Node-side accuracy cross-checking against native ngspice.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDecks, extractNgspiceErrors, normalizePlots } from '../src/sim/deckBuilder';

export const NGSPICE_BIN = process.env.NGSPICE_BIN || 'ngspice';
export { buildDecks, normalizePlots };

export interface RunOutput { raw: string; log: string; errors: string[]; ok: boolean; elapsedMs: number; acSenseMap: Map<string, string> }

export async function runNgspice(netlist: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RunOutput> {
  const t0 = Date.now();
  const { decks, errors, acSenseMap } = buildDecks(netlist);
  if (errors.length) return { raw: '', log: '', errors, ok: false, elapsedMs: 0, acSenseMap };
  const dir = await mkdtemp(join(tmpdir(), 'ospice-'));
  const out = join(dir, 'out.raw');
  const cir = join(dir, 'circuit.cir');
  try {
    let log = '';
    for (const deck of decks) {
      await writeFile(cir, deck.replace(/__OUT__/g, out));
      log += await new Promise<string>((resolve, reject) => {
        const child = spawn(NGSPICE_BIN, ['-b', cir], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
        let buf = '';
        child.stdout.on('data', d => (buf += d));
        child.stderr.on('data', d => (buf += d));
        const kill = (why: string) => { child.kill('SIGKILL'); reject(new Error(why)); };
        const timer = setTimeout(() => kill(`Simulation timed out after ${(opts.timeoutMs ?? 30000) / 1000}s`), opts.timeoutMs ?? 30000);
        opts.signal?.addEventListener('abort', () => kill('Simulation cancelled'));
        child.on('error', e => { clearTimeout(timer); reject(new Error(`Cannot start ngspice (${NGSPICE_BIN}): ${e.message}`)); });
        child.on('close', () => { clearTimeout(timer); resolve(buf); });
      });
    }
    let raw = '';
    try { raw = await readFile(out, 'utf8'); } catch { /* no output */ }
    const { errors: errs, fatal } = extractNgspiceErrors(log, !!raw);
    return { raw, log, errors: errs, ok: !!raw && !fatal, elapsedMs: Date.now() - t0, acSenseMap };
  } catch (e) {
    return { raw: '', log: '', errors: [(e as Error).message], ok: false, elapsedMs: Date.now() - t0, acSenseMap };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
