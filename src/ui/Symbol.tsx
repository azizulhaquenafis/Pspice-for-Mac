import { memo } from 'react';
import { Part } from '../core/model';
import { getDef, svgTransform, xf, PartDef } from '../core/library';

export function SymbolBody({ def }: { def: PartDef }) {
  return (
    <>
      {def.paths.map((d, i) => <path key={i} d={d} fill="none" />)}
      {def.fills?.map((d, i) => <path key={'f' + i} d={d} className="fill" />)}
      {def.circles?.map((c, i) => <circle key={'c' + i} cx={c.cx} cy={c.cy} r={c.r} fill="none" />)}
      {def.texts?.map((t, i) => <text key={'t' + i} x={t.x} y={t.y} fontSize={t.size ?? 8} className="glyph" textAnchor="middle">{t.t}</text>)}
    </>
  );
}

function textFor(p: Part, def: PartDef): string {
  if (!def.valueProp) return '';
  const v = p.props[def.valueProp] ?? '';
  if (p.type === 'VDC' || p.type === 'IDC') return v;
  if (p.type === 'VSIN') return `VOFF=${p.props.VOFF} VAMPL=${v} FREQ=${p.props.FREQ}`;
  if (p.type === 'VPULSE') return `V1=${p.props.V1} V2=${v}`;
  if (p.type === 'VAC') return `${v}`;
  if (['E', 'F', 'G', 'H'].includes(p.type)) return `GAIN=${v}`;
  if (p.type === 'Sw_tOpen') return `tOpen=${v}`;
  if (p.type === 'Sw_tClose') return `tClose=${v}`;
  return v;
}

export function paramRows(p: Part): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 1; i <= 3; i++) { const n = p.props[`NAME${i}`]?.trim(), v = p.props[`VALUE${i}`]?.trim(); if (n || v) out.push([n ?? '', v ?? '']); }
  return out;
}

export interface TextPos { x: number; y: number; anchor: 'start' | 'middle' | 'end'; text: string }

/** Where a part's reference and value text go (including manual offsets). Shared with label collision avoidance. */
export function partTextLayout(p: Part): { ref: TextPos; val: TextPos } {
  const def = getDef(p.type);
  const anchor = (a: { x: number; y: number }) => xf(p, a.x, a.y);
  // keep labels outside rotated parts: for vertical orientation of horizontal parts, put text to the right
  const vertical = p.rot % 2 === 1;
  const horizSym = def.pins.length === 2 && def.pins[1].y === 0;
  // Vertical placement of a horizontal symbol: put text beside it, on the side away from the symbol's
  // "top" (where arrows/decorations are drawn), so text never overlaps the geometry.
  const topDir = xf(p, 0, -1).x - xf(p, 0, 0).x; // +1: symbol top faces right
  const side = topDir > 0 ? -1 : 1;
  const sideAl = side > 0 ? 'start' as const : 'end' as const;
  const rp = vertical && horizSym ? { ...xf(p, 20, 0), dx: 8 * side, al: sideAl, dy: -4 } : { ...anchor(def.refPos), dx: 0, al: def.refPos.align, dy: 0 };
  const vp = vertical && horizSym ? { ...xf(p, 20, 0), dx: 8 * side, al: sideAl, dy: 9 } : { ...anchor(def.valPos), dx: 0, al: def.valPos.align, dy: 0 };
  // transistors at 180°: keep the reference above the model name (the anchors swap when turned over)
  if (def.body && rp.y > vp.y) { const t = rp.y; rp.y = vp.y; vp.y = t; }
  if (def.body && vertical) {
    // Transistors turned 90°/270°: put the reference/model text beside the body on a side without pin
    // leads (text stays upright; both lines stacked so they never overlap each other or the symbol).
    const c = [xf(p, def.body[0], def.body[1]), xf(p, def.body[2], def.body[3])];
    const x0 = Math.min(c[0].x, c[1].x), x1 = Math.max(c[0].x, c[1].x), y0 = Math.min(c[0].y, c[1].y), y1 = Math.max(c[0].y, c[1].y);
    const cx = (x0 + x1) / 2;
    // each pin's lead (and the wire leaving it) runs outward along the dominant axis from the body centre
    const bx = (def.body[0] + def.body[2]) / 2, by = (def.body[1] + def.body[3]) / 2;
    const leads = def.pins.map(q => {
      const dx = q.x - bx, dy = q.y - by, d = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
      const a = xf(p, q.x, q.y), e = xf(p, q.x + d.x * 14, q.y + d.y * 14);
      return { x0: Math.min(a.x, e.x), x1: Math.max(a.x, e.x), y0: Math.min(a.y, e.y), y1: Math.max(a.y, e.y) };
    });
    const ref = p.ref, val = textFor(p, def);
    const cands: [number, number, 'start' | 'end'][] = [[cx + 3, y0 - 13, 'start'], [cx - 3, y0 - 13, 'end'], [cx + 3, y1 + 9, 'start'], [cx - 3, y1 + 9, 'end'],
      [x1 + 16, y0 + 4, 'start'], [x0 - 16, y0 + 4, 'end']];
    const hit = (b: { x0: number; y0: number; x1: number; y1: number }, r: { x0: number; y0: number; x1: number; y1: number }) =>
      b.x0 < r.x1 + 2 && b.x1 > r.x0 - 2 && b.y0 < r.y1 + 2 && b.y1 > r.y0 - 2;
    const clear = ([x, y, al]: [number, number, 'start' | 'end']) => [ref, val].every((t, i) => {
      const b = textBox({ x, y: y + 9 * i, anchor: al, text: t });
      return !leads.some(l => hit(b, l)) && !hit(b, { x0: x0 + 2, y0: y0 + 2, x1: x1 - 2, y1: y1 - 2 });
    });
    const [x, y, al] = cands.find(clear) ?? cands[0];
    const o = (k: 'refOff' | 'valOff') => ({ x: p[k]?.x ?? 0, y: p[k]?.y ?? 0 });
    return {
      ref: { x: x + o('refOff').x, y: y + o('refOff').y, anchor: al, text: ref },
      val: { x: x + o('valOff').x, y: y + 9 + o('valOff').y, anchor: al, text: val },
    };
  }
  const flipAlign = (al: 'start' | 'middle' | 'end') => (!horizSym || !vertical) && (p.rot === 2) !== p.mirror && al !== 'middle' ? (al === 'start' ? 'end' : 'start') : al;
  return {
    ref: { x: rp.x + rp.dx + (p.refOff?.x ?? 0), y: rp.y + rp.dy + (p.refOff?.y ?? 0), anchor: flipAlign(rp.al), text: p.ref },
    val: { x: vp.x + vp.dx + (p.valOff?.x ?? 0), y: vp.y + vp.dy + (p.valOff?.y ?? 0), anchor: flipAlign(vp.al), text: textFor(p, def) },
  };
}

