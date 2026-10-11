// Import of MicroSim / PSpice Schematics (.sch, versions 8–9.1) text files.
//
// Format (as documented by the FOSSEE eSim PSpice→KiCad converter and the PSpice 9.1 file layout):
//   *version 9.1 …           header
//   @analysis                 analysis setup (".TRAN 1 …" followed by "+<index> <value>" lines)
//   @ports  port <n> <type> <x> <y> <orient>      grounds / bubbles / connectors (+ "a …" attribute lines)
//   @parts  part <n> <type> <x> <y> <orient>      components (+ "a … NAME=VALUE" attribute lines)
//   @conn   w <n> / a … LABEL=… / s x1 y1 x2 y2 …  wires and their labels;  j x y (+ "+ p/w" lines) junctions
// Coordinates are in 0.01 inch (grid 0.1 inch = 10 units), the same scale as OpenSpice.
// Orientation letters: h (normal), v / u / d (90°, 180°, 270°); upper case = mirrored.
//
// PSpice's own symbol libraries (.slb) are proprietary and not available here, so OpenSpice symbols are
// placed at the PSpice origin and each part's orientation is chosen so that its pins land on the imported
// wires; pins that still miss are joined to the nearest wire end by a short wire and reported.
import { SchematicDoc, Part, Wire, Label, Junction, Rot, Pt, emptyDoc, newId, defaultProfile, snap } from './model';
import { findDef, defaultProps, pinPositions } from './library';
import { onWire } from './connectivity';

export interface ImportReport { doc: SchematicDoc; notes: string[]; warnings: string[] }

/** PSpice part/port names → OpenSpice library names. */
const PART_ALIASES: Record<string, string> = {
  r: 'R', c: 'C', l: 'L', vdc: 'VDC', idc: 'IDC', vsin: 'VSIN', vpulse: 'VPULSE', vac: 'VAC', vpwl: 'VPWL',
  d1n4148: 'D1N4148', e: 'E', f: 'F', g: 'G', h: 'H', sw_topen: 'Sw_tOpen', sw_tclose: 'Sw_tClose',
  param: 'PARAM', bubble: 'BUBBLE',
  agnd: 'AGND', gnd_analog: 'AGND', egnd: 'GND_EARTH', gnd_earth: 'GND_EARTH',
};
/** PSpice attribute names → OpenSpice property names, per part (default: same name). */
const ATTR_ALIASES: Record<string, Record<string, string>> = {
  BUBBLE: { LABEL: 'LABEL', NAME: 'LABEL' },
};
const IGNORE_TYPES = new Set(['titleblk', 'viewpoint', 'readme', 'copyright', 'lib', 'include', 'watch1', 'vector', 'nodeset1', 'ic1', 'ic2']);
const CONNECTOR_TYPES = new Set(['offpage', 'global', 'if_in', 'if_out', 'interface', 'bubble']);

const ORIENT: Record<string, { rot: Rot; mirror: boolean }> = {
  h: { rot: 0, mirror: false }, v: { rot: 1, mirror: false }, u: { rot: 2, mirror: false }, d: { rot: 3, mirror: false },
  H: { rot: 0, mirror: true }, V: { rot: 1, mirror: true }, U: { rot: 2, mirror: true }, D: { rot: 3, mirror: true },
};

interface RawItem { kind: 'part' | 'port'; type: string; x: number; y: number; orient: string; attrs: Record<string, string>; line: number }

/** "a 0 s 11 0 10 34 hln 100 VALUE=2k" → ["VALUE", "2k"] (value may contain spaces). */
function parseAttr(line: string): [string, string] | null {
  const m = /^a\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+([^=\s]+)=(.*)$/.exec(line.trim());
  if (!m) { const k = /([A-Za-z_][\w]*)=(.*)$/.exec(line.trim()); return k ? [k[1], k[2].trim()] : null; }
  return [m[1], m[2].trim()];
}
const unset = (v: string | undefined) => v === undefined || v === '' || v === '?' || /^\?+$/.test(v);

