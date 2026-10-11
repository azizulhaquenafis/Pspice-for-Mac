// Maximum power transfer: sweeping a load resistance given as a global parameter {RL}.
// VS = 10 V, RS = 50 Ω  →  P(RL) = VS²·RL/(RS+RL)², maximum 0.5 W at RL = RS.
import { Builder, engine } from './helpers';
import { newId } from '../src/core/model';
import { runSchematic } from '../src/sim/schematicSim';
import { runParametric } from '../src/sim/parametric';
import { runDeck } from '../src/sim/netlistSim';
import { generateNetlist } from '../src/core/netlist';
import { translateDeck } from '../src/core/deckTranslate';
import { evaluateExpr, parseDeckDevices } from '../src/sim/expr';
import { markerExprs, xAxis } from '../src/ui/probeModel';
import { Plot } from '../src/sim/types';

const P = (rl: number) => 100 * rl / (50 + rl) ** 2;
function maxPower() {
  const b = new Builder(); b.doc.title = 'MaxPower';
  b.part('VDC', 'VS', 0, 100, 0, { DC: '10' });
  b.wire({ x: 0, y: 100 }, { x: 0, y: 60 }); b.wire({ x: 0, y: 60 }, { x: 40, y: 60 });
  b.part('R', 'RS', 40, 60, 0, { VALUE: '50' });
  b.wire({ x: 80, y: 60 }, { x: 120, y: 60 });
  const rl = b.part('R', 'RL', 120, 60, 3, { VALUE: '{RL}' });
  b.wire({ x: 120, y: 100 }, { x: 120, y: 140 }); b.gnd({ x: 120, y: 140 }); b.gnd({ x: 0, y: 140 });
  b.part('PARAM', '', 200, 200, 0, { NAME1: 'RL', VALUE1: '50' });
  b.doc.labels.push({ id: newId('l'), x: 100, y: 60, text: 'OUT', kind: 'alias' });
  b.doc.markers.push({ id: newId('m'), kind: 'W', x: 120, y: 80, partId: rl.id });
  return b;
}
const checkCurve = (plot: Plot, deck: string, xs: number[]) => {
  expect(plot.kind).toBe('dc');
  expect([...plot.vectors[0].re]).toEqual(xs.map(x => expect.closeTo(x, 9)));
  const w = evaluateExpr('W(RL)', plot, parseDeckDevices(deck)).re;
  xs.forEach((x, i) => expect(w[i]).toBeCloseTo(P(x), 9));
  return w;
};

