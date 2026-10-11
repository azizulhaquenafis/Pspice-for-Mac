// Regression tests for the 2026-10-11 external review (B01–B15). Each test asserts the CORRECT behaviour.
import { vi, afterEach, beforeEach, it, expect, describe } from 'vitest';
import { useStore } from '../src/state/store';
import * as A from '../src/state/actions';
import { divider } from '../src/core/examples';
import { serialize } from '../src/core/serialize';
import { SimResult } from '../src/sim/types';

const S = () => useStore.getState();
const good: SimResult = { ok: true, plots: [], errors: [], log: '', elapsedMs: 1 };
beforeEach(() => { S().newDoc(); vi.stubGlobal('window', { confirm: () => true }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Batch 1 — saved work and result identity', () => {
  it('B01: Save after New/Open asks for a new file instead of overwriting the previous document', async () => {
    const written: string[] = [];
    const picker = vi.fn(async () => ({ name: 'file', createWritable: async () => ({ write: async (s: string) => { written.push(s); }, close: async () => {} }) }));
    vi.stubGlobal('window', { confirm: () => true, showSaveFilePicker: picker });
    await A.fileSave(true); A.fileNew(); await A.fileSave();
    expect(picker).toHaveBeenCalledTimes(2);
    await A.fileSave();                                  // same document again: reuses its own handle
    expect(picker).toHaveBeenCalledTimes(2);
    await A.saveCir(true); A.newCir(); await A.saveCir();
    expect(picker).toHaveBeenCalledTimes(4);
    S().loadText(serialize(divider().doc), 'd.osch'); await A.fileSave();
    expect(picker).toHaveBeenCalledTimes(5);
  });

  it('B13: an edit made while a save is being written stays unsaved', async () => {
    let release!: () => void, written = '';
    vi.stubGlobal('window', { showSaveFilePicker: async () => ({ name: 'race.osch', createWritable: async () => ({ write: async (s: string) => { written = s; await new Promise<void>(r => { release = r; }); }, close: async () => {} }) }) });
    const pending = A.fileSave(true); await vi.waitFor(() => expect(release).toBeDefined());
    S().placePart('R', { x: 0, y: 0 }, 0, false); release(); await pending;
    expect(JSON.parse(written).parts).toHaveLength(0);
    expect(S().doc.parts).toHaveLength(1);
    expect(S().dirty).toBe(true);
  });

  it('B13: a save that finishes after the document was replaced does not touch the new document', async () => {
    let release!: () => void;
    vi.stubGlobal('window', { confirm: () => true, showSaveFilePicker: async () => ({ name: 'old.osch', createWritable: async () => ({ write: async () => { await new Promise<void>(r => { release = r; }); }, close: async () => {} }) }) });
    const pending = A.fileSave(true); await vi.waitFor(() => expect(release).toBeDefined());
    S().loadText(serialize(divider().doc), 'new.osch'); useStore.setState({ dirty: true });
    release(); await pending;
    expect(S().fileName).toBe('new.osch'); expect(S().dirty).toBe(true);
  });

  it('B04: New cancels a run in flight, and its late result is not applied to the new document', async () => {
    S().loadText(serialize(divider().doc), null);
    let resolve!: (r: SimResult) => void;
    vi.spyOn(A.engine, 'run').mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = A.simulateSchematic();
    const signal = S().sim.abort!.signal;
    A.fileNew();
    expect(signal.aborted).toBe(true);
    resolve(good); await pending;
    expect(S().sim.result).toBeNull(); expect(S().sim.running).toBe(false); expect(S().sim.stale).toBe(true);
  });

  it('B04: edits made during a run make its result stale on arrival', async () => {
    S().loadText(serialize(divider().doc), null);
    let resolve!: (r: SimResult) => void;
    vi.spyOn(A.engine, 'run').mockImplementation(() => new Promise(r => { resolve = r; }));
    const pending = A.simulateSchematic();
    S().placePart('R', { x: 500, y: 500 }, 0, false);
    resolve(good); await pending;
    expect(S().sim.result).not.toBeNull(); expect(S().sim.stale).toBe(true);
  });

  it('B03: undo/redo make results stale only when the simulated circuit differs; visual edits keep them valid', async () => {
    S().loadText(serialize(divider().doc), null);
    vi.spyOn(A.engine, 'run').mockResolvedValue(good);
    await A.simulateSchematic();
    expect(S().sim.stale).toBe(false);
    S().commit(d => ({ ...d, markers: [{ id: 'm', kind: 'V', x: 100, y: 60 }] }));   // marker: not a circuit change
    expect(S().sim.stale).toBe(false);
    S().placePart('R', { x: 500, y: 500 }, 0, false);
    expect(S().sim.stale).toBe(true);
    S().undo();                                                                        // back to the simulated circuit
    expect(S().sim.stale).toBe(false);
    S().undo();                                                                        // marker removed: still the same circuit
    expect(S().sim.stale).toBe(false);
    S().redo(); S().redo();
    expect(S().sim.stale).toBe(true);
  });

  it('B03: editing, undoing and reloading the .cir text invalidates a netlist result', async () => {
    A.newCir();
    vi.spyOn(A.engine, 'run').mockResolvedValue(good);
    await A.simulateNetlist();
    expect(S().sim.source).toBe('netlist'); expect(S().sim.stale).toBe(false);
    A.setCirText('a different circuit', true); expect(S().sim.stale).toBe(true);
    A.cirUndo(); expect(S().sim.stale).toBe(false);
    A.cirRedo(); expect(S().sim.stale).toBe(true);
    A.openCirExample('x\nR1 1 0 1\n.op\n.end\n', 'x.cir'); expect(S().sim.result).toBeNull();
  });

  it('B02: generating a schematic netlist preview keeps the executed deck paired with its result', async () => {
    A.newCir();
    vi.spyOn(A.engine, 'run').mockResolvedValue(good);
    await A.simulateNetlist();
    const executed = S().sim.netlist;
    S().loadText(serialize(divider().doc), null);
    const preview = A.createNetlist();
    expect(preview.text).toMatch(/R1 /);
    expect(S().sim.netlist).toBe(executed);
    expect(S().sim.source).toBe('netlist');
  });
});

// ---------------------------------------------------------------- Batch 2 / 3
import { Builder, engine, simulate, vec, at } from './helpers';
import { newId, SchematicDoc } from '../src/core/model';
import { pinPositions } from '../src/core/library';
import { runSchematic } from '../src/sim/schematicSim';
import { runDeck } from '../src/sim/netlistSim';
import { evaluateExpr, parseDeckDevices } from '../src/sim/expr';
import { markerExprs, tracesCSV } from '../src/ui/probeModel';
import { deserialize } from '../src/core/serialize';
import { axisInput, decades } from '../src/ui/Probe';
import { parseSpiceNumber } from '../src/core/units';
import { AutoEngine } from '../src/sim/autoEngine';
import { WasmNgspiceEngine } from '../src/sim/wasmEngine';
import { Plot } from '../src/sim/types';

describe('Batch 2 — simulation correctness', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });   // real ngspice runs: no browser-window stub
  it('B06: a user alias spelled like an automatic node name (n0001) does not merge with an unlabeled net', async () => {
    // V1 10 V — R1 1k — [unlabeled] — R2 1k — [alias n0001] — R3 3k — gnd → V(n0001) = 10·3/5 = 6 V
    const b = new Builder();
    const v1 = b.part('VDC', 'V1', 0, 100, 0, { DC: '10' });
    const r1 = b.part('R', 'R1', 40, 60, 0, { VALUE: '1k' });
    const r2 = b.part('R', 'R2', 120, 60, 0, { VALUE: '1k' });
    const r3 = b.part('R', 'R3', 200, 60, 3, { VALUE: '3k' });
    b.wire(b.pin(v1, '+'), { x: 0, y: 60 }); b.wire({ x: 0, y: 60 }, b.pin(r1, '1'));
    b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
    b.wire(b.pin(r2, '2'), b.pin(r3, '1'));
    b.doc.labels.push({ id: newId('l'), ...b.pin(r2, '2'), text: 'n0001', kind: 'alias' });
    b.wire(b.pin(r3, '2'), { x: 200, y: 160 }); b.gnd({ x: 200, y: 160 });
    b.wire(b.pin(v1, '-'), { x: 0, y: 160 }); b.gnd({ x: 0, y: 160 });
    const p = await simulate(b.doc);
    expect(vec(p, 'op', 'v(n0001)')[0]).toBeCloseTo(6, 6);
  });

  it('B07: a current marker on an F source C+ pin plots the 1 mA control current', async () => {
    const b = new Builder();
    const label = (pt: { x: number; y: number }, text: string) => b.doc.labels.push({ id: newId('l'), ...pt, text, kind: 'alias' });
    const v1 = b.part('VDC', 'V1', 0, 100, 0, { DC: '1' });
    const r1 = b.part('R', 'R1', 100, 0, 0, { VALUE: '1k' });
    const rl = b.part('R', 'RL', 600, 100, 3, { VALUE: '1k' });
    const f = b.part('F', 'F1', 300, 300, 0, { GAIN: '2' });
    const P = Object.fromEntries(pinPositions(f).map(p => [p.name, { x: p.x, y: p.y }]));
    label(b.pin(v1, '+'), 'VIN'); label(b.pin(r1, '1'), 'VIN'); label(b.pin(r1, '2'), 'CTL'); label(P['C+'], 'CTL');
    label(P['C-'], '0'); label(P['-'], '0'); label(b.pin(v1, '-'), '0'); label(b.pin(rl, '2'), '0');
    label(P['+'], 'OUT'); label(b.pin(rl, '1'), 'OUT');
    b.gnd({ x: 0, y: 140 });
    b.doc.markers.push({ id: newId('m'), kind: 'I', x: P['C+'].x, y: P['C+'].y, partId: f.id, pin: 'C+' });
    const run = await runSchematic(b.doc, engine);
    expect(run.result.ok).toBe(true);
    const expr = markerExprs(b.doc)[0]!;
    const v = evaluateExpr(expr, run.result.plots.find(p => p.kind === 'op')!, parseDeckDevices(run.deck));
    expect(v.re[0]).toBeCloseTo(1e-3, 9);
  });

  it('B08: a capacitor IC given as a parameter expression is honoured in Netlist Mode', async () => {
    const run = await runDeck('ic param\n.param V0=10\nC1 OUT 0 1u IC={V0}\nR1 OUT 0 1k\n.tran 10u 1m\n.end\n', engine);
    expect(run.result.ok).toBe(true);
    const p = run.result.plots.find(p => p.kind === 'tran')!;
    const t = vec([p], 'tran', 'time'), y = vec([p], 'tran', 'v(out)');
    expect(y[0]).toBeCloseTo(10 * Math.exp(-t[0] / 1e-3), 4);   // UIC output starts at the first timestep (KNOWN_ISSUES)
    expect(at(t, y, 1e-3)).toBeCloseTo(10 * Math.exp(-1), 2);
  });

  it('B08: an IC expression that cannot be evaluated is an error, not silently 0', async () => {
    const run = await runDeck('bad ic\nC1 OUT 0 1u IC={NOPE}\nR1 OUT 0 1k\n.tran 10u 1m\n.end\n', engine);
    expect(run.result.ok).toBe(false);
  });

  it('B11: axis limits shown in the dialog parse back to the same value (1 MHz is not 1 mHz)', () => {
    for (const v of [1e6, 2.5e6, 1e-3, 47e-6, 1e9]) expect(parseSpiceNumber(axisInput(v, v / 1e6)).value).toBeCloseTo(v, 6 - Math.log10(Math.abs(v)));
  });

  it('B12: log-axis decade generation is bounded and empty for non-positive ranges', () => {
    expect(decades(0, 10)).toEqual([]);
    expect(decades(-1, 10)).toEqual([]);
    expect(decades(1, 1000)).toEqual([0, 1, 2, 3]);
  });
});

