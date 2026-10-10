// Circuit -> SPICE netlist (ngspice dialect), plus Electrical Rule Check.
// Node names come from the connectivity graph, never from coordinates.

import { SchematicDoc, Part } from './model';
import { getDef } from './library';
import { extractConnectivity, Connectivity } from './connectivity';
import { parseSpiceNumber, spiceNum } from './units';
import { ParamDef, resolveParams, evalExpr, exprToSpice, isBraced, unbrace } from './params';
import { PARAM_SLOTS } from './library';
import { planTran } from './tranPlan';
import { sweepValues } from './sweep';

export interface Diagnostic { level: 'error' | 'warning'; message: string; partId?: string }
export interface NetlistResult {
  text: string;
  ok: boolean;
  diagnostics: Diagnostic[];
  conn: Connectivity;
  spiceName: Map<string, string>; // partId -> device name
  /** Transient with IC= attributes and no UIC: needs the PSpice-style two-pass run (see sim/schematicSim.ts). */
  needsIcPass: boolean;
  /** Capacitors and inductors with their netlist nodes and parsed IC attribute. */
  reactive: { partId: string; name: string; kind: 'C' | 'L'; nodes: [string, string]; ic: number | null }[];
}

export interface NetlistOptions {
  /** Pass 1: bias point with C(IC) held by a voltage source (+1 mΩ) and L(IC) by a current source; .op only. */
  icPass?: boolean;
  /** Pass 2: explicit initial voltage/current for each C/L (by partId); .tran forced to UIC, no .op. */
  initialState?: Map<string, number>;
  /** Parametric sweep: global parameter values overriding the PARAMETERS block (lower-case names). */
  paramOverrides?: Map<string, number>;
  /** Parametric sweep over temperature (°C). */
  temp?: number;
}

/** Points ngspice would need for a transient; used to refuse runs that would hang the app. */
export { MAX_TRAN_POINTS } from './tranPlan';

export function spiceNameFor(p: Part): string {
  const L = getDef(p.type).spiceLetter;
  const clean = p.ref.replace(/[^A-Za-z0-9_]/g, '_');
  return clean.toUpperCase().startsWith(L) ? clean : `${L}_${clean}`;
}

function num(s: string, what: string, diags: Diagnostic[], partId?: string): string {
  const r = parseSpiceNumber(s);
  if (!r.ok) { diags.push({ level: 'error', message: `${what}: ${r.error}`, partId }); return '0'; }
  if (r.warning) diags.push({ level: 'warning', message: `${what}: ${r.warning}`, partId });
  return spiceNum(r.value);
}

