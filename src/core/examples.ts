// Example circuits. Shared by File > Open Example and the reference test suite.
import { SchematicDoc, emptyDoc, Part, Pt, Rot, newId } from './model';
import { getDef, defaultProps, pinPositions } from './library';

export class Builder {
  doc: SchematicDoc = emptyDoc();
  part(type: string, ref: string, x: number, y: number, rot: Rot = 0, props: Record<string, string> = {}): Part {
    const p: Part = { id: newId('p'), type, ref, x, y, rot, mirror: false, props: { ...defaultProps(getDef(type)), ...props } };
    this.doc.parts.push(p); return p;
  }
  pin(p: Part, name: string): Pt { const q = pinPositions(p).find(q => q.name === name)!; return { x: q.x, y: q.y }; }
  /** Orthogonal L-route: horizontal first, then vertical. */
  wire(a: Pt, b: Pt) {
    const c = { x: b.x, y: a.y };
    if (a.x !== c.x) this.doc.wires.push({ id: newId('w'), a, b: c });
    if (c.y !== b.y) this.doc.wires.push({ id: newId('w'), a: c, b });
  }
  gnd(at: Pt) { this.part('AGND', '', at.x, at.y); }
}

/** Test A divider: V1=10V, R1=2k, R2=3k, alias OUT on divider node. */
export function divider(): Builder {
  const b = new Builder();
  const v1 = b.part('VDC', 'V1', 0, 100, 0, { DC: '10V' });
  const r1 = b.part('R', 'R1', 40, 60, 0, { VALUE: '2k' });
  const r2 = b.part('R', 'R2', 120, 60, 3, { VALUE: '3k' });
  b.wire(b.pin(v1, '+'), { x: 0, y: 60 }); b.wire({ x: 0, y: 60 }, b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(r2, '2'), { x: 120, y: 160 }); b.gnd({ x: 120, y: 160 });
  b.wire(b.pin(v1, '-'), { x: 0, y: 160 }); b.gnd({ x: 0, y: 160 });
  b.doc.labels.push({ id: newId('l'), x: 100, y: 60, text: 'OUT', kind: 'alias' });
  return b;
}

/** Series source - R - X(to ground) with a VPULSE 0->10V step. Returns builder and the shunt part. */
export function stepSeries(rVal: string, shunt: 'C' | 'L', shuntVal: string, extra?: (b: Builder, top: Pt) => Pt) {
  const b = new Builder();
  const v1 = b.part('VPULSE', 'V1', 0, 100, 0, { V1: '0', V2: '10', TD: '0', TR: '1u', TF: '1u', PW: '10', PER: '20' });
  const r1 = b.part('R', 'R1', 40, 60, 0, { VALUE: rVal });
  b.wire(b.pin(v1, '+'), { x: 0, y: 60 }); b.wire({ x: 0, y: 60 }, b.pin(r1, '1'));
  let top = b.pin(r1, '2');
  if (extra) top = extra(b, top);
  const x = b.part(shunt, `${shunt}1`, 160, 60, 3, { VALUE: shuntVal, IC: '0' });
  b.wire(top, b.pin(x, '1'));
  b.doc.labels.push({ id: newId('l'), x: 160, y: 60, text: 'OUT', kind: 'alias' });
  b.wire(b.pin(x, '2'), { x: 160, y: 160 }); b.gnd({ x: 160, y: 160 });
  b.wire(b.pin(v1, '-'), { x: 0, y: 160 }); b.gnd({ x: 0, y: 160 });
  return { b, x };
}

/** RC low-pass for AC sweep: VAC 1V, R=1k, C=1u (fc = 159.15 Hz). */
export function rcLowpass(): Builder {
  const b = divider();
  const v1 = b.doc.parts.find(p => p.ref === 'V1')!;
  v1.type = 'VAC'; v1.props = { ACMAG: '1V', ACPHASE: '0', DC: '0V' };
  b.doc.parts.find(p => p.ref === 'R1')!.props.VALUE = '1k';
  const r2 = b.doc.parts.find(p => p.ref === 'R2')!;
  r2.type = 'C'; r2.ref = 'C1'; r2.props = { VALUE: '1u', IC: '' };
  return b;
}

/**
 * Switched RL reference circuit (topology assumed — see docs/REFERENCE_CIRCUITS.md):
 *   V3 12V -> U7 Sw_tOpen(2ms) -> R2 120 -> node A;  L1 0.24H from A to ground;
 *   A -> U5 Sw_tClose(2ms) -> R5 180 -> ground;      V2 24V -> U8 Sw_tClose(2.2ms) -> R4 {Rh} -> A.
 */
