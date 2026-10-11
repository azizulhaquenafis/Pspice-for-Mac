// Semiconductor parts: diodes, BJTs, MOSFETs. Symbols are original drawings in the classic PSpice
// Schematics style (grid = 10, pins on grid points). Every part carries its own editable .model card:
// props flagged `model` become `.model <MODEL> <TYPE>(...)` parameters (empty = ngspice default),
// EXTRA takes any further `NAME=value` parameters, and "Import .model" in the Properties dialog fills
// them from a pasted card. Instance parameters (MOSFET W, L, AD, AS, PD, PS) go on the device line.
//
// Default models (all original, educational — see docs/MODELS.md for provenance and derivations):
//  * Dbreak   ngspice default diode parameters (IS=1e-14, N=1), like PSpice's breakout diode.
//  * D1N4001  OpenSpice fit to public 1N4001 datasheet ratings (VF ≈ 0.96 V at 1 A, max 1.1 V;
//             ≈ 0.70 V at 10 mA; CJ ≈ 15 pF at 4 V; BV above the 50 V rating). Not a vendor model.
//  * DZ5V1    educational 5.1 V Zener: BV=5.1 V at IBV=5 mA, RS=2 Ω.
//  * QNPN / QPNP  educational Gummel-Poon subsets (IS=1e-14, BF=100, VAF=100 V ...).
//  * MbreakN / MbreakP  LEVEL=1 (Shichman-Hodges): VTO=±1 V, KP=200u/100u, LAMBDA=0.02.
import type { PartDef, PropDef } from './library';

const mp = (name: string, def: string, unit: string, help: string): PropDef =>
  ({ name, default: def, kind: 'num', unit, optional: true, model: true, help });
const MODEL = (def: string): PropDef => ({ name: 'MODEL', default: def, kind: 'model', help: 'Model name (.model card below)' });
const EXTRA: PropDef = { name: 'EXTRA', default: '', kind: 'raw', optional: true, model: true, help: 'Other .model parameters, e.g. IKF=0.3 RB=10' };

// ---------------------------------------------------------------- diodes
const diodeBody = { pins: [{ name: 'A', x: 0, y: 0 }, { name: 'K', x: 40, y: 0 }], fills: ['M14 -8 L14 8 L26 0 Z'] };
const diodeText = { refPos: { x: 20, y: -12, align: 'middle' as const }, valPos: { x: 20, y: 20, align: 'middle' as const } };
const diodeModel = (d: Record<string, string>): PropDef[] => [
  MODEL(d.MODEL),
  mp('IS', d.IS ?? '', 'A', 'Saturation current'),
  mp('N', d.N ?? '', '', 'Emission coefficient'),
  mp('RS', d.RS ?? '', 'Ω', 'Series resistance'),
  mp('CJO', d.CJO ?? '', 'F', 'Zero-bias junction capacitance'),
  mp('VJ', d.VJ ?? '', 'V', 'Junction potential'),
  mp('M', d.M ?? '', '', 'Grading coefficient'),
  mp('TT', d.TT ?? '', 's', 'Transit time'),
  mp('BV', d.BV ?? '', 'V', 'Reverse breakdown voltage (magnitude)'),
  mp('IBV', d.IBV ?? '', 'A', 'Current at breakdown voltage'),
  EXTRA,
];
const diodeLine = (n: string, N: string[], v: Record<string, string>) => `${n} ${N[0]} ${N[1]} ${v.MODEL}`;

export const dbreak: PartDef = {
  name: 'Dbreak', aliases: ['D', 'diode', 'generic diode'], description: 'Generic diode (ngspice default model parameters, editable)',
  category: 'Diodes', refPrefix: 'D', spiceLetter: 'D', modelType: 'D', ...diodeBody, ...diodeText,
  paths: ['M0 0 H14 M26 0 H40 M26 -8 V8'],
  props: diodeModel({ MODEL: 'Dbreak', IS: '1e-14', N: '1' }), valueProp: 'MODEL',
  netline: diodeLine,
};

export const d1n4001: PartDef = {
  name: 'D1N4001', aliases: ['1N4001', 'rectifier'], description: '1N4001 rectifier diode (50 V, 1 A) — OpenSpice datasheet fit, editable',
  category: 'Diodes', refPrefix: 'D', spiceLetter: 'D', modelType: 'D', ...diodeBody, ...diodeText,
  paths: ['M0 0 H14 M26 0 H40 M26 -8 V8'],
  props: diodeModel({ MODEL: 'D1N4001', IS: '2.93n', N: '1.8', RS: '0.042', CJO: '36p', VJ: '0.5', M: '0.4', TT: '3u', BV: '60', IBV: '5u' }),
  valueProp: 'MODEL', netline: diodeLine,
};

export const zener: PartDef = {
  name: 'ZENER', aliases: ['DZ5V1', 'zener diode', 'Dbreak zener'], description: 'Zener diode (educational 5.1 V model DZ5V1, editable)',
  category: 'Diodes', refPrefix: 'D', spiceLetter: 'D', modelType: 'D', ...diodeBody, ...diodeText,
  // cathode bar with bent ends (Z shape) — distinct from a rectifier diode
  paths: ['M0 0 H14 M26 0 H40 M21 -11 L26 -8 V8 L31 11'],
  props: diodeModel({ MODEL: 'DZ5V1', IS: '1e-14', N: '1', RS: '2', CJO: '100p', VJ: '0.75', M: '0.33', TT: '50n', BV: '5.1', IBV: '5m' }),
  valueProp: 'MODEL', netline: diodeLine,
};

