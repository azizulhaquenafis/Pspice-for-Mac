// Application state. Every document mutation goes through `commit`, which
// records an undo snapshot (documents are immutable, so snapshots share structure).
import { create } from 'zustand';
import { SchematicDoc, emptyDoc, Part, Wire, Pt, Rot, newId, Label, Marker } from '../core/model';
import { getDef, defaultProps, pinPositions } from '../core/library';
import { onWire } from '../core/connectivity';
import { insertPins, mergeCollinear, ptKey } from '../core/wires';
import { SimResult } from '../sim/types';
import { serialize, deserialize } from '../core/serialize';

export type Tool =
  | { kind: 'select' }
  | { kind: 'zoomarea' }
  | { kind: 'place'; partType: string; rot: Rot; mirror: boolean }
  | { kind: 'wire' }
  | { kind: 'alias' }
  | { kind: 'text' }
  | { kind: 'junction' }
  | { kind: 'marker'; marker: Marker['kind'] };

export type Dialog =
  | null | 'partBrowser' | 'analysis' | 'tran' | 'dc' | 'ac' | 'param' | 'netlist' | 'about' | 'erc' | 'output'
  | { kind: 'props'; partId: string } | { kind: 'partInfo'; partId: string } | { kind: 'label'; labelId?: string; at?: Pt; mode: 'alias' | 'text' };

export interface Selection { parts: string[]; wires: string[]; labels: string[]; junctions: string[]; markers: string[] }
const emptySel = (): Selection => ({ parts: [], wires: [], labels: [], junctions: [], markers: [] });

interface State {
  doc: SchematicDoc;
  past: SchematicDoc[];
  future: SchematicDoc[];
  dirty: boolean;
  fileName: string | null;
  tool: Tool;
  sel: Selection;
  dialog: Dialog;
  status: string;
  cursor: Pt;
  recentParts: string[];
  sim: { running: boolean; result: SimResult | null; netlist: string; abort?: AbortController; stale: boolean; source: 'schematic' | 'netlist'; notes: string[] };
  /** Which document the main area shows: the schematic or the text netlist editor. */
  mainView: 'schematic' | 'netlist';
  cir: CirDoc;
  /** Undo/redo history of the netlist editor text. */
  cirHist: { past: string[]; future: string[]; lastAt: number };
  /** Messages from the last netlist run (measurements etc.). */
  cirMeasures: { name: string; value: number; step?: string }[];
  showBiasV: boolean;
  showBiasI: boolean;
  probeOpen: boolean;
  highlightNet: string | null;
  clipboard: string | null;

  commit(fn: (d: SchematicDoc) => SchematicDoc, msg?: string): void;
  /** Undoable edit that does not change the circuit (text positions, probe traces): keeps results valid. */
  commitView(fn: (d: SchematicDoc) => SchematicDoc, msg?: string): void;
  /** Netlist-editor Probe traces (null = default node voltages). */
  cirTraces: string[] | null;
  /** Signals named on .PROBE lines of the last netlist run. */
  cirProbes: string[];
  undo(): void; redo(): void;
  setTool(t: Tool): void;
  setDialog(d: Dialog): void;
  setStatus(s: string): void;
  select(s: Partial<Selection>, add?: boolean): void;
  clearSel(): void;
  placePart(type: string, at: Pt, rot: Rot, mirror: boolean): void;
  addWires(ws: { a: Pt; b: Pt }[]): void;
  deleteSelection(): void;
  rotateSelection(): void;
  mirrorSelection(): void;
  moveSelection(dx: number, dy: number): void;
  copy(): void; cut(): void; paste(): void;
  newDoc(): void;
  loadText(text: string, name: string | null): void;
  setView(v: SchematicDoc['view']): void;
}

const MAX_UNDO = 200;

function nextRef(doc: SchematicDoc, prefix: string): string {
  if (!prefix) return '';
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
  for (const p of doc.parts) { const m = re.exec(p.ref); if (m) max = Math.max(max, +m[1]); }
  return `${prefix}${max + 1}`;
}

/** Wire clean-up (core/wires.ts): insert the given parts into wires they land on, then merge/dedupe. */
function cleanWires(d: SchematicDoc, wires: Wire[], placed: Part[] = []): Wire[] {
  let ws = wires.filter(w => w.a.x !== w.b.x || w.a.y !== w.b.y);
  for (const p of placed) ws = insertPins(ws, pinPositions(p));
  const keep = new Set<string>([
    ...d.parts.flatMap(p => pinPositions(p).map(ptKey)),
    ...d.junctions.map(ptKey), ...d.labels.filter(l => l.kind === 'alias').map(ptKey), ...d.markers.map(ptKey),
  ]);
  return mergeCollinear(ws, keep);
}