export function switchedRL(): Builder {
  const b = new Builder();
  b.doc.title = 'Switched_RL';
  b.part('VDC', 'V3', 0, 100, 0, { DC: '12V' });
  b.wire({ x: 0, y: 100 }, { x: 0, y: 60 });
  b.part('Sw_tOpen', 'U7', 0, 60, 0, { TOPEN: '2ms' });
  b.part('R', 'R2', 40, 60, 0, { VALUE: '120' });
  b.wire({ x: 80, y: 60 }, { x: 120, y: 60 });
  b.part('L', 'L1', 120, 60, 3, { VALUE: '0.24H', IC: '' });
  b.part('Sw_tClose', 'U5', 120, 60, 0, { TCLOSE: '2ms' });
  b.wire({ x: 160, y: 60 }, { x: 200, y: 60 });
  b.part('R', 'R5', 200, 60, 3, { VALUE: '180' });
  b.part('VDC', 'V2', 320, 100, 0, { DC: '24V' });
  b.wire({ x: 320, y: 100 }, { x: 320, y: 20 });
  b.part('Sw_tClose', 'U8', 280, 20, 0, { TCLOSE: '2.2ms' });
  b.part('R', 'R4', 240, 20, 0, { VALUE: '{Rh}' });
  b.wire({ x: 240, y: 20 }, { x: 120, y: 20 }); b.wire({ x: 120, y: 20 }, { x: 120, y: 60 });
  for (const x of [0, 120, 200, 320]) { b.wire({ x, y: x === 0 || x === 320 ? 140 : 100 }, { x, y: 160 }); b.gnd({ x, y: 160 }); }
  b.part('PARAM', '', 200, 210, 0, { NAME1: 'Rh', VALUE1: '100' });
  b.doc.labels.push({ id: newId('l'), x: 100, y: 60, text: 'A', kind: 'alias' });
  b.doc.profile.tran = { enabled: true, printStep: '10us', finalTime: '4ms', noPrint: '0', stepCeiling: '', uic: false };
  b.doc.profile.param = { enabled: true, varType: 'global', name: 'Rh', sweep: 'list', start: '1', end: '220', incr: '1', values: '1 10 50 100 220' };
  b.doc.markers.push({ id: newId('m'), kind: 'I', x: 120, y: 60, partId: b.doc.parts.find(p => p.ref === 'L1')!.id, pin: '1' });
  return b;
}

/** Shift a whole document (used to place examples inside the page border). */
export function translateDoc(d: SchematicDoc, dx: number, dy: number): SchematicDoc {
  const m = (q: Pt) => ({ x: q.x + dx, y: q.y + dy });
  return {
    ...d,
    parts: d.parts.map(p => ({ ...p, ...m(p) })),
    wires: d.wires.map(w => ({ ...w, a: m(w.a), b: m(w.b) })),
    junctions: d.junctions.map(j => ({ ...j, ...m(j) })),
    labels: d.labels.map(l => ({ ...l, ...m(l) })),
    markers: d.markers.map(k => ({ ...k, ...m(k) })),
  };
}

