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

// ---------------------------------------------------------------- device examples (milestone: semiconductors)
const alias = (b: Builder, x: number, y: number, text: string) => b.doc.labels.push({ id: newId('l'), x, y, text, kind: 'alias' });
const vmark = (b: Builder, x: number, y: number) => b.doc.markers.push({ id: newId('m'), kind: 'V', x, y });
const imark = (b: Builder, p: Part, pin: string) => { const q = b.pin(p, pin); b.doc.markers.push({ id: newId('m'), kind: 'I', ...q, partId: p.id, pin }); };
const tranP = (printStep: string, finalTime: string, stepCeiling = '') => ({ enabled: true, printStep, finalTime, noPrint: '0', stepCeiling, uic: false });
/** Supply VDC at (0,100) with + wired up to the rail y = 0 and − to ground. */
function supply(b: Builder, ref: string, dc: string, railTo: number[]) {
  b.part('VDC', ref, 0, 100, 0, { DC: dc });
  b.wire({ x: 0, y: 100 }, { x: 0, y: 0 });
  let x0 = 0; for (const x of railTo) { b.wire({ x: x0, y: 0 }, { x, y: 0 }); x0 = x; }
  b.wire({ x: 0, y: 140 }, { x: 0, y: 160 }); b.gnd({ x: 0, y: 160 });
}
/** Base / gate divider: R_top from the rail (140,0) to (140,40), wire to node (140,100), R_bot to ground, wire to (180,100). */
function divider2(b: Builder, rTop: string, rBot: string) {
  b.part('R', 'R1', 140, 0, 3, { VALUE: rTop });
  b.wire({ x: 140, y: 40 }, { x: 140, y: 100 });
  b.part('R', 'R2', 140, 100, 3, { VALUE: rBot });
  b.wire({ x: 140, y: 140 }, { x: 140, y: 160 }); b.gnd({ x: 140, y: 160 });
  b.wire({ x: 140, y: 100 }, { x: 180, y: 100 });
}
/** Small-signal input: VAC at (60,140), coupling capacitor (60,100)–(100,100) into node (140,100). */
function acInput(b: Builder, cin: string) {
  b.part('C', 'CIN', 60, 100, 0, { VALUE: cin, IC: '' });
  b.wire({ x: 100, y: 100 }, { x: 140, y: 100 });
  b.part('VAC', 'VIN', 60, 140, 0, { ACMAG: '1V', ACPHASE: '0', DC: '0V' });
  b.wire({ x: 60, y: 100 }, { x: 60, y: 140 });
  b.wire({ x: 60, y: 180 }, { x: 60, y: 200 }); b.gnd({ x: 60, y: 200 });
  alias(b, 60, 120, 'IN');
}

/** VS 10 V, RS 50 Ω, RL = {RL}: DC sweep of the global parameter RL; power marker on RL (max 0.5 W at 50 Ω). */
export function maxPowerTransfer(): Builder {
  const b = new Builder(); b.doc.title = 'Max_Power_Transfer';
  b.part('VDC', 'VS', 0, 100, 0, { DC: '10V' });
  b.wire({ x: 0, y: 100 }, { x: 0, y: 60 }); b.wire({ x: 0, y: 60 }, { x: 40, y: 60 });
  b.part('R', 'RS', 40, 60, 0, { VALUE: '50' });
  b.wire({ x: 80, y: 60 }, { x: 120, y: 60 });
  const rl = b.part('R', 'RL', 120, 60, 3, { VALUE: '{RL}' });
  b.wire({ x: 120, y: 100 }, { x: 120, y: 140 }); b.gnd({ x: 120, y: 140 }); b.gnd({ x: 0, y: 140 });
  b.part('PARAM', '', 180, 30, 0, { NAME1: 'RL', VALUE1: '50' });
  alias(b, 100, 60, 'OUT');
  b.doc.profile.dc = { enabled: true, varType: 'global', source: 'RL', sweep: 'lin', start: '5', end: '200', incr: '5', values: '' };
  b.doc.markers.push({ id: newId('m'), kind: 'W', x: 120, y: 80, partId: rl.id });
  return b;
}

