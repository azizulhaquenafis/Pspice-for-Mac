// Visual schematic document model (versioned). Electrical connectivity is
// derived from this by core/connectivity.ts; never stored here.

export interface Pt { x: number; y: number }
export type Rot = 0 | 1 | 2 | 3; // multiples of 90° counter-clockwise (screen: y down)

export interface Part {
  id: string;
  type: string;            // library part name, e.g. "R", "VDC"
  ref: string;             // reference designator, e.g. "R1"
  x: number; y: number;    // origin in world units (grid = 10)
  rot: Rot;
  mirror: boolean;
  props: Record<string, string>;
  refOff?: Pt;             // manual offset of the reference text (dragged by the user)
  valOff?: Pt;             // manual offset of the value text
}

/** Axis-aligned wire segment. */
export interface Wire { id: string; a: Pt; b: Pt }
/** Explicit junction: connects every wire passing through the point. */
export interface Junction { id: string; x: number; y: number }
/** Net alias (connects to wire/pin at its point) or free text annotation. */
export interface Label { id: string; x: number; y: number; text: string; kind: 'alias' | 'text'; off?: Pt }
/** Probe marker. V: net at point. I: current into part pin. VD: V(point1) - V(point2). W: power of a part. */
export interface Marker { id: string; kind: 'V' | 'I' | 'VD' | 'W'; x: number; y: number; x2?: number; y2?: number; partId?: string; pin?: string }

export interface TranSetup { enabled: boolean; printStep: string; finalTime: string; noPrint: string; stepCeiling: string; uic: boolean }
export interface DcSetup { enabled: boolean; source: string; start: string; end: string; incr: string }
export interface AcSetup { enabled: boolean; sweep: 'lin' | 'oct' | 'dec'; points: string; start: string; end: string }
/** PSpice "Parametric": repeat the enabled analyses for each value of a global parameter, source value or temperature. */
export interface ParamSetup {
  enabled: boolean;
  varType: 'global' | 'source' | 'temp';
  name: string;                                  // parameter name or source reference
  sweep: 'lin' | 'oct' | 'dec' | 'list';
  start: string; end: string; incr: string;       // incr = points per decade/octave for log sweeps
  values: string;                                 // value list
}
export interface SimProfile { name: string; op: boolean; tran: TranSetup; dc: DcSetup; ac: AcSetup; param: ParamSetup }

export interface SchematicDoc {
  format: 'openspice-schematic';
  version: 1;
  title: string;
  parts: Part[];
  wires: Wire[];
  junctions: Junction[];
  labels: Label[];
  markers: Marker[];
  profile: SimProfile;
  view: { x: number; y: number; zoom: number };
  /** Manual offsets of bias-point annotations, keyed "v:<net>" or "i:<partId>". */
  biasOff?: Record<string, Pt>;
  /** Extra Probe trace expressions saved with the schematic (besides markers). */
  probeTraces?: string[];
  /** Netlist-editor document saved with the project (text is never converted back into the schematic). */
  netlist?: { text: string; fileName: string | null; origin: 'independent' | 'generated' | 'edited' };
}

export const GRID = 10;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

let idCounter = 0;
export const newId = (p = 'o') => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function defaultProfile(): SimProfile {
  return {
    name: 'Schematic1',
    op: true,
    tran: { enabled: false, printStep: '20ns', finalTime: '1000ns', noPrint: '0', stepCeiling: '', uic: false },
    dc: { enabled: false, source: 'V1', start: '0', end: '10', incr: '1' },
    ac: { enabled: false, sweep: 'dec', points: '101', start: '10', end: '1Meg' },
    param: { enabled: false, varType: 'global', name: 'Rh', sweep: 'list', start: '1', end: '10', incr: '1', values: '1 10 100' },
  };
}

export function emptyDoc(): SchematicDoc {
  return {
    format: 'openspice-schematic', version: 1, title: 'Schematic1',
    parts: [], wires: [], junctions: [], labels: [], markers: [],
    profile: defaultProfile(), view: { x: -50, y: -50, zoom: 1.5 },
  };
}
