// Component values as actually simulated, recovered from a run's netlist ({params} resolved).
import { evalExpr, isBraced, unbrace } from '../core/params';
import { parseSpiceNumber, formatEng } from '../core/units';

export interface ComponentRow { name: string; nodes: string; value: string }
const UNIT: Record<string, string> = { r: 'Ω', c: 'F', l: 'H', v: 'V', i: 'A' };

export function deckComponents(deck: string): ComponentRow[] {
  // Two-pass / multi-run decks: use the last "pass" (the one that produced the waveforms).
  const parts = deck.split(/^\* Pass 2:.*$/m);
  const text = parts[parts.length - 1];
  const env = new Map<string, number>();
  for (const m of text.matchAll(/^\s*\.param\s+(.+)$/gim)) {
    for (const kv of m[1].matchAll(/(\w+)\s*=\s*(\{[^}]*\}|\S+)/g)) {
      try { env.set(kv[1].toLowerCase(), isBraced(kv[2]) ? evalExpr(unbrace(kv[2]), n => env.get(n.toLowerCase()) ?? NaN) : parseSpiceNumber(kv[2]).value); } catch { /* keep going */ }
    }
  }
  const models = new Map<string, string>();
  for (const m of text.matchAll(/^\s*\.model\s+(\S+)\s+(.+)$/gim)) models.set(m[1].toLowerCase(), m[2]);
  const pwl = new Map<string, string>();
  for (const m of text.matchAll(/^\s*V(__sw_\S+)\s+\S+\s+\S+\s+PWL\(([^)]*)\)/gim)) pwl.set(m[1].toLowerCase(), m[2]);
  const rows: ComponentRow[] = [];
  const seen = new Set<string>();
  const lines = text.split('\n');
  // the first line of a deck is its title, unless this is the second pass (which starts after the marker line)
  const first = parts.length > 1 ? -1 : lines.findIndex(l => l.trim());
  for (const [idx, raw] of lines.entries()) {
    const l = raw.trim();
    if (idx === first || !l || '*.+;'.includes(l[0])) continue;
    const t = l.split(/\s+/);
    if (t.length < 3 || !/^[rclvidefghsxqmjkb]/i.test(t[0])) continue;
    const k = t[0][0].toLowerCase();
    if (t[0].includes('__') || seen.has(t[0].toLowerCase())) continue;
    seen.add(t[0].toLowerCase());
    let value = t.slice(3).join(' ');
    if ('rcl'.includes(k) && t[3]) {
      const v = isBraced(t[3]) ? (() => { try { return evalExpr(unbrace(t[3]), n => { const x = env.get(n.toLowerCase()); if (x === undefined) throw new Error(n); return x; }); } catch { return NaN; } })() : parseSpiceNumber(t[3]).value;
      value = `${isFinite(v) ? formatEng(v, 5) + UNIT[k] : t[3]}${isBraced(t[3]) ? `  (${t[3]})` : ''}${t.slice(4).join(' ') ? '  ' + t.slice(4).join(' ') : ''}`;
    } else if (k === 's') {
      const md = models.get((t[5] ?? '').toLowerCase()) ?? '';
      const ctl = pwl.get((t[3] ?? '').toLowerCase());
      value = `switch ${md}${ctl ? `, control PWL(${ctl})` : ''}`;
    }
    rows.push({ name: t[0], nodes: k === 's' ? t.slice(1, 3).join(' ') : t.slice(1, 3).join(' '), value });
  }
  return rows;
}
