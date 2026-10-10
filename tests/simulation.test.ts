// Reference circuits vs analytical solutions, simulated with real ngspice.
import { divider, stepSeries, simulate, vec, at } from './helpers';
import { currentVector, generateNetlist } from '../src/core/netlist';

describe('Test A: DC voltage divider', () => {
  it('V(OUT)=6V, I=2mA', async () => {
    const plots = await simulate(divider().doc);
    expect(vec(plots, 'op', 'v(out)')[0]).toBeCloseTo(6, 6);
    expect(vec(plots, 'op', 'i(@r1[i])')[0]).toBeCloseTo(2e-3, 9);
    // SPICE convention: source current flows into + terminal; delivering source => negative
    expect(vec(plots, 'op', 'i(v1)')[0]).toBeCloseTo(-2e-3, 9);
  });
});

describe('Test B: RC charging', () => {
  it('Vc(0.1s) ≈ 6.321V (tau = 0.1s)', async () => {
    const { b } = stepSeries('1k', 'C', '100u');
    b.doc.profile.tran = { enabled: true, printStep: '1m', finalTime: '0.5', noPrint: '0', stepCeiling: '0.5m', uic: false };
    const plots = await simulate(b.doc);
    const t = vec(plots, 'tran', 'time'), v = vec(plots, 'tran', 'v(out)');
    expect(v[0]).toBeCloseTo(0, 6);
    expect(at(t, v, 0.1)).toBeCloseTo(10 * (1 - Math.exp(-1)), 2); // ±0.005 V
    expect(at(t, v, 0.5)).toBeCloseTo(10 * (1 - Math.exp(-5)), 2);
  });
});

describe('Test C: RL step', () => {
  it('IL(0.1s) ≈ 0.6321A (tau = 0.1s)', async () => {
    const { b } = stepSeries('10', 'L', '1');
    b.doc.profile.tran = { enabled: true, printStep: '1m', finalTime: '0.5', noPrint: '0', stepCeiling: '0.5m', uic: true };
    const plots = await simulate(b.doc);
    const t = vec(plots, 'tran', 'time'), i = vec(plots, 'tran', 'i(@l1[i])');
    expect(at(t, i, 0.1)).toBeCloseTo(1 - Math.exp(-1), 3);
  });
});

describe('Test D: series RLC (critically damped)', () => {
  it('matches Vc(t)=10(1-(1+at)e^-at), a=10', async () => {
    const { b } = stepSeries('20', 'C', '0.01', (bb, top) => {
      const l = bb.part('L', 'L1', 100, 60, 0, { VALUE: '1', IC: '0' });
      bb.wire(top, bb.pin(l, '1'));
      return bb.pin(l, '2');
    });
    b.doc.profile.tran = { enabled: true, printStep: '1m', finalTime: '1', noPrint: '0', stepCeiling: '0.5m', uic: true };
    const R = 20, L = 1, C = 0.01;
    const alpha = R / (2 * L), w0 = 1 / Math.sqrt(L * C);
    expect(alpha).toBeCloseTo(w0, 12); // critical damping
    const plots = await simulate(b.doc);
    const t = vec(plots, 'tran', 'time'), v = vec(plots, 'tran', 'v(out)');
    for (const tt of [0.05, 0.1, 0.2, 0.3, 0.5, 0.8]) {
      const exact = 10 * (1 - (1 + alpha * tt) * Math.exp(-alpha * tt));
      expect(Math.abs(at(t, v, tt) - exact)).toBeLessThan(0.02);
    }
    // never overshoots 10V when critically damped
    expect(Math.max(...v)).toBeLessThan(10.01);
  });
});

describe('Test E: DC sweep', () => {
  it('Vout = 0.6 Vin for Vin in [-10, 10]', async () => {
    const b = divider();
    b.doc.profile.dc = { enabled: true, source: 'V1', start: '-10', end: '10', incr: '1' };
    const plots = await simulate(b.doc);
    const vin = vec(plots, 'dc', 'v(v-sweep)'), vout = vec(plots, 'dc', 'v(out)');
    expect(vin.length).toBe(21);
    vin.forEach((x, k) => expect(vout[k]).toBeCloseTo(0.6 * x, 9));
  });
});

describe('Test F: RC low-pass AC', () => {
  it('-3.01 dB at fc = 159.15 Hz', async () => {
    const b = divider();
    const v1 = b.doc.parts.find(p => p.ref === 'V1')!;
    v1.type = 'VAC'; v1.props = { ACMAG: '1', ACPHASE: '0', DC: '0' };
    b.doc.parts.find(p => p.ref === 'R1')!.props.VALUE = '1k';
    const r2 = b.doc.parts.find(p => p.ref === 'R2')!;
    r2.type = 'C'; r2.ref = 'C1'; r2.props = { VALUE: '1u', IC: '' };
    const fc = 1 / (2 * Math.PI * 1e3 * 1e-6);
    expect(fc).toBeCloseTo(159.15, 2);
    b.doc.profile.ac = { enabled: true, sweep: 'lin', points: '1', start: String(fc), end: String(fc) };
    const plots = await simulate(b.doc);
    const p = plots.find(p => p.kind === 'ac')!;
    const v = p.vectors.find(v => v.name === 'v(out)')!;
    const db = 20 * Math.log10(Math.hypot(v.re[0], v.im![0]));
    expect(db).toBeCloseTo(-3.0103, 3);
    expect(Math.atan2(v.im![0], v.re[0]) * 180 / Math.PI).toBeCloseTo(-45, 3);
  });
});

describe('Test H: sign conventions', () => {
  it('current into pin 2 is the negative of current into pin 1', async () => {
    const b = divider();
    const plots = await simulate(b.doc);
    const nl = generateNetlist(b.doc);
    const r1 = b.doc.parts.find(p => p.ref === 'R1')!;
    const i1 = currentVector(r1, '1', nl.spiceName.get(r1.id)!)!;
    const i2 = currentVector(r1, '2', nl.spiceName.get(r1.id)!)!;
    expect(i1.label).toBe('I(R1)'); expect(i2.label).toBe('-I(R1)');
    const raw = vec(plots, 'op', i1.vec)[0];
    expect(i1.sign * raw).toBeCloseTo(2e-3, 9);
    expect(i2.sign * vec(plots, 'op', i2.vec)[0]).toBeCloseTo(-2e-3, 9);
  });
  it('rotating a resistor 180° swaps its pins and reverses its current sign', async () => {
    const b = divider();
    const r2 = b.doc.parts.find(p => p.ref === 'R2')!;
    const before = (await simulate(b.doc));
    r2.rot = 1; r2.y = 100; // same pin locations, pins swapped (pin1 now at bottom)
    const after = await simulate(b.doc);
    expect(vec(after, 'op', 'v(out)')[0]).toBeCloseTo(6, 6);
    expect(vec(after, 'op', 'i(@r2[i])')[0]).toBeCloseTo(-vec(before, 'op', 'i(@r2[i])')[0], 9);
  });
});
