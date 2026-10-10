// Wire clean-up rules applied after placing, moving or pasting parts and drawing wires:
//  * A two-pin part dropped onto a wire is inserted in series: the wire between its pins is cut out.
//  * Any pin landing on a wire interior splits that wire there (the pin becomes a wire end).
//  * Collinear segments meeting at a plain bend-free point are merged; duplicates/overlaps removed.
import { Pt, Wire, newId } from './model';
import { onWire } from './connectivity';

const eq = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
export const ptKey = (p: Pt) => `${p.x},${p.y}`;
const horiz = (w: Wire) => w.a.y === w.b.y;

export function splitAt(wires: Wire[], p: Pt): Wire[] {
  const out: Wire[] = [];
  for (const w of wires) {
    if (onWire(w, p) && !eq(w.a, p) && !eq(w.b, p)) out.push({ id: w.id, a: w.a, b: { ...p } }, { id: newId('w'), a: { ...p }, b: w.b });
    else out.push(w);
  }
  return out;
}

/** Insert a part with the given pin positions into the wiring (see header). */
export function insertPins(wires: Wire[], pins: Pt[]): Wire[] {
  if (pins.length === 2 && !eq(pins[0], pins[1])) {
    const [p, q] = pins;
    const w = wires.find(w => onWire(w, p) && onWire(w, q));
    if (w) {
      const c = (r: Pt) => (horiz(w) ? r.x : r.y);
      const [lo, hi] = c(w.a) <= c(w.b) ? [w.a, w.b] : [w.b, w.a];
      const [p1, p2] = c(p) <= c(q) ? [p, q] : [q, p];
      wires = wires.filter(x => x !== w);
      if (!eq(lo, p1)) wires.push({ id: w.id, a: lo, b: { ...p1 } });
      if (!eq(p2, hi)) wires.push({ id: newId('w'), a: { ...p2 }, b: hi });
    }
  }
  for (const p of pins) wires = splitAt(wires, p);
  return wires;
}

/** Merge collinear segments joined end-to-end at points that are not in `keep`; drop contained duplicates. */
export function mergeCollinear(wires: Wire[], keep: Set<string>): Wire[] {
  let ws = wires.filter(w => !eq(w.a, w.b) && (w.a.x === w.b.x || w.a.y === w.b.y));
  // remove wires fully covered by another collinear wire (keep the first of identical duplicates)
  ws = ws.filter((w, i) => !ws.some((o, j) => j !== i && horiz(o) === horiz(w) && onWire(o, w.a) && onWire(o, w.b) && (j < i || !(onWire(w, o.a) && onWire(w, o.b)))));
  for (let guard = 0; guard < 10000; guard++) {
    const ends = new Map<string, Wire[]>();
    for (const w of ws) for (const e of [w.a, w.b]) { const k = ptKey(e); (ends.get(k) ?? ends.set(k, []).get(k)!).push(w); }
    let merged = false;
    for (const [k, list] of ends) {
      if (list.length !== 2 || keep.has(k)) continue;
      const [w1, w2] = list;
      if (horiz(w1) !== horiz(w2)) continue;
      const p = eq(w1.a, w2.a) || eq(w1.a, w2.b) ? w1.a : w1.b;
      if (ws.some(w => w !== w1 && w !== w2 && onWire(w, p))) continue; // T-junction stays
      const f1 = eq(w1.a, p) ? w1.b : w1.a, f2 = eq(w2.a, p) ? w2.b : w2.a;
      ws = [...ws.filter(w => w !== w1 && w !== w2), { id: w1.id, a: f1, b: f2 }];
      merged = true; break;
    }
    if (!merged) break;
  }
  return ws;
}