/** VPULSE 0→10 V (TD 1 ms, TR/TF 1 µs, PW 5 ms, PER 10 ms) into R 1k + C 1µ (τ = 1 ms). */
export function vpulseRC(): Builder {
  const b = new Builder(); b.doc.title = 'VPULSE_RC';
  b.part('VPULSE', 'V1', 0, 100, 0, { V1: '0', V2: '10', TD: '1ms', TR: '1us', TF: '1us', PW: '5ms', PER: '10ms', DC: '', AC: '' });
  b.wire({ x: 0, y: 100 }, { x: 0, y: 60 }); b.wire({ x: 0, y: 60 }, { x: 40, y: 60 });
  const r = b.part('R', 'R1', 40, 60, 0, { VALUE: '1k' });
  b.wire({ x: 80, y: 60 }, { x: 120, y: 60 });
  b.part('C', 'C1', 120, 60, 3, { VALUE: '1u', IC: '' });
  b.wire({ x: 120, y: 100 }, { x: 120, y: 140 }); b.gnd({ x: 120, y: 140 }); b.gnd({ x: 0, y: 140 });
  alias(b, 20, 60, 'IN'); alias(b, 100, 60, 'OUT');
  b.doc.profile.tran = tranP('10us', '20ms', '10us');
  vmark(b, 20, 60); vmark(b, 100, 60); imark(b, r, '1');
  return b;
}

/** VSIN 10 V / 60 Hz → D1N4001 → RL 1k: half-wave rectifier. */
export function halfWave(): Builder {
  const b = new Builder(); b.doc.title = 'HalfWave_D1N4001';
  b.part('VSIN', 'V1', 0, 100, 0, { VOFF: '0', VAMPL: '10', FREQ: '60', TD: '0', DF: '0', PHASE: '0', DC: '', AC: '' });
  b.wire({ x: 0, y: 100 }, { x: 0, y: 60 }); b.wire({ x: 0, y: 60 }, { x: 40, y: 60 });
  const d = b.part('D1N4001', 'D1', 40, 60, 0);
  b.wire({ x: 80, y: 60 }, { x: 120, y: 60 });
  b.part('R', 'RL', 120, 60, 3, { VALUE: '1k' });
  b.wire({ x: 120, y: 100 }, { x: 120, y: 140 }); b.gnd({ x: 120, y: 140 }); b.gnd({ x: 0, y: 140 });
  alias(b, 8, 60, 'IN'); alias(b, 88, 60, 'OUT');
  b.doc.profile.tran = tranP('20us', '50ms', '20us');
  vmark(b, 22, 60); vmark(b, 120, 60); imark(b, d, 'A');
  return b;
}

/** 12 V → RS 1k → OUT; Zener DZ5V1 (cathode at OUT) to ground; RL 10k load. Bias point + DC sweep of V1. */
export function zenerReg(): Builder {
  const b = new Builder(); b.doc.title = 'Zener_Regulator';
  b.part('VDC', 'V1', 0, 100, 0, { DC: '12V' });
  b.wire({ x: 0, y: 100 }, { x: 0, y: 60 }); b.wire({ x: 0, y: 60 }, { x: 40, y: 60 });
  b.part('R', 'RS', 40, 60, 0, { VALUE: '1k' });
  b.wire({ x: 80, y: 60 }, { x: 120, y: 60 }); b.wire({ x: 120, y: 60 }, { x: 180, y: 60 });
  const z = b.part('ZENER', 'D1', 120, 100, 1);            // anode (120,100) at the bottom, cathode (120,60) at OUT
  b.part('R', 'RL', 180, 60, 3, { VALUE: '10k' });
  b.wire({ x: 120, y: 100 }, { x: 120, y: 140 }); b.gnd({ x: 120, y: 140 });
  b.wire({ x: 180, y: 100 }, { x: 180, y: 140 }); b.gnd({ x: 180, y: 140 }); b.gnd({ x: 0, y: 140 });
  alias(b, 140, 60, 'OUT');
  b.doc.profile.dc = { enabled: true, source: 'V1', start: '0', end: '15', incr: '0.1' };
  vmark(b, 180, 60); imark(b, z, 'K');
  return b;
}

