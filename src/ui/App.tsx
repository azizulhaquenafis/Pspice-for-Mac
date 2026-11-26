import { useEffect, useState, ReactNode } from 'react';
import { useStore } from '../state/store';
import * as A from '../state/actions';
import { Canvas, canvasHooks } from './Canvas';
import { Probe } from './Probe';
import { PartBrowser, PropertiesDialog, PartInfoDialog, LabelDialog, AnalysisSetup, ParamDialog, TranDialog, DcDialog, AcDialog, NetlistViewer, ErcDialog, OutputDialog, AboutDialog } from './Dialogs';
import { Icon } from './icons';
import { NetlistWorkspace, netlistEditorHooks } from './NetlistEditor';
import { NETLIST_EXAMPLES } from '../core/netlistExamples';
import { Tooltip } from './Tooltip';
import { EXAMPLES } from '../core/examples';

const S = () => useStore.getState();
const tool = (t: Parameters<ReturnType<typeof S>['setTool']>[0]) => () => S().setTool(t);
const NA = null; // not yet available

interface Item { label: string; key?: string; run?: (() => void) | null; sep?: boolean; checked?: () => boolean }
const sep: Item = { label: '', sep: true };

const MENUS: [string, Item[]][] = [
  ['File', [
    { label: 'New', run: A.fileNew }, { label: 'Open...', run: A.fileOpen },
    ...EXAMPLES.map(ex => ({ label: `Open Example: ${ex.name}`, run: () => A.openDoc(ex.make()) })), { label: 'Close', run: NA },
    { label: 'Save', key: 'Ctrl+S', run: () => A.fileSave() }, { label: 'Save As...', run: () => A.fileSave(true) }, sep,
    { label: 'Print...', run: () => window.print() }, sep,
    { label: 'Import...', run: NA }, { label: 'Export Netlist...', run: A.exportNetlist }, sep,
    { label: 'New Netlist (.cir)', run: A.newCir }, { label: 'Open Netlist (.cir)...', run: A.openCir },
    { label: 'Save Netlist (.cir)...', run: A.saveCir }, sep,
    { label: 'Current Errors', run: A.electricalRuleCheck },
  ]],
  ['Edit', [
    { label: 'Undo', key: 'Ctrl+Z', run: () => S().undo() }, { label: 'Redo', key: 'Ctrl+Y', run: () => S().redo() }, sep,
    { label: 'Label...', run: tool({ kind: 'alias' }) }, sep,
    { label: 'Cut', key: 'Ctrl+X', run: () => S().cut() }, { label: 'Copy', key: 'Ctrl+C', run: () => S().copy() },
    { label: 'Paste', key: 'Ctrl+V', run: () => S().paste() }, { label: 'Delete', key: 'Del', run: () => S().deleteSelection() },
    { label: 'Select All', key: 'Ctrl+A', run: A.selectAll }, sep,
    { label: 'Attributes...', key: 'Ctrl+E', run: A.editSelected }, { label: 'Model...', run: NA }, { label: 'Stimulus...', run: NA }, sep,
    { label: 'Rotate', key: 'Ctrl+R', run: A.rotate }, { label: 'Flip', key: 'Ctrl+F', run: A.flip }, sep,
    { label: 'Find...', run: NA },
  ]],
  ['Draw', [
    { label: 'Place Part...', key: 'Ctrl+P', run: () => S().setDialog('partBrowser') },
    { label: 'Wire', key: 'Ctrl+W', run: tool({ kind: 'wire' }) }, { label: 'Bus', run: NA }, { label: 'Block', run: NA },
    { label: 'Junction', key: 'Ctrl+J', run: tool({ kind: 'junction' }) }, sep,
    { label: 'Arc', run: NA }, { label: 'Circle', run: NA }, { label: 'Box', run: NA }, { label: 'Polyline', run: NA },
    { label: 'Text...', key: 'Ctrl+T', run: tool({ kind: 'text' }) }, sep,
    { label: 'Get New Part...', key: 'Ctrl+G', run: () => S().setDialog('partBrowser') },
  ]],
  ['Navigate', [{ label: 'Previous Page', run: NA }, { label: 'Next Page', run: NA }, { label: 'Push', run: NA }, { label: 'Pop', run: NA }]],
  ['View', [
    { label: 'Fit', key: 'Ctrl+N', run: () => A.zoomFit() }, { label: 'In', key: 'Ctrl+I', run: () => A.zoomBy(1.5) },
    { label: 'Out', key: 'Ctrl+O', run: () => A.zoomBy(1 / 1.5) }, { label: 'Selection', run: () => A.zoomFit(S().sel.parts.length ? S().sel.parts : undefined) },
    { label: 'Entire Page', run: () => { const el = document.getElementById('schematic-canvas')!; const z = Math.min(el.clientWidth / 1140, el.clientHeight / 890); S().setView({ zoom: z, x: -20, y: -20 }); } },
    { label: 'Redraw', key: 'Ctrl+L', run: () => S().setStatus('Redrawn') }, sep,
    { label: 'Probe Window', key: 'F12', run: () => useStore.setState(s => ({ probeOpen: !s.probeOpen })), checked: () => S().probeOpen },
  ]],
  ['Options', [{ label: 'Display Options...', run: NA }, { label: 'Page Size...', run: NA }, { label: 'Auto-Naming...', run: NA }]],
  ['Analysis', [
    { label: 'Electrical Rule Check', run: A.electricalRuleCheck }, { label: 'Create Netlist', run: () => { A.createNetlist(); S().setStatus('Netlist created'); } },
    { label: 'Edit Stimuli...', run: NA }, { label: 'Setup...', run: () => S().setDialog('analysis') },
    { label: 'Library and Include Files...', run: NA }, sep,
    { label: 'Simulate', key: 'F11', run: A.simulate }, { label: 'Cancel Simulation', run: A.cancelSimulation }, sep,
    { label: 'Run Probe', key: 'F12', run: () => useStore.setState({ probeOpen: true }) },
    { label: 'Examine Netlist', run: () => S().setDialog('netlist') }, { label: 'Open Generated Netlist in Netlist Mode', run: A.schematicToNetlistEditor }, { label: 'Examine Output', run: () => S().setDialog('output') }, sep,
    { label: 'Enable Bias Voltage Display', run: () => useStore.setState(s => ({ showBiasV: !s.showBiasV })), checked: () => S().showBiasV },
    { label: 'Enable Bias Current Display', run: () => useStore.setState(s => ({ showBiasI: !s.showBiasI })), checked: () => S().showBiasI },
  ]],
  ['Tools', [{ label: 'Annotate...', run: NA }, { label: 'Package...', run: NA }]],
  ['Markers', [
    { label: 'Mark Voltage/Level', key: 'Ctrl+M', run: tool({ kind: 'marker', marker: 'V' }) },
    { label: 'Mark Voltage Differential', run: tool({ kind: 'marker', marker: 'VD' }) },
    { label: 'Mark Current into Pin', run: tool({ kind: 'marker', marker: 'I' }) },
    { label: 'Mark Power Dissipation', run: tool({ kind: 'marker', marker: 'W' }) },
    { label: 'Mark Advanced...', run: NA }, sep, { label: 'Clear All', run: A.clearMarkers },
  ]],
  ['Window', [{ label: 'Cascade', run: NA }, { label: 'Tile', run: NA }, sep,
    { label: '1 Schematic', key: 'Ctrl+1', run: () => A.showNetlistEditor(false), checked: () => S().mainView === 'schematic' },
    { label: '2 Netlist Mode', key: 'Ctrl+2', run: () => A.showNetlistEditor(true), checked: () => S().mainView === 'netlist' }]],
  ['Help', [{ label: 'Keyboard Shortcuts', run: () => alert(SHORTCUTS) }, { label: 'About OpenSpice Schematics...', run: () => S().setDialog('about') }]],
];

