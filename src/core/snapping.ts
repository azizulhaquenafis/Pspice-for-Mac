// One snapping rule for every tool (wire, net alias, junction, markers) and for both the live preview
// and the click, so what you see is what gets placed.
//  * Candidates: part pins, wire ends, wire crossings, and grid points along wires.
//  * The reach is given in world units by the caller (computed from a fixed number of screen pixels,
//    so it feels the same at every zoom level).
//  * Pins, wire ends and crossings are preferred over a plain point on a wire when both are in reach.
import { Pt, SchematicDoc, snap } from './model';
import { getDef, pinPositions, PartDef } from './library';

export type SnapKind = 'pin' | 'end' | 'cross' | 'wire';
export interface SnapResult { p: Pt; kind: SnapKind; partId?: string; pin?: string }
export interface SnapOptions {
  pins?: boolean;                       // part pins
  wires?: boolean;                      // wire ends and points along wires
  crossings?: boolean;                  // where a horizontal and a vertical wire cross
  pinFilter?: (def: PartDef) => boolean;
}

const PREFER = 0.6; // pins/ends/crossings win unless a wire point is clearly closer (fraction of reach)

export function snapToConnection(doc: SchematicDoc, w: Pt, reach: number, opts: SnapOptions): SnapResult | null {
  let best: SnapResult | null = null, bestScore = Infinity;
  const consider = (r: SnapResult, preferred: boolean, dist?: number) => {
    const d = dist ?? Math.hypot(r.p.x - w.x, r.p.y - w.y);
    if (d > reach) return;
    const score = d - (preferred ? reach * PREFER : 0);
    if (score < bestScore) { bestScore = score; best = r; }
  };
  if (opts.pins) for (const part of doc.parts) {
    const def = getDef(part.type);
    if (def.isParam || (opts.pinFilter && !opts.pinFilter(def))) continue;
    for (const pp of pinPositions(part)) consider({ p: { x: pp.x, y: pp.y }, kind: 'pin', partId: part.id, pin: pp.name }, true);
  }
  if (opts.wires) for (const wi of doc.wires) {
    consider({ p: { ...wi.a }, kind: 'end' }, true);
    consider({ p: { ...wi.b }, kind: 'end' }, true);
    const horiz = wi.a.y === wi.b.y;
    const lo = horiz ? Math.min(wi.a.x, wi.b.x) : Math.min(wi.a.y, wi.b.y);
    const hi = horiz ? Math.max(wi.a.x, wi.b.x) : Math.max(wi.a.y, wi.b.y);
    const along = Math.min(hi, Math.max(lo, snap(horiz ? w.x : w.y)));
    // reach is measured to the wire itself (pointing at a wire always snaps); the placed point is the
    // nearest grid point along it
    const c = Math.min(hi, Math.max(lo, horiz ? w.x : w.y));
    const dWire = horiz ? Math.hypot(w.x - c, w.y - wi.a.y) : Math.hypot(w.x - wi.a.x, w.y - c);
    consider({ p: horiz ? { x: along, y: wi.a.y } : { x: wi.a.x, y: along }, kind: 'wire' }, false, dWire);
  }
  if (opts.crossings) {
    const hs = doc.wires.filter(x => x.a.y === x.b.y), vs = doc.wires.filter(x => x.a.x === x.b.x);
    for (const h of hs) for (const v of vs) {
      const x = v.a.x, y = h.a.y;
      if (x > Math.min(h.a.x, h.b.x) && x < Math.max(h.a.x, h.b.x) && y > Math.min(v.a.y, v.b.y) && y < Math.max(v.a.y, v.b.y))
        consider({ p: { x, y }, kind: 'cross' }, true);
    }
  }
  return best;
}

/** Snap settings per tool. */
export const SNAP_FOR = {
  wire: { pins: true, wires: true } as SnapOptions,
  alias: { pins: true, wires: true } as SnapOptions,
  junction: { wires: true, crossings: true } as SnapOptions,
  voltageMarker: { pins: true, wires: true, pinFilter: (d: PartDef) => !d.isBubble } as SnapOptions,
  currentMarker: { pins: true, pinFilter: (d: PartDef) => !d.isGround && !d.isBubble } as SnapOptions,
};
/** Screen distance (pixels) within which tools snap to connection points. */
export const SNAP_PX = 14;
