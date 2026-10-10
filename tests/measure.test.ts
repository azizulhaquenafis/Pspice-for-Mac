import { measure } from '../src/sim/measure';
import { deckComponents } from '../src/sim/deckInfo';

const lin = (n: number, a: number, b: number) => Float64Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
describe('Evaluate Measurement functions', () => {
  const x = lin(10001, 0, 1);
  it('sine: max, min, p-p, average, rms, period', () => {
    const y = x.map(t => 2 * Math.sin(2 * Math.PI * 5 * t));
    expect(measure('Max', x, y)).toBeCloseTo(2, 4); expect(measure('Min', x, y)).toBeCloseTo(-2, 4);
    expect(measure('Peak_to_Peak', x, y)).toBeCloseTo(4, 4); expect(measure('Average', x, y)).toBeCloseTo(0, 6);
    expect(measure('RMS', x, y)).toBeCloseTo(2 / Math.SQRT2, 5); expect(measure('Period', x, y)).toBeCloseTo(0.2, 5);
  });
  it('RC step: rise time 10–90 % = tau·ln 9, YatX, XatNthY', () => {
    const tau = 0.1, y = x.map(t => 10 * (1 - Math.exp(-t / tau)));
    expect(measure('YatX', x, y, [0.1])).toBeCloseTo(10 * (1 - Math.exp(-1)), 4);
    expect(measure('XatNthY', x, y, [5, 1])).toBeCloseTo(tau * Math.log(2), 5);
    // 10%/90% of the actual final value (9.9995) — tau·ln 9 within the tolerance of the finite window
    expect(measure('Risetime_NoOvershoot', x, y)).toBeCloseTo(tau * Math.log(9), 3);
    expect(measure('Falltime_NoOvershoot', x, y)).toBeNaN();
  });
  it('overshoot of an underdamped step', () => {
    const z = 0.2, wn = 30, wd = wn * Math.sqrt(1 - z * z);
    const y = x.map(t => 1 - Math.exp(-z * wn * t) * (Math.cos(wd * t) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * t)));
    // final value is the last sample (still ringing by ~0.25 % at t = 1 s), so allow ±0.5 percentage point
    expect(measure('Overshoot', x, y)).toBeCloseTo(100 * Math.exp(-Math.PI * z / Math.sqrt(1 - z * z)), 0);
  });
});

describe('component values of a run', () => {
  it('resolves {Rh} from .param and lists switches', () => {
    const deck = `* Pass 1: x\nR9 a 0 5\n* Pass 2: transient\n.param Rh=54\nR4 2 1 {Rh}\nL1 0 4 0.24\nS_X7 5 3 __sw_X7 0 SW_X7\nV__sw_X7 __sw_X7 0 PWL(0 1 0.002 1 0.002001 0)\n.model SW_X7 SW(Ron=0.01 Roff=1Meg Vt=0.5 Vh=0)\n.end\n`;
    const rows = deckComponents(deck);
    expect(rows.find(r => r.name === 'R4')!.value).toBe('54Ω  ({Rh})');
    expect(rows.find(r => r.name === 'L1')!.value).toBe('240mH');
    expect(rows.find(r => r.name === 'S_X7')!.value).toMatch(/Ron=0.01.*PWL\(0 1 0.002/);
    expect(rows.some(r => r.name === 'R9')).toBe(false); // pass-1 helper deck ignored
    expect(deckComponents('exp\nR1 1 0 5\n.end\n').map(r => r.name)).toEqual(['R1']); // title line is not a component
  });
});
