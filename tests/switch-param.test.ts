// Timed switches, PARAMETERS / {expressions}, and parametric sweeps — all on real ngspice.
import { Builder, divider, switchedRL, simulate, vec, at, engine } from './helpers';
import { generateNetlist } from '../src/core/netlist';
import { runParametric, sweepValues } from '../src/sim/parametric';
import { serialize, deserialize } from '../src/core/serialize';
import { pinPositions } from '../src/core/library';
import { evalExpr, resolveParams } from '../src/core/params';
import { Rot } from '../src/core/model';

const near = (got: number, want: number, rel: number) => expect(Math.abs(got - want), `got ${got}, want ${want}`).toBeLessThan(Math.abs(want) * rel + 1e-9);
const tran = (b: Builder, ft: string) => (b.doc.profile.tran = { enabled: true, printStep: '10us', finalTime: ft, noPrint: '0', stepCeiling: '', uic: false });

/** V1 10V -> switch -> R1 1k -> ground, switch with the given rotation/mirror placed between (0,0) and (40,0). */
function switchCircuit(type: 'Sw_tOpen' | 'Sw_tClose', rot: Rot = 0, mirror = false) {
  const b = new Builder();
  b.part('VDC', 'V1', 0, 0, 0, { DC: '10' });
  const sw = b.part(type, 'U1', 0, 0, rot, { [type === 'Sw_tOpen' ? 'TOPEN' : 'TCLOSE']: '1ms' });
  sw.mirror = mirror;
  // move the switch (any orientation) so its first pin sits at (40,-40), clear of everything else
  const P0 = pinPositions(sw);
  const first0 = P0[0].x + P0[0].y <= P0[1].x + P0[1].y ? P0[0] : P0[1];
  sw.x += 40 - first0.x; sw.y += -40 - first0.y;
  const P = pinPositions(sw);
  const [p1, p2] = P[0].x + P[0].y <= P[1].x + P[1].y ? [P[0], P[1]] : [P[1], P[0]];
  b.wire({ x: 0, y: 0 }, { x: 0, y: -60 }); b.wire({ x: 0, y: -60 }, { x: p1.x, y: -60 }); b.wire({ x: p1.x, y: -60 }, p1);
  b.part('R', 'R1', 80, 100, 0, { VALUE: '1k' });
  b.wire(p2, { x: 80, y: 100 });
  b.wire({ x: 120, y: 100 }, { x: 120, y: 160 }); b.gnd({ x: 120, y: 160 });
  b.wire({ x: 0, y: 40 }, { x: 0, y: 160 }); b.gnd({ x: 0, y: 160 });
  tran(b, '2ms');
  return b;
}

describe('timed switches', () => {
  it('Sw_tOpen conducts (RCLOSED) before TOPEN and blocks (ROPEN) after', async () => {
    const p = await simulate(switchCircuit('Sw_tOpen').doc);
    const t = vec(p, 'tran', 'time'), i = vec(p, 'tran', 'i(@r1[i])');
    near(at(t, i, 0.5e-3), 10 / 1000.01, 1e-4);
    near(at(t, i, 1.5e-3), 10 / (1e6 + 1000), 1e-3);
    near(vec(p, 'op', 'i(@r1[i])')[0], 10 / 1000.01, 1e-4); // bias point: closed
  });
  it('Sw_tClose blocks before TCLOSE and conducts after', async () => {
    const p = await simulate(switchCircuit('Sw_tClose').doc);
    const t = vec(p, 'tran', 'time'), i = vec(p, 'tran', 'i(@r1[i])');
    near(at(t, i, 0.5e-3), 10 / (1e6 + 1000), 1e-3);
    near(at(t, i, 1.5e-3), 10 / 1000.01, 1e-4);
  });
  it.each([[0, false], [1, false], [2, false], [3, false], [0, true], [2, true], [1, true]] as [Rot, boolean][])(
    'rotation %i / mirror %s does not change the electrical behaviour', async (rot, mir) => {
      for (const type of ['Sw_tOpen', 'Sw_tClose'] as const) {
        const p = await simulate(switchCircuit(type, rot, mir).doc);
        const t = vec(p, 'tran', 'time'), i = vec(p, 'tran', 'i(@r1[i])');
        const before = at(t, i, 0.5e-3), after = at(t, i, 1.5e-3);
        if (type === 'Sw_tOpen') { near(before, 10 / 1000.01, 1e-4); expect(after).toBeLessThan(1e-4); }
        else { expect(before).toBeLessThan(1e-4); near(after, 10 / 1000.01, 1e-4); }
      }
    });
  it('switch properties survive save/reload', () => {
    const b = switchCircuit('Sw_tOpen', 1, true);
    const back = deserialize(serialize(b.doc));
    const u = back.parts.find(p => p.ref === 'U1')!;
    expect([u.type, u.rot, u.mirror, u.props.TOPEN, u.props.ROPEN]).toEqual(['Sw_tOpen', 1, true, '1ms', '1Meg']);
  });
});

