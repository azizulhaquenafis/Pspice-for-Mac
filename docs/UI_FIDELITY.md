# UI fidelity vs. the PSpice reference screenshots

Screenshots supplied by the user (2026-10-10), compared with OpenSpice browser screenshots taken in the
in-app browser. Colours were sampled/clustered from the images with PIL (JPEG, low resolution → approximate).

| # | Reference screen | Structure observed | OpenSpice now | Remaining differences |
|---|---|---|---|---|
| 1 | Probe plot zoomed near 2 ms (user's bug report) | x labels all "2" | Adaptive axis (src/ui/axis.ts): 2199.0µs … 2201.0µs, unique labels, tested ranges 0–4 ms … 0–100 ns | — |
| 2 | PSpice Schematics, empty page (A-size) | XP title "PSpice Schematics - [ Schematic2  p.1 ]"; menu File…Help; one toolbar row; left vertical drawing toolbar; blue page border with "2 1" / "B A" zones, centre arrows, title block bottom-right; status "1.01, 0.68  message … Cmd: Area" | Same title format, menu order, toolbar order (file, clipboard, undo, redraw/zoom incl. working Zoom Area, wire/bus/block/get part/part-name combo/attributes/symbol, setup/simulate, markers, V/I bias), left vertical toolbar, blue frame with zones, arrows and title block, two-cell status bar with inch coordinates and "Cmd:" | No native window buttons (browser); bus/block/symbol editing and "None" probe-setup combo not implemented (bus/block/symbol shown disabled, combo omitted); toolbar wraps to two rows below ~1000 px window width; vertical toolbar holds OpenSpice tools rather than graphics (line/box/arc) tools |
| 3 | Analysis Setup dialog | Two columns of [Enabled][button]; left: AC Sweep, Load/Save Bias Point, DC Sweep, Monte Carlo/Worst Case, Bias Point Detail, Digital Setup (no box); right: Options (no box), Parametric, Sensitivity, Temperature, Transfer Function, Transient; Close top-right | Identical arrangement; working: AC, DC, Parametric, Transient, Bias Point Detail (always on); others disabled with tooltip | XP rounded button style approximated with flat bevels |
| 4 | OrCAD PSpice A/D Probe (AC) | Black plot, white axis text with units ("10KHz"), x title "Frequency"; menu File Edit View Simulation Trace Plot Tools Window Help; bottom: message log + analysis info panel; status bar | Black plot default, unit-suffixed ticks, x title Time/Frequency, Probe menu (File Edit View Simulation Trace Plot Tools), message log built from real run data, Start/End info panel | Probe is a pane inside the main window (not a separate MDI window); no Watch/Devices tabs; no multiple plot panes or multi-y-axes yet |
| 5 | Schematic "lab12" with bias display | Parts green, wires lighter grey-green, part text slate blue, junctions navy, bias voltages in filled green boxes, "(stale)" in title | Tokens: --part #2f8a2f, --wire #4f8f5f, --part-text #4a55a8, --junction #001070, --bias-fill #55aa55 with dark text | Exact RGB uncertain (JPEG); BJT/MOSFET symbols not yet in library; stale marker shown in Probe, not title |

Checklist of screens reviewed in the browser this session: empty editor, switch symbols at 0/90/180/270/mirror,
switched-RL schematic with bias display, Analysis Setup, Parametric dialog, Probe (parametric traces, 2.199–2.201 ms zoom),
Netlist Mode (generated netlist, run, messages), return to Schematic Mode.
