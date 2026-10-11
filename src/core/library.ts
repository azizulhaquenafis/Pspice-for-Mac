// Part library: symbol geometry, pins, properties and SPICE netlist rules.
// Symbols are original drawings in the style of textbook / classic PSpice symbols.
// Local coordinates in world units (grid = 10). Pin 0 is at the part origin.

import { Part, Pt } from './model';
import { dbreak, d1n4001, zener, qnpn, qpnp, mbreakN, mbreakP } from './semis';

export interface PropDef {
  name: string;
  default: string;
  /** num: number / {expression}; text: free text (PWL points, PARAM names); model: .model name;
   *  raw: further NAME=value .model parameters */
  kind: 'num' | 'text' | 'model' | 'raw';
  unit?: string;
  optional?: boolean;   // empty value allowed (omitted from netlist)
  help?: string;
  /** Parameter of the part's .model card (not of the device line). */
  model?: boolean;
}

export interface TextAnchor { x: number; y: number; align: 'start' | 'middle' | 'end' }

export interface PartDef {
  name: string;          // library name shown in Part Browser (PSpice-like)
  description: string;
  /** Part Browser group: Sources, Passive, Diodes, BJT, MOSFET, Switches, Other. */
  category: string;
  /** Other names the Part Browser search and the part-name box accept (e.g. NMOS → MbreakN). */
  aliases?: string[];
  /** Device needs a generated .model card of this type from its `model` props. */
  modelType?: 'D' | 'NPN' | 'PNP' | 'NMOS' | 'PMOS';
  /** Symbol body box [x0, y0, x1, y1] in local units, for hit-testing (default: pins + a 40-wide body). */
  body?: [number, number, number, number];
  refPrefix: string;     // reference designator prefix ("" = not annotated, e.g. ground)
  spiceLetter: string;
  pins: { name: string; x: number; y: number }[];
  paths: string[];       // SVG path data (stroked)
  fills?: string[];      // SVG path data (filled)
  circles?: { cx: number; cy: number; r: number }[];
  texts?: { x: number; y: number; t: string; size?: number }[]; // fixed symbol glyphs
  refPos: TextAnchor;
  valPos: TextAnchor;
  props: PropDef[];
  valueProp?: string;    // which property is shown on schematic as "value"
  isGround?: boolean;
  /** PARAMETERS block: no pins; NAMEn/VALUEn define global parameters (.param). */
  isParam?: boolean;
  /** BUBBLE: a named connector; every BUBBLE/net alias with the same LABEL is the same net. */
  isBubble?: boolean;
  models?: string[];     // .model cards this part needs
  /** Electrical sanity checks on the evaluated property values (messages become netlist errors). */
  check?: (num: Record<string, number>) => string[];
  /** v: netlist text per property (number or {expression}); num: evaluated numeric values. */
  netline?: (name: string, nodes: string[], v: Record<string, string>, part: Part, num: Record<string, number>) => string;
}

const res: PartDef = {
  name: 'R', description: 'Resistor', category: 'Passive', refPrefix: 'R', spiceLetter: 'R',
  pins: [{ name: '1', x: 0, y: 0 }, { name: '2', x: 40, y: 0 }],
  paths: ['M0 0 H8 L10 -5 L14 5 L18 -5 L22 5 L26 -5 L30 5 L32 0 H40'],
  refPos: { x: 20, y: -9, align: 'middle' }, valPos: { x: 20, y: 16, align: 'middle' },
  props: [{ name: 'VALUE', default: '1k', kind: 'num', unit: 'Ω' }], valueProp: 'VALUE',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]} ${v.VALUE}`,
};

const cap: PartDef = {
  name: 'C', description: 'Capacitor', category: 'Passive', refPrefix: 'C', spiceLetter: 'C',
  pins: [{ name: '1', x: 0, y: 0 }, { name: '2', x: 40, y: 0 }],
  paths: ['M0 0 H17 M17 -9 V9 M23 -9 V9 M23 0 H40'],
  refPos: { x: 20, y: -13, align: 'middle' }, valPos: { x: 20, y: 20, align: 'middle' },
  props: [
    { name: 'VALUE', default: '1n', kind: 'num', unit: 'F' },
    { name: 'IC', default: '', kind: 'num', unit: 'V', optional: true, help: 'Initial voltage V(1)-V(2)' },
  ], valueProp: 'VALUE',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]} ${v.VALUE}${v.IC ? ` IC=${v.IC}` : ''}`,
};