/** Voltage-divider-biased NPN common-emitter amplifier, emitter bypassed; AC sweep 10 Hz – 10 MHz. */
export function npnCE(): Builder {
  const b = new Builder(); b.doc.title = 'NPN_CE_Amplifier';
  supply(b, 'VCC', '12V', [140, 200]);
  divider2(b, '47k', '10k');
  const q = b.part('QNPN', 'Q1', 200, 80, 0);
  b.part('R', 'RC', 200, 0, 3, { VALUE: '4.7k' });
  b.wire({ x: 200, y: 40 }, { x: 200, y: 60 }); b.wire({ x: 200, y: 60 }, { x: 200, y: 80 });
  b.part('R', 'RE', 200, 120, 3, { VALUE: '1k' });
  b.wire({ x: 200, y: 160 }, { x: 200, y: 180 }); b.gnd({ x: 200, y: 180 });
  b.wire({ x: 200, y: 120 }, { x: 240, y: 120 });
  b.part('C', 'CE', 240, 120, 3, { VALUE: '100u', IC: '' });
  b.wire({ x: 240, y: 160 }, { x: 240, y: 180 }); b.gnd({ x: 240, y: 180 });
  b.part('C', 'COUT', 200, 60, 0, { VALUE: '10u', IC: '' });
  b.wire({ x: 240, y: 60 }, { x: 280, y: 60 });
  b.part('R', 'RL', 280, 60, 3, { VALUE: '10k' });
  b.wire({ x: 280, y: 100 }, { x: 280, y: 120 }); b.gnd({ x: 280, y: 120 });
  acInput(b, '10u');
  alias(b, 160, 100, 'B'); alias(b, 200, 70, 'C'); alias(b, 220, 120, 'E'); alias(b, 250, 60, 'OUT');
  b.doc.profile.ac = { enabled: true, sweep: 'dec', points: '20', start: '10', end: '10Meg' };
  vmark(b, 280, 60);   // AC sweep: device currents are not saved by ngspice in AC, so no current marker here
  void q;
  return b;
}

/** PNP biased by a divider, emitter resistor to +12 V (symbol flipped: emitter on top). */
export function pnpBias(): Builder {
  const b = new Builder(); b.doc.title = 'PNP_Bias';
  supply(b, 'VCC', '12V', [140, 200]);
  divider2(b, '10k', '47k');
  const q = b.part('QPNP', 'Q1', 200, 120, 2); q.mirror = true;   // E (200,80) top, B (180,100), C (200,120)
  b.part('R', 'RE', 200, 0, 3, { VALUE: '1k' });
  b.wire({ x: 200, y: 40 }, { x: 200, y: 80 });
  b.part('R', 'RC', 200, 120, 3, { VALUE: '4.7k' });
  b.wire({ x: 200, y: 160 }, { x: 200, y: 180 }); b.gnd({ x: 200, y: 180 });
  alias(b, 170, 100, 'B'); alias(b, 200, 60, 'E'); alias(b, 200, 120, 'C');
  b.doc.profile.dc = { enabled: true, source: 'VCC', start: '0', end: '15', incr: '0.1' };
  vmark(b, 145, 100); imark(b, q, 'E');
  return b;
}

/** NMOS common-source amplifier: gate divider 500k/100k (VG = 2 V), RD 4.7k, source and bulk grounded. */
export function nmosCS(): Builder {
  const b = new Builder(); b.doc.title = 'NMOS_CS_Amplifier';
  supply(b, 'VDD', '12V', [140, 200]);
  divider2(b, '500k', '100k');
  const m = b.part('MbreakN', 'M1', 200, 80, 0);
  b.part('R', 'RD', 200, 0, 3, { VALUE: '4.7k' });
  b.wire({ x: 200, y: 40 }, { x: 200, y: 60 }); b.wire({ x: 200, y: 60 }, { x: 200, y: 80 });
  b.wire({ x: 220, y: 100 }, { x: 220, y: 120 }); b.wire({ x: 220, y: 120 }, { x: 200, y: 120 });   // bulk to source
  b.wire({ x: 200, y: 120 }, { x: 200, y: 160 }); b.gnd({ x: 200, y: 160 });
  acInput(b, '1u');
  alias(b, 160, 100, 'G'); alias(b, 200, 70, 'OUT');
  b.doc.profile.ac = { enabled: true, sweep: 'dec', points: '20', start: '10', end: '10Meg' };
  vmark(b, 200, 60);
  void m;
  return b;
}

/** PMOS high-side switch: source (and bulk) at VDD 5 V, RL 10k to ground, gate driven 0/5 V by VPULSE. */
export function pmosSwitch(): Builder {
  const b = new Builder(); b.doc.title = 'PMOS_Switch';
  supply(b, 'VDD', '5V', [200]);
  const m = b.part('MbreakP', 'M1', 200, 120, 2); m.mirror = true;   // S (200,80) top, G (180,100), D (200,120), B (220,100)
  b.wire({ x: 200, y: 0 }, { x: 200, y: 80 });
  b.wire({ x: 220, y: 100 }, { x: 220, y: 80 }); b.wire({ x: 220, y: 80 }, { x: 200, y: 80 });
  b.part('R', 'RL', 200, 120, 3, { VALUE: '10k' });
  b.wire({ x: 200, y: 160 }, { x: 200, y: 180 }); b.gnd({ x: 200, y: 180 });
  b.wire({ x: 200, y: 120 }, { x: 280, y: 120 });                                   // output stub
  b.part('VPULSE', 'VG', 140, 140, 0, { V1: '0', V2: '5', TD: '1ms', TR: '1us', TF: '1us', PW: '2ms', PER: '4ms', DC: '', AC: '' });
  b.wire({ x: 140, y: 140 }, { x: 140, y: 100 }); b.wire({ x: 140, y: 100 }, { x: 180, y: 100 });
  b.wire({ x: 140, y: 180 }, { x: 140, y: 200 }); b.gnd({ x: 140, y: 200 });
  alias(b, 160, 100, 'G'); alias(b, 255, 120, 'OUT');
  b.doc.profile.tran = tranP('5us', '10ms', '5us');
  vmark(b, 145, 100); vmark(b, 280, 120); imark(b, m, 'S');
  return b;
}