export function generateNetlist(doc: SchematicDoc, opts: NetlistOptions = {}): NetlistResult {
  const diags: Diagnostic[] = [];
  const conn = extractConnectivity(doc);
  conn.warnings.forEach(w => diags.push({ level: 'warning', message: w }));
  const lines: string[] = [];
  const models = new Set<string>();
  const reactive: NetlistResult['reactive'] = [];
  const spiceName = new Map<string, string>();
  const seen = new Map<string, string>();
  const prof = doc.profile;

  // Global parameters from PARAMETERS blocks (+ sweep overrides)
  const paramDefs: ParamDef[] = [];
  for (const p of doc.parts) if (getDef(p.type).isParam) for (let i = 1; i <= PARAM_SLOTS; i++) {
    const n = (p.props[`NAME${i}`] ?? '').trim(), v = (p.props[`VALUE${i}`] ?? '').trim();
    if (n || v) {
      if (!n || !v) diags.push({ level: 'error', message: `PARAMETERS: NAME${i}/VALUE${i} must both be set`, partId: p.id });
      else paramDefs.push({ name: n, expr: v });
    }
  }
  const ptab = resolveParams(paramDefs, opts.paramOverrides);
  [...new Set(ptab.errors)].forEach(e => diags.push({ level: 'error', message: e }));
  const lookup = (n: string) => {
    const v = ptab.values.get(n.toLowerCase());
    if (v === undefined) throw new Error(`Undefined parameter "${n}" — add it to a PARAMETERS block`);
    return v;
  };

  const devices = doc.parts.filter(p => !getDef(p.type).isGround && !getDef(p.type).isParam && !getDef(p.type).isBubble);
  if (devices.length === 0) diags.push({ level: 'error', message: 'Schematic contains no parts to simulate' });
  if (!conn.nets.some(n => n.isGround && n.pins.length > 0))
    diags.push({ level: 'error', message: 'No ground: place an AGND symbol (SPICE node 0) connected to the circuit' });

  for (const p of devices) {
    const def = getDef(p.type);
    const name = spiceNameFor(p);
    if (seen.has(name.toUpperCase())) diags.push({ level: 'error', message: `Duplicate reference ${p.ref}`, partId: p.id });
    seen.set(name.toUpperCase(), p.id);
    spiceName.set(p.id, name);
    const nodes = def.pins.map(pin => {
      const n = conn.pinNet.get(`${p.id}:${pin.name}`)!;
      if (!n.isGround && n.pins.length < 2 && n.aliases.length === 0)
        diags.push({ level: 'error', message: `Floating pin ${p.ref}:${pin.name} is not connected`, partId: p.id });
      return n.name;
    });
    const vals: Record<string, string> = {};
    const nums: Record<string, number> = {};
    for (const pd of def.props) {
      const raw = (p.props[pd.name] ?? pd.default).trim();
      if (raw === '') {
        if (!pd.optional) diags.push({ level: 'error', message: `${p.ref}: ${pd.name} is required`, partId: p.id });
        vals[pd.name] = ''; continue;
      }
      if (pd.kind === 'num' && isBraced(raw)) {
        // {expression}: kept symbolic in the netlist (ngspice substitutes .param values); also evaluated here.
        try {
          nums[pd.name] = evalExpr(unbrace(raw), lookup);
          vals[pd.name] = `{${exprToSpice(unbrace(raw))}}`;
        } catch (e) { diags.push({ level: 'error', message: `${p.ref} ${pd.name}: ${(e as Error).message}`, partId: p.id }); vals[pd.name] = '0'; nums[pd.name] = 0; }
        continue;
      }
      if (pd.kind === 'num') { vals[pd.name] = num(raw, `${p.ref} ${pd.name}`, diags, p.id); nums[pd.name] = parseFloat(vals[pd.name]); }
      else {
        const toks = raw.split(/[\s,]+/).filter(Boolean);
        const bad = toks.find(t => !parseSpiceNumber(t).ok);
        if (bad || toks.length % 2) diags.push({ level: 'error', message: `${p.ref} ${pd.name}: expected numeric time/value pairs`, partId: p.id });
        vals[pd.name] = toks.map(t => spiceNum(parseSpiceNumber(t).value)).join(' ');
      }
    }
    def.models?.forEach(m => models.add(m));
    if (p.type === 'C' || p.type === 'L') {
      const ic = vals.IC ? nums.IC : null;
      reactive.push({ partId: p.id, name, kind: p.type, nodes: [nodes[0], nodes[1]], ic });
      const st = opts.initialState?.get(p.id);
      if (opts.icPass && ic !== null) {
        // PSpice semantics: IC= holds the element during the bias point calculation.
        if (p.type === 'C') lines.push(`R__IC_${name} ${nodes[0]} __ic_${name} 0.001`, `V__IC_${name} __ic_${name} ${nodes[1]} DC ${vals.IC}`);
        else lines.push(`I__IC_${name} ${nodes[0]} ${nodes[1]} DC ${vals.IC}`);
        continue;
      }
      if (st !== undefined) { lines.push(`${name} ${nodes[0]} ${nodes[1]} ${vals.VALUE} IC=${spiceNum(st)}`); continue; }
    }
    lines.push(def.netline!(name, nodes, vals, p, nums));
  }

  const needsIcPass = prof.tran.enabled && !prof.tran.uic && reactive.some(r => r.ic !== null);
  let interpOpt = false;
  const an: string[] = opts.initialState ? [] : ['.op'];
  if (prof.tran.enabled && !opts.icPass) {
    const t = prof.tran;
    const ps = num(t.printStep, 'Transient Print Step', diags), ft = num(t.finalTime, 'Transient Final Time', diags);
    const np = num(t.noPrint || '0', 'Transient No-Print Delay', diags);
    // Shared transient planning (core/tranPlan.ts): explicit TMAX (0/empty = automatic), workload limits
    // per run and across a parametric sweep, output interpolation to the Print Step when needed.
    const ceil = t.stepCeiling.trim();
    const tmaxIn = ceil ? parseFloat(num(ceil, 'Transient Step Ceiling', diags)) : undefined;
    const runs = prof.param.enabled ? Math.max(1, sweepValues(prof.param).values.length) : 1;
    const plan = planTran(parseFloat(ps), parseFloat(ft), parseFloat(np), tmaxIn, runs);
    if (plan.error) diags.push({ level: 'error', message: `Transient: ${plan.error}` });
    interpOpt = plan.interp;
    let cmd = `.tran ${ps} ${ft} ${np} ${spiceNum(plan.tmax || parseFloat(ft) / 200)}`;
    if (t.uic || opts.initialState) cmd += ' UIC';
    an.push(cmd);
  }
  if (prof.dc.enabled && !opts.icPass) {
    const d = prof.dc;
    const src = doc.parts.find(p => p.ref.toUpperCase() === d.source.trim().toUpperCase() && ['V', 'I'].includes(getDef(p.type).spiceLetter));
    if (!src) diags.push({ level: 'error', message: `DC Sweep: no independent source named "${d.source}"` });
    const inc = num(d.incr, 'DC Sweep Increment', diags);
    if (parseFloat(inc) === 0) diags.push({ level: 'error', message: 'DC Sweep Increment must be non-zero' });
    an.push(`.dc ${src ? spiceNameFor(src) : d.source} ${num(d.start, 'DC Sweep Start', diags)} ${num(d.end, 'DC Sweep End', diags)} ${inc}`);
  }
  if (prof.ac.enabled && !opts.icPass) {
    const a = prof.ac;
    const pts = parseSpiceNumber(a.points);
    if (!pts.ok || pts.value < 1 || !Number.isInteger(pts.value)) diags.push({ level: 'error', message: 'AC Sweep points must be a positive integer' });
    const fs = num(a.start, 'AC Start Freq', diags), fe = num(a.end, 'AC End Freq', diags);
    if (parseFloat(fs) <= 0) diags.push({ level: 'error', message: 'AC Start Freq must be > 0' });
    an.push(`.ac ${a.sweep} ${pts.value} ${fs} ${fe}`);
  }

  const text = [
    `* ${doc.title} — generated by OpenSpice Schematics`,
    ...(opts.icPass ? ['* Pass 1: bias point with IC= attributes held (PSpice semantics)'] : []),
    ...(opts.initialState ? ['* Pass 2: transient from the IC-constrained bias point (initial C voltages / L currents below)'] : []),
    ...(needsIcPass && !opts.icPass && !opts.initialState ? ['* Note: IC= attributes are applied PSpice-style (bias point with ICs held) when simulated'] : []),
    '.option savecurrents',
    ...(interpOpt ? ['.option interp'] : []),
    ...(opts.temp !== undefined ? [`.temp ${spiceNum(opts.temp)}`] : []),
    ...ptab.defs.flatMap(d => {
      const v = ptab.values.get(d.name.toLowerCase());
      if (v === undefined) return [];
      const ov = opts.paramOverrides?.has(d.name.toLowerCase());
      const plain = !isBraced(d.expr) && parseSpiceNumber(d.expr).ok;
      return [...(ov ? [`* ${d.name} swept (PARAMETERS value ${d.expr})`] : !plain ? [`* ${d.name} = ${d.expr}`] : []), `.param ${d.name}=${spiceNum(v)}`];
    }),
    ...lines,
    ...models,
    ...an,
    '.end',
  ].join('\n') + '\n';

  return { text, ok: !diags.some(d => d.level === 'error'), diagnostics: diags, conn, spiceName, needsIcPass, reactive };
}

