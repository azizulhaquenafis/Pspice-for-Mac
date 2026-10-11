// .TRAN TMAX handling and workload limits; the user's switched-RL .STEP deck on real ngspice.
import { planTran, MAX_OUTPUT_POINTS } from '../src/core/tranPlan';
import { translateDeck } from '../src/core/deckTranslate';
import { runDeck } from '../src/sim/netlistSim';
import { parseDeckDevices, evaluateExpr } from '../src/sim/expr';
import { generateNetlist } from '../src/core/netlist';
import { divider, engine, at } from './helpers';
import { spiceNum } from '../src/core/units';
const tranLine = (...v: number[]) => new RegExp(`^\\.tran ${v.map(x => spiceNum(x).replace('.', '\\.')).join(' ')}`, 'm');

const USER_DECK = (tran: string) => `exp

R2         4 3  120
V2         5 0 24V
R5         6 7  180
R4         2 1  {Rh}
X7         5 3 Sw_tOpen PARAMS: tOpen=2ms ttran=1u Rclosed=0.01 Ropen=1Meg
X8         7 0 Sw_tOpen PARAMS: tOpen=2.2ms ttran=1u Rclosed=0.01 Ropen=1Meg
V3         1 0 12V
X2         6 3 Sw_tClose PARAMS: tClose=2ms ttran=1u Rclosed=0.01 Ropen=1Meg
X1         2 3 Sw_tClose PARAMS: tClose=2.2ms ttran=1u Rclosed=0.01 Ropen=1Meg
L1         0 4  0.24H

.param Rh = 1
.step param Rh 70 80 0.5
${tran}
.Probe I(L1)
.End
`;

