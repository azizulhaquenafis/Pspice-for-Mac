# Changelog
## 0.6.1 — 2026-10-11 (maximum power transfer / parameter sweeps of the bias point)
- Fix: a Parametric sweep (schematic) or .STEP (Netlist Mode) whose only analysis is the bias point showed
  no waveform, because each run is a single point. Probe now offers "Bias point vs <parameter>": every
  run's bias point plotted against the swept value (e.g. W(RL) vs RL).
- New: DC Sweep of a Global Parameter (PSpice's way to sweep a load resistance), plus Temperature, and
  Octave / Decade / Value List sweep types. Linear source and TEMP sweeps still use ngspice .dc; parameter,
  log and list sweeps run one bias point per value (up to 500) and are assembled into a DC plot. The x axis
  is labelled with the parameter and its unit (RL, Ω, taken from the property that uses {RL}); decade sweeps
  get a log axis.
- Netlist Mode: PSpice .DC PARAM name start stop incr, .DC LIN|DEC|OCT PARAM ..., .DC PARAM name LIST ...;
  .DC LIN <source> ... is passed to ngspice without LIN; unsupported forms (log/list sweeps of a source)
  say what to use instead.
- New examples: "Maximum Power Transfer (DC sweep of RL)" (schematic, power marker on RL) and "Maximum power
  transfer (.DC PARAM)" (Netlist Mode).
## 0.6.0 — 2026-10-11 (sources and semiconductors)
- New parts, each with an original PSpice-style symbol and its own editable .model card (docs/MODELS.md):
  D1N4001 (1N4001 rectifier, OpenSpice datasheet fit), ZENER (bent cathode bar, 5.1 V educational DZ5V1),
  Dbreak (generic diode), QNPN / QPNP (C, B, E; emitter arrow out / in), MbreakN / MbreakP (four terminals
  D, G, S, B; LEVEL=1; W, L, AD, AS, PD, PS). VAC and VPULSE were already present and are now fully tested.
- Properties dialog: instance and model sections, "Import .model..." (paste a card; unknown parameters
  go to EXTRA; the device type is checked), Reset to Default, show/hide the reference and value text, and
  "(ngspice default)" for empty model fields. Model fields accept {parameters}, so they can be swept.
- Netlist: one .model card per model name. Parts that share a name with different parameters get a private
  name (warning), so no run reuses stale values. EXTRA parameters are validated.
- VPULSE timing check: negative times, or TR + PW + TF longer than PER, are errors with an explanation.
- Probe: terminal currents I(Q1:C/B/E), I(M1:D/G/S/B), the PSpice forms IC() IB() IE() ID() IG() IS(),
  V(Q1:B), and W(Q1) = Σ V·I. All are "into the terminal"; the ngspice PMOS device-frame sign is corrected.
  Currents ngspice does not save (AC) are reported as unavailable. A DC sweep axis is labelled with the
  swept source (V_VIN).
- Bias "I" display shows every transistor terminal current; Part Info lists terminal currents and power.
- Part Browser: grouped by Sources / Passive / Diodes / BJT / MOSFET / Switches / Other; search covers
  aliases (NMOS, PMOS, NPN, PNP, 1N4001, QbreakN, ...); the preview is fitted to the symbol, with pin names
  and model. The part-name box on the toolbar accepts the aliases too.
- Rotated transistors place their text beside the body, clear of the pin leads; the reference stays above
  the model name.
- Nine new or renamed examples in File ▸ Open Example: VAC RC Low-Pass Filter, VPULSE RC Charging,
  D1N4001 Half-Wave Rectifier, Zener Voltage Regulator, NPN Common-Emitter Amplifier, PNP Transistor Bias,
  NMOS Common-Source Amplifier, PMOS Switching Circuit, CMOS Inverter.
## 0.5.2 — 2026-10-11
- New: Transient Print Step auto-fix. 0 / negative, larger than Final Time, or far too fine (> 100,000 points per
  run, e.g. 1 ns or 1 ps for 1 ms) becomes a 1-2-5 value near Final Time / 1000 (1 ms → 1 µs); a Print Step that
  would overflow 200,000 stored points across a sweep is raised to the finest 1-2-5 value that fits. Each fix is
  shown as a warning/note. Applies to the schematic Transient dialog and to .TRAN in Netlist Mode.
- Fixes from the external review (B01–B15):
  - B01 Save after New/Open no longer overwrites the previous document's file (file handles are per document session).
  - B02 Creating a netlist preview no longer replaces the deck paired with the shown result.
  - B03 Undo/redo and .cir edits mark results stale exactly when the simulated circuit differs.
  - B04 New/Open cancel an in-flight run; late results from an old run or document are discarded (run IDs).
  - B05 Copy/Cut/Paste keep junctions and markers; current/power markers follow their pasted part.
  - B06 A net alias spelled like an automatic node name (e.g. n0001) no longer merges with an unlabelled net.
  - B07 A current marker on an F/H control pin (C+/C−) plots the control current.
  - B08 Netlist Mode honours IC={expression} using top-level .PARAM values; unevaluable ICs are errors.
  - B09 SIN/COS of complex (AC) values use the complex identities.
  - B10 Opening a .osch validates every object (ids, coordinates, properties, markers, view) before replacing the document.
  - B11 Probe axis dialog shows 1 MHz as 1Meg (it parsed back as 1 mHz).
  - B12 Log axis decade generation is bounded and empty for non-positive ranges.
  - B13 An edit made while a save is being written stays marked unsaved.
  - B14 CSV export writes every point of the visible traces (no truncation to the first axis length).
  - B15 A run cancelled before it starts does no work on any backend; abort listeners are removed per pass.
## 0.5.1 — 2026-10-11
- New: File ▸ Import PSpice Schematic (.sch) (also accepted by File ▸ Open). Reads MicroSim/PSpice Schematics
  8–9.1 text files: parts and ports with attributes (REFDES, VALUE, DC, source/switch/gain/IC parameters),
  wires, wire labels, junctions, and the Transient / DC Sweep / AC Sweep setup. Each part is turned so its pins
  meet the imported wires; remaining misaligned pins get a short wire; an import report lists every adjustment,
  unsupported part (e.g. transistors, op-amps) and setting that could not be read.
## 0.5.0 — 2026-10-11 (works on Vercel / any static host)
- Fix: production deployments showed "Simulation service unreachable: Unexpected token '<'". The native
  /api/simulate service only exists in the Vite dev server. Production now runs **ngspice compiled to
  WebAssembly** (npm eecircuit-engine 1.8.0, MIT) in a Web Worker inside the visitor's browser — no server.
- Automatic backend choice: native local service when present (npm run dev with ngspice installed), otherwise
  WebAssembly; ?engine=wasm|native forces one. Falls back to WebAssembly if the native service disappears.
- Clear errors: HTML/empty/non-JSON replies from a missing service are reported as such, never as JSON parse errors.
- WebAssembly specifics handled: one pass per analysis (engine returns one plot), ASCII-only decks (non-ASCII hangs
  the WASM build), per-pass log reset (rolling 2 MB log), fresh instance after a timeout, 120 s cap, cancel = kill worker.
- The whole test suite runs on both backends: npm test (native) and npm run test:wasm (WebAssembly).
- vercel.json: Vite framework, dist output, immutable caching of hashed assets.
## 0.4.4 — 2026-10-11
- One snapping rule (src/core/snapping.ts) for the wire, net-alias, junction and marker tools, used for both the
  live preview and the click, so the preview always shows exactly where the click lands. Reach is 14 screen pixels
  at every zoom, measured to the wire itself; pins, wire ends and crossings are preferred when in reach.
- Wire tool: a click near a pin or wire connects to it (and finishes the wire); junction tool snaps to crossings.
- Selection hit areas use screen pixels at every zoom. Markers and aliases on a moved wire move with it;
  a voltage marker that no longer sits on a net is drawn grey.
## 0.4.3 — 2026-10-11
- New BUBBLE part (Part Browser, left toolbar): a named connector; every BUBBLE / net alias with the same LABEL
  is one net ("0" = ground), so circuits can be connected without wires. Unlabelled or unattached bubbles are reported.
- Probe markers resized to sit in proportion with parts (bubble 3 grid steps from the node); marker tools snap to
  the nearest pin (current) or pin/wire point (voltage) within 1.5 grid and show a live preview while placing.
- Toolbar marker icons redrawn in the PSpice marker style (bubble + arrow).
- E/F/G/H resized to normal part size; output pins are back at x = 40 (same as 0.4.0 and earlier).
## 0.4.2 — 2026-10-11
- Probe markers redrawn like PSpice Schematics: scalloped bubble with the letter (V, I, W, V+/V−) up-right of the
  node, diagonal lead and open arrowhead touching the node; markers take their Probe trace colour after a valid
  simulation. Hit-testing and bias-label avoidance follow the new shape.
## 0.4.1 — 2026-10-11
- New parts F (CCCS) and H (CCVS). Their control current flows through the left pins (C+ → C−) via a hidden
  0 V sense source "V__SENSE_<name>", as PSpice netlists them.
- E (VCVS) and G (VCCS) redrawn in the PSpice Schematics style: box, left control terminals (+/−),
  right source circle (± for E/H, ↓ for F/G); value shown as GAIN=…
- Note: the E/G output pins moved from x=40 to x=60 (pin names unchanged); E/G parts in older .osch files need
  their output wires reconnected.
## 0.4.0 — 2026-10-11 (Probe interaction, PSpice-style)
- Parametric runs drawn with PSpice run symbols (□ ◇ ▽ △ ○ + × ⅄ Y *) and a grouped legend "□◇▽… -I(L1)".
- Click a trace (plot or legend symbol) to select it (white squares); right-click for a context menu.
- Trace ▸ Information = PSpice "Section Information": step parameter (e.g. Step param Rh = 54), temperature,
  simulation time, data points; "Details >>" lists the component values of that run (R4 = 54 Ω ({Rh}) …).
- Trace Property (colour, width, pattern, run symbols), hide/delete, copy values.
- Trace ▸ Evaluate Measurement: Max, Min, Peak_to_Peak, Average, RMS, YatX, XatNthY, Risetime/Falltime_NoOvershoot,
  Overshoot, Period — evaluated for every parametric run.
- Tools ▸ Cursor: Max / Min / Peak / Trough on the selected trace; Tools ▸ Label ▸ Mark; cursor readouts in the bottom pane.
- Y-axis labels carry units (73.46mA); dashed major and dotted minor grid.
- Schematic: right-click a part ▸ Information (values, nodes, bias V across / I / P), Edit Attributes, Rotate, Flip, markers.
- Fixes: `.PROBE -I(L1)` kept its sign; context-menu items no longer fire on the right-button release;
  symbols/selection never drawn beyond a trace's data; panning stays within the simulated range; Escape closes menus.
## 0.3.1 — 2026-10-11
- Fix: `.tran 1us 4ms 0ms 0 UIC` failed with "step ceiling too small": TMAX = 0 was divided by. TMAX omitted or 0 now
  means automatic (TSTOP/200) in both Netlist Mode and the Transient dialog; negative/invalid TMAX is rejected with an explanation.
- New shared transient planner (src/core/tranPlan.ts): per-run limit (2M internal steps) and across-sweep output limit
  (200k stored points); errors say "per run" or "across the sweep (N runs × M points)" and suggest a valid setting.
  Large workloads store output at the Print Step (.option interp) while the solver keeps the requested step ceiling.
- New: PSpice `Xn a b Sw_tOpen/Sw_tClose PARAMS: …` instances in netlists are expanded to ngspice timed switches.
- New: `.PROBE I(L1) …` signals become the initial Probe traces.
- Probe: transient axis starts at 0 s; legend scrolls so many parametric traces never hide the plot.
## 0.3.0 — 2026-10-10
- Fix: Probe x-axis labels lost precision when zoomed (showed "2 2 2 2"); new adaptive axis formatter.
- Fix: Sw_tOpen/Sw_tClose symbols redrawn from canonical geometry; labels avoid the arrow in every orientation.
- New: PARAMETERS block, {expressions} in values, Parametric analysis (independent ngspice runs), multi-run Probe.
- New: Netlist Mode workspace (mode button), .STEP/.MEAS, syntax highlighting, find/replace, provenance tracking.
- New: Probe menus, black background (PSpice), Axis Settings, message log; trace expressions incl. V across and W power.
- New: draggable labels, wire insertion/merging, floating tooltips, Zoom Area, PSpice-order toolbar and page frame, XP colours.
- New example: switched RL with parametric Rh (topology assumed, see docs/REFERENCE_CIRCUITS.md).
## 0.2.0 — 2026-10-10
- Fix: transient with PSpice's default 20ns Print Step and a long Final Time produced tens of millions of
  points (no graph / hang). An explicit max step (Step Ceiling, default Final/200) is now always passed.
- Fix: capacitor/inductor IC= now follows PSpice: bias point computed with ICs held, transient starts from it
  (works without UIC, for inductors, and for capacitors with no grounded pin). Bias display shows that state.
- New parts: Sw_tClose, Sw_tOpen (time-controlled switches) for first/second-order switching labs.
- New Netlist Editor (toolbar .cir button, Ctrl+2, File ▸ New/Open/Save Netlist): write or open .cir decks and
  simulate them; PSpice-isms translated with notes; unsupported statements reported.
- Netlist viewer shows the last simulated deck(s); "Open in Netlist Editor"; Netlist button in Probe.
- New examples: source-free RC, switched RC, source-free underdamped RLC.
- Tests: 12 new (57 total).
## 0.1.0 — 2026-10-10 (Milestone 1)
- Initial PSpice-style browser editor: menus, toolbar, status bar, page border, dotted grid.
- Part library (14 parts), Part Browser, attribute editing with SPICE unit parsing.
- Orthogonal wiring, connectivity extraction, junction rules, net aliases, ERC.
- ngspice-backed bias point, transient, DC sweep, AC sweep; Probe viewer with markers, cursors, export.
- .osch save/load, autosave, examples (File ▸ Open Example).
- Reference tests A–I.