/** Raw-file vector giving current INTO the given pin (and sign). Positive SPICE reference = into pin 1 / "+". */
export function currentVector(p: Part, pin: string, spiceName: string): { vec: string; sign: 1 | -1; label: string } | null {
  const def = getDef(p.type);
  const n = spiceName.toLowerCase();
  const first = def.pins[0].name;
  let vec: string;
  switch (def.spiceLetter) {
    case 'R': case 'C': case 'L': case 'G': case 'F': case 'S': vec = `i(@${n}[i])`; break;
    case 'V': case 'E': case 'H': vec = `i(${n})`; break;
    case 'I': vec = `i(@${n}[current])`; break;
    case 'D': vec = `i(@${n}[id])`; break;
    default: return null;
  }
  if ('EGFH'.includes(def.spiceLetter) && (pin === 'C+' || pin === 'C-')) {
    // E/G control pins draw no current; F/H control current flows through their 0 V sense source (C+ -> C-)
    if (def.spiceLetter === 'E' || def.spiceLetter === 'G') return null;
    const sign = pin === 'C+' ? 1 : -1;
    return { vec: `i(v__sense_${n})`, sign, label: `${sign < 0 ? '-' : ''}I(${p.ref}:C+)` };
  }
  const sign = pin === first ? 1 : -1;
  return { vec, sign, label: `${sign < 0 ? '-' : ''}I(${p.ref})` };
}
