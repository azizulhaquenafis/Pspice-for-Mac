// Netlist Mode: generated vs hand-written decks, .STEP, .MEAS, error lines — real ngspice.
import { divider, switchedRL, engine, at } from './helpers';
import { generateNetlist } from '../src/core/netlist';
import { runDeck, mapErrors } from '../src/sim/netlistSim';
import { runParametric } from '../src/sim/parametric';
import { parseStep } from '../src/core/deckTranslate';
import { NETLIST_EXAMPLES } from '../src/core/netlistExamples';

const vOf = (plots: { kind: string; vectors: { name: string; re: Float64Array }[] }[], kind: string, name: string) =>
  plots.find(p => p.kind === kind)!.vectors.find(v => v.name === name)!.re;

describe('Netlist Mode', () => {
  it('schematic divider -> generated netlist -> run as text deck -> 6 V', async () => {
    const text = generateNetlist(divider().doc).text;
    const run = await runDeck(text, engine);
    expect(run.result.errors).toEqual([]);
    expect(vOf(run.result.plots, 'op', 'v(out)')[0]).toBeCloseTo(6, 9);
  });
  it('GUI-generated and hand-written equivalent netlists give identical results', async () => {
    const hand = await runDeck('divider by hand\nVin IN 0 10\nRa IN OUT 2k\nRb OUT 0 3k\n.OP\n.END\n', engine);
    const gen = await runDeck(generateNetlist(divider().doc).text, engine);
    expect(vOf(hand.result.plots, 'op', 'v(out)')[0]).toBe(vOf(gen.result.plots, 'op', 'v(out)')[0]);
  });
  it('.STEP PARAM LIST runs one simulation per value (matches the schematic parametric sweep)', async () => {
    const deck = generateNetlist(switchedRL().doc).text.replace('.end', '.step param Rh list 1 10 50 100 220\n.end');
    const run = await runDeck(deck, engine);
    expect(run.result.errors).toEqual([]);
    expect(run.result.steps!.map(s => s.label)).toEqual(['Rh = 1', 'Rh = 10', 'Rh = 50', 'Rh = 100', 'Rh = 220']);
    const sch = (await runParametric(switchedRL().doc, engine)).result;
    run.result.steps!.forEach((s, k) => {
      const tp = s.plots.find(p => p.kind === 'tran')!, tq = sch.steps![k].plots.find(p => p.kind === 'tran')!;
      const i1 = tp.vectors.find(v => v.name === 'i(@l1[i])')!.re, i2 = tq.vectors.find(v => v.name === 'i(@l1[i])')!.re;
      expect(at(tp.vectors[0].re, i1, 3.5e-3)).toBeCloseTo(at(tq.vectors[0].re, i2, 3.5e-3), 6);
    });
  });
  it('.STEP parsing forms', () => {
    expect(parseStep('.STEP PARAM R LIST 1 2 3')).toEqual({ kind: 'param', name: 'R', values: [1, 2, 3] });
    expect(parseStep('.step param R 1 3 1')).toEqual({ kind: 'param', name: 'R', values: [1, 2, 3] });
    expect((parseStep('.step dec param R 1 100 1') as { values: number[] }).values.map(v => +v.toPrecision(6))).toEqual([1, 10, 100]);
    expect(parseStep('.step temp list 0 27')).toEqual({ kind: 'temp', name: '', values: [0, 27] });
    expect(parseStep('.step V1 0 5 1')).toMatch(/only PARAM and TEMP/);
  });
  it('.MEAS results are reported', async () => {
    const run = await runDeck('rc\nV1 1 0 PULSE(0 10 0 1u 1u 10 20)\nR1 1 2 1k\nC1 2 0 100u\n.tran 1m 0.5\n.meas tran vat FIND v(2) AT=0.1\n.end\n', engine);
    expect(run.measurements[0].name).toBe('vat');
    expect(run.measurements[0].value).toBeCloseTo(10 * (1 - Math.exp(-1)), 2);
  });
  it('ngspice errors are mapped to editor lines', async () => {
    const text = 'bad deck\nV1 1 0 10\nR1 1 0 abc\n.op\n.end\n';
    const run = await runDeck(text, engine);
    expect(run.result.ok).toBe(false);
    expect(mapErrors(['Error on line 3 :  r1 1 0 abc'], text)[0]).toMatch(/^Line 3:/);
  });
  it.each(NETLIST_EXAMPLES.map(e => [e.name, e.text]))('example "%s" simulates without errors', async (_n, text) => {
    const run = await runDeck(text, engine);
    expect(run.result.errors).toEqual([]);
    expect(run.result.ok).toBe(true);
  });
});
