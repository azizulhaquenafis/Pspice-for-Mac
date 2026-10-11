// Electrical connectivity extraction. Rules (see docs/PSPICE_REFERENCE.md):
//  * Wires connect at their endpoints: to pins, other wire endpoints, or to the
//    interior of another wire (T-junction).
//  * Two wire interiors that merely cross are NOT connected unless an explicit
//    Junction is placed at the crossing.
//  * A pin connects to any wire passing through or ending on it, and to any pin at the same point.
//  * Net aliases (labels) connect to whatever is at their point and name the net;
//    nets carrying the same alias are joined (as in PSpice).
//  * Ground symbols force the net name "0".

import { SchematicDoc, Pt, Wire } from './model';
import { getDef, pinPositions } from './library';

export interface PinRef { partId: string; ref: string; pin: string; x: number; y: number }
export interface Net {
  id: number;
  name: string;          // SPICE node name
  aliases: string[];
  isGround: boolean;
  pins: PinRef[];
  wireIds: string[];
}
export interface Connectivity {
  nets: Net[];
  pinNet: Map<string, Net>;     // key `${partId}:${pin}`
  wireNet: Map<string, Net>;
  netAt(p: Pt): Net | undefined;
  junctionDots: Pt[];
  warnings: string[];
}

class DSU {
  parent: number[] = [];
  make() { this.parent.push(this.parent.length); return this.parent.length - 1; }
  find(a: number): number { while (this.parent[a] !== a) { this.parent[a] = this.parent[this.parent[a]]; a = this.parent[a]; } return a; }
  union(a: number, b: number) { a = this.find(a); b = this.find(b); if (a !== b) this.parent[b] = a; }
}

const key = (p: Pt) => `${p.x},${p.y}`;
const isEnd = (w: Wire, p: Pt) => (w.a.x === p.x && w.a.y === p.y) || (w.b.x === p.x && w.b.y === p.y);
export function onWire(w: Wire, p: Pt): boolean {
  if (w.a.x === w.b.x) return p.x === w.a.x && p.y >= Math.min(w.a.y, w.b.y) && p.y <= Math.max(w.a.y, w.b.y);
  if (w.a.y === w.b.y) return p.y === w.a.y && p.x >= Math.min(w.a.x, w.b.x) && p.x <= Math.max(w.a.x, w.b.x);
  return false;
}

