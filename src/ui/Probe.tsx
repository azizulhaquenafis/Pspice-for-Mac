// Probe-style waveform viewer (canvas based). Every value plotted comes from simulation vectors.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { download } from '../state/actions';
import { formatEng, parseSpiceNumber } from '../core/units';
import { linearTicks, formatTicks, formatPrecise } from './axis';
import { AcMode, Trace, availableTraces, evalForDisplay, markerExprs, traceColor, xAxis } from './probeModel';
import { parseDeckDevices, evaluateExpr } from '../sim/expr';
import { Plot, SimStep } from '../sim/types';
import { SectionInfoDialog, TracePropDialog, MeasureDialog, ContextMenu, MenuItem, TraceStyle, SYMBOLS, drawSymbol } from './ProbeDialogs';
import { measure } from '../sim/measure';

interface Range { x0: number; x1: number; y0: number; y1: number }
function interp(xs: Float64Array, y: Float64Array, x: number) {
  let lo = 0, hi = xs.length - 1;
  if (x <= xs[0]) return y[0];
  if (x >= xs[hi]) return y[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m; else hi = m; }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1); return y[lo] + f * (y[hi] - y[lo]);
}
interface PTrace extends Trace { key: string; x: Float64Array; exprLabel: string; runIdx: number; runCount: number; stepObj?: SimStep; created: number }

