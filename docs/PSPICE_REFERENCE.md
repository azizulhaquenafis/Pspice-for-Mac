# PSpice 9.1 Schematics — reference notes
Compiled from prior knowledge of PSpice 9.1 Student / MicroSim Schematics and the public PSpice user guide; items marked (?) need confirmation from screenshots or the user guide.

## Editor structure
Schematics (editor) + PSpice (simulator, text output .out) + Probe (waveforms, .dat). Analysis ▸ Simulate (F11) netlists, simulates and auto-runs Probe.
Menus: File, Edit, Draw, Navigate, View, Options, Analysis, Tools, Markers, Window, Help.

## Placement
Draw ▸ Get New Part (Ctrl+G) opens the Part Browser (Basic/Advanced); the chosen part follows the cursor, Ctrl+R rotates, Ctrl+F flips, each click places another copy with incremented refdes, right-click/Esc ends. Toolbar has a combo box of recently used part names.
Common parts: R, C, L, VDC, IDC, VSIN, VPULSE, VPWL, VAC, IAC, E, F, G, H, D1N4148, Q2N3904, Q2N2222, uA741, AGND/GND_ANALOG/GND_EARTH (net 0), K_Linear, Sw_tClose/Open.

## Wiring
Draw ▸ Wire (Ctrl+W): pencil cursor, click start, click corners, double-click/right-click ends; ending on a pin or wire connects. Junction dots appear automatically where a wire ends on another wire; crossing wires do not connect. Wires stretch (rubber-band) when parts are moved. Net names via Edit ▸ Label or double-clicking a wire (LABEL attribute); same label = same net.

## Attributes
Double-click a part → attribute dialog (Name = Value list, Save Attr). Values accept SPICE suffixes; M = milli, MEG = mega.

## Analysis Setup
Analysis ▸ Setup: enabled checkboxes with buttons for each analysis (see UI_REFERENCE.md). Transient: Print Step, Final Time, No-Print Delay, Step Ceiling, UIC. DC Sweep: swept variable type (Voltage Source, Temperature, Current Source, Model Parameter, Global Parameter), sweep type (Linear, Octave, Decade, Value List), Name, Start, End, Increment, Nested Sweep. AC Sweep: Linear/Octave/Decade, Total Pts / Pts per decade, Start/End Freq, Noise.
Bias point: after simulation, toolbar V and I buttons show node voltages / currents on the schematic.

## Probe
Trace ▸ Add Trace (Insert), markers on schematic auto-add traces (Mark Voltage/Level Ctrl+M, Mark Current into Pin, Voltage Differential). Tools ▸ Cursor ▸ Display: left mouse = A1, right mouse = A2; table shows A1, A2, dif. View ▸ Fit, Zoom Area. AC traces: V()=magnitude, VDB, VP; log x-axis for decade sweeps.

## Files
.sch (schematic, text, proprietary), .cir/.net/.als netlists, .out output, .dat Probe data, .slb/.plb symbol libraries, .lib model libraries. OrCAD Capture (.opj/.dsn) is a different editor (PSpice 10+). This app uses its own .osch JSON; no .sch import yet.

## Schematics vs OrCAD Capture
9.1 Student ships classic Schematics (and Capture Lite); later versions dropped Schematics. Capture uses "Place Part (P)", "Place Wire (W)", PSpice ▸ New Simulation Profile instead of Analysis Setup.

## Simulator differences (PSpice vs ngspice)
Both SPICE3-family; differences in default tolerances, timestep control, some device models and syntax (PSpice `.PROBE`, `.STEP`, `{}` params, `Value List`). This app emits ngspice syntax and states this in the netlist viewer.