// ---------------------------------------------------------------- BJTs
// Pins in SPICE order C, B, E: collector (0,0) top, base (-20,20) left, emitter (0,40) bottom.
const bjtPaths = ['M-20 20 H-6', 'M-6 10 V30', 'M-6 15 L0 9 V0', 'M-6 25 L0 31 V40'];
const bjtModel = (type: 'NPN' | 'PNP'): PropDef[] => [
  MODEL(type === 'NPN' ? 'QNPN' : 'QPNP'),
  mp('IS', '1e-14', 'A', 'Transport saturation current'),
  mp('BF', '100', '', 'Ideal max. forward beta'),
  mp('BR', '1', '', 'Ideal max. reverse beta'),
  mp('VAF', '100', 'V', 'Forward Early voltage'),
  mp('CJE', '8p', 'F', 'B-E zero-bias capacitance'),
  mp('CJC', '3p', 'F', 'B-C zero-bias capacitance'),
  mp('TF', '0.4n', 's', 'Forward transit time'),
  mp('TR', '50n', 's', 'Reverse transit time'),
  EXTRA,
];
const bjt = (type: 'NPN' | 'PNP'): PartDef => ({
  name: type === 'NPN' ? 'QNPN' : 'QPNP', aliases: [type, `${type} transistor`, 'BJT', type === 'NPN' ? 'QbreakN' : 'QbreakP'],
  description: `${type} bipolar transistor (educational model ${type === 'NPN' ? 'QNPN' : 'QPNP'}, editable)`,
  category: 'BJT', refPrefix: 'Q', spiceLetter: 'Q', modelType: type,
  pins: [{ name: 'C', x: 0, y: 0 }, { name: 'B', x: -20, y: 20 }, { name: 'E', x: 0, y: 40 }],
  paths: bjtPaths,
  // NPN: emitter arrow points out of the device; PNP: into the base
  fills: [type === 'NPN' ? 'M-0.8 30.2 L-2.35 25.39 L-5.61 28.65 Z' : 'M-5.2 25.8 L-0.39 27.35 L-3.65 30.61 Z'],
  body: [-20, 0, 0, 40],
  refPos: { x: 5, y: 18, align: 'start' }, valPos: { x: 5, y: 28, align: 'start' },
  props: bjtModel(type), valueProp: 'MODEL',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]} ${N[2]} ${v.MODEL}`,
});
export const qnpn = bjt('NPN');
export const qpnp = bjt('PNP');

// ---------------------------------------------------------------- MOSFETs
// Pins in SPICE order D, G, S, B: drain (0,0) top, gate (-20,20) left, source (0,40) bottom, bulk (20,20) right.
// Enhancement channel drawn as three segments; the arrow on the bulk lead points in (N) or out (P).
const mosPaths = ['M-20 20 H-9', 'M-9 10 V30', 'M-5 8 V15 M-5 17 V23 M-5 25 V32', 'M-5 11 H0 V0', 'M-5 29 H0 V40', 'M-5 20 H20'];
const mosProps = (type: 'NMOS' | 'PMOS'): PropDef[] => [
  { name: 'W', default: '10u', kind: 'num', unit: 'm', help: 'Channel width' },
  { name: 'L', default: '1u', kind: 'num', unit: 'm', help: 'Channel length' },
  { name: 'AD', default: '', kind: 'num', unit: 'm²', optional: true, help: 'Drain diffusion area' },
  { name: 'AS', default: '', kind: 'num', unit: 'm²', optional: true, help: 'Source diffusion area' },
  { name: 'PD', default: '', kind: 'num', unit: 'm', optional: true, help: 'Drain perimeter' },
  { name: 'PS', default: '', kind: 'num', unit: 'm', optional: true, help: 'Source perimeter' },
  MODEL(type === 'NMOS' ? 'MbreakN' : 'MbreakP'),
  mp('LEVEL', '1', '', 'Model level (1 = Shichman-Hodges)'),
  mp('VTO', type === 'NMOS' ? '1' : '-1', 'V', 'Zero-bias threshold voltage'),
  mp('KP', type === 'NMOS' ? '200u' : '100u', 'A/V²', 'Transconductance parameter'),
  mp('LAMBDA', '0.02', '1/V', 'Channel-length modulation'),
  mp('GAMMA', '0', '√V', 'Body-effect parameter'),
  mp('PHI', '0.6', 'V', 'Surface potential'),
  EXTRA,
];
const mos = (type: 'NMOS' | 'PMOS'): PartDef => ({
  name: type === 'NMOS' ? 'MbreakN' : 'MbreakP', aliases: [type, `${type} transistor`, 'MOSFET', type === 'NMOS' ? 'MbreakN4' : 'MbreakP4'],
  description: `${type === 'NMOS' ? 'N' : 'P'}-channel MOSFET, 4 terminals D G S B (LEVEL=1 model, editable)`,
  category: 'MOSFET', refPrefix: 'M', spiceLetter: 'M', modelType: type,
  pins: [{ name: 'D', x: 0, y: 0 }, { name: 'G', x: -20, y: 20 }, { name: 'S', x: 0, y: 40 }, { name: 'B', x: 20, y: 20 }],
  paths: mosPaths,
  fills: [type === 'NMOS' ? 'M-4 20 L2 17.5 L2 22.5 Z' : 'M4 20 L-2 17.5 L-2 22.5 Z'],
  body: [-20, 0, 20, 40],
  refPos: { x: 5, y: 7, align: 'start' }, valPos: { x: 5, y: 38, align: 'start' },
  props: mosProps(type), valueProp: 'MODEL',
  netline: (n, N, v) => `${n} ${N[0]} ${N[1]} ${N[2]} ${N[3]} ${v.MODEL} W=${v.W} L=${v.L}` +
    ['AD', 'AS', 'PD', 'PS'].filter(k => v[k]).map(k => ` ${k}=${v[k]}`).join(''),
});
export const mbreakN = mos('NMOS');
export const mbreakP = mos('PMOS');
