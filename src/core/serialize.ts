// Versioned project serialization (.osch JSON). Format documented in ARCHITECTURE.md.
import { SchematicDoc, defaultProfile } from './model';
import { PART_MAP } from './library';

export const FILE_EXT = '.osch';

export function serialize(doc: SchematicDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function deserialize(text: string): SchematicDoc {
  let d: any;
  try { d = JSON.parse(text); } catch { throw new Error('File is not valid JSON'); }
  if (d?.format !== 'openspice-schematic') throw new Error('Not an OpenSpice schematic file');
  if (d.version !== 1) throw new Error(`Unsupported file version ${d.version}`);
  for (const k of ['parts', 'wires', 'junctions', 'labels', 'markers']) if (!Array.isArray(d[k])) throw new Error(`Missing "${k}"`);
  // Validate everything before the caller replaces the open document (B10).
  const isNum = (v: unknown) => typeof v === 'number' && isFinite(v);
  const isId = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length < 200;
  const isPt = (o: any) => o && isNum(o.x) && isNum(o.y);
  const ids = new Set<string>();
  const uniq = (id: string, what: string) => { if (ids.has(id)) throw new Error(`Duplicate id "${id}" (${what})`); ids.add(id); };
  for (const p of d.parts) {
    if (!p || typeof p !== 'object') throw new Error('Invalid part entry');
    if (!PART_MAP[p.type]) throw new Error(`Unknown part type "${p.type}"`);
    if (!isId(p.id)) throw new Error(`Part ${p.ref ?? '?'} has no valid id`);
    uniq(p.id, 'part');
    if (typeof p.ref !== 'string') throw new Error(`Invalid reference on a ${p.type} part`);
    if (![0, 1, 2, 3].includes(p.rot)) throw new Error(`Invalid rotation on ${p.ref}`);
    if (typeof p.mirror !== 'boolean') throw new Error(`Invalid mirror flag on ${p.ref}`);
    if (!isPt(p)) throw new Error(`Invalid position on ${p.ref}`);
    if (!p.props || typeof p.props !== 'object' || Array.isArray(p.props)) throw new Error(`Invalid properties on ${p.ref}`);
    for (const [k, v] of Object.entries(p.props)) {
      if (typeof v === 'number' && isFinite(v)) p.props[k] = String(v);          // tolerate numbers from hand-edited files
      else if (typeof v !== 'string') throw new Error(`Invalid value for ${p.ref} ${k}`);
    }
    for (const k of ['refOff', 'valOff']) if (p[k] !== undefined && !isPt(p[k])) throw new Error(`Invalid ${k} on ${p.ref}`);
    if (p.hide !== undefined && !(p.hide && typeof p.hide === 'object' && Object.values(p.hide).every(v => typeof v === 'boolean'))) throw new Error(`Invalid display flags on ${p.ref}`);
  }
  for (const w of d.wires) { if (!isId(w?.id) || !isPt(w.a) || !isPt(w.b)) throw new Error('Invalid wire geometry'); uniq(w.id, 'wire'); }
  for (const j of d.junctions) { if (!isId(j?.id) || !isPt(j)) throw new Error('Invalid junction'); uniq(j.id, 'junction'); }
  for (const l of d.labels) {
    if (!isId(l?.id) || !isPt(l) || typeof l.text !== 'string' || !['alias', 'text'].includes(l.kind)) throw new Error('Invalid label');
    if (l.off !== undefined && !isPt(l.off)) throw new Error('Invalid label offset');
    uniq(l.id, 'label');
  }
  const partIds = new Set(d.parts.map((p: any) => p.id));
  for (const m of d.markers) {
    if (!isId(m?.id) || !isPt(m) || !['V', 'I', 'VD', 'W'].includes(m.kind)) throw new Error('Invalid marker');
    if (m.kind === 'VD' && !(isNum(m.x2) && isNum(m.y2))) throw new Error('Invalid differential marker');
    if ((m.kind === 'I' || m.kind === 'W') && !partIds.has(m.partId)) throw new Error('A current/power marker refers to a missing part');
    uniq(m.id, 'marker');
  }
  if (d.view !== undefined && !(d.view && isNum(d.view.x) && isNum(d.view.y) && isNum(d.view.zoom) && d.view.zoom > 0)) throw new Error('Invalid view');
  if (d.profile !== undefined && (d.profile === null || typeof d.profile !== 'object')) throw new Error('Invalid simulation profile');
  if (d.biasOff !== undefined && (typeof d.biasOff !== 'object' || d.biasOff === null || !Object.values(d.biasOff).every(isPt))) throw new Error('Invalid bias label offsets');
  if (d.probeTraces !== undefined && !(Array.isArray(d.probeTraces) && d.probeTraces.every((t: unknown) => typeof t === 'string'))) throw new Error('Invalid probe traces');
  if (d.netlist !== undefined && !(d.netlist && typeof d.netlist.text === 'string')) throw new Error('Invalid netlist document');
  const prof = defaultProfile();
  d.profile = { ...prof, ...d.profile, tran: { ...prof.tran, ...d.profile?.tran }, dc: { ...prof.dc, ...d.profile?.dc }, ac: { ...prof.ac, ...d.profile?.ac }, param: { ...prof.param, ...d.profile?.param } };
  d.view = d.view ?? { x: -50, y: -50, zoom: 1.5 };
  return d as SchematicDoc;
}
