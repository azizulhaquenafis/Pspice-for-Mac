// BUBBLE connectors: nets with the same LABEL are connected without wires.
import { Builder, simulate, vec } from './helpers';
import { extractConnectivity } from '../src/core/connectivity';
import { generateNetlist } from '../src/core/netlist';

describe('BUBBLE part', () => {
  /** Divider drawn with no wires at all: every connection made by bubbles. */
  function bubbleDivider() {
    const b = new Builder();
    const v1 = b.part('VDC', 'V1', 0, 100, 0, { DC: '10' });
    const r1 = b.part('R', 'R1', 200, 100, 0, { VALUE: '2k' });
    const r2 = b.part('R', 'R2', 400, 100, 3, { VALUE: '3k' });
    const bub = (pt: { x: number; y: number }, label: string) => b.part('BUBBLE', '', pt.x, pt.y, 0, { LABEL: label });
    bub(b.pin(v1, '+'), 'VIN'); bub(b.pin(r1, '1'), 'VIN');
    bub(b.pin(r1, '2'), 'OUT'); bub(b.pin(r2, '1'), 'OUT');
    bub(b.pin(r2, '2'), '0'); bub(b.pin(v1, '-'), '0');
    return b;
  }
  it('a divider wired only with bubbles gives V(OUT) = 6 V', async () => {
    const b = bubbleDivider();
    const nl = generateNetlist(b.doc);
    expect(nl.ok).toBe(true);
    expect(nl.text).toMatch(/^R1 VIN OUT 2000$/m);
    expect(nl.text).not.toMatch(/BUBBLE/i);           // bubbles are connectors, not devices
    expect(vec(await simulate(b.doc), 'op', 'v(out)')[0]).toBeCloseTo(6, 9);
  });
  it('a bubble at a wire end joins that wire to the named net', () => {
    const b = new Builder();
    b.doc.wires.push({ id: 'w1', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, { id: 'w2', a: { x: 0, y: 100 }, b: { x: 50, y: 100 } });
    b.part('BUBBLE', '', 50, 0, 0, { LABEL: 'X' }); b.part('BUBBLE', '', 50, 100, 0, { LABEL: 'X' });
    const c = extractConnectivity(b.doc);
    expect(c.wireNet.get('w1')).toBe(c.wireNet.get('w2'));
    expect(c.wireNet.get('w1')!.name).toBe('X');
  });
  it('unlabelled and unattached bubbles are reported', () => {
    const b = new Builder();
    b.part('BUBBLE', '', 0, 0, 0, { LABEL: '' });
    b.part('BUBBLE', '', 100, 100, 0, { LABEL: 'Y' });
    const w = extractConnectivity(b.doc).warnings.join('\n');
    expect(w).toMatch(/has no LABEL/);
    expect(w).toMatch(/BUBBLE "Y" is not attached/);
  });
});