export function Probe() {
  const result = useStore(s => s.sim.result);
  const doc = useStore(s => s.doc);
  const stale = useStore(s => s.sim.stale);
  const source = useStore(s => s.sim.source);
  const deck = useStore(s => s.sim.netlist);
  const cirTraces = useStore(s => s.cirTraces);
  const cirProbes = useStore(s => s.cirProbes);
  // Analysis sections (transient / DC / AC) — taken from the first run; parametric runs share the same sections.
  const basePlots = (result?.steps?.find(s => s.ok)?.plots ?? result?.plots ?? []).filter(p => p.kind !== 'op' && p.vectors[0].re.length > 1);
  const [plotIdx, setPlotIdx] = useState(0);
  const plot = basePlots[Math.min(plotIdx, basePlots.length - 1)];
  const runs = useMemo(() => {
    if (!plot) return [];
    if (result?.steps) return result.steps.filter(s => s.ok).map(s => ({ label: s.label, step: s as SimStep | undefined, plot: s.plots.find(p => p.title === plot.title) })).filter((r): r is { label: string; step: SimStep; plot: Plot } => !!r.plot);
    return [{ label: '', step: undefined as SimStep | undefined, plot }];
  }, [result, plot]);
  const [acMode, setAcMode] = useState<AcMode>('db');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [dark, setDark] = useState(true); // PSpice Probe default: black plot
  const [range, setRange] = useState<Range | null>(null);
  const [cursors, setCursors] = useState<{ a1: number | null; a2: number | null }>({ a1: null, a2: null });
  const [cursorOn, setCursorOn] = useState(false);
  const [hover, setHover] = useState('');
  const [addOpen, setAddOpen] = useState<null | { edit?: string }>(null);
  const [axisOpen, setAxisOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [zoomDrag, setZoomDrag] = useState<{ x0: number; x1: number } | null>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 300 });

  const ax = plot ? xAxis(plot) : null;
  const devices = useMemo(() => parseDeckDevices(deck), [deck]);
  const extra: string[] = source === 'schematic' ? (doc.probeTraces ?? [])
    : (cirTraces ?? (cirProbes.length ? cirProbes : plot ? availableTraces(plot, devices)[0].items.slice(0, 6) : []));
  const setExtra = (list: string[]) => source === 'schematic'
    ? useStore.getState().commitView(d => ({ ...d, probeTraces: list }), 'Probe traces changed')
    : useStore.setState({ cirTraces: list });

  const { traces, errors } = useMemo(() => {
    const out: PTrace[] = [], errs: string[] = [];
    if (!plot) return { traces: out, errors: errs };
    const fromMarkers = source === 'schematic' ? markerExprs(doc).filter((t): t is string => !!t) : [];
    const seen = new Set<string>();
    for (const [expr, fromMarker] of [...fromMarkers.map(e => [e, true] as const), ...extra.map(e => [e, false] as const)]) {
      if (seen.has(expr.toUpperCase())) continue; seen.add(expr.toUpperCase());
      for (const run of runs) {
        try {
          const r = evalForDisplay(run.plot, expr, devices, acMode);
          const label = run.label ? `${r.label}  ${run.label}` : r.label;
          out.push({ key: `${expr}|${run.label}`, label, expr, x: run.plot.vectors[0].re, y: r.y, color: traceColor(out.length), fromMarker,
            exprLabel: r.label, runIdx: runs.indexOf(run), runCount: runs.length, stepObj: run.step, created: run.plot.vectors[0].re.length });
        } catch (e) { errs.push(`${expr}${run.label ? ` (${run.label})` : ''}: ${(e as Error).message}`); }
      }
    }
    return { traces: out, errors: [...new Set(errs)] };
  }, [plot, runs, doc.markers, doc.parts, doc.wires, extra.join('|'), acMode, source, devices]);
  const [styles, setStyles] = useState<Record<string, TraceStyle>>({});
  const [sel, setSel] = useState<string | null>(null);
  /** Tools ▸ Label ▸ Mark: coordinate labels placed at cursor A1 on a trace. */
  const [marks, setMarks] = useState<{ key: string; x: number; y: number; text: string }[]>([]);
  const [ctx, setCtx] = useState<{ x: number; y: number; key: string | null } | null>(null);
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [propKey, setPropKey] = useState<string | null>(null);
  const [measureFor, setMeasureFor] = useState<string | null | undefined>(undefined);
  const visible = traces.filter(t => !hidden.has(t.key));
  const colorOf = (t: PTrace) => styles[t.key]?.color ?? t.color;
  // y-axis unit like PSpice ("73.46mA"): only when all visible traces share one quantity
  const yUnit = (() => {
    const u = new Set(visible.map(t => /^-?I\(/i.test(t.exprLabel) ? 'A' : /^-?V\(/i.test(t.exprLabel) ? 'V' : /^-?W\(/i.test(t.exprLabel) ? 'W' : /^DB\(/i.test(t.exprLabel) ? 'dB' : /^P\(/i.test(t.exprLabel) ? 'd' : '?'));
    return u.size === 1 && !u.has('?') ? [...u][0] : '';
  })();

  const log = !!ax?.log;
  const xUnit = plot?.kind === 'tran' ? 's' : plot?.kind === 'ac' ? 'Hz' : plot?.kind === 'dc' ? 'V' : '';
  const auto = useMemo<Range | null>(() => {
    if (!ax) return null;
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const t of visible) {
      x0 = Math.min(x0, t.x[0]); x1 = Math.max(x1, t.x[t.x.length - 1]);
      for (const v of t.y) if (isFinite(v)) { if (v < y0) y0 = v; if (v > y1) y1 = v; }
    }
    if (!isFinite(x0)) { x0 = ax.x[0]; x1 = ax.x[ax.x.length - 1]; }
    // Transient axis starts at 0 s like PSpice (ngspice omits the t=0 sample with UIC); no data is added.
    if (plot?.kind === 'tran' && x0 > 0 && x0 < (x1 - x0) * 0.01) x0 = 0;
    if (!isFinite(y0)) { y0 = -1; y1 = 1; }
    if (y1 - y0 < 1e-12 * Math.max(1, Math.abs(y0))) { const d = Math.abs(y0) * 0.1 || 1; y0 -= d; y1 += d; }
    const pad = (y1 - y0) * 0.05;
    return { x0, x1, y0: y0 - pad, y1: y1 + pad };
  }, [ax?.x, visible]);
  const R = range ?? auto;
  const xRes = R ? (R.x1 - R.x0) / 1e5 : 1;

  useEffect(() => { setRange(null); setCursors({ a1: null, a2: null }); setMarks([]); setSel(null); }, [plot, acMode, result]);
  useEffect(() => {
    const ro = new ResizeObserver(() => { const el = wrap.current; if (el) setSize({ w: el.clientWidth, h: el.clientHeight }); });
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [plot]);

  const M = { l: 70, r: 16, t: 12, b: 36 };
  const fx = (x: number) => log ? Math.log10(x) : x;
  const pw = size.w - M.l - M.r, ph = size.h - M.t - M.b;
  const sx = (x: number) => R ? M.l + ((fx(x) - fx(R.x0)) / (fx(R.x1) - fx(R.x0))) * pw : 0;
  const sy = (y: number) => R ? M.t + (1 - (y - R.y0) / (R.y1 - R.y0)) * ph : 0;
  const ix = (px: number) => { if (!R) return 0; const f = (px - M.l) / pw; const v = fx(R.x0) + f * (fx(R.x1) - fx(R.x0)); return log ? Math.pow(10, v) : v; };

  useEffect(() => {
    const c = cvs.current; if (!c || !R || !ax) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr; c.height = size.h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = dark ? '#000' : '#fff', fg = dark ? '#ffffff' : '#000', gridC = dark ? '#5a5a5a' : '#c8c8c8';
    g.fillStyle = bg; g.fillRect(0, 0, size.w, size.h);
    g.font = '11px "Courier New", Courier, monospace';
    g.strokeStyle = gridC; g.fillStyle = fg; g.lineWidth = 1; g.setLineDash([3, 3]); // PSpice: dashed major grid
    // X ticks: precision-aware labels; reduce tick count until labels do not overlap.
    let xt: number[] = [], xl: string[] = [];
    if (log) {
      for (let d = Math.floor(Math.log10(R.x0)); d <= Math.ceil(Math.log10(R.x1)); d++) { const v = Math.pow(10, d); if (v >= R.x0 * 0.999 && v <= R.x1 * 1.001) xt.push(v); }
      xl = xt.map(v => formatEng(v, 3, xUnit));
    } else {
      for (let target = Math.max(2, Math.floor(pw / 70)); target >= 2; target--) {
        const r = linearTicks(R.x0, R.x1, target);
        const f = formatTicks(r.ticks, r.step, xUnit);
        xt = r.ticks; xl = f.labels;
        const widest = Math.max(...f.labels.map(l => g.measureText(l).width));
        if (r.ticks.length < 2 || widest + 12 < (sx(r.ticks[1]) - sx(r.ticks[0]))) break;
      }
    }
    g.textAlign = 'center';
    xt.forEach((v, i) => { const X = Math.round(sx(v)) + 0.5; g.beginPath(); g.moveTo(X, M.t); g.lineTo(X, M.t + ph); g.stroke(); const hw = g.measureText(xl[i]).width / 2; g.fillText(xl[i], Math.min(Math.max(X, hw + 2), size.w - hw - 2), M.t + ph + 14); });
    if (log) for (let d = Math.floor(Math.log10(R.x0)); d <= Math.ceil(Math.log10(R.x1)); d++) for (let k = 2; k < 10; k++) {
      const v = k * Math.pow(10, d); if (v < R.x0 || v > R.x1) continue; const X = Math.round(sx(v)) + 0.5; g.globalAlpha = 0.4; g.beginPath(); g.moveTo(X, M.t); g.lineTo(X, M.t + ph); g.stroke(); g.globalAlpha = 1;
    }
    // dotted minor grid between major x ticks (linear axes)
    if (!log && xt.length > 1) {
      const st = xt[1] - xt[0], sub = Math.abs(st / Math.pow(10, Math.floor(Math.log10(Math.abs(st))))) === 2 ? 4 : 5;
      g.setLineDash([1, 3]); g.globalAlpha = 0.55;
      for (let v = xt[0] - st; v <= R.x1; v += st / sub) { if (v < R.x0) continue; const X = Math.round(sx(v)) + 0.5; g.beginPath(); g.moveTo(X, M.t); g.lineTo(X, M.t + ph); g.stroke(); }
      g.globalAlpha = 1; g.setLineDash([3, 3]);
    }
    g.textAlign = 'right';
    const yr = linearTicks(R.y0, R.y1, Math.max(2, Math.floor(ph / 40)));
    const yl = formatTicks(yr.ticks, yr.step, yUnit).labels;
    yr.ticks.forEach((v, i) => { const Y = Math.round(sy(v)) + 0.5; g.beginPath(); g.moveTo(M.l, Y); g.lineTo(M.l + pw, Y); g.stroke(); g.fillText(yl[i], M.l - 4, Y + 4); });
    g.setLineDash([]); g.strokeStyle = fg; g.strokeRect(M.l + 0.5, M.t + 0.5, pw, ph);
    g.textAlign = 'center'; g.fillText(plot!.kind === 'tran' ? 'Time' : plot!.kind === 'ac' ? 'Frequency' : ax.label, M.l + pw / 2, size.h - 6);
    g.save(); g.beginPath(); g.rect(M.l, M.t, pw, ph); g.clip();
    for (const t of visible) {
      const st = styles[t.key] ?? {};
      g.strokeStyle = colorOf(t); g.lineWidth = st.width ?? 1.5;
      g.setLineDash(st.dash === 'dash' ? [6, 4] : st.dash === 'dot' ? [1.5, 3] : []);
      g.beginPath();
      let pen = false;
      for (let i = 0; i < t.x.length; i++) {
        const X = sx(t.x[i]), Y = sy(t.y[i]);
        if (!isFinite(Y) || !isFinite(X)) { pen = false; continue; }
        if (pen) g.lineTo(X, Y); else { g.moveTo(X, Y); pen = true; }
      }
      g.stroke(); g.setLineDash([]);
      // PSpice marks each run of a multi-run (parametric) section with its own symbol along the trace
      const every = 105, offset = 12 + (t.runIdx * 11) % every;
      if (t.runCount > 1 && st.symbols !== false) {
        g.lineWidth = 1;
        for (let X = M.l + offset; X < M.l + pw; X += every) { const xv = ix(X); if (xv < t.x[0] || xv > t.x[t.x.length - 1]) continue; const Y = sy(interp(t.x, t.y, xv)); if (isFinite(Y)) drawSymbol(g, t.runIdx, X, Y); }
      }
      if (t.key === sel) { // selected trace: white squares like PSpice
        g.fillStyle = dark ? '#fff' : '#000';
        for (let X = M.l + 40; X < M.l + pw; X += 80) { const xv = ix(X); if (xv < t.x[0] || xv > t.x[t.x.length - 1]) continue; const Y = sy(interp(t.x, t.y, xv)); if (isFinite(Y)) g.fillRect(X - 3, Y - 3, 6, 6); }
      }
    }
    g.font = '11px "Courier New", Courier, monospace'; g.textAlign = 'left';
    for (const m of marks) {
      const X = sx(m.x), Y = sy(m.y); if (!isFinite(X) || !isFinite(Y)) continue;
      g.fillStyle = fg; g.strokeStyle = fg; g.beginPath(); g.arc(X, Y, 2.5, 0, 2 * Math.PI); g.fill();
      // keep the label inside the plot: below the point near the top edge, to the left near the right edge
      const w = g.measureText(m.text).width, up = Y - 24 > M.t, right = X + 12 + w < M.l + pw;
      const lx = right ? X + 10 : X - 10 - w, ly = up ? Y - 12 : Y + 20;
      g.beginPath(); g.moveTo(X, Y); g.lineTo(right ? lx - 2 : lx + w + 2, up ? ly + 2 : ly - 10); g.stroke(); g.fillText(m.text, lx, ly);
    }
    const drawC = (x: number | null, dash: number[]) => { if (x === null) return; g.strokeStyle = fg; g.setLineDash(dash); const X = sx(x); g.beginPath(); g.moveTo(X, M.t); g.lineTo(X, M.t + ph); g.stroke(); g.setLineDash([]); };
    drawC(cursors.a1, [4, 2]); drawC(cursors.a2, [1, 2]);
    if (zoomDrag) { g.fillStyle = dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,255,0.12)'; g.fillRect(Math.min(zoomDrag.x0, zoomDrag.x1), M.t, Math.abs(zoomDrag.x1 - zoomDrag.x0), ph); }
    g.restore();
  }, [size, R, visible, cursors, dark, zoomDrag, ax, log, sel, styles, yUnit, marks]);

  if (!plot || !ax || !R) {
    return <div className="probe empty">{result ? (result.ok ? 'No waveform data (bias point only). Enable Transient, DC Sweep or AC Sweep in Analysis Setup.' : 'The simulation failed — see Analysis ▸ Examine Output.') : 'No simulation results. Use Analysis ▸ Simulate (F11).'}</div>;
  }

  const snapX = (x: number) => {
    const xs = (visible.find(t => t.key === sel) ?? visible[0])?.x ?? ax.x; let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    return xs[best];
  };
  const fitY = (a: number, b: number): Range | null => {
    let y0 = Infinity, y1 = -Infinity;
    for (const t of visible) for (let i = 0; i < t.x.length; i++) if (t.x[i] >= a && t.x[i] <= b && isFinite(t.y[i])) { y0 = Math.min(y0, t.y[i]); y1 = Math.max(y1, t.y[i]); }
    if (!isFinite(y0)) return null;
    const pad = (y1 - y0) * 0.05 || Math.abs(y0) * 0.1 || 1;
    return { x0: a, x1: b, y0: y0 - pad, y1: y1 + pad };
  };
  const zoomX = (f: number, cx?: number) => {
    const c = cx ?? (log ? Math.sqrt(R.x0 * R.x1) : (R.x0 + R.x1) / 2);
    const a = log ? c * Math.pow(R.x0 / c, f) : c - (c - R.x0) * f, b = log ? c * Math.pow(R.x1 / c, f) : c + (R.x1 - c) * f;
    if (b - a <= Math.abs(c) * 1e-12) return;
    setRange(fitY(a, b) ?? { ...R, x0: a, x1: b });
  };
  /** Trace under the mouse (within 6 px vertically at that x). */
  const traceAt = (px: number, py: number): PTrace | null => {
    let best: PTrace | null = null, bd = 6;
    const xv = ix(px);
    for (const t of visible) { if (xv < t.x[0] || xv > t.x[t.x.length - 1]) continue; const d = Math.abs(sy(interp(t.x, t.y, xv)) - py); if (d < bd) { bd = d; best = t; } }
    return best;
  };
  const onDown = (e: React.MouseEvent) => {
    const px = e.nativeEvent.offsetX;
    if (cursorOn) { const x = snapX(ix(px)); setCursors(c => e.button === 2 ? { ...c, a2: x } : { ...c, a1: x }); return; }
    if (e.button === 0) setZoomDrag({ x0: px, x1: px });
  };
  const onCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    if (cursorOn) return; // right button moves cursor A2 while cursors are displayed (PSpice)
    const t = traceAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    if (t) setSel(t.key);
    setCtx({ x: e.clientX, y: e.clientY, key: t?.key ?? null });
  };
  const onMove = (e: React.MouseEvent) => {
    const px = e.nativeEvent.offsetX, py = e.nativeEvent.offsetY;
    const x = ix(px), y = R.y0 + (1 - (py - M.t) / ph) * (R.y1 - R.y0);
    setHover(`X=${formatPrecise(x, (R.x1 - R.x0) / 1e4, xUnit)}  Y=${formatPrecise(y, (R.y1 - R.y0) / 1e4)}`);
    if (zoomDrag) setZoomDrag({ ...zoomDrag, x1: px });
  };
  const onUp = (e: React.MouseEvent) => {
    if (zoomDrag && Math.abs(zoomDrag.x1 - zoomDrag.x0) <= 5) { const t = traceAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY); setSel(t?.key ?? null); }
    if (zoomDrag && Math.abs(zoomDrag.x1 - zoomDrag.x0) > 5) {
      const a = ix(Math.min(zoomDrag.x0, zoomDrag.x1)), b = ix(Math.max(zoomDrag.x0, zoomDrag.x1));
      const r = fitY(a, b); if (r) setRange(r);
    }
    setZoomDrag(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) zoomX(Math.exp(e.deltaY * 0.01), ix(e.nativeEvent.offsetX));
    else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !log && auto) {
      const w = R.x1 - R.x0; let d = (e.deltaX / pw) * w;
      d = Math.max(auto.x0 - R.x0, Math.min(auto.x1 - R.x1, d)); // keep the view inside the simulated data
      if (d) setRange({ ...R, x0: R.x0 + d, x1: R.x1 + d });
    }
  };

  const selTrace = traces.find(t => t.key === sel) ?? null;
  /** PSpice cursor functions on the selected trace (or the first visible one); moves A1. */
  const cursorTo = (kind: 'max' | 'min' | 'peak' | 'trough') => {
    const t = selTrace ?? visible[0]; if (!t) return;
    setCursorOn(true); setSel(t.key);
    const from = cursors.a1 ?? -Infinity;
    let best = -1;
    for (let i = 0; i < t.x.length; i++) {
      if (t.x[i] < R.x0 || t.x[i] > R.x1) continue;
      if (kind === 'max' || kind === 'min') { if (best < 0 || (kind === 'max' ? t.y[i] > t.y[best] : t.y[i] < t.y[best])) best = i; }
      else if (t.x[i] > from && i > 0 && i < t.x.length - 1 && (kind === 'peak' ? t.y[i] > t.y[i - 1] && t.y[i] >= t.y[i + 1] : t.y[i] < t.y[i - 1] && t.y[i] <= t.y[i + 1])) { best = i; break; }
    }
    if (best >= 0) setCursors(c => ({ ...c, a1: t.x[best] }));
    else useStore.getState().setStatus(kind === 'max' || kind === 'min' ? `No data of the selected trace in the visible range (use Fit)` : `No ${kind} after cursor A1 in the visible range`);
  };
  const markLabel = () => {
    const t = selTrace ?? visible[0]; if (!t || cursors.a1 === null) return;
    const y = interp(t.x, t.y, cursors.a1);
    setMarks(m => [...m, { key: t.key, x: cursors.a1!, y, text: `(${formatPrecise(cursors.a1!, xRes, xUnit)}, ${formatEng(y, 4)}${yUnit})` }]);
  };
  const ctxItems = (key: string | null): MenuItem[] => {
    const t = traces.find(x => x.key === key);
    const common: MenuItem[] = [{ label: 'Add Trace...', run: () => setAddOpen({}) }, { label: 'Fit', run: () => setRange(null) },
      { label: 'Axis Settings...', run: () => setAxisOpen(true) }, { label: 'Cursor Display', run: () => setCursorOn(!cursorOn), checked: cursorOn },
      { label: 'Unhide All Traces', run: () => setHidden(new Set()), disabled: !hidden.size }];
    if (!t) return common;
    return [
      { label: 'Information...', run: () => setInfoKey(t.key) },
      { label: 'Trace Property...', run: () => setPropKey(t.key) },
      { label: 'Evaluate Measurement...', run: () => setMeasureFor(t.exprLabel) },
      { label: 'Copy Values', run: () => navigator.clipboard?.writeText(Array.from(t.x, (x, i) => `${x}\t${t.y[i]}`).join('\n')) },
      { sep: true, label: '' },
      { label: 'Cursor to Max', run: () => { setSel(t.key); setTimeout(() => cursorTo('max')); } },
      { label: 'Cursor to Min', run: () => { setSel(t.key); setTimeout(() => cursorTo('min')); } },
      { label: 'Mark Label at Cursor A1', run: markLabel, disabled: cursors.a1 === null },
      { sep: true, label: '' },
      { label: `Hide ${t.runCount > 1 ? 'This Run' : 'Trace'}`, run: () => setHidden(h => new Set(h).add(t.key)) },
      { label: t.fromMarker ? 'Delete (remove the schematic marker)' : `Delete ${t.exprLabel}`, run: t.fromMarker ? undefined : () => setExtra(extra.filter(x => x !== t.expr)), disabled: t.fromMarker },
      { sep: true, label: '' }, ...common,
    ];
  };
  const exportPNG = () => cvs.current?.toBlob(b => b && download(`${doc.title}-${plot.kind}.png`, b));
  const exportCSV = () => {
    const shared = visible.every(t => t.x === visible[0]?.x);
    const q = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const rows: string[] = [];
    if (shared) {
      rows.push([ax.label, ...visible.map(t => t.label)].map(q).join(','));
      for (let i = 0; i < ax.x.length; i++) rows.push([visible[0]?.x[i] ?? ax.x[i], ...visible.map(t => t.y[i])].map(v => v.toPrecision(12)).join(','));
    } else { // parametric runs have different time points: x/y column pairs
      rows.push(visible.flatMap(t => [`${ax.label} [${t.label}]`, t.label]).map(q).join(','));
      const n = Math.max(...visible.map(t => t.x.length));
      for (let i = 0; i < n; i++) rows.push(visible.flatMap(t => i < t.x.length ? [t.x[i].toPrecision(12), t.y[i].toPrecision(12)] : ['', '']).join(','));
    }
    download(`${doc.title}-${plot.kind}.csv`, rows.join('\n') + '\n', 'text/csv');
  };

  const MENUS: [string, [string, (() => void) | null, boolean?][]][] = [
    ['File', [['Export CSV...', exportCSV], ['Export PNG...', exportPNG], ['View Simulated Netlist', () => useStore.getState().setDialog('netlist')], ['Close Probe', () => useStore.setState({ probeOpen: false })]]],
    ['Edit', [['Delete All Traces', () => { setExtra([]); }], ['Unhide All Traces', () => setHidden(new Set())]]],
    ['View', [['Fit', () => setRange(null)], ['Zoom In (X)', () => zoomX(0.5)], ['Zoom Out (X)', () => zoomX(2)]]],
    ['Simulation', [['Run (F11)', () => import('../state/actions').then(a => a.simulate())], ['Examine Output', () => useStore.getState().setDialog('output')]]],
    ['Trace', [['Add Trace...', () => setAddOpen({})], ['Delete All Traces', () => setExtra([])],
      ['Information...', selTrace ? () => setInfoKey(selTrace.key) : null], ['Trace Property...', selTrace ? () => setPropKey(selTrace.key) : null],
      ['Evaluate Measurement...', traces.length ? () => setMeasureFor(selTrace?.exprLabel ?? null) : null],
      ...(plot.complex ? (['db', 'mag', 'phase'] as AcMode[]).map(m => [`AC: ${m === 'db' ? 'Magnitude (dB)' : m === 'mag' ? 'Magnitude' : 'Phase (deg)'}`, () => setAcMode(m), acMode === m] as [string, () => void, boolean]) : [])]],
    ['Plot', [['Axis Settings...', () => setAxisOpen(true)], ['Black Background', () => setDark(!dark), dark]]],
    ['Tools', [['Cursor Display', () => setCursorOn(!cursorOn), cursorOn],
      ['Cursor: Max', () => cursorTo('max'), false], ['Cursor: Min', () => cursorTo('min'), false],
      ['Cursor: Peak (next)', () => cursorTo('peak'), false], ['Cursor: Trough (next)', () => cursorTo('trough'), false],
      ['Label: Mark (at cursor A1)', cursors.a1 !== null ? markLabel : null, false], ['Label: Delete All Marks', marks.length ? () => setMarks([]) : null, false]]],
  ];

  const runsDone = result?.steps ? `${result.steps.filter(s => s.ok).length}/${result.steps.length} parametric runs` : '';
  return (
    <div className="probe" onMouseDown={() => setMenu(null)}>
      <div className="menubar probe-menubar" onMouseDown={e => e.stopPropagation()}>
        {MENUS.map(([name, items]) => (
          <div key={name} className={`menu${menu === name ? ' open' : ''}`}>
            <span className="mlabel" onMouseDown={() => setMenu(menu === name ? null : name)} onMouseEnter={() => menu && setMenu(name)}><u>{name[0]}</u>{name.slice(1)}</span>
            {menu === name && <div className="dropdown">{items.map(([label, run, checked]) => (
              <div key={label} className={`mitem${run ? '' : ' disabled'}`} onMouseUp={() => { if (run) { setMenu(null); run(); } }}>
                <span className="mcheck">{checked ? '✓' : ''}</span><span className="mtext">{label}</span><span className="mkey" />
              </div>))}</div>}
          </div>
        ))}
      </div>
      <div className="probe-toolbar">
        {basePlots.length > 1 && (
          <select value={plotIdx} onChange={e => setPlotIdx(+e.target.value)} data-tip="Analysis|Choose which analysis section to display">
            {basePlots.map((p, i) => <option key={i} value={i}>{p.title}</option>)}
          </select>
        )}
        {plot.complex && (
          <select value={acMode} onChange={e => setAcMode(e.target.value as AcMode)} data-tip="AC display|dB, magnitude or phase of complex AC results">
            <option value="db">Magnitude (dB)</option><option value="mag">Magnitude</option><option value="phase">Phase (deg)</option>
          </select>
        )}
        <button onClick={() => setAddOpen({})} data-tip="Add Trace|Pick signals or type an expression such as V(2)-V(1), V(R1), W(R1), DB(V(OUT)/V(IN))">Add Trace…</button>
        <button onClick={() => setRange(null)} data-tip="Fit|Show the full x range and auto-scale y">Fit</button>
        <button onClick={() => zoomX(0.5)} data-tip="Zoom In|Halve the x range (or drag on the plot to zoom to an area)">Zoom In</button>
        <button onClick={() => zoomX(2)} data-tip="Zoom Out|Double the x range">Zoom Out</button>
        <button onClick={() => setAxisOpen(true)} data-tip="Axis Settings|Type an exact x/y range, e.g. 2.199ms to 2.201ms">Axis…</button>
        <button className={cursorOn ? 'on' : ''} onClick={() => setCursorOn(!cursorOn)} data-tip="Cursor|Left click places A1, right click places A2; the table shows values and the difference">Cursor</button>
        <button onClick={exportCSV} data-tip="Export CSV|Save the visible traces as numbers">CSV</button>
        <button onClick={exportPNG} data-tip="Export PNG|Save the plot as an image">PNG</button>
        <span className="probe-hover">{hover}</span>
        {stale && <span className="stale">Schematic changed since this simulation</span>}
      </div>
      <div className="probe-body">
        <div className="probe-plot" ref={wrap}>
          <canvas ref={cvs} aria-label="Waveform plot" style={{ width: size.w, height: size.h }} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onWheel={onWheel}
            onMouseLeave={() => { setHover(''); setZoomDrag(null); }} onContextMenu={onCtx} onDoubleClick={e => { const t = traceAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY); if (t) setInfoKey(t.key); }} />
        </div>
      </div>
      <div className="probe-legend" aria-label="Trace legend">
        {traces.length === 0 && !errors.length && <span className="muted">No traces yet — place markers on the schematic (Markers menu) or click Add Trace…</span>}
        {[...new Set(traces.map(t => t.expr))].map(expr => {
          const group = traces.filter(t => t.expr === expr), first = group[0];
          const legendCtx = (e: React.MouseEvent, k: string) => { e.preventDefault(); setSel(k); setCtx({ x: e.clientX, y: e.clientY, key: k }); };
          return (
            <span key={expr} className={`lg${group.every(t => hidden.has(t.key)) ? ' off' : ''}`}>
              {group.length > 1
                ? <>{group.slice(0, 10).map(t => (
                    <span key={t.key} className={`lg-sym${sel === t.key ? ' sel' : ''}${hidden.has(t.key) ? ' off' : ''}`} style={{ color: colorOf(t) }}
                      data-tip={`${t.label}|Click to select, right-click for Information`} onClick={() => setSel(t.key)} onContextMenu={e => legendCtx(e, t.key)}>{SYMBOLS[t.runIdx % 10]}</span>))}
                    {group.length > 10 && <span className="lg-more" data-tip={`${group.length - 10} more runs|Click a trace in the plot to select it`}>...</span>}</>
                : <span className="sw" style={{ background: colorOf(first) }} />}
              <span className={`lg-label${group.some(t => t.key === sel) ? ' sel' : ''}`}
                data-tip={`${first.exprLabel}|${first.fromMarker ? 'From a schematic marker.' : 'Double-click to edit.'} Right-click for Information, Property, Delete`}
                onClick={() => setSel(group.find(t => t.key === sel)?.key ?? first.key)}
                onDoubleClick={() => { if (!first.fromMarker) setAddOpen({ edit: expr }); }}
                onContextMenu={e => legendCtx(e, group.find(t => t.key === sel)?.key ?? first.key)}>{first.exprLabel}</span>
            </span>
          );
        })}
        {errors.map(e => <span key={e} className="trace-err">⚠ {e}</span>)}
      </div>
      <div className="probe-bottom">
        <div className="probe-log" aria-label="Simulation messages">
          {(result?.steps ?? [{ label: '', ok: result!.ok, plots: result!.plots, errors: result!.errors, value: 0 }]).map((s, i) => (
            <div key={i}>{s.label && <b>{s.label}: </b>}{s.plots.map(p => `${p.title} (${p.vectors[0].re.length} pts)`).join(', ')}{s.ok ? '' : ` — FAILED: ${s.errors[0] ?? ''}`}</div>
          ))}
          <div>{result?.ok ? 'Simulation complete' : 'Simulation failed'}{runsDone && ` — ${runsDone}`}</div>
        </div>
        {cursorOn && <div className="probe-cursorpane" aria-label="Probe Cursor">
        <table className="cursor-box">
          <thead><tr><th>Trace</th><th>A1</th><th>A2</th><th>dif</th></tr></thead>
          <tbody>
            {(visible.some(t => t.key === sel) ? visible.filter(t => t.key === sel) : visible.slice(0, 12)).map(t => {
              const y1 = cursors.a1 !== null ? interp(t.x, t.y, cursors.a1) : null, y2 = cursors.a2 !== null ? interp(t.x, t.y, cursors.a2) : null;
              return <tr key={t.key}><td style={{ color: t.color }}>{t.label}</td><td>{y1 !== null ? formatEng(y1, 6) : '—'}</td><td>{y2 !== null ? formatEng(y2, 6) : '—'}</td><td>{y1 !== null && y2 !== null ? formatEng(y1 - y2, 6) : '—'}</td></tr>;
            })}
            <tr><td>{plot.kind === 'tran' ? 'Time' : 'X'}</td><td>{cursors.a1 !== null ? formatPrecise(cursors.a1, xRes, xUnit) : '—'}</td><td>{cursors.a2 !== null ? formatPrecise(cursors.a2, xRes, xUnit) : '—'}</td><td>{cursors.a1 !== null && cursors.a2 !== null ? (plot.kind === 'tran' ? 'Δt=' : 'Δ=') + formatPrecise(cursors.a1 - cursors.a2, xRes, xUnit) : '—'}</td></tr>
          </tbody>
        </table>
      
        </div>}
        <div className="probe-info">Start = {formatPrecise(R.x0, xRes, xUnit)}{'   '}End = {formatPrecise(R.x1, xRes, xUnit)}
          {selTrace && <>{'\n'}Selected: {selTrace.exprLabel}{selTrace.stepObj ? `   ${selTrace.stepObj.label}` : ''}{'\n'}{selTrace.created} data points</>}</div>
      </div>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems(ctx.key)} onClose={() => setCtx(null)} />}
      {infoKey && traces.find(t => t.key === infoKey) && (() => { const t = traces.find(x => x.key === infoKey)!; return (
        <SectionInfoDialog t={{ ...t, step: t.stepObj, color: colorOf(t), shown: t.x.length }} deck={deck} resultTime={result?.time} resultTemp={result?.temp} onClose={() => setInfoKey(null)} />); })()}
      {propKey && traces.find(t => t.key === propKey) && (() => { const t = traces.find(x => x.key === propKey)!; return (
        <TracePropDialog t={{ ...t, step: t.stepObj, shown: t.x.length }} style={styles[t.key] ?? {}} onClose={() => setPropKey(null)}
          onOK={st => { setStyles(m => ({ ...m, [t.key]: st })); setPropKey(null); }} />); })()}
      {measureFor !== undefined && <MeasureDialog traces={visible.map(t => ({ ...t, step: t.stepObj, color: colorOf(t), shown: t.x.length }))} initialExpr={measureFor ?? undefined} onClose={() => setMeasureFor(undefined)} />}
      {axisOpen && <AxisDialog r={R} unit={xUnit} onClose={() => setAxisOpen(false)} onOK={r => { setRange(r); setAxisOpen(false); }} />}
      {addOpen && (
        <AddTraceDialog plot={plot} devices={devices} initial={addOpen.edit ?? ''} editing={!!addOpen.edit}
          onClose={() => setAddOpen(null)}
          onOK={expr => {
            const list = addOpen.edit ? extra.map(x => x === addOpen.edit ? expr : x) : [...extra, expr];
            setExtra(list); setAddOpen(null);
          }} />
      )}
    </div>
  );
}

