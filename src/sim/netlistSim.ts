// Runs a hand-written .cir deck. Applies the same PSpice IC= semantics as schematicSim.ts:
// if .TRAN has no UIC and top-level C/L lines carry IC=, the bias point is computed with those
// elements held (pass 1) and the transient starts from that state with UIC (pass 2).
import { translateDeck } from '../core/deckTranslate';
import { parseSpiceNumber, spiceNum, formatEng } from '../core/units';
import { ParamDef, resolveParams, evalExpr, isBraced, unbrace } from '../core/params';
import { SimulationEngine, SimResult, SimStep, getVector, Plot } from './types';
import { combineOpPlots } from './sweepPlot';
import { Translated } from '../core/deckTranslate';

export interface Measurement { name: string; value: number; step?: string }
export interface DeckRun { result: SimResult; deck: string; notes: string[]; measurements: Measurement[]; probes: string[] }

interface Reactive { idx: number; name: string; n1: string; n2: string; rest: string; ic: number | null }

type Once = { result: SimResult; deck: string; notes: string[] };

/** Run a translated deck once (with the PSpice-style IC passes when needed). */
async function runTranslated(text: string, engine: SimulationEngine, signal?: AbortSignal): Promise<Once> {
  const tr = { text, notes: [] as string[] };
  const fail = (errors: string[], deck = tr.text): Once => ({ result: { ok: false, plots: [], log: '', errors, elapsedMs: 0 }, deck, notes: tr.notes });
  const lines = tr.text.split('\n');
  const tranIdx = lines.findIndex(l => /^\s*\.tran\b/i.test(l));
  const uic = tranIdx >= 0 && /\buic\b/i.test(lines[tranIdx]);
  const reactive: Reactive[] = [];
  // top-level .param values, so IC={expr} resolves the same way ngspice will (per .STEP run, since each run's text differs)
  const paramDefs: ParamDef[] = [];
  let pdepth = 0;
  for (const l of lines.slice(1)) {
    if (/^\s*\.subckt\b/i.test(l)) pdepth++; else if (/^\s*\.ends\b/i.test(l)) pdepth--;
    const pm = pdepth === 0 && /^\s*\.param\s+(.*)$/i.exec(l);
    if (pm) for (const kv of pm[1].matchAll(/(\w+)\s*=\s*(\{[^}]*\}|'[^']*'|[^\s,]+)/g)) paramDefs.push({ name: kv[1], expr: kv[2].replace(/^'(.*)'$/, '{$1}') });
  }
  const ptab = resolveParams(paramDefs);
  const icErrors: string[] = [];
  let depth = 0;
  lines.forEach((l, idx) => {
    if (idx === 0) return;
    if (/^\s*\.subckt\b/i.test(l)) depth++;
    else if (/^\s*\.ends\b/i.test(l)) depth--;
    const m = depth === 0 && /^\s*([cl]\S*)\s+(\S+)\s+(\S+)\s+(.*)$/i.exec(l);
    if (!m) return;
    const icm = /\bic\s*=\s*(\{[^}]*\}|'[^']*'|\S+)/i.exec(m[4]);
    let ic: number | null = null;
    if (icm) {
      const raw = icm[1].replace(/^'(.*)'$/, '{$1}');
      try {
        ic = isBraced(raw)
          ? evalExpr(unbrace(raw), n => { const v = ptab.values.get(n.toLowerCase()); if (v === undefined) throw new Error(`undefined parameter "${n}"`); return v; })
          : (() => { const r = parseSpiceNumber(raw); if (!r.ok) throw new Error(r.error); return r.value; })();
      } catch (e) { icErrors.push(`${m[1]}: IC=${icm[1]} cannot be evaluated (${(e as Error).message})`); }
    }
    reactive.push({ idx, name: m[1], n1: m[2], n2: m[3], rest: m[4].replace(/\bic\s*=\s*(\{[^}]*\}|'[^']*'|\S+)/i, '').trim(), ic });
  });
  if (icErrors.length) return fail(icErrors);
  if (tranIdx < 0 || uic || !reactive.some(r => r.ic !== null)) {
    return { result: await engine.run(tr.text, signal), deck: tr.text, notes: [] };
  }

  const isAnalysis = (l: string) => /^\s*\.(op|tran|dc|ac)\b/i.test(l);
  const p1 = lines.map((l, idx) => {
    const r = reactive.find(r => r.idx === idx);
    if (r && r.ic !== null) {
      return /^c/i.test(r.name)
        ? `R__IC_${r.name} ${r.n1} __ic_${r.name} 0.001\nV__IC_${r.name} __ic_${r.name} ${r.n2} DC ${spiceNum(r.ic)}`
        : `I__IC_${r.name} ${r.n1} ${r.n2} DC ${spiceNum(r.ic)}`;
    }
    if (isAnalysis(l)) return `* (pass 1) ${l}`;
    if (/^\s*\.end\s*$/i.test(l)) return '.op\n.end';
    return l;
  });
  p1.splice(1, 0, '* Pass 1: bias point with IC= attributes held (PSpice semantics)');
  const p1Text = p1.join('\n');
  const r1 = await engine.run(p1Text, signal);
  const op = r1.plots.find(p => p.kind === 'op');
  if (!r1.ok || !op) return { result: { ...r1, ok: false, errors: ['Bias point with initial conditions failed', ...r1.errors] }, deck: p1Text, notes: [] };
  const volt = (n: string) => (n === '0' || n.toLowerCase() === 'gnd') ? 0 : getVector(op, `v(${n})`)?.re[0];

  let p2 = [...lines];
  for (const r of reactive) {
    let st = r.ic;
    if (st === null) st = /^c/i.test(r.name)
      ? (volt(r.n1) ?? NaN) - (volt(r.n2) ?? NaN)
      : getVector(op, `i(@${r.name.toLowerCase()}[i])`)?.re[0] ?? NaN;
    if (!isFinite(st)) return fail([`Could not determine initial state of ${r.name} from the bias point`], p1Text);
    p2[r.idx] = `${r.name} ${r.n1} ${r.n2} ${r.rest} IC=${spiceNum(st)}`;
  }
  p2[tranIdx] = `${lines[tranIdx]} UIC`;
  p2 = p2.filter(l => !/^\s*\.op\b/i.test(l));
  p2.splice(1, 0, '* Pass 2: transient from the IC-constrained bias point (UIC with computed IC= values)');
  const p2Text = p2.join('\n');
  const r2 = await engine.run(p2Text, signal);
  return {
    result: { ...r2, plots: [op, ...r2.plots.filter(p => p.kind !== 'op')], log: r1.log + '\n' + r2.log, elapsedMs: r1.elapsedMs + r2.elapsedMs },
    deck: `${p1Text}\n${p2Text}`,
    notes: ['IC= attributes applied PSpice-style (bias point with ICs held, then transient with UIC).'],
  };
}

export async function runDeck(text: string, engine: SimulationEngine, signal?: AbortSignal,
  onProgress?: (i: number, n: number, label: string) => void): Promise<DeckRun> {
  const tr = translateDeck(text);
  if (tr.errors.length) return { result: { ok: false, plots: [], log: '', errors: tr.errors, elapsedMs: 0 }, deck: tr.text, notes: tr.notes, measurements: [], probes: tr.probes };
  const measure = (log: string, step?: string): Measurement[] => tr.measures.flatMap(name => {
    const m = new RegExp(`^\\s*${name}\\s*=\\s*([-+]?[\\d.]+(?:e[-+]?\\d+)?)`, 'im').exec(log);
    return m ? [{ name, value: parseFloat(m[1]), step }] : [];
  });
  if (!tr.step) {
    const r = await runWithDcParam(tr.text, tr.dcParam, engine, signal);
    return { result: { ...r.result, errors: mapErrors(r.result.errors, text) }, deck: r.deck, notes: [...tr.notes, ...r.notes], measurements: measure(r.result.log), probes: tr.probes };
  }
  // .STEP: one independent ngspice run per value
  const st = tr.step;
  const steps: SimStep[] = [], measurements: Measurement[] = [];
  let log = '', deck = '', elapsed = 0;
  const notes = [...tr.notes];
  for (let i = 0; i < st.values.length; i++) {
    if (signal?.aborted) break;
    const v = st.values[i];
    const label = st.kind === 'temp' ? `TEMP = ${formatEng(v, 5)}` : `${st.name} = ${formatEng(v, 5)}`;
    onProgress?.(i + 1, st.values.length, label);
    const body = withValue(tr.text, st.kind, st.name, v).split('\n');
    const r = await runWithDcParam(body.join('\n'), tr.dcParam, engine, signal);
    if (i === 0) notes.push(...r.notes);
    const tempLine = /^\s*\.temp\s+(\S+)/im.exec(body.join('\n'));
    steps.push({ label, value: v, ok: r.result.ok, plots: r.result.plots, errors: mapErrors(r.result.errors, text),
      sweep: { kind: st.kind, name: st.kind === 'temp' ? 'TEMP' : st.name },
      temp: st.kind === 'temp' ? v : tempLine ? parseFloat(tempLine[1]) : 27, time: Date.now(), deck: r.deck });
    measurements.push(...measure(r.result.log, label));
    log += `\n===== Run ${i + 1}/${st.values.length}: ${label} =====\n${r.result.log}`;
    deck += `* ===== Run ${i + 1}/${st.values.length}: ${label} =====\n${r.deck}\n`;
    elapsed += r.result.elapsedMs;
  }
  const first = steps.find(s => s.ok);
  const errors = signal?.aborted ? ['Simulation cancelled'] : steps.filter(s => !s.ok).map(s => `${s.label}: ${s.errors[0] ?? 'failed'}`);
  // bias point of every .STEP run against the stepped value (e.g. W(RL) vs RL)
  const xl = st.kind === 'temp' ? 'TEMP' : st.name;
  const sweep = combineOpPlots(steps.filter(s => s.ok).map(s => ({ value: s.value, plot: s.plots.find(p => p.kind === 'op') })),
    `Bias point vs ${xl} (${steps.filter(s => s.ok).length} runs)`, xl, st.kind === 'temp' ? '°C' : '');
  return { result: { ok: !!first && !signal?.aborted, plots: first?.plots ?? [], log, errors, elapsedMs: elapsed, steps, sweepPlots: sweep ? [sweep] : undefined }, deck, notes, measurements, probes: tr.probes };
}

/** The deck with a .param (or .temp) set to one value: replaces its definition, keeps the others. */
function withValue(text: string, kind: 'param' | 'temp', name: string, v: number): string {
  const nameRe = new RegExp(`(^|\\s)${kind === 'temp' ? '' : name}\\s*=\\s*\\S+`, 'i');
  const body = text.split('\n').map((l, k) => {
    if (k === 0) return l;
    if (kind === 'temp' && /^\s*\.temp\b/i.test(l)) return `* (stepped) ${l}`;
    if (kind === 'param' && /^\s*\.param\b/i.test(l) && nameRe.test(l)) {
      const rest = l.replace(/^\s*\.param\s*/i, '').replace(nameRe, ' ').trim();
      return rest ? `.param ${rest}` : `* (stepped) ${l}`;
    }
    return l;
  });
  body.splice(1, 0, kind === 'temp' ? `.temp ${spiceNum(v)}` : `.param ${name}=${spiceNum(v)}`);
  return body.join('\n');
}

/** Run once; with .DC PARAM also one bias point per value, assembled into a DC plot (x = the parameter). */
async function runWithDcParam(text: string, dc: Translated['dcParam'], engine: SimulationEngine, signal?: AbortSignal): Promise<Once> {
  const main = await runTranslated(text, engine, signal);
  if (!dc || !main.result.ok) return main;
  const points: { value: number; plot: Plot | undefined }[] = [];
  let log = main.result.log, elapsed = main.result.elapsedMs;
  for (const v of dc.values) {
    if (signal?.aborted) return { ...main, result: { ...main.result, ok: false, errors: ['Simulation cancelled'] } };
    // bias point only: other analyses and their .MEAS statements are left to the main run
    const body = withValue(text, 'param', dc.name, v).split('\n')
      .map((l, k) => k > 0 && /^\s*\.(op|tran|ac|dc|meas\w*|four)\b/i.test(l) ? `* (DC sweep run) ${l}` : l);
    const e = body.findIndex((l, k) => k > 0 && /^\s*\.end\s*$/i.test(l));
    body.splice(e >= 0 ? e : body.length, 0, '.op');
    const r = await engine.run(body.join('\n'), signal);
    if (!r.ok) return { ...main, result: { ...main.result, ok: false, errors: [`.DC PARAM ${dc.name} = ${formatEng(v, 5)}: ${r.errors[0] ?? 'failed'}`] } };
    points.push({ value: v, plot: r.plots.find(p => p.kind === 'op') });
    log += `\n===== .DC PARAM ${dc.name} = ${formatEng(v, 5)} =====\n${r.log}`; elapsed += r.elapsedMs;
  }
  const plot = combineOpPlots(points, `DC Sweep of ${dc.name} (${dc.values.length} bias points)`, dc.name);
  return { ...main, result: { ...main.result, plots: plot ? [...main.result.plots, plot] : main.result.plots, log, elapsedMs: elapsed },
    deck: `${main.deck}* .DC PARAM ${dc.name}: ${dc.values.length} bias-point runs\n` };
}

/** Prefix ngspice errors with the editor line they refer to, when the offending line can be found. */
export function mapErrors(errors: string[], text: string): string[] {
  const lines = text.split('\n').map(l => l.trim().toLowerCase());
  return errors.map(e => {
    const m = /(?:line \d+[^:]*:|:)\s*(.+)$/i.exec(e);
    const snippet = m?.[1]?.trim().toLowerCase();
    if (snippet && snippet.length > 3) {
      const idx = lines.findIndex((l, i) => i > 0 && l && (l === snippet || l.startsWith(snippet) || snippet.startsWith(l.split(/\s+/).slice(0, 3).join(' '))));
      if (idx > 0 && !/^line \d+:/i.test(e)) return `Line ${idx + 1}: ${e}`;
    }
    return e;
  });
}
