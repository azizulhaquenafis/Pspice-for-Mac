# Test results — 2026-11-25 (v0.5.1 production audit: ngspice-46 split-WASM via @o.z/ngspice-wasm@0.0.0, cross-checked vs native ngspice-47 on macOS arm64)

`npm test` → **18 files, 170 tests, all passed** (after `npm ci` & `npx tsc -p .`).

## 0.5.1 — Production Audit, AC Branch Currents, Performance & Memory Stress Tests (`tests/production-audit.test.ts`)

### AC Branch-Current Resolution (Zero-Volt Sensing + Native Inductor Branch)
| Circuit | Signal | Analytical / Native (ngspice-47) | WASM (ngspice-46) | Max |Δ| | Result |
|---|---|---|---|---|---|
| RC low-pass AC @ fc = 159.155 Hz | `I(R1)`, `I(C1)` | `0.5000 + j0.5000 mA` (`0.7071 mA ∠ +45°`) | `0.5000 + j0.5000 mA` (`0.7071 mA ∠ +45°`) | `< 1e-12` | pass |
| RC low-pass AC pin-2 sign & KCL | `I(R1:2)`, `I(R1)+I(V1)` | `-I(R1)`, `0 + j0` | `-I(R1)`, `0 + j0` | `< 1e-12` | pass |
| Mixed R+C+L+Diode (`D1N4148` DC biased) AC | `I(R1)`, `I(C1)`, `I(L1)`, `I(D1)`, KCL | Native ngspice-47 exact complex values | Exact match (`KCL = -1.06e-20`) | `≤ 3.31e-18` | pass |
| Dependent `G1` & coupled inductors `K1 L1 L2` AC | `I(G1)`, `I(L1)`, `I(L2)` | `I(G1) = +2 mA`, `V(ng) = -2 V` | `I(G1) = +2.0000 mA`, `V(ng) = -2.0000 V` | `< 1e-9` | pass |

### Before vs After Split-WASM Performance & Size (Chrome + Node)
| Metric | Before (0.5.0 inline base64 JS) | After (0.5.1 split `.wasm` + streaming) | Delta |
|---|---|---|---|
| Worker JS chunk (`dist/assets/ngspiceWorker-*.js`) | `7,189.19 kB` | `64.25 kB` | **−99.1%** |
| Standalone WASM binary (`dist/assets/ngspice-46-*.wasm`) | inline base64 | `5,347.41 kB` (`5.10 MB`) | native `application/wasm` |
| Total compressed download (gzip) | `2.36 MB` | `1.74 MB` (`21.6 KB` JS + `1.72 MB` WASM) | **−26.3%** |
| Total compressed download (brotli / Vercel CDN) | `1.65 MB` | `1.18 MB` (`~18 KB` JS + `1.16 MB` WASM) | **−28.5%** |
| Cold-start first simulation (Chrome, uncached) | `237–255 ms` | `171.5 ms` (`compileStreaming`: `68 ms`) | **−28% to −33%** |
| Warm simulation median (Chrome) | `~7–10 ms` | `7.3 ms` (`3.78 ms` avg over 500 runs) | fast & stable |
| Cached page reload (Chrome, `immutable` headers) | — | `88.5 ms` (0 server requests for JS/WASM) | 100% cache hit |
| 4x CPU throttle + Fast 3G network (uncached) | — | `549.1 ms` (`ok: true`) | responsive |

### 500–750 Consecutive Runs Memory Stability & Large-Circuit Scaling (Chrome)
- **500 consecutive runs:** `500 / 500` passed in `1,890.4 ms` (`3.78 ms/run`); main-thread JS heap `0.71 MB → 1.72 MB`.
- **750-run Chrome multi-process RSS stability (with GC):** start `587.0 MB` → after 1st run `867.0 MB` → 250 runs `947.9 MB` → 500 runs `943.0 MB` (**−4.9 MB**) → 750 runs `985.7 MB` (flat plateau; no unbounded leak across 192 GB of cumulative virtual allocations).
- **Large circuits (real Chrome Web Worker):**
  - 100-component ladder OP: `11.0 ms` (`V(n50) = 50.000000 V`)
  - 500-component ladder OP: `23.0 ms` (`V(n250) = 250.000000 V`)
  - 1,000-component ladder OP: `48.4 ms` (`V(n500) = 500.000000 V`)
  - 100-component (50-stage) RC ladder transient: `38.9 ms` (`69 pts`)
- **Rapid worker cancel/recreate:** 5 cycles in Chrome (`81.6 ms`), 10 cycles + queued abort in Vitest (`tests/production-audit.test.ts`), all recovered cleanly.

