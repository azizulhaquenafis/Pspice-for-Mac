# Device models shipped with OpenSpice

Every default model below was written for OpenSpice (original work, same licence as the project). None is
copied from a PSpice/Cadence library or a vendor model file. All of them are editable per part, either
field by field or by pasting your own `.model` card with **Edit Attributes ▸ Import .model...**. Paste only
models you are allowed to use; the card is stored with the part, inside your schematic file.

An empty model field means "ngspice default" (the parameter is left out of the `.model` card).
Model fields accept `{expressions}` of global parameters, so they can be swept (Analysis ▸ Parametric).

## Diodes (`.model <name> D(...)`)

| Part | Model | Parameters | Provenance |
|---|---|---|---|
| Dbreak | `Dbreak` | IS=1e-14, N=1 (all else ngspice default) | ngspice/SPICE default diode, like PSpice's breakout part |
| D1N4001 | `D1N4001` | IS=2.93n N=1.8 RS=0.042 CJO=36p VJ=0.5 M=0.4 TT=3u BV=60 IBV=5u | OpenSpice fit to public 1N4001 datasheet figures (below) |
| ZENER | `DZ5V1` | IS=1e-14 N=1 RS=2 CJO=100p VJ=0.75 M=0.33 TT=50n BV=5.1 IBV=5m | educational 5.1 V Zener (below) |
| D1N4148 | `D1N4148` | unchanged from earlier versions (fixed card) | generic small-signal model |

### D1N4001 fit (not a vendor model)
The targets are datasheet-level figures common to 1N4001 data sheets: VF ≤ 1.1 V at 1 A (typically about
0.93–1.0 V), VRRM = 50 V, and junction capacitance of about 15 pF at 4 V reverse.
* N = 1.8 is typical of rectifier junctions. IS is chosen so that VF = 0.70 V at 10 mA:
  IS = 10 mA / exp(0.70 / (1.8·Vt)) ≈ 2.93 nA.
* RS = 0.042 Ω gives VF ≈ 0.957 V at 1 A (simulated: tests/devices.test.ts).
* CJO = 36 pF with VJ = 0.5 V and M = 0.4 gives 36p / (1 + 4/0.5)^0.4 ≈ 15 pF at 4 V.
* BV = 60 V is above the 50 V rating, so a correctly used part never breaks down; IBV = 5 µA.
* TT = 3 µs is an estimate for a general-purpose rectifier (datasheets rarely give it). It only affects
  reverse recovery in fast transients.
* Leakage is IS, about 3 nA, which is far below the datasheet's maximum of 5 µA.

### DZ5V1 (educational Zener)
BV = 5.1 V is reached at IBV = 5 mA. The actual regulation voltage depends on the operating current and
on RS. In the Zener Voltage Regulator example (12 V, 1 kΩ, 10 kΩ load, about 6.4 mA) the output is
5.119 V. Forward conduction behaves like a normal diode (about 0.7 V).

## BJTs (`.model <name> NPN|PNP(...)`)
| Part | Model | Parameters |
|---|---|---|
| QNPN | `QNPN` | IS=1e-14 BF=100 BR=1 VAF=100 CJE=8p CJC=3p TF=0.4n TR=50n |
| QPNP | `QPNP` | same values, PNP |

These are textbook Gummel-Poon subsets with round numbers, so hand calculations are easy (β ≈ 100,
Early voltage 100 V). They do not represent any particular commercial transistor. Terminal order in the
netlist is `Q C B E model`.

## MOSFETs (`.model <name> NMOS|PMOS(LEVEL=1 ...)`)
| Part | Model | Parameters | Instance |
|---|---|---|---|
| MbreakN | `MbreakN` | LEVEL=1 VTO=1 KP=200u LAMBDA=0.02 GAMMA=0 PHI=0.6 | W=10u L=1u |
| MbreakP | `MbreakP` | LEVEL=1 VTO=-1 KP=100u LAMBDA=0.02 GAMMA=0 PHI=0.6 | W=10u L=1u |

These are Shichman-Hodges (LEVEL 1) models: I_D = ½·KP·(W/L)·(V_GS − VTO)²·(1 + λ·V_DS) in saturation.
The defaults give β = KP·W/L = 2 mA/V² for NMOS; the PMOS needs W = 20u for the same β. The bulk is a real
fourth terminal (`M D G S B model W= L=`). With GAMMA > 0 the threshold rises with V_SB
(checked against γ(√(2φ + V_SB) − √(2φ)) in tests).

## Current sign conventions in Probe
All terminal currents shown by OpenSpice (markers, Probe traces, the bias "I" display, Part Info) are the
current **into** the named terminal.
* ngspice saves `@d[id]` (anode → cathode), `@q[ic] @q[ib] @q[ie]` and NMOS `@m[id] @m[ig] @m[is] @m[ib]` in
  that convention.
* For **PMOS**, ngspice-47 saves the MOS1 terminal currents in the device frame, which is the negative of
  "into the terminal". This was checked against series resistors. OpenSpice flips the sign, both for
  schematic parts and for PMOS devices in hand-written decks (found through their `.model ... PMOS` card).
* In an **AC sweep** ngspice saves no device currents, so Probe reports them as unavailable instead of
  showing zero.