/** Netlist document. origin: independent text deck, an unmodified netlist generated from the schematic,
 *  or an edited copy of a generated netlist (never written back to the schematic). */
export interface CirDoc { text: string; fileName: string | null; dirty: boolean; origin: 'independent' | 'generated' | 'edited' }

export const DEFAULT_CIR = `RC charging circuit (line 1 is always the title)
* Write a SPICE / PSpice-style netlist and press Simulate (F11).
V1 IN 0 PULSE(0 10 0 1u 1u 10 20)
R1 IN OUT 1k
C1 OUT 0 100u IC=0
.TRAN 1ms 0.5s
.END
`;
const CIR_KEY = 'openspice.cir.v1';
function readCir(): string | null { try { return localStorage.getItem(CIR_KEY); } catch { return null; } }
export function saveCirDraft(text: string) { try { localStorage.setItem(CIR_KEY, text); } catch { /* ignore */ } }

export const useStore = create<State>((set, get) => ({
  doc: emptyDoc(),
  past: [], future: [],
  dirty: false,
  fileName: null,
  tool: { kind: 'select' },
  sel: emptySel(),
  dialog: null,
  status: 'Ready',
  cursor: { x: 0, y: 0 },
  recentParts: ['R', 'C', 'L', 'VDC', 'AGND'],
  sim: { running: false, result: null, netlist: '', stale: true, source: 'schematic', notes: [] },
  showBiasV: false, showBiasI: false,
  mainView: 'schematic',
  cir: { text: readCir() ?? DEFAULT_CIR, fileName: null, dirty: false, origin: 'independent' },
  cirHist: { past: [], future: [], lastAt: 0 },
  cirMeasures: [],
  probeOpen: false,
  highlightNet: null,
  clipboard: null,
  cirTraces: null,
  cirProbes: [],

  commit(fn, msg) {
    const { doc, past } = get();
    const next = fn(doc);
    if (next === doc) return;
    set({ doc: next, past: [...past.slice(-MAX_UNDO), doc], future: [], dirty: true, sim: { ...get().sim, stale: true }, ...(msg ? { status: msg } : {}) });
  },
  commitView(fn, msg) {
    const { doc, past } = get();
    const next = fn(doc);
    if (next === doc) return;
    set({ doc: next, past: [...past.slice(-MAX_UNDO), doc], future: [], dirty: true, ...(msg ? { status: msg } : {}) });
  },
  undo() {
    const { past, doc, future } = get();
    if (!past.length) return set({ status: 'Nothing to undo' });
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future], sel: emptySel(), dirty: true, status: 'Undo' });
  },
  redo() {
    const { past, doc, future } = get();
    if (!future.length) return set({ status: 'Nothing to redo' });
    set({ doc: future[0], future: future.slice(1), past: [...past, doc], sel: emptySel(), dirty: true, status: 'Redo' });
  },
  setTool(t) {
    const msg: Record<string, string> = {
      select: 'Ready', place: 'Click to place part. Ctrl+R rotate, Ctrl+F flip, Esc to stop',
      wire: 'Click to start wire, click for corners, double-click or click a pin/wire to end. Esc cancels',
      alias: 'Click a wire or pin to place a net alias', text: 'Click to place text', junction: 'Click a wire crossing to place a junction',
      marker: 'Click a wire/pin to place marker. Esc to stop', zoomarea: 'Drag the mouse to select the area to zoom',
    };
    set({ tool: t, status: msg[t.kind] });
  },
  setDialog(d) { set({ dialog: d }); },
  setStatus(s) { set({ status: s }); },
  select(s, add) {
    const cur = add ? get().sel : emptySel();
    const merge = (a: string[], b?: string[]) => (b ? [...new Set([...a, ...b])] : a);
    set({ sel: { parts: merge(cur.parts, s.parts), wires: merge(cur.wires, s.wires), labels: merge(cur.labels, s.labels), junctions: merge(cur.junctions, s.junctions), markers: merge(cur.markers, s.markers) } });
  },
  clearSel() { set({ sel: emptySel() }); },

  placePart(type, at, rot, mirror) {
    const def = getDef(type);
    get().commit(d => {
      const p: Part = { id: newId('p'), type, ref: nextRef(d, def.refPrefix), x: at.x, y: at.y, rot, mirror, props: defaultProps(def) };
      const nd = { ...d, parts: [...d.parts, p] };
      return { ...nd, wires: cleanWires(nd, d.wires, [p]) };
    }, `Placed ${type}`);
    const rp = [type, ...get().recentParts.filter(t => t !== type)].slice(0, 12);
    set({ recentParts: rp });
  },
  addWires(ws) {
    const nw = ws.filter(w => w.a.x !== w.b.x || w.a.y !== w.b.y).map(w => ({ id: newId('w'), a: w.a, b: w.b }));
    if (!nw.length) return;
    get().commit(d => ({ ...d, wires: cleanWires(d, [...d.wires, ...nw]) }), 'Wire placed');
  },
  deleteSelection() {
    const s = get().sel;
    const n = s.parts.length + s.wires.length + s.labels.length + s.junctions.length + s.markers.length;
    if (!n) return;
    get().commit(d => ({
      ...d,
      parts: d.parts.filter(p => !s.parts.includes(p.id)),
      wires: d.wires.filter(w => !s.wires.includes(w.id)),
      labels: d.labels.filter(l => !s.labels.includes(l.id)),
      junctions: d.junctions.filter(j => !s.junctions.includes(j.id)),
      markers: d.markers.filter(m => !s.markers.includes(m.id) && !(m.partId && s.parts.includes(m.partId))),
    }), `Deleted ${n} object(s)`);
    set({ sel: emptySel() });
  },
  rotateSelection() {
    const s = get().sel;
    if (!s.parts.length) return;
    get().commit(d => ({ ...d, parts: d.parts.map(p => s.parts.includes(p.id) ? { ...p, rot: ((p.rot + 1) % 4) as Rot } : p) }), 'Rotated');
  },
  mirrorSelection() {
    const s = get().sel;
    if (!s.parts.length) return;
    get().commit(d => ({ ...d, parts: d.parts.map(p => s.parts.includes(p.id) ? { ...p, mirror: !p.mirror } : p) }), 'Flipped');
  },
  moveSelection(dx, dy) {
    const s = get().sel;
    if (!dx && !dy) return;
    get().commit(d => {
      // Rubber-banding: unselected wire ends attached to moved pins or moved wire ends follow (PSpice-like).
      const follow = new Map<string, Pt>();
      const add = (q: Pt) => follow.set(`${q.x},${q.y}`, { x: q.x + dx, y: q.y + dy });
      for (const p of d.parts) if (s.parts.includes(p.id)) pinPositions(p).forEach(add);
      for (const w of d.wires) if (s.wires.includes(w.id)) { add(w.a); add(w.b); }
      const mv = (q: Pt) => ({ x: q.x + dx, y: q.y + dy });
      const extra: Wire[] = [];
      const wires = d.wires.map(w => {
        if (s.wires.includes(w.id)) return { ...w, a: mv(w.a), b: mv(w.b) };
        const na = follow.get(`${w.a.x},${w.a.y}`), nb = follow.get(`${w.b.x},${w.b.y}`);
        if (!na && !nb) return w;
        if (na && nb) return { ...w, a: na, b: nb };
        const fixed = na ? w.b : w.a, moved = (na ?? nb)!;
        if (fixed.x === moved.x || fixed.y === moved.y) return { ...w, a: fixed, b: moved };
        const corner = w.a.y === w.b.y ? { x: moved.x, y: fixed.y } : { x: fixed.x, y: moved.y };
        extra.push({ id: newId('w'), a: corner, b: moved });
        return { ...w, a: fixed, b: corner };
      });
      const parts = d.parts.map(p => s.parts.includes(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p);
      // Things attached to a moved wire (anywhere along it) or to a moved pin travel with it.
      const onMovedWire = (q: Pt) => d.wires.some(w => s.wires.includes(w.id) && onWire(w, q));
      const movedLabel = (l: Label) => s.labels.includes(l.id) || (l.kind === 'alias' && (follow.has(`${l.x},${l.y}`) || onMovedWire(l)));
      const movedMarker = (m: Marker) => s.markers.includes(m.id) || (m.partId && s.parts.includes(m.partId)) || (!m.partId && (follow.has(`${m.x},${m.y}`) || onMovedWire(m)));
      const nd = {
        ...d, parts,
        labels: d.labels.map(l => movedLabel(l) ? { ...l, ...mv(l) } : l),
        junctions: d.junctions.map(j => s.junctions.includes(j.id) || follow.has(`${j.x},${j.y}`) ? { ...j, ...mv(j) } : j),
        markers: d.markers.map(m => movedMarker(m) ? { ...m, ...mv(m), ...(m.x2 !== undefined ? { x2: m.x2 + dx, y2: m.y2! + dy } : {}) } : m),
      };
      return { ...nd, wires: cleanWires(nd, [...wires, ...extra], parts.filter(p => s.parts.includes(p.id))) };
    }, 'Moved');
  },
  copy() {
    const { sel, doc } = get();
    const data = { parts: doc.parts.filter(p => sel.parts.includes(p.id)), wires: doc.wires.filter(w => sel.wires.includes(w.id)), labels: doc.labels.filter(l => sel.labels.includes(l.id)) };
    set({ clipboard: JSON.stringify(data), status: `Copied ${data.parts.length + data.wires.length + data.labels.length} object(s)` });
  },
  cut() { get().copy(); get().deleteSelection(); },
  paste() {
    const cb = get().clipboard;
    if (!cb) return;
    const data = JSON.parse(cb) as { parts: Part[]; wires: Wire[]; labels: Label[] };
    const off = 40;
    const ids: Selection = emptySel();
    get().commit(d => {
      const parts = [...d.parts];
      for (const p of data.parts) {
        const np = { ...p, id: newId('p'), x: p.x + off, y: p.y + off, ref: nextRef({ ...d, parts }, getDef(p.type).refPrefix) };
        parts.push(np); ids.parts.push(np.id);
      }
      const wires = data.wires.map(w => { const id = newId('w'); ids.wires.push(id); return { id, a: { x: w.a.x + off, y: w.a.y + off }, b: { x: w.b.x + off, y: w.b.y + off } }; });
      const labels = data.labels.map(l => { const id = newId('l'); ids.labels.push(id); return { ...l, id, x: l.x + off, y: l.y + off }; });
      const nd = { ...d, parts, labels: [...d.labels, ...labels] };
      return { ...nd, wires: cleanWires(nd, [...d.wires, ...wires], parts.filter(p => ids.parts.includes(p.id))) };
    }, 'Pasted');
    set({ sel: ids });
  },
  newDoc() {
    set({ doc: emptyDoc(), past: [], future: [], dirty: false, fileName: null, sel: emptySel(), sim: { running: false, result: null, netlist: '', stale: true, source: 'schematic', notes: [] }, showBiasV: false, showBiasI: false, status: 'New schematic' });
  },
  loadText(text, name) {
    const doc = deserialize(text);
    if (doc.netlist) set({ cir: { ...doc.netlist, dirty: false }, cirHist: { past: [], future: [], lastAt: 0 } });
    set({ doc, past: [], future: [], dirty: false, fileName: name, sel: emptySel(), sim: { running: false, result: null, netlist: '', stale: true, source: 'schematic', notes: [] }, showBiasV: false, showBiasI: false, status: `Opened ${name ?? 'schematic'}` });
  },
  setView(v) { set(s => ({ doc: { ...s.doc, view: v } })); },
}));

