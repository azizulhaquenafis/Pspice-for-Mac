// Editor behaviour through the real store (same commands as menus/toolbar/canvas).
import { useStore } from '../src/state/store';
import { extractConnectivity } from '../src/core/connectivity';
import { markerExprs } from '../src/ui/probeModel';
import { serialize, deserialize } from '../src/core/serialize';

const S = () => useStore.getState();
const lens = () => S().doc.wires.map(w => [w.a.x, w.a.y, w.b.x, w.b.y].join(',')).sort();

describe('editor wire mechanics (store)', () => {
  beforeEach(() => S().newDoc());

  it('dropping a resistor on a wire cuts the wire and inserts it in series', () => {
    S().addWires([{ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }]);
    S().placePart('R', { x: 80, y: 0 }, 0, false);
    expect(lens()).toEqual(['0,0,80,0', '120,0,200,0']);
    const r = S().doc.parts[0];
    const c = extractConnectivity(S().doc);
    expect(c.pinNet.get(`${r.id}:1`)).not.toBe(c.pinNet.get(`${r.id}:2`));
    S().undo();
    expect(lens()).toEqual(['0,0,200,0']);
  });

  it('moving a part drags attached wires (rubber band with dog-leg) and keeps connectivity', () => {
    S().addWires([{ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }]);
    S().placePart('R', { x: 80, y: 0 }, 0, false);
    const r = S().doc.parts[0];
    S().select({ parts: [r.id] });
    S().moveSelection(0, 40);
    const c = extractConnectivity(S().doc);
    const n1 = c.pinNet.get(`${r.id}:1`)!, n2 = c.pinNet.get(`${r.id}:2`)!;
    expect(n1.wireIds.length).toBeGreaterThan(0);
    expect(n2.wireIds.length).toBeGreaterThan(0);
    expect(n1).not.toBe(n2);
    expect(S().doc.wires.every(w => w.a.x === w.b.x || w.a.y === w.b.y)).toBe(true); // still orthogonal
  });

  it('moving a selected wire drags the wires attached to its ends', () => {
    S().addWires([{ a: { x: 0, y: 0 }, b: { x: 0, y: 100 } }, { a: { x: 0, y: 100 }, b: { x: 100, y: 100 } }]);
    const horiz = S().doc.wires.find(w => w.a.y === 100 && w.b.y === 100)!;
    S().select({ wires: [horiz.id] });
    S().moveSelection(0, 20);
    expect(lens()).toContain('0,0,0,120');
  });

  it('collinear wire pieces drawn end to end merge into one wire', () => {
    S().addWires([{ a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }]);
    S().addWires([{ a: { x: 50, y: 0 }, b: { x: 100, y: 0 } }]);
    expect(lens()).toEqual(['0,0,100,0']);
  });

  it('text offsets are undoable, saved, and do not invalidate simulation results', () => {
    S().placePart('R', { x: 0, y: 0 }, 0, false);
    useStore.setState(s => ({ sim: { ...s.sim, stale: false } }));
    const id = S().doc.parts[0].id;
    S().commitView(d => ({ ...d, parts: d.parts.map(p => ({ ...p, valOff: { x: 5, y: 7 } })), biasOff: { 'v:N0001': { x: 1, y: 2 } } }));
    expect(S().sim.stale).toBe(false);
    const back = deserialize(serialize(S().doc));
    expect(back.parts.find(p => p.id === id)!.valOff).toEqual({ x: 5, y: 7 });
    expect(back.biasOff).toEqual({ 'v:N0001': { x: 1, y: 2 } });
    S().undo();
    expect(S().doc.parts[0].valOff).toBeUndefined();
  });

  it('markers map to expressions: V, -I on pin 2, V(a,b) differential, W power', () => {
    S().addWires([{ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }]);
    S().placePart('R', { x: 80, y: 0 }, 0, false);
    const r = S().doc.parts[0];
    S().commit(d => ({ ...d, labels: [{ id: 'a', x: 40, y: 0, text: 'IN', kind: 'alias' }, { id: 'b', x: 160, y: 0, text: 'OUT', kind: 'alias' }],
      markers: [
        { id: 'm1', kind: 'V', x: 40, y: 0 },
        { id: 'm2', kind: 'I', x: 120, y: 0, partId: r.id, pin: '2' },
        { id: 'm3', kind: 'VD', x: 40, y: 0, x2: 160, y2: 0 },
        { id: 'm4', kind: 'W', x: 100, y: 0, partId: r.id },
      ] }));
    expect(markerExprs(S().doc)).toEqual(['V(IN)', '-I(R1)', 'V(IN,OUT)', 'W(R1)']);
  });
});

describe('Schematic <-> Netlist Mode project state', () => {
  it('generated netlist edits are kept separately; schematic untouched; project round-trip keeps both', async () => {
    const A = await import('../src/state/actions');
    const { divider } = await import('./helpers');
    S().loadText(serialize(divider().doc), 'div.osch');
    const before = serialize(S().doc);
    (globalThis as any).window = { confirm: () => true };
    A.schematicToNetlistEditor();
    expect(S().mainView).toBe('netlist');
    expect(S().cir.origin).toBe('generated');
    expect(S().cir.text).toMatch(/^R2 OUT 0 3000$/m);
    A.setCirText(S().cir.text.replace('R2 OUT 0 3000', 'R2 OUT 0 6000'));
    expect(S().cir.origin).toBe('edited');
    A.cirUndo(); expect(S().cir.text).toMatch(/R2 OUT 0 3000/); A.cirRedo(); expect(S().cir.text).toMatch(/R2 OUT 0 6000/);
    A.showNetlistEditor(false);
    expect(serialize(S().doc)).toBe(before); // schematic unchanged by netlist edits
    // what File > Save writes:
    const saved = serialize({ ...S().doc, netlist: { text: S().cir.text, fileName: S().cir.fileName, origin: S().cir.origin } });
    S().newDoc(); useStore.setState({ cir: { text: '', fileName: null, dirty: false, origin: 'independent' } });
    S().loadText(saved, 'div.osch');
    expect(S().cir.text).toMatch(/R2 OUT 0 6000/);
    expect(S().cir.origin).toBe('edited');
    expect(S().doc.parts.find(p => p.ref === 'R2')!.props.VALUE).toBe('3k');
  });
});

describe('things attached to wires follow them', () => {
  beforeEach(() => S().newDoc());
  it('a voltage marker and a net alias in the middle of a moved wire move with it', () => {
    S().addWires([{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }]);
    S().commit(d => ({ ...d, markers: [{ id: 'm', kind: 'V', x: 50, y: 0 }], labels: [{ id: 'l', x: 30, y: 0, text: 'N1', kind: 'alias' }] }));
    S().select({ wires: [S().doc.wires[0].id] });
    S().moveSelection(0, 40);
    expect(S().doc.markers[0]).toMatchObject({ x: 50, y: 40 });
    expect(S().doc.labels[0]).toMatchObject({ x: 30, y: 40 });
  });
});