/** The one intentional addition to the PSpice layout: switch the whole application to Netlist Mode and back. */
function ModeButton() {
  const mode = useStore(s => s.mainView);
  return (
    <span className="modebtn-wrap" data-tip={mode === 'netlist' ? 'Schematic Mode|Return to the schematic editor (your schematic is unchanged)' : 'Netlist Mode|Switch to the SPICE netlist editor workspace (Ctrl+2)'}>
      <button className={`modebtn${mode === 'netlist' ? ' on' : ''}`} onClick={A.toggleMode} aria-pressed={mode === 'netlist'}>
        {mode === 'netlist' ? '◧ Schematic Mode' : '▤ Netlist Mode'}
      </button>
    </span>
  );
}

const NETLIST_MENUS: [string, Item[]][] = [
  ['File', [
    { label: 'New Netlist', run: A.newCir }, { label: 'Open...', run: A.openCir },
    { label: 'Save', key: 'Ctrl+S', run: () => A.saveCir() }, { label: 'Save As...', run: () => A.saveCir(true) }, sep,
    ...NETLIST_EXAMPLES.map(e => ({ label: `Example: ${e.name}`, run: () => A.openCirExample(e.text, `${e.name.replace(/\W+/g, '_')}.cir`) })), sep,
    { label: 'Import Generated Netlist from Schematic', run: A.schematicToNetlistEditor },
    { label: 'Save Project (.osch, includes this netlist)', run: () => A.fileSave() }, sep,
    { label: 'Exit Netlist Mode', key: 'Ctrl+1', run: () => A.showNetlistEditor(false) },
  ]],
  ['Edit', [
    { label: 'Undo', key: 'Ctrl+Z', run: A.cirUndo }, { label: 'Redo', key: 'Ctrl+Y', run: A.cirRedo }, sep,
    { label: 'Find / Replace...', key: 'Ctrl+F', run: () => netlistEditorHooks.openFind() },
  ]],
  ['Simulation', [
    { label: 'Run', key: 'F11', run: A.simulateNetlist }, { label: 'Cancel', run: A.cancelSimulation }, sep,
    { label: 'View Simulated Deck', run: () => S().setDialog('netlist') }, { label: 'Examine Output', run: () => S().setDialog('output') },
  ]],
  ['View', [
    { label: 'Probe Window', key: 'F12', run: () => useStore.setState(s => ({ probeOpen: !s.probeOpen })), checked: () => S().probeOpen },
    { label: 'Schematic Mode', key: 'Ctrl+1', run: () => A.showNetlistEditor(false) },
  ]],
  ['Help', [{ label: 'SPICE Netlist Quick Reference', run: () => alert(SPICE_HELP) }, { label: 'About OpenSpice...', run: () => S().setDialog('about') }]],
];

