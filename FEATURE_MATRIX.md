# Feature matrix (✅ implemented & tested · 🟡 partial · ⛔ not yet available)

| Area | Feature | Status |
|---|---|---|
| Editor | Place part w/ live preview, grid snap, rotate (Ctrl+R) / flip (Ctrl+F) before placing, repeat, Esc | ✅ (GUI-tested) |
| Editor | Part Browser with search + symbol preview; part-name box on toolbar | ✅ |
| Editor | Auto reference numbering (R1, R2…) | ✅ |
| Editor | Attribute dialog (double-click / Ctrl+E) with unit validation & "M = milli" warning | ✅ |
| Editor | Orthogonal multi-segment wiring, ends on pin/wire, double-click/right-click/Esc end | ✅ |
| Editor | Junction dots (T / 3+ connections); crossing wires stay separate; explicit junction tool | ✅ (Test G) |
| Editor | Net alias labels (double-click wire), text annotations | ✅ |
| Editor | Select, shift-select, rubber-band, move with rubber-banding wires, delete | ✅ |
| Editor | Copy/Cut/Paste incl. junctions and markers (current/power markers follow their part) | ✅ (review B05 test) |
| Editor | Undo/redo all edits; cut/copy/paste | ✅ |
| Editor | Net highlight on wire click | ✅ |
| Editor | Zoom in/out/fit/selection/page, wheel pan, pinch/ctrl-wheel zoom | ✅ |
| Editor | Zoom area, bus, blocks, multi-page, find | ⛔ |
| Parts | R, C (IC), L (IC), VDC, IDC, VSIN, VPULSE, VAC, VPWL, D1N4148, E (VCVS), G (VCCS), AGND, GND_EARTH | ✅ |
| Parts | Sw_tClose / Sw_tOpen time-controlled switches, redrawn (contacts, blade = initial state, arc arrow), all rotations/mirror | ✅ (switch tests + screenshots) |
| Parts | PARAM (PARAMETERS block, 3 name/value slots per block, multiple blocks) | ✅ |
| Netlist | {expressions} in part values ({Rh}, {2*Rh}, {Rh+10}), .param emission, undefined/circular/duplicate errors | ✅ |
| Sim | Parametric analysis: global parameter, voltage/current source value, temperature; linear/octave/decade/value list; ≤ 50 runs; progress + cancel | ✅ (GUI + tests) |
| Sim | Parametric: model parameter sweep | ⛔ |
| Probe | One trace per parametric run with value legend; per-trace x data; CSV x/y pairs | ✅ |
| Probe | PSpice run symbols + grouped legend; trace selection; right-click menus; Section Information (+ run component values) | ✅ (browser-verified) |
| Probe | Trace Property, Evaluate Measurement (11 goal functions, per run), cursor Max/Min/Peak/Trough, Mark Label | ✅ (measure tests + browser) |
| Schematic | Right-click part ▸ Information with bias V/I/P | ✅ (browser-verified) |
| Probe | Fourier (FFT), multiple plots / y-axes, .dat save/load, Performance Analysis, Monte Carlo histograms | ⛔ |
| Probe | Precision-aware axis labels (1-2-5 ticks, unique labels, µs/ns switching), precise cursor/Δt readouts, Axis Settings dialog, wheel zoom/pan | ✅ (axis tests + screenshots) |
| Probe | Draggable part/value/alias/bias text; collision-avoiding bias labels | ✅ |
| Probe | Trace expressions V(a,b), V(R1:1), V(R1) across, I(R1:2), W(R1), DB/P/M/R/IMG/ABS/SQRT…, edit/delete traces | ✅ (expr tests) |
| Editor | Part dropped on a wire is inserted in series; pins split wires; collinear merge; rubber-band wires on moving wires | ✅ (editor tests) |
| Editor | Hover tooltips with descriptions on all toolbar buttons; Zoom Area | ✅ |
| Netlist Mode | Whole-app mode switch (button, Ctrl+1/2), own menus/toolbar/status, SPICE highlighting, find/replace, undo/redo, Messages/Log, bias listing | ✅ |
| Netlist Mode | PSpice Sw_tOpen/Sw_tClose X-instances (PARAMS: tOpen/tClose, ttran, Rclosed, Ropen); .PROBE signals → Probe traces | ✅ (tran-step tests) |
| Sim | TMAX omitted/0 = automatic, invalid rejected, per-run and across-sweep workload limits with suggestions, output interpolation | ✅ (tran-step tests) |
| Sim | Print Step auto-fix (0, > Final Time, absurdly fine, or over the sweep output budget → 1-2-5 value, with a note) | ✅ (tran-step tests, real ngspice) |
| Netlist Mode | .STEP PARAM/TEMP (independent runs), .MEAS results, .SAVE, error line mapping, 8 examples, .cir/.sp/.spice/.net/.txt | ✅ (netlist-mode tests) |
| Netlist Mode | Generated / edited / independent provenance; netlist saved inside .osch | ✅ |
| Netlist Mode | .LIB/.INC files, .FOUR, .TF, .SENS, .NOISE, .STEP of sources/models | ⛔ (reported as errors) |
| Parts | BUBBLE connector (connect by LABEL, '0' = ground) | ✅ (bubble tests) |
| Parts | E, F, G, H dependent sources (PSpice-style symbols; F/H current sensing via 0 V source) | ✅ (dependent tests) |
| Parts | BJT, MOSFET, op-amp, switches, coupled L/transformer, polarized C, Zener, IAC/ISIN/IPULSE | ⛔ |
| Netlist | Graph connectivity, node 0, aliases, ERC (floating pin, no ground, duplicate ref, bad values) | ✅ |
| Netlist | Netlist viewer / copy / export (.cir) | ✅ |
| Sim | Bias point + V/I display on schematic | ✅ (Test A) |
| Sim | Transient (print step, final time, no-print, step ceiling, UIC) | ✅ (Tests B, C, D) |
| Sim | C/L IC= with PSpice semantics (bias point with ICs held, also without UIC; floating caps) | ✅ (order tests) |
| Sim | Default Print Step 20ns with long Final Time (explicit max step = Final/200) | ✅ |
| Netlist editor | Write/open/save .cir, simulate directly, PSpice→ngspice notes, IC= semantics, ignores text after .END | ✅ (netlist tests) |
| Netlist editor | .LIB/.INC files, .STEP, .FOUR, .MEAS, .TF, .SENS, .NOISE | ⛔ (reported as errors) |
| Netlist | View generated + last simulated deck, Open in Netlist Editor, Probe ▸ Netlist button | ✅ |
| Sim | DC sweep (linear, V/I source) | ✅ (Test E) |
| Sim | AC sweep (lin/oct/dec) | ✅ (Test F) — R/C/D branch currents unavailable in AC (ngspice limitation workaround) |
| Sim | Cancel simulation, 30 s timeout | ✅ (untested in automated suite) |
| Sim | Parametric, temperature, sensitivity, TF, noise, Fourier, Monte Carlo, nested sweep | ⛔ |
| Probe | Traces from V/I markers, Add Trace, legend/visibility, auto-fit, drag-zoom, hover X/Y | ✅ |
| Probe | AC dB / magnitude / phase, log frequency axis | ✅ |
| Probe | Cursors A1/A2 with difference readout; dark background | 🟡 (basic) |
| Probe | CSV & PNG export | ✅ ; SVG export ⛔ |
| Probe | Differential voltage marker, multiple y-axes, trace expressions | ⛔ |
| Files | Save/Save As/Open .osch (File System Access API in Chrome; download fallback) | ✅ (Test I) |
| Files | Autosave to browser storage + recovery prompt | 🟡 |
| Files | Print (browser print of schematic) | 🟡 |
| Files | PSpice Schematics .sch import (page 1; library parts R C L V/I sources E F G H D1N4148 switches PARAM BUBBLE grounds; analysis setup) | 🟡 tested on a hand-made 9.1-format file only — real course files still to be verified |
| Files | OrCAD Capture .dsn/.opj import, multi-page .sch, transistor/op-amp parts | ⛔ |
| Desktop | Tauri macOS app | ⛔ (M4) |