/** Approximate box of an 8px text (for collision avoidance). */
export function textBox(t: TextPos, charW = 4.6, h = 8) {
  const w = t.text.length * charW;
  const x0 = t.anchor === 'start' ? t.x : t.anchor === 'middle' ? t.x - w / 2 : t.x - w;
  return { x0, y0: t.y - h, x1: x0 + w, y1: t.y + 1 };
}

/** Stroke colour comes from CSS (.part / .part.sel). Text stays upright regardless of rotation. */
/** dragText: live offset while the user drags this part's ref/value text. */
export const PartView = memo(function PartView({ p, selected, dragText }: { p: Part; selected: boolean; dragText?: { which: 'ref' | 'val'; dx: number; dy: number } }) {
  const def = getDef(p.type);
  const L = partTextLayout(p);
  const d = (w: 'ref' | 'val') => dragText?.which === w ? dragText : { dx: 0, dy: 0 };
  if (def.isParam) {
    const rows = paramRows(p);
    return (
      <g className={`part param${selected ? ' sel' : ''}`} data-part={p.id}>
        <text x={p.x} y={p.y} className="ptext ptitle">PARAMETERS:</text>
        {!rows.length && <text x={p.x + 8} y={p.y + 10} className="ptext muted-t">(double-click to define)</text>}
        {rows.map(([n, v], i) => <text key={i} x={p.x + 8} y={p.y + 10 * (i + 1)} className="ptext">{n}{'\u00a0\u00a0\u00a0'}{v}</text>)}
      </g>
    );
  }
  return (
    <g className={`part${selected ? ' sel' : ''}`} data-part={p.id}>
      <g transform={svgTransform(p)}><SymbolBody def={def} /></g>
      {def.isBubble ? (
        <text x={xf(p, 10, 0).x + 7 + (p.valOff?.x ?? 0)} y={xf(p, 10, 0).y - 5 + (p.valOff?.y ?? 0)} className="bubble-label drag" data-drag={`val:${p.id}`}>{p.props.LABEL || '?'}</text>
      ) : def.isGround ? (
        <text x={xf(p, 0, 30).x} y={xf(p, 0, 30).y} className="ptext" textAnchor="middle">0</text>
      ) : (
        <>
          {!p.hide?.ref && <text x={L.ref.x + d('ref').dx} y={L.ref.y + d('ref').dy} className="ptext drag" data-drag={`ref:${p.id}`} textAnchor={L.ref.anchor}>{L.ref.text}</text>}
          {!p.hide?.val && <text x={L.val.x + d('val').dx} y={L.val.y + d('val').dy} className="ptext drag" data-drag={`val:${p.id}`} textAnchor={L.val.anchor}>{L.val.text}</text>}
        </>
      )}
    </g>
  );
});