const SPICE_HELP = `Line 1 is the TITLE. * starts a comment. + continues a line. Values accept f p n u m k Meg G T (M = milli!).
Devices: Rname n+ n- value | Cname n+ n- value [IC=v] | Lname n+ n- value [IC=i]
Vname n+ n- [DC v] [AC mag [phase]] [PULSE(v1 v2 td tr tf pw per) | SIN(vo va f td df ph) | PWL(t1 v1 ...)]
Iname n+ n- ... (current flows n+ -> n- through the source)
E/G: name out+ out- ctl+ ctl- gain   F/H: name out+ out- Vsense gain   D: name a k model
S: name n+ n- c+ c- model (.MODEL m SW(Ron Roff Vt Vh))   X: name nodes... subckt
.PARAM name=value  then use {name} or {2*name}
Analyses: .OP  .TRAN tstep tstop [tstart [tmax]] [UIC]  .DC src start stop incr  .AC DEC|OCT|LIN n fstart fstop
.STEP PARAM name LIST v1 v2 ... | .STEP PARAM name start stop incr | .STEP TEMP LIST ...
.MEAS TRAN name FIND v(out) AT=1m  .IC V(node)=v  .TEMP t  .SAVE v(out)   End with .END
Current I(Rx) is into the first node. Probe expressions: V(a,b), V(R1), W(R1), DB(), P().`;

