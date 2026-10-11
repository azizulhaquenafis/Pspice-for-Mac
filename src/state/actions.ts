// Command layer: menus, toolbar buttons and keyboard shortcuts all call these.
import { useStore, readAutosave, clearAutosave, DEFAULT_CIR, saveCirDraft, CirDoc, circuitSignature, isStale, replacedSim } from './store';
import { generateNetlist } from '../core/netlist';
import { serialize, FILE_EXT } from '../core/serialize';
import { importSch } from '../core/schImport';
import { AutoEngine } from '../sim/autoEngine';
import { SimResult } from '../sim/types';
import { runSchematic } from '../sim/schematicSim';
import { runParametric } from '../sim/parametric';
import { runDeck } from '../sim/netlistSim';
import { pinPositions, getDef, xf } from '../core/library';

export const engine = new AutoEngine();
/** Pick (and pre-load) the simulation backend at startup. */
export function initEngine() { void engine.choose().then(e => useStore.setState({ status: `Ready — simulator: ${e.name}` })); }
const S = () => useStore.getState();

export function confirmDiscard(): boolean {
  return !S().dirty || window.confirm('Discard unsaved changes to the current schematic?');
}

export function fileNew() { if (confirmDiscard()) { S().newDoc(); clearAutosave(); } }

export function fileOpen(accept = `${FILE_EXT},.json,.sch`) {
  if (!confirmDiscard()) return;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept;
  input.onchange = async () => {
    const f = input.files?.[0]; if (!f) return;
    if (f.size > 5_000_000) { alert(`${f.name} is too large (over 5 MB)`); return; }
    const text = await f.text();
    if (/\.sch$/i.test(f.name) || /^\*version\s/i.test(text)) { importSchText(text, f.name); return; }
    try { S().loadText(text, f.name); setTimeout(zoomFit, 0); }
    catch (e) { alert(`Cannot open ${f.name}: ${(e as Error).message}`); }
  };
  input.click();
}

/** File ▸ Import: PSpice/MicroSim Schematics .sch → new OpenSpice schematic + import report. */
export function fileImportSch() { fileOpen('.sch'); }
export function importSchText(text: string, name: string) {
  try {
    const r = importSch(text, name);
    S().loadText(serialize(r.doc), name.replace(/\.sch$/i, FILE_EXT));
    useStore.setState({ dirty: true, importReport: { file: name, notes: r.notes, warnings: r.warnings }, dialog: 'importReport',
      status: `Imported ${name}${r.warnings.length ? ` with ${r.warnings.length} warning(s)` : ''}` });
    setTimeout(zoomFit, 0);
  } catch (e) { alert(`Cannot import ${name}: ${(e as Error).message}`); }
}

export function openDoc(doc: import('../core/model').SchematicDoc) {
  if (!confirmDiscard()) return;
  S().loadText(serialize(doc), null);
  setTimeout(() => zoomFit(), 0);
}

/** File handles belong to the document session that chose them (B01): New/Open/Import never reuse them. */
const handles: { doc?: { session: number; h: any }; cir?: { session: number; h: any } } = {};

export async function fileSave(as = false) {
  const st = S();
  const session = st.docSession, rev = st.docRev;   // what is being written
  const text = serialize({ ...st.doc, netlist: { text: st.cir.text, fileName: st.cir.fileName, origin: st.cir.origin } });
  const w = window as any;
  /** Only the document that was saved, and only if it was not edited meanwhile, becomes "saved" (B13). */
  const done = (name: string, how = '') => {
    if (S().docSession !== session) return; // replaced during the save: leave the new document alone
    const edited = S().docRev !== rev;
    useStore.setState({ fileName: name, dirty: edited, status: edited ? `Saved ${name}${how} — changes made during the save are not saved yet` : `Saved ${name}${how}` });
    if (!edited) clearAutosave();
  };
  try {
    if (w.showSaveFilePicker) {
      let h = handles.doc?.session === session ? handles.doc.h : null;
      if (as || !h) {
        h = await w.showSaveFilePicker({ suggestedName: (st.fileName ?? st.doc.title).replace(/(\.osch)?$/, FILE_EXT), types: [{ description: 'OpenSpice schematic', accept: { 'application/json': [FILE_EXT] } }] });
        handles.doc = { session, h };
      }
      const wr = await h.createWritable(); await wr.write(text); await wr.close();
      done(h.name);
    } else {
      const name = as || !st.fileName ? (prompt('Save as:', st.fileName ?? `${st.doc.title}${FILE_EXT}`) ?? '') : st.fileName;
      if (!name) return;
      const fn = name.endsWith(FILE_EXT) ? name : name + FILE_EXT;
      download(fn, text, 'application/json');
      done(fn, ' (downloaded)');
    }
  } catch (e) { if ((e as Error).name !== 'AbortError') alert(`Save failed: ${(e as Error).message}`); }
}

