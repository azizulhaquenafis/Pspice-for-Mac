# Architecture

```
src/core/        pure TypeScript, no DOM — shared by browser, tests, future Tauri app
  model.ts         versioned document model (parts, wires, junctions, labels, markers, profile, view)
  library.ts       part definitions: symbol geometry, pins, properties, netlist rule
  connectivity.ts  union-find net extraction from geometry (rules documented in file header)
  netlist.ts       ERC + SPICE netlist generation + current sign conventions
  units.ts         SPICE engineering-number parsing/formatting
  serialize.ts     .osch JSON (de)serialization with validation
  examples.ts      example circuits (also used by tests)
src/sim/         engine abstraction + result model
  types.ts         SimulationEngine interface, Plot/Vector
  rawParser.ts     ngspice ASCII rawfile parser
  httpEngine.ts    browser engine -> local ngspice service
server/          Node side
  ngspiceRunner.ts validates netlist, builds .control deck, spawns `ngspice -b`, timeout/cancel
  ngspicePlugin.ts Vite middleware POST /api/simulate (127.0.0.1 only)
src/state/       zustand store (snapshot undo/redo, selection, tools) + actions.ts command layer
src/ui/          React: Canvas (SVG schematic), Symbol, Dialogs, Probe (canvas plot), App (menus/toolbar)
tests/           vitest: units, connectivity (G), simulation (A–F, H), serialization (I)
```

Data flow: Doc → `extractConnectivity` → `generateNetlist` → `engine.run` → `parseRawAscii` → `probeModel` → Probe/bias overlay.

Key decisions
- **Engine**: native ngspice-47 via a local service. Verified working; the same runner becomes a Tauri
  sidecar in M4. ngspice-WASM (eecircuit-engine / ngspice-wasm) not yet evaluated — the `SimulationEngine`
  interface allows adding it without touching the UI.
- **Analyses** are emitted as dot-cards in the visible netlist; the runner converts them to `.control`
  commands and writes each plot to an appended ASCII rawfile. AC runs in a separate pass because ngspice-47
  `savecurrents` breaks `write` in AC.
- **Node names**: ground → `0`; net alias → alias; otherwise `N0001…` ordered by lowest `REF:pin`. Never coordinates.
- **Undo/redo**: immutable document snapshots per command (structural sharing), max 200.
- **Current sign**: every current vector is "into pin 1 / + terminal" (SPICE convention); marker on the other
  pin is shown as `-I(Rx)` with negated values.
- **File format** `.osch`: JSON `{format:"openspice-schematic", version:1, title, parts[], wires[], junctions[], labels[], markers[], profile, view}`.
  Coordinates in world units (grid = 10). Loader validates types/geometry and fills profile defaults.
