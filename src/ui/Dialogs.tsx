import { useState, ReactNode, useMemo } from 'react';
import { useStore } from '../state/store';
import { LIBRARY, getDef } from '../core/library';
import { SymbolBody } from './Symbol';
import { parseSpiceNumber, formatEng } from '../core/units';
import { isBraced, unbrace, tokenize } from '../core/params';
import { currentVector } from '../core/netlist';
import { newId, SimProfile } from '../core/model';
import { createNetlist, download, simulate, schematicToNetlistEditor } from '../state/actions';

export function Dialog({ title, children, onClose, width = 360, buttons }: { title: string; children: ReactNode; onClose: () => void; width?: number; buttons?: ReactNode }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label={title} style={{ width }} onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <div className="dlg-title">{title}<button className="dlg-x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="dlg-body">{children}</div>
        {buttons && <div className="dlg-buttons">{buttons}</div>}
      </div>
    </div>
  );
}

const close = () => useStore.getState().setDialog(null);

export function PartBrowser() {
  const [q, setQ] = useState('');
  const [selName, setSelName] = useState('R');
  const list = useMemo(() => LIBRARY.filter(d => (d.name + ' ' + d.description).toLowerCase().includes(q.toLowerCase())), [q]);
  const def = getDef(list.find(d => d.name === selName)?.name ?? list[0]?.name ?? 'R');
  const place = (name = def.name) => { useStore.getState().setTool({ kind: 'place', partType: name, rot: 0, mirror: false }); close(); };
  return (
    <Dialog title="Part Browser Basic" onClose={close} width={460} buttons={<>
      <button className="default" onClick={() => place()}>Place &amp; Close</button><button onClick={close}>Close</button></>}>
      <div className="row"><label>Part Name:</label><input autoFocus value={q} onChange={e => { setQ(e.target.value); const m = LIBRARY.find(d => d.name.toLowerCase() === e.target.value.toLowerCase()); if (m) setSelName(m.name); }}
        onKeyDown={e => { if (e.key === 'Enter' && list.length) place(list.find(d => d.name === selName)?.name ?? list[0].name); }} /></div>
      <div className="row"><label>Description:</label><span className="desc">{def.description}</span></div>
      <div className="pb">
        <div className="listbox" style={{ height: 220, width: 190 }}>
          {list.map(d => <div key={d.name} className={`li${d.name === def.name ? ' on' : ''}`} onClick={() => setSelName(d.name)} onDoubleClick={() => place(d.name)}>{d.name}</div>)}
        </div>
        <div className="pb-preview">
          <svg viewBox="-30 -30 110 100" width={200} height={180} className="preview">
            <g className="part"><SymbolBody def={def} /></g>
          </svg>
          <div className="muted">Library: {def.category}<br />Pins: {def.pins.map(p => p.name).join(', ')}</div>
        </div>
      </div>
    </Dialog>
  );
}

function NumField({ value, onChange, unit, optional }: { value: string; onChange: (v: string) => void; unit?: string; optional?: boolean }) {
  const braced = isBraced(value);
  let exprErr = '';
  if (braced) { try { tokenize(unbrace(value)); } catch (e) { exprErr = (e as Error).message; } }
  const r = value.trim() === '' || braced ? null : parseSpiceNumber(value);
  const bad = (r && !r.ok) || (!optional && value.trim() === '') || !!exprErr;
  return (
    <span className="numfield">
      <input className={bad ? 'bad' : ''} value={value} onChange={e => onChange(e.target.value)} />
      <span className="hint">{braced ? (exprErr || 'parameter expression') : r ? (r.ok ? `= ${formatEng(r.value, 5)}${unit ?? ''}${r.warning ? ' ⚠ ' + r.warning : ''}` : r.error) : optional ? '(optional)' : 'required'}</span>
    </span>
  );
}

