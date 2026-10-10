# UI reference notes
Source: knowledge of PSpice 9.1 Schematics/Probe (not yet verified against your screenshots).
- Window: title bar "<app> - [Schematic1 p.1]", menu bar File Edit Draw Navigate View Options Analysis Tools Markers Window Help.
- Toolbar order (approx.): file ops | clipboard, undo | redraw, zooms | wire, bus, block, get part + part-name combo, attributes | setup, simulate | V/I bias display | markers.
- Canvas: white page with zone border (numbers across, letters down), dotted grid; selected objects red.
- Analysis Setup: two-column grid of [Enabled ☐][Button] entries (AC Sweep, Load/Save Bias Point, DC Sweep, Monte Carlo, Bias Point Detail, Digital Setup, Options, Parametric, Sensitivity, Temperature, Transfer Function, Transient).
- Transient dialog: Print Step, Final Time, No-Print Delay, Step Ceiling, Detailed Bias Pt., Skip initial transient solution, Fourier section.
- Probe: plot with x-axis label, legend of trace names below, Cursor A1/A2 table with dif.
Unverified: exact part/wire colours (currently navy), fonts (Tahoma 11px), exact shortcut table (see Help ▸ Keyboard Shortcuts). All are CSS tokens in src/ui/theme.css.

See docs/UI_FIDELITY.md for the screenshot-by-screenshot comparison (0.3.0).
