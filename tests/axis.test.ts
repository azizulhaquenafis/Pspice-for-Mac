// Probe axis precision: distinct, exact, consistent labels at every zoom level.
import { linearTicks, formatTicks, formatPrecise, niceStep } from '../src/ui/axis';

const PFX: Record<string, number> = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, '': 1, m: 1e-3, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
const parse = (l: string) => { const m = /^(-?[\d.]+)(T|G|M|k|m|µ|n|p|f)?s$/.exec(l)!; return parseFloat(m[1]) * PFX[m[2] ?? '']; };

describe('Probe time axis', () => {
  it.each([
    ['0–4 ms', 0, 4e-3], ['1–3 ms', 1e-3, 3e-3], ['1.99–2.01 ms', 1.99e-3, 2.01e-3],
    ['2.199–2.201 ms', 2.199e-3, 2.201e-3], ['2.1999–2.2001 ms', 2.1999e-3, 2.2001e-3],
    ['0–10 µs', 0, 10e-6], ['0–100 ns', 0, 100e-9], ['-5–5 ms', -5e-3, 5e-3], ['1.000001–1.000002 s', 1.000001, 1.000002],
  ])('%s: distinct labels that read back as the tick values', (_n, a, b) => {
    for (const target of [3, 5, 8, 12]) {
      const { ticks, step } = linearTicks(a, b, target);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      const { labels } = formatTicks(ticks, step, 's');
      expect(new Set(labels).size).toBe(labels.length);
      labels.forEach((l, i) => expect(Math.abs(parse(l) - ticks[i])).toBeLessThan(step * 1e-6));
      for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 15); // even spacing
      expect(labels.every(l => l.replace(/[^\d]/g, '').length <= 9)).toBe(true); // no absurd digit strings
    }
  });
  it('examples from the bug report', () => {
    const f = (a: number, b: number, t: number) => { const r = linearTicks(a, b, t); return formatTicks(r.ticks, r.step, 's').labels; };
    expect(f(0, 4e-3, 4)).toEqual(['0ms', '1ms', '2ms', '3ms', '4ms']);
    expect(f(2e-3, 2.01e-3, 5)).toEqual(['2.000ms', '2.002ms', '2.004ms', '2.006ms', '2.008ms', '2.010ms']);
    expect(f(2.2e-3, 2.2006e-3, 3)).toEqual(['2200.0µs', '2200.2µs', '2200.4µs', '2200.6µs']);
  });
  it('uses 1-2-5 steps', () => {
    expect([1, 2, 5].map(m => niceStep(m * 10, 10) / m)).toEqual([1, 1, 1]);
    expect(niceStep(7, 10)).toBe(1); expect(niceStep(0.03, 10)).toBeCloseTo(0.005, 15);
  });
  it('cursor and delta readouts keep precision', () => {
    expect(formatPrecise(2.20013e-3, 1e-9, 's')).toBe('2.200130ms');
    expect(formatPrecise(2.2e-7, 1e-10, 's')).toBe('220.0ns');
  });
});
