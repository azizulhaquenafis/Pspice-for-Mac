// Probe dialogs in the PSpice style: Section Information, Trace Property, Evaluate Measurement, context menu.
import { useEffect, useMemo, useState, ReactNode } from 'react';
import { SimStep } from '../sim/types';
import { deckComponents } from '../sim/deckInfo';
import { MEASUREMENTS, measure } from '../sim/measure';
import { formatEng, parseSpiceNumber } from '../core/units';

export interface TraceRef {
  key: string; label: string; exprLabel: string; expr: string; color: string;
  x: Float64Array; y: Float64Array; runIdx: number; runCount: number; step?: SimStep;
  created: number; shown: number;
}
export interface TraceStyle { color?: string; width?: number; dash?: 'solid' | 'dash' | 'dot'; symbols?: boolean }

export const SYMBOLS = ['□', '◇', '▽', '△', '○', '+', '×', '⅄', 'Y', '*'] as const;

/** Draw PSpice trace symbol k (0..9) centred at (x, y). */
export function drawSymbol(g: CanvasRenderingContext2D, k: number, x: number, y: number, r = 3.5) {
  g.beginPath();
  switch (k % 10) {
    case 0: g.rect(x - r, y - r, 2 * r, 2 * r); break;
    case 1: g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y); g.lineTo(x, y + r + 1); g.lineTo(x - r - 1, y); g.closePath(); break;
    case 2: g.moveTo(x - r, y - r); g.lineTo(x + r, y - r); g.lineTo(x, y + r); g.closePath(); break;
    case 3: g.moveTo(x - r, y + r); g.lineTo(x + r, y + r); g.lineTo(x, y - r); g.closePath(); break;
    case 4: g.arc(x, y, r, 0, 2 * Math.PI); break;
    case 5: g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); break;
    case 6: g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); break;
    case 7: g.moveTo(x, y - r); g.lineTo(x, y + 0.5); g.lineTo(x - r, y + r); g.moveTo(x, y + 0.5); g.lineTo(x + r, y + r); break;
    case 8: g.moveTo(x - r, y - r); g.lineTo(x, y); g.lineTo(x + r, y - r); g.moveTo(x, y); g.lineTo(x, y + r); break;
    case 9: for (let a = 0; a < 3; a++) { const t = (a * Math.PI) / 3; g.moveTo(x - r * Math.cos(t), y - r * Math.sin(t)); g.lineTo(x + r * Math.cos(t), y + r * Math.sin(t)); } break;
  }
  g.stroke();
}

function Win({ title, children, onClose, width = 420, buttons }: { title: string; children: ReactNode; onClose: () => void; width?: number; buttons?: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label={title} style={{ width }} onMouseDown={e => e.stopPropagation()}>
        <div className="dlg-title">{title}<button className="dlg-x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="dlg-body">{children}</div>
        <div className="dlg-buttons">{buttons ?? <button className="default" autoFocus onClick={onClose}>OK</button>}</div>
      </div>
    </div>
  );
}

