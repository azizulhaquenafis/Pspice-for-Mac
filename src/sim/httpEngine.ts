// Browser-side client of the local native ngspice service (development server / future desktop app).
import { SimulationEngine, SimResult } from './types';
import { parseRawAscii } from './rawParser';

/** Thrown when the native service is missing (e.g. a static production deployment) — not a circuit error. */
export class ServiceUnavailable extends Error {}

/** Read a JSON reply, turning HTML pages, empty bodies and HTTP errors into clear messages. */
export async function readJson(r: Response, what: string): Promise<any> {
  const type = r.headers.get('content-type') ?? '';
  const text = await r.text();
  if (!type.includes('json')) {
    const kind = /^\s*</.test(text) ? 'an HTML page' : text.trim() ? `"${text.trim().slice(0, 60)}"` : 'an empty reply';
    throw new ServiceUnavailable(`${what} is not available on this server (HTTP ${r.status}, received ${kind} instead of JSON).`);
  }
  try { return JSON.parse(text); } catch { throw new ServiceUnavailable(`${what} returned malformed JSON (HTTP ${r.status}).`); }
}

export class LocalNgspiceEngine implements SimulationEngine {
  readonly name = 'ngspice (native, local service)';
  /** true if the dev server's /api/health answers with JSON. */
  static async available(timeoutMs = 1500): Promise<boolean> {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
      const r = await fetch('/api/health', { signal: ctl.signal }); clearTimeout(t);
      const j = await readJson(r, 'Native ngspice service');
      return !!j?.ok;
    } catch { return false; }
  }
  async run(netlist: string, signal?: AbortSignal): Promise<SimResult> {
    const t0 = performance.now();
    let r: Response;
    try {
      r = await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ netlist }), signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return { ok: false, plots: [], log: '', errors: ['Simulation cancelled'], elapsedMs: performance.now() - t0 };
      throw new ServiceUnavailable(`Native ngspice service unreachable: ${(e as Error).message}`);
    }
    const out = await readJson(r, 'The native ngspice service (/api/simulate)');
    const plots = out.raw ? parseRawAscii(out.raw) : [];
    return { ok: !!out.ok && plots.length > 0, plots, log: out.log ?? '', errors: out.errors ?? [], elapsedMs: performance.now() - t0 };
  }
}
