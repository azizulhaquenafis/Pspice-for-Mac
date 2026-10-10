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
  for (const p of d.parts) {
    if (!PART_MAP[p.type]) throw new Error(`Unknown part type "${p.type}"`);
    if (![0, 1, 2, 3].includes(p.rot)) throw new Error(`Invalid rotation on ${p.ref}`);
    if (typeof p.props !== 'object') throw new Error(`Invalid properties on ${p.ref}`);
  }
  const isNum = (v: unknown) => typeof v === 'number' && isFinite(v);
  for (const w of d.wires) if (![w.a?.x, w.a?.y, w.b?.x, w.b?.y].every(isNum)) throw new Error('Invalid wire geometry');
  const prof = defaultProfile();
  d.profile = { ...prof, ...d.profile, tran: { ...prof.tran, ...d.profile?.tran }, dc: { ...prof.dc, ...d.profile?.dc }, ac: { ...prof.ac, ...d.profile?.ac }, param: { ...prof.param, ...d.profile?.param } };
  d.view = d.view ?? { x: -50, y: -50, zoom: 1.5 };
  return d as SchematicDoc;
}