describe('PARAMETERS and {expressions}', () => {
  const paramDivider = (r2: string, defs: Record<string, string>) => {
    const b = divider();
    b.doc.parts.find(p => p.ref === 'R2')!.props.VALUE = r2;
    const entries = Object.entries(defs);
    const props: Record<string, string> = {};
    entries.forEach(([n, v], i) => { props[`NAME${i + 1}`] = n; props[`VALUE${i + 1}`] = v; });
    b.part('PARAM', '', 300, 300, 0, { NAME1: '', VALUE1: '', ...props });
    return b;
  };
  it('{Rx} substitutes into the netlist and simulates', async () => {
    const b = paramDivider('{Rx}', { Rx: '3k' });
    const nl = generateNetlist(b.doc);
    expect(nl.ok).toBe(true);
    expect(nl.text).toMatch(/^\.param Rx=3000$/m);
    expect(nl.text).toMatch(/^R2 OUT 0 \{Rx\}$/m);
    near(vec(await simulate(b.doc), 'op', 'v(out)')[0], 6, 1e-9);
  });
  it('expressions {2*Rx} and {Rx+1k}, parameters referring to parameters', async () => {
    near(vec(await simulate(paramDivider('{2*Rx}', { Rx: '1.5k' }).doc), 'op', 'v(out)')[0], 6, 1e-9);
    near(vec(await simulate(paramDivider('{Rx+1k}', { Rx: '2k' }).doc), 'op', 'v(out)')[0], 6, 1e-9);
    near(vec(await simulate(paramDivider('{Ry}', { Rx: '1k', Ry: '{3*Rx}' }).doc), 'op', 'v(out)')[0], 6, 1e-9);
  });
  it('reports undefined and circular parameters', () => {
    const msgs = (r2: string, d: Record<string, string>) => generateNetlist(paramDivider(r2, d).doc).diagnostics.map(x => x.message).join('\n');
    expect(msgs('{Rz}', { Rx: '1' })).toMatch(/Undefined parameter "Rz"/);
    expect(msgs('{A}', { A: '{B}', B: '{A}' })).toMatch(/Circular/);
    expect(() => evalExpr('2*(3', () => 0)).toThrow();
    const b = paramDivider('{Rx}', { Rx: '3k' });
    b.part('PARAM', '', 400, 400, 0, { NAME1: 'Rx', VALUE1: '1k' });
    expect(generateNetlist(b.doc).diagnostics.map(x => x.message).join()).toMatch(/defined more than once/);
    expect(resolveParams([{ name: 'k', expr: '2k' }]).values.get('k')).toBe(2000);
  });
});

