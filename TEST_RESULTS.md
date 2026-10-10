# Test results — 2026-10-10 (ngspice-47, macOS arm64)

`npm test` → 15 files, 141 tests, all passed (latest run, 0.4.3).

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