export function extractConnectivity(doc: SchematicDoc): Connectivity {
  const dsu = new DSU();
  const warnings: string[] = [];
  const wireNode = new Map<string, number>();
  for (const w of doc.wires) wireNode.set(w.id, dsu.make());
  const pins: (PinRef & { node: number; ground: boolean })[] = [];
  // BUBBLE parts behave like net aliases at their pin (they are not circuit elements).
  const bubbleLabels: { x: number; y: number; text: string; bubble: true }[] = [];
  for (const p of doc.parts) {
    const def = getDef(p.type);
    if (def.isBubble) {
      const pp = pinPositions(p)[0];
      const t = (p.props.LABEL ?? '').trim();
      if (t) bubbleLabels.push({ x: pp.x, y: pp.y, text: t, bubble: true });
      else warnings.push('A BUBBLE has no LABEL (double-click it to name the net)');
      continue;
    }
    for (const pp of pinPositions(p)) {
      pins.push({ partId: p.id, ref: p.ref, pin: pp.name, x: pp.x, y: pp.y, node: dsu.make(), ground: !!def.isGround });
    }
  }
  // Spatial buckets for points of interest
  const pinsAt = new Map<string, typeof pins>();
  for (const pr of pins) { const k = key(pr); (pinsAt.get(k) ?? pinsAt.set(k, []).get(k)!).push(pr); }

  const wiresThrough = (p: Pt) => doc.wires.filter(w => onWire(w, p));

  // Pin-to-pin coincidence
  for (const list of pinsAt.values()) for (let i = 1; i < list.length; i++) dsu.union(list[0].node, list[i].node);
  // Pins touching wires anywhere
  for (const pr of pins) for (const w of wiresThrough(pr)) dsu.union(pr.node, wireNode.get(w.id)!);
  // Wire endpoints touching other wires (endpoint or interior)
  for (const w of doc.wires) for (const end of [w.a, w.b]) {
    for (const o of wiresThrough(end)) dsu.union(wireNode.get(w.id)!, wireNode.get(o.id)!);
  }
  // Explicit junctions join everything through the point
  for (const j of doc.junctions) {
    const ws = wiresThrough(j);
    for (let i = 1; i < ws.length; i++) dsu.union(wireNode.get(ws[0].id)!, wireNode.get(ws[i].id)!);
    if (ws.length === 0 && !pinsAt.has(key(j))) warnings.push(`Junction at (${j.x}, ${j.y}) is not on any wire`);
  }
  // Aliases: attach to item at point; collect names per root
  const aliasNode = new Map<string, number>(); // alias name -> representative node
  const aliasRoots: { node: number; name: string }[] = [];
  for (const l of [...doc.labels.filter(l => l.kind === 'alias'), ...bubbleLabels]) {
    const ws = wiresThrough(l);
    const ps = pinsAt.get(key(l)) ?? [];
    const target = ws.length ? wireNode.get(ws[0].id)! : ps.length ? ps[0].node : undefined;
    if (target === undefined) { warnings.push(`${'bubble' in l ? 'BUBBLE' : 'Net alias'} "${l.text}" is not attached to a wire or pin`); continue; }
    const nm = l.text.trim();
    const prev = aliasNode.get(nm.toLowerCase());
    if (prev !== undefined) dsu.union(prev, target); else aliasNode.set(nm.toLowerCase(), target);
    aliasRoots.push({ node: target, name: nm });
  }

  // Build nets
  const byRoot = new Map<number, Net>();
  let auto = 0;
  const netFor = (node: number) => {
    const r = dsu.find(node);
    let n = byRoot.get(r);
    if (!n) { n = { id: byRoot.size, name: '', aliases: [], isGround: false, pins: [], wireIds: [] }; byRoot.set(r, n); }
    return n;
  };
  for (const pr of pins) {
    const n = netFor(pr.node);
    if (pr.ground) n.isGround = true; else n.pins.push({ partId: pr.partId, ref: pr.ref, pin: pr.pin, x: pr.x, y: pr.y });
  }
  for (const w of doc.wires) netFor(wireNode.get(w.id)!).wireIds.push(w.id);
  for (const a of aliasRoots) { const n = netFor(a.node); if (!n.aliases.includes(a.name)) n.aliases.push(a.name); }

  // Stable naming: ground -> 0, alias -> alias, else N + lowest "REF:pin" order
  const nets = [...byRoot.values()];
  const sortKey = (n: Net) => n.pins.map(p => `${p.ref}:${p.pin}`).sort()[0] ?? `~${n.wireIds.slice().sort()[0] ?? ''}`;
  nets.sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true }));
  // SPICE node names are case-insensitive: every reservation and comparison uses the lower-case form, so a
  // label "n0001" can never coincide with a generated "N0001", and two labels that sanitize to the same
  // name (e.g. "A-B" and "A_B") never silently merge distinct nets.
  const used = new Set<string>(['0']);
  for (const n of nets) {
    if (n.aliases.some(a => a === '0' || a.toLowerCase() === 'gnd')) n.isGround = true;
    if (n.isGround) { n.name = '0'; continue; }
    if (n.aliases.length) {
      if (n.aliases.length > 1) warnings.push(`Net has multiple aliases (${n.aliases.join(', ')}); using "${n.aliases[0]}"`);
      let nm = sanitizeNode(n.aliases[0]);
      if (used.has(nm.toLowerCase())) {
        const base = nm; let k = 2;
        while (used.has(`${base}_${k}`.toLowerCase())) k++;
        nm = `${base}_${k}`;
        warnings.push(`Net label "${n.aliases[0]}" would share the SPICE node name "${base}" with another net (names are case-insensitive and special characters become "_"); this net is named "${nm}" instead`);
      }
      n.name = nm; used.add(nm.toLowerCase());
    }
  }
  for (const n of nets) {
    if (n.name) continue;
    let nm: string;
    do { nm = `N${String(++auto).padStart(4, '0')}`; } while (used.has(nm.toLowerCase()));
    n.name = nm; used.add(nm.toLowerCase());
  }
  nets.forEach((n, i) => (n.id = i));

  const pinNet = new Map<string, Net>();
  for (const pr of pins) pinNet.set(`${pr.partId}:${pr.pin}`, netFor(pr.node));
  const wireNet = new Map<string, Net>();
  for (const w of doc.wires) wireNet.set(w.id, netFor(wireNode.get(w.id)!));

  const netAt = (p: Pt) => {
    const ps = pinsAt.get(key(p));
    if (ps?.length) return netFor(ps[0].node);
    const ws = wiresThrough(p);
    return ws.length ? netFor(wireNode.get(ws[0].id)!) : undefined;
  };

  return { nets, pinNet, wireNet, netAt, junctionDots: junctionDots(doc, pinsAt), warnings };
}

/** Dots where 3+ connections meet at a real connection point, or at explicit junctions. */
function junctionDots(doc: SchematicDoc, pinsAt: Map<string, unknown[]>): Pt[] {
  const pts = new Map<string, Pt>();
  for (const w of doc.wires) { pts.set(key(w.a), w.a); pts.set(key(w.b), w.b); }
  const out: Pt[] = [];
  const seen = new Set<string>();
  for (const [k, p] of pts) {
    let deg = (pinsAt.get(k)?.length ?? 0);
    for (const w of doc.wires) if (onWire(w, p)) deg += isEnd(w, p) ? 1 : 2;
    if (deg >= 3) { out.push(p); seen.add(k); }
  }
  for (const j of doc.junctions) if (!seen.has(key(j))) out.push({ x: j.x, y: j.y });
  return out;
}

export function sanitizeNode(s: string): string {
  return s.trim().replace(/[^A-Za-z0-9_]/g, '_') || 'N';
}
