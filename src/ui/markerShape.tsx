// PSpice Schematics probe marker: a scalloped "bubble" holding the marker letter (V, I, W, V+, V−),
// placed up-right of the node and joined by a diagonal lead to an open triangular arrowhead whose tip
// touches the marked node/pin. Geometry measured from the user's PSpice 9.1 reference screenshot
// (scaled to sit in proportion with OpenSpice parts: bubble centre 3 grid steps up-right of the tip).
import { Pt } from '../core/model';

export const MARKER = { dx: 30, dy: -30, r: 6, bumps: 11, head: 10, halfW: 3.8 } as const;
const U = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };          // unit vector tip → bubble
const N = { x: Math.SQRT1_2, y: Math.SQRT1_2 };           // normal to it
const f = (v: number) => Math.round(v * 100) / 100;

/** Scalloped circle outline: arcs bulging outward between points on the circle. */
function scallop(cx: number, cy: number): string {
  const { r, bumps } = MARKER;
  const pts = Array.from({ length: bumps }, (_, k) => {
    const a = (2 * Math.PI * k) / bumps;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];   // increasing angle = clockwise on screen
  });
  const chord = 2 * r * Math.sin(Math.PI / bumps), br = chord * 0.62;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let k = 1; k <= bumps; k++) { const [x, y] = pts[k % bumps]; d += ` A${f(br)} ${f(br)} 0 0 1 ${f(x)} ${f(y)}`; }
  return d + ' Z';
}

/** Marker glyph with its tip at (x, y). */
export function MarkerGlyph({ x, y, text, color, selected }: { x: number; y: number; text: string; color: string; selected?: boolean }) {
  const { dx, dy, r, head, halfW } = MARKER;
  const cx = x + dx, cy = y + dy;
  const bx = x + head * U.x, by = y + head * U.y;            // centre of the arrowhead base
  const tri = `M${x} ${y} L${f(bx + halfW * N.x)} ${f(by + halfW * N.y)} L${f(bx - halfW * N.x)} ${f(by - halfW * N.y)} Z`;
  const lead = `M${f(bx)} ${f(by)} L${f(cx - (r + 1) * U.x)} ${f(cy - (r + 1) * U.y)}`;
  return (
    <g className={`marker${selected ? ' sel' : ''}`} style={{ color }}>
      <path d={lead} className="mk-line" />
      <path d={tri} className="mk-shape" />
      <path d={scallop(cx, cy)} className="mk-shape" />
      <text x={cx} y={cy + (text.length > 1 ? 2 : 2.4)} textAnchor="middle" className={`marker-t${text.length > 1 ? ' small' : ''}`}>{text}</text>
    </g>
  );
}

/** Is world point w on the marker whose tip is at m? */
export function markerHit(m: Pt, w: Pt): boolean {
  const cx = m.x + MARKER.dx, cy = m.y + MARKER.dy;
  if (Math.hypot(w.x - cx, w.y - cy) <= MARKER.r + 3) return true;
  // along the lead/arrow (distance to the diagonal segment from the tip to the bubble)
  const t = ((w.x - m.x) * U.x + (w.y - m.y) * U.y);
  const len = Math.hypot(MARKER.dx, MARKER.dy) - MARKER.r;
  if (t < 2 || t > len) return false;
  return Math.abs((w.x - m.x) * N.x + (w.y - m.y) * N.y) <= 4;
}

/** Bounding box (for keeping bias labels clear of markers). */
export function markerBox(m: Pt) {
  return { x0: m.x, y0: m.y + MARKER.dy - MARKER.r - 2, x1: m.x + MARKER.dx + MARKER.r + 2, y1: m.y };
}
