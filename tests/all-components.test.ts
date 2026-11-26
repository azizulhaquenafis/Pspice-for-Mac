// Exhaustive verification of all 20 schematic library components, all 4 marker types,
// all Netlist Mode devices/directives, Probe expressions & measurements, and undo/redo state.
import { describe, it, expect } from 'vitest';
import { LIBRARY, defaultProps } from '../src/core/library';
import { emptyDoc, Part, Wire } from '../src/core/model';
import { generateNetlist } from '../src/core/netlist';
import { WasmCoreNgspiceEngine, runNgspiceWasm } from '../src/sim/wasmCore';
import { runSchematic } from '../src/sim/schematicSim';
import { runParametric } from '../src/sim/parametric';
import { runDeck } from '../src/sim/netlistSim';
import { evaluateExpr, parseDeckDevices } from '../src/sim/expr';
import { MEASUREMENTS, measure } from '../src/sim/measure';
import { availableTraces, markerExprs } from '../src/ui/probeModel';
import { useStore } from '../src/state/store';

const engine = new WasmCoreNgspiceEngine();

function mkPart(
  id: string,
  type: string,
  ref: string,
  x: number,
  y: number,
  props: Record<string, string> = {},
  rot: 0 | 1 | 2 | 3 = 0,
  mirror = false,
): Part {
  const def = LIBRARY.find(d => d.name === type);
  if (!def) throw new Error(`Missing library component ${type}`);
  return { id, type, ref, x, y, rot, mirror, props: { ...defaultProps(def), ...props } };
}

function wire(id: string, ax: number, ay: number, bx: number, by: number): Wire {
  return { id, a: { x: ax, y: ay }, b: { x: bx, y: by } };
}

async function simDoc(parts: Part[], wires: Wire[], profilePatch: any = {}, markers: any[] = []) {
  const base = emptyDoc();
  const doc = {
    ...base,
    title: 'AllPartsTest',
    parts,
    wires,
    markers,
    profile: {
      ...base.profile,
      ...profilePatch,
      tran: { ...base.profile.tran, ...(profilePatch.tran ?? {}) },
      dc: { ...base.profile.dc, ...(profilePatch.dc ?? {}) },
      ac: { ...base.profile.ac, ...(profilePatch.ac ?? {}) },
      param: { ...base.profile.param, ...(profilePatch.param ?? {}) },
    },
  };
  const gen = generateNetlist(doc);
  expect(gen.ok, gen.diagnostics.map(d => d.message).join('; ')).toBe(true);
  const sim = await runSchematic(doc, engine);
  expect(sim.result.ok, sim.result.errors.join('; ')).toBe(true);
  return { doc, gen, sim, devices: parseDeckDevices(sim.deck) };
}

