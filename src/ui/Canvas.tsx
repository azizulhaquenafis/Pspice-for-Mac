import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useStore, wireAt, pinAt, addMarker } from '../state/store';
import { Pt, snap, Part, newId, SchematicDoc } from '../core/model';
import { getDef, pinPositions, xf } from '../core/library';
import { extractConnectivity, onWire, Connectivity } from '../core/connectivity';
import { PartView, SymbolBody, partTextLayout, textBox, paramRows } from './Symbol';
import { svgTransform } from '../core/library';
import { editSelected, zoomBy } from '../state/actions';
import { formatEng } from '../core/units';
import { currentVector, spiceNameFor } from '../core/netlist';
import { getVector } from '../sim/types';
import { traceColor } from './probeModel';
import { ContextMenu, MenuItem } from './ProbeDialogs';
import { MarkerGlyph, markerHit, markerBox } from './markerShape';
import { snapToConnection, SNAP_FOR, SNAP_PX, SnapResult } from '../core/snapping';

/** Registered by the canvas so global Escape can cancel an in-progress wire first. */
export const canvasHooks = { escape: () => false };

const PAGE = { w: 1100, h: 850 };

type Drag =
  | { kind: 'move'; start: Pt; cur: Pt }
  | { kind: 'band'; start: Pt; cur: Pt }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'text'; target: string; start: Pt; cur: Pt };

export type TextDrag = { target: string; dx: number; dy: number } | null;

/** Orthogonal route from a to b: horizontal first when |dx| >= |dy|. */
function route(a: Pt, b: Pt, hFirst: boolean): { a: Pt; b: Pt }[] {
  if (a.x === b.x || a.y === b.y) return [{ a, b }];
  const c = hFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [{ a, b: c }, { a: c, b }];
}

const Parts = memo(function Parts({ parts, sel, td }: { parts: Part[]; sel: string[]; td: TextDrag }) {
  return <g>{parts.map(p => {
    const mine = td && (td.target === `ref:${p.id}` || td.target === `val:${p.id}`);
    return <PartView key={p.id} p={p} selected={sel.includes(p.id)} dragText={mine ? { which: td!.target.startsWith('ref') ? 'ref' : 'val', dx: td!.dx, dy: td!.dy } : undefined} />;
  })}</g>;
});

