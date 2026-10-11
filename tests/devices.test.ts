// Milestone: sources and semiconductors (VAC, VPULSE, D1N4001, ZENER, QNPN/QPNP, MbreakN/MbreakP).
// Every number is simulated by real ngspice and compared with an independent hand calculation.
import { Builder, simulate, vec, at, engine, rcLowpass } from './helpers';
import { vpulseRC, halfWave, zenerReg, npnCE, pnpBias, nmosCS, pmosSwitch, cmosInverter } from '../src/core/examples';
import { generateNetlist } from '../src/core/netlist';
import { newId, Part } from '../src/core/model';
import { runSchematic } from '../src/sim/schematicSim';
import { evaluateExpr, parseDeckDevices } from '../src/sim/expr';
import { Plot } from '../src/sim/types';

const VT = 8.617087e-5 * 300.15;              // kT/q at 27 °C (ngspice's constant)
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-15);
const plotOf = (plots: Plot[], kind: string) => plots.find(p => p.kind === kind)!;
const v0 = (plots: Plot[], name: string) => vec(plots, 'op', name)[0];
/** Connect a pin to a named net with a net alias (wiring-independent test circuits). */
const tie = (b: Builder, p: Part, pin: string, net: string) => b.doc.labels.push({ id: newId('l'), ...b.pin(p, pin), text: net, kind: 'alias' });
const src = (b: Builder, ref: string, x: number, net: string, dc: string, type = 'VDC', props: Record<string, string> = {}) => {
  const v = b.part(type, ref, x, 400, 0, { DC: dc, ...props }); tie(b, v, '+', net); tie(b, v, '-', '0'); return v;
};
const res = (b: Builder, ref: string, x: number, a: string, c: string, val: string) => {
  const r = b.part('R', ref, x, 500, 0, { VALUE: val }); tie(b, r, '1', a); tie(b, r, '2', c); return r;
};
const ground = (b: Builder) => { const g = b.part('AGND', '', 900, 900, 0); tie(b, g, 'GND', '0'); };
const lineOf = (doc: Builder['doc'], re: RegExp) => generateNetlist(doc).text.split('\n').find(l => re.test(l)) ?? '';
/** ngspice's default RELTOL = 1e-3 (as in PSpice): device-reported currents close KCL/KVL to about this
 *  relative accuracy (checked: with RELTOL = 1e-6 the residual drops to 1e-15). */
const RELTOL = 2e-3;
const nums = (line: string) => (line.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);

// ============================================================ Stage 1: VAC, VPULSE
describe('Stage 1 — VAC', () => {
  it('netlists as "V DC <dc> AC <mag> <phase>"', () => {
    const b = rcLowpass();
    b.doc.parts.find(p => p.ref === 'V1')!.props = { ACMAG: '10', ACPHASE: '0', DC: '0' };
    expect(lineOf(b.doc, /^V1 /)).toMatch(/^V1 \S+ 0 DC 0 AC 10 0$/);
  });
  it('RC low-pass 1 Hz – 100 kHz: |H| and phase match 1/(1+jf/fc) everywhere; fc = 159.15 Hz at −3.01 dB', async () => {
    const b = rcLowpass();
    b.doc.profile.ac = { enabled: true, sweep: 'dec', points: '50', start: '1', end: '100k' };
    const ac = plotOf(await simulate(b.doc), 'ac');
    const f = ac.vectors[0].re, out = ac.vectors.find(v => v.name === 'v(out)')!;
    const fc = 1 / (2 * Math.PI * 1e3 * 1e-6);
    for (let i = 0; i < f.length; i++) {
      const x = f[i] / fc, mag = Math.hypot(out.re[i], out.im![i]), ph = Math.atan2(out.im![i], out.re[i]) * 180 / Math.PI;
      expect(rel(mag, 1 / Math.sqrt(1 + x * x))).toBeLessThan(1e-6);
      expect(Math.abs(ph + Math.atan(x) * 180 / Math.PI)).toBeLessThan(1e-4);
    }
    const db = (i: number) => 20 * Math.log10(Math.hypot(out.re[i], out.im![i]));
    const k = [...f].findIndex((_, i) => db(i) < -3.0103);
    const f3 = Math.exp(Math.log(f[k - 1]) + (Math.log(f[k]) - Math.log(f[k - 1])) * (-3.0103 - db(k - 1)) / (db(k) - db(k - 1)));
    expect(rel(f3, 159.155)).toBeLessThan(2e-3);
    expect(f[0]).toBe(1); expect(f[f.length - 1]).toBeCloseTo(1e5, 6);
  });
  it('AC magnitude does not create a transient sine: V(IN) stays at the DC value', async () => {
    const b = rcLowpass();
    b.doc.parts.find(p => p.ref === 'V1')!.props = { ACMAG: '10', ACPHASE: '0', DC: '2' };
    b.doc.profile.tran = { enabled: true, printStep: '10us', finalTime: '5ms', noPrint: '0', stepCeiling: '', uic: false };
    const t = plotOf(await simulate(b.doc), 'tran');
    const vin = t.vectors.find(v => v.name === 'v(n0001)' || /^v\(n\d+\)$/.test(v.name))!;
    expect(Math.max(...vin.re)).toBeCloseTo(2, 9); expect(Math.min(...vin.re)).toBeCloseTo(2, 9);
  });
  it('DC sweep of a VAC source sweeps its DC value; bias point uses DC', async () => {
    const b = rcLowpass();
    b.doc.parts.find(p => p.ref === 'V1')!.props = { ACMAG: '1', ACPHASE: '0', DC: '3' };
    b.doc.profile.dc = { enabled: true, source: 'V1', start: '-2', end: '2', incr: '1' };
    const p = await simulate(b.doc);
    expect(v0(p, 'v(out)')).toBeCloseTo(3, 9);
    expect([...vec(p, 'dc', 'v(out)')]).toEqual([-2, -1, 0, 1, 2].map(x => expect.closeTo(x, 9)));
  });
  it('AC phase 30° shifts the output phase by 30°', async () => {
    const b = rcLowpass();
    b.doc.parts.find(p => p.ref === 'V1')!.props = { ACMAG: '1', ACPHASE: '30', DC: '0' };
    b.doc.profile.ac = { enabled: true, sweep: 'lin', points: '1', start: '159.155', end: '159.155' };
    const out = plotOf(await simulate(b.doc), 'ac').vectors.find(v => v.name === 'v(out)')!;
    expect(Math.atan2(out.im![0], out.re[0]) * 180 / Math.PI).toBeCloseTo(-15, 2);
  });
});

