# Reference circuits

## Switched RL with parametric Rh (File ▸ Open Example)
The component list was specified by the user (V3 = 12 V, V2 = 24 V, R4 = {Rh}, R5 = 180 Ω, R2 = 120 Ω,
L1 = 0.24 H, U7 opens at 2 ms, U5 closes at 2 ms, U8 closes at 2.2 ms) but **the schematic itself was not
available in this session, so the topology below is an assumption** — replace it with the course circuit if it differs:

    V3(12V) — U7 Sw_tOpen(2ms) — R2(120) — A ;  L1(0.24H): A → 0 (I(L1) positive downward, into pin 1)
    A — U5 Sw_tClose(2ms) — R5(180) — 0
    V2(24V) — U8 Sw_tClose(2.2ms) — R4({Rh}) — A

Analytical check used by tests/switch-param.test.ts (switch Ron = 0.01 Ω included, Roff = 1 MΩ neglected):
- t < 2 ms: iL = 12 / 120.01 = 0.09999 A
- 2 ≤ t < 2.2 ms: iL = i0·e^−(t−2ms)/τ1, τ1 = 0.24/180.01
- t ≥ 2.2 ms: iL = 24/Rh + (iL(2.2ms) − 24/Rh)·e^−(t−2.2ms)/τ2, τ2 = 0.24/(Rh‖180)
All five Rh values (1, 10, 50, 100, 220) agree within 0.5 % at 1.9, 2.1, 3 and 4 ms.
