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
          <text x={L.ref.x + d('ref').dx} y={L.ref.y + d('ref').dy} className="ptext drag" data-drag={`ref:${p.id}`} textAnchor={L.ref.anchor}>{L.ref.text}</text>
          <text x={L.val.x + d('val').dx} y={L.val.y + d('val').dy} className="ptext drag" data-drag={`val:${p.id}`} textAnchor={L.val.anchor}>{L.val.text}</text>
        </>
      )}
    </g>
  );
});
