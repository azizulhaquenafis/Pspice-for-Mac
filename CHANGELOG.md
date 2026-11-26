# Changelog
## 0.5.1 — 2026-11-25 (Production audit, split-WASM streaming, AC branch currents, security & diagnostics)
- **Split `.wasm` binary & streaming compilation (`vite.config.ts`, `src/sim/wasmCore.ts`):** Extracted the 5.10 MB ngspice-46 WASM binary into a standalone content-hashed `dist/assets/ngspice-46-<hash>.wasm` asset loaded lazily via `WebAssembly.compileStreaming(fetch(wasmUrl))`, shrinking the worker JS from 7.19 MB to 64.25 kB (−99.1%), reducing compressed transfer by 26% gzip (2.36 MB → 1.74 MB) / 28.5% brotli (1.65 MB → 1.18 MB), and eliminating browser base64 decoding overhead and Rollup `module` externalization warnings.
- **Resolved AC branch-current limitation (`src/sim/deckBuilder.ts`):** Instrumented top-level `R/C/D/G/F/S/I` devices during AC passes with ideal `0 V` DC sensing sources and aliased native AC inductor currents `i(l*)` → `i(@l*[i])`, restoring exact complex magnitude, phase, and SPICE sign-convention currents (`I(R1)`, `I(C1)`, `I(L1)`, `I(D1)`, `W(R1)`, etc.) in AC analysis (verified to ≤ 3.3e-18 vs native ngspice-47, including nonlinear biased diode small-signal models).
- **Security & reliability hardening:** Fixed `src/core/serialize.ts` crashes on `props: null`/`[]`, added 10 MB project cap, prototype-pollution-safe JSON reviver, finite coordinate/view validation; enforced netlist size (1 MB / 50k lines), DC/AC sweep point bounds (250k pts), log cap (512 KB), and rawfile cap (64 MB); fixed queued `AbortSignal` requests to cancel immediately without waiting on an active run; broadened `vercel.json` SPA rewrite exclusion to all file extensions.
- **Lightweight production diagnostics:** Added local-only `getEngineDiagnostics()` (engine version, init state, WASM compile time, run duration, restart count, WebAssembly/Worker/Streaming capability flags) displayed unobtrusively in `Simulation Output` and `About` dialogs.
- **Audit & stress testing (`tests/production-audit.test.ts`):** Added 10 new automated tests (18 suites, 170 tests total), verified 500–750 consecutive runs in Chrome with flat RSS plateau, 100/500/1000-component scaling, 4x CPU + Fast 3G throttling, immutable reload caching, all 9 schematic + 8 netlist GUI examples, and Firefox 150 split-WASM streaming.
## 0.5.0 — 2026-11-25 (Client-side WebAssembly simulation & Vercel deployment)
- Migrated simulation engine from local native `ngspice` + Vite dev middleware (`/api/simulate`) to genuine **ngspice-46** compiled to WebAssembly (`@o.z/ngspice-wasm@0.0.0`, BSD-3-Clause) running inside a dedicated ES module Web Worker (`src/sim/ngspiceWorker.ts` + `src/sim/wasmCore.ts` + `src/sim/wasmEngine.ts`).
- Removed `/api/simulate` Vite server middleware (`server/ngspicePlugin.ts`) and HTTP engine (`src/sim/httpEngine.ts`) so dev, preview, and Vercel static production builds work identically with zero backend server and zero native binary dependencies.
- Extracted shared deck validation, `.control` wrapping, two-pass AC handling, and ngspice error classification into pure TypeScript `src/sim/deckBuilder.ts`.
- Added lazy WASM compilation caching (`WebAssembly.Module`), clean per-pass MEMFS isolation (preventing `.option interp`, `.temp`, `.param`, and stale rawfile leaks), zero-copy `Float64Array` worker transfer, stale-request filtering, 30 s timeout / `AbortSignal` cancellation via worker termination, and automatic worker crash/OOM recovery.
- Added `vercel.json`, `DEPLOYMENT.md`, `THIRD_PARTY_LICENSES.md`, `"preview": "vite preview"` script, and comprehensive accuracy/recovery suite (`tests/wasm-accuracy.test.ts`).
- Retained optional Node-only `server/ngspiceRunner.ts` and `src/sim/nodeEngine.ts` strictly for automated WASM-vs-native numerical accuracy cross-checking.
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