export function Canvas() {
  const doc = useStore(s => s.doc);
  const sel = useStore(s => s.sel);
  const tool = useStore(s => s.tool);
  const highlightNet = useStore(s => s.highlightNet);
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<Pt>({ x: 0, y: 0 });
  const [raw, setRaw] = useState<Pt | null>(null); // unsnapped mouse position (world units)
  const [wirePts, setWirePts] = useState<Pt[] | null>(null);
  const [hFirst, setHFirst] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [vdFirst, setVdFirst] = useState<Pt | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; partId: string } | null>(null);
  const v = doc.view;
  const td: TextDrag = drag?.kind === 'text' ? { target: drag.target, dx: Math.round(drag.cur.x - drag.start.x), dy: Math.round(drag.cur.y - drag.start.y) } : null;

  const conn = useMemo(() => extractConnectivity(doc), [doc.parts, doc.wires, doc.junctions, doc.labels]);

  useEffect(() => {
    canvasHooks.escape = () => {
      if (wirePts) { setWirePts(null); return true; }
      if (vdFirst) { setVdFirst(null); return true; }
      return false;
    };
  }, [wirePts, vdFirst]);
  useEffect(() => { if (tool.kind !== 'wire') setWirePts(null); if (tool.kind !== 'marker') setVdFirst(null); }, [tool]);

  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: v.x + (e.clientX - r.left) / v.zoom, y: v.y + (e.clientY - r.top) / v.zoom };
  };
  const snapped = (e: { clientX: number; clientY: number }): Pt => { const w = toWorld(e); return { x: snap(w.x), y: snap(w.y) }; };

  // Hit testing (unsnapped world point, tolerance in world units)
  const hit = (w: Pt) => {
    const tol = 6 / v.zoom; // 6 screen pixels at any zoom
    for (let i = doc.markers.length - 1; i >= 0; i--) {
      const m = doc.markers[i];
      if (markerHit(m, w) || (m.kind === 'VD' && markerHit({ x: m.x2!, y: m.y2! }, w))) return { kind: 'marker' as const, id: m.id };
    }
    for (let i = doc.labels.length - 1; i >= 0; i--) {
      const l = doc.labels[i]; const len = l.text.length * 6.5;
      if (w.x >= l.x - 2 && w.x <= l.x + len + 4 && w.y <= l.y + 2 && w.y >= l.y - 12) return { kind: 'label' as const, id: l.id };
    }
    for (let i = doc.parts.length - 1; i >= 0; i--) {
      const p = doc.parts[i];
      if (getDef(p.type).isParam) {
        const rows = Math.max(1, paramRows(p).length);
        if (w.x >= p.x - 3 && w.x <= p.x + 75 && w.y >= p.y - 10 && w.y <= p.y + 10 * rows + 3) return { kind: 'part' as const, id: p.id };
        continue;
      }
      const pins = pinPositions(p);
      const c = xf(p, 0, 0), o = xf(p, getDef(p.type).isBubble ? 14 : getDef(p.type).pins.length > 2 ? 50 : 40, 0);
      const xs = [...pins.map(q => q.x), c.x, o.x], ys = [...pins.map(q => q.y), c.y, o.y];
      const pad = Math.max(4, 6 / v.zoom);
      if (w.x >= Math.min(...xs) - pad && w.x <= Math.max(...xs) + pad && w.y >= Math.min(...ys) - pad && w.y <= Math.max(...ys) + pad) return { kind: 'part' as const, id: p.id };
    }
    for (const j of doc.junctions) if (Math.hypot(j.x - w.x, j.y - w.y) < tol) return { kind: 'junction' as const, id: j.id };
    for (const wi of doc.wires) {
      const x0 = Math.min(wi.a.x, wi.b.x), x1 = Math.max(wi.a.x, wi.b.x), y0 = Math.min(wi.a.y, wi.b.y), y1 = Math.max(wi.a.y, wi.b.y);
      if (w.x >= x0 - tol && w.x <= x1 + tol && w.y >= y0 - tol && w.y <= y1 + tol) return { kind: 'wire' as const, id: wi.id };
    }
    return null;
  };

  const isConnPoint = (p: Pt, d: SchematicDoc) => !!pinAt(d, p) || d.wires.some(w => onWire(w, p));
  /** The snapping rule for the active tool (core/snapping.ts). Used for the preview AND the click. */
  const snapFor = (w: Pt): SnapResult | null => {
    const reach = SNAP_PX / v.zoom;
    if (tool.kind === 'wire') return snapToConnection(doc, w, reach, SNAP_FOR.wire);
    if (tool.kind === 'alias') return snapToConnection(doc, w, reach, SNAP_FOR.alias);
    if (tool.kind === 'junction') return snapToConnection(doc, w, reach, SNAP_FOR.junction);
    if (tool.kind === 'marker' && tool.marker !== 'W')
      return snapToConnection(doc, w, reach, tool.marker === 'I' ? SNAP_FOR.currentMarker : SNAP_FOR.voltageMarker);
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const st = useStore.getState();
    if (e.button === 1 || (e.button === 0 && e.altKey)) { setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y }); return; }
    if (e.button === 2) return;
    const p = snapped(e);
    switch (tool.kind) {
      case 'zoomarea': setDrag({ kind: 'band', start: toWorld(e), cur: toWorld(e) }); return;
      case 'place': st.placePart(tool.partType, p, tool.rot, tool.mirror); return;
      case 'wire': {
        const s = snapFor(toWorld(e));
        const q = s?.p ?? p;                                  // pins / wires within reach pull the wire end onto them
        if (!wirePts) { setWirePts([q]); return; }
        const last = wirePts[wirePts.length - 1];
        if (q.x === last.x && q.y === last.y) return;
        st.addWires(route(last, q, hFirst));
        if (s) setWirePts(null); else setWirePts([...wirePts, q]); // ending on a pin or wire finishes the wire
        return;
      }
      case 'alias': case 'text': {
        if (tool.kind === 'text') { st.setDialog({ kind: 'label', at: p, mode: 'text' }); return; }
        const s = snapFor(toWorld(e));
        if (!s) { st.setStatus('Click on (or next to) a wire or pin to place a net alias'); return; }
        st.setDialog({ kind: 'label', at: s.p, mode: 'alias' }); return;
      }
      case 'junction': {
        const s = snapFor(toWorld(e));
        if (!s) { st.setStatus('Click on (or next to) a wire crossing or wire to place a junction'); return; }
        const q = s.p;
        st.commit(d => ({ ...d, junctions: [...d.junctions.filter(j => j.x !== q.x || j.y !== q.y), { id: newId('j'), ...q }] }), 'Junction placed');
        return;
      }
      case 'marker': {
        const w = toWorld(e);
        if (tool.marker === 'V' || tool.marker === 'VD') {
          const t = snapFor(w);
          if (!t) { st.setStatus('Click on (or next to) a wire or pin to place the marker'); return; }
          if (tool.marker === 'V') { addMarker({ kind: 'V', x: t.p.x, y: t.p.y }); return; }
          if (!vdFirst) { setVdFirst(t.p); st.setStatus('Click the second (−) point of the differential marker'); return; }
          addMarker({ kind: 'VD', x: vdFirst.x, y: vdFirst.y, x2: t.p.x, y2: t.p.y });
          setVdFirst(null);
        } else if (tool.marker === 'W') {
          const h = hit(w);
          const part = h?.kind === 'part' ? doc.parts.find(q => q.id === h.id) : undefined;
          if (!part || getDef(part.type).pins.length < 2) { st.setStatus('Power marker must be placed on a two-terminal part'); return; }
          const pp = pinPositions(part);
          addMarker({ kind: 'W', x: snap((pp[0].x + pp[1].x) / 2), y: snap((pp[0].y + pp[1].y) / 2), partId: part.id });
        } else {
          const t = snapFor(w);
          if (!t?.partId) { st.setStatus('Current marker must be placed on (or next to) a part pin'); return; }
          addMarker({ kind: 'I', x: t.p.x, y: t.p.y, partId: t.partId, pin: t.pin });
        }
        return;
      }
      case 'select': {
        const dragEl = (e.target as Element).closest?.('[data-drag]');
        if (dragEl) {
          const target = dragEl.getAttribute('data-drag')!;
          if (target.startsWith('alias:')) st.select({ labels: [target.slice(6)] }, e.shiftKey);
          const w0 = toWorld(e);
          setDrag({ kind: 'text', target, start: w0, cur: w0 });
          return;
        }
        const w = toWorld(e);
        const h = hit(w);
        if (!h) { if (!e.shiftKey) st.clearSel(); useStore.setState({ highlightNet: null }); setDrag({ kind: 'band', start: w, cur: w }); return; }
        const key = ({ part: 'parts', wire: 'wires', label: 'labels', junction: 'junctions', marker: 'markers' } as const)[h.kind];
        const already = (st.sel[key] as string[]).includes(h.id);
        if (e.shiftKey) {
          if (already) useStore.setState({ sel: { ...st.sel, [key]: (st.sel[key] as string[]).filter(i => i !== h.id) } });
          else st.select({ [key]: [h.id] }, true);
        } else if (!already) st.select({ [key]: [h.id] });
        if (h.kind === 'wire') useStore.setState({ highlightNet: conn.wireNet.get(h.id)?.name ?? null });
        setDrag({ kind: 'move', start: p, cur: p });
      }
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const w = toWorld(e);
    setRaw(w);
    const p = snapFor(w)?.p ?? snapped(e);
    if (p.x !== cursor.x || p.y !== cursor.y) { setCursor(p); useStore.setState({ cursor: p }); }
    if (wirePts) {
      const last = wirePts[wirePts.length - 1];
      // choose direction from the first significant movement
      if (Math.abs(p.x - last.x) !== Math.abs(p.y - last.y) && (p.x === last.x || p.y === last.y)) setHFirst(p.y === last.y);
    }
    if (!drag) return;
    if (drag.kind === 'pan') useStore.getState().setView({ ...v, x: drag.vx - (e.clientX - drag.sx) / v.zoom, y: drag.vy - (e.clientY - drag.sy) / v.zoom });
    else if (drag.kind === 'move') setDrag({ ...drag, cur: p });
    else if (drag.kind === 'text') setDrag({ ...drag, cur: toWorld(e) });
    else setDrag({ ...drag, cur: toWorld(e) });
  };

  const onMouseUp = () => {
    if (!drag) return;
    const st = useStore.getState();
    if (drag.kind === 'move') st.moveSelection(drag.cur.x - drag.start.x, drag.cur.y - drag.start.y);
    if (drag.kind === 'text' && td && (td.dx || td.dy)) {
      // Manual placement of reference/value/alias/bias text (PSpice lets you drag attribute text).
      const [kind, id] = [td.target.slice(0, td.target.indexOf(':')), td.target.slice(td.target.indexOf(':') + 1)];
      const add = (o?: Pt) => ({ x: (o?.x ?? 0) + td.dx, y: (o?.y ?? 0) + td.dy });
      st.commitView(d => {
        if (kind === 'ref') return { ...d, parts: d.parts.map(p => p.id === id ? { ...p, refOff: add(p.refOff) } : p) };
        if (kind === 'val') return { ...d, parts: d.parts.map(p => p.id === id ? { ...p, valOff: add(p.valOff) } : p) };
        if (kind === 'alias') return { ...d, labels: d.labels.map(l => l.id === id ? { ...l, off: add(l.off) } : l) };
        if (kind === 'bias') return { ...d, biasOff: { ...d.biasOff, [id]: add(d.biasOff?.[id]) } };
        return d;
      }, 'Text moved');
    }
    if (drag.kind === 'band' && tool.kind === 'zoomarea') {
      const x0 = Math.min(drag.start.x, drag.cur.x), x1 = Math.max(drag.start.x, drag.cur.x), y0 = Math.min(drag.start.y, drag.cur.y), y1 = Math.max(drag.start.y, drag.cur.y);
      const el = svgRef.current!;
      if (x1 - x0 > 4 && y1 - y0 > 4) {
        const zoom = Math.min(8, Math.max(0.2, Math.min(el.clientWidth / (x1 - x0), el.clientHeight / (y1 - y0))));
        st.setView({ zoom, x: (x0 + x1) / 2 - el.clientWidth / 2 / zoom, y: (y0 + y1) / 2 - el.clientHeight / 2 / zoom });
      }
      st.setTool({ kind: 'select' });
      setDrag(null); return;
    }
    if (drag.kind === 'band') {
      const x0 = Math.min(drag.start.x, drag.cur.x), x1 = Math.max(drag.start.x, drag.cur.x);
      const y0 = Math.min(drag.start.y, drag.cur.y), y1 = Math.max(drag.start.y, drag.cur.y);
      if (x1 - x0 > 2 || y1 - y0 > 2) {
        const inR = (q: Pt) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
        st.select({
          parts: doc.parts.filter(p => getDef(p.type).isParam ? inR(p) : pinPositions(p).every(inR)).map(p => p.id),
          wires: doc.wires.filter(w => inR(w.a) && inR(w.b)).map(w => w.id),
          labels: doc.labels.filter(inR).map(l => l.id),
          junctions: doc.junctions.filter(inR).map(j => j.id),
          markers: doc.markers.filter(inR).map(m => m.id),
        }, true);
      }
    }
    setDrag(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const st = useStore.getState();
    if (tool.kind === 'wire') { setWirePts(null); return; }
    if (tool.kind !== 'select') return;
    const dragEl = (e.target as Element).closest?.('[data-drag]');
    const dt = dragEl?.getAttribute('data-drag');
    if (dt && (dt.startsWith('ref:') || dt.startsWith('val:'))) { st.select({ parts: [dt.slice(4)] }); editSelected(); return; }
    if (dt?.startsWith('alias:')) { st.select({ labels: [dt.slice(6)] }); editSelected(); return; }
    const h = hit(toWorld(e));
    if (!h) return;
    if (h.kind === 'part' || h.kind === 'label') { st.select({ [h.kind === 'part' ? 'parts' : 'labels']: [h.id] }); editSelected(); }
    if (h.kind === 'wire') st.setDialog({ kind: 'label', at: snapped(e), mode: 'alias' });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (wirePts) { setWirePts(null); return; }
    if (tool.kind === 'select') {
      const h = hit(toWorld(e));
      if (h?.kind === 'part') { useStore.getState().select({ parts: [h.id] }); setCtx({ x: e.clientX, y: e.clientY, partId: h.id }); return; }
    }
    if (tool.kind !== 'select') useStore.getState().setTool({ kind: 'select' });
  };

  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else { const vv = useStore.getState().doc.view; useStore.getState().setView({ ...vv, x: vv.x + e.deltaX / vv.zoom, y: vv.y + e.deltaY / vv.zoom }); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const hint = raw ? snapFor(raw) : null;
  const moveOff = drag?.kind === 'move' ? { x: drag.cur.x - drag.start.x, y: drag.cur.y - drag.start.y } : null;
  const hlWires = highlightNet ? new Set(conn.nets.find(n => n.name === highlightNet)?.wireIds ?? []) : null;

  const partMenu = (id: string): MenuItem[] => {
    const st = useStore.getState(), p = doc.parts.find(q => q.id === id);
    if (!p) return [];
    const def = getDef(p.type), two = def.pins.length >= 2 && !def.isGround;
    return [
      { label: 'Information...', run: () => st.setDialog({ kind: 'partInfo', partId: id }) },
      { label: 'Edit Attributes...', run: () => st.setDialog({ kind: 'props', partId: id }) },
      { sep: true, label: '' },
      { label: 'Rotate (Ctrl+R)', run: () => st.rotateSelection() }, { label: 'Flip (Ctrl+F)', run: () => st.mirrorSelection() },
      { label: 'Copy', run: () => st.copy() }, { label: 'Delete', run: () => st.deleteSelection() },
      { sep: true, label: '' },
      { label: 'Mark Current into Pin 1', disabled: !two, run: () => { const pp = pinPositions(p)[0]; addMarker({ kind: 'I', x: pp.x, y: pp.y, partId: p.id, pin: def.pins[0].name }); } },
      { label: 'Mark Power Dissipation', disabled: !two, run: () => { const pp = pinPositions(p); addMarker({ kind: 'W', x: snap((pp[0].x + pp[1].x) / 2), y: snap((pp[0].y + pp[1].y) / 2), partId: p.id }); } },
    ];
  };

  return (
    <>
    {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={partMenu(ctx.partId)} onClose={() => setCtx(null)} />}
    <svg id="schematic-canvas" ref={svgRef} className={`canvas tool-${tool.kind}`}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
      <defs>
        <pattern id="grid" width={10} height={10} patternUnits="userSpaceOnUse">
          <rect x={-0.4} y={-0.4} width={0.8} height={0.8} className="griddot" />
        </pattern>
        <pattern id="grid50" width={50} height={50} patternUnits="userSpaceOnUse">
          <rect x={-0.6} y={-0.6} width={1.2} height={1.2} className="griddot" />
        </pattern>
      </defs>
      <g transform={`scale(${v.zoom}) translate(${-v.x} ${-v.y})`}>
        <PageBorder />
        <rect x={0} y={0} width={PAGE.w} height={PAGE.h} fill={`url(#${v.zoom >= 0.7 ? 'grid' : 'grid50'})`} pointerEvents="none" />
        <g className="wires">
          {doc.wires.map(w => (
            <line key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y}
              className={`wire${sel.wires.includes(w.id) ? ' sel' : ''}${hlWires?.has(w.id) ? ' hl' : ''}`}
              transform={moveOff && sel.wires.includes(w.id) ? `translate(${moveOff.x} ${moveOff.y})` : undefined} />
          ))}
        </g>
        {conn.junctionDots.map((j, i) => <circle key={i} cx={j.x} cy={j.y} r={2.6} className="junction" />)}
        {doc.junctions.map(j => sel.junctions.includes(j.id) && <circle key={j.id} cx={j.x} cy={j.y} r={4.5} className="junction-sel" />)}
        <Parts parts={doc.parts} sel={sel.parts} td={td} />
        {moveOff && sel.parts.length > 0 && (
          <g transform={`translate(${moveOff.x} ${moveOff.y})`} className="ghost">
            {doc.parts.filter(p => sel.parts.includes(p.id)).map(p => <PartView key={p.id} p={p} selected />)}
          </g>
        )}
        {doc.labels.map(l => {
          const live = td?.target === `alias:${l.id}` ? td : null;
          const ox = (l.off?.x ?? 0) + (live?.dx ?? 0), oy = (l.off?.y ?? 0) + (live?.dy ?? 0);
          return (
            <g key={l.id}>
              {l.kind === 'alias' && (ox || oy) ? <line x1={l.x} y1={l.y} x2={l.x + ox + 2} y2={l.y + oy - 3} className="alias-lead" /> : null}
              <text x={l.x + 2 + ox} y={l.y - 3 + oy} data-drag={l.kind === 'alias' ? `alias:${l.id}` : undefined}
                className={`label ${l.kind}${l.kind === 'alias' ? ' drag' : ''}${sel.labels.includes(l.id) ? ' sel' : ''}`}>{l.text}</text>
            </g>
          );
        })}
        <BiasOverlay td={td} />
        <MarkersLayer conn={conn} />
        {vdFirst && <MarkerGlyph x={vdFirst.x} y={vdFirst.y} text="V+" color="#808080" />}
        {tool.kind === 'marker' && tool.marker !== 'W' && (() => {
          const t = hint;
          const at = t?.p ?? cursor;
          return <g className="marker-ghost"><MarkerGlyph x={at.x} y={at.y} text={tool.marker === 'VD' ? (vdFirst ? 'V−' : 'V+') : tool.marker} color={t ? 'var(--marker)' : '#a0a0a0'} /></g>;
        })()}
        {tool.kind === 'place' && (
          <g transform={svgTransform({ ...cursor, rot: tool.rot, mirror: tool.mirror } as Part)} className="part ghost">
            <SymbolBody def={getDef(tool.partType)} />
          </g>
        )}
        {hint && ['wire', 'alias', 'junction', 'marker'].includes(tool.kind) && (
          <g className={`snap-ring ${hint.kind}`} pointerEvents="none">
            {hint.kind === 'pin' || hint.kind === 'end' ? <rect x={hint.p.x - 3} y={hint.p.y - 3} width={6} height={6} /> : <circle cx={hint.p.x} cy={hint.p.y} r={3.2} />}
          </g>
        )}
        {wirePts && (
          <g className="wire-preview">
            {wirePts.length > 0 && route(wirePts[wirePts.length - 1], cursor, hFirst).map((s, i) => <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} />)}
          </g>
        )}
        {drag?.kind === 'band' && (
          <rect className="band" x={Math.min(drag.start.x, drag.cur.x)} y={Math.min(drag.start.y, drag.cur.y)}
            width={Math.abs(drag.cur.x - drag.start.x)} height={Math.abs(drag.cur.y - drag.start.y)} />
        )}
        {tool.kind !== 'select' && <g className="crosshair"><line x1={cursor.x - 6} y1={cursor.y} x2={cursor.x + 6} y2={cursor.y} /><line x1={cursor.x} y1={cursor.y - 6} x2={cursor.x} y2={cursor.y + 6} /></g>}
      </g>
    </svg>
    </>
  );
}