describe('maximum power transfer — schematic', () => {
  it('DC Sweep of global parameter RL (10 … 200 Ω): W(RL) follows V²RL/(RS+RL)², maximum 0.5 W at RL = 50 Ω', async () => {
    const b = maxPower();
    b.doc.profile.dc = { enabled: true, varType: 'global', source: 'RL', sweep: 'lin', start: '10', end: '200', incr: '10', values: '' };
    expect(generateNetlist(b.doc).text).not.toMatch(/^\.dc/m);           // stepped, not a .dc line
    const run = await runSchematic(b.doc, engine);
    expect(run.result.ok).toBe(true);
    const plot = run.result.plots.find(p => p.kind === 'dc')!;
    const xs = Array.from({ length: 20 }, (_, i) => 10 + 10 * i);
    const w = checkCurve(plot, run.deck, xs);
    expect(xs[w.indexOf(Math.max(...w))]).toBe(50);
    expect(Math.max(...w)).toBeCloseTo(0.5, 9);
    expect(markerExprs(b.doc)).toEqual(['W(RL)']);                        // the marker on RL plots exactly this
    const ax = xAxis(plot, run.deck);
    expect(ax.label).toBe('RL'); expect(ax.unit).toBe('Ω'); expect(ax.log).toBe(false);
    expect(run.result.plots.find(p => p.kind === 'op')!.vectors.find(v => v.name === 'v(out)')!.re[0]).toBeCloseTo(5, 9);  // nominal RL = 50
  });
  it('decade and list DC sweeps of RL; decade gets a log axis', async () => {
    const b = maxPower();
    b.doc.profile.dc = { enabled: true, varType: 'global', source: 'RL', sweep: 'dec', start: '1', end: '1k', incr: '5', values: '' };
    const run = await runSchematic(b.doc, engine);
    const plot = run.result.plots.find(p => p.kind === 'dc')!;
    const xs = Array.from({ length: 16 }, (_, i) => 10 ** (i / 5));
    checkCurve(plot, run.deck, xs);
    expect(xAxis(plot, run.deck).log).toBe(true);
    b.doc.profile.dc = { ...b.doc.profile.dc, sweep: 'list', values: '25 50 100' };
    const r2 = await runSchematic(b.doc, engine);
    checkCurve(r2.result.plots.find(p => p.kind === 'dc')!, r2.deck, [25, 50, 100]);
  });
  it('Parametric sweep of RL with only the bias point: Probe gets a "Bias point vs RL" curve', async () => {
    const b = maxPower();
    b.doc.profile.param = { enabled: true, varType: 'global', name: 'RL', sweep: 'list', start: '', end: '', incr: '', values: '10 25 50 100 200' };
    const run = await runParametric(b.doc, engine);
    expect(run.result.ok).toBe(true);
    expect(run.result.sweepPlots).toHaveLength(1);
    const plot = run.result.sweepPlots![0];
    expect(plot.title).toMatch(/Bias point vs RL/);
    checkCurve(plot, run.result.steps![0].deck!, [10, 25, 50, 100, 200]);
  });
  it('validation: undefined parameter; DC sweep of a source and of TEMP still use ngspice .dc', () => {
    const b = maxPower();
    b.doc.profile.dc = { enabled: true, varType: 'global', source: 'RX', sweep: 'lin', start: '1', end: '2', incr: '1', values: '' };
    expect(generateNetlist(b.doc).diagnostics.map(d => d.message).join()).toMatch(/global parameter "RX" is not defined/);
    b.doc.profile.dc = { enabled: true, varType: 'temp', source: '', sweep: 'lin', start: '0', end: '100', incr: '50', values: '' };
    expect(generateNetlist(b.doc).text).toMatch(/^\.dc TEMP 0 100 50$/m);
    b.doc.profile.dc = { enabled: true, varType: 'source', source: 'VS', sweep: 'lin', start: '0', end: '10', incr: '0.001', values: '' };
    expect(generateNetlist(b.doc).text).toMatch(/^\.dc VS 0 10 0\.001$/m);  // native sweeps keep any number of points
  });
  it('DC sweep of a source on a decade scale runs stepped bias points', async () => {
    const b = maxPower();
    b.doc.profile.dc = { enabled: true, varType: 'source', source: 'VS', sweep: 'dec', start: '1', end: '100', incr: '2', values: '' };
    const run = await runSchematic(b.doc, engine);
    const plot = run.result.plots.find(p => p.kind === 'dc')!;
    expect(xAxis(plot, run.deck).label).toBe('V_VS');
    expect([...plot.vectors.find(v => v.name === 'v(out)')!.re]).toEqual([1, 10 ** 0.5, 10, 10 ** 1.5, 100].map(v => expect.closeTo(v / 2, 9)));
  });
});