describe('TMAX (step ceiling) handling', () => {
  it('omitted TMAX → automatic', () => {
    const p = planTran(1e-6, 4e-3, 0, undefined);
    expect(p.error).toBeUndefined(); expect(p.tmaxAuto).toBe(true); expect(p.tmax).toBeCloseTo(4e-3 / 200, 15);
  });
  it('TMAX = 0 → automatic (never an infinitesimal step)', () => {
    const p = planTran(1e-6, 4e-3, 0, 0);
    expect(p.error).toBeUndefined(); expect(p.tmaxAuto).toBe(true); expect(p.tmax).toBeGreaterThan(0);
    expect(p.notes.join()).toMatch(/0 means automatic/);
  });
  it('positive TMAX is used as given; large internal workload is stored at the print step', () => {
    const p = planTran(1e-6, 4e-3, 0, 0.1e-6, 21);
    expect(p.error).toBeUndefined(); expect(p.tmax).toBe(0.1e-6); expect(p.interp).toBe(true);
    expect(planTran(1e-6, 4e-3, 0, 20e-6, 21).interp).toBe(false); // ordinary settings unchanged
  });
  it('invalid TMAX / TSTART / TSTOP are rejected with an explanation', () => {
    expect(planTran(1e-6, 4e-3, 0, -1e-6).error).toMatch(/Step Ceiling .* invalid/);
    expect(planTran(1e-6, 0, 0, undefined).error).toMatch(/Final Time/);
    expect(planTran(1e-6, 4e-3, 5e-3, undefined).error).toMatch(/No-Print Delay/);
  });
  it('Print Step auto-fix (user request 2026-10-11): 0, > Final Time, or ns/ps for a ms run becomes ~TSTOP/1000 on the 1-2-5 series', () => {
    for (const bad of [0, -1e-6, 1e-9, 1e-12]) {
      const p = planTran(bad, 1e-3, 0, undefined);
      expect(p.error).toBeUndefined(); expect(p.tstep).toBeCloseTo(1e-6, 18); expect(p.stepFix).toMatch(/Print Step .* using 1(\.0+)?us/);
    }
    const big = planTran(1e-3, 1e-6, 0, undefined);
    expect(big.error).toBeUndefined(); expect(big.tstep).toBeCloseTo(1e-9, 20); expect(big.stepFix).toMatch(/larger than Final Time/);
    expect(planTran(4e-6, 4e-3, 0, undefined).tstep).toBe(4e-6);       // sensible steps are kept as given
    expect(planTran(4e-6, 4e-3, 0, undefined).stepFix).toBeUndefined();
    expect(planTran(1e-8, 4e-3, 0, undefined).tstep).toBeCloseTo(5e-6, 18); // 4 µs rounded up to 5 µs
  });
  it('limits say per run vs across the sweep and suggest a valid setting', () => {
    const perRun = planTran(1e-6, 4e-3, 0, 1e-10).error!;
    expect(perRun).toMatch(/per run/); expect(perRun).toMatch(/at least 2(\.0+)?ns/);
    // a Print Step that overflows the output budget across a sweep is raised to the finest 1-2-5 value that fits
    const sweep = planTran(0.1e-6, 4e-3, 0, 0.1e-6, 21);
    expect(sweep.error).toBeUndefined(); expect(sweep.stepFix).toMatch(/across 21 runs/);
    expect(sweep.tstep).toBeCloseTo(0.5e-6, 18); expect((21 * 4e-3) / sweep.tstep).toBeLessThanOrEqual(MAX_OUTPUT_POINTS);
    const single = planTran(0.01e-6, 4e-3, 0, 0.01e-6, 1);
    expect(single.error).toBeUndefined(); expect(single.tstep).toBeCloseTo(5e-6, 18); expect(single.interp).toBe(true);
    expect(MAX_OUTPUT_POINTS).toBe(200000);
  });
  it('translator: .tran 1us 4ms 0ms 0 UIC with 21 .STEP runs is accepted', () => {
    const tr = translateDeck(USER_DECK('.tran 1us 4ms 0ms 0 UIC'));
    expect(tr.errors).toEqual([]);
    expect(tr.text).toMatch(tranLine(1e-6, 4e-3, 0, 2e-5)); expect(tr.text).toMatch(/ UIC$/m);
    expect(tr.step!.values).toHaveLength(21);
    expect(tr.probes).toEqual(['I(L1)']);
    expect(tr.text).toMatch(/^S_X7 5 3 __sw_X7 0 SW_X7$/m);
  });
  it('translator: .tran 1us 4ms 0ms 0.1us UIC is accepted with output at the print step', () => {
    const tr = translateDeck(USER_DECK('.tran 1us 4ms 0ms 0.1us UIC'));
    expect(tr.errors).toEqual([]);
    expect(tr.text).toMatch(tranLine(1e-6, 4e-3, 0, 1e-7));
    expect(tr.text).toMatch(/^\.option interp$/m);
  });
  it('schematic Transient dialog: Step Ceiling "0" is automatic, not an error', () => {
    const b = divider();
    b.doc.profile.tran = { enabled: true, printStep: '1us', finalTime: '4ms', noPrint: '0', stepCeiling: '0', uic: false };
    const nl = generateNetlist(b.doc);
    expect(nl.ok).toBe(true);
    expect(nl.text).toMatch(tranLine(1e-6, 4e-3, 0, 2e-5));
  });
});