/** Hit-testing helpers used by canvas and markers. */
export function wireAt(doc: SchematicDoc, p: Pt): Wire | undefined { return doc.wires.find(w => onWire(w, p)); }
export function pinAt(doc: SchematicDoc, p: Pt): { part: Part; pin: string } | undefined {
  for (const part of doc.parts) for (const pp of pinPositions(part)) if (pp.x === p.x && pp.y === p.y) return { part, pin: pp.name };
  return undefined;
}
export function addMarker(m: Omit<Marker, 'id'>) {
  useStore.getState().commit(d => ({ ...d, markers: [...d.markers.filter(o => !(o.x === m.x && o.y === m.y && o.kind === m.kind)), { ...m, id: newId('m') }] }), `${m.kind} marker placed`);
}

// Autosave / recovery (browser localStorage)
const AUTOSAVE_KEY = 'openspice.autosave.v1';
export function startAutosave() {
  let last = '';
  setInterval(() => {
    const { doc, dirty } = useStore.getState();
    if (!dirty) return;
    const s = serialize(doc);
    if (s === last) return;
    try { localStorage.setItem(AUTOSAVE_KEY, s); last = s; } catch { /* storage unavailable */ }
  }, 5000);
}
export function readAutosave(): string | null { try { return localStorage.getItem(AUTOSAVE_KEY); } catch { return null; } }
export function clearAutosave() { try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ } }
