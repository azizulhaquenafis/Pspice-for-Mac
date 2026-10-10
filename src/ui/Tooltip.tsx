// Floating help below the mouse for any element with data-tip="Title|Description".
// Pointer events are used so disabled buttons (wrapped in .tbw) still show their help.
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';

export function Tooltip() {
  const [tip, setTip] = useState<{ title: string; desc: string; x: number; y: number } | null>(null);
  useEffect(() => {
    let cur: Element | null = null, timer = 0, shown = false, last = { x: 0, y: 0 };
    const place = (x: number, y: number) => ({ x: Math.min(x + 12, window.innerWidth - 290), y: y + 22 > window.innerHeight - 60 ? y - 60 : y + 22 });
    const show = () => {
      if (!cur) return;
      const [title, desc = ''] = (cur.getAttribute('data-tip') ?? '').split('|');
      shown = true;
      setTip({ title, desc, ...place(last.x, last.y) });
      if (cur.closest('.toolbar')) useStore.setState({ status: desc ? `${title}: ${desc}` : title });
    };
    const move = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      const el = (e.target as Element)?.closest?.('[data-tip]') ?? null;
      if (el !== cur) {
        cur = el; clearTimeout(timer); shown = false; setTip(null);
        if (el) timer = window.setTimeout(show, 350);
      } else if (shown) setTip(t => t && { ...t, ...place(e.clientX, e.clientY) });
    };
    const hide = () => { clearTimeout(timer); shown = false; cur = null; setTip(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', hide);
    window.addEventListener('blur', hide);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', hide); window.removeEventListener('blur', hide); };
  }, []);
  if (!tip) return null;
  return (
    <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      <b>{tip.title}</b>{tip.desc && <div>{tip.desc}</div>}
    </div>
  );
}