const ind: PartDef = {
  name: 'L', description: 'Inductor', category: 'Passive', refPrefix: 'L', spiceLetter: 'L',
  pins: [{ name: '1', x: 0, y: 0 }, { name: '2', x: 40, y: 0 }],
  paths: ['M0 0 H8 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 a3 3 0 0 1 6 0 H40'],
  refPos: { x: 20, y: -9, align: 'middle' }, valPos: { x: 20, y: 14, align: 'middle' },
  props: [
    { name: 'VALUE', default: '10uH', kind: 'num', unit: 'H' },
    { name: 'IC', default: '', kind: 'num', unit: 'A', optional: true, help: 'Initial current from pin 1 to pin 2' },
  ], valueProp: 'VALUE',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]} ${v.VALUE}${v.IC ? ` IC=${v.IC}` : ''}`,
};

// Vertical two-terminal source body: + pin at top (0,0), - pin at bottom (0,40)
const srcBody = { paths: ['M0 0 V10 M0 30 V40'], circles: [{ cx: 0, cy: 20, r: 10 }] };
const srcText = { refPos: { x: 14, y: 14, align: 'start' as const }, valPos: { x: 14, y: 30, align: 'start' as const } };
const pm = [{ x: -6, y: 7, t: '+', size: 8 }, { x: -6, y: 37, t: '−', size: 8 }];
const dcac = (v: Record<string, string>) => `${v.DC ? ` DC ${v.DC}` : ''}${v.AC ? ` AC ${v.AC}` : ''}`;
const optDC: PropDef = { name: 'DC', default: '', kind: 'num', unit: 'V', optional: true };
const optAC: PropDef = { name: 'AC', default: '', kind: 'num', unit: 'V', optional: true, help: 'AC magnitude for AC sweep' };

const vdc: PartDef = {
  name: 'VDC', description: 'DC voltage source', category: 'Sources', refPrefix: 'V', spiceLetter: 'V',
  pins: [{ name: '+', x: 0, y: 0 }, { name: '-', x: 0, y: 40 }],
  ...srcBody, ...srcText,
  paths: [...srcBody.paths, 'M-4 15 H4 M0 11 V19 M-4 26 H4'],
  props: [{ name: 'DC', default: '0V', kind: 'num', unit: 'V' }], valueProp: 'DC',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]} DC ${v.DC}`,
};

const idc: PartDef = {
  name: 'IDC', description: 'DC current source (current flows + → − through the source)', category: 'Sources',
  refPrefix: 'I', spiceLetter: 'I',
  pins: [{ name: '+', x: 0, y: 0 }, { name: '-', x: 0, y: 40 }],
  ...srcBody, ...srcText,
  paths: [...srcBody.paths, 'M0 13 V27'], fills: ['M-3.5 22 L3.5 22 L0 28 Z'],
  props: [{ name: 'DC', default: '0A', kind: 'num', unit: 'A' }], valueProp: 'DC',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]} DC ${v.DC}`,
};

const vsin: PartDef = {
  name: 'VSIN', description: 'Sinusoidal voltage source', category: 'Sources', refPrefix: 'V', spiceLetter: 'V',
  pins: [{ name: '+', x: 0, y: 0 }, { name: '-', x: 0, y: 40 }],
  ...srcBody, ...srcText, texts: pm,
  paths: [...srcBody.paths, 'M-6 20 C-4 12 -2 12 0 20 C2 28 4 28 6 20'],
  props: [
    { name: 'VOFF', default: '0', kind: 'num', unit: 'V' },
    { name: 'VAMPL', default: '1', kind: 'num', unit: 'V' },
    { name: 'FREQ', default: '1k', kind: 'num', unit: 'Hz' },
    { name: 'TD', default: '0', kind: 'num', unit: 's' },
    { name: 'DF', default: '0', kind: 'num', unit: '1/s', help: 'Damping factor' },
    { name: 'PHASE', default: '0', kind: 'num', unit: '°' },
    optDC, optAC,
  ], valueProp: 'VAMPL',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]}${dcac(v)} SIN(${v.VOFF} ${v.VAMPL} ${v.FREQ} ${v.TD} ${v.DF} ${v.PHASE})`,
};

