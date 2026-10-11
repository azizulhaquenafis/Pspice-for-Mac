// Shared snapping rule (wire / alias / junction / marker tools; preview and click use the same function).
import { snapToConnection, SNAP_FOR } from '../src/core/snapping';
import { Builder } from './helpers';

function doc() {
  const b = new Builder();
  const r = b.part('R', 'R1', 100, 100, 0, { VALUE: '1k' });           // pins (100,100) (140,100)
  b.doc.wires.push({ id: 'h', a: { x: 140, y: 100 }, b: { x: 300, y: 100 } });
  b.doc.wires.push({ id: 'v', a: { x: 220, y: 40 }, b: { x: 220, y: 200 } }); // crosses h at (220,100)
  b.part('AGND', '', 400, 400);
  return { d: b.doc, r };
}

describe('snapping', () => {
  const { d, r } = doc();
  it('snaps to a point on a wire, rounded to the grid along the wire', () => {
    expect(snapToConnection(d, { x: 263, y: 104 }, 10, SNAP_FOR.voltageMarker)).toEqual({ p: { x: 260, y: 100 }, kind: 'wire' });
  });
  it('the same raw point always gives the same target (preview == click)', () => {
    const a = snapToConnection(d, { x: 187.3, y: 96.1 }, 10, SNAP_FOR.voltageMarker);
    const b2 = snapToConnection(d, { x: 187.3, y: 96.1 }, 10, SNAP_FOR.voltageMarker);
    expect(a).toEqual(b2);
  });
  it('prefers a pin over a wire point when both are within reach', () => {
    const s = snapToConnection(d, { x: 146, y: 102 }, 10, SNAP_FOR.voltageMarker)!;
    expect(s.kind).toBe('pin'); expect(s.partId).toBe(r.id); expect(s.pin).toBe('2');
  });
  it('current markers snap only to pins (not ground, not plain wire points)', () => {
    expect(snapToConnection(d, { x: 260, y: 101 }, 10, SNAP_FOR.currentMarker)).toBeNull();
    expect(snapToConnection(d, { x: 103, y: 98 }, 10, SNAP_FOR.currentMarker)!.pin).toBe('1');
    expect(snapToConnection(d, { x: 401, y: 401 }, 10, SNAP_FOR.currentMarker)).toBeNull(); // AGND pin excluded
  });
  it('junction tool snaps to wire crossings first', () => {
    expect(snapToConnection(d, { x: 224, y: 96 }, 10, SNAP_FOR.junction)).toEqual({ p: { x: 220, y: 100 }, kind: 'cross' });
  });
  it('pointing at a wire snaps even when the nearest grid point along it is a little farther away', () => {
    expect(snapToConnection(d, { x: 255, y: 102 }, 4, SNAP_FOR.voltageMarker)).toEqual({ p: { x: 260, y: 100 }, kind: 'wire' });
  });
  it('nothing in reach → null (reach is the caller’s screen-pixel tolerance in world units)', () => {
    expect(snapToConnection(d, { x: 260, y: 130 }, 10, SNAP_FOR.voltageMarker)).toBeNull();
    expect(snapToConnection(d, { x: 260, y: 130 }, 40, SNAP_FOR.voltageMarker)).toEqual({ p: { x: 260, y: 100 }, kind: 'wire' });
  });
});
