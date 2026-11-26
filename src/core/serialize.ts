// Versioned project serialization (.osch JSON). Format documented in ARCHITECTURE.md.
import { SchematicDoc, defaultProfile } from './model';
import { PART_MAP } from './library';

export const FILE_EXT = '.osch';
export const MAX_PROJECT_BYTES = 10_000_000; // 10 MB safety limit for imported .osch files

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeJsonParse(text: string): unknown {
  return JSON.parse(text, (key, value) => (FORBIDDEN_KEYS.has(key) ? undefined : value));
}

export function serialize(doc: SchematicDoc): string {
  return JSON.stringify(doc, null, 2);
}

export function deserialize(text: string): SchematicDoc {
  if (typeof text !== 'string' || text.length > MAX_PROJECT_BYTES) {
    throw new Error(`Project file exceeds maximum size (${MAX_PROJECT_BYTES / 1_000_000} MB)`);
  }
  let d: any;
  try {
    d = safeJsonParse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Invalid project file');
  if (d.format !== 'openspice-schematic') throw new Error('Not an OpenSpice schematic file');
  if (d.version !== 1) throw new Error(`Unsupported file version ${d.version}`);
  for (const k of ['parts', 'wires', 'junctions', 'labels', 'markers']) {
    if (!Array.isArray(d[k])) throw new Error(`Missing "${k}"`);
  }
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  for (const p of d.parts) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid part entry');
    if (!PART_MAP[p.type]) throw new Error(`Unknown part type "${p.type}"`);
    if (![0, 1, 2, 3].includes(p.rot)) throw new Error(`Invalid rotation on ${p.ref}`);
    if (!isNum(p.x) || !isNum(p.y)) throw new Error(`Invalid coordinates on ${p.ref}`);
    if (!p.props || typeof p.props !== 'object' || Array.isArray(p.props)) {
      throw new Error(`Invalid properties on ${p.ref}`);
    }
  }
  for (const w of d.wires) {
    if (!w || typeof w !== 'object' || ![w.a?.x, w.a?.y, w.b?.x, w.b?.y].every(isNum)) {
      throw new Error('Invalid wire geometry');
    }
  }
  for (const j of d.junctions) {
    if (!j || typeof j !== 'object' || !isNum(j.x) || !isNum(j.y)) {
      throw new Error('Invalid junction geometry');
    }
  }
  for (const l of d.labels) {
    if (!l || typeof l !== 'object' || !isNum(l.x) || !isNum(l.y) || typeof l.text !== 'string') {
      throw new Error('Invalid label entry');
    }
  }
  for (const m of d.markers) {
    if (!m || typeof m !== 'object' || !isNum(m.x) || !isNum(m.y) || !['V', 'I', 'VD', 'W'].includes(m.kind)) {
      throw new Error('Invalid marker entry');
    }
  }
  const prof = defaultProfile();
  const rawProf = d.profile && typeof d.profile === 'object' && !Array.isArray(d.profile) ? d.profile : {};
  d.profile = {
    ...prof,
    ...rawProf,
    tran: { ...prof.tran, ...(rawProf.tran && typeof rawProf.tran === 'object' ? rawProf.tran : {}) },
    dc: { ...prof.dc, ...(rawProf.dc && typeof rawProf.dc === 'object' ? rawProf.dc : {}) },
    ac: { ...prof.ac, ...(rawProf.ac && typeof rawProf.ac === 'object' ? rawProf.ac : {}) },
    param: { ...prof.param, ...(rawProf.param && typeof rawProf.param === 'object' ? rawProf.param : {}) },
  };
  const v = d.view;
  d.view =
    v && typeof v === 'object' && isNum(v.x) && isNum(v.y) && isNum(v.zoom) && v.zoom > 0
      ? { x: v.x, y: v.y, zoom: Math.min(8, Math.max(0.2, v.zoom)) }
      : { x: -50, y: -50, zoom: 1.5 };
  if (typeof d.title !== 'string') d.title = 'Untitled';
  return d as SchematicDoc;
}