const vpulse: PartDef = {
  name: 'VPULSE', description: 'Pulse voltage source', category: 'Sources', refPrefix: 'V', spiceLetter: 'V',
  pins: [{ name: '+', x: 0, y: 0 }, { name: '-', x: 0, y: 40 }],
  ...srcBody, ...srcText, texts: pm,
  paths: [...srcBody.paths, 'M-6 24 H-3 V15 H3 V24 H6'],
  props: [
    { name: 'V1', default: '0', kind: 'num', unit: 'V', help: 'Initial voltage' },
    { name: 'V2', default: '5', kind: 'num', unit: 'V', help: 'Pulsed voltage' },
    { name: 'TD', default: '0', kind: 'num', unit: 's', help: 'Delay' },
    { name: 'TR', default: '1n', kind: 'num', unit: 's', help: 'Rise time' },
    { name: 'TF', default: '1n', kind: 'num', unit: 's', help: 'Fall time' },
    { name: 'PW', default: '500n', kind: 'num', unit: 's', help: 'Pulse width' },
    { name: 'PER', default: '1u', kind: 'num', unit: 's', help: 'Period' },
    optDC, optAC,
  ], valueProp: 'V2',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]}${dcac(v)} PULSE(${v.V1} ${v.V2} ${v.TD} ${v.TR} ${v.TF} ${v.PW} ${v.PER})`,
  check: x => {
    const e = ['TD', 'TR', 'TF', 'PW', 'PER'].filter(k => x[k] < 0).map(k => `${k} must not be negative (${x[k]})`);
    if (!e.length && x.PER > 0 && x.TR + x.PW + x.TF > x.PER * (1 + 1e-12))
      e.push(`TR + PW + TF = ${+(x.TR + x.PW + x.TF).toPrecision(6)} s is longer than the period PER = ${x.PER} s (use PER ≥ TR + PW + TF, or PER = 0 for a single pulse)`);
    return e;
  },
};

const vac: PartDef = {
  name: 'VAC', description: 'AC voltage source (AC sweep)', category: 'Sources', refPrefix: 'V', spiceLetter: 'V',
  pins: [{ name: '+', x: 0, y: 0 }, { name: '-', x: 0, y: 40 }],
  ...srcBody, ...srcText, texts: pm,
  paths: [...srcBody.paths, 'M-5 20 C-3 15 -1 15 0 20 C1 25 3 25 5 20'],
  props: [
    { name: 'ACMAG', default: '1V', kind: 'num', unit: 'V' },
    { name: 'ACPHASE', default: '0', kind: 'num', unit: '°' },
    { name: 'DC', default: '0V', kind: 'num', unit: 'V' },
  ], valueProp: 'ACMAG',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]} DC ${v.DC} AC ${v.ACMAG} ${v.ACPHASE}`,
};

