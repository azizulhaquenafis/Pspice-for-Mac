// Runs native ngspice in batch mode on a validated netlist. Used by the dev
// server middleware and by the test suite. (Planned: Tauri sidecar in M4.)
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitDeck, bodyFor, LOG_PROBLEM } from '../src/sim/deck';

export const NGSPICE_BIN = process.env.NGSPICE_BIN || 'ngspice';
export interface RunOutput { raw: string; log: string; errors: string[]; ok: boolean; elapsedMs: number }

/**
 * Convert analysis cards to control commands so each plot is written to the rawfile.
 * Returns one deck per ngspice pass: ngspice-47 yields zero-length device currents
 * (@r1[i]) in AC with savecurrents, which aborts `write`, so AC runs in its own pass
 * without savecurrents.
 */
export function buildDecks(netlist: string): { decks: string[]; errors: string[] } {
  const { body, analyses, errors } = splitDeck(netlist);
  const deck = (b: string[], cs: string[]) => [...b, '.control', 'set filetype=ascii', 'set appendwrite',
    ...cs.flatMap(c => [c, 'write __OUT__']), 'quit', '.endc', '.end'].join('\n') + '\n';
  const cmd = (a: { kind: string; args: string }) => `${a.kind}${a.args}`;
  const main = analyses.filter(a => a.kind !== 'ac').map(cmd), ac = analyses.filter(a => a.kind === 'ac').map(cmd);
  const decks: string[] = [];
  if (main.length) decks.push(deck(body, main));
  if (ac.length) decks.push(deck(bodyFor(body, 'ac'), ac));
  return { decks, errors };
}

export async function runNgspice(netlist: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RunOutput> {
  const t0 = Date.now();
  const { decks, errors } = buildDecks(netlist);
  if (errors.length) return { raw: '', log: '', errors, ok: false, elapsedMs: 0 };
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
    const errs = log.split('\n').filter(l => LOG_PROBLEM.test(l) && !/^\s*$/.test(l));
    return { raw, log, errors: errs.length ? errs : (raw ? [] : ['ngspice produced no results']), ok: !!raw, elapsedMs: Date.now() - t0 };
  } catch (e) {
    return { raw: '', log: '', errors: [(e as Error).message], ok: false, elapsedMs: Date.now() - t0 };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