/** A-size page frame in the PSpice Schematics style: blue border, 2×2 zone labels, edge centre arrows, title block. */
const PageBorder = memo(function PageBorder() {
  const title = useStore(s => s.doc.title);
  const m = 30, W = PAGE.w, H = PAGE.h, cx = W / 2, cy = H / 2;
  const tb = { w: 400, h: 96 }, tx = W - m - tb.w, ty = H - m - tb.h;
  const date = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <g className="page">
      <rect x={0} y={0} width={W} height={H} className="page-bg" />
      <rect x={m} y={m} width={W - 2 * m} height={H - 2 * m} className="page-inner" />
      {[['2', W * 0.25], ['1', W * 0.75]].map(([t, x]) => <g key={t as string}>
        <text x={x as number} y={m - 7} className="zone">{t}</text><text x={x as number} y={H - 6} className="zone">{t}</text></g>)}
      {[['B', H * 0.25], ['A', H * 0.75]].map(([t, y]) => <g key={t as string}>
        <text x={m / 2} y={(y as number) + 8} className="zone">{t}</text><text x={W - m / 2} y={(y as number) + 8} className="zone">{t}</text></g>)}
      <path className="page-arrow" d={`M${cx} 0 V${m} M${cx - 5} ${m - 9} L${cx} ${m} L${cx + 5} ${m - 9} Z M${cx} ${H} V${H - m} M${cx - 5} ${H - m + 9} L${cx} ${H - m} L${cx + 5} ${H - m + 9} Z M0 ${cy} H${m} M${m - 9} ${cy - 5} L${m} ${cy} L${m - 9} ${cy + 5} Z M${W} ${cy} H${W - m} M${W - m + 9} ${cy - 5} L${W - m} ${cy} L${W - m + 9} ${cy + 5} Z`} />
      <g className="titleblock">
        <rect x={tx} y={ty} width={tb.w} height={tb.h} />
        <path d={`M${tx} ${ty + 60} H${tx + tb.w} M${tx} ${ty + 78} H${tx + tb.w} M${tx + 300} ${ty} V${ty + 60}`} />
        <text x={tx + 6} y={ty + 12}>OpenSpice Schematics</text>
        <text x={tx + 6} y={ty + 24}>Title: {title}</text>
        <text x={tx + 306} y={ty + 12}>Page Size:  A</text>
        <text x={tx + 6} y={ty + 72}>Document Number:</text><text x={tx + 300} y={ty + 72}>Rev: 1</text>
        <text x={tx + 6} y={ty + 90}>Date: {date}</text><text x={tx + 300} y={ty + 90}>Page 1 of 1</text>
      </g>
    </g>
  );
});

