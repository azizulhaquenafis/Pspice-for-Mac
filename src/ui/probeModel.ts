// Maps schematic markers / user selections to plotted traces. Every trace is a Probe expression
// (sim/expr.ts) evaluated on simulation vectors; sign conventions are explicit in the expressions.
import { SchematicDoc } from '../core/model';
import { Plot, getVector } from '../sim/types';
import { extractConnectivity } from '../core/connectivity';
import { currentVector, spiceNameFor } from '../core/netlist';
import { Device, deviceCurrentVec, evaluateExpr } from '../sim/expr';

export const TRACE_COLORS = ['#00a000', '#e00000', '#0000e0', '#c0a000', '#c000c0', '#00a0a0', '#808080', '#ff8000'];
export const traceColor = (i: number) => TRACE_COLORS[i % TRACE_COLORS.length];

export type AcMode = 'mag' | 'db' | 'phase';
export interface Trace { label: string; expr: string; y: Float64Array; color: string; fromMarker: boolean }

/** Expressions for the schematic's markers (null where the marker no longer resolves). */
export function markerExprs(doc: SchematicDoc): (string | null)[] {
  const conn = extractConnectivity(doc);
  const net = (x: number, y: number) => conn.netAt({ x, y });
  return doc.markers.map(m => {
    if (m.kind === 'V') { const n = net(m.x, m.y); return n ? `V(${n.name})` : null; }
    if (m.kind === 'VD') {
      const a = net(m.x, m.y), b = net(m.x2!, m.y2!);
      return a && b ? `V(${a.name},${b.name})` : null;
    }
    const p = doc.parts.find(p => p.id === m.partId);
    if (!p) return null;
    if (m.kind === 'W') return `W(${p.ref})`;
    if (!m.pin) return null;
    const cv = currentVector(p, m.pin, spiceNameFor(p));
    return cv ? `${cv.sign < 0 ? '-' : ''}I(${p.ref})` : null;
  });
}

export interface TraceGroup { title: string; items: string[] }

/** Everything that can be added from the Add Trace list, grouped like PSpice's dialog. */
export function availableTraces(plot: Plot, devices: Map<string, Device>): TraceGroup[] {
  const volts: string[] = [], currents: string[] = [], across: string[] = [], power: string[] = [];
  for (const v of plot.vectors.slice(1)) {
    const m = /^v\((.*)\)$/i.exec(v.name);
    if (m && !m[1].includes('__')) volts.push(`V(${m[1].toUpperCase()})`);
  }
  for (const d of devices.values()) {
    const cv = deviceCurrentVec(d.name);
    const hasI = !!(cv && getVector(plot, cv));
    if (hasI) currents.push(`I(${d.name})`);
    const src = /^[vi]/i.test(d.name);
    across.push(src ? `V(${d.name}:+,${d.name}:-)` : `V(${d.name}:1,${d.name}:2)`);
    if (hasI) power.push(`W(${d.name})`);
  }
  const sort = (a: string[]) => [...new Set(a)].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  return [
    { title: 'Node voltages', items: sort(volts) },
    { title: 'Currents (into pin 1 / +)', items: sort(currents) },
    { title: 'Voltage across parts (pin 1 − pin 2)', items: sort(across) },
    { title: 'Power absorbed W = V·I', items: sort(power) },
  ];
}

/** Evaluate for display. Complex AC results are shown per the AC mode unless the expression already is real (DB/P/M/R/IMG). */
export function evalForDisplay(plot: Plot, expr: string, devices: Map<string, Device>, mode: AcMode): { y: Float64Array; label: string } {
  const v = evaluateExpr(expr, plot, devices);
  if (!v.im) return { y: v.re, label: expr };
  const y = new Float64Array(v.re.length);
  for (let i = 0; i < y.length; i++) {
    const re = v.re[i], im = v.im[i];
    y[i] = mode === 'mag' ? Math.hypot(re, im) : mode === 'db' ? 20 * Math.log10(Math.hypot(re, im)) : (Math.atan2(im, re) * 180) / Math.PI;
  }
  return { y, label: mode === 'db' ? `DB(${expr})` : mode === 'phase' ? `P(${expr})` : `M(${expr})` };
}

export function xAxis(plot: Plot): { x: Float64Array; label: string; log: boolean } {
  const v = plot.vectors[0];
  const label = plot.kind === 'tran' ? 'Time (s)' : plot.kind === 'ac' ? 'Frequency (Hz)' : plot.kind === 'dc' ? `${v.name.replace(/^v\((.*)-sweep\)$/i, '$1').toUpperCase()} sweep` : v.name;
  const x = v.re;
  return { x, label, log: plot.kind === 'ac' && x.length > 2 && x[0] > 0 && Math.abs((x[2] / x[1]) - (x[1] / x[0])) < 1e-6 * (x[1] / x[0]) && x[1] / x[0] > 1.0001 };
}

export function toCSV(x: Float64Array, xLabel: string, traces: { label: string; y: Float64Array }[]): string {
  const q = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [[xLabel, ...traces.map(t => t.label)].map(q).join(',')];
  for (let i = 0; i < x.length; i++) rows.push([x[i], ...traces.map(t => t.y[i])].map(v => v.toPrecision(10)).join(','));
  return rows.join('\n') + '\n';
}
