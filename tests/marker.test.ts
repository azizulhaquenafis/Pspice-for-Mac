// PSpice-style marker geometry: bubble up-right of the node, lead + arrowhead to the tip.
import { markerHit, markerBox, MARKER } from '../src/ui/markerShape';

describe('marker shape', () => {
  const m = { x: 100, y: 200 };
  it('is hit on the bubble and along the lead, not elsewhere', () => {
    expect(markerHit(m, { x: m.x + MARKER.dx, y: m.y + MARKER.dy })).toBe(true);  // bubble centre
    expect(markerHit(m, { x: m.x + 15, y: m.y - 15 })).toBe(true);                  // on the arrow/lead
    expect(markerHit(m, { x: m.x - 10, y: m.y + 10 })).toBe(false);                 // below-left of the node
    expect(markerHit(m, { x: m.x + 40, y: m.y })).toBe(false);                      // beside the node
  });
  it('box covers tip to bubble for label avoidance', () => {
    const b = markerBox(m);
    expect(b.x0).toBe(m.x); expect(b.y1).toBe(m.y);
    expect(b.x1).toBeGreaterThan(m.x + MARKER.dx); expect(b.y0).toBeLessThan(m.y + MARKER.dy);
  });
});