function MarkersLayer({ conn }: { conn: Connectivity }) {
  const markers = useStore(s => s.doc.markers);
  const sel = useStore(s => s.sel.markers);
  const sim = useStore(s => s.sim);
  // Like PSpice: markers take the colour of their Probe trace once results are valid.
  const live = !!sim.result?.ok && !sim.stale && sim.source === 'schematic' && !sim.result.steps;
  return (
    <g>
      {markers.map((m, i) => {
        // a voltage marker that no longer sits on a wire or pin is shown grey (it produces no trace)
        const detached = (m.kind === 'V' || m.kind === 'VD') && (!conn.netAt(m) || (m.kind === 'VD' && !conn.netAt({ x: m.x2!, y: m.y2! })));
        const color = detached ? '#a0a0a0' : live ? traceColor(i) : 'var(--marker)';
        const s = sel.includes(m.id);
        if (m.kind === 'VD') return <g key={m.id}><MarkerGlyph x={m.x} y={m.y} text="V+" color={color} selected={s} /><MarkerGlyph x={m.x2!} y={m.y2!} text="V−" color={color} selected={s} /></g>;
        return <MarkerGlyph key={m.id} x={m.x} y={m.y} text={m.kind} color={color} selected={s} />;
      })}
    </g>
  );
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** PSpice-style bias point display: node voltages (V button) and part currents (I button).
 *  Labels are placed to avoid part text, part bodies, markers and each other; users can drag them. */
function BiasOverlay({ td }: { td: TextDrag }) {
  const showBiasV = useStore(s => s.showBiasV), showBiasI = useStore(s => s.showBiasI), doc = useStore(s => s.doc);
  const sim = useStore(s => s.sim);
  const op = sim.result?.plots.find(p => p.kind === 'op');
  const conn = useMemo(() => extractConnectivity(doc), [doc]);
  if (!op || sim.stale || (!showBiasV && !showBiasI)) return null;
  const obstacles: Box[] = [];
  for (const p of doc.parts) {
    if (getDef(p.type).isBubble) { const c = xf(p, 10, 0); obstacles.push({ x0: c.x - 6, y0: c.y - 14, x1: c.x + 10 + (p.props.LABEL ?? '').length * 5, y1: c.y + 6 }); continue; }
    if (getDef(p.type).isParam) { obstacles.push({ x0: p.x, y0: p.y - 9, x1: p.x + 75, y1: p.y + 10 * paramRows(p).length + 2 }); continue; }
    const L = partTextLayout(p);
    if (!getDef(p.type).isGround) obstacles.push(textBox(L.ref), textBox(L.val));
    const pp = pinPositions(p), c = xf(p, 20, 20);
    const xs = [...pp.map(q => q.x), getDef(p.type).pins.length === 2 && pp[0].y === pp[1].y ? pp[0].x : c.x];
    const ys = [...pp.map(q => q.y)];
    obstacles.push({ x0: Math.min(...xs) + 6, y0: Math.min(...ys) - 8, x1: Math.max(...xs) - 6, y1: Math.max(...ys) + 8 });
  }
  for (const m of doc.markers) { obstacles.push(markerBox(m)); if (m.kind === 'VD') obstacles.push(markerBox({ x: m.x2!, y: m.y2! })); }
  for (const l of doc.labels) obstacles.push({ x0: l.x + (l.off?.x ?? 0), y0: l.y - 11 + (l.off?.y ?? 0), x1: l.x + l.text.length * 5 + (l.off?.x ?? 0), y1: l.y + (l.off?.y ?? 0) });
  const placed: Box[] = [];
  const choose = (cands: Pt[], w: number): Pt => {
    let best = cands[0], score = Infinity;
    for (const c of cands) {
      const b = { x0: c.x, y0: c.y, x1: c.x + w, y1: c.y + 11 };
      const sc = obstacles.reduce((a, o) => a + overlap(b, o), 0) + 3 * placed.reduce((a, o) => a + overlap(b, o), 0);
      if (sc < score - 0.5) { score = sc; best = c; }
    }
    placed.push({ x0: best.x, y0: best.y, x1: best.x + w, y1: best.y + 11 });
    return best;
  };
  const offFor = (key: string) => {
    const o = doc.biasOff?.[key];
    const live = td?.target === `bias:${key}` ? td : null;
    return { x: (o?.x ?? 0) + (live?.dx ?? 0), y: (o?.y ?? 0) + (live?.dy ?? 0) };
  };
  const out = [];
  if (showBiasV) for (const n of conn.nets) {
    if (n.isGround || n.pins.length + n.wireIds.length === 0) continue;
    const vec = getVector(op, `v(${n.name})`);
    if (!vec) continue;
    const txt = `${formatEng(vec.re[0], 4)}V`, w = txt.length * 5.6 + 4;
    const cands: Pt[] = [];
    for (const id of n.wireIds) {
      const wi = doc.wires.find(x => x.id === id)!;
      for (const f of [0.5, 0.25, 0.75]) {
        const x = wi.a.x + (wi.b.x - wi.a.x) * f, y = wi.a.y + (wi.b.y - wi.a.y) * f;
        cands.push({ x: x - w / 2, y: y - 14 }, { x: x - w / 2, y: y + 3 }, { x: x + 4, y: y - 5.5 }, { x: x - w - 4, y: y - 5.5 });
      }
    }
    for (const pn of n.pins) cands.push({ x: pn.x + 3, y: pn.y - 14 }, { x: pn.x - w - 3, y: pn.y - 14 }, { x: pn.x + 3, y: pn.y + 3 });
    const at = choose(cands, w), key = `v:${n.name}`, o = offFor(key);
    out.push(<g key={key} className="drag" data-drag={`bias:${key}`} transform={`translate(${at.x + o.x} ${at.y + o.y})`}>
      <rect x={0} y={0} width={w} height={11} className="bias-box v" /><text x={2} y={8.5} className="bias v">{txt}</text></g>);
  }
  if (showBiasI) for (const p of doc.parts) {
    const def = getDef(p.type);
    if (def.isGround || def.isParam || def.isBubble) continue;
    const pin = def.pins[0].name;
    const cv = currentVector(p, 'EGFH'.includes(def.spiceLetter) ? '+' : pin, spiceNameFor(p));
    const vec = cv && getVector(op, cv.vec);
    if (!cv || !vec) continue;
    const pp = pinPositions(p)[0];
    const inward = xf(p, def.pins[0].x + (def.pins[1].x - def.pins[0].x) * 0.15, def.pins[0].y + (def.pins[1].y - def.pins[0].y) * 0.15);
    const dx = Math.sign(inward.x - pp.x), dy = Math.sign(inward.y - pp.y);
    const txt = `${formatEng(vec.re[0], 4)}A`, w = txt.length * 5.6 + 4;
    const at = choose([{ x: pp.x + (dy ? 6 : -12), y: pp.y + (dx ? 4 : -12) }, { x: pp.x - w - 6, y: pp.y - 12 }, { x: pp.x + 6, y: pp.y + 4 }, { x: pp.x - w / 2, y: pp.y - 26 }], w);
    const key = `i:${p.id}`, o = offFor(key);
    out.push(<g key={key}>
      <path d={`M${pp.x - dx * 6 - dy * 3} ${pp.y - dy * 6 + dx * 3} l${dx * 6} ${dy * 6}`} className="bias-arrow" markerEnd="url(#arrow)" />
      <g className="drag" data-drag={`bias:${key}`} transform={`translate(${at.x + o.x} ${at.y + o.y})`}>
        <rect x={0} y={0} width={w} height={11} className="bias-box i" /><text x={2} y={8.5} className="bias i">{txt}</text></g>
    </g>);
  }
  return <g><defs><marker id="arrow" viewBox="0 0 6 6" refX={5} refY={3} markerWidth={5} markerHeight={5} orient="auto"><path d="M0 0 L6 3 L0 6 Z" className="bias-arrowhead" /></marker></defs>{out}</g>;
}
