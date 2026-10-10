// Engine that calls the native runner directly (Node only: tests, future desktop backend).
import { SimulationEngine, SimResult } from './types';
import { parseRawAscii } from './rawParser';
import { runNgspice } from '../../server/ngspiceRunner';

export class NodeNgspiceEngine implements SimulationEngine {
  readonly name = 'ngspice (node)';
  async run(netlist: string, signal?: AbortSignal): Promise<SimResult> {
    const o = await runNgspice(netlist, { signal });
    const plots = o.raw ? parseRawAscii(o.raw) : [];
    return { ok: o.ok && plots.length > 0, plots, log: o.log, errors: o.errors, elapsedMs: o.elapsedMs };
  }
}
