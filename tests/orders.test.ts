// First/second-order coursework circuits with PSpice-style initial conditions and switches.
// Uses PSpice's default Print Step (20ns) and no Step Ceiling, as a student would.
import { Builder, simulate, vec, at, engine } from './helpers';
import { newId } from '../src/core/model';
import { translateDeck } from '../src/core/deckTranslate';
import { parseRawAscii } from '../src/sim/rawParser';
import { runDeck } from '../src/sim/netlistSim';

const tran = (b: Builder, finalTime: string, uic = false) =>
  (b.doc.profile.tran = { enabled: true, printStep: '20ns', finalTime, noPrint: '0', stepCeiling: '', uic });
const alias = (b: Builder, x: number, y: number, text: string) => b.doc.labels.push({ id: newId('l'), x, y, text, kind: 'alias' });
const near = (got: number, want: number, tol: number) => expect(Math.abs(got - want), `got ${got}, want ${want}`).toBeLessThan(tol);

describe('first order, source-free', () => {
  it('RC: C IC=10V discharges as 10e^(-t/0.1) (no UIC)', async () => {
    const b = new Builder();
    b.part('C', 'C1', 100, 0, 3, { VALUE: '100u', IC: '10' });
    b.part('R', 'R1', 160, 0, 3, { VALUE: '1k' });
    b.wire({ x: 100, y: 0 }, { x: 160, y: 0 }); b.gnd({ x: 100, y: 40 }); b.gnd({ x: 160, y: 40 });
    alias(b, 130, 0, 'A'); tran(b, '0.5');
    const p = await simulate(b.doc);
    const t = vec(p, 'tran', 'time'), v = vec(p, 'tran', 'v(a)');
    expect(t.length).toBeLessThan(20000); // PSpice default 20ns print step must not explode the point count
    near(v[0], 10, 1e-3);
    for (const tt of [0.05, 0.1, 0.2, 0.4]) near(at(t, v, tt), 10 * Math.exp(-tt / 0.1), 0.02);
    near(vec(p, 'op', 'v(a)')[0], 10, 1e-3); // bias point shows the IC, as in PSpice
  });

  it('RL: L IC=1A decays as e^(-10t) (no UIC)', async () => {
    const b = new Builder();
    b.part('L', 'L1', 100, 0, 3, { VALUE: '1', IC: '1' });
    b.part('R', 'R1', 160, 0, 3, { VALUE: '10' });
    b.wire({ x: 100, y: 0 }, { x: 160, y: 0 }); b.gnd({ x: 100, y: 40 }); b.gnd({ x: 160, y: 40 });
    alias(b, 130, 0, 'A'); tran(b, '0.5');
    const p = await simulate(b.doc);
    const t = vec(p, 'tran', 'time'), i = vec(p, 'tran', 'i(@l1[i])');
    near(i[0], 1, 1e-3);
    for (const tt of [0.05, 0.1, 0.2]) near(at(t, i, tt), Math.exp(-10 * tt), 0.003);
    near(at(t, vec(p, 'tran', 'v(a)'), 0.1), -10 * Math.exp(-1), 0.03); // current leaves L at top, flows up through R
  });

  it('floating capacitor IC (neither pin grounded): V(A)-V(B) = 5e^(-t/0.2)', async () => {
    const b = new Builder();
    b.part('R', 'R1', 100, 0, 3, { VALUE: '1k' });
    b.part('C', 'C1', 100, 0, 0, { VALUE: '100u', IC: '5' });
    b.part('R', 'R2', 140, 0, 3, { VALUE: '1k' });
    b.gnd({ x: 100, y: 40 }); b.gnd({ x: 140, y: 40 }); alias(b, 100, 0, 'A'); alias(b, 140, 0, 'B'); tran(b, '1');
    const p = await simulate(b.doc);
    const t = vec(p, 'tran', 'time'), va = vec(p, 'tran', 'v(a)'), vb = vec(p, 'tran', 'v(b)');
    near(va[0], 2.5, 1e-3); near(vb[0], -2.5, 1e-3);
    near(at(t, va, 0.2) - at(t, vb, 0.2), 5 * Math.exp(-1), 0.01);
  });
});

describe('second order, source-free', () => {
  it('series RLC underdamped (R=2, L=1, C=0.04, Vc(0)=10, iL(0)=0)', async () => {
    const b = new Builder();
    b.part('C', 'C1', 100, 0, 3, { VALUE: '0.04', IC: '10' });
    b.part('L', 'L1', 100, 0, 0, { VALUE: '1', IC: '0' });
    b.part('R', 'R1', 140, 0, 3, { VALUE: '2' });
    b.gnd({ x: 100, y: 40 }); b.gnd({ x: 140, y: 40 }); alias(b, 100, 0, 'A'); tran(b, '5');
    const p = await simulate(b.doc);
    const t = vec(p, 'tran', 'time'), v = vec(p, 'tran', 'v(a)');
    const a = 1, wd = Math.sqrt(25 - 1);
    for (const tt of [0.2, 0.5, 1, 1.5, 2, 3]) near(at(t, v, tt), 10 * Math.exp(-a * tt) * (Math.cos(wd * tt) + (a / wd) * Math.sin(wd * tt)), 0.05);
    expect(Math.min(...v)).toBeLessThan(-3); // it really oscillates
  });

  it('same circuit with UIC checked gives the same response', async () => {
    const b = new Builder();
    b.part('C', 'C1', 100, 0, 3, { VALUE: '0.04', IC: '10' });
    b.part('L', 'L1', 100, 0, 0, { VALUE: '1', IC: '0' });
    b.part('R', 'R1', 140, 0, 3, { VALUE: '2' });
    b.gnd({ x: 100, y: 40 }); b.gnd({ x: 140, y: 40 }); alias(b, 100, 0, 'A'); tran(b, '5', true);
    const p = await simulate(b.doc);
    const t = vec(p, 'tran', 'time'), v = vec(p, 'tran', 'v(a)');
    near(at(t, v, 1), 10 * Math.exp(-1) * (Math.cos(Math.sqrt(24)) + Math.sin(Math.sqrt(24)) / Math.sqrt(24)), 0.05);
  });
});