describe('maximum power transfer — Netlist Mode', () => {
  const deck = (dc: string) => `max power\nVS IN 0 10\nRS IN OUT 50\nRL OUT 0 {RL}\n.param RL=50\n${dc}\n.end\n`;
  it('.DC PARAM RL 10 200 10 (and LIN form): W(RL) curve with the maximum at 50 Ω', async () => {
    for (const dc of ['.DC PARAM RL 10 200 10', '.DC LIN PARAM RL 10 200 10']) {
      const run = await runDeck(deck(dc), engine);
      expect(run.result.ok).toBe(true);
      const plot = run.result.plots.find(p => p.kind === 'dc')!;
      const xs = Array.from({ length: 20 }, (_, i) => 10 + 10 * i);
      const w = checkCurve(plot, run.deck, xs);
      expect(xs[w.indexOf(Math.max(...w))]).toBe(50);
      expect(xAxis(plot, run.deck).label).toBe('RL');
    }
  });
  it('.DC DEC PARAM and .DC PARAM ... LIST', async () => {
    const r1 = await runDeck(deck('.DC DEC PARAM RL 10 1k 2'), engine);
    checkCurve(r1.result.plots.find(p => p.kind === 'dc')!, r1.deck, [10, 10 ** 1.5, 100, 10 ** 2.5, 1000]);
    const r2 = await runDeck(deck('.DC PARAM RL LIST 25 50 100'), engine);
    checkCurve(r2.result.plots.find(p => p.kind === 'dc')!, r2.deck, [25, 50, 100]);
  });
  it('.STEP PARAM RL with only .OP: a "Bias point vs RL" curve', async () => {
    const run = await runDeck(deck('.STEP PARAM RL LIST 10 50 100\n.OP'), engine);
    expect(run.result.ok).toBe(true);
    checkCurve(run.result.sweepPlots![0], run.result.steps![0].deck!, [10, 50, 100]);
  });
  it('.DC with LIN keyword on a source is passed to ngspice without it; unsupported forms explain themselves', () => {
    const t = translateDeck(deck('.DC LIN VS 0 10 1'));
    expect(t.errors).toEqual([]); expect(t.text).toMatch(/^\.dc VS 0 10 1$/m);
    expect(translateDeck(deck('.DC DEC VS 1 10 5')).errors.join()).toMatch(/use \.DC DEC PARAM/);
    expect(translateDeck(deck('.DC PARAM RL 0 10 0')).errors.join()).toMatch(/Increment must be non-zero/);
  });
});

describe('maximum power transfer — examples', () => {
  it('schematic example "Maximum Power Transfer" and netlist example both give the 0.5 W peak at 50 Ω', async () => {
    const { maxPowerTransfer } = await import('../src/core/examples');
    const { NETLIST_EXAMPLES } = await import('../src/core/netlistExamples');
    const run = await runSchematic(maxPowerTransfer().doc, engine);
    const plot = run.result.plots.find(p => p.kind === 'dc')!;
    const xs = Array.from({ length: 40 }, (_, i) => 5 + 5 * i);
    const w = checkCurve(plot, run.deck, xs);
    expect(xs[w.indexOf(Math.max(...w))]).toBe(50);
    const nd = await runDeck(NETLIST_EXAMPLES.find(e => /Maximum power/.test(e.name))!.text, engine);
    expect(nd.probes).toEqual(['W(RL)']);
    checkCurve(nd.result.plots.find(p => p.kind === 'dc')!, nd.deck, xs);
  });
});

describe('nested: .STEP of the source resistance with .DC PARAM RL', () => {
  it('each .STEP run has its own W(RL) curve, peaking at RL = RS', async () => {
    const text = `max power family\nVS IN 0 10\nRS IN OUT {RS}\nRL OUT 0 {RL}\n.param RL=50 RS=50\n.STEP PARAM RS LIST 25 100\n.DC PARAM RL LIST 10 25 50 100 200\n.end\n`;
    const run = await runDeck(text, engine);
    expect(run.result.ok).toBe(true);
    const xs = [10, 25, 50, 100, 200];
    for (const [k, rs] of [25, 100].entries()) {
      const st = run.result.steps![k], plot = st.plots.find(p => p.kind === 'dc')!;
      const w = evaluateExpr('W(RL)', plot, parseDeckDevices(st.deck!)).re;
      xs.forEach((x, i) => expect(w[i]).toBeCloseTo(100 * x / (rs + x) ** 2, 9));
      expect(xs[w.indexOf(Math.max(...w))]).toBe(rs);
    }
  });
});
