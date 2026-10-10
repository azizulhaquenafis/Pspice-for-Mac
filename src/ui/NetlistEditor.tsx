// Netlist Mode workspace: a SPICE text editor (line numbers, SPICE-aware highlighting, find/replace,
// undo/redo) that simulates through the same engine as the schematic, with messages and the ngspice log.
import { useEffect, useRef, useState, Fragment, ReactNode } from 'react';
import { useStore } from '../state/store';
import * as A from '../state/actions';
import { formatEng } from '../core/units';

// ---- SPICE syntax highlighting (follows SPICE line rules, not a generic highlighter) ----
const KEYWORDS = /^(dc|ac|pulse|sin|pwl|exp|sffm|uic|list|param|dec|oct|lin|temp|tran|find|at|when|rise|fall|cross|trig|targ|val|td|avg|rms|max|min|pp|integ|deriv)$/i;
const DOT = /^\.(op|tran|dc|ac|param|model|subckt|ends|lib|inc|include|ic|nodeset|meas|measure|save|end|option|options|opt|temp|step|probe|print|plot|four|tf|sens|noise|func|global|csparam)$/i;

function highlightLine(line: string, idx: number): ReactNode {
  if (idx === 0) return <span className="hl-title">{line || ' '}</span>;
  const trimmed = line.trimStart();
  if (trimmed.startsWith('*')) return <span className="hl-comment">{line}</span>;
  // inline comment ($ or ;)
  let code = line, comment = '';
  const ci = line.search(/\s[$;]/);
  if (ci >= 0) { code = line.slice(0, ci); comment = line.slice(ci); }
  const parts: ReactNode[] = [];
  const re = /(\s+)|(\{[^}]*\})|([^\s(){}=,]+)|([(){}=,])/g;
  let m: RegExpExecArray | null, first = true, k = 0;
  const isCont = trimmed.startsWith('+');
  while ((m = re.exec(code))) {
    const [tok, ws, brace, word, punct] = m;
    if (ws) { parts.push(ws); continue; }
    let cls = '';
    if (brace) cls = 'hl-brace';
    else if (punct) cls = 'hl-punct';
    else if (first && !isCont) cls = word.startsWith('.') ? (DOT.test(word) ? 'hl-dot' : 'hl-bad') : /^[rclvidefghqmjksxbtwuo]/i.test(word) ? 'hl-dev' : 'hl-bad';
    else if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?[a-z]*$/i.test(word)) cls = 'hl-num';
    else if (KEYWORDS.test(word)) cls = 'hl-key';
    else if (word === '+' && isCont) cls = 'hl-dot';
    else cls = 'hl-node';
    if (!ws) first = false;
    parts.push(<span key={k++} className={cls}>{tok}</span>);
  }
  if (comment) parts.push(<span key="c" className="hl-comment">{comment}</span>);
  return parts.length ? parts : ' ';
}

