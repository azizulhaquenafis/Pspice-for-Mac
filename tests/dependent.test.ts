// Dependent sources E, F, G, H (PSpice-style symbols) simulated with real ngspice vs hand calculation.
import { Builder, simulate, vec } from './helpers';
import { generateNetlist, currentVector } from '../src/core/netlist';
import { pinPositions } from '../src/core/library';
import { newId, Rot } from '../src/core/model';

/**
 * Control side: V1 (1 V) — R1 (1 kΩ) — net CTL — C+ ; C− on ground.
 *   E/G see V(C+, C−) = 1 V (no current flows into their control pins).
 *   F/H see a control current of 1 V / 1 kΩ = 1 mA flowing into C+.
 * Output side: + on net OUT with RL = 1 kΩ to ground; − on ground.
 * Pins are joined with net aliases (not routed wires) so every rotation is wired identically.
 */
function circuit(type: 'E' | 'F' | 'G' | 'H', gain: string, rot: Rot = 0) {
  const b = new Builder();
  const label = (pt: { x: number; y: number }, text: string) => b.doc.labels.push({ id: newId('l'), x: pt.x, y: pt.y, text, kind: 'alias' });
  const v1 = b.part('VDC', 'V1', 0, 100, 0, { DC: '1' });
  const r1 = b.part('R', 'R1', 100, 0, 0, { VALUE: '1k' });
  const rl = b.part('R', 'RL', 600, 100, 3, { VALUE: '1k' });
  const x = b.part(type, `${type}1`, 300, 300, rot, { GAIN: gain });
  const P = Object.fromEntries(pinPositions(x).map(p => [p.name, { x: p.x, y: p.y }]));
  label(b.pin(v1, '+'), 'VIN'); label(b.pin(r1, '1'), 'VIN');
  label(b.pin(r1, '2'), 'CTL'); label(P['C+'], 'CTL');
  label(P['C-'], '0'); label(P['-'], '0'); label(b.pin(v1, '-'), '0'); label(b.pin(rl, '2'), '0');
  label(P['+'], 'OUT'); label(b.pin(rl, '1'), 'OUT');
  b.gnd({ x: 0, y: 140 });
  return { b, x };
}

describe('dependent sources', () => {
  it('E (VCVS): V(OUT) = GAIN · V(C+, C−) = 2 V', async () => {
    const p = await simulate(circuit('E', '2').b.doc);
    expect(vec(p, 'op', 'v(out)')[0]).toBeCloseTo(2, 9);
  });
  it('G (VCCS): GAIN·V(C+,C−) = 1 mA flows + → − through the source, so V(OUT) = −1 V on 1 kΩ', async () => {
    const p = await simulate(circuit('G', '1m').b.doc);
    expect(vec(p, 'op', 'v(out)')[0]).toBeCloseTo(-1, 9);
  });
  it('F (CCCS): 1 mA control current into C+, GAIN 2 → 2 mA + → − through the source, V(OUT) = −2 V', async () => {
    const { b, x } = circuit('F', '2');
    const nl = generateNetlist(b.doc);
    expect(nl.text).toMatch(/^V__SENSE_F1 \S+ \S+ 0$/m);
    expect(nl.text).toMatch(/^F1 OUT 0 V__SENSE_F1 2$/m);
    const p = await simulate(b.doc);
    expect(vec(p, 'op', 'v(out)')[0]).toBeCloseTo(-2, 9);
    const cv = currentVector(x, 'C+', 'F1')!;
    expect(cv.sign * vec(p, 'op', cv.vec)[0]).toBeCloseTo(1e-3, 12); // control current into C+
    const co = currentVector(x, '+', 'F1')!;
    expect(co.sign * vec(p, 'op', co.vec)[0]).toBeCloseTo(2e-3, 12);  // output current into +
  });
  it('H (CCVS): 1 mA control current, GAIN 1k Ω → V(OUT) = 1 V', async () => {
    const p = await simulate(circuit('H', '1k').b.doc);
    expect(vec(p, 'op', 'v(out)')[0]).toBeCloseTo(1, 9);
  });
  it.each([1, 2, 3] as Rot[])('rotation %i keeps E/F/G/H electrically identical', async rot => {
    for (const [t, g, want] of [['E', '2', 2], ['F', '2', -2], ['G', '1m', -1], ['H', '1k', 1]] as const) {
      const p = await simulate(circuit(t, g, rot).b.doc);
      expect(vec(p, 'op', 'v(out)')[0]).toBeCloseTo(want, 9);
    }
  });
});
