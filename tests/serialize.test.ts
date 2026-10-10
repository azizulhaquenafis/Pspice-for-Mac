// Test I: project round trip.
import { divider } from './helpers';
import { serialize, deserialize } from '../src/core/serialize';
import { generateNetlist } from '../src/core/netlist';
import { extractConnectivity } from '../src/core/connectivity';

describe('Test I: project round trip', () => {
  it('preserves parts, connections, properties, profile and markers', () => {
    const b = divider();
    const r1 = b.doc.parts.find(p => p.ref === 'R1')!;
    b.doc.markers.push({ id: 'm1', kind: 'V', x: 100, y: 60 }, { id: 'm2', kind: 'I', x: 40, y: 60, partId: r1.id, pin: '1' });
    b.doc.junctions.push({ id: 'j1', x: 0, y: 60 });
    b.doc.profile.tran = { enabled: true, printStep: '1m', finalTime: '0.5', noPrint: '0', stepCeiling: '', uic: true };
    b.doc.profile.dc.enabled = true;
    const text = serialize(b.doc);
    const back = deserialize(text);
    expect(back).toEqual(b.doc);
    expect(generateNetlist(back).text).toBe(generateNetlist(b.doc).text);
    const c1 = extractConnectivity(b.doc), c2 = extractConnectivity(back);
    expect([...c2.pinNet].map(([k, n]) => [k, n.name])).toEqual([...c1.pinNet].map(([k, n]) => [k, n.name]));
  });
  it('rejects malformed files', () => {
    expect(() => deserialize('{}')).toThrow(/Not an OpenSpice/);
    expect(() => deserialize('nope')).toThrow(/JSON/);
    const bad = JSON.parse(serialize(divider().doc)); bad.parts[0].type = 'EVIL';
    expect(() => deserialize(JSON.stringify(bad))).toThrow(/Unknown part/);
  });
});