export function NetlistWorkspace() {
  const cir = useStore(s => s.cir);
  const sim = useStore(s => s.sim);
  const measures = useStore(s => s.cirMeasures);
  const ta = useRef<HTMLTextAreaElement>(null);
  const hl = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState({ ln: 1, col: 1 });
  const [find, setFind] = useState<null | { q: string; r: string; cs: boolean; msg: string }>(null);
  const [tab, setTab] = useState<'msg' | 'log'>('msg');
  const lines = cir.text.split('\n');
  const last = sim.source === 'netlist' && sim.result ? sim.result : null;

  const syncScroll = () => {
    const t = ta.current; if (!t) return;
    if (hl.current) { hl.current.scrollTop = t.scrollTop; hl.current.scrollLeft = t.scrollLeft; }
    if (gutter.current) gutter.current.scrollTop = t.scrollTop;
  };
  const updateCaret = () => {
    const t = ta.current; if (!t) return;
    const before = t.value.slice(0, t.selectionStart);
    const ln = before.split('\n').length;
    setCaret({ ln, col: t.selectionStart - before.lastIndexOf('\n') });
  };
  useEffect(syncScroll, [cir.text]);

  const replaceRange = (a: number, b: number, text: string) => {
    const t = ta.current!; const v = t.value;
    A.setCirText(v.slice(0, a) + text + v.slice(b), true);
    requestAnimationFrame(() => { t.focus(); t.setSelectionRange(a + text.length, a + text.length); updateCaret(); });
  };
  const findNext = (from?: number) => {
    if (!find?.q) return false;
    const t = ta.current!; const hay = find.cs ? t.value : t.value.toLowerCase(), q = find.cs ? find.q : find.q.toLowerCase();
    let i = hay.indexOf(q, from ?? t.selectionEnd);
    if (i < 0) i = hay.indexOf(q, 0);
    if (i < 0) { setFind({ ...find, msg: 'Not found' }); return false; }
    t.focus(); t.setSelectionRange(i, i + q.length);
    const lineTop = (t.value.slice(0, i).split('\n').length - 1) * 18;
    if (lineTop < t.scrollTop || lineTop > t.scrollTop + t.clientHeight - 36) t.scrollTop = lineTop - 36;
    setFind({ ...find, msg: '' }); updateCaret(); syncScroll();
    return true;
  };
  const replaceOne = () => {
    const t = ta.current!; if (!find?.q) return;
    const sel = t.value.slice(t.selectionStart, t.selectionEnd);
    if ((find.cs ? sel : sel.toLowerCase()) === (find.cs ? find.q : find.q.toLowerCase()) && sel) {
      const a = t.selectionStart;
      replaceRange(a, t.selectionEnd, find.r);
      requestAnimationFrame(() => findNext(a + find.r.length));
    } else findNext();
  };
  const replaceAll = () => {
    if (!find?.q) return;
    const esc = find.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc, find.cs ? 'g' : 'gi');
    const n = (cir.text.match(re) ?? []).length;
    if (n) A.setCirText(cir.text.replace(re, () => find.r), true);
    setFind({ ...find, msg: `${n} replaced` });
  };
  // Make the find bar reachable from the Edit menu.
  useEffect(() => { netlistEditorHooks.openFind = () => setFind(f => f ?? { q: '', r: '', cs: false, msg: '' }); }, []);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (e.key === 'F11') { e.preventDefault(); A.simulateNetlist(); }
    else if (mod && key === 's') { e.preventDefault(); A.saveCir(e.shiftKey); }
    else if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? A.cirRedo() : A.cirUndo(); }
    else if (mod && key === 'y') { e.preventDefault(); A.cirRedo(); }
    else if (mod && (key === 'f' || key === 'h')) { e.preventDefault(); setFind(f => f ?? { q: '', r: '', cs: false, msg: '' }); }
    else if (e.key === 'F3') { e.preventDefault(); findNext(); }
    else if (e.key === 'Tab') { e.preventDefault(); const t = e.currentTarget; replaceRange(t.selectionStart, t.selectionEnd, '    '); }
    else if (e.key === 'Escape' && find) { e.preventDefault(); setFind(null); }
  };

  const provenance = cir.origin === 'generated' ? 'Generated from schematic (unmodified)' : cir.origin === 'edited' ? 'Edited copy of generated netlist — not linked to the schematic' : 'Independent netlist';
  return (
    <div className="cir-editor">
      {find && (
        <div className="findbar">
          <label>Find:</label><input autoFocus value={find.q} onChange={e => setFind({ ...find, q: e.target.value, msg: '' })} onKeyDown={e => { if (e.key === 'Enter') findNext(); if (e.key === 'Escape') setFind(null); }} />
          <label>Replace:</label><input value={find.r} onChange={e => setFind({ ...find, r: e.target.value })} onKeyDown={e => { if (e.key === 'Escape') setFind(null); }} />
          <label className="chk"><input type="checkbox" checked={find.cs} onChange={e => setFind({ ...find, cs: e.target.checked })} />Match case</label>
          <button onClick={() => findNext()}>Find Next</button><button onClick={replaceOne}>Replace</button><button onClick={replaceAll}>Replace All</button>
          <span className="muted">{find.msg}</span><button className="dlg-x" onClick={() => setFind(null)} aria-label="Close find">×</button>
        </div>
      )}
      <div className="cir-body">
        <div className="cir-gutter" ref={gutter}>{lines.map((_, i) => <div key={i} className={caret.ln === i + 1 ? 'cur' : ''}>{i + 1}</div>)}</div>
        <div className="cir-stack">
          <pre className="cir-hl" ref={hl} aria-hidden="true">{lines.map((l, i) => <Fragment key={i}>{highlightLine(l, i)}{'\n'}</Fragment>)}</pre>
          <textarea ref={ta} className="cir-text" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={cir.text} aria-label="Netlist text"
            onChange={e => { A.setCirText(e.target.value); updateCaret(); }} onKeyDown={onKey} onKeyUp={updateCaret} onClick={updateCaret} onSelect={updateCaret} onScroll={syncScroll} />
        </div>
      </div>
      <div className="cir-out">
        <div className="tabs"><button className={tab === 'msg' ? 'on' : ''} onClick={() => setTab('msg')}>Messages</button><button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>ngspice Log</button></div>
        <div className="cir-messages">
          {tab === 'log' ? <pre>{last?.log || 'No log yet.'}</pre> : <>
            {!last && <span className="muted">Line 1 is the title. Press Run (F11). Supported: R C L V I D E F G H S K X Q M devices, .PARAM .MODEL .SUBCKT/.ENDS .IC .NODESET .OPTIONS .TEMP .SAVE .MEAS, analyses .OP .TRAN .DC .AC, .STEP PARAM/TEMP. IC= works PSpice-style.</span>}
            {last && <>
              {last.errors.map((e, i) => <div key={'e' + i} className="err">ERROR: {e}</div>)}
              {sim.notes.map((n, i) => <div key={'n' + i} className="note">Note: {n}</div>)}
              {(() => { // bias point listing, like the NODE VOLTAGE / current tables of a PSpice .out file
                const op = last.plots.find(p => p.kind === 'op');
                if (!op) return null;
                const vs = op.vectors.filter(v => /^v\(/i.test(v.name) && !v.name.includes('__'));
                const is = op.vectors.filter(v => /^i\(/i.test(v.name) && !v.name.includes('__'));
                return <div className="opbox">
                  <b>Bias point{last.steps ? ` (${last.steps[0]?.label})` : ''}:</b>{' '}
                  {vs.map(v => <span key={v.name} className="opv">{v.name.toUpperCase()} = {formatEng(v.re[0], 5)}V</span>)}
                  {is.map(v => <span key={v.name} className="opi">{v.name.replace(/^i\(@?([^[)]+).*$/i, (_, n) => `I(${n.toUpperCase()})`)} = {formatEng(v.re[0], 5)}A</span>)}
                </div>;
              })()}
              {measures.map((m, i) => <div key={'m' + i} className="meas">{m.step ? `${m.step}: ` : ''}{m.name.toUpperCase()} = {formatEng(m.value, 6)}</div>)}
              {last.ok && <div className="ok-msg">Simulation complete — {(last.steps ? `${last.steps.length} .STEP runs; ` : '') + last.plots.map(p => p.title).join(', ')}</div>}
            </>}
          </>}
        </div>
      </div>
      <div className="statusbar cir-status">
        <span className="sb grow">{provenance}{cir.dirty ? ' — modified' : ''}</span>
        <span className="sb">{cir.fileName ?? 'untitled.cir'}</span>
        <span className="sb">Ln {caret.ln}, Col {caret.col}</span>
        <span className="sb">{lines.length} lines</span>
      </div>
    </div>
  );
}

export const netlistEditorHooks = { openFind: () => {} };