function NetlistToolbar() {
  const running = useStore(s => s.sim.running);
  return (
    <div className="toolbar">
      <TB icon="new" title="New Netlist" onClick={A.newCir} /><TB icon="open" title="Open Netlist (.cir/.sp/.spice/.net/.txt)" onClick={A.openCir} /><TB icon="save" title="Save Netlist (Ctrl+S)" onClick={() => A.saveCir()} />
      <span className="tsep" />
      <TB icon="undo" title="Undo (Ctrl+Z)" onClick={A.cirUndo} /><TB icon="redo" title="Redo (Ctrl+Y)" onClick={A.cirRedo} />
      <TB icon="find" title="Find / Replace (Ctrl+F)" onClick={() => netlistEditorHooks.openFind()} />
      <span className="tsep" />
      <TB icon={running ? 'stop' : 'simulate'} title={running ? 'Cancel Simulation' : 'Run Simulation (F11)'} onClick={running ? A.cancelSimulation : A.simulateNetlist} />
      <TB icon="probe" title="Probe Window (F12)" onClick={() => useStore.setState(s => ({ probeOpen: !s.probeOpen }))} />
      <TB icon="viewnet" title="View Simulated Deck" onClick={() => S().setDialog('netlist')} />
      <span className="tsep" />
      <TB icon="import" title="Import Generated Netlist from Schematic" onClick={A.schematicToNetlistEditor} />
      <ModeButton />
    </div>
  );
}

const SHORTCUTS = `Ctrl+G  Get New Part      Ctrl+W  Wire
Ctrl+R  Rotate            Ctrl+F  Flip
Ctrl+E  Attributes        Ctrl+J  Junction
Ctrl+M  Voltage marker    Ctrl+T  Text
Ctrl+N  Fit   Ctrl+I In   Ctrl+O Out
Ctrl+Z  Undo  Ctrl+Y Redo   Del  Delete
F11 (fn+F11 on Mac) Simulate   F12 Probe
Esc     End mode / cancel wire
Wheel / trackpad: pan    Ctrl+wheel / pinch: zoom    Alt+drag or middle-drag: pan
Double-click part: edit attributes;  double-click wire: net alias`;

function keyOf(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const ctrl = e.ctrlKey || (e.metaKey && 'ZYSCVXA'.includes(k));
  return `${ctrl ? 'Ctrl+' : ''}${k}`;
}

