# Changelog
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