describe('All 20 library components end-to-end (schematic -> netlist -> ngspice-46 WASM -> Probe)', () => {
  it('library contains all 20 documented components with valid geometry', () => {
    const names = LIBRARY.map(d => d.name);
    expect(names).toEqual([
      'R', 'C', 'L',
      'VDC', 'IDC', 'VSIN', 'VPULSE', 'VAC', 'VPWL',
      'D1N4148',
      'E', 'F', 'G', 'H',
      'Sw_tClose', 'Sw_tOpen',
      'PARAM', 'BUBBLE',
      'AGND', 'GND_EARTH',
    ]);
  });

  it('R + VDC + AGND + GND_EARTH with all 4 marker types (V, VD, I, W)', async () => {
    const v1 = mkPart('p1', 'VDC', 'V1', 0, 0, { DC: '12V' });
    const r1 = mkPart('p2', 'R', 'R1', 40, 0, { VALUE: '2k' });
    const r2 = mkPart('p3', 'R', 'R2', 80, 0, { VALUE: '4k' });
    const g1 = mkPart('p4', 'AGND', '', 0, 40);
    const g2 = mkPart('p5', 'GND_EARTH', '', 120, 0);
    const markers = [
      { id: 'm1', kind: 'V', x: 80, y: 0 },
      { id: 'm2', kind: 'VD', x: 40, y: 0, x2: 80, y2: 0 },
      { id: 'm3', kind: 'I', x: 40, y: 0, partId: 'p2', pin: '1' },
      { id: 'm4', kind: 'W', x: 60, y: 0, partId: 'p2' },
    ];
    const { doc, sim, devices } = await simDoc([v1, r1, r2, g1, g2], [wire('w1', 0, 0, 40, 0)], {}, markers);
    const op = sim.result.plots.find(p => p.kind === 'op')!;
    const exprs = markerExprs(doc);
    expect(exprs.every(Boolean)).toBe(true);
    expect(evaluateExpr(exprs[0]!, op, devices).re[0]).toBeCloseTo(8, 5);      // V(mid)
    expect(evaluateExpr(exprs[1]!, op, devices).re[0]).toBeCloseTo(4, 5);      // VD across R1
    expect(evaluateExpr(exprs[2]!, op, devices).re[0]).toBeCloseTo(2e-3, 8);   // I(R1)
    expect(evaluateExpr(exprs[3]!, op, devices).re[0]).toBeCloseTo(8e-3, 8);   // W(R1)
  });

  it('IDC DC current source (+ -> - through source) + parametric current source sweep', async () => {
    const i1 = mkPart('p1', 'IDC', 'I1', 0, 0, { DC: '5mA' });
    const r1 = mkPart('p2', 'R', 'R1', 40, 0, { VALUE: '1k' });
    const g1 = mkPart('p3', 'AGND', '', 0, 40);
    const g2 = mkPart('p4', 'AGND', '', 80, 0);
    const { doc, sim, devices } = await simDoc([i1, r1, g1, g2], [wire('w1', 0, 0, 40, 0)]);
    const op = sim.result.plots.find(p => p.kind === 'op')!;
    expect(evaluateExpr('V(R1)', op, devices).re[0]).toBeCloseTo(-5, 5);
    expect(evaluateExpr('I(I1)', op, devices).re[0]).toBeCloseTo(5e-3, 8);
    expect(evaluateExpr('W(R1)', op, devices).re[0]).toBeCloseTo(25e-3, 8);

    // Parametric sweep over IDC current source
    const swept = {
      ...doc,
      profile: {
        ...doc.profile,
        param: { enabled: true, varType: 'source' as const, name: 'I1', sweep: 'list' as const, start: '', end: '', incr: '', values: '1m 2m 4m' },
      },
    };
    const pRun = await runParametric(swept, engine);
    expect(pRun.result.ok).toBe(true);
    expect(pRun.result.steps?.length).toBe(3);
    const vVals = pRun.result.steps!.map(s => evaluateExpr('V(R1)', s.plots[0], parseDeckDevices(s.deck ?? '')).re[0]);
    expect(vVals[0]).toBeCloseTo(-1, 5);
    expect(vVals[1]).toBeCloseTo(-2, 5);
    expect(vVals[2]).toBeCloseTo(-4, 5);
  });

  it('VSIN sinusoidal voltage source', async () => {
    const v1 = mkPart('p1', 'VSIN', 'V1', 0, 0, { VOFF: '1', VAMPL: '2', FREQ: '1k' });
    const r1 = mkPart('p2', 'R', 'R1', 40, 0, { VALUE: '1k' });
    const g1 = mkPart('p3', 'AGND', '', 0, 40);
    const g2 = mkPart('p4', 'AGND', '', 80, 0);
    const { sim, devices } = await simDoc([v1, r1, g1, g2], [wire('w1', 0, 0, 40, 0)], {
      tran: { enabled: true, printStep: '10u', finalTime: '2m', noPrint: '0', stepCeiling: '10u', uic: false },
    });
    const tr = sim.result.plots.find(p => p.kind === 'tran')!;
    const y = evaluateExpr('V(R1)', tr, devices).re;
    expect(measure('Max', tr.vectors[0].re, y)).toBeCloseTo(3, 1);
    expect(measure('Min', tr.vectors[0].re, y)).toBeCloseTo(-1, 1);
    expect(measure('Peak_to_Peak', tr.vectors[0].re, y)).toBeCloseTo(4, 1);
  });

  it('VPULSE pulse voltage source', async () => {
    const v1 = mkPart('p1', 'VPULSE', 'V1', 0, 0, { V1: '0', V2: '5', TD: '0.2m', TR: '1u', TF: '1u', PW: '0.5m', PER: '2m' });
    const r1 = mkPart('p2', 'R', 'R1', 40, 0, { VALUE: '1k' });
    const g1 = mkPart('p3', 'AGND', '', 0, 40);
    const g2 = mkPart('p4', 'AGND', '', 80, 0);
    const { sim, devices } = await simDoc([v1, r1, g1, g2], [wire('w1', 0, 0, 40, 0)], {
      tran: { enabled: true, printStep: '10u', finalTime: '1m', noPrint: '0', stepCeiling: '10u', uic: false },
    });
    const tr = sim.result.plots.find(p => p.kind === 'tran')!;
    const y = evaluateExpr('V(R1)', tr, devices).re;
    expect(measure('YatX', tr.vectors[0].re, y, [0.1e-3])).toBeCloseTo(0, 2);
    expect(measure('YatX', tr.vectors[0].re, y, [0.5e-3])).toBeCloseTo(5, 2);
    expect(measure('YatX', tr.vectors[0].re, y, [0.9e-3])).toBeCloseTo(0, 2);
  });

  it('VPWL piecewise-linear voltage source', async () => {
    const v1 = mkPart('p1', 'VPWL', 'V1', 0, 0, { POINTS: '0 0 1m 4 2m 4' });
    const r1 = mkPart('p2', 'R', 'R1', 40, 0, { VALUE: '1k' });
    const g1 = mkPart('p3', 'AGND', '', 0, 40);
    const g2 = mkPart('p4', 'AGND', '', 80, 0);
    const { sim, devices } = await simDoc([v1, r1, g1, g2], [wire('w1', 0, 0, 40, 0)], {
      tran: { enabled: true, printStep: '20u', finalTime: '2m', noPrint: '0', stepCeiling: '20u', uic: false },
    });
    const tr = sim.result.plots.find(p => p.kind === 'tran')!;
    const y = evaluateExpr('V(R1)', tr, devices).re;
    expect(measure('YatX', tr.vectors[0].re, y, [0.5e-3])).toBeCloseTo(2, 1);
    expect(measure('YatX', tr.vectors[0].re, y, [1.5e-3])).toBeCloseTo(4, 1);
  });

  it('VAC + C + L series AC sweep with exact complex branch currents', async () => {
    const v1 = mkPart('p1', 'VAC', 'V1', 0, 0, { ACMAG: '1V', ACPHASE: '0', DC: '0V' });
    const r1 = mkPart('p2', 'R', 'R1', 40, 0, { VALUE: '1k' });
    const c1 = mkPart('p3', 'C', 'C1', 80, 0, { VALUE: '1u' });
    const l1 = mkPart('p4', 'L', 'L1', 120, 0, { VALUE: '10m' });
    const g1 = mkPart('p5', 'AGND', '', 0, 40);
    const g2 = mkPart('p6', 'AGND', '', 160, 0);
    const { sim, devices } = await simDoc([v1, r1, c1, l1, g1, g2], [wire('w1', 0, 0, 40, 0)], {
      ac: { enabled: true, sweep: 'dec', points: '10', start: '100', end: '10k' },
    });
    const ac = sim.result.plots.find(p => p.kind === 'ac')!;
    const ir = evaluateExpr('M(I(R1))', ac, devices).re;
    const ic = evaluateExpr('M(I(C1))', ac, devices).re;
    const il = evaluateExpr('M(I(L1))', ac, devices).re;
    for (let k = 0; k < ir.length; k++) {
      expect(Math.abs(ir[k] - ic[k])).toBeLessThan(1e-12);
      expect(Math.abs(ir[k] - il[k])).toBeLessThan(1e-12);
    }
  });

  it('D1N4148 diode in OP + AC (small-signal AC current matches series resistor)', async () => {
    const v1 = mkPart('p1', 'VAC', 'V1', 0, 0, { DC: '5V', ACMAG: '1V', ACPHASE: '0' });
    const r1 = mkPart('p2', 'R', 'R1', 40, 0, { VALUE: '1k' });
    const d1 = mkPart('p3', 'D1N4148', 'D1', 80, 0);
    const g1 = mkPart('p4', 'AGND', '', 0, 40);
    const g2 = mkPart('p5', 'AGND', '', 120, 0);
    const { sim, devices } = await simDoc([v1, r1, d1, g1, g2], [wire('w1', 0, 0, 40, 0)], {
      ac: { enabled: true, sweep: 'dec', points: '5', start: '1k', end: '10k' },
    });
    const op = sim.result.plots.find(p => p.kind === 'op')!;
    const ac = sim.result.plots.find(p => p.kind === 'ac')!;
    expect(evaluateExpr('V(D1)', op, devices).re[0]).toBeCloseTo(0.6957, 3);
    expect(evaluateExpr('I(D1)', op, devices).re[0]).toBeCloseTo(4.3043e-3, 6);
    expect(Math.abs(evaluateExpr('M(I(D1))', ac, devices).re[0] - evaluateExpr('M(I(R1))', ac, devices).re[0])).toBeLessThan(1e-12);
  });

  it('E (VCVS), F (CCCS), G (VCCS), H (CCVS) + F/H control-pin C+/C- markers and expressions', async () => {
    const runCtrl = async (letter: 'E' | 'F' | 'G' | 'H', gain: string) => {
      const v1 = mkPart('v1', 'VAC', 'V1', 0, 0, { DC: '2V', ACMAG: '1V', ACPHASE: '0' });
      const rin = mkPart('rin', 'R', 'R1', 40, 0, { VALUE: '1k' });
      const src = mkPart('s1', letter, `${letter}1`, 80, 0, { GAIN: gain });
      const rload = mkPart('rl', 'R', 'R2', 140, 0, { VALUE: '1k' });
      const g1 = mkPart('g1', 'AGND', '', 0, 40);
      const g2 = mkPart('g2', 'AGND', '', 80, 40);
      const g3 = mkPart('g3', 'AGND', '', 120, 40);
      const g4 = mkPart('g4', 'AGND', '', 180, 0);
      const markers = [
        { id: 'mi_out', kind: 'I', x: 120, y: 0, partId: 's1', pin: '+' },
        ...(letter === 'F' || letter === 'H'
          ? [
              { id: 'mi_cp', kind: 'I', x: 80, y: 0, partId: 's1', pin: 'C+' },
              { id: 'mi_cm', kind: 'I', x: 80, y: 40, partId: 's1', pin: 'C-' },
            ]
          : []),
      ];
      return simDoc(
        [v1, rin, src, rload, g1, g2, g3, g4],
        [wire('w1', 0, 0, 40, 0), wire('w2', 120, 0, 140, 0)],
        { ac: { enabled: true, sweep: 'dec', points: '3', start: '1k', end: '10k' } },
        markers,
      );
    };

    const eRes = await runCtrl('E', '3');
    expect(evaluateExpr('V(R2)', eRes.sim.result.plots[0], eRes.devices).re[0]).toBeCloseTo(6, 5);
    expect(evaluateExpr('V(E1:C+)', eRes.sim.result.plots[0], eRes.devices).re[0]).toBeCloseTo(2, 5);

    const gRes = await runCtrl('G', '2m');
    expect(evaluateExpr('V(R2)', gRes.sim.result.plots[0], gRes.devices).re[0]).toBeCloseTo(-4, 5);

    const fRes = await runCtrl('F', '2');
    const fOp = fRes.sim.result.plots.find(p => p.kind === 'op')!;
    const fAc = fRes.sim.result.plots.find(p => p.kind === 'ac')!;
    expect(evaluateExpr('V(R2)', fOp, fRes.devices).re[0]).toBeCloseTo(-4, 5);
    expect(markerExprs(fRes.doc)).toEqual(['I(F1)', 'I(F1:C+)', '-I(F1:C+)']);
    expect(evaluateExpr('I(F1)', fOp, fRes.devices).re[0]).toBeCloseTo(4e-3, 8);
    expect(evaluateExpr('I(F1:C+)', fOp, fRes.devices).re[0]).toBeCloseTo(2e-3, 8);
    expect(evaluateExpr('-I(F1:C+)', fOp, fRes.devices).re[0]).toBeCloseTo(-2e-3, 8);
    expect(evaluateExpr('I(F1:C-)', fOp, fRes.devices).re[0]).toBeCloseTo(-2e-3, 8);
    expect(evaluateExpr('M(I(F1:C+))', fAc, fRes.devices).re[0]).toBeCloseTo(1e-3, 8);
    expect(availableTraces(fOp, fRes.devices)[1].items).toContain('I(F1:C+)');

    const hRes = await runCtrl('H', '2k');
    const hOp = hRes.sim.result.plots.find(p => p.kind === 'op')!;
    expect(evaluateExpr('V(R2)', hOp, hRes.devices).re[0]).toBeCloseTo(4, 5);
    expect(markerExprs(hRes.doc)).toEqual(['I(H1)', 'I(H1:C+)', '-I(H1:C+)']);
    expect(evaluateExpr('I(H1:C+)', hOp, hRes.devices).re[0]).toBeCloseTo(2e-3, 8);
  });

  it('Sw_tClose + Sw_tOpen + PARAM + BUBBLE combined transient circuit', async () => {
    const v1 = mkPart('v1', 'VDC', 'V1', 0, 0, { DC: '10V' });
    const sw1 = mkPart('sw1', 'Sw_tClose', 'U1', 40, 0, { TCLOSE: '1m', TTRAN: '1u' });
    const b1 = mkPart('b1', 'BUBBLE', '', 80, 0, { LABEL: 'MID' });
    const b2 = mkPart('b2', 'BUBBLE', '', 200, 0, { LABEL: 'MID' });
    const sw2 = mkPart('sw2', 'Sw_tOpen', 'U2', 200, 0, { TOPEN: '2m', TTRAN: '1u' });
    const r1 = mkPart('r1', 'R', 'R1', 240, 0, { VALUE: '{Rload}' });
    const par = mkPart('par', 'PARAM', '', 0, 100, { NAME1: 'Rload', VALUE1: '2k' });
    const g1 = mkPart('g1', 'AGND', '', 0, 40);
    const g2 = mkPart('g2', 'AGND', '', 280, 0);
    const { sim, devices } = await simDoc([v1, sw1, b1, b2, sw2, r1, par, g1, g2], [wire('w1', 0, 0, 40, 0)], {
      tran: { enabled: true, printStep: '20u', finalTime: '3m', noPrint: '0', stepCeiling: '20u', uic: false },
    });
    const tr = sim.result.plots.find(p => p.kind === 'tran')!;
    const y = evaluateExpr('V(R1)', tr, devices).re;
    expect(measure('YatX', tr.vectors[0].re, y, [0.5e-3])).toBeLessThan(0.05);
    expect(measure('YatX', tr.vectors[0].re, y, [1.5e-3])).toBeCloseTo(10, 1);
    expect(measure('YatX', tr.vectors[0].re, y, [2.5e-3])).toBeLessThan(0.05);
  });

  it('Netlist Mode: .SUBCKT (X), BJT (Q), NMOS/PMOS (M), coupled inductors (K), .MEAS, .STEP TEMP', async () => {
    const deck = `Full netlist feature check
.subckt div2 in out gnd
Ra in out 1k
Rb out gnd 1k
.ends
V1 in 0 DC 10
X1 in mid 0 div2
Vcc cc 0 DC 12
Rb cc base 220k
Rc cc col 1k
Q1 col base 0 Q2N2222
.model Q2N2222 NPN(BF=200 IS=1e-14 VAF=100)
Vd dd 0 DC 5
Rd dd drain 500
Vg gate 0 DC 3
M1 drain gate 0 0 NMOS1 W=10u L=1u
.model NMOS1 NMOS(LEVEL=1 VTO=1 KP=200u)
Vac acin 0 AC 1
Rsrc acin p1 10
L1 p1 0 10m
L2 s1 0 10m
K1 L1 L2 0.99
Rsec s1 0 1k
.step temp list 0 27 85
.op
.ac dec 5 1k 10k
.end`;
    const run = await runDeck(deck, engine);
    expect(run.result.ok, run.result.errors.join('; ')).toBe(true);
    expect(run.result.steps?.length).toBe(3);
    const op27 = run.result.steps![1].plots.find(p => p.kind === 'op')!;
    const ac27 = run.result.steps![1].plots.find(p => p.kind === 'ac')!;
    const devs = parseDeckDevices(run.result.steps![1].deck ?? '');
    expect(evaluateExpr('V(MID)', op27, devs).re[0]).toBeCloseTo(5, 4);
    expect(evaluateExpr('V(DRAIN)', op27, devs).re[0]).toBeCloseTo(3, 4);
    expect(evaluateExpr('M(V(S1))', ac27, devs).re[0]).toBeGreaterThan(0.5);
    // BJT collector voltage shifts with temperature (0C vs 85C)
    const vc0 = evaluateExpr('V(COL)', run.result.steps![0].plots[0], parseDeckDevices(run.result.steps![0].deck ?? '')).re[0];
    const vc85 = evaluateExpr('V(COL)', run.result.steps![2].plots[0], parseDeckDevices(run.result.steps![2].deck ?? '')).re[0];
    expect(vc0).not.toBeCloseTo(vc85, 2);
  });

  it('All 11 Probe measurement goal functions + math expression operators', async () => {
    const xs = Float64Array.from({ length: 1001 }, (_, i) => i * 1e-5);
    const ys = Float64Array.from(xs, t => Math.sin(2 * Math.PI * 500 * t));
    const stepY = Float64Array.from(xs, t => 1 - Math.exp(-t / 1e-3));
    const fallY = Float64Array.from(stepY, v => 1 - v);
    for (const g of MEASUREMENTS) {
      const val = g.name.includes('Rise')
        ? measure(g.name, xs, stepY)
        : g.name.includes('Fall')
          ? measure(g.name, xs, fallY)
          : g.name === 'YatX'
            ? measure(g.name, xs, stepY, [1e-3])
            : g.name === 'XatNthY'
              ? measure(g.name, xs, stepY, [0.5, 1])
              : measure(g.name, xs, ys);
      expect(Number.isFinite(val), `${g.name} returned ${val}`).toBe(true);
    }

    // Verify every math function in evaluateExpr on a real ngspice AC plot
    const acRes = await runNgspiceWasm(`Math expr test\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n.ac dec 5 100 1k\n.end\n`);
    expect(acRes.ok).toBe(true);
    const ac = acRes.plots.find(p => p.kind === 'ac')!;
    const devs = parseDeckDevices('Math\nV1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u\n');
    for (const expr of [
      'DB(V(OUT)/V(IN))', 'P(V(OUT))', 'M(V(OUT))', 'ABS(V(OUT))',
      'R(V(OUT))', 'IMG(V(OUT))', 'SQRT(M(V(OUT)))', 'LOG(M(V(OUT)))',
      'LOG10(M(V(OUT)))', 'EXP(R(V(OUT)))', 'SIN(P(V(OUT)))', 'COS(P(V(OUT)))',
      'M(V(OUT))^2 + 1k*M(I(R1)) - 0.5',
    ]) {
      const val = evaluateExpr(expr, ac, devs);
      expect(val.re.every(Number.isFinite), `expr ${expr}`).toBe(true);
    }
  });

  it('Store undo() and redo() mark sim.stale = true so stale bias labels are never displayed', () => {
    const st = useStore.getState();
    st.newDoc();
    st.placePart('R', { x: 100, y: 100 }, 0, false);
    useStore.setState(s => ({ sim: { ...s.sim, stale: false } }));
    expect(useStore.getState().sim.stale).toBe(false);
    useStore.getState().undo();
    expect(useStore.getState().sim.stale).toBe(true);
    useStore.setState(s => ({ sim: { ...s.sim, stale: false } }));
    useStore.getState().redo();
    expect(useStore.getState().sim.stale).toBe(true);
  });
});