export function recoverAutosave(): boolean {
  const t = readAutosave();
  if (!t) return false;
  if (!window.confirm('An autosaved schematic was found. Recover it?')) { clearAutosave(); return false; }
  try { S().loadText(t, null); useStore.setState({ dirty: true }); return true; } catch { clearAutosave(); return false; }
}

export function download(name: string, data: string | Blob, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Netlist of the current schematic, for previews/export/ERC. Pure: never touches the recorded simulated deck (B02). */
export function createNetlist() {
  return generateNetlist(S().doc);
}

export function exportNetlist() { const nl = createNetlist(); download(`${S().doc.title}.cir`, nl.text); }

export function electricalRuleCheck() {
  const nl = createNetlist();
  S().setDialog('erc');
  S().setStatus(nl.ok ? 'ERC: no errors' : `ERC: ${nl.diagnostics.filter(d => d.level === 'error').length} error(s)`);
}

/** F11 / Simulate: runs whatever the main area shows (schematic or netlist editor). */
export async function simulate() {
  return S().mainView === 'netlist' ? simulateNetlist() : simulateSchematic();
}

let runSeq = 0;
interface RunCtx { id: number; kind: 'schematic' | 'netlist'; session: number; sig: string; cirText: string }

function beginRun(kind: RunCtx['kind'], status: string): { ctx: RunCtx; abort: AbortController } {
  const st = S();
  const ctx: RunCtx = { id: ++runSeq, kind, session: kind === 'schematic' ? st.docSession : st.cirSession, sig: circuitSignature(st.doc), cirText: st.cir.text };
  const abort = new AbortController();
  useStore.setState(s => ({ sim: { ...s.sim, running: true, abort, runId: ctx.id, runKind: kind }, status }));
  return { ctx, abort };
}

/** Apply a finished run — only if it is still the current run for the same document (B04). */
function finishRun(ctx: RunCtx, result: SimResult, deck: string, notes: string[]): boolean {
  const st = S();
  if (st.sim.runId !== ctx.id) return false;                       // superseded or cancelled by a document change
  const session = ctx.kind === 'schematic' ? st.docSession : st.cirSession;
  if (session !== ctx.session) { useStore.setState(s => ({ sim: { ...s.sim, running: false, abort: undefined, runId: undefined } })); return false; }
  const tl = /^\s*\.temp\s+(\S+)/im.exec(deck);
  result = { ...result, time: Date.now(), temp: tl ? parseFloat(tl[1]) : 27 };
  const hasWave = result.plots.some(p => p.kind !== 'op');
  const sim = { ...st.sim, running: false, abort: undefined, result, netlist: deck, source: ctx.kind, notes, sig: ctx.sig, cirText: ctx.cirText };
  useStore.setState(s => ({
    // edits made while the simulation ran make the result stale straight away
    sim: { ...sim, stale: isStale(sim, s.doc, s.cir.text) },
    status: result.ok ? `Simulation complete (${result.elapsedMs.toFixed(0)} ms)` : `Simulation failed: ${result.errors[0] ?? ''}`,
    showBiasV: result.ok && ctx.kind === 'schematic' ? true : s.showBiasV,
    probeOpen: result.ok && hasWave ? true : s.probeOpen,
  }));
  if (!result.ok || result.errors.length) S().setDialog('output');
  return true;
}

export async function simulateSchematic() {
  const st = S();
  if (st.sim.running) return;
  const nl = createNetlist();
  if (!nl.ok) { st.setDialog('erc'); st.setStatus('Netlist errors — simulation not started'); return; }
  const doc = st.doc;
  const { ctx, abort } = beginRun('schematic', `Simulating with ${engine.name}…`);
  if (doc.profile.param.enabled) {
    const run = await runParametric(doc, engine, abort.signal, (i, n, label) => {
      if (S().sim.runId === ctx.id) useStore.setState({ status: `Parametric run ${i} of ${n} (${label})… press Cancel to stop` });
    });
    const failed = run.result.steps?.filter(s => !s.ok).length ?? 0;
    finishRun(ctx, run.result, run.deck, run.result.steps ? [`Parametric sweep: ${run.result.steps.length} run(s)${failed ? `, ${failed} failed` : ''}`] : []);
    return;
  }
  const run = await runSchematic(doc, engine, abort.signal);
  finishRun(ctx, run.result, run.deck, []);
}

export async function simulateNetlist() {
  const st = S();
  if (st.sim.running) return;
  const text = st.cir.text;
  const { ctx, abort } = beginRun('netlist', `Simulating netlist with ${engine.name}…`);
  const run = await runDeck(text, engine, abort.signal, (i, n, label) => {
    if (S().sim.runId === ctx.id) useStore.setState({ status: `.STEP run ${i} of ${n} (${label})…` });
  });
  if (finishRun(ctx, run.result, run.deck, run.notes)) useStore.setState({ cirMeasures: run.measurements, cirProbes: run.probes });
}

// ---- Netlist Mode (.cir) ----
const CIR_TYPES = '.cir,.sp,.spice,.net,.txt,.spi,.ckt';
export function showNetlistEditor(on = true) { useStore.setState({ mainView: on ? 'netlist' : 'schematic', status: on ? 'Netlist Mode' : 'Schematic Mode' }); }
export function toggleMode() { showNetlistEditor(S().mainView !== 'netlist'); }
/** Edit the netlist text (grouped into undo steps by pauses of 0.8 s). */
export function setCirText(text: string, forceStep = false) {
  useStore.setState(s => {
    const now = Date.now();
    const group = !forceStep && now - s.cirHist.lastAt < 800;
    const past = group ? s.cirHist.past : [...s.cirHist.past.slice(-300), s.cir.text];
    return {
      cir: { ...s.cir, text, dirty: true, origin: s.cir.origin === 'generated' ? 'edited' : s.cir.origin },
      cirHist: { past, future: [], lastAt: now }, cirRev: s.cirRev + 1,
      sim: { ...s.sim, stale: isStale(s.sim, s.doc, text) },
    };
  });
  saveCirDraft(text);
}
export function cirUndo() {
  const { cirHist: h, cir } = S();
  if (!h.past.length) return;
  const text = h.past[h.past.length - 1];
  useStore.setState(s => ({ cir: { ...cir, text, dirty: true }, cirHist: { past: h.past.slice(0, -1), future: [cir.text, ...h.future], lastAt: 0 },
    cirRev: s.cirRev + 1, sim: { ...s.sim, stale: isStale(s.sim, s.doc, text) } }));
}
export function cirRedo() {
  const { cirHist: h, cir } = S();
  if (!h.future.length) return;
  const text = h.future[0];
  useStore.setState(s => ({ cir: { ...cir, text, dirty: true }, cirHist: { past: [...h.past, cir.text], future: h.future.slice(1), lastAt: 0 },
    cirRev: s.cirRev + 1, sim: { ...s.sim, stale: isStale(s.sim, s.doc, text) } }));
}
const loadCir = (text: string, fileName: string | null, origin: CirDoc['origin']) => {
  useStore.setState(s => ({ cir: { text, fileName, dirty: false, origin }, cirHist: { past: [], future: [], lastAt: 0 }, mainView: 'netlist', cirTraces: null,
    cirSession: s.cirSession + 1, cirRev: 0, sim: replacedSim(s.sim, 'netlist') }));
  saveCirDraft(text);
};
const confirmCir = () => !S().cir.dirty || window.confirm('Discard unsaved changes to the current netlist?');
export function newCir() { if (confirmCir()) loadCir(DEFAULT_CIR, null, 'independent'); }
export function openCirExample(text: string, name: string) { if (confirmCir()) loadCir(text, name, 'independent'); }
export function openCir() {
  if (!confirmCir()) return;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = CIR_TYPES;
  input.onchange = async () => {
    const f = input.files?.[0]; if (!f) return;
    if (f.size > 1_000_000) { alert('File too large for a netlist (over 1 MB)'); return; }
    loadCir(await f.text(), f.name, 'independent');
    useStore.setState({ status: `Opened ${f.name}` });
  };
  input.click();
}
export async function saveCir(as = false) {
  const { cir, cirSession: session, cirRev: rev } = S();
  const w = window as any;
  const done = (name: string, how = '') => {
    if (S().cirSession !== session) return;
    const edited = S().cirRev !== rev;
    useStore.setState(s => ({ cir: { ...s.cir, fileName: name, dirty: edited }, status: edited ? `Saved ${name}${how} — changes made during the save are not saved yet` : `Saved ${name}${how}` }));
  };
  try {
    if (w.showSaveFilePicker) {
      let h = handles.cir?.session === session ? handles.cir.h : null;
      if (as || !h) {
        h = await w.showSaveFilePicker({ suggestedName: cir.fileName ?? 'circuit.cir', types: [{ description: 'SPICE netlist', accept: { 'text/plain': ['.cir', '.sp', '.spice', '.net', '.txt'] } }] });
        handles.cir = { session, h };
      }
      const wr = await h.createWritable(); await wr.write(cir.text); await wr.close();
      done(h.name);
    } else {
      const name = as || !cir.fileName ? prompt('Save netlist as:', cir.fileName ?? 'circuit.cir') : cir.fileName;
      if (!name) return;
      const fn = /\.\w+$/.test(name) ? name : name + '.cir';
      download(fn, cir.text);
      done(fn, ' (downloaded)');
    }
  } catch (e) { if ((e as Error).name !== 'AbortError') alert(`Save failed: ${(e as Error).message}`); }
}
/** Generated Netlist workflow: copy the schematic's netlist (current profile) into Netlist Mode. */
export function schematicToNetlistEditor() {
  if (S().cir.dirty && S().cir.origin !== 'generated' && !window.confirm('The Netlist Mode document has unsaved edits. Replace it with the netlist generated from the schematic?')) return;
  const nl = createNetlist();
  loadCir(nl.text, `${S().doc.title}.cir`, 'generated');
  useStore.setState({ dialog: null, status: nl.ok ? 'Generated netlist opened in Netlist Mode' : 'Generated netlist has ERC errors (see comments)' });
}

export function cancelSimulation() { S().sim.abort?.abort(); }

// ---- View ----
export function zoomBy(f: number, cx?: number, cy?: number) {
  const v = S().doc.view;
  const el = document.getElementById('schematic-canvas');
  const w = el?.clientWidth ?? 800, h = el?.clientHeight ?? 600;
  const px = cx ?? w / 2, py = cy ?? h / 2;
  const zoom = Math.min(8, Math.max(0.2, v.zoom * f));
  const wx = v.x + px / v.zoom, wy = v.y + py / v.zoom;
  S().setView({ zoom, x: wx - px / zoom, y: wy - py / zoom });
}

export function bbox(ids?: string[]) {
  const d = S().doc;
  const xs: number[] = [], ys: number[] = [];
  for (const p of d.parts) if (!ids || ids.includes(p.id)) {
    const def = getDef(p.type);
    for (const pp of pinPositions(p)) { xs.push(pp.x); ys.push(pp.y); }
    const c = xf(p, 20, 20); xs.push(c.x); ys.push(c.y);
    if (def.circles) xs.push(p.x);
  }
  if (!ids) for (const w of d.wires) { xs.push(w.a.x, w.b.x); ys.push(w.a.y, w.b.y); }
  if (!xs.length) return null;
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function zoomFit(ids?: string[]) {
  const b = bbox(ids);
  const el = document.getElementById('schematic-canvas');
  if (!b || !el) return;
  const pad = 60, w = el.clientWidth, h = el.clientHeight;
  if (w < 80 || h < 80) return;
  const zoom = Math.min(4, Math.max(0.2, Math.min(w / (b.x1 - b.x0 + 2 * pad), h / (b.y1 - b.y0 + 2 * pad))));
  S().setView({ zoom, x: (b.x0 + b.x1) / 2 - w / 2 / zoom, y: (b.y0 + b.y1) / 2 - h / 2 / zoom });
}

export function selectAll() {
  const d = S().doc;
  S().select({ parts: d.parts.map(p => p.id), wires: d.wires.map(w => w.id), labels: d.labels.map(l => l.id), junctions: d.junctions.map(j => j.id), markers: d.markers.map(m => m.id) });
}

export function editSelected() {
  const st = S();
  if (st.sel.parts.length === 1) st.setDialog({ kind: 'props', partId: st.sel.parts[0] });
  else if (st.sel.labels.length === 1) { const l = st.doc.labels.find(l => l.id === st.sel.labels[0])!; st.setDialog({ kind: 'label', labelId: l.id, mode: l.kind }); }
  else st.setStatus('Select one part or label to edit its attributes');
}

export function rotate() {
  const st = S();
  if (st.tool.kind === 'place') st.setTool({ ...st.tool, rot: ((st.tool.rot + 1) % 4) as 0 | 1 | 2 | 3 });
  else st.rotateSelection();
}
export function flip() {
  const st = S();
  if (st.tool.kind === 'place') st.setTool({ ...st.tool, mirror: !st.tool.mirror });
  else st.mirrorSelection();
}
export function escape() {
  const st = S();
  if (st.dialog) return st.setDialog(null);
  if (st.tool.kind !== 'select') return st.setTool({ kind: 'select' });
  st.clearSel(); useStore.setState({ highlightNet: null });
}
export function clearMarkers() { S().commit(d => ({ ...d, markers: [] }), 'Markers cleared'); }
