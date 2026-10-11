# Test results — 2026-10-11 (ngspice-47, macOS arm64)

0.6.1 (maximum power transfer): `npx tsc -p .` clean; `npm test` → 21 files, 238 tests, all passed; `npm run test:wasm` → 21 files, 238 tests, all passed; `npm run build` ok.
tests/max-power.test.ts (11, real ngspice). Circuit: VS = 10 V, RS = 50 Ω, RL = {RL}. Expected
P(RL) = VS²·RL/(RS+RL)², with a maximum of 0.5 W at 50 Ω, compared at every point to 1e-9:
- Schematic DC Sweep of global parameter RL: linear 10–200 Ω (peak exactly at 50 Ω), decade 1 Ω–1 kΩ
  (log axis), value list. Axis label "RL", unit Ω. The W marker on RL gives W(RL). No .dc line is written.
- Schematic Parametric RL (bias point only) → "Bias point vs RL" plot, same curve.
- Validation: undefined parameter error; TEMP → `.dc TEMP 0 100 50`; a source sweep with 10 000 points is still native.
- Decade DC sweep of a source: V(OUT) = VS/2 at every point.
- Netlist Mode: .DC PARAM, .DC LIN PARAM, .DC DEC PARAM, .DC PARAM … LIST, and .STEP + .OP give the same curve;
  .STEP RS × .DC PARAM RL gives one curve per RS, each peaking at RL = RS. .DC LIN VS → `.dc VS …`;
  .DC DEC VS → a helpful error.
- Both new examples: peak 0.5 W at 50 Ω.
Browser: the schematic example (DC sweep), the same circuit as a Parametric sweep, and the Netlist Mode example
all draw W(RL) vs RL in Probe. The 40-point sweep takes about 0.43 s with native ngspice.

0.6.0 (sources and semiconductors): `npx tsc -p .` clean; `npm test` (native ngspice-47) → 20 files, 226 tests, all passed; `npm run test:wasm` (ngspice-WebAssembly) → 20 files, 226 tests, all passed; `npm run build` ok.

tests/devices.test.ts (44 tests, real ngspice; the expected values are computed independently in the test). Key simulated values:
| Circuit | Check | Result |
|---|---|---|
| VAC RC low-pass 1 Hz–100 kHz | |H| and phase vs 1/(1+jf/fc) at all 251 points (1e-6 rel / 1e-4°); −3.0103 dB at 159.155 Hz ±0.2 % | pass (fc ≈ 159.14 Hz) |
| VAC | `V1 IN 0 DC 0 AC 10 0`; no transient sine; DC sweep of a VAC; 30° phase → −15° at fc | pass |
| VPULSE RC (1 ms τ) | waveform before TD, mid-rise, high, mid-fall, low, 2nd period; charge 10(1−e^(−t/τ)), discharge; I(R1)=(V(IN)−V(OUT))/1k; TR=TF=0 | pass |
| VPULSE validation | TR+PW+TF > PER and negative TR → errors | pass |
| D1N4001 forward (5 V, 1 kΩ) | V_D = N·Vt·ln(I/IS+1)+I·RS (1e-4 V) | pass |
| D1N4001 reverse (−5 V) | I = −IS | pass |
| D1N4001 DC sweep | monotonic; slope 1/(N·Vt); V_F(1 A) in 0.93–1.1 V | pass (0.957 V) |
| Half-wave rectifier (10 V, 60 Hz) | peak 9.1–9.4 V; negative half-cycles < 1 mV | pass (9.303 V) |
| Zener regulator | V_OUT 5.05–5.3 V; I_Z = (12−V)/1k − V/10k; I(D1:K), W(D1) = V·I; below BV plain divider; regulation | pass (5.119 V, 6.379 mA) |
| NPN common-emitter | V_BE 0.6–0.72; KCL; β 95–115; KVL at the divider; |Av| = gm·(RC‖RL‖ro) ±5 % at 10 kHz; phase 180±3° | pass (VB 2.000, VC 5.769, VE 1.339 V, IC 1.326 mA, |Av| 157.5, −179.5°) |
| NPN switch | cutoff I_C < 1 nA; saturation V_CE < 0.2 V; pulse response | pass |
| PNP bias | V_E > V_B > V_C; I_C, I_B < 0, I_E > 0; KCL; V_EB 0.6–0.72; β | pass (VE 10.66, VB 10.00, VC 6.23 V, IC −1.326 mA) |
| NMOS I_D(V_GS), I_D(V_DS) | 0 below VTO; square law / triode incl. (1+λV_DS), 1e-4 rel | pass |
| NMOS body effect | V_SB = 2 V, γ = 0.5: VT = VTO + γ(√(2.6)−√0.6) | pass |
| NMOS resistive load | triode point satisfies both equations | pass |
| NMOS common-source | I_D from square law; |Av| = gm·(RD‖ro) ±1 %; phase 180±1° | pass (ID 1.134 mA, |Av| 9.739) |
| PMOS switch (10 kΩ) | on > 4.8 V (exact triode check); off < 1 mV; I(M1:D) = −I(RL); KCL over D G S B | pass (4.877 V) |
| PMOS resistive load (DC) | triode equation | pass |
| CMOS inverter | V_OH > 4.999, V_OL < 1 mV, threshold 2.45–2.55 V; pulse inverted | pass (Vth 2.51 V) |
| Parametric | ACMAG={Av}, V2={Vp}, W={Width}, VTO={vt}: every run uses its own value | pass |
| Geometry | NPN switch identical I_C in all 8 orientations; all new parts' pins on grid, distinct, every orientation | pass |
| Persistence / editing | 8 device examples save→reload → identical netlist; place 9 parts, edit, copy/paste, undo/redo | pass |
| Probe | I(Q1:C), IC(Q1), IB(Q1), W(Q1) = Σ V·I; V(Q1)/I(Q1) give helpful errors; currents in AC → "not available"; Add Trace list | pass |
| Netlist Mode | hand-written Q + NMOS + PMOS deck; I(M2:D) = −I(RL); ID(M2) < 0 | pass |
| Part Browser | aliases NMOS/PMOS/NPN/1N4001; categories | pass |
| Axis | DC sweep axis "V_VIN" | pass |