describe("user's switched-RL deck (.STEP param Rh 70 80 0.5, 21 runs)", () => {
  // Analytical solution with UIC (iL(0) = 0); I(L1) is the current from node 0 into L1 (SPICE convention).
  const Ron = 0.01;
  const expected = (Rh: number, t: number) => {
    const t0 = 0.24 / (120 + Ron), iA = -24 / (120 + 2 * Ron * 0 + Ron);
    const i2 = iA * (1 - Math.exp(-2e-3 / t0));
    if (t < 2e-3) return iA * (1 - Math.exp(-t / t0));
    const t1 = 0.24 / (120 + 180 + 2 * Ron);
    const i22 = i2 * Math.exp(-0.2e-3 / t1);
    if (t < 2.2e-3) return i2 * Math.exp(-(t - 2e-3) / t1);
    const R = Rh + 120 + Ron, iInf = -12 / R, t2 = 0.24 / R;
    return iInf + (i22 - iInf) * Math.exp(-(t - 2.2e-3) / t2);
  };
  it.each([['.tran 1us 4ms 0ms 0 UIC'], ['.tran 1us 4ms 0ms 0.1us UIC']])('%s: I(L1) for all 21 Rh values matches the analytical response', async tran => {
    const run = await runDeck(USER_DECK(tran), engine);
    expect(run.result.errors).toEqual([]);
    const steps = run.result.steps!;
    expect(steps).toHaveLength(21);
    expect(steps.map(s => s.value)).toEqual(Array.from({ length: 21 }, (_, i) => 70 + 0.5 * i));
    const dev = parseDeckDevices(run.deck);
    const finals: number[] = [];
    for (const s of steps) {
      expect(s.ok).toBe(true);
      const tp = s.plots.find(p => p.kind === 'tran')!;
      const t = tp.vectors[0].re, i = evaluateExpr('I(L1)', tp, dev).re; // what Probe plots
      for (const tt of [1e-3, 1.99e-3, 2.1e-3, 2.19e-3, 2.5e-3, 3e-3, 4e-3]) {
        const want = expected(s.value, tt);
        expect(Math.abs(at(t, i, tt) - want), `Rh=${s.value} t=${tt}`).toBeLessThan(Math.abs(want) * 0.005 + 1e-5);
      }
      finals.push(at(t, i, 4e-3));
    }
    expect(new Set(finals.map(f => f.toFixed(6))).size).toBe(21); // every Rh gives a distinct response after 2.2 ms
    if (tran.includes('0.1us')) expect(steps[0].plots.find(p => p.kind === 'tran')!.vectors[0].re.length).toBeLessThanOrEqual(4100);
  }, 60000);
});

describe('.PROBE signals', () => {
  it('keeps the sign of -I(L1) and multiple signals', () => {
    expect(translateDeck('t\nR1 1 0 1\nV1 1 0 1\nL1 1 0 1\n.tran 1m 1\n.probe -I(L1) V(1)\n.end\n').probes).toEqual(['-I(L1)', 'V(1)']);
  });
  it('schematic: Print Step 0 / 1ps is auto-fixed in the generated deck with a warning', () => {
    for (const ps of ['0', '1ps', '1ns']) {
      const b = divider();
      b.doc.profile.tran = { enabled: true, printStep: ps, finalTime: '1ms', noPrint: '0', stepCeiling: '', uic: false };
      const nl = generateNetlist(b.doc);
      expect(nl.ok).toBe(true);
      expect(nl.text).toMatch(tranLine(1e-6, 1e-3, 0, 5e-6));
      expect(nl.diagnostics.some(d => d.level === 'warning' && /Print Step .* using/.test(d.message))).toBe(true);
    }
  });
  it('netlist mode: .tran 0 1ms runs on real ngspice with the fixed Print Step', async () => {
    const run = await runDeck('rc\nV1 IN 0 PULSE(0 1 0 1n 1n 10 20)\nR1 IN OUT 1k\nC1 OUT 0 100n\n.tran 0 1ms\n.end\n', engine);
    expect(run.result.ok).toBe(true);
    expect(run.deck).toMatch(tranLine(1e-6, 1e-3, 0, 5e-6));
    expect(run.notes.join()).toMatch(/Print Step .* using 1(\.0+)?us/);
    const p = run.result.plots.find(p => p.kind === 'tran')!;
    const t = p.vectors[0].re, y = p.vectors.find(v => v.name.toLowerCase() === 'v(out)')!.re;
    expect(at(t, y, 1e-3)).toBeCloseTo(1 - Math.exp(-10), 3);
  });
});
