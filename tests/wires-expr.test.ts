import { insertPins, mergeCollinear, splitAt } from '../src/core/wires';
import { extractConnectivity } from '../src/core/connectivity';
import { evaluateExpr, parseDeckDevices, ExprError } from '../src/sim/expr';
import { runSchematic } from '../src/sim/schematicSim';
import { Builder, divider, rcLowpass, engine } from './helpers';
import { pinPositions } from '../src/core/library';

const W = (ax: number, ay: number, bx: number, by: number) => ({ id: `${ax}${ay}${bx}${by}`, a: { x: ax, y: ay }, b: { x: bx, y: by } });

describe('wire mechanics', () => {
  it('part dropped on a wire is inserted in series (wire between pins removed)', () => {
    const ws = insertPins([W(0, 0, 100, 0)], [{ x: 30, y: 0 }, { x: 70, y: 0 }]);
    expect(ws.map(w => [w.a.x, w.b.x]).sort()).toEqual([[0, 30], [70, 100]]);
  });
  it('vertical part on vertical wire, reversed wire direction', () => {
    const ws = insertPins([W(0, 100, 0, 0)], [{ x: 0, y: 20 }, { x: 0, y: 60 }]);
    expect(ws.map(w => [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)]).sort((a, b) => a[0] - b[0])).toEqual([[0, 20], [60, 100]]);
  });
  it('the resulting circuit is not shorted: pins land on different nets', () => {
    const b = new Builder();
    b.doc.wires = [W(0, 0, 100, 0)];
    const r = b.part('R', 'R1', 30, 0);
    b.doc.wires = insertPins(b.doc.wires, pinPositions(r));
    const c = extractConnectivity(b.doc);
    expect(c.pinNet.get(`${r.id}:1`)).not.toBe(c.pinNet.get(`${r.id}:2`));
  });
  it('a single pin on a wire interior splits the wire there', () => {
    expect(splitAt([W(0, 0, 100, 0)], { x: 40, y: 0 })).toHaveLength(2);
    expect(insertPins([W(0, 0, 100, 0)], [{ x: 40, y: 0 }, { x: 40, y: 40 }])).toHaveLength(2); // perpendicular part
  });
  it('merges collinear pieces, keeps T-junctions, corners and kept points; removes duplicates', () => {
    expect(mergeCollinear([W(0, 0, 50, 0), W(50, 0, 100, 0)], new Set())).toHaveLength(1);
    expect(mergeCollinear([W(0, 0, 50, 0), W(50, 0, 100, 0)], new Set(['50,0']))).toHaveLength(2);
    expect(mergeCollinear([W(0, 0, 50, 0), W(50, 0, 50, 50)], new Set())).toHaveLength(2);
    expect(mergeCollinear([W(0, 0, 50, 0), W(50, 0, 100, 0), W(50, -50, 50, 50)], new Set())).toHaveLength(3);
    expect(mergeCollinear([W(0, 0, 100, 0), W(20, 0, 60, 0), W(0, 0, 100, 0)], new Set())).toHaveLength(1);
  });
});

describe('trace expressions', () => {
  it('V(), differential, across, current, power on the divider', async () => {
    const run = await runSchematic(divider().doc, engine);
    const op = run.result.plots[0];
    const dev = parseDeckDevices(run.deck);
    const e = (x: string) => evaluateExpr(x, op, dev).re[0];
    expect(e('V(OUT)')).toBeCloseTo(6, 9);
    expect(e('V(R1:1) - V(R1:2)')).toBeCloseTo(4, 9);
    expect(e('V(R1:1,R1:2)')).toBeCloseTo(4, 9);
    expect(e('V(R1)')).toBeCloseTo(4, 9);
    expect(e('V(OUT,0)')).toBeCloseTo(6, 9);
    expect(e('I(R1)')).toBeCloseTo(2e-3, 12);
    expect(e('I(R1:2)')).toBeCloseTo(-2e-3, 12);
    expect(e('W(R1)')).toBeCloseTo(8e-3, 12);      // 4 V * 2 mA
    expect(e('W(R2)')).toBeCloseTo(12e-3, 12);
    expect(e('W(V1)')).toBeCloseTo(-20e-3, 12);    // source delivers 20 mW (absorbed power negative)
    expect(e('W(R1)+W(R2)+W(V1)')).toBeCloseTo(0, 12); // power balance
    expect(e('2*(V(OUT)-1k*I(R1))/2^2')).toBeCloseTo(2, 9); // 2*(6-2)/4
    expect(e('-V(OUT)')).toBeCloseTo(-6, 9);
    expect(() => e('V(NOPE)')).toThrow(ExprError);
    expect(() => e('V(OUT')).toThrow(/Missing/);
    expect(() => e('FOO(1)')).toThrow(/Unknown function/);
  });
  it('complex AC: DB(V(OUT)/V(R1:1)) = -3.01 dB, P() = -45° at fc', async () => {
    const b = rcLowpass();
    b.doc.profile.ac = { enabled: true, sweep: 'lin', points: '1', start: '159.1549', end: '159.1549' };
    const run = await runSchematic(b.doc, engine);
    const ac = run.result.plots.find(p => p.kind === 'ac')!;
    const dev = parseDeckDevices(run.deck);
    expect(evaluateExpr('DB(V(OUT)/V(R1:1))', ac, dev).re[0]).toBeCloseTo(-3.0103, 3);
    expect(evaluateExpr('P(V(OUT))', ac, dev).re[0]).toBeCloseTo(-45, 2);
    expect(evaluateExpr('M(V(R1))', ac, dev).re[0]).toBeCloseTo(Math.SQRT1_2, 4); // |V across R| = 1/sqrt2
  });
});