function MenuBar({ menus }: { menus: [string, Item[]][] }) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const c = () => setOpen(null); window.addEventListener('mousedown', c); return () => window.removeEventListener('mousedown', c); }, []);
  return (
    <div className="menubar" onMouseDown={e => e.stopPropagation()}>
      {menus.map(([name, items]) => (
        <div key={name} className={`menu${open === name ? ' open' : ''}`}>
          <span className="mlabel" onMouseDown={() => setOpen(open === name ? null : name)} onMouseEnter={() => open && setOpen(name)}><u>{name[0]}</u>{name.slice(1)}</span>
          {open === name && (
            <div className="dropdown">
              {items.map((it, i) => it.sep ? <div key={i} className="msep" /> : (
                <div key={i} className={`mitem${it.run ? '' : ' disabled'}`} title={it.run ? '' : 'Not yet available'}
                  onMouseUp={() => { if (!it.run) return; setOpen(null); it.run(); }}>
                  <span className="mcheck">{it.checked?.() ? '✓' : ''}</span><span className="mtext">{it.label}</span><span className="mkey">{it.key ?? ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const DESC: Record<string, string> = {
  new: 'Start a new, empty schematic', open: 'Open a saved .osch schematic', save: 'Save the schematic (.osch)', print: 'Print the schematic page',
  cut: 'Remove the selection and keep a copy', copy: 'Copy the selection', paste: 'Paste the copied parts and wires',
  undo: 'Undo the last edit', redo: 'Redo the last undone edit', redraw: 'Redraw the screen',
  zin: 'Zoom in around the centre', zout: 'Zoom out', zarea: 'Zoom to a dragged rectangle', zfit: 'Fit the whole circuit in the window',
  select: 'Select, move and edit objects. Drag part names, values and bias labels to reposition them',
  wire: 'Draw wires: click to start, click for corners, double-click or click a pin/wire to finish',
  bus: 'Draw a bus', junction: 'Join two crossing wires with a junction dot', alias: 'Name a net (click a wire or pin)',
  text: 'Place free text on the schematic', gnd: 'Place the analog ground (node 0)', getpart: 'Browse the part library and place a part',
  attr: 'Edit the attributes (value, name…) of the selected part', netlist: 'Write or open a .cir netlist and simulate it directly',
  viewnet: 'Show the netlist generated from this schematic', setup: 'Choose analyses: Bias Point, DC Sweep, AC Sweep, Transient',
  simulate: 'Run the enabled analyses with ngspice', stop: 'Stop the running simulation',
  biasV: 'Show node voltages from the bias point on the schematic', biasI: 'Show part currents from the bias point on the schematic',
  markV: 'Plot the voltage of a node: click on or next to a wire or pin (snaps to it)', markI: 'Plot the current into a part pin: click on or next to the pin (snaps to it)',
  markVD: 'Plot a voltage difference: click the + point, then the − point', markW: 'Plot the power absorbed by a part (click the part)',
  bubble: 'Bubble connector: every BUBBLE with the same LABEL is the same net — no wire needed',
};

function TB({ icon, title, onClick, active, disabled }: { icon: string; title: string; onClick?: () => void; active?: boolean; disabled?: boolean }) {
  const tip = `${title}${disabled ? ' — not yet available' : ''}|${DESC[icon] ?? ''}`;
  return <span className="tbw" data-tip={tip}><button className={`tb${active ? ' on' : ''}`} aria-label={title} disabled={disabled} onClick={onClick}><Icon name={icon} /></button></span>;
}

function Toolbar() {
  const t = useStore(s => s.tool);
  const recent = useStore(s => s.recentParts);
  const biasV = useStore(s => s.showBiasV), biasI = useStore(s => s.showBiasI);
  const running = useStore(s => s.sim.running);
  const mainView = useStore(s => s.mainView);
  const [partName, setPartName] = useState('');
  const placeByName = (n: string) => {
    const name = n.trim().toUpperCase();
    import('../core/library').then(({ findDef }) => {
      const d = findDef(name);
      if (d) S().setTool({ kind: 'place', partType: d.name, rot: 0, mirror: false });
      else S().setDialog('partBrowser');
    });
  };
  // Order follows the PSpice 9.1 Schematics toolbar (see docs/UI_FIDELITY.md).
  return (
    <div className="toolbar">
      <TB icon="new" title="New" onClick={A.fileNew} /><TB icon="open" title="Open" onClick={A.fileOpen} /><TB icon="save" title="Save (Ctrl+S)" onClick={() => A.fileSave()} />
      <TB icon="print" title="Print" onClick={() => window.print()} />
      <span className="tsep" />
      <TB icon="cut" title="Cut" onClick={() => S().cut()} /><TB icon="copy" title="Copy" onClick={() => S().copy()} /><TB icon="paste" title="Paste" onClick={() => S().paste()} />
      <span className="tsep" />
      <TB icon="undo" title="Undo (Ctrl+Z)" onClick={() => S().undo()} /><TB icon="redo" title="Redo (Ctrl+Y)" onClick={() => S().redo()} />
      <span className="tsep" />
      <TB icon="redraw" title="Redraw (Ctrl+L)" onClick={() => S().setStatus('Redrawn')} />
      <TB icon="zin" title="Zoom In (Ctrl+I)" onClick={() => A.zoomBy(1.5)} /><TB icon="zout" title="Zoom Out (Ctrl+O)" onClick={() => A.zoomBy(1 / 1.5)} />
      <TB icon="zarea" title="Zoom Area" active={t.kind === 'zoomarea'} onClick={tool({ kind: 'zoomarea' })} /><TB icon="zfit" title="Zoom to Fit (Ctrl+N)" onClick={() => A.zoomFit()} />
      <span className="tsep" />
      <TB icon="wire" title="Draw Wire (Ctrl+W)" active={t.kind === 'wire'} onClick={tool({ kind: 'wire' })} />
      <TB icon="bus" title="Draw Bus" disabled />
      <TB icon="block" title="Draw Block" disabled />
      <TB icon="getpart" title="Get New Part (Ctrl+G)" onClick={() => S().setDialog('partBrowser')} />
      <span className="tbw" data-tip="Part name|Type a part name (e.g. R, VDC, AGND, Sw_tOpen, PARAM) and press Enter to place it; ▼ lists recent parts">
        <input className="partcombo" list="recent-parts" aria-label="Part name" value={partName} placeholder={recent[0] ?? 'R'}
          onChange={e => setPartName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { placeByName(partName || recent[0] || 'R'); (e.target as HTMLInputElement).blur(); } }} />
      </span>
      <datalist id="recent-parts">{recent.map(r => <option key={r} value={r} />)}</datalist>
      <TB icon="attr" title="Edit Attributes (Ctrl+E)" onClick={A.editSelected} />
      <TB icon="symbol" title="Edit Symbol" disabled />
      <span className="tsep" />
      <TB icon="setup" title="Setup Analysis" onClick={() => S().setDialog('analysis')} />
      <TB icon={running ? 'stop' : 'simulate'} title={running ? 'Cancel Simulation' : 'Simulate (F11)'} onClick={running ? A.cancelSimulation : A.simulate} />
      <span className="tsep" />
      <TB icon="markV" title="Mark Voltage/Level (Ctrl+M)" active={t.kind === 'marker' && t.marker === 'V'} onClick={tool({ kind: 'marker', marker: 'V' })} />
      <TB icon="markI" title="Mark Current into Pin" active={t.kind === 'marker' && t.marker === 'I'} onClick={tool({ kind: 'marker', marker: 'I' })} />
      <span className="tsep" />
      <TB icon="biasV" title="Enable Bias Voltage Display" active={biasV} onClick={() => useStore.setState(s => ({ showBiasV: !s.showBiasV }))} />
      <TB icon="biasI" title="Enable Bias Current Display" active={biasI} onClick={() => useStore.setState(s => ({ showBiasI: !s.showBiasI }))} />
      <ModeButton />
    </div>
  );
}

/** Left vertical toolbar (where PSpice has its drawing tools): OpenSpice editing tools. */
function LeftToolbar() {
  const t = useStore(s => s.tool);
  return (
    <div className="vtoolbar" aria-label="Drawing tools">
      <TB icon="select" title="Select (Esc)" active={t.kind === 'select'} onClick={tool({ kind: 'select' })} />
      <TB icon="junction" title="Place Junction (Ctrl+J)" active={t.kind === 'junction'} onClick={tool({ kind: 'junction' })} />
      <TB icon="alias" title="Net Alias / Label" active={t.kind === 'alias'} onClick={tool({ kind: 'alias' })} />
      <TB icon="text" title="Text (Ctrl+T)" active={t.kind === 'text'} onClick={tool({ kind: 'text' })} />
      <TB icon="gnd" title="Place Ground (AGND)" active={t.kind === 'place' && t.partType === 'AGND'} onClick={tool({ kind: 'place', partType: 'AGND', rot: 0, mirror: false })} />
      <TB icon="bubble" title="Place BUBBLE (connect nets by name)" active={t.kind === 'place' && t.partType === 'BUBBLE'} onClick={tool({ kind: 'place', partType: 'BUBBLE', rot: 0, mirror: false })} />
      <TB icon="param" title="Place PARAMETERS block" active={t.kind === 'place' && t.partType === 'PARAM'} onClick={tool({ kind: 'place', partType: 'PARAM', rot: 0, mirror: false })} />
      <span className="vsep" />
      <TB icon="markVD" title="Mark Voltage Differential" active={t.kind === 'marker' && t.marker === 'VD'} onClick={tool({ kind: 'marker', marker: 'VD' })} />
      <TB icon="markW" title="Mark Power Dissipation" active={t.kind === 'marker' && t.marker === 'W'} onClick={tool({ kind: 'marker', marker: 'W' })} />
      <span className="vsep" />
      <TB icon="viewnet" title="Examine Netlist" onClick={() => S().setDialog('netlist')} />
    </div>
  );
}

/** PSpice-style status bar: "x, y  message" on the left, "Cmd: <mode>" on the right. Coordinates in inches. */
function StatusBar() {
  const status = useStore(s => s.status), c = useStore(s => s.cursor), t = useStore(s => s.tool);
  const running = useStore(s => s.sim.running);
  const netlistMode = useStore(s => s.mainView === 'netlist');
  if (netlistMode) return <div className="statusbar"><span className="sb grow">{running ? '⏳ ' : ''}{status}</span><span className="sb w110">Cmd: Netlist</span></div>;
  const cmd = t.kind === 'place' ? (t.partType === 'AGND' ? 'Place Part' : 'Place Part') : t.kind === 'marker' ? 'Marker' : t.kind === 'zoomarea' ? 'Area'
    : t.kind === 'wire' ? 'Wire' : t.kind === 'alias' ? 'Label' : t.kind === 'text' ? 'Text' : t.kind === 'junction' ? 'Junction' : 'Select';
  return (
    <div className="statusbar">
      <span className="sb grow">{(c.x / 100).toFixed(2)}, {(c.y / 100).toFixed(2)}{'\u2003'}{running ? '⏳ ' : ''}{status}</span>
      <span className="sb w110">Cmd: {cmd}</span>
    </div>
  );
}

function Dialogs() {
  const d = useStore(s => s.dialog);
  if (!d) return null;
  if (typeof d === 'object') return d.kind === 'props' ? <PropertiesDialog key={d.partId} partId={d.partId} /> : d.kind === 'partInfo' ? <PartInfoDialog partId={d.partId} /> : <LabelDialog {...d} />;
  const map: Record<string, ReactNode> = {
    partBrowser: <PartBrowser />, analysis: <AnalysisSetup />, param: <ParamDialog />, tran: <TranDialog />, dc: <DcDialog />, ac: <AcDialog />,
    netlist: <NetlistViewer />, erc: <ErcDialog />, output: <OutputDialog />, about: <AboutDialog />,
  };
  return <>{map[d]}</>;
}

export function App() {
  const title = useStore(s => s.doc.title), fileName = useStore(s => s.fileName), dirty = useStore(s => s.dirty);
  const probeOpen = useStore(s => s.probeOpen);
  const mainView = useStore(s => s.mainView);
  const cirName = useStore(s => s.cir.fileName);
  const simSource = useStore(s => s.sim.source);
  const [probeMax, setProbeMax] = useState(false);

  useEffect(() => {
    const all = MENUS.flatMap(m => m[1]).filter(i => i.key && i.run);
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT') return;
      if (S().dialog && e.key !== 'Escape') return;
      if (e.key === 'Escape') { if (!canvasHooks.escape()) A.escape(); return; }
      let k = keyOf(e);
      if (k === 'Delete' || k === 'Backspace') k = 'Del';
      if (k === 'Ctrl+Shift+Z' || (e.shiftKey && k === 'Ctrl+Z')) k = 'Ctrl+Y';
      if (k === 'Ctrl+1' || k === 'Ctrl+2') { e.preventDefault(); A.showNetlistEditor(k === 'Ctrl+2'); return; }
      const list = S().mainView === 'netlist' ? NETLIST_MENUS.flatMap(m => m[1]).filter(i => i.key && i.run) : all;
      const item = list.find(i => i.key === k);
      if (item) { e.preventDefault(); item.run!(); }
    };
    window.addEventListener('keydown', onKey);
    const before = (e: BeforeUnloadEvent) => { if (S().dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', before); };
  }, []);

  return (
    <div className="app">
      <div className="titlebar"><span className="appicon" />{mainView === 'netlist' ? `OpenSpice Netlist Editor - [ ${cirName ?? 'untitled.cir'} ]` : `OpenSpice Schematics - [ ${fileName ?? title}  p.1${dirty ? ' *' : ''} ]`}</div>
      <MenuBar menus={mainView === 'netlist' ? NETLIST_MENUS : MENUS} />
      {mainView === 'netlist' ? <NetlistToolbar /> : <Toolbar />}
      <div className="workspace">
        {!(probeOpen && probeMax) && <div className="canvas-row">{mainView === 'schematic' && <LeftToolbar />}<div className="canvas-wrap">{mainView === 'netlist' ? <NetlistWorkspace /> : <Canvas />}</div></div>}
        {probeOpen && (
          <div className={`probe-win${probeMax ? ' max' : ''}`}>
            <div className="probe-title">Probe — {simSource === 'netlist' ? (cirName ?? 'untitled.cir').replace(/\.\w+$/, '') : title}.dat
              <span className="pt-btns"><button onClick={() => setProbeMax(!probeMax)} title={probeMax ? 'Restore' : 'Maximize'}>{probeMax ? '❐' : '□'}</button><button onClick={() => useStore.setState({ probeOpen: false })} title="Close">×</button></span>
            </div>
            <Probe />
          </div>
        )}
      </div>
      <StatusBar />
      <Dialogs />
      <Tooltip />
    </div>
  );
}