export function importSch(text: string, fileName = 'imported.sch'): ImportReport {
  const notes: string[] = [], warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!/^\*version\s/i.test(lines[0] ?? '')) {
    if (lines.some(l => /^@(parts|conn|ports)\b/.test(l))) warnings.push('No "*version" header — reading it as a PSpice Schematics file anyway.');
    else throw new Error('This is not a PSpice/MicroSim Schematics (.sch) file (no *version header or @parts/@conn sections). OrCAD Capture designs (.dsn/.opj) are a different format.');
  } else notes.push(`File: ${lines[0].trim()}`);

  const items: RawItem[] = [];
  const wires: Wire[] = [], labels: Label[] = [], junctions: Junction[] = [];
  const analysis: string[] = [];
  let section = '', page = 0, cur: RawItem | null = null, wireGroup: Wire[] = [], wireLabel: string | null = null;
  const flushWire = () => {
    if (wireLabel && wireGroup.length) {
      const w = wireGroup[0];
      labels.push({ id: newId('l'), x: snap((w.a.x + w.b.x) / 2), y: w.a.y === w.b.y ? w.a.y : snap((w.a.y + w.b.y) / 2), text: wireLabel, kind: 'alias' });
    }
    wireGroup = []; wireLabel = null;
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('*page')) { page++; if (page > 1) warnings.push(`Page ${page} found — only page 1 is imported (multi-page schematics are not supported yet).`); return; }
    if (line.startsWith('@')) { flushWire(); cur = null; section = line.slice(1).split(/\s/)[0].toLowerCase(); return; }
    if (page > 1) return;
    if (section === 'analysis') { analysis.push(line); return; }
    if (section === 'parts' || section === 'ports') {
      const m = /^(part|port)\s+\d+\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s+([hvudHVUD])/.exec(line);
      if (m) { cur = { kind: m[1] as 'part' | 'port', type: m[2], x: +m[3], y: +m[4], orient: m[5], attrs: {}, line: idx + 1 }; items.push(cur); return; }
      if (line.startsWith('a ') && cur) { const a = parseAttr(line); if (a) cur.attrs[a[0].toUpperCase()] = a[1]; }
      return;
    }
    if (section === 'conn') {
      if (/^w\s+\d+/.test(line)) { flushWire(); return; }
      if (line.startsWith('a ')) { const a = parseAttr(line); if (a && a[0].toUpperCase() === 'LABEL' && !unset(a[1])) wireLabel = a[1]; return; }
      const s = /^s\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/.exec(line);
      if (s) {
        const [x1, y1, x2, y2] = [+s[1], +s[2], +s[3], +s[4]];
        if (x1 === x2 && y1 === y2) return;
        if (x1 !== x2 && y1 !== y2) { warnings.push(`Line ${idx + 1}: diagonal wire segment split into two orthogonal segments`); const w1 = { id: newId('w'), a: { x: x1, y: y1 }, b: { x: x2, y: y1 } }, w2 = { id: newId('w'), a: { x: x2, y: y1 }, b: { x: x2, y: y2 } }; wires.push(w1, w2); wireGroup.push(w1, w2); return; }
        const w = { id: newId('w'), a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
        wires.push(w); wireGroup.push(w); return;
      }
      const j = /^j\s+(-?\d+)\s+(-?\d+)/.exec(line);
      if (j) { junctions.push({ id: newId('j'), x: +j[1], y: +j[2] }); return; }
    }
  });
  flushWire();

  // ---- parts ----
  const doc = emptyDoc();
  doc.title = fileName.replace(/\.[^.]+$/, '') || 'Imported';
  doc.wires = wires; doc.labels = labels; doc.junctions = junctions;
  const refsSeen = new Set<string>();
  const counters: Record<string, number> = {};
  for (const it of items) {
    const t = it.type.toLowerCase();
    if (IGNORE_TYPES.has(t)) continue;
    const isConnector = CONNECTOR_TYPES.has(t);
    const name = isConnector ? 'BUBBLE' : (PART_ALIASES[t] ?? findDef(it.type)?.name);
    const def = name ? findDef(name) : undefined;
    if (!def) {
      warnings.push(`Unsupported part "${it.type}"${it.attrs.REFDES ? ` (${it.attrs.REFDES})` : ''} at (${it.x / 100}, ${it.y / 100}) in — not imported; its wires are kept.`);
      doc.labels.push({ id: newId('l'), x: it.x, y: it.y - 12, text: `[${it.type}${it.attrs.REFDES ? ' ' + it.attrs.REFDES : ''} not supported]`, kind: 'text' });
      continue;
    }
    const o = ORIENT[it.orient] ?? ORIENT.h;
    const props = defaultProps(def);
    const amap = ATTR_ALIASES[def.name] ?? {};
    for (const [k, v] of Object.entries(it.attrs)) {
      const key = amap[k] ?? k;
      if (key in props && !unset(v)) props[key] = v;
    }
    if (isConnector) {
      const lab = it.attrs.LABEL ?? it.attrs.NAME ?? it.attrs.VALUE;
      if (!unset(lab)) props.LABEL = lab!;
      else warnings.push(`Connector "${it.type}" at (${it.x / 100}, ${it.y / 100}) in has no label`);
    }
    let ref = '';
    if (def.refPrefix) {
      ref = !unset(it.attrs.REFDES) ? it.attrs.REFDES.replace(/[^A-Za-z0-9_]/g, '_') : '';
      if (!ref || refsSeen.has(ref.toUpperCase())) {
        do { counters[def.refPrefix] = (counters[def.refPrefix] ?? 0) + 1; ref = `${def.refPrefix}${counters[def.refPrefix]}`; } while (refsSeen.has(ref.toUpperCase()));
      }
      refsSeen.add(ref.toUpperCase());
    }
    const p: Part = { id: newId('p'), type: def.name, ref, x: it.x, y: it.y, rot: o.rot, mirror: o.mirror, props };
    doc.parts.push(p);
  }

  // ---- align pins with the imported wiring ----
  const isEnd = (q: Pt) => doc.wires.some(w => (w.a.x === q.x && w.a.y === q.y) || (w.b.x === q.x && w.b.y === q.y));
  const touches = (q: Pt, self: Part) =>
    doc.wires.some(w => onWire(w, q)) || doc.parts.some(o => o !== self && pinPositions(o).some(pp => pp.x === q.x && pp.y === q.y));
  /** How well a part sits on the wiring: pins on wire ends or other pins score 2, on a wire's middle 1;
   *  two pins on the same wire would short the part, which is heavily penalised. */
  const score = (p: Part) => {
    const pins = pinPositions(p);
    let sc = 0;
    for (const q of pins) sc += isEnd(q) || doc.parts.some(o => o !== p && pinPositions(o).some(pp => pp.x === q.x && pp.y === q.y)) ? 2 : touches(q, p) ? 1 : 0;
    for (const w of doc.wires) if (pins.filter(q => onWire(w, q)).length > 1) sc -= 3;
    return sc;
  };
  let reoriented = 0, stubs = 0;
  for (const p of doc.parts) {
    const declared = { rot: p.rot, mirror: p.mirror };
    let best = score(p), bestO = declared;
    if (best < 2 * pinPositions(p).length) {
      for (const rot of [0, 1, 2, 3] as Rot[]) for (const mirror of [false, true]) {
        Object.assign(p, { rot, mirror });
        const sc = score(p);
        if (sc > best) { best = sc; bestO = { rot, mirror }; }
      }
      Object.assign(p, bestO);
      if (bestO.rot !== declared.rot || bestO.mirror !== declared.mirror) reoriented++;
    }
  }
  for (const p of doc.parts) {
    for (const q of pinPositions(p)) {
      if (touches(q, p)) continue;
      // nearest wire end within 3 grid steps → short orthogonal stub wire
      let bestEnd: Pt | null = null, bd = 30.5;
      for (const w of doc.wires) for (const e of [w.a, w.b]) {
        const d = Math.abs(e.x - q.x) + Math.abs(e.y - q.y);
        if (d > 0 && d < bd) { bd = d; bestEnd = e; }
      }
      if (bestEnd) {
        const c = { x: bestEnd.x, y: q.y };
        if (c.x !== q.x) doc.wires.push({ id: newId('w'), a: { ...q }, b: c });
        if (c.y !== bestEnd.y) doc.wires.push({ id: newId('w'), a: c, b: { ...bestEnd } });
        stubs++;
      } else if (!findDef(p.type)?.isParam) warnings.push(`${p.ref || p.type} pin ${q.name} is not connected to any wire`);
    }
  }
  if (reoriented) notes.push(`${reoriented} part(s) were turned so their pins meet the wires (PSpice symbol origins differ from OpenSpice's).`);
  if (stubs) warnings.push(`${stubs} pin(s) did not line up with a wire end and were joined to the nearest wire end with a short wire — please check them.`);

  // ---- analysis setup ----
  doc.profile = { ...defaultProfile(), ...importAnalysis(analysis, notes, warnings) };
  notes.push(`Imported ${doc.parts.length} part(s), ${wires.length} wire segment(s), ${labels.length} net label(s), ${junctions.length} junction(s).`);
  return { doc, notes, warnings };
}

