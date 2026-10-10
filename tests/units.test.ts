import { parseSpiceNumber as P, formatEng, spiceNum } from '../src/core/units';

describe('engineering units', () => {
  it.each([
    ['1k', 1e3], ['2.2K', 2.2e3], ['1Meg', 1e6], ['1MEG', 1e6], ['3m', 3e-3], ['3M', 3e-3],
    ['10u', 1e-5], ['100uF', 1e-4], ['4.7n', 4.7e-9], ['5p', 5e-12], ['2f', 2e-15], ['1G', 1e9], ['1T', 1e12],
    ['10V', 10], ['1e3', 1e3], ['-2.5', -2.5], ['.5', 0.5], ['1kohm', 1e3], ['10Hz', 10], ['1mil', 25.4e-6], ['1H', 1],
  ])('%s = %d', (s, v) => { const r = P(s); expect(r.ok).toBe(true); expect(r.value / v).toBeCloseTo(1, 12); });
  it('warns that M is milli', () => expect(P('1M').warning).toMatch(/milli/));
  it.each(['abc', '', '1x', 'k1', '1 k'])('rejects %s', s => expect(P(s).ok).toBe(false));
  it('formats', () => {
    expect(formatEng(0.002)).toBe('2m'); expect(formatEng(6)).toBe('6'); expect(formatEng(1e6)).toBe('1Meg');
    expect(formatEng(-2e-3, 4, 'A')).toBe('-2mA'); expect(formatEng(159.155, 5)).toBe('159.16');
    expect(spiceNum(2000)).toBe('2000'); expect(spiceNum(1e-4)).toBe('0.0001'); expect(spiceNum(1e-15)).toBe('1e-15');
  });
});
