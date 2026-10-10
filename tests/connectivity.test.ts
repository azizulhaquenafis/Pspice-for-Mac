// Test G: crossing wires stay distinct until a junction is placed.
import { Builder, divider } from './helpers';
import { extractConnectivity } from '../src/core/connectivity';
import { generateNetlist } from '../src/core/netlist';
import { newId } from '../src/core/model';

describe('Test G: connectivity', () => {
  function crossing() {
    const b = new Builder();
    const ra = b.part('R', 'RA', 0, 50);     // horizontal net at y=50 via wire
    const rb = b.part('R', 'RB', 50, 0, 3);  // vertical
    b.doc.wires.push({ id: 'h', a: { x: 40, y: 50 }, b: { x: 120, y: 50 } });   // from RA:2 rightwards
    b.doc.wires.push({ id: 'v', a: { x: 80, y: 0 }, b: { x: 80, y: 100 } });    // vertical, crosses h at (80,50)
    return { b, ra, rb };
  }
  it('crossing wires are not connected', () => {
    const { b } = crossing();
    const c = extractConnectivity(b.doc);
    expect(c.wireNet.get('h')).not.toBe(c.wireNet.get('v'));
    expect(c.junctionDots).toHaveLength(0);
  });
  it('explicit junction connects them', () => {
    const { b } = crossing();
    b.doc.junctions.push({ id: 'j', x: 80, y: 50 });
    const c = extractConnectivity(b.doc);
    expect(c.wireNet.get('h')).toBe(c.wireNet.get('v'));
    expect(c.junctionDots).toEqual([{ x: 80, y: 50 }]);
  });
  it('T-junction (endpoint on wire interior) connects and shows a dot', () => {
    const b = new Builder();
    b.doc.wires.push({ id: 'h', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    b.doc.wires.push({ id: 't', a: { x: 50, y: 0 }, b: { x: 50, y: 50 } });
    const c = extractConnectivity(b.doc);
    expect(c.wireNet.get('h')).toBe(c.wireNet.get('t'));
    expect(c.junctionDots).toEqual([{ x: 50, y: 0 }]);
  });
  it('near-miss (one grid off) does not connect', () => {
    const b = new Builder();
    const r = b.part('R', 'R1', 0, 0);
    b.doc.wires.push({ id: 'w', a: { x: 50, y: 0 }, b: { x: 90, y: 0 } }); // R1:2 is at 40
    const c = extractConnectivity(b.doc);
    expect(c.pinNet.get(`${r.id}:2`)).not.toBe(c.wireNet.get('w'));
  });
  it('divider nets: ground is 0, alias names node, ERC passes', () => {
    const nl = generateNetlist(divider().doc);
    expect(nl.ok).toBe(true);
    expect(nl.text).toMatch(/^R1 N\d+ OUT 2000$/m);
    expect(nl.text).toMatch(/^R2 OUT 0 3000$/m);
    expect(nl.text).toMatch(/^V1 N\d+ 0 DC 10$/m);
  });
  it('ERC: floating pin and missing ground', () => {
    const b = new Builder();
    b.part('R', 'R1', 0, 0);
    const nl = generateNetlist(b.doc);
    expect(nl.ok).toBe(false);
    const msgs = nl.diagnostics.map(d => d.message).join('\n');
    expect(msgs).toMatch(/No ground/); expect(msgs).toMatch(/Floating pin R1:1/);
  });
  it('same alias on separate wires joins nets', () => {
    const b = new Builder();
    b.doc.wires.push({ id: 'a', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } });
    b.doc.wires.push({ id: 'c', a: { x: 0, y: 100 }, b: { x: 50, y: 100 } });
    b.doc.labels.push({ id: newId(), x: 20, y: 0, text: 'X', kind: 'alias' }, { id: newId(), x: 20, y: 100, text: 'X', kind: 'alias' });
    const c = extractConnectivity(b.doc);
    expect(c.wireNet.get('a')).toBe(c.wireNet.get('c'));
  });
});