/**
 * @analysis block, e.g.
 *   .TRAN 1 0 0 0          (first number: 1 = enabled)
 *   +0 20ns                (index 0 print step, 1 final time, 2 no-print delay, 3 step ceiling)
 * Fields that cannot be read are left at their defaults and reported.
 */
function importAnalysis(lines: string[], notes: string[], warnings: string[]): Partial<SchematicDoc['profile']> {
  const out: Partial<SchematicDoc['profile']> = {};
  const blocks: { cmd: string; head: string[]; plus: Map<number, string[]>; lines: string[][] }[] = [];
  for (const l of lines) {
    const m = /^\.(\w+)\s*(.*)$/.exec(l);
    if (m) { blocks.push({ cmd: m[1].toUpperCase(), head: m[2].split(/\s+/).filter(Boolean), plus: new Map(), lines: [] }); continue; }
    if (/^\+/.test(l) && blocks.length) blocks[blocks.length - 1].lines.push(l.slice(1).trim().split(/\s+/));
    const p = /^\+\s*(\d+)\s+(.*)$/.exec(l);
    if (p && blocks.length) blocks[blocks.length - 1].plus.set(+p[1], p[2].trim().split(/\s+/));
    else if (/^\+\s*\d+\s+\d+\s+/.test(l) && blocks.length) { const t = l.slice(1).trim().split(/\s+/); blocks[blocks.length - 1].plus.set(+t[1], t.slice(2)); }
  }
  const prof = defaultProfile();
  for (const b of blocks) {
    const enabled = b.head[0] === '1';
    const v = (i: number) => b.plus.get(i)?.[0];
    if (b.cmd === 'TRAN') {
      out.tran = { ...prof.tran, enabled, printStep: v(0) ?? prof.tran.printStep, finalTime: v(1) ?? prof.tran.finalTime, noPrint: v(2) ?? '0', stepCeiling: v(3) ?? '', uic: b.plus.get(4)?.[0] === '1' || /skipbp|uic/i.test([...b.plus.values()].flat().join(' ')) };
      notes.push(`Transient: ${enabled ? 'enabled' : 'disabled'}, print step ${out.tran.printStep}, final time ${out.tran.finalTime}${out.tran.stepCeiling ? `, ceiling ${out.tran.stepCeiling}` : ''}`);
    } else if (b.cmd === 'DC') {
      // "+ 0 <field> <value>": field 0 = swept source name, 4 = start, 5 = end, 6 = increment
      const f = new Map<string, string>();
      for (const t of b.lines) if (t.length >= 3) f.set(t[1], t.slice(2).join(' '));
      const src = f.get('0') ?? b.lines.flat().find(t => /^[VI]\w*$/i.test(t));
      if (src && f.get('4') && f.get('5') && f.get('6')) {
        out.dc = { enabled, source: src, start: f.get('4')!, end: f.get('5')!, incr: f.get('6')! };
        notes.push(`DC sweep of ${src}: ${out.dc.start} → ${out.dc.end} step ${out.dc.incr}${enabled ? '' : ' (disabled)'}`);
      } else if (enabled) warnings.push('DC Sweep settings could not be read — please set them in Analysis Setup.');
    } else if (b.cmd === 'AC') {
      const sweep = ({ '1': 'lin', '2': 'oct', '3': 'dec' } as const)[b.head[1] as '1' | '2' | '3'] ?? 'dec';
      if (v(0) && v(1) && v(2)) {
        out.ac = { enabled, sweep, points: v(0)!, start: v(1)!, end: v(2)! };
        notes.push(`AC sweep (${sweep}): ${out.ac.points} pts, ${out.ac.start} → ${out.ac.end}${enabled ? '' : ' (disabled)'}`);
      } else if (enabled) warnings.push('AC Sweep settings could not be read — please set them in Analysis Setup.');
    } else if (b.cmd === 'OP') {
      // bias point is always computed
    } else if (enabled) warnings.push(`Analysis .${b.cmd} is not supported yet and was not imported.`);
  }
  return out;
}