Test-fixture corrections made while writing these tests (the code was not changed to fit them):
- Four KCL/KVL checks at 1e-9 were tighter than ngspice's RELTOL = 1e-3. I confirmed the residual is solver
  tolerance (5e-15 with reltol = 1e-6) and switched to RELTOL-based tolerances.
- CS-amplifier r_o was written as (1+λV_DS)/g_ds; the correct value is 1/g_ds.
- The NPN gain is now measured at 10 kHz: at 1 kHz the 100 µF bypass (1.6 Ω) shifts the phase by about 4°.
- PMOS 1 kΩ on-voltage expectation (> 4.5 V) was wrong: the triode solution is 3.87 V. The example now uses
  10 kΩ. The second gate-low window is 3–5 ms, not 5–7 ms.

Found and fixed while testing: ngspice saves PMOS terminal currents in the device frame (the opposite of
"into the terminal"). OpenSpice now flips them, and markers, Probe, bias display and Part Info agree with
the series-resistor currents. Two examples had a label on the wrong net (PNP collector, PMOS output); fixed.

Browser (dev server): all new symbols in 4 rotations × mirror (rotated-text fix); NPN example simulated from
the GUI (bias V/I display, Probe DB(V(OUT)) about 43 dB); Part Browser alias search "nmos"; Import .model of a
test card → netlist `.model QTEST NPN(...)` and a new bias point; CMOS inverter transient and DC transfer in Probe.

0.5.2: `npx tsc -p .` clean; `npm test` (native ngspice) → 19 files, 182 tests, all passed; `npm run test:wasm` → 19 files, 182 tests, all passed; `npm run build` ok.
- tests/review-regressions.test.ts (19): B01–B15 regressions. Real-ngspice checks: B06 alias "n0001" divider V = 6 V (exact to 1e-6); B07 F1 C+ marker = 1 mA; B08 C IC={V0}, V0=10: v(out) = 10·e^(−t/1 ms) at the first point and at 1 ms (UIC output starts at the first timestep, see KNOWN_ISSUES); unevaluable IC → error.
  Note: the WebAssembly engine under Node mis-detects a stubbed `window` as a browser between runs, so the simulation tests unstub it (browser builds run WASM in a Worker).
- tests/tran-step.test.ts (+3): Print Step 0 / −1 µs / 1 ns / 1 ps for 1 ms → 1 µs; > Final Time → TSTOP/1000; 1 ns for 4 ms → 5 µs; sweep 21 runs 0.1 µs → 0.5 µs (fits 200k); schematic deck uses the fixed step with a warning; `.tran 0 1ms` RC on ngspice: V(OUT)(1 ms) = 1 − e^(−10). The two earlier tests that expected an error for TSTEP 0 / too-fine output were changed to the new requested behaviour (feature change, 2026-10-11); TMAX/TSTART/TSTOP errors unchanged.

`npm test` (native ngspice) → 18 files, 160 tests, all passed; `npm run test:wasm` (ngspice-WebAssembly, the production backend) → 18 files, 160 tests, all passed (0.5.1).

