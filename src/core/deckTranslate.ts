// Prepares a hand-written (PSpice-style) .cir deck for ngspice. Every change is reported as a note;
// unsupported statements are reported as errors instead of being silently dropped.
import { parseSpiceNumber, spiceNum } from './units';
import { planTran } from './tranPlan';
import { sweepValues } from './sweep';

export interface StepSpec { kind: 'param' | 'temp'; name: string; values: number[] }
export interface Translated {
  text: string; notes: string[]; errors: string[]; step?: StepSpec; measures: string[];
  /** Signals listed on .PROBE lines (used as the initial Probe traces). */
  probes: string[];
}

const IGNORED = /^\.(print|plot|width|watch|alias|aliases|endaliases)\b/i;
const UNSUPPORTED = /^\.(four|sens|noise|mc|wcase|tf|pz|disto|control|endc|exec|shell|distribution|loadbias|savebias|stimlib|vector|extern)\b/i;
const LIB = /^\.(lib|inc|include)\b/i;

export function translateDeck(input: string): Translated {
  const notes: string[] = [], errors: string[] = [];
  let lines = input.replace(/\r\n?/g, '\n').split('\n');
  // SPICE ignores everything after the first .END
  const endIdx = lines.findIndex((l, i) => i > 0 && /^\s*\.end\s*$/i.test(l));
  if (endIdx >= 0 && lines.slice(endIdx + 1).some(l => l.trim() && !l.trim().startsWith('*'))) {
    notes.push(`Text after .END on line ${endIdx + 1} is ignored (SPICE rule).`);
  }
  if (endIdx >= 0) lines = lines.slice(0, endIdx + 1);
  if (!lines[0]?.trim()) notes.push('Line 1 is the title line (SPICE rule) and is empty.');
  else if (/^[rclvidefghqmjksxb]\w*\s+\w+\s+\w+\s+[-+.\d{]/i.test(lines[0].trim()))
    notes.push(`Line 1 "${lines[0].trim()}" is treated as the TITLE, not a device (SPICE rule).`);
  let analyses = 0;
  let step: StepSpec | undefined;
  const measures: string[] = [], probes: string[] = [];
  let tran: { idx: number; n: number; vals: number[]; uic: boolean } | undefined;
  const out = lines.map((raw, i) => {
    if (i === 0) return raw;
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith('*') || line.startsWith(';')) return raw;
    if (/^\.probe\b/i.test(line)) {
      const sigs = line.replace(/^\.probe\S*\s*/i, '').match(/-?[A-Za-z]+\([^)]*\)/g) ?? [];
      probes.push(...sigs);
      notes.push(sigs.length ? `Line ${n}: .PROBE ${sigs.join(' ')} — shown in Probe` : `Line ${n}: .PROBE — all signals are available in Probe (Add Trace)`);
      return `* (probe) ${raw}`;
    }
    const sw = /^(x\S*)\s+(\S+)\s+(\S+)\s+(sw_topen|sw_tclose)\b(.*)$/i.exec(line);
    if (sw) { const r = expandTimedSwitch(sw, n); if (typeof r === 'string') { errors.push(r); return raw; } notes.push(r.note); return r.text; }
    if (IGNORED.test(line)) { notes.push(`Line ${n}: "${line.split(/\s/)[0]}" ignored — use Add Trace / markers in Probe.`); return `* (ignored) ${raw}`; }
    if (LIB.test(line)) { errors.push(`Line ${n}: ${line.split(/\s/)[0]} files are not supported yet — paste the .model/.subckt text into the netlist instead.`); return raw; }
    if (UNSUPPORTED.test(line)) { errors.push(`Line ${n}: "${line.split(/\s/)[0]}" is not supported yet.`); return raw; }
    if (/^\.step\b/i.test(line)) {
      // PSpice .STEP is run as independent ngspice runs (see sim/netlistSim.ts)
      if (step) { errors.push(`Line ${n}: only one .STEP is supported`); return `* ${raw}`; }
      const r = parseStep(line);
      if (typeof r === 'string') errors.push(`Line ${n}: ${r}`); else { step = r; notes.push(`Line ${n}: .STEP runs ${r.values.length} separate simulations (${r.kind === 'temp' ? 'TEMP' : r.name})`); }
      return `* (stepped) ${raw}`;
    }
    const mm = /^\.meas(?:ure)?\s+\w+\s+(\w+)/i.exec(line);
    if (mm) measures.push(mm[1].toLowerCase());
    if (/^\.save\b/i.test(line)) notes.push(`Line ${n}: .SAVE limits the signals available in Probe to those listed`);
    if (/^\.(op|dc|ac)\b/i.test(line)) analyses++;
    const m = /^\.tran\b(.*)$/i.exec(line);
    if (m) {
      analyses++;
      const toks = m[1].trim().split(/\s+/).filter(Boolean);
      const uic = toks.some(t => t.toLowerCase() === 'uic');
      const nums = toks.filter(t => t.toLowerCase() !== 'uic');
      const vals = nums.map(t => parseSpiceNumber(t));
      if (nums.length < 2 || nums.length > 4 || vals.some(v => !v.ok)) {
        errors.push(`Line ${n}: .TRAN needs <print step> <final time> [no-print delay] [step ceiling] [UIC]` + (vals.find(v => !v.ok)?.error ? ` — ${vals.find(v => !v.ok)!.error}` : ''));
        return raw;
      }
      tran = { idx: i, n, vals: vals.map(v => v.value), uic };
      return raw; // rewritten below, once the number of .STEP runs is known
    }
    return raw;
  });
  if (tran) {
    const [ps, tf, t0 = 0, tmax] = tran.vals;
    const plan = planTran(ps, tf, t0, tmax, step?.values.length ?? 1);
    if (plan.error) errors.push(`Line ${tran.n}: ${plan.error}`);
    else {
      plan.notes.forEach(x => notes.push(`Line ${tran!.n}: ${x}`));
      out[tran.idx] = `.tran ${spiceNum(ps)} ${spiceNum(tf)} ${spiceNum(t0)} ${spiceNum(plan.tmax)}${tran.uic ? ' UIC' : ''}`;
      if (plan.interp) out.splice(1, 0, '.option interp');
    }
  }
  if (!analyses) errors.push('No analysis statement (.OP, .TRAN, .DC or .AC) found.');
  if (!out.some(l => /^\s*\.end\s*$/i.test(l))) { out.push('.end'); notes.push('Added missing .END'); }
  return { text: out.join('\n') + '\n', notes, errors, step, measures, probes };
}