/** Plot ▸ Axis Settings: exact x and y ranges (SPICE suffixes accepted). */
function AxisDialog({ r, unit, onOK, onClose }: { r: Range; unit: string; onOK: (r: Range) => void; onClose: () => void }) {
  const f = (v: number) => formatPrecise(v, Math.abs(r.x1 - r.x0) / 1e6).replace(/µ/, 'u');
  const [v, setV] = useState({ x0: f(r.x0), x1: f(r.x1), y0: formatEng(r.y0, 6), y1: formatEng(r.y1, 6) });
  const p = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, parseSpiceNumber(s.replace(new RegExp(`${unit}$`), ''))]));
  const ok = Object.values(p).every(x => x.ok) && p.x1.value > p.x0.value && p.y1.value > p.y0.value;
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label="Axis Settings" style={{ width: 320 }} onMouseDown={e => e.stopPropagation()}>
        <div className="dlg-title">Axis Settings<button className="dlg-x" onClick={onClose}>×</button></div>
        <div className="dlg-body">
          <fieldset><legend>X Axis Data Range ({unit || 'x'})</legend>
            <div className="row"><label>From:</label><input value={v.x0} onChange={e => setV({ ...v, x0: e.target.value })} /></div>
            <div className="row"><label>To:</label><input value={v.x1} onChange={e => setV({ ...v, x1: e.target.value })} /></div>
          </fieldset>
          <fieldset><legend>Y Axis Data Range</legend>
            <div className="row"><label>From:</label><input value={v.y0} onChange={e => setV({ ...v, y0: e.target.value })} /></div>
            <div className="row"><label>To:</label><input value={v.y1} onChange={e => setV({ ...v, y1: e.target.value })} /></div>
          </fieldset>
          {!ok && <div className="trace-err">Enter valid numbers with From &lt; To (e.g. 2.199m)</div>}
        </div>
        <div className="dlg-buttons"><button className="default" disabled={!ok} onClick={() => onOK({ x0: p.x0.value, x1: p.x1.value, y0: p.y0.value, y1: p.y1.value })}>OK</button><button onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}