const RAW_EXAMPLES: { name: string; make: () => SchematicDoc }[] = [
  { name: 'Switched RL with parametric sweep of Rh (Sw_tOpen / Sw_tClose)', make: () => switchedRL().doc },
  { name: 'Voltage divider (bias point)', make: () => { const b = divider(); b.doc.title = 'Divider'; return b.doc; } },
  { name: 'RC charging (transient)', make: () => {
    const { b } = stepSeries('1k', 'C', '100u');
    b.doc.title = 'RC_charge';
    b.doc.profile.tran = { enabled: true, printStep: '1m', finalTime: '0.5', noPrint: '0', stepCeiling: '0.5m', uic: false };
    b.doc.markers.push({ id: newId('m'), kind: 'V', x: 160, y: 60 }, { id: newId('m'), kind: 'V', x: 20, y: 60 });
    return b.doc;
  } },
  { name: 'Series RLC, critically damped (transient)', make: () => {
    const { b } = stepSeries('20', 'C', '0.01', (bb, top) => { const l = bb.part('L', 'L1', 100, 60, 0, { VALUE: '1', IC: '0' }); bb.wire(top, bb.pin(l, '1')); return bb.pin(l, '2'); });
    b.doc.title = 'RLC_series';
    b.doc.profile.tran = { enabled: true, printStep: '1m', finalTime: '1', noPrint: '0', stepCeiling: '0.5m', uic: true };
    b.doc.markers.push({ id: newId('m'), kind: 'V', x: 160, y: 60 });
    return b.doc;
  } },
  { name: 'Source-free RC with capacitor IC (1st order)', make: () => {
    const b = new Builder(); b.doc.title = 'RC_sourcefree';
    b.part('C', 'C1', 100, 0, 3, { VALUE: '100u', IC: '10' });
    b.part('R', 'R1', 160, 0, 3, { VALUE: '1k' });
    b.wire({ x: 100, y: 0 }, { x: 160, y: 0 }); b.gnd({ x: 100, y: 40 }); b.gnd({ x: 160, y: 40 });
    b.doc.labels.push({ id: newId('l'), x: 130, y: 0, text: 'A', kind: 'alias' });
    b.doc.profile.tran = { enabled: true, printStep: '20ns', finalTime: '0.5', noPrint: '0', stepCeiling: '', uic: false };
    b.doc.markers.push({ id: newId('m'), kind: 'V', x: 130, y: 0 });
    return b.doc;
  } },
  { name: 'Switched RC charging, Sw_tClose (1st order)', make: () => {
    const b = new Builder(); b.doc.title = 'RC_switch';
    b.part('VDC', 'V1', 0, 0, 0, { DC: '10V' });
    b.part('Sw_tClose', 'U1', 0, 0, 0, { TCLOSE: '0' });
    b.part('R', 'R1', 40, 0, 0, { VALUE: '1k' });
    b.part('C', 'C1', 80, 0, 3, { VALUE: '100u', IC: '0' });
    b.gnd({ x: 0, y: 40 }); b.gnd({ x: 80, y: 40 });
    b.doc.labels.push({ id: newId('l'), x: 80, y: 0, text: 'OUT', kind: 'alias' });
    b.doc.profile.tran = { enabled: true, printStep: '20ns', finalTime: '0.5', noPrint: '0', stepCeiling: '', uic: false };
    b.doc.markers.push({ id: newId('m'), kind: 'V', x: 80, y: 0 });
    return b.doc;
  } },
  { name: 'Source-free series RLC with ICs, underdamped (2nd order)', make: () => {
    const b = new Builder(); b.doc.title = 'RLC_sourcefree';
    const c = b.part('C', 'C1', 100, 0, 3, { VALUE: '0.04', IC: '10' });
    b.part('L', 'L1', 100, 0, 0, { VALUE: '1', IC: '0' });
    b.part('R', 'R1', 140, 0, 3, { VALUE: '2' });
    b.gnd({ x: 100, y: 40 }); b.gnd({ x: 140, y: 40 });
    b.doc.labels.push({ id: newId('l'), x: 100, y: 0, text: 'A', kind: 'alias' });
    b.doc.profile.tran = { enabled: true, printStep: '20ns', finalTime: '5', noPrint: '0', stepCeiling: '', uic: false };
    b.doc.markers.push({ id: newId('m'), kind: 'V', x: 100, y: 0 }, { id: newId('m'), kind: 'I', x: 100, y: 0, partId: b.doc.parts.find(p => p.ref === 'L1')!.id, pin: '1' });
    void c;
    return b.doc;
  } },
  { name: 'Divider DC sweep (-10 V to +10 V)', make: () => {
    const b = divider(); b.doc.title = 'Divider_DC';
    b.doc.profile.dc = { enabled: true, source: 'V1', start: '-10', end: '10', incr: '1' };
    b.doc.markers.push({ id: newId('m'), kind: 'V', x: 100, y: 60 }, { id: newId('m'), kind: 'V', x: 20, y: 60 });
    return b.doc;
  } },
  { name: 'RC low-pass (AC sweep)', make: () => {
    const b = rcLowpass(); b.doc.title = 'RC_lowpass';
    b.doc.profile.ac = { enabled: true, sweep: 'dec', points: '50', start: '1', end: '100k' };
    b.doc.markers.push({ id: newId('m'), kind: 'V', x: 100, y: 60 });
    return b.doc;
  } },
];

export const EXAMPLES = RAW_EXAMPLES.map(e => ({ name: e.name, make: () => translateDoc(e.make(), 200, 200) }));