New in 0.2.0 (tests/orders.test.ts), all with PSpice default Print Step 20ns, no Step Ceiling:
| Circuit | Expected | Tol. | Result |
|---|---|---|---|
| Source-free RC, C IC=10V, no UIC | 10e^(−t/0.1); bias V=10; < 20k points | 0.02 V | pass |
| Source-free RL, L IC=1A, no UIC | e^(−10t) A; V(A)=−10e^(−10t) | 3 mA | pass |
| Floating C IC=5V between two 1k | V(A)=2.5, V(B)=−2.5, 5e^(−t/0.2) | 0.01 V | pass |
| Series RLC R=2 L=1 C=0.04, Vc(0)=10 (no UIC, and UIC) | 10e^(−t)(cos√24t + sin√24t/√24) | 0.05 V | pass |
| Sw_tClose RC charging | 6.321 V at 0.1 s | 0.02 V | pass |
| Sw_tOpen RC discharge | 10e^(−1) at 0.1 s | 0.03 V | pass |
| Hand-written .cir RC (.TRAN 20ns 0.5s, .PROBE) | 6.321 V; notes issued; currents saved | 0.02 V | pass |
| Hand-written .cir RLC with IC= (no UIC) | underdamped formula; bias V(A)=10 | 0.05 V | pass |
| .cir translator: after-.END ignored, title rule, .STEP/.LIB/no-analysis errors | — | exact | pass |

Browser check: RLC IC example → ringing V(A), I(L1) in Probe; Netlist Editor → source-free RL deck simulated, notes shown, Probe trace V(A) = −10e^(−10t).

| Test | Check | Tolerance | Result |
|---|---|---|---|
| A Divider | V(OUT)=6 V, I(R1)=2 mA, I(V1)=−2 mA | 1e-6 V / 1e-9 A | pass |
| B RC charge | Vc(0.1 s)=6.3212 V, Vc(0.5 s)=9.9326 V | ±0.005 V | pass |
| C RL step | IL(0.1 s)=0.63212 A | ±0.0005 A | pass |
| D RLC critically damped | Vc vs 10(1−(1+10t)e^−10t) at 6 times; no overshoot | ±0.02 V | pass |
| E DC sweep | Vout=0.6·Vin, 21 points −10…10 V | 1e-9 V | pass |
| F RC AC | −3.0103 dB and −45° at 159.155 Hz | ±0.0005 dB/° | pass |
| G Connectivity | crossing ≠ connected; junction connects; T-junction; near-miss; alias join; ERC | exact | pass |
| H Sign | −I(R1) at pin 2; rotating R2 by 180° negates its current | 1e-9 A | pass |
| I Round trip | save→load deep-equal, identical netlist & pin nets; malformed rejected | exact | pass |
| Units | 21 suffix cases, rejects, formatting | 1e-12 rel | pass |

GUI verification (in-app browser): drew divider from scratch (Part Browser, Ctrl+R, wires, attribute dialogs), F11 → bias display showed 10V and 6V. RC transient example → Probe showed charging curve with marker traces. RC AC example → dB Bode plot on log axis.
Not automated yet: browser UI tests, cancellation, file dialogs.

## 0.3.0 additions
| Suite | Cases | Result |
|---|---|---|
| tests/axis.test.ts | 0–4 ms, 1–3 ms, 1.99–2.01 ms, 2.199–2.201 ms, 2.1999–2.2001 ms, 0–10 µs, 0–100 ns, −5–5 ms, 1.000001–1.000002 s × 4 densities: unique labels that parse back to the tick value; report examples; cursor/Δt precision | pass |
| tests/switch-param.test.ts | Sw_tOpen conducts then opens; Sw_tClose blocks then closes; 7 rotation/mirror combos × 2 types same behaviour; save/reload; {Rx}, {2*Rx}, {Rx+1k}, nested params; undefined/circular/duplicate; sweep generation; divider sweep V=10·Rx/(2k+Rx); source sweep; **switched RL before/during/after 2 ms and 2.2 ms for Rh = 1, 10, 50, 100, 220 vs analytical (0.5 %)** | pass |
| tests/netlist-mode.test.ts | generated divider deck → 6 V; hand-written ≡ generated; .STEP list ≡ schematic parametric; .STEP forms; .MEAS vtau ≈ 6.32; error line mapping; all 8 Netlist Mode examples run | pass |
| tests/editor.test.ts | wire insertion, rubber band, wire drag, merge, text offsets, marker expressions, schematic↔netlist project state round trip | pass |
| tests/wires-expr.test.ts | expressions incl. W power balance, AC DB/P/M | pass |

Browser (in-app) checks performed: switch symbols in 10 orientations; switched-RL parametric sweep → 5 traces; Axis Settings 2.199–2.201 ms → labels 2199.0µs…2201.0µs;
Analysis Setup ▸ Parametric dialog by clicks → values 5 20 75 150 → F11 → 4 runs; PARAMETERS block placed from toolbar;
Netlist Mode button → import generated netlist → F11 → V(OUT) = 6 V; return to Schematic Mode with circuit intact.
Not automated: Playwright-style E2E suite (GUI checks were run interactively), file-picker dialogs.

