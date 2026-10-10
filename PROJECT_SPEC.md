# Project spec (condensed)

Goal: let an EE student complete PSpice 9.1 Student coursework on Apple Silicon with a faithful
Schematics + Probe workflow and real SPICE (ngspice) results.

Non-negotiables: browser first, then Tauri macOS .app/.dmg sharing the same code; real ngspice only;
honest "not yet available" states; PSpice-like UI/behaviour using original assets; no claims of
PSpice numerical or file-format compatibility unless tested.

## Milestone 1 acceptance (status: met — see TEST_RESULTS.md)
- PSpice-like main window, menus, toolbar, status bar
- R/C/L/sources/ground symbols; placement with preview, rotate, repeat, Esc
- Attribute editing with unit validation
- Orthogonal wiring, junction detection, crossing wires not connected
- Select / move / rotate / delete / undo / redo; save/load
- Automatic netlist; ngspice bias point + transient; plotted results
- Tests A, B, G, I pass; user can draw a divider and get 6 V through the GUI

Full original requirements: see the initial request (milestones 2–4, Probe, Analysis Setup, safety).