/** Trace ▸ Information — "Section Information" as in PSpice Probe. */
export function SectionInfoDialog({ t, deck, resultTime, resultTemp, onClose }: { t: TraceRef; deck: string; resultTime?: number; resultTemp?: number; onClose: () => void }) {
  const [details, setDetails] = useState(false);
  const step = t.step;
  const when = new Date(step?.time ?? resultTime ?? Date.now());
  const p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${p2(when.getHours())}:${p2(when.getMinutes())}:${p2(when.getSeconds())} on ${p2(when.getMonth() + 1)}/${p2(when.getDate())}/${p2(when.getFullYear() % 100)}`;
  const temp = step?.temp ?? resultTemp ?? 27;
  const rows = useMemo(() => (details ? deckComponents(step?.deck ?? deck) : []), [details, step, deck]);
  const stepLine = step?.sweep && step.sweep.kind !== 'temp'
    ? `Step ${step.sweep.kind === 'param' ? 'param ' : ''}${step.sweep.name} = ${formatEng(step.value, 6)}` : null;
  return (
    <Win title="Section Information" onClose={onClose} width={details ? 560 : 420} buttons={<>
      <button onClick={() => setDetails(!details)}>{details ? 'Hide Details' : 'Details >>'}</button>
      <button className="default" autoFocus onClick={onClose}>OK</button></>}>
      <div className="secinfo">
        <div className="infoicon" aria-hidden="true">i</div>
        <div>
          <div className="si-trace">{t.exprLabel}</div>
          <p>This trace came from one simulation run{t.runCount > 1 ? ` (run ${t.runIdx + 1} of ${t.runCount})` : ''}</p>
          <div className="si-lines">
            {stepLine && <div>{stepLine}</div>}
            <div>Temperature = {temp.toFixed(1)} Deg</div>
            <div>Simulation at {stamp}</div>
            <div>The simulator created {t.created} data points.</div>
            <div>This trace is being displayed using {t.shown} data points.</div>
          </div>
        </div>
      </div>
      {details && (
        <div className="si-details">
          <div className="lh">Circuit values in this run</div>
          <table className="attr"><tbody>{rows.map(r => <tr key={r.name}><td>{r.name}</td><td>{r.nodes}</td><td>{r.value}</td></tr>)}</tbody></table>
        </div>
      )}
    </Win>
  );
}

/** Trace ▸ Trace Property: colour, width, pattern, run symbols. */
export function TracePropDialog({ t, style, onOK, onClose }: { t: TraceRef; style: TraceStyle; onOK: (s: TraceStyle) => void; onClose: () => void }) {
  const [s, setS] = useState<TraceStyle>({ color: style.color ?? t.color, width: style.width ?? 1.5, dash: style.dash ?? 'solid', symbols: style.symbols ?? true });
  return (
    <Win title={`Trace Property — ${t.label}`} onClose={onClose} width={340} buttons={<>
      <button className="default" onClick={() => onOK(s)}>OK</button><button onClick={onClose}>Cancel</button></>}>
      <div className="row"><label>Color:</label><input type="color" value={s.color} onChange={e => setS({ ...s, color: e.target.value })} style={{ width: 60, height: 22, padding: 0 }} /></div>
      <div className="row"><label>Width:</label><select value={s.width} onChange={e => setS({ ...s, width: +e.target.value })}>{[1, 1.5, 2, 3, 4].map(w => <option key={w} value={w}>{w}</option>)}</select></div>
      <div className="row"><label>Pattern:</label><select value={s.dash} onChange={e => setS({ ...s, dash: e.target.value as TraceStyle['dash'] })}>
        <option value="solid">Solid</option><option value="dash">Dashed</option><option value="dot">Dotted</option></select></div>
      {t.runCount > 1 && <div className="row"><label /><label className="chk"><input type="checkbox" checked={s.symbols} onChange={e => setS({ ...s, symbols: e.target.checked })} />Show run symbols</label></div>}
    </Win>
  );
}

/** Trace ▸ Evaluate Measurement: a goal function on one expression, evaluated for every run. */
export function MeasureDialog({ traces, initialExpr, onClose }: { traces: TraceRef[]; initialExpr?: string; onClose: () => void }) {
  const exprs = [...new Set(traces.map(t => t.exprLabel))];
  const [fn, setFn] = useState('Max');
  const [expr, setExpr] = useState(initialExpr && exprs.includes(initialExpr) ? initialExpr : exprs[0] ?? '');
  const [args, setArgs] = useState<string[]>(['', '1']);
  const def = MEASUREMENTS.find(m => m.name === fn)!;
  const parsed = def.args.map((_, i) => parseSpiceNumber(args[i] ?? ''));
  const ready = parsed.every(p => p.ok);
  const rows = ready ? traces.filter(t => t.exprLabel === expr).map(t => ({ t, v: measure(fn, t.x, t.y, parsed.map(p => p.value)) })) : [];
  const text = rows.map(r => `${fn}(${expr})${r.t.step ? `  ${r.t.step.label}` : ''}\t${r.v}`).join('\n');
  return (
    <Win title="Evaluate Measurement" onClose={onClose} width={520} buttons={<>
      <button onClick={() => navigator.clipboard?.writeText(text)} disabled={!rows.length}>Copy</button><button className="default" onClick={onClose}>Close</button></>}>
      <div className="row"><label>Function:</label>
        <select value={fn} onChange={e => setFn(e.target.value)}>{MEASUREMENTS.map(m => <option key={m.name} value={m.name}>{m.name}{m.args.length ? `(trace, ${m.args.join(', ')})` : '(trace)'}</option>)}</select>
        <span className="muted">{def.help}</span></div>
      <div className="row"><label>Trace:</label><select value={expr} onChange={e => setExpr(e.target.value)}>{exprs.map(x => <option key={x}>{x}</option>)}</select></div>
      {def.args.map((a, i) => (
        <div className="row" key={a}><label>{a}:</label><input value={args[i] ?? ''} className={parsed[i]?.ok ? '' : 'bad'} onChange={e => { const n = [...args]; n[i] = e.target.value; setArgs(n); }} placeholder={a === 'N' ? '1' : 'e.g. 2.5m'} /></div>
      ))}
      <table className="attr meas-table"><tbody>
        {rows.map(r => <tr key={r.t.key}><td style={{ color: r.t.color }}>{r.t.step ? r.t.step.label : expr}</td>
          <td>{isFinite(r.v) ? formatEng(r.v, 6) + (fn === 'Overshoot' ? ' %' : '') : 'not found'}</td></tr>)}
      </tbody></table>
    </Win>
  );
}

export interface MenuItem { label: string; run?: () => void; checked?: boolean; sep?: boolean; disabled?: boolean }
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const c = () => onClose();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const t = setTimeout(() => window.addEventListener('mousedown', c), 0);
    window.addEventListener('keydown', k, true);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', c); window.removeEventListener('keydown', k, true); };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 230), top = Math.min(y, window.innerHeight - items.length * 21 - 10);
  return (
    // Items act on click (press + release on the item), so releasing the right button that opened the menu does nothing.
    <div className="dropdown ctxmenu" role="menu" style={{ position: 'fixed', left, top }} onMouseDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) => it.sep ? <div key={i} className="msep" /> : (
        <div key={i} role="menuitem" className={`mitem${it.disabled || !it.run ? ' disabled' : ''}`}
          onClick={() => { if (it.run && !it.disabled) { onClose(); it.run(); } }}>
          <span className="mcheck">{it.checked ? '✓' : ''}</span><span className="mtext">{it.label}</span><span className="mkey" />
        </div>
      ))}
    </div>
  );
}