## 0.3.1 additions (tests/tran-step.test.ts)
| Case | Result |
|---|---|
| TMAX omitted → auto 20µs; TMAX 0 → auto with note; TMAX 0.1µs used as given (output at print step for 21 runs); 20µs × 21 runs unchanged (no interp) | pass |
| Invalid: TMAX −1µs, TSTEP 0, TSTOP 0, TSTART ≥ TSTOP, TSTEP > TSTOP → explained errors | pass |
| Limits: TMAX 0.1ns → "per run", suggests ≥ 2ns; TSTEP=TMAX=0.1µs × 21 runs → "across the sweep (21 runs …)", suggests Print Step; single run over limit → "for this run" | pass |
| User deck `.tran 1us 4ms 0ms 0 UIC` and `… 0.1us UIC`, `.step param Rh 70 80 0.5`: 21 runs, I(L1) via the Probe expression evaluator vs analytical UIC solution at 1, 1.99, 2.1, 2.19, 2.5, 3, 4 ms (0.5 %) for every Rh; 21 distinct final values | pass |
| Transient dialog Step Ceiling "0" → automatic | pass |
Browser: user deck pasted into Netlist Mode, F11 → 21 runs, I(L1) Rh = 70 … 80 plotted from .PROBE, axis 0–4 ms.

## 0.4.0 additions
- tests/measure.test.ts: sine (max/min/p-p/avg/rms/period), RC (YatX, XatNthY, 10–90 % rise = τ·ln9), underdamped overshoot,
  run component values ({Rh} resolved, title line and pass-1 helpers excluded).
- Browser: user deck with `.step param Rh 40 60 1` → 21 runs with symbols; right-click trace → Information shows
  "Step param Rh = 60 … 244 data points"; Details → R4 = 60Ω ({Rh}); Evaluate Measurement Max(-I(L1)) = 126.431m for all runs
  (analytical 0.2·(1−e⁻¹) = 126.42 mA); Cursor Max → A1 = 2.00030 ms; Mark Label drawn; schematic R1 ▸ Information →
  10 V / 6 V, 4 V across, 2 mA, 8 mW.

## 0.4.1 (tests/dependent.test.ts)
E gain 2 → V(OUT) = 2 V; G 1 mS → −1 V on 1 kΩ; F gain 2 with 1 mA control → −2 V, control current +1 mA into C+, output current +2 mA into +; H 1 kΩ → 1 V; all four identical at 90°/180°/270°. Browser: E1/F1/G1/H1 placed and compared with the user's PSpice reference image.

## 0.4.2
tests/marker.test.ts: marker hit area (bubble, lead) and label-avoidance box. Browser: three V markers on parallel resistors compared with the user's PSpice screenshot (bubble, lead, open arrowhead at the node; trace colours after simulation).

## 0.4.3
tests/bubble.test.ts: divider wired only with bubbles → V(OUT) = 6 V and no BUBBLE device in the netlist; bubbles on wire ends join wires; missing/unattached label warnings. E/F/G/H tests re-run with the resized symbols (pin names/positions as in 0.4.0). Browser: bubble-only grounding of V1 and R2 → 10 V / 6 V; V and I markers placed by snapping, sized and coloured; E/F/G/H next to a resistor for size.

## 0.4.4
tests/snapping.test.ts (7) + editor test: wire-point snapping, determinism, pin preference, current-marker pin filter, crossings, reach. Browser (dispatched events, 3 zooms × 3 points): preview ring position == placed marker position in all 9 cases.

## 0.5.0 — production backend
Full suite on ngspice-WebAssembly: 153/153 (divider, RC/RL/RLC, ICs, switches, DC sweep, AC, parametric, .STEP, .MEAS, E/F/G/H, bubbles, Netlist Mode examples). tests/wasm-engine.test.ts: non-ASCII deck, all four analyses in one deck, broken deck does not poison the next run, forbidden statements. Production build served statically (vite preview, no /api — HTTP 404 like Vercel): app selected WebAssembly automatically; switched-RL parametric (5/5 runs) and RC low-pass AC simulated from the GUI.

## 0.5.1 — .sch import
tests/schImport.test.ts (7): parts/values/refs/wires/labels/grounds, wrong orientation corrected (no short), unsupported part reported, title block skipped, .TRAN/.DC setup read, imported circuit simulates to 6 V, misaligned pins joined with a reported stub, non-.sch rejected. Fixture tests/fixtures/divider91.sch is hand-written from the documented format (no real PSpice 9.1 file was available). Browser: imported fixture → report dialog → F11 → V(OUT) = 6 V, transient and DC sweep ran.