describe('switched circuits (Sw_tClose / Sw_tOpen)', () => {
  it('Sw_tClose charges RC: Vc(0.1) = 6.321V with C IC=0', async () => {
    const b = new Builder();
    b.part('VDC', 'V1', 0, 0, 0, { DC: '10' });
    b.part('Sw_tClose', 'U1', 0, 0, 0, { TCLOSE: '0' });
    b.part('R', 'R1', 40, 0, 0, { VALUE: '1k' });
    b.part('C', 'C1', 80, 0, 3, { VALUE: '100u', IC: '0' });
    b.gnd({ x: 0, y: 40 }); b.gnd({ x: 80, y: 40 }); alias(b, 80, 0, 'OUT'); tran(b, '0.5');
    const p = await simulate(b.doc);
    const t = vec(p, 'tran', 'time'), v = vec(p, 'tran', 'v(out)');
    near(v[0], 0, 1e-3);
    near(at(t, v, 0.1), 10 * (1 - Math.exp(-1)), 0.02);
  });

  it('Sw_tOpen disconnects the source: C discharges through R2 (tau=0.1s)', async () => {
    const b = new Builder();
    b.part('VDC', 'V1', 0, 0, 0, { DC: '10' });
    b.part('Sw_tOpen', 'U1', 0, 0, 0, { TOPEN: '0' });
    b.part('C', 'C1', 40, 0, 3, { VALUE: '100u' });
    b.part('R', 'R2', 80, 0, 3, { VALUE: '1k' });
    b.wire({ x: 40, y: 0 }, { x: 80, y: 0 });
    b.gnd({ x: 0, y: 40 }); b.gnd({ x: 40, y: 40 }); b.gnd({ x: 80, y: 40 }); alias(b, 60, 0, 'A'); tran(b, '0.5');
    const p = await simulate(b.doc);
    const t = vec(p, 'tran', 'time'), v = vec(p, 'tran', 'v(a)');
    near(v[0], 10, 0.01);
    near(at(t, v, 0.1), 10 * Math.exp(-1), 0.03);
  });
});

describe('netlist (.cir) mode', () => {
  const deck = `RC charging written by hand
V1 1 0 PULSE(0 10 0 1u 1u 10 20)
R1 1 2 1k
C1 2 0 100u
.TRAN 20ns 0.5s
.PROBE
.END
`;
  it('translates PSpice-isms with notes and simulates correctly', async () => {
    const tr = translateDeck(deck);
    expect(tr.errors).toEqual([]);
    expect(tr.notes.join('\n')).toMatch(/\.PROBE/i);
    expect(tr.notes.join('\n')).toMatch(/step ceiling/i);
    const r = await engine.run(tr.text);
    expect(r.ok).toBe(true);
    const tp = r.plots.find(p => p.kind === 'tran')!;
    const t = tp.vectors[0].re, v = tp.vectors.find(v => v.name === 'v(2)')!.re;
    near(at(t, v, 0.1), 10 * (1 - Math.exp(-1)), 0.02);
    expect(tp.vectors.some(v => v.name === 'i(@r1[i])')).toBe(true); // currents available for Probe
  });
  it('hand-written source-free RLC with IC= (no UIC) behaves like PSpice', async () => {
    const run = await runDeck(`Source-free series RLC\nC1 A 0 0.04 IC=10\nL1 A B 1 IC=0\nR1 B 0 2\n.tran 1ms 5s\n.end\n`, engine);
    expect(run.result.errors).toEqual([]);
    const tp = run.result.plots.find(p => p.kind === 'tran')!;
    const t = tp.vectors[0].re, v = tp.vectors.find(v => v.name === 'v(a)')!.re;
    const wd = Math.sqrt(24);
    for (const tt of [0.5, 1, 2]) near(at(t, v, tt), 10 * Math.exp(-tt) * (Math.cos(wd * tt) + Math.sin(wd * tt) / wd), 0.05);
    expect(run.result.plots[0].kind).toBe('op');
    near(run.result.plots[0].vectors.find(v => v.name === 'v(a)')!.re[0], 10, 0.01);
  });
  it('ignores text after .END and does not flag ordinary titles', () => {
    const tr = translateDeck('My RC circuit lab one\nR1 1 0 1k\nV1 1 0 1\n.op\n.end\nR9 x y 1\n');
    expect(tr.text).not.toMatch(/R9/);
    expect(tr.notes.join()).toMatch(/after \.END/);
    expect(tr.notes.join()).not.toMatch(/TITLE/);
  });
  it('reports unsupported statements and the title-line rule', () => {
    const tr = translateDeck('R1 1 0 1k\nV1 1 0 1\n.FOUR 1k V(1)\n.LIB nom.lib\n');
    expect(tr.notes.join()).toMatch(/TITLE/);
    expect(tr.errors.join()).toMatch(/\.FOUR/);
    expect(tr.errors.join()).toMatch(/\.LIB/);
    expect(tr.errors.join()).toMatch(/No analysis/);
  });
  it('ASCII rawfile parser handles hand-written deck output', async () => {
    const r = await engine.run('t\nV1 1 0 5\nR1 1 0 1k\n.op\n.end\n');
    expect(r.plots[0].vectors.find(v => v.name === 'i(v1)')!.re[0]).toBeCloseTo(-5e-3, 9);
    expect(parseRawAscii('')).toEqual([]);
  });
});