const vpwl: PartDef = {
  name: 'VPWL', description: 'Piecewise-linear voltage source', category: 'Sources', refPrefix: 'V', spiceLetter: 'V',
  pins: [{ name: '+', x: 0, y: 0 }, { name: '-', x: 0, y: 40 }],
  ...srcBody, ...srcText, texts: pm,
  paths: [...srcBody.paths, 'M-6 25 L-2 15 L2 22 L6 15'],
  props: [{ name: 'POINTS', default: '0 0 1m 1 2m 1', kind: 'text', help: 'Time/value pairs: t1 v1 t2 v2 ...' }],
  valueProp: 'POINTS',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]} PWL(${v.POINTS})`,
};

const diode: PartDef = {
  name: 'D1N4148', description: 'Small-signal diode (generic 1N4148-style model)', category: 'Diodes',
  refPrefix: 'D', spiceLetter: 'D',
  pins: [{ name: 'A', x: 0, y: 0 }, { name: 'K', x: 40, y: 0 }],
  paths: ['M0 0 H14 M26 0 H40 M26 -8 V8'], fills: ['M14 -8 L14 8 L26 0 Z'],
  refPos: { x: 20, y: -12, align: 'middle' }, valPos: { x: 20, y: 20, align: 'middle' },
  props: [], models: ['.model D1N4148 D(Is=2.682n N=1.836 Rs=.5664 Ikf=44.17m Cjo=4p M=.3333 Vj=.5 Bv=100 Ibv=100u Tt=11.54n)'],
  netline: (n, N) => `${n} ${N[0]} ${N[1]} D1N4148`,
};

/**
 * Dependent sources in the PSpice Schematics style: a box with the controlling side on the left and
 * the output source on the right. Pins: C+ (0,0), C- (0,40) left; + (40,0), - (40,40) right — the same
 * pin positions as OpenSpice 0.4.0 and earlier, so older schematics keep their wiring.
 *  E: VCVS  — left "+/−" sense terminals, right voltage-source circle (±)
 *  G: VCCS  — left "+/−" sense terminals, right current-source circle (↓)
 *  F: CCCS  — left current path (↓, C+ → C−), right current-source circle (↓)
 *  H: CCVS  — left current path (↓, C+ → C−), right voltage-source circle (±)
 * F and H sense their controlling current with a private 0 V source "V__SENSE_<name>" in series with
 * the left pins (the same way PSpice netlists F/H parts). Positive control current enters C+.
 */
const ctrlSrc = (letter: 'E' | 'F' | 'G' | 'H', desc: string, unit: string): PartDef => {
  const currentControlled = letter === 'F' || letter === 'H';
  const currentOutput = letter === 'G' || letter === 'F';
  const plusMinus = ['M24 18 H28 M26 16 V20 M24 23.5 H28'];                       // ± inside the circle
  const arrowDown = ['M26 15.5 V24.5', 'M24 21.5 L26 24.5 L28 21.5'];             // ↓ inside the circle
  return {
    name: letter, description: desc, category: 'Other', refPrefix: letter, spiceLetter: letter,
    pins: [{ name: '+', x: 40, y: 0 }, { name: '-', x: 40, y: 40 }, { name: 'C+', x: 0, y: 0 }, { name: 'C-', x: 0, y: 40 }],
    paths: [
      'M7 -5 H33 V45 H7 Z',                                                        // body
      currentControlled ? 'M0 0 H13 V40 H0' : 'M0 0 H12 M0 40 H12',               // control side
      ...(currentControlled ? ['M10.5 17 L13 22 L15.5 17'] : []),                 // ↓ on the sense path
      'M40 0 H26 V14.5 M26 25.5 V40 H40',                                          // output leads to the circle
      ...(currentOutput ? arrowDown : plusMinus),
    ],
    circles: [{ cx: 26, cy: 20, r: 5.5 }],
    texts: currentControlled ? [] : [{ x: 11, y: 9.5, t: '+', size: 8 }, { x: 11, y: 36, t: '−', size: 8 }],
    refPos: { x: 7, y: -9, align: 'start' }, valPos: { x: 7, y: 54, align: 'start' },
    props: [{ name: 'GAIN', default: '1', kind: 'num', unit, help: { E: 'Vout/Vcontrol', G: 'Iout/Vcontrol (S)', F: 'Iout/Icontrol', H: 'Vout/Icontrol (Ω)' }[letter] }],
    valueProp: 'GAIN',
    netline: (n, N, v) => currentControlled
      ? [`V__SENSE_${n} ${N[2]} ${N[3]} 0`, `${n} ${N[0]} ${N[1]} V__SENSE_${n} ${v.GAIN}`].join('\n')
      : `${n} ${N[0]} ${N[1]} ${N[2]} ${N[3]} ${v.GAIN}`,
  };
};

// Time-controlled switches (PSpice Sw_tClose / Sw_tOpen behaviour): an ngspice voltage-controlled
// switch driven by a private PWL control source. Bias point: tClose is open, tOpen is closed.
//
// Canonical geometry (local units, pins at (0,0) and (40,0)): leads to two contact circles at
// x=13 and x=27 (r=2); the blade pivots on the left contact. Sw_tClose is drawn OPEN (blade raised,
// arrow swinging down = closes); Sw_tOpen is drawn CLOSED (blade on the right contact, arrow swinging
// up = opens). The arrow is an arc around the pivot computed from angles, so it never crosses the blade.
const r2 = (v: number) => Math.round(v * 100) / 100;
function arcArrow(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string[] {
  const pt = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
  const [x0, y0] = pt(fromDeg), [x1, y1] = pt(toDeg);
  const ccw = toDeg > fromDeg; // counter-clockwise on screen when the angle increases
  const arc = `M${r2(x0)} ${r2(y0)} A${r} ${r} 0 0 ${ccw ? 0 : 1} ${r2(x1)} ${r2(y1)}`;
  // tangent at the tip in the direction of travel (screen coordinates, y down)
  const t = (toDeg * Math.PI) / 180, s = ccw ? 1 : -1;
  const dx = -Math.sin(t) * s, dy = -Math.cos(t) * s;
  const back = Math.atan2(-dy, -dx), L = 3.2, spread = (28 * Math.PI) / 180;
  const b1 = [x1 + L * Math.cos(back + spread), y1 + L * Math.sin(back + spread)];
  const b2 = [x1 + L * Math.cos(back - spread), y1 + L * Math.sin(back - spread)];
  return [arc, `M${r2(b1[0])} ${r2(b1[1])} L${r2(x1)} ${r2(y1)} L${r2(b2[0])} ${r2(b2[1])}`];
}

const swTime = (closing: boolean): PartDef => ({
  name: closing ? 'Sw_tClose' : 'Sw_tOpen',
  description: closing ? 'Time-controlled switch: open, closes at TCLOSE' : 'Time-controlled switch: closed, opens at TOPEN',
  category: 'Switches', refPrefix: 'U', spiceLetter: 'S',
  pins: [{ name: '1', x: 0, y: 0 }, { name: '2', x: 40, y: 0 }],
  paths: [
    'M0 0 H11 M29 0 H40',
    closing ? 'M14.6 -1.2 L26 -9.5' : 'M14.7 -1.0 L27.5 -2.2',
    ...(closing ? arcArrow(13, 0, 15, 62, 22) : arcArrow(13, 0, 15, 22, 62)),
  ],
  circles: [{ cx: 13, cy: 0, r: 2 }, { cx: 27, cy: 0, r: 2 }],
  refPos: { x: 4, y: -10, align: 'start' }, valPos: { x: 20, y: 12, align: 'middle' },
  props: [
    { name: closing ? 'TCLOSE' : 'TOPEN', default: '0', kind: 'num', unit: 's', help: closing ? 'Time the switch closes' : 'Time the switch opens' },
    { name: 'TTRAN', default: '1u', kind: 'num', unit: 's', help: 'Transition time' },
    { name: 'RCLOSED', default: '0.01', kind: 'num', unit: 'Ω' },
    { name: 'ROPEN', default: '1Meg', kind: 'num', unit: 'Ω' },
  ], valueProp: closing ? 'TCLOSE' : 'TOPEN',
  netline: (n, N, v, _p, num) => {
    const t = num[closing ? 'TCLOSE' : 'TOPEN'], tt = Math.max(num.TTRAN, 1e-12);
    const [a, b] = closing ? [0, 1] : [1, 0];
    const f = (x: number) => +x.toPrecision(12);
    const pwl = t > 0 ? `0 ${a} ${f(t)} ${a} ${f(t + tt)} ${b}` : `0 ${a} ${f(tt)} ${b}`;
    const ctl = `__sw_${n}`;
    return [`${n} ${N[0]} ${N[1]} ${ctl} 0 SW_${n}`, `V${ctl} ${ctl} 0 PWL(${pwl})`,
      `.model SW_${n} SW(Ron=${v.RCLOSED} Roff=${v.ROPEN} Vt=0.5 Vh=0)`].join('\n');
  },
});

/** PSpice BUBBLE (port library): connects nets by name without drawing wires. Pin at the circle's edge. */
const bubble: PartDef = {
  name: 'BUBBLE', description: 'Bubble: connects every pin/wire with the same LABEL (no wire needed)', category: 'Other',
  refPrefix: '', spiceLetter: '', isBubble: true,
  pins: [{ name: '1', x: 0, y: 0 }],
  paths: ['M0 0 H6'], circles: [{ cx: 10, cy: 0, r: 4 }],                     // pin — stub — bubble (Ctrl+R to turn it)
  refPos: { x: 6, y: -7, align: 'start' }, valPos: { x: 6, y: -7, align: 'start' },
  props: [{ name: 'LABEL', default: '', kind: 'text', help: 'Net name — bubbles with the same LABEL are connected ("0" = ground)' }],
  valueProp: 'LABEL',
};

export const PARAM_SLOTS = 3;
const paramBlock: PartDef = {
  name: 'PARAM', description: 'PARAMETERS block: global parameters for {expressions} and parametric sweeps',
  category: 'Other', refPrefix: '', spiceLetter: '', pins: [], paths: [], isParam: true,
  refPos: { x: 0, y: 0, align: 'start' }, valPos: { x: 0, y: 0, align: 'start' },
  props: Array.from({ length: PARAM_SLOTS }, (_, i) => [
    { name: `NAME${i + 1}`, default: '', kind: 'text' as const, optional: true, help: 'Parameter name, e.g. Rh' },
    { name: `VALUE${i + 1}`, default: '', kind: 'text' as const, optional: true, help: 'Value (1k) or {expression}' },
  ]).flat(),
};

const agnd: PartDef = {
  name: 'AGND', description: 'Analog ground (SPICE node 0)', category: 'Other', refPrefix: '', spiceLetter: '',
  pins: [{ name: 'GND', x: 0, y: 0 }],
  paths: ['M0 0 V10 M-10 10 H10 L0 20 Z'],
  texts: [], refPos: { x: 14, y: 20, align: 'start' }, valPos: { x: 14, y: 20, align: 'start' },
  props: [], isGround: true,
};

const gndEarth: PartDef = {
  name: 'GND_EARTH', description: 'Earth ground (SPICE node 0)', category: 'Other', refPrefix: '', spiceLetter: '',
  pins: [{ name: 'GND', x: 0, y: 0 }],
  paths: ['M0 0 V10 M-10 10 H10 M-6 14 H6 M-2 18 H2'],
  refPos: { x: 14, y: 20, align: 'start' }, valPos: { x: 14, y: 20, align: 'start' },
  props: [], isGround: true,
};

export const LIBRARY: PartDef[] = [
  vdc, idc, vac, vsin, vpulse, vpwl,
  res, cap, ind,
  d1n4001, zener, dbreak, diode,
  qnpn, qpnp, mbreakN, mbreakP,
  ctrlSrc('E', 'Voltage-controlled voltage source (VCVS)', 'V/V'),
  ctrlSrc('F', 'Current-controlled current source (CCCS)', 'A/A'),
  ctrlSrc('G', 'Voltage-controlled current source (VCCS)', 'A/V'),
  ctrlSrc('H', 'Current-controlled voltage source (CCVS)', 'V/A'),
  swTime(true), swTime(false), paramBlock, bubble,
  agnd, gndEarth,
];

export const PART_MAP: Record<string, PartDef> = Object.fromEntries(LIBRARY.map(d => [d.name, d]));
export const CATEGORIES = ['Sources', 'Passive', 'Diodes', 'BJT', 'MOSFET', 'Switches', 'Other'];
export const findDef = (name: string): PartDef | undefined => {
  const n = name.trim().toLowerCase();
  return PART_MAP[name] ?? LIBRARY.find(d => d.name.toLowerCase() === n) ?? LIBRARY.find(d => d.aliases?.some(a => a.toLowerCase() === n));
};
/** Part Browser search: name, aliases and description. */
export const matchesPart = (d: PartDef, q: string) =>
  [d.name, d.description, d.category, ...(d.aliases ?? [])].join(' ').toLowerCase().includes(q.trim().toLowerCase());
export const getDef = (type: string): PartDef => {
  const d = PART_MAP[type];
  if (!d) throw new Error(`Unknown part type ${type}`);
  return d;
};

/** Transform local symbol point to world coordinates (rotation CCW on screen, mirror about local Y axis first). */
export function xf(p: Part, lx: number, ly: number): Pt {
  let x = p.mirror ? -lx : lx, y = ly;
  for (let i = 0; i < p.rot; i++) { const t = x; x = y; y = -t; }
  return { x: p.x + x, y: p.y + y };
}

export function pinPositions(p: Part): { name: string; x: number; y: number }[] {
  return getDef(p.type).pins.map(pin => ({ name: pin.name, ...xf(p, pin.x, pin.y) }));
}

export function svgTransform(p: Part): string {
  return `translate(${p.x} ${p.y}) rotate(${-90 * p.rot}) scale(${p.mirror ? -1 : 1} 1)`;
}

export function defaultProps(def: PartDef): Record<string, string> {
  return Object.fromEntries(def.props.map(pr => [pr.name, pr.default]));
}