describe('Batch 3 — editing, files, export, cancellation', () => {
  it('B05: copy/paste keeps junctions and markers; current markers follow the pasted part', () => {
    const doc = divider().doc;
    const r1 = doc.parts.find(p => p.ref === 'R1')!;
    doc.junctions.push({ id: newId('j'), x: 100, y: 60 });
    doc.markers.push({ id: newId('m'), kind: 'I', x: r1.x, y: r1.y, partId: r1.id, pin: '1' });
    doc.markers.push({ id: newId('m'), kind: 'VD', x: 100, y: 60, x2: 0, y2: 60 });
    S().loadText(serialize(doc), 'd.osch');
    const d = S().doc;
    useStore.setState({ sel: { parts: [r1.id], wires: d.wires.map(w => w.id), labels: [], junctions: d.junctions.map(j => j.id), markers: [d.markers[1].id] } });
    S().copy(); S().paste();
    const after = S().doc;
    expect(after.junctions).toHaveLength(2);
    expect(after.junctions[1]).toMatchObject({ x: 140, y: 100 });
    expect(after.markers).toHaveLength(4);
    const newR = after.parts[after.parts.length - 1];
    const im = after.markers.find(m => m.kind === 'I' && m.partId === newR.id);
    expect(im).toBeTruthy();
    expect(after.markers.find(m => m.kind === 'VD' && m.x === 140)).toMatchObject({ x2: 40, y2: 100 });
  });

  it('B09: SIN/COS of complex values use the complex identities', () => {
    const plot: Plot = { kind: 'ac', title: '', vectors: [
      { name: 'frequency', re: new Float64Array([1]), im: new Float64Array([0]) },
      { name: 'v(a)', re: new Float64Array([0.5]), im: new Float64Array([0.3]) }] } as unknown as Plot;
    const s = evaluateExpr('SIN(V(A))', plot, new Map()), c = evaluateExpr('COS(V(A))', plot, new Map());
    expect(s.re[0]).toBeCloseTo(Math.sin(0.5) * Math.cosh(0.3), 12);
    expect(s.im![0]).toBeCloseTo(Math.cos(0.5) * Math.sinh(0.3), 12);
    expect(c.re[0]).toBeCloseTo(Math.cos(0.5) * Math.cosh(0.3), 12);
    expect(c.im![0]).toBeCloseTo(-Math.sin(0.5) * Math.sinh(0.3), 12);
  });

  it('B10: malformed documents are rejected before they replace the open schematic', () => {
    const good = JSON.parse(serialize(divider().doc));
    const bad = (f: (d: any) => void) => { const d = structuredClone(good); f(d); return JSON.stringify(d); };
    expect(() => deserialize(bad(d => { d.parts[0].props = null; }))).toThrow();
    expect(() => deserialize(bad(d => { d.parts[0].props.VALUE = { x: 1 }; }))).toThrow();
    expect(() => deserialize(bad(d => { d.parts[0].x = 'abc'; }))).toThrow();
    expect(() => deserialize(bad(d => { d.labels[0].y = null; }))).toThrow();
    expect(() => deserialize(bad(d => { d.labels[0].kind = 'weird'; }))).toThrow();
    expect(() => deserialize(bad(d => { d.junctions.push({ id: 'j', x: Infinity, y: 0 }); }))).toThrow();
    expect(() => deserialize(bad(d => { d.markers.push({ id: 'm', kind: 'I', x: 0, y: 0, partId: 'missing', pin: '1' }); }))).toThrow();
    expect(() => deserialize(bad(d => { d.parts[1].id = d.parts[0].id; }))).toThrow();
    expect(() => deserialize(JSON.stringify(good))).not.toThrow();
    const before = S().doc;
    expect(() => S().loadText(bad(d => { d.parts[0].props = null; }), 'x.osch')).toThrow();
    expect(S().doc).toBe(before);
  });

  it('B14: CSV export writes every point of the visible traces', () => {
    const x = new Float64Array([0, 1, 2]);
    const csv = tracesCSV('Time (s)', [{ label: 'V(A)', x, y: new Float64Array([1, 2, 3]) }, { label: 'V(B)', x: new Float64Array([0, 1, 2]), y: new Float64Array([4, 5, 6]) }]);
    expect(csv.trim().split('\n')).toHaveLength(4);
    expect(csv.split('\n')[0]).toBe('Time (s),V(A),V(B)');
    const pair = tracesCSV('t', [{ label: 'a', x: new Float64Array([0, 1]), y: new Float64Array([1, 2]) }, { label: 'b', x: new Float64Array([0, 0.5, 1]), y: new Float64Array([3, 4, 5]) }]);
    expect(pair.trim().split('\n')).toHaveLength(4);
    expect(pair.split('\n')[3]).toBe(',,1.00000000000,5.00000000000');
    expect(tracesCSV('t', [])).toBe('');
  });

  it('B15: an already-cancelled run does no work and reports cancellation', async () => {
    const ac = new AbortController(); ac.abort();
    const r = await engine.run('t\nV1 1 0 1\nR1 1 0 1k\n.op\n.end\n', ac.signal);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/cancel/i);
    const w = await new WasmNgspiceEngine().run('t\n.end\n', ac.signal);
    expect(w.errors.join(' ')).toMatch(/cancel/i);
    const auto = new AutoEngine();
    const chosen = { name: 'stub', run: vi.fn(async () => good) };
    (auto as any).choosing = Promise.resolve(chosen); (auto as any).chosen = chosen;
    const a = await auto.run('t\n.end\n', ac.signal);
    expect(a.errors.join(' ')).toMatch(/cancel/i);
    expect(chosen.run).not.toHaveBeenCalled();
  });
});