const QUICK = ['+', '-', '*', '/', '(', ')', 'DB(', 'P(', 'M(', 'ABS(', 'SQRT('];

/** PSpice-style Add Traces dialog: categorized signal list + editable Trace Expression. */
function AddTraceDialog({ plot, devices, initial, editing, onOK, onClose }: {
  plot: Plot; devices: ReturnType<typeof parseDeckDevices>; initial: string; editing: boolean; onOK: (expr: string) => void; onClose: () => void;
}) {
  const [expr, setExpr] = useState(initial);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => availableTraces(plot, devices), [plot, devices]);
  const insert = (t: string) => {
    const el = inp.current, a = el?.selectionStart ?? expr.length, b = el?.selectionEnd ?? expr.length;
    const next = expr.slice(0, a) + t + expr.slice(b);
    setExpr(next); setErr('');
    requestAnimationFrame(() => { el?.focus(); const c = a + t.length; el?.setSelectionRange(c, c); });
  };
  const submit = (e = expr) => {
    const x = e.trim().replace(/\s+/g, ' ');
    try { evaluateExpr(x, plot, devices); onOK(x); } catch (ex) { setErr((ex as Error).message); }
  };
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label="Add Traces" onMouseDown={e => e.stopPropagation()} style={{ width: 520 }}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="dlg-title">{editing ? 'Modify Trace' : 'Add Traces'}<button className="dlg-x" onClick={onClose}>×</button></div>
        <div className="dlg-body">
          <div className="row"><label style={{ width: 60 }}>Filter:</label><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="e.g. R1" style={{ flex: 1 }} /></div>
          <div className="listbox trace-list">
            {groups.map(g => {
              const items = g.items.filter(i => i.toLowerCase().includes(filter.toLowerCase()));
              return items.length ? <div key={g.title}><div className="lh">{g.title}</div>
                {items.map(i => <div key={i} className="li" data-tip={`${i}|Click: insert into the expression. Double-click: add as a trace.`} onClick={() => insert(i)} onDoubleClick={() => submit(i)}>{i}</div>)}</div> : null;
            })}
          </div>
          <div className="quick">{QUICK.map(q => <button key={q} onClick={() => insert(q)}>{q}</button>)}</div>
          <div className="row"><label style={{ width: 100 }}>Trace Expression:</label>
            <input ref={inp} autoFocus value={expr} className={err ? 'bad' : ''} style={{ flex: 1, fontFamily: 'Menlo, monospace' }}
              onChange={e => { setExpr(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
          </div>
          {err ? <div className="trace-err">{err}</div> : <div className="muted">Examples: V(2)-V(1) · V(R1) (across R1) · I(R1) · W(R1) (power) · DB(V(OUT)/V(IN)) · 1k*I(R1). I(x) is into pin 1 / +.</div>}
        </div>
        <div className="dlg-buttons"><button className="default" disabled={!expr.trim()} onClick={() => submit()}>OK</button><button onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}