describe('parametric sweep', () => {
  it('sweep value generation (list, linear, decade) and limits', () => {
    const base = { enabled: true, varType: 'global' as const, name: 'R', start: '1', end: '100', incr: '1', values: '' };
    expect(sweepValues({ ...base, sweep: 'list', values: '1, 10k 2.2Meg' }).values).toEqual([1, 1e4, 2.2e6]);
    expect(sweepValues({ ...base, sweep: 'lin', start: '0', end: '1', incr: '0.25' }).values).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(sweepValues({ ...base, sweep: 'dec', start: '1', end: '100', incr: '1' }).values.map(v => +v.toPrecision(6))).toEqual([1, 10, 100]);
    expect(sweepValues({ ...base, sweep: 'lin', start: '0', end: '1000', incr: '1' }).error).toMatch(/limit/);
    expect(sweepValues({ ...base, sweep: 'list', values: '1 x' }).error).toMatch(/Value list/);
  });
  it('global parameter sweep of a divider: one real run per value', async () => {
    const b = divider();
    b.doc.parts.find(p => p.ref === 'R2')!.props.VALUE = '{Rx}';
    b.part('PARAM', '', 300, 300, 0, { NAME1: 'Rx', VALUE1: '1k' });
    b.doc.profile.param = { enabled: true, varType: 'global', name: 'Rx', sweep: 'list', start: '', end: '', incr: '', values: '1k 3k 9k' };
    const { result } = await runParametric(b.doc, engine);
    expect(result.steps!.map(s => s.label)).toEqual(['Rx = 1k', 'Rx = 3k', 'Rx = 9k']);
    result.steps!.forEach(s => near(s.plots[0].vectors.find(v => v.name === 'v(out)')!.re[0], 10 * s.value / (2000 + s.value), 1e-9));
  });
  it('source sweep and missing-parameter error', async () => {
    const b = divider();
    b.doc.profile.param = { enabled: true, varType: 'source', name: 'V1', sweep: 'list', start: '', end: '', incr: '', values: '5 10' };
    const r = (await runParametric(b.doc, engine)).result;
    expect(r.steps!.map(s => s.plots[0].vectors.find(v => v.name === 'v(out)')!.re[0])).toEqual([expect.closeTo(3, 9), expect.closeTo(6, 9)]);
    b.doc.profile.param = { ...b.doc.profile.param, varType: 'global', name: 'Nope' };
    expect((await runParametric(b.doc, engine)).result.errors[0]).toMatch(/not defined/);
  });
  it('reference switched RL: I(L1) before/during/after the 2 ms and 2.2 ms events for each Rh', async () => {
    const b = switchedRL();
    const nl = generateNetlist(b.doc);
    expect(nl.ok).toBe(true);
    const { result } = await runParametric(b.doc, engine);
    expect(result.errors).toEqual([]);
    const L = 0.24, R2 = 120.01, R5 = 180.01;
    const i0 = 12 / R2, t1 = L / R5;
    const iAt22 = i0 * Math.exp(-0.2e-3 / t1);
    const finals: number[] = [];
    for (const s of result.steps!) {
      const tp = s.plots.find(p => p.kind === 'tran')!;
      const t = tp.vectors[0].re, i = tp.vectors.find(v => v.name === 'i(@l1[i])')!.re;
      const Rh = s.value + 0.01;
      near(at(t, i, 1.9e-3), i0, 2e-3);                                     // steady state through R2
      near(at(t, i, 2.1e-3), i0 * Math.exp(-0.1e-3 / t1), 5e-3);            // decaying through R5 (Rh not yet active)
      const Rth = Rh * R5 / (Rh + R5), iInf = 24 / Rh, t2 = L / Rth;
      for (const tt of [3e-3, 4e-3]) near(at(t, i, tt), iInf + (iAt22 - iInf) * Math.exp(-(tt - 2.2e-3) / t2), 5e-3);
      finals.push(at(t, i, 4e-3));
    }
    expect(new Set(finals.map(f => f.toFixed(4))).size).toBe(5); // Rh changes the response
  });
});