/** .STEP [LIN|OCT|DEC] PARAM name start stop incr|points  /  .STEP PARAM name LIST v...  /  .STEP TEMP ... */
export function parseStep(line: string): StepSpec | string {
  const t = line.trim().split(/\s+/).slice(1);
  let sweep: 'lin' | 'oct' | 'dec' | 'list' = 'lin';
  if (/^(lin|oct|dec)$/i.test(t[0] ?? '')) sweep = t.shift()!.toLowerCase() as 'lin' | 'oct' | 'dec';
  let kind: 'param' | 'temp', name = '';
  if (/^param$/i.test(t[0] ?? '')) { kind = 'param'; t.shift(); name = t.shift() ?? ''; if (!/^[a-z_]\w*$/i.test(name)) return '.STEP PARAM needs a parameter name'; }
  else if (/^temp$/i.test(t[0] ?? '')) { kind = 'temp'; t.shift(); }
  else return `.STEP ${t[0] ?? ''}: only PARAM and TEMP sweeps are supported in netlists (use a .param for source values)`;
  if (/^list$/i.test(t[0] ?? '')) { sweep = 'list'; t.shift(); }
  const ps = { enabled: true, varType: 'global' as const, name, sweep, start: t[0] ?? '', end: t[1] ?? '', incr: t[2] ?? '', values: t.join(' ') };
  const r = sweepValues(ps);
  return r.error ? `.STEP: ${r.error}` : { kind, name, values: r.values };
}

/**
 * PSpice library parts Sw_tOpen / Sw_tClose used as subcircuits:
 *   Xname n1 n2 Sw_tOpen PARAMS: tOpen=2ms ttran=1u Rclosed=0.01 Ropen=1Meg
 * ngspice has no such library, so the instance is expanded into the same voltage-controlled switch +
 * PWL control source used for schematic switches. Defaults follow PSpice (ttran 1u, Rclosed 0.01, Ropen 1Meg).
 */
function expandTimedSwitch(m: RegExpExecArray, n: number): { text: string; note: string } | string {
  const [, xname, n1, n2, kind, rest] = m;
  const closing = kind.toLowerCase() === 'sw_tclose';
  const p: Record<string, string> = { ttran: '1u', rclosed: '0.01', ropen: '1Meg', topen: '0', tclose: '0' };
  for (const kv of rest.replace(/params:/i, ' ').matchAll(/(\w+)\s*=\s*(\{[^}]*\}|\S+)/g)) {
    const k = kv[1].toLowerCase();
    if (!(k in p)) return `Line ${n}: unknown ${kind} parameter "${kv[1]}" (use ${closing ? 'tClose' : 'tOpen'}, ttran, Rclosed, Ropen)`;
    p[k] = kv[2];
  }
  const num = (k: string) => parseSpiceNumber(p[k]);
  const tKey = closing ? 'tclose' : 'topen';
  const name = `S_${xname}`, ctl = `__sw_${xname}`;
  const [a, b] = closing ? [0, 1] : [1, 0];
  const t = num(tKey), tt = num('ttran');
  let pwl: string;
  if (t.ok && tt.ok) {
    const f = (x: number) => spiceNum(+x.toPrecision(12));
    pwl = t.value > 0 ? `0 ${a} ${f(t.value)} ${a} ${f(t.value + Math.max(tt.value, 1e-12))} ${b}` : `0 ${a} ${f(Math.max(tt.value, 1e-12))} ${b}`;
  } else {
    const e = (k: string) => (/^\{.*\}$/.test(p[k]) ? p[k].slice(1, -1) : p[k]);
    pwl = `0 ${a} {${e(tKey)}} ${a} {(${e(tKey)})+(${e('ttran')})} ${b}`;
  }
  for (const k of ['rclosed', 'ropen']) if (!/^\{.*\}$/.test(p[k]) && !num(k).ok) return `Line ${n}: ${kind} ${k} "${p[k]}" is not a number`;
  return {
    text: [`${name} ${n1} ${n2} ${ctl} 0 SW_${xname}`, `V${ctl} ${ctl} 0 PWL(${pwl})`, `.model SW_${xname} SW(Ron=${p.rclosed} Roff=${p.ropen} Vt=0.5 Vh=0)`].join('\n'),
    note: `Line ${n}: ${xname} (${kind}, ${closing ? 'closes' : 'opens'} at ${p[tKey]}) expanded to an ngspice timed switch; its current is I(${xname})`,
  };
}