describe('Stage 1 — VPULSE', () => {
  it('netlists PULSE(V1 V2 TD TR TF PW PER) with the dialog values', () => {
    const l = lineOf(vpulseRC().doc, /^V1 /);
    expect(l).toMatch(/^V1 IN 0 PULSE\(/);
    expect(nums(l.slice(l.indexOf('PULSE')))).toEqual([0, 10, 1e-3, 1e-6, 1e-6, 5e-3, 10e-3]);
  });
  it('waveform: initial, delay, rise, high, fall, low, repetition', async () => {
    const p = await simulate(vpulseRC().doc);
    const t = vec(p, 'tran', 'time'), vin = vec(p, 'tran', 'v(in)');
    expect(at(t, vin, 0.5e-3)).toBeCloseTo(0, 6);                 // before TD
    expect(at(t, vin, 1.0005e-3)).toBeCloseTo(5, 1);             // middle of the 1 µs rise
    expect(at(t, vin, 3e-3)).toBeCloseTo(10, 6);                 // high
    expect(at(t, vin, 6.0015e-3)).toBeCloseTo(5, 1);             // middle of the fall (TD+TR+PW .. +TF)
    expect(at(t, vin, 8e-3)).toBeCloseTo(0, 6);                  // low
    expect(at(t, vin, 13e-3)).toBeCloseTo(10, 6);                // second period (starts at 11 ms)
    expect(at(t, vin, 18e-3)).toBeCloseTo(0, 6);
  });
  it('RC: capacitor charges/discharges exponentially (τ = 1 ms); I(R1) = (V(IN) − V(OUT))/1k', async () => {
    const run = await runSchematic(vpulseRC().doc, engine);
    const p = run.result.plots;
    const t = vec(p, 'tran', 'time'), vo = vec(p, 'tran', 'v(out)'), vi = vec(p, 'tran', 'v(in)'), ir = vec(p, 'tran', 'i(@r1[i])');
    const t0 = 1e-3 + 0.5e-6;                                     // effective start of the step (mid-rise)
    for (const dt of [0.5e-3, 1e-3, 2e-3, 4e-3]) expect(at(t, vo, t0 + dt)).toBeCloseTo(10 * (1 - Math.exp(-dt / 1e-3)), 2);
    const vHigh = 10 * (1 - Math.exp(-5e-3 / 1e-3)), t1 = 6.0015e-3;
    for (const dt of [0.5e-3, 1e-3, 3e-3]) expect(at(t, vo, t1 + dt)).toBeCloseTo(vHigh * Math.exp(-dt / 1e-3), 2);
    for (const tt of [2e-3, 7e-3]) expect(at(t, ir, tt)).toBeCloseTo((at(t, vi, tt) - at(t, vo, tt)) / 1e3, 7);
    // the marker expressions of the example evaluate to the same vectors
    const devs = parseDeckDevices(run.deck), tp = plotOf(p, 'tran');
    expect(evaluateExpr('I(R1)', tp, devs).re[100]).toBe(ir[100]);
  });
  it('zero rise/fall time is accepted (ngspice uses the print step as edge)', async () => {
    const b = vpulseRC();
    Object.assign(b.doc.parts.find(p => p.ref === 'V1')!.props, { TR: '0', TF: '0' });
    const p = await simulate(b.doc);
    const t = vec(p, 'tran', 'time'), vin = vec(p, 'tran', 'v(in)');
    expect(at(t, vin, 1e-3 + 20e-6)).toBeCloseTo(10, 6);          // fully high within two print steps
  });
  it('invalid timing is reported with a useful message', () => {
    const b = vpulseRC(), v = b.doc.parts.find(p => p.ref === 'V1')!;
    Object.assign(v.props, { PW: '9.999ms', TR: '1us', TF: '1us', PER: '10ms' });
    expect(generateNetlist(b.doc).diagnostics.map(d => d.message).join()).toMatch(/longer than the period PER/);
    Object.assign(v.props, { PW: '5ms', TR: '-1us' });
    const n = generateNetlist(b.doc);
    expect(n.ok).toBe(false); expect(n.diagnostics.map(d => d.message).join()).toMatch(/TR must not be negative/);
  });
});

// ============================================================ Stage 2: diodes
const DIODE = { IS: 2.93e-9, N: 1.8, RS: 0.042 };
describe('Stage 2 — D1N4001 and ZENER', () => {
  const series = (type: string, vin: string, flip = false) => {
    const b = new Builder(); ground(b);
    src(b, 'V1', 0, 'IN', vin); res(b, 'R1', 100, 'IN', 'A', '1k');
    const d = b.part(type, 'D1', 200, 600, 0); tie(b, d, flip ? 'K' : 'A', 'A'); tie(b, d, flip ? 'A' : 'K', '0');
    return b;
  };
  it('netlist references the selected model and emits its .model card', () => {
    const t = generateNetlist(series('D1N4001', '5').doc).text;
    expect(t).toMatch(/^D1 A 0 D1N4001$/m);
    const card = t.split('\n').find(l => /^\.model D1N4001 D\(/.test(l))!;
    expect(card.match(/\b[A-Z]+(?==)/g)).toEqual(['IS', 'N', 'RS', 'CJO', 'VJ', 'M', 'TT', 'BV', 'IBV']);
    expect(nums(card.replace(/^\.model D1N4001 D/, '').replace(/[A-Z]+=/g, ' '))).toEqual([2.93e-9, 1.8, 0.042, 36e-12, 0.5, 0.4, 3e-6, 60, 5e-6]);
  });
  it('forward bias (5 V, 1 kΩ): V_D obeys N·Vt·ln(I/IS+1) + I·RS — not a fixed 0.7 V', async () => {
    const p = await simulate(series('D1N4001', '5').doc);
    const vd = v0(p, 'v(a)'), i = v0(p, 'i(@d1[id])');
    expect(rel(i, (5 - vd) / 1e3)).toBeLessThan(RELTOL);
    expect(vd).toBeCloseTo(DIODE.N * VT * Math.log(i / DIODE.IS + 1) + i * DIODE.RS, 4);
    expect(vd).toBeGreaterThan(0.6); expect(vd).toBeLessThan(0.8);
  });
  it('reverse bias (−5 V): only the saturation current flows', async () => {
    const p = await simulate(series('D1N4001', '-5').doc);
    expect(v0(p, 'v(a)')).toBeCloseTo(-5, 4);
    expect(v0(p, 'i(@d1[id])')).toBeCloseTo(-DIODE.IS, 10);
  });
  it('I–V characteristic by DC sweep: exponential with slope 1/(N·Vt), ≈0.96 V at 1 A', async () => {
    const b = new Builder(); ground(b);
    const v = src(b, 'V1', 0, 'A', '0'); void v;
    const d = b.part('D1N4001', 'D1', 200, 600, 0); tie(b, d, 'A', 'A'); tie(b, d, 'K', '0');
    b.doc.profile.dc = { enabled: true, source: 'V1', start: '0', end: '1', incr: '0.01' };
    const p = await simulate(b.doc);
    const vs = vec(p, 'dc', 'v(a)'), id = vec(p, 'dc', 'i(@d1[id])');
    for (let k = 1; k < id.length; k++) expect(id[k]).toBeGreaterThan(id[k - 1]);
    const k30 = vs.findIndex(x => Math.abs(x - 0.3) < 1e-9), k36 = vs.findIndex(x => Math.abs(x - 0.36) < 1e-9);
    expect(Math.log(id[k36] / id[k30]) / 0.06).toBeCloseTo(1 / (DIODE.N * VT), 1);
    const at1A = vs[id.findIndex(x => x >= 1)];
    expect(at1A).toBeGreaterThan(0.93); expect(at1A).toBeLessThan(1.1);      // datasheet: VF ≤ 1.1 V at 1 A
  });
  it('half-wave rectifier example: positive half-cycles pass (minus V_F), negative half-cycles blocked', async () => {
    const p = await simulate(halfWave().doc);
    const t = vec(p, 'tran', 'time'), vi = vec(p, 'tran', 'v(in)'), vo = vec(p, 'tran', 'v(out)');
    const peak = Math.max(...vo);
    expect(peak).toBeGreaterThan(9.1); expect(peak).toBeLessThan(9.4);       // 10 V − V_F(≈9 mA)
    for (const tt of [10e-3, 12e-3, 26e-3]) expect(Math.abs(at(t, vo, tt))).toBeLessThan(1e-3);   // negative half-cycles
    for (const tt of [4.17e-3, 20.8e-3]) expect(at(t, vi, tt) - at(t, vo, tt)).toBeGreaterThan(0.6);
  });
  it('ZENER: distinct symbol from a rectifier diode', async () => {
    const { PART_MAP } = await import('../src/core/library');
    expect(PART_MAP.ZENER.paths).not.toEqual(PART_MAP.D1N4001.paths);
  });
  it('ZENER forward conduction, reverse blocking below BV, breakdown above', async () => {
    const fwd = await simulate(series('ZENER', '5').doc);
    expect(v0(fwd, 'v(a)')).toBeGreaterThan(0.6); expect(v0(fwd, 'v(a)')).toBeLessThan(0.8);
    const below = await simulate(series('ZENER', '-3').doc);
    expect(Math.abs(v0(below, 'i(@d1[id])'))).toBeLessThan(1e-9);
    const above = await simulate(series('ZENER', '-12').doc);
    expect(v0(above, 'v(a)')).toBeLessThan(-5.0); expect(v0(above, 'v(a)')).toBeGreaterThan(-5.3);
  });
  it('Zener regulator example: V(OUT) ≈ 5.1 V; I_Z and power are consistent; regulation vs supply', async () => {
    const run = await runSchematic(zenerReg().doc, engine);
    const p = run.result.plots;
    const vout = v0(p, 'v(out)'), iz = -v0(p, 'i(@d1[id])');             // current into the cathode
    expect(vout).toBeGreaterThan(5.05); expect(vout).toBeLessThan(5.3);
    expect(rel(iz, (12 - vout) / 1e3 - vout / 10e3)).toBeLessThan(RELTOL);
    const devs = parseDeckDevices(run.deck), op = plotOf(p, 'op');
    expect(evaluateExpr('I(D1:K)', op, devs).re[0]).toBeCloseTo(iz, 12);
    expect(evaluateExpr('W(D1)', op, devs).re[0]).toBeCloseTo(vout * iz, 9);   // absorbed: V(A,K)·I(A→K) = (−V)(−I)
    const sweep = plotOf(p, 'dc'), x = sweep.vectors[0].re, vo = sweep.vectors.find(v => v.name === 'v(out)')!.re;
    const y = (s: number) => vo[x.findIndex(q => Math.abs(q - s) < 1e-9)];
    expect(y(3)).toBeCloseTo(3 * 10 / 11, 3);                              // below breakdown: plain divider
    expect(y(15) - y(10)).toBeLessThan(0.1);                                // regulation: 5 V more input → < 0.1 V more output
  });
});

// ============================================================ Stage 3: BJTs
describe('Stage 3 — QNPN / QPNP', () => {
  it('netlist: Q C B E MODEL with the model card', () => {
    const t = generateNetlist(npnCE().doc).text;
    expect(t).toMatch(/^Q1 C B E QNPN$/m);
    expect(t).toMatch(/^\.model QNPN NPN\(IS=1e-14 BF=100 BR=1 VAF=100 CJE=8e-12 CJC=3e-12 TF=4e-10 TR=5e-8\)$/m);
  });
  it('NPN common-emitter: bias point is self-consistent and forward-active; |Av| = gm·(RC‖RL‖ro), phase ≈ 180°', async () => {
    const p = await simulate(npnCE().doc);
    const vb = v0(p, 'v(b)'), vc = v0(p, 'v(c)'), ve = v0(p, 'v(e)');
    const ic = v0(p, 'i(@q1[ic])'), ib = v0(p, 'i(@q1[ib])'), ie = v0(p, 'i(@q1[ie])');
    const vbe = vb - ve;
    expect(vbe).toBeGreaterThan(0.6); expect(vbe).toBeLessThan(0.72);     // from the model, not forced
    expect(Math.abs(ic + ib + ie)).toBeLessThan(1e-9);                    // KCL (substrate current ≈ 0)
    expect(ic / ib).toBeGreaterThan(95); expect(ic / ib).toBeLessThan(115);
    const vth = 12 * 10 / 57, rth = 47e3 * 10e3 / 57e3;
    expect(rel(vth - vb, ib * rth)).toBeLessThan(RELTOL * 10);             // KVL at the base divider (small difference of large numbers)
    expect(rel(ve, -ie * 1e3)).toBeLessThan(RELTOL); expect(rel(12 - vc, ic * 4.7e3)).toBeLessThan(RELTOL);
    expect(vc - ve).toBeGreaterThan(1);                                   // active region
    expect(ic).toBeGreaterThan(1.1e-3); expect(ic).toBeLessThan(1.4e-3);
    // mid-band small-signal gain at 10 kHz (CE = 100 µF is 0.16 Ω ≪ r_e there; at 1 kHz its 1.6 Ω still shifts the phase ≈ 4°)
    const ac = plotOf(p, 'ac'), f = ac.vectors[0].re, k = [...f].findIndex(x => Math.abs(x - 1e4) < 1e-5);
    const out = ac.vectors.find(v => v.name === 'v(out)')!;
    const gm = ic / VT, ro = (100 + (vc - ve)) / ic, rl = 1 / (1 / 4.7e3 + 1 / 10e3 + 1 / ro);
    expect(rel(Math.hypot(out.re[k], out.im![k]), gm * rl)).toBeLessThan(0.05);
    expect(Math.abs(Math.abs(Math.atan2(out.im![k], out.re[k]) * 180 / Math.PI) - 180)).toBeLessThan(3);
  });
  it('NPN cutoff and saturation (DC) and switching (transient)', async () => {
    const sw = (vbase: string) => {
      const b = new Builder(); ground(b);
      src(b, 'VCC', 0, 'VCC', '5'); res(b, 'RC', 100, 'VCC', 'C', '1k');
      src(b, 'VB', 300, 'IN', vbase); res(b, 'RB', 400, 'IN', 'B', '10k');
      const q = b.part('QNPN', 'Q1', 600, 600, 0); tie(b, q, 'C', 'C'); tie(b, q, 'B', 'B'); tie(b, q, 'E', '0');
      return b;
    };
    const off = await simulate(sw('0').doc);
    expect(Math.abs(v0(off, 'i(@q1[ic])'))).toBeLessThan(1e-9); expect(v0(off, 'v(c)')).toBeCloseTo(5, 5);
    const on = await simulate(sw('5').doc);
    expect(v0(on, 'v(c)')).toBeLessThan(0.2);                            // saturated: VCE(sat)
    expect(v0(on, 'i(@q1[ic])') / v0(on, 'i(@q1[ib])')).toBeLessThan(20); // forced beta ≪ BF
    const b = sw('0');
    b.doc.parts.find(p => p.ref === 'VB')!.type = 'VPULSE';
    Object.assign(b.doc.parts.find(p => p.ref === 'VB')!.props, { V1: '0', V2: '5', TD: '10us', TR: '10ns', TF: '10ns', PW: '20us', PER: '50us', AC: '' });
    b.doc.profile.tran = { enabled: true, printStep: '50ns', finalTime: '50us', noPrint: '0', stepCeiling: '50ns', uic: false };
    const tp = await simulate(b.doc), t = vec(tp, 'tran', 'time'), vc = vec(tp, 'tran', 'v(c)');
    expect(at(t, vc, 5e-6)).toBeCloseTo(5, 3); expect(at(t, vc, 20e-6)).toBeLessThan(0.2); expect(at(t, vc, 45e-6)).toBeCloseTo(5, 2);
  });
  it('PNP bias example: polarities (V_E > V_B > V_C, currents out of C and B, into E), V_EB from the model', async () => {
    const p = await simulate(pnpBias().doc);
    const vb = v0(p, 'v(b)'), vc = v0(p, 'v(c)'), ve = v0(p, 'v(e)');
    const ic = v0(p, 'i(@q1[ic])'), ib = v0(p, 'i(@q1[ib])'), ie = v0(p, 'i(@q1[ie])');
    expect(ve).toBeGreaterThan(vb); expect(vb).toBeGreaterThan(vc);
    expect(ve - vb).toBeGreaterThan(0.6); expect(ve - vb).toBeLessThan(0.72);
    expect(ic).toBeLessThan(0); expect(ib).toBeLessThan(0); expect(ie).toBeGreaterThan(0);
    expect(ic + ib + ie).toBeCloseTo(0, 9);
    expect(rel(12 - ve, ie * 1e3)).toBeLessThan(RELTOL); expect(rel(vc, -ic * 4.7e3)).toBeLessThan(RELTOL);
    expect(ve - vc).toBeGreaterThan(1);                                   // active
    expect(ic / ib).toBeGreaterThan(95); expect(ic / ib).toBeLessThan(115);
  });
});

// ============================================================ Stage 4: MOSFETs
const BETA_N = 200e-6 * 10, LAM = 0.02;     // KP·W/L for MbreakN (W = 10u, L = 1u)
const idSat = (vov: number, vds: number, beta = BETA_N) => 0.5 * beta * vov * vov * (1 + LAM * vds);
const idLin = (vov: number, vds: number, beta = BETA_N) => beta * (vov * vds - vds * vds / 2) * (1 + LAM * vds);
describe('Stage 4 — MbreakN / MbreakP', () => {
  const nmos = (vg: string, vd: string, extra: (b: Builder, m: Part) => void = () => {}) => {
    const b = new Builder(); ground(b);
    src(b, 'VG', 0, 'G', vg); src(b, 'VD', 100, 'D', vd);
    const m = b.part('MbreakN', 'M1', 600, 600, 0); tie(b, m, 'D', 'D'); tie(b, m, 'G', 'G'); tie(b, m, 'S', '0'); tie(b, m, 'B', '0');
    extra(b, m); return b;
  };
  it('netlist: M D G S B MODEL W= L=, LEVEL=1 card', () => {
    const t = generateNetlist(nmosCS().doc).text;
    const m = t.split('\n').find(l => /^M1 /.test(l))!;
    expect(m).toMatch(/^M1 OUT G 0 0 MbreakN W=\S+ L=\S+$/);
    expect(nums(m.slice(m.indexOf('W=')))).toEqual([10e-6, 1e-6]);
    const card = t.split('\n').find(l => /^\.model MbreakN NMOS\(/.test(l))!;
    expect(card.match(/\b[A-Z]+(?==)/g)).toEqual(['LEVEL', 'VTO', 'KP', 'LAMBDA', 'GAMMA', 'PHI']);
    expect(nums(card.replace(/^\.model MbreakN NMOS/, '').replace(/[A-Z]+=/g, ' '))).toEqual([1, 1, 200e-6, 0.02, 0, 0.6]);
  });
  it('NMOS I_D vs V_GS (V_DS = 5 V): zero below VTO, square law above', async () => {
    const b = nmos('0', '5');
    b.doc.profile.dc = { enabled: true, source: 'VG', start: '0', end: '5', incr: '0.1' };
    const p = await simulate(b.doc), vg = vec(p, 'dc', 'v(g)'), id = vec(p, 'dc', 'i(@m1[id])');
    for (let k = 0; k < vg.length; k++) {
      if (vg[k] < 0.95) expect(Math.abs(id[k])).toBeLessThan(1e-9);
      else if (vg[k] > 1.05) expect(rel(id[k], idSat(vg[k] - 1, 5))).toBeLessThan(1e-4);
    }
  });
  it('NMOS I_D vs V_DS (V_GS = 3 V): triode then saturation at V_DS = V_GS − VTO', async () => {
    const b = nmos('3', '0');
    b.doc.profile.dc = { enabled: true, source: 'VD', start: '0', end: '5', incr: '0.1' };
    const p = await simulate(b.doc), vd = vec(p, 'dc', 'v(d)'), id = vec(p, 'dc', 'i(@m1[id])');
    for (let k = 1; k < vd.length; k++) {
      const want = vd[k] < 2 ? idLin(2, vd[k]) : idSat(2, vd[k]);
      expect(rel(id[k], want)).toBeLessThan(1e-4);
    }
  });
  it('bulk terminal: V_SB = 2 V with GAMMA = 0.5 raises the threshold by γ(√(2+φ) − √φ)', async () => {
    const b = nmos('3', '5');
    const m = b.doc.parts.find(p => p.ref === 'M1')!; m.props.GAMMA = '0.5';
    b.doc.labels = b.doc.labels.filter(l => !(l.x === b.pin(m, 'B').x && l.y === b.pin(m, 'B').y));
    tie(b, m, 'B', 'BULK'); src(b, 'VB', 200, 'BULK', '-2');
    const p = await simulate(b.doc);
    const vt = 1 + 0.5 * (Math.sqrt(2 + 0.6) - Math.sqrt(0.6));
    expect(rel(v0(p, 'i(@m1[id])'), idSat(3 - vt, 5))).toBeLessThan(1e-4);
    expect(v0(p, 'i(@m1[ib])')).toBeLessThan(0);                          // reverse-biased bulk junction: tiny leakage out of B
  });
  it('NMOS with resistive drain load (5 V, 1 kΩ, V_GS = 3 V): triode operating point satisfies both equations', async () => {
    const b = new Builder(); ground(b);
    src(b, 'VG', 0, 'G', '3'); src(b, 'VDD', 100, 'VDD', '5'); res(b, 'RD', 200, 'VDD', 'D', '1k');
    const m = b.part('MbreakN', 'M1', 600, 600, 0); tie(b, m, 'D', 'D'); tie(b, m, 'G', 'G'); tie(b, m, 'S', '0'); tie(b, m, 'B', '0');
    const p = await simulate(b.doc), vd = v0(p, 'v(d)'), id = v0(p, 'i(@m1[id])');
    expect(vd).toBeLessThan(2);                                           // V_DS < V_ov: triode
    expect(rel(id, (5 - vd) / 1e3)).toBeLessThan(RELTOL);
    expect(rel(id, idLin(2, vd))).toBeLessThan(1e-4);
  });
  it('NMOS common-source example: I_D from the square law, Av = −gm·(RD‖ro), phase ≈ 180°', async () => {
    const p = await simulate(nmosCS().doc);
    const vg = v0(p, 'v(g)'), vd = v0(p, 'v(out)'), id = v0(p, 'i(@m1[id])');
    expect(vg).toBeCloseTo(2, 6);
    expect(rel(id, idSat(vg - 1, vd))).toBeLessThan(1e-4);
    expect(rel(12 - vd, id * 4.7e3)).toBeLessThan(RELTOL);
    const ac = plotOf(p, 'ac'), f = ac.vectors[0].re, k = [...f].findIndex(x => Math.abs(x - 1e3) < 1e-6);
    const out = ac.vectors.find(v => v.name === 'v(out)')!;
    const gm = BETA_N * (vg - 1) * (1 + LAM * vd), ro = 1 / (LAM * 0.5 * BETA_N * (vg - 1) ** 2);   // g_ds = λ·β/2·V_ov²
    expect(rel(Math.hypot(out.re[k], out.im![k]), gm / (1 / 4.7e3 + 1 / ro))).toBeLessThan(0.01);
    expect(Math.abs(Math.abs(Math.atan2(out.im![k], out.re[k]) * 180 / Math.PI) - 180)).toBeLessThan(1);
  });
  it('PMOS switching example (RL 10k): gate low → on (V_OUT ≈ 5 V, current out of the drain); gate high → off', async () => {
    const run = await runSchematic(pmosSwitch().doc, engine);
    const p = run.result.plots, tp = plotOf(p, 'tran'), devs = parseDeckDevices(run.deck);
    const { markerExprs } = await import('../src/ui/probeModel');
    const expr = markerExprs(pmosSwitch().doc).find(e => e?.startsWith('I('))!;
    expect(expr).toBe('I(M1:D)');
    const t = vec(p, 'tran', 'time'), vo = vec(p, 'tran', 'v(out)'), id = evaluateExpr(expr, tp, devs).re;
    const irl = vec(p, 'tran', 'i(@rl[i])');
    const on = at(t, vo, 0.5e-3), off = at(t, vo, 2e-3);
    expect(on).toBeGreaterThan(4.8); expect(Math.abs(off)).toBeLessThan(1e-3);
    expect(rel(at(t, id, 0.5e-3), -on / 10e3)).toBeLessThan(RELTOL);     // into the drain is negative: current flows out to RL
    expect(rel(at(t, id, 0.5e-3), -at(t, irl, 0.5e-3))).toBeLessThan(1e-9);
    const sum = ['D', 'G', 'S', 'B'].map(k => evaluateExpr(`I(M1:${k})`, tp, devs).re[200]).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-12);                            // KCL over the four terminals
    expect(evaluateExpr('IS(M1)', tp, devs).re[200]).toBeGreaterThan(0);  // current enters the source (from VDD)
    // independent check of the on state: PMOS triode with V_SG = 5, |VTO| = 1, β = 100u·10 = 1 mA/V²
    const vsd = 5 - on;
    expect(rel(on / 10e3, idLin(4, vsd, 1e-3))).toBeLessThan(RELTOL);
    expect(at(t, vo, 3.5e-3)).toBeGreaterThan(4.8);                       // gate low again (3–5 ms)
    expect(Math.abs(at(t, vo, 5.5e-3))).toBeLessThan(1e-3);                // second high gate pulse (5–7 ms)
  });
  it('PMOS with resistive load in DC (gate 0 V): same operating point as the switch on-state', async () => {
    const b = new Builder(); ground(b);
    src(b, 'VDD', 0, 'VDD', '5'); src(b, 'VG', 100, 'G', '0'); res(b, 'RL', 200, 'D', '0', '1k');
    const m = b.part('MbreakP', 'M1', 600, 600, 0); tie(b, m, 'S', 'VDD'); tie(b, m, 'B', 'VDD'); tie(b, m, 'G', 'G'); tie(b, m, 'D', 'D');
    const p = await simulate(b.doc), vd = v0(p, 'v(d)');
    expect(rel(vd / 1e3, idLin(4, 5 - vd, 1e-3))).toBeLessThan(1e-4);
  });
  it('CMOS inverter example: high out for low in, low out for high in, threshold V_DD/2; inverts a pulse', async () => {
    const p = await simulate(cmosInverter().doc);
    const vin = vec(p, 'dc', 'v(in)'), vo = vec(p, 'dc', 'v(out)');
    expect(vo[0]).toBeGreaterThan(4.999); expect(vo[vo.length - 1]).toBeLessThan(1e-3);
    const k = vo.findIndex(x => x < 2.5);
    expect(vin[k]).toBeGreaterThan(2.45); expect(vin[k]).toBeLessThan(2.55);   // equal β → switching at V_DD/2
    const t = vec(p, 'tran', 'time'), vt = vec(p, 'tran', 'v(out)');
    expect(at(t, vt, 0.3e-6)).toBeGreaterThan(4.99); expect(at(t, vt, 1.2e-6)).toBeLessThan(0.01); expect(at(t, vt, 1.9e-6)).toBeGreaterThan(4.99);
  });
});

// ============================================================ Stage 5: integration
import { serialize, deserialize } from '../src/core/serialize';
import { pinPositions, findDef, matchesPart, PART_MAP, getDef } from '../src/core/library';
import { markerExprs, availableTraces } from '../src/ui/probeModel';
import { importModelCard } from '../src/ui/Dialogs';
import { useStore } from '../src/state/store';
import { runDeck } from '../src/sim/netlistSim';
import { Rot } from '../src/core/model';
import { runParametric } from '../src/sim/parametric';

const NEW_PARTS = ['VAC', 'VPULSE', 'D1N4001', 'ZENER', 'Dbreak', 'QNPN', 'QPNP', 'MbreakN', 'MbreakP'];
const sweepOver = (b: Builder, name: string, value: string, values: string) => {
  b.part('PARAM', '', 800, 800, 0, { NAME1: name, VALUE1: value });
  b.doc.profile.param = { enabled: true, varType: 'global', name, sweep: 'list', start: '0', end: '0', incr: '0', values };
};
const stepVals = async (b: Builder, kind: string, name: string, pick: (x: Float64Array, y: Float64Array) => number) => {
  const run = await runParametric(b.doc, engine);
  expect(run.result.ok).toBe(true);
  return run.result.steps!.map(s => { const p = s.plots.find(q => q.kind === kind)!; return pick(p.vectors[0].re, p.vectors.find(v => v.name === name)!.re); });
};

describe('Stage 5 — parameters, geometry, persistence, Probe', () => {
  it('VAC ACMAG = {Av}: each run of the sweep uses its own value', async () => {
    const b = rcLowpass(); b.doc.parts.find(p => p.ref === 'V1')!.props.ACMAG = '{Av}';
    b.doc.profile.ac = { enabled: true, sweep: 'lin', points: '1', start: '1', end: '1' };
    sweepOver(b, 'Av', '1', '1 2 5');
    const run = await runParametric(b.doc, engine);
    const mags = run.result.steps!.map(s => { const o = s.plots.find(p => p.kind === 'ac')!.vectors.find(v => v.name === 'v(out)')!; return Math.hypot(o.re[0], o.im![0]); });
    [1, 2, 5].forEach((a, i) => expect(mags[i]).toBeCloseTo(a / Math.sqrt(1 + (1 / 159.155) ** 2), 6));
  });
  it('VPULSE V2 = {Vp}: the pulse height follows the parameter', async () => {
    const b = vpulseRC(); b.doc.parts.find(p => p.ref === 'V1')!.props.V2 = '{Vp}';
    sweepOver(b, 'Vp', '10', '2 4');
    expect(await stepVals(b, 'tran', 'v(in)', (t, y) => at(t, y, 3e-3))).toEqual([expect.closeTo(2, 6), expect.closeTo(4, 6)]);
  });
  it('MOSFET W = {Width} and model VTO = {vt}: drain current recomputed per run (no stale model values)', async () => {
    const mk = () => { const b = new Builder(); ground(b); src(b, 'VG', 0, 'G', '3'); src(b, 'VD', 100, 'D', '5');
      const m = b.part('MbreakN', 'M1', 600, 600, 0); tie(b, m, 'D', 'D'); tie(b, m, 'G', 'G'); tie(b, m, 'S', '0'); tie(b, m, 'B', '0'); return { b, m }; };
    const w = mk(); w.m.props.W = '{Width}'; sweepOver(w.b, 'Width', '10u', '10u 20u');
    const ids = await stepVals(w.b, 'op', 'i(@m1[id])', (_x, y) => y[0]);
    expect(rel(ids[0], idSat(2, 5))).toBeLessThan(1e-4); expect(rel(ids[1], idSat(2, 5, 2 * BETA_N))).toBeLessThan(1e-4);
    const v = mk(); v.m.props.VTO = '{vt}'; sweepOver(v.b, 'vt', '1', '1 2');
    const idv = await stepVals(v.b, 'op', 'i(@m1[id])', (_x, y) => y[0]);
    expect(rel(idv[0], idSat(2, 5))).toBeLessThan(1e-4); expect(rel(idv[1], idSat(1, 5))).toBeLessThan(1e-4);
  });
  it('diode model parameter in EXTRA and a {param} in the card are netlisted; two parts with different cards get separate models', () => {
    const b = halfWave(), d = b.doc.parts.find(p => p.ref === 'D1')!;
    d.props.EXTRA = 'XTI=3 EG={eg}';
    b.part('PARAM', '', 800, 800, 0, { NAME1: 'eg', VALUE1: '1.11' });
    const d2 = b.part('D1N4001', 'D2', 600, 600, 0, { IS: '5n' });
    tie(b, d2, 'A', 'OUT'); tie(b, d2, 'K', '0');
    const n = generateNetlist(b.doc);
    expect(n.text).toMatch(/^\.model D1N4001 D\(.* XTI=3 EG=\{eg\}\)$/m);
    expect(n.text).toMatch(/^D2 OUT 0 D1N4001_D2$/m);
    expect(n.text).toMatch(/^\.model D1N4001_D2 D\(IS=5e-9 /m);
    expect(n.diagnostics.some(x => /different parameters/.test(x.message))).toBe(true);
    d.props.EXTRA = 'XTI 3';
    expect(generateNetlist(b.doc).diagnostics.some(x => x.level === 'error' && /not NAME=value/.test(x.message))).toBe(true);
  });
  it('rotation (0/90/180/270°) and mirror never change pin identity: NPN switch gives the same I_C in all 8 orientations', async () => {
    const ics: number[] = [];
    for (const rot of [0, 1, 2, 3] as Rot[]) for (const mirror of [false, true]) {
      const b = new Builder(); ground(b);
      src(b, 'VCC', 0, 'VCC', '5'); res(b, 'RC', 100, 'VCC', 'C', '1k'); src(b, 'VB', 300, 'IN', '1'); res(b, 'RB', 400, 'IN', 'B', '10k');
      const q = b.part('QNPN', 'Q1', 600, 600, rot); q.mirror = mirror;
      tie(b, q, 'C', 'C'); tie(b, q, 'B', 'B'); tie(b, q, 'E', '0');
      expect(new Set(pinPositions(q).map(p => `${p.x},${p.y}`)).size).toBe(3);
      ics.push(v0(await simulate(b.doc), 'i(@q1[ic])'));
    }
    ics.forEach(i => expect(i).toBe(ics[0]));
    expect(ics[0]).toBeGreaterThan(1e-4);
  });
  it('all new parts: pins on the 10-grid in every orientation; distinct pin positions', () => {
    for (const t of NEW_PARTS) for (const rot of [0, 1, 2, 3] as Rot[]) for (const mirror of [false, true]) {
      const pp = pinPositions({ id: 'x', type: t, ref: 'X1', x: 100, y: 100, rot, mirror, props: {} });
      pp.forEach(p => { expect(p.x % 10).toBe(0); expect(p.y % 10).toBe(0); });
      expect(new Set(pp.map(p => `${p.x},${p.y}`)).size).toBe(pp.length);
    }
  });
  it('every device example survives save → reload with identical netlist and connectivity', () => {
    for (const mk of [vpulseRC, halfWave, zenerReg, npnCE, pnpBias, nmosCS, pmosSwitch, cmosInverter]) {
      const doc = mk().doc, back = deserialize(serialize(doc));
      expect(generateNetlist(back).text).toBe(generateNetlist(doc).text);
      expect(generateNetlist(doc).ok).toBe(true);
    }
  });
  it('place, edit properties, copy/paste and undo/redo work for the new parts', () => {
    const S = () => useStore.getState();
    S().newDoc();
    for (const [i, t] of NEW_PARTS.entries()) S().placePart(t, { x: 100 + 60 * i, y: 100 }, 0, false);
    expect(S().doc.parts.map(p => p.ref)).toEqual(['V1', 'V2', 'D1', 'D2', 'D3', 'Q1', 'Q2', 'M1', 'M2']);
    const m = S().doc.parts.find(p => p.ref === 'M1')!;
    S().commit(d => ({ ...d, parts: d.parts.map(p => p.id === m.id ? { ...p, props: { ...p.props, W: '{Width}' } } : p) }), 'edit');
    useStore.setState({ sel: { parts: [m.id], wires: [], labels: [], junctions: [], markers: [] } });
    S().copy(); S().paste();
    const pasted = S().doc.parts[S().doc.parts.length - 1];
    expect(pasted.type).toBe('MbreakN'); expect(pasted.ref).toBe('M3'); expect(pasted.props.W).toBe('{Width}');
    S().undo(); expect(S().doc.parts).toHaveLength(9);
    S().undo(); expect(S().doc.parts.find(p => p.ref === 'M1')!.props.W).toBe('10u');
    S().redo(); S().redo(); expect(S().doc.parts).toHaveLength(10);
  });
  it('Import .model fills the model fields (unknown parameters → EXTRA) and rejects a wrong device type', () => {
    const r = importModelCard(PART_MAP.QNPN, '.model Q2N3904 NPN(Is=6.734f Xti=3 Eg=1.11 Vaf=74.03 Bf=416.4\n+ Ne=1.259 Ise=6.734f Ikf=66.78m)');
    expect('props' in r && r.props).toMatchObject({ MODEL: 'Q2N3904', IS: '6.734f', VAF: '74.03', BF: '416.4', BR: '', EXTRA: 'XTI=3 EG=1.11 NE=1.259 ISE=6.734f IKF=66.78m' });
    expect(importModelCard(PART_MAP.QNPN, '.model X PNP(BF=50)')).toEqual({ error: 'This part needs a NPN model; the card is PNP' });
  });
  it('Probe: transistor markers and PSpice current forms; currents unavailable in AC are an error, not zero', async () => {
    const doc = npnCE().doc, run = await runSchematic(doc, engine);
    const op = plotOf(run.result.plots, 'op'), devs = parseDeckDevices(run.deck);
    const q1 = doc.parts.find(p => p.ref === 'Q1')!;
    doc.markers.push({ id: newId('m'), kind: 'I', x: q1.x, y: q1.y, partId: q1.id, pin: 'C' });
    expect(markerExprs(doc)).toContain('I(Q1:C)');
    expect(evaluateExpr('IC(Q1)', op, devs).re[0]).toBe(evaluateExpr('I(Q1:C)', op, devs).re[0]);
    expect(evaluateExpr('IB(Q1)', op, devs).re[0]).toBe(op.vectors.find(v => v.name === 'i(@q1[ib])')!.re[0]);
    const w = evaluateExpr('W(Q1)', op, devs).re[0];
    const vce = v0(run.result.plots, 'v(c)') - v0(run.result.plots, 'v(e)');
    expect(rel(w, vce * v0(run.result.plots, 'i(@q1[ic])') + (v0(run.result.plots, 'v(b)') - v0(run.result.plots, 'v(e)')) * v0(run.result.plots, 'i(@q1[ib])'))).toBeLessThan(1e-6);
    expect(() => evaluateExpr('V(Q1)', op, devs)).toThrow(/ambiguous/);
    expect(() => evaluateExpr('I(Q1)', op, devs)).toThrow(/needs a terminal/);
    const items = availableTraces(op, devs).flatMap(g => g.items);
    expect(items).toEqual(expect.arrayContaining(['I(Q1:C)', 'I(Q1:B)', 'I(Q1:E)', 'W(Q1)']));
    const ac = plotOf(run.result.plots, 'ac');
    expect(() => evaluateExpr('I(Q1:C)', ac, devs)).toThrow(/not available/);
  });
  it('Netlist Mode: hand-written deck with Q, M (NMOS + PMOS) runs; Probe currents use the into-terminal convention', async () => {
    const deck = `cmos and bjt
VDD vdd 0 5
VIN in 0 0
M1 out in 0 0 MN W=10u L=1u
M2 out in vdd vdd MP W=20u L=1u
RL out 0 10k
VCC vcc 0 5
RB in2 b 10k
VB in2 0 1
RC vcc c 1k
Q1 c b 0 QN
.model MN NMOS(LEVEL=1 VTO=1 KP=200u LAMBDA=0.02)
.model MP PMOS(LEVEL=1 VTO=-1 KP=100u LAMBDA=0.02)
.model QN NPN(IS=1e-14 BF=100)
.op
.end
`;
    const run = await runDeck(deck, engine);
    expect(run.result.ok).toBe(true);
    const op = plotOf(run.result.plots, 'op'), devs = parseDeckDevices(run.deck);
    const iRL = op.vectors.find(v => v.name === 'i(@rl[i])')!.re[0];
    expect(iRL).toBeGreaterThan(4e-4);
    expect(rel(evaluateExpr('I(M2:D)', op, devs).re[0], -iRL)).toBeLessThan(RELTOL);   // PMOS drain sources the load current
    expect(evaluateExpr('ID(M2)', op, devs).re[0]).toBeLessThan(0);
    expect(evaluateExpr('IC(Q1)', op, devs).re[0]).toBeGreaterThan(0);
  });
  it('Part Browser: categories and aliases', () => {
    expect(findDef('NMOS')!.name).toBe('MbreakN'); expect(findDef('pmos')!.name).toBe('MbreakP');
    expect(findDef('NPN')!.name).toBe('QNPN'); expect(findDef('1N4001')!.name).toBe('D1N4001');
    expect(matchesPart(getDef('ZENER'), 'zener')).toBe(true);
    const cat = (n: string) => getDef(n).category;
    expect([cat('VAC'), cat('VPULSE'), cat('VPWL'), cat('IDC')]).toEqual(['Sources', 'Sources', 'Sources', 'Sources']);
    expect([cat('D1N4001'), cat('ZENER'), cat('Dbreak'), cat('QNPN'), cat('QPNP'), cat('MbreakN'), cat('MbreakP')]).toEqual(['Diodes', 'Diodes', 'Diodes', 'BJT', 'BJT', 'MOSFET', 'MOSFET']);
    expect([cat('Sw_tOpen'), cat('PARAM'), cat('AGND'), cat('E'), cat('R')]).toEqual(['Switches', 'Other', 'Other', 'Other', 'Passive']);
  });
});
