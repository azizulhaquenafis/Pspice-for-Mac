// ngspice-WebAssembly backend (production) — specific behaviour; the full suite also runs on it via npm run test:wasm.
import { NodeWasmEngine } from '../src/sim/nodeWasmEngine';
import { toAscii } from '../src/sim/wasmCore';

describe('ngspice-WebAssembly engine', () => {
  const e = new NodeWasmEngine();
  it('non-ASCII text (which hangs the WASM build) is converted, and the deck simulates', async () => {
    expect(toAscii('* R1 — 2kΩ, 10µF, 45°')).toBe('* R1 - 2kohm, 10uF, 45deg');
    const r = await e.run('* Divider — généré\nV1 1 0 DC 10\nR1 1 2 2k\nR2 2 0 3k\n.op\n.end\n');
    expect(r.errors).toEqual([]);
    expect(r.plots[0].vectors.find(v => v.name === 'v(2)')!.re[0]).toBeCloseTo(6, 9);
  });
  it('runs every analysis of a deck as its own pass, in order, like the native runner', async () => {
    const r = await e.run('t\nV1 1 0 DC 1 AC 1\nR1 1 2 1k\nC1 2 0 1u\n.op\n.tran 1m 5m\n.dc V1 0 1 0.5\n.ac dec 5 10 1k\n.end\n');
    expect(r.plots.map(p => p.kind)).toEqual(['op', 'tran', 'dc', 'ac']);
    expect(r.plots[3].complex).toBe(true);
  });
  it('a broken deck reports the ngspice error and does not poison the next run', async () => {
    const bad = await e.run('bad\nV1 1 0 10\nR1 1 0 abc\n.op\n.end\n');
    expect(bad.ok).toBe(false);
    expect(bad.errors.join('\n')).toMatch(/error|no results/i);
    const good = await e.run('good\nV1 1 0 10\nR1 1 0 1k\n.op\n.end\n');
    expect(good.plots[0].vectors.find(v => v.name === 'i(v1)')!.re[0]).toBeCloseTo(-0.01, 12);
  });
  it('refuses .control / shell / file includes', async () => {
    const r = await e.run('x\n.control\nshell ls\n.endc\nR1 1 0 1\n.op\n.end\n');
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/forbidden/);
  });
});
