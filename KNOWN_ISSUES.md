# Known issues / limitations
- Online (WebAssembly) engine: the first visit downloads the ngspice engine (~20 MB uncompressed, cached afterwards);
  each simulation is limited to 120 s; ngspice runs in the browser, so very large circuits depend on the visitor's machine.
- AC analysis: device currents of R/C/L/D are not available (ngspice-47 savecurrents bug); voltages and V-source currents are.
- IC= handling in .cir decks applies to top-level C/L lines only (not inside .SUBCKT).
- Current marker on a pin shared by two parts picks the first part found there.
- Bias labels can be hidden under markers.
- Results may differ numerically from PSpice (different simulator); PSpice-specific syntax is not translated yet.
- Visual colours/fonts are from memory of PSpice 9.1, not yet verified against screenshots (please send some).
- Moving a part whose pin sits mid-wire (not at a wire end) does not drag that wire.
- F11/F12 on Mac keyboards need fn; Cmd+W/Cmd+N cannot be intercepted by browsers — use Ctrl.
- Recovery prompt uses a native confirm() dialog.
- Wire hit-testing at very low zoom may select a wire instead of a nearby part.
- Bias-point value boxes can overlap net-alias text (no label collision avoidance yet).
- Switched-RL reference example topology is assumed (the course schematic was not provided) — docs/REFERENCE_CIRCUITS.md.
- Toolbar wraps to two rows when the window is narrower than ~1000 px.
- Colours were sampled from low-resolution JPEG screenshots; exact PSpice RGB values unverified.
- BJT, MOSFET, op-amp and transformer symbols still missing from the part library.
- Parametric sweeps over model parameters, nested parametric + DC sweep, Monte Carlo not implemented.
- Netlist Mode cannot read .LIB/.INC files (no file system access from the browser); paste models instead.
- Probe is one pane (no multiple plot windows / y-axes); no Watch/Devices tabs.
- A new PARAMETERS block starts empty; two blocks defining the same name are an ERC error.
- With UIC, ngspice output starts at the first timestep (e.g. 10 ns), not t = 0; the Probe axis still starts at 0 s.
- Netlist-mode Sw_tOpen/Sw_tClose expansion supports the PARAMS tOpen/tClose, ttran, Rclosed, Ropen only.
- Probe still lacks Fourier (FFT), multiple plot windows / y-axes, .dat save/load and Performance Analysis.
- Trace styles, marks and selections are per session (not saved in the project yet).
- E/F/G/H parts saved with 0.4.1–0.4.2 had output pins at x = 60; they are now at x = 40 again — reconnect those output wires.
- .sch import is built from the documented PSpice 9.1 layout and tested on a hand-made file; real course files may contain constructs not handled yet — please send one. PSpice symbol libraries (.slb) are proprietary, so OpenSpice symbols are aligned to the imported wires (reported in the import report). Only page 1 is imported.
- The Print Step auto-fix changes only the simulated deck; the Transient dialog keeps the value you typed (the warning shows the value used).
- Device currents reported by ngspice close KCL/KVL to RELTOL = 0.001 (the PSpice default too). For example,
  the Zener current differs from (V_S − V_Z)/R by about 0.15 % at the default; with .option reltol=1e-6 the
  difference vanishes. Simulation options are not editable in the schematic yet (use Netlist Mode).
- ngspice does not save device currents in AC sweeps, so current markers and I(...) traces are unavailable in AC.
- Shipped device models are educational, or an OpenSpice datasheet fit for D1N4001 (docs/MODELS.md). They are
  not vendor models; paste a vendor card with Import .model if you have one you may use.
- BJTs have no substrate pin (3-terminal C B E). MOSFETs are 4-terminal only (no MbreakN3-style 3-pin part).
- .sch import of transistors and the new diodes is untested (no reference file); check the import report.
- The netlist writes numbers in plain decimal form (W=0.00001, not 10u). This is numerically identical.
- DC sweeps of a global parameter (and log/list DC sweeps) run one ngspice bias point per value. They are limited
  to 500 points and are slower than a native .dc (about 10 ms per point natively; more with WebAssembly).
  A nested DC sweep and Model Parameter sweeps are not yet available.
- In such stepped DC sweeps capacitor/inductor IC= attributes are ignored (a DC sweep is a series of bias points).
- In Netlist Mode, .DC PARAM cannot be nested with a second sweep on the same line; .STEP + .DC PARAM works.