### Full GUI Regression & Cross-Browser Verification (`dist/` on Vercel-matching static server)
- **Google Chrome (headless CDP):** Passed all 6 `vercel.json` routing/MIME checks (`application/wasm`, SPA rewrite, missing `.wasm`/`.js` → `404`), lazy loading verified (`false` before first sim), all **9 bundled schematic examples**, all **8 Netlist Mode examples**, AC Bode Magnitude/Phase + `I(R1)`/`I(C1)` multi-trace Probe plot, component edit (`R2: 3k→2k`, `6V→5V`) + Undo (`6V`) + Redo (`5V`), Zoom In/Out/Pan/Fit, CSV export download, `About` diagnostics dialog, semiconductor (`D1N4148`, `2N2222`) & dependent source (`E1`), GUI cancellation + recovery, mobile `390×844` touch emulation + `visibilitychange` background/foreground recovery. **0 console errors, 0 page exceptions, 0 `/api/simulate` hits.**
- **Firefox 150 (headless):** Verified split `.wasm` (`ngspice-46-*.wasm`) streaming inside `ngspiceWorker-*.js`, OP (`5 V`), AC currents (`I(R1) = 0.7071 mA`, `I(C1) = +45°`), and 50 consecutive runs (`50/50 passed`, `3,011 ms`).
- **Not tested (manual verification pending):** Microsoft Edge (not installed), Safari (`safaridriver` remote automation disabled), Brave headless CDP connection refused, Android Chrome & iOS Safari (no physical devices attached), and live Vercel preview URL (`vercel` CLI not installed/authenticated).

---

## 0.5.0 — Client-side WASM accuracy, isolation & production browser verification (`tests/wasm-accuracy.test.ts`)

| Benchmark Circuit | Expected / Reference | WASM (ngspice-46) | Native (ngspice-47) | Max |Δ| | Result |
|---|---|---|---|---|---|
| 1. Voltage divider (10 V, 1 kΩ / 1 kΩ) | V(mid) = 5.0000000 V | 5.0000000 V | 5.0000000 V | 0.00e+0 | pass |
| 2. Ohm's law (10 V across 1 kΩ) | I(R1) = 10.000000 mA | 10.000000 mA | 10.000000 mA | 0.00e+0 | pass |
| 3. RC transient (5 V step, 1 kΩ, 1 µF, IC=0) | Vc(1 ms) = 3.160603 V | 3.1605997 V | 3.1605997 V | 1.78e-15 V | pass |
| 4. RC low-pass AC (1 kΩ, 1 µF, fc=159.155 Hz) | −3.010300 dB, −45.00000° | −3.0103000 dB, −45.000000° | −3.0103000 dB, −45.000000° | 0.00e+0 | pass |
| 5. DC sweep (0–10 V across 1 kΩ, 21 pts) | I(R1) @ 10 V = 10.000000 mA | 10.000000 mA | 10.000000 mA | 0.00e+0 | pass |
| 6. Diode D1N4148 (5 V, 1 kΩ) & Zener DZ5V1 (12 V, 1 kΩ) | vs native ngspice-47 | Vd = 0.69573721 V, Id = 4.3042628 mA, Vz = 5.1428419 V | Vd = 0.69573721 V, Id = 4.3042628 mA, Vz = 5.1428419 V | ≤ 5.95e-14 | pass |
| 7. BJT 2N2222, NMOS Level-1, PMOS Level-1 | NMOS Vd=3.0 V / Id=4.0 mA; PMOS Vd=2.0 V; BJT vs native | BJT Vc = 6.4394371 V / Ic = 11.121126 mA; NMOS 3.0000000 V / 4.0000000 mA; PMOS 2.0000000 V | BJT Vc = 6.4394371 V / Ic = 11.121126 mA; NMOS 3.0000000 V / 4.0000000 mA; PMOS 2.0000000 V | ≤ 3.91e-14 | pass |
| 8. Repeated runs & state isolation | Zero `.option interp`, `.temp`, `.param`, or prior-run leakage across 15+ consecutive runs | exact | — | — | pass |
| 9. Invalid circuits, timeouts, cancel, OOM & worker recovery | Syntax error, undefined param, unknown model, V-loop, floating node, ERC missing ground, worker timeout/cancel/crash/stale-ID filtering → clean recovery | exact | — | — | pass |

Production build & real-browser verification (`dist/`):
- `npm ci` + `npx tsc -p .` + `npm test` (17 files, 160 tests) + `npm run build` (`dist/assets/index-*.js` 343.6 kB / 113.3 kB gzip; `dist/assets/ngspiceWorker-*.js` 7.19 MB / ~2.36 MB gzip): **all passed**.
- **Google Chrome (headless CDP)** against BOTH `npm run preview` AND a plain static Node HTTP server serving `dist/` (zero Vite middleware), plus `npm run dev`: verified Bias Point (10V/6V), RC Transient (1028 pts), DC Sweep (21 pts), AC Sweep (251 pts + Bode dB/phase selector), Switched RL 5-run Parametric Sweep, Netlist Mode valid + invalid error dialog + recovery; **0 console errors, 0 page exceptions, 0 requests to `/api/simulate`, `200 OK` on `assets/ngspiceWorker-*.js`**. Also stress-tested 50 consecutive WASM runs inside a real Chrome Web Worker (109 ms total).
- **Firefox 150 (headless)** against production `dist/assets/ngspiceWorker-*.js`: verified OP (`5 V`), RC transient (`1028 pts`), AC (`−3.0103 dB`, `−45°`), invalid netlist error, and recovery (`5 V`) in 218 ms.
- **Pending manual verification**: Safari (`safaridriver` remote automation disabled in system settings) and live Vercel preview URL (`vercel` CLI not installed/authenticated locally).

---

Earlier native ngspice-47 test history (0.1.0–0.4.3):

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