export function PropertiesDialog({ partId }: { partId: string }) {
  const part = useStore(s => s.doc.parts.find(p => p.id === partId));
  const [ref, setRef] = useState(part?.ref ?? '');
  const [props, setProps] = useState<Record<string, string>>({ ...(part?.props ?? {}) });
  if (!part) return null;
  const def = getDef(part.type);
  const errs = def.props.filter(pd => {
    const v = (props[pd.name] ?? '').trim();
    if (!v) return !pd.optional;
    if (pd.kind === 'num' && isBraced(v)) { try { tokenize(unbrace(v)); return false; } catch { return true; } }
    return pd.kind === 'num' && !parseSpiceNumber(v).ok;
  });
  const refBad = !def.isGround && !def.isParam && !def.isBubble && !/^[A-Za-z][A-Za-z0-9_]*$/.test(ref);
  const dup = useStore.getState().doc.parts.some(p => p.id !== partId && p.ref.toUpperCase() === ref.toUpperCase() && ref);
  const ok = () => {
    if (errs.length || refBad || dup) return;
    useStore.getState().commit(d => ({ ...d, parts: d.parts.map(p => p.id === partId ? { ...p, ref, props } : p) }), `${ref} attributes changed`);
    close();
  };
  return (
    <Dialog title={`${part.type}  —  ${part.ref}`} onClose={close} width={460} buttons={<>
      <button className="default" disabled={!!errs.length || refBad || dup} onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
      <form onSubmit={e => { e.preventDefault(); ok(); }}>
        <table className="attr">
          <tbody>
            {!def.isGround && !def.isParam && !def.isBubble && <tr><td>REFDES</td><td><input value={ref} className={refBad || dup ? 'bad' : ''} onChange={e => setRef(e.target.value)} />{dup && <span className="hint">duplicate</span>}</td></tr>}
            {def.props.map(pd => (
              <tr key={pd.name} title={pd.help}>
                <td>{pd.name}{pd.help && <span className="muted"> ({pd.help})</span>}</td>
                <td>{pd.kind === 'num'
                  ? <NumField value={props[pd.name] ?? ''} unit={pd.unit} optional={pd.optional} onChange={v => setProps({ ...props, [pd.name]: v })} />
                  : <input style={{ width: 220 }} value={props[pd.name] ?? ''} onChange={e => setProps({ ...props, [pd.name]: e.target.value })} />}</td>
              </tr>
            ))}
            {def.props.length === 0 && <tr><td colSpan={2} className="muted">This part has no editable attributes.{def.models ? ' Model: ' + def.models[0].split(' ')[1] : ''}</td></tr>}
          </tbody>
        </table>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function LabelDialog({ labelId, at, mode }: { labelId?: string; at?: { x: number; y: number }; mode: 'alias' | 'text' }) {
  const label = useStore(s => s.doc.labels.find(l => l.id === labelId));
  const [text, setText] = useState(label?.text ?? '');
  const bad = mode === 'alias' ? !/^[A-Za-z0-9_]+$/.test(text) : !text.trim();
  const ok = () => {
    if (bad) return;
    useStore.getState().commit(d => label
      ? { ...d, labels: d.labels.map(l => l.id === label.id ? { ...l, text } : l) }
      : { ...d, labels: [...d.labels, { id: newId('l'), x: at!.x, y: at!.y, text, kind: mode }] }, mode === 'alias' ? `Net alias ${text}` : 'Text placed');
    close();
  };
  return (
    <Dialog title={mode === 'alias' ? 'Set Attribute Value — LABEL' : 'Text'} onClose={close} width={320} buttons={<>
      <button className="default" disabled={bad} onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
      <form onSubmit={e => { e.preventDefault(); ok(); }}>
        <div className="row"><label>{mode === 'alias' ? 'LABEL' : 'Text'}</label><input autoFocus value={text} onChange={e => setText(e.target.value)} /></div>
        {mode === 'alias' && <div className="muted">Net alias names the net (letters, digits, _). Use "0" for ground. Nets with the same alias are connected.</div>}
      </form>
    </Dialog>
  );
}

// ---------- Analysis Setup ----------
type ProfKey = 'tran' | 'dc' | 'ac';
import { sweepValues } from '../sim/parametric';
const setProf = (fn: (p: SimProfile) => SimProfile) => useStore.getState().commit(d => ({ ...d, profile: fn(d.profile) }), 'Analysis setup changed');

export function AnalysisSetup() {
  const prof = useStore(s => s.doc.profile);
  const st = useStore.getState();
  type Row = { label: string; key?: ProfKey | 'param'; open?: () => void; check?: boolean | null; fixed?: boolean };
  const tog = (k: ProfKey | 'param') => setProf(p => ({ ...p, [k]: { ...p[k], enabled: !p[k].enabled } }));
  // Layout follows the PSpice 9.1 Schematics Analysis Setup dialog (two columns, Close at the top right).
  const left: Row[] = [
    { label: 'AC Sweep...', key: 'ac', open: () => st.setDialog('ac') },
    { label: 'Load Bias Point...', check: false },
    { label: 'Save Bias Point...', check: false },
    { label: 'DC Sweep...', key: 'dc', open: () => st.setDialog('dc') },
    { label: 'Monte Carlo/Worst Case...', check: false },
    { label: 'Bias Point Detail', check: true, fixed: true },
    { label: 'Digital Setup...', check: null },
  ];
  const right: Row[] = [
    { label: 'Options...', check: null },
    { label: 'Parametric...', key: 'param', open: () => st.setDialog('param') },
    { label: 'Sensitivity...', check: false },
    { label: 'Temperature...', check: false },
    { label: 'Transfer Function...', check: false },
    { label: 'Transient...', key: 'tran', open: () => st.setDialog('tran') },
  ];
  const cell = (r: Row) => {
    const avail = !!r.key || r.fixed;
    const checked = r.key ? prof[r.key].enabled : !!r.check;
    return (
      <div key={r.label} className={`as-row${avail ? '' : ' na'}`} data-tip={avail ? undefined : `${r.label.replace('...', '')}|Not yet available in this version`}>
        <span className="as-chk">{r.check !== null && <input type="checkbox" aria-label={`Enable ${r.label}`} disabled={!r.key} checked={checked} onChange={() => r.key && tog(r.key)} />}</span>
        <button disabled={!r.open} onClick={() => r.open?.()}>{r.label}</button>
      </div>
    );
  };
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="dialog" role="dialog" aria-label="Analysis Setup" style={{ width: 470 }} onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
        <div className="dlg-title">Analysis Setup<button className="dlg-x" onClick={close} aria-label="Close">×</button></div>
        <div className="dlg-body as-body">
          <div className="as-col"><div className="as-head">Enabled</div>{left.map(cell)}</div>
          <div className="as-col"><div className="as-head">Enabled</div>{right.map(cell)}</div>
          <div className="as-close"><button className="default" onClick={close}>Close</button></div>
        </div>
      </div>
    </div>
  );
}

export function ParamDialog() {
  const p = useStore(s => s.doc.profile.param);
  const [v, setV] = useState(p);
  const params = useStore(s => s.doc.parts.flatMap(q => getDef(q.type).isParam ? [1, 2, 3].map(i => q.props[`NAME${i}`]?.trim()).filter(Boolean) as string[] : []));
  const srcs = useStore(s => s.doc.parts.filter(q => ['V', 'I'].includes(getDef(q.type).spiceLetter)).map(q => q.ref));
  const sv = sweepValues(v);
  const back = () => useStore.getState().setDialog('analysis');
  const ok = () => { if (sv.error) return; setProf(pp => ({ ...pp, param: { ...v, enabled: true } })); back(); };
  const radio = (label: string, on: boolean, set: (() => void) | null) =>
    <label key={label} className={`chk${set ? '' : ' na'}`}><input type="radio" checked={on} disabled={!set} onChange={() => set?.()} /> {label}{set ? '' : ''}</label>;
  return (
    <Dialog title="Parametric" onClose={back} width={460} buttons={<>
      <button className="default" disabled={!!sv.error} onClick={ok}>OK</button><button onClick={back}>Cancel</button></>}>
      <div className="dc-grid">
        <fieldset><legend>Swept Var. Type</legend>
          {radio('Voltage Source', v.varType === 'source', () => setV({ ...v, varType: 'source' }))}
          {radio('Temperature', v.varType === 'temp', () => setV({ ...v, varType: 'temp' }))}
          {radio('Current Source', false, () => setV({ ...v, varType: 'source' }))}
          {radio('Model Parameter', false, null)}
          {radio('Global Parameter', v.varType === 'global', () => setV({ ...v, varType: 'global' }))}
        </fieldset>
        <fieldset><legend>Sweep Type</legend>
          {radio('Linear', v.sweep === 'lin', () => setV({ ...v, sweep: 'lin' }))}
          {radio('Octave', v.sweep === 'oct', () => setV({ ...v, sweep: 'oct' }))}
          {radio('Decade', v.sweep === 'dec', () => setV({ ...v, sweep: 'dec' }))}
          {radio('Value List', v.sweep === 'list', () => setV({ ...v, sweep: 'list' }))}
        </fieldset>
      </div>
      <div className="row"><label>Name:</label>
        <input list="param-names" disabled={v.varType === 'temp'} value={v.varType === 'temp' ? '' : v.name} onChange={e => setV({ ...v, name: e.target.value })} />
        <datalist id="param-names">{(v.varType === 'global' ? params : srcs).map(n => <option key={n} value={n} />)}</datalist>
        {v.varType === 'global' && !params.some(n => n.toLowerCase() === v.name.trim().toLowerCase()) && <span className="hint">⚠ not in a PARAMETERS block</span>}
      </div>
      <div className="row na"><label>Model Type:</label><input disabled /></div>
      <div className="row na"><label>Model Name:</label><input disabled /></div>
      <div className="row na"><label>Param. Name:</label><input disabled /></div>
      {v.sweep === 'list' ? (
        <div className="row"><label>Values:</label><input style={{ flex: 1 }} value={v.values} onChange={e => setV({ ...v, values: e.target.value })} placeholder="e.g. 1 10 50 100 220" /></div>
      ) : <>
        <Field label="Start Value:" value={v.start} onChange={x => setV({ ...v, start: x })} />
        <Field label="End Value:" value={v.end} onChange={x => setV({ ...v, end: x })} />
        <Field label={v.sweep === 'lin' ? 'Increment:' : v.sweep === 'dec' ? 'Pts/Decade:' : 'Pts/Octave:'} value={v.incr} onChange={x => setV({ ...v, incr: x })} />
      </>}
      <div className={sv.error ? 'trace-err' : 'muted'}>{sv.error ?? `${sv.values.length} run(s): ${sv.values.slice(0, 12).map(x => formatEng(x, 4)).join(', ')}${sv.values.length > 12 ? ', …' : ''}`}</div>
      <div className="muted">Each value is a separate ngspice run of every enabled analysis. Reference the parameter in part values as {'{'}Name{'}'}, e.g. {'{Rh}'} or {'{2*Rh}'}.</div>
    </Dialog>
  );
}

function Field({ label, value, onChange, optional }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean }) {
  return <div className="row"><label>{label}</label><NumField value={value} onChange={onChange} optional={optional} /></div>;
}

function useLocal<K extends ProfKey>(k: K) {
  const p = useStore(s => s.doc.profile[k]);
  const [v, setV] = useState(p);
  const save = (valid: boolean) => { if (!valid) return; setProf(pp => ({ ...pp, [k]: { ...v, enabled: true } })); useStore.getState().setDialog('analysis'); };
  return [v, setV, save] as const;
}
const isNum = (s: string, opt = false) => (opt && !s.trim()) || parseSpiceNumber(s).ok;

export function TranDialog() {
  const [v, setV, save] = useLocal('tran');
  const valid = isNum(v.printStep) && isNum(v.finalTime) && isNum(v.noPrint, true) && isNum(v.stepCeiling, true);
  return (
    <Dialog title="Transient" onClose={() => useStore.getState().setDialog('analysis')} width={380} buttons={<>
      <button className="default" disabled={!valid} onClick={() => save(valid)}>OK</button><button onClick={() => useStore.getState().setDialog('analysis')}>Cancel</button></>}>
      <fieldset><legend>Transient Analysis</legend>
        <Field label="Print Step:" value={v.printStep} onChange={x => setV({ ...v, printStep: x })} />
        <Field label="Final Time:" value={v.finalTime} onChange={x => setV({ ...v, finalTime: x })} />
        <Field label="No-Print Delay:" value={v.noPrint} optional onChange={x => setV({ ...v, noPrint: x })} />
        <Field label="Step Ceiling:" value={v.stepCeiling} optional onChange={x => setV({ ...v, stepCeiling: x })} />
      </fieldset>
      <div className="muted">Print Step sets the output spacing only. Empty Step Ceiling = Final Time / 200. Capacitor/inductor IC= attributes are always applied (PSpice-style bias point); UIC additionally starts parts without IC at 0.</div>
      <div className="row"><label /><label className="chk"><input type="checkbox" disabled /> Detailed Bias Pt.</label></div>
      <div className="row"><label /><label className="chk"><input type="checkbox" checked={v.uic} onChange={e => setV({ ...v, uic: e.target.checked })} /> Skip initial transient solution (UIC)</label></div>
      <fieldset className="na" title="Not yet available"><legend>Fourier Analysis</legend><label className="chk"><input type="checkbox" disabled /> Enable Fourier (not yet available)</label></fieldset>
    </Dialog>
  );
}

export function DcDialog() {
  const [v, setV, save] = useLocal('dc');
  const srcs = useStore(s => s.doc.parts.filter(p => ['V', 'I'].includes(getDef(p.type).spiceLetter)).map(p => p.ref));
  const valid = isNum(v.start) && isNum(v.end) && isNum(v.incr) && !!v.source.trim();
  return (
    <Dialog title="DC Sweep" onClose={() => useStore.getState().setDialog('analysis')} width={420} buttons={<>
      <button className="default" disabled={!valid} onClick={() => save(valid)}>OK</button><button onClick={() => useStore.getState().setDialog('analysis')}>Cancel</button></>}>
      <div className="dc-grid">
        <fieldset><legend>Swept Var. Type</legend>
          <label className="chk"><input type="radio" checked readOnly /> Voltage/Current Source</label>
          {['Temperature', 'Model Parameter', 'Global Parameter'].map(t => <label key={t} className="chk na"><input type="radio" disabled /> {t}</label>)}
        </fieldset>
        <fieldset><legend>Sweep Type</legend>
          <label className="chk"><input type="radio" checked readOnly /> Linear</label>
          {['Octave', 'Decade', 'Value List'].map(t => <label key={t} className="chk na"><input type="radio" disabled /> {t}</label>)}
        </fieldset>
      </div>
      <div className="row"><label>Name:</label><input list="dc-srcs" value={v.source} onChange={e => setV({ ...v, source: e.target.value })} />
        <datalist id="dc-srcs">{srcs.map(s => <option key={s} value={s} />)}</datalist></div>
      <Field label="Start Value:" value={v.start} onChange={x => setV({ ...v, start: x })} />
      <Field label="End Value:" value={v.end} onChange={x => setV({ ...v, end: x })} />
      <Field label="Increment:" value={v.incr} onChange={x => setV({ ...v, incr: x })} />
      <div className="row"><label /><button disabled title="Not yet available">Nested Sweep...</button></div>
    </Dialog>
  );
}

export function AcDialog() {
  const [v, setV, save] = useLocal('ac');
  const valid = isNum(v.points) && isNum(v.start) && isNum(v.end);
  return (
    <Dialog title="AC Sweep and Noise Analysis" onClose={() => useStore.getState().setDialog('analysis')} width={420} buttons={<>
      <button className="default" disabled={!valid} onClick={() => save(valid)}>OK</button><button onClick={() => useStore.getState().setDialog('analysis')}>Cancel</button></>}>
      <div className="dc-grid">
        <fieldset><legend>AC Sweep Type</legend>
          {(['lin', 'oct', 'dec'] as const).map(t => <label key={t} className="chk"><input type="radio" checked={v.sweep === t} onChange={() => setV({ ...v, sweep: t })} /> {{ lin: 'Linear', oct: 'Octave', dec: 'Decade' }[t]}</label>)}
        </fieldset>
        <fieldset><legend>Sweep Parameters</legend>
          <Field label={v.sweep === 'lin' ? 'Total Pts.:' : v.sweep === 'dec' ? 'Pts/Decade:' : 'Pts/Octave:'} value={v.points} onChange={x => setV({ ...v, points: x })} />
          <Field label="Start Freq.:" value={v.start} onChange={x => setV({ ...v, start: x })} />
          <Field label="End Freq.:" value={v.end} onChange={x => setV({ ...v, end: x })} />
        </fieldset>
      </div>
      <fieldset className="na"><legend>Noise Analysis</legend><label className="chk"><input type="checkbox" disabled /> Noise Enabled (not yet available)</label></fieldset>
      <div className="muted">Set an AC magnitude on a source (VAC part, or AC attribute of VSIN/VPULSE).</div>
    </Dialog>
  );
}

export function NetlistViewer() {
  const nl = useMemo(() => createNetlist(), []);
  const title = useStore(s => s.doc.title);
  const sim = useStore(s => s.sim);
  const hasRun = !!sim.result && !sim.stale && !!sim.netlist;
  const [tab, setTab] = useState<'generated' | 'simulated'>(hasRun ? 'simulated' : 'generated');
  const text = tab === 'simulated' && hasRun ? sim.netlist : nl.text;
  return (
    <Dialog title={`${title}.cir — Netlist`} onClose={close} width={640} buttons={<>
      <button onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
      <button onClick={() => download(`${title}.cir`, text)}>Export .cir…</button>
      <button onClick={schematicToNetlistEditor} title="Open the schematic netlist in the Netlist Editor to edit and re-simulate">Open in Netlist Editor</button>
      <button className="default" onClick={close}>Close</button></>}>
      <div className="tabs">
        <button className={tab === 'generated' ? 'on' : ''} onClick={() => setTab('generated')}>Schematic netlist</button>
        <button className={tab === 'simulated' ? 'on' : ''} disabled={!hasRun} onClick={() => setTab('simulated')}
          title={hasRun ? '' : 'Run a simulation first'}>Last simulated deck{hasRun ? ` (${sim.source})` : ''}</button>
      </div>
      <pre className="netlist">{text}</pre>
      {tab === 'generated' && <Diagnostics />}
    </Dialog>
  );
}

function Diagnostics() {
  const nl = useMemo(() => createNetlist(), []);
  if (!nl.diagnostics.length) return <div className="ok-msg">No ERC errors or warnings.</div>;
  return <ul className="diags">{nl.diagnostics.map((d, i) => <li key={i} className={d.level}>{d.level.toUpperCase()}: {d.message}</li>)}</ul>;
}

export function ErcDialog() {
  return <Dialog title="Electrical Rule Check" onClose={close} width={520} buttons={<button className="default" onClick={close}>OK</button>}><Diagnostics /></Dialog>;
}

export function OutputDialog() {
  const r = useStore(s => s.sim.result);
  const [showLog, setShowLog] = useState(false);
  return (
    <Dialog title="Simulation Output" onClose={close} width={640} buttons={<>
      <button onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide' : 'Show'} ngspice log</button>
      <button onClick={() => { close(); simulate(); }}>Re-run</button>
      <button className="default" onClick={close}>Close</button></>}>
      {useStore.getState().sim.notes.length > 0 && <ul className="diags">{useStore.getState().sim.notes.map((n, i) => <li key={i} className="warning">Note: {n}</li>)}</ul>}
      {r?.errors.length ? <ul className="diags">{r.errors.map((e, i) => <li key={i} className="error">{e}</li>)}</ul> : <div className="ok-msg">Simulation completed.</div>}
      {r && !r.ok && r.log && <div className="muted">Common causes: a node with no DC path to ground, a loop of voltage sources/inductors, or a zero-valued resistor.</div>}
      {showLog && <pre className="netlist" style={{ maxHeight: 300 }}>{r?.log}</pre>}
    </Dialog>
  );
}

export function AboutDialog() {
  return (
    <Dialog title="About OpenSpice Schematics" onClose={close} width={420} buttons={<button className="default" onClick={close}>OK</button>}>
      <p><b>OpenSpice Schematics 0.1</b> — a schematic editor and Probe-style viewer inspired by the classic PSpice 9.1 Schematics workflow.</p>
      <p>Simulation engine: ngspice (BSD-3-Clause), run locally. Not affiliated with Cadence/OrCAD/MicroSim. Results are computed by ngspice and may differ numerically from PSpice.</p>
    </Dialog>
  );
}

/** Right-click ▸ Information on a schematic part: values, nodes and (if simulated) bias V / I / P. */
export function PartInfoDialog({ partId }: { partId: string }) {
  const doc = useStore(s => s.doc), sim = useStore(s => s.sim);
  const p = doc.parts.find(q => q.id === partId);
  const nl = useMemo(() => createNetlist(), []);
  if (!p) return null;
  const def = getDef(p.type);
  const name = nl.spiceName.get(p.id) ?? p.ref;
  const nodes = def.pins.map(pin => ({ pin: pin.name, net: nl.conn.pinNet.get(`${p.id}:${pin.name}`)?.name ?? '?' }));
  const op = !sim.stale && sim.source === 'schematic' ? sim.result?.plots.find(q => q.kind === 'op') : undefined;
  const v = (net: string) => net === '0' ? 0 : op?.vectors.find(x => x.name.toLowerCase() === `v(${net.toLowerCase()})`)?.re[0];
  const cv = def.pins.length >= 2 ? currentVector(p, def.pins[0].name, name) : null;
  const i = cv ? op?.vectors.find(x => x.name.toLowerCase() === cv.vec.toLowerCase())?.re[0] : undefined;
  const v1 = nodes[0] ? v(nodes[0].net) : undefined, v2 = nodes[1] ? v(nodes[1].net) : undefined;
  const across = v1 !== undefined && v2 !== undefined ? v1 - v2 : undefined;
  const unit = (pd?: { unit?: string }) => pd?.unit ?? '';
  return (
    <Dialog title={`Information — ${p.ref || p.type}`} onClose={close} width={460} buttons={<>
      <button onClick={() => useStore.getState().setDialog({ kind: 'props', partId })}>Edit Attributes...</button>
      <button className="default" onClick={close}>OK</button></>}>
      <div className="secinfo">
        <div className="infoicon" aria-hidden="true">i</div>
        <div style={{ flex: 1 }}>
          <div><b>{p.ref}</b> — {def.name}: {def.description}</div>
          <table className="attr" style={{ marginTop: 6 }}><tbody>
            {def.props.filter(pd => (p.props[pd.name] ?? '').trim()).map(pd => {
              const raw = p.props[pd.name]; const r = parseSpiceNumber(raw);
              return <tr key={pd.name}><td>{pd.name}</td><td>{raw}{pd.kind === 'num' && r.ok && !isBraced(raw) ? `  (= ${formatEng(r.value, 6)}${unit(pd)})` : ''}</td></tr>;
            })}
            {def.pins.length > 0 && <tr><td>SPICE name</td><td>{name}</td></tr>}
            {nodes.map(n => <tr key={n.pin}><td>Pin {n.pin}</td><td>node {n.net}{v(n.net) !== undefined ? `   V = ${formatEng(v(n.net)!, 5)}V` : ''}</td></tr>)}
          </tbody></table>
          <div style={{ marginTop: 8 }}>
            {op ? <>
              <div className="lh"><b>Bias point</b></div>
              {across !== undefined && def.pins.length === 2 && <div>Voltage across (pin {nodes[0].pin} − pin {nodes[1].pin}) = {formatEng(across, 6)}V</div>}
              {i !== undefined && <div>Current into pin {def.pins[0].name} = {formatEng(i, 6)}A</div>}
              {i !== undefined && across !== undefined && <div>Power absorbed = {formatEng(i * across, 6)}W{i * across < 0 ? ' (delivering)' : ''}</div>}
            </> : <div className="muted">Run a simulation (F11) to see bias voltage, current and power.</div>}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function ImportReportDialog() {
  const r = useStore(s => s.importReport);
  if (!r) return null;
  return (
    <Dialog title={`Import — ${r.file}`} onClose={close} width={560} buttons={<button className="default" onClick={close}>OK</button>}>
      <ul className="diags">
        {r.notes.map((n, i) => <li key={'n' + i}>{n}</li>)}
        {r.warnings.map((w, i) => <li key={'w' + i} className="warning">{w}</li>)}
      </ul>
      <div className="muted">Check the circuit, then Analysis ▸ Simulate (F11). Save it as an OpenSpice project with File ▸ Save.
        PSpice symbol libraries are not available, so OpenSpice symbols are aligned to the imported wires.</div>
    </Dialog>
  );
}