/** CMOS inverter (PMOS W = 20u so both devices have β = 2 mA/V²): DC transfer curve and pulse response. */
export function cmosInverter(): Builder {
  const b = new Builder(); b.doc.title = 'CMOS_Inverter';
  supply(b, 'VDD', '5V', [200]);
  const mp = b.part('MbreakP', 'M2', 200, 80, 2, { W: '20u' }); mp.mirror = true;   // S (200,40) G (180,60) D (200,80) B (220,60)
  b.wire({ x: 200, y: 0 }, { x: 200, y: 40 });
  b.wire({ x: 220, y: 60 }, { x: 220, y: 40 }); b.wire({ x: 220, y: 40 }, { x: 200, y: 40 });
  b.part('MbreakN', 'M1', 200, 100, 0);                                             // D (200,100) G (180,120) S (200,140) B (220,120)
  b.wire({ x: 200, y: 80 }, { x: 200, y: 90 }); b.wire({ x: 200, y: 90 }, { x: 200, y: 100 });
  b.wire({ x: 200, y: 90 }, { x: 260, y: 90 });                                    // output stub
  b.wire({ x: 220, y: 120 }, { x: 220, y: 140 }); b.wire({ x: 220, y: 140 }, { x: 200, y: 140 });
  b.wire({ x: 200, y: 140 }, { x: 200, y: 160 }); b.gnd({ x: 200, y: 160 });
  b.wire({ x: 180, y: 60 }, { x: 160, y: 60 }); b.wire({ x: 160, y: 60 }, { x: 160, y: 90 }); b.wire({ x: 160, y: 90 }, { x: 160, y: 120 }); b.wire({ x: 160, y: 120 }, { x: 180, y: 120 });
  b.part('VPULSE', 'VIN', 100, 90, 0, { V1: '0', V2: '5', TD: '0.5us', TR: '10ns', TF: '10ns', PW: '1us', PER: '2us', DC: '0', AC: '' });
  b.wire({ x: 100, y: 90 }, { x: 160, y: 90 });
  b.wire({ x: 100, y: 130 }, { x: 100, y: 150 }); b.gnd({ x: 100, y: 150 });
  b.doc.junctions.push({ id: newId('j'), x: 160, y: 90 });
  alias(b, 120, 90, 'IN'); alias(b, 230, 90, 'OUT');
  b.doc.profile.dc = { enabled: true, source: 'VIN', start: '0', end: '5', incr: '0.01' };
  b.doc.profile.tran = tranP('5ns', '4us', '5ns');
  vmark(b, 150, 90); vmark(b, 260, 90);
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
  { name: 'VAC RC Low-Pass Filter (AC sweep)', make: () => {
    const b = rcLowpass(); b.doc.title = 'RC_lowpass';
    b.doc.profile.ac = { enabled: true, sweep: 'dec', points: '50', start: '1', end: '100k' };
    b.doc.markers.push({ id: newId('m'), kind: 'V', x: 100, y: 60 });
    return b.doc;
  } },
  { name: 'Maximum Power Transfer (DC sweep of RL)', make: () => maxPowerTransfer().doc },
  { name: 'VPULSE RC Charging', make: () => vpulseRC().doc },
  { name: 'D1N4001 Half-Wave Rectifier', make: () => halfWave().doc },
  { name: 'Zener Voltage Regulator', make: () => zenerReg().doc },
  { name: 'NPN Common-Emitter Amplifier', make: () => npnCE().doc },
  { name: 'PNP Transistor Bias', make: () => pnpBias().doc },
  { name: 'NMOS Common-Source Amplifier', make: () => nmosCS().doc },
  { name: 'PMOS Switching Circuit', make: () => pmosSwitch().doc },
  { name: 'CMOS Inverter', make: () => cmosInverter().doc },
];

export const EXAMPLES = RAW_EXAMPLES.map(e => ({ name: e.name, make: () => translateDoc(e.make(), 200, 200) }));
