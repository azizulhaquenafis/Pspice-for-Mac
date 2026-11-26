# Architecture

```
src/core/        pure TypeScript, no DOM — shared by browser, tests, future desktop app
  model.ts         versioned document model (parts, wires, junctions, labels, markers, profile, view)
  library.ts       part definitions: symbol geometry, pins, properties, netlist rule
  connectivity.ts  union-find net extraction from geometry (rules documented in file header)
  netlist.ts       ERC + SPICE netlist generation + current sign conventions
  units.ts         SPICE engineering-number parsing/formatting
  serialize.ts     .osch JSON (de)serialization with strict geometry, size, and prototype-pollution validation
  examples.ts      example circuits (also used by tests)
src/sim/         engine abstraction + result model
  types.ts         SimulationEngine interface, Plot/Vector
  deckBuilder.ts   shared netlist validation, workload bounds, .control wrapping, zero-volt AC current sensing, error extraction
  rawParser.ts     ngspice ASCII rawfile parser
  wasmCore.ts      ngspice-46 WebAssembly runner (@o.z/ngspice-wasm), streaming WASM compile + clean per-pass MEMFS
  ngspiceWorker.ts dedicated ES module Web Worker hosting wasmCore (off main UI thread)
  wasmEngine.ts    browser SimulationEngine adapter -> Web Worker (lazy init, queue, cancel, timeout, crash recovery, diagnostics)
  nodeEngine.ts    optional Node-only native ngspice engine (accuracy cross-checking only; never bundled in browser)
server/          optional Node-only reference tooling
  ngspiceRunner.ts optional native `ngspice -b` subprocess runner for accuracy comparison tests
src/state/       zustand store (snapshot undo/redo, selection, tools) + actions.ts command layer
src/ui/          React: Canvas (SVG schematic), Symbol, Dialogs, Probe (canvas plot), App (menus/toolbar)
tests/           vitest: units, connectivity (G), simulation (A–F, H), WASM accuracy, AC currents, security, scaling, serialization (I)
```

Data flow: Doc → `extractConnectivity` → `generateNetlist` → `WasmNgspiceEngine` → `ngspiceWorker` (`wasmCore` / ngspice-46 WASM) → `parseRawAscii` + `normalizePlots` → `probeModel` → Probe/bias overlay.

Key decisions
- **Engine**: Genuine **ngspice-46** compiled to single-threaded WebAssembly (`@o.z/ngspice-wasm@0.0.0`, BSD-3-Clause) running inside a dedicated browser Web Worker (`WasmNgspiceEngine`). At build time (`vite.config.ts`), the 5.10 MB `.wasm` binary is split out of the single-file JS bundle into a standalone hashed `dist/assets/ngspice-46-<hash>.wasm` asset (~1.72 MB gzip / ~1.16 MB brotli) paired with a 64 KB worker script (`dist/assets/ngspiceWorker-<hash>.js`), loaded lazily on first simulation via `WebAssembly.compileStreaming(fetch(wasmUrl))`. Works identically in `npm run dev`, `npm run preview`, plain static hosting, and Vercel static deployments with zero backend server, zero native binaries, and zero Cross-Origin Isolation (`COOP`/`COEP`) headers.
- **State isolation & lifecycle**: The compiled `WebAssembly.Module` is cached once per worker lifecycle and instantiated cleanly per simulation pass (~1–2 ms) with a fresh MEMFS to guarantee zero cross-run state leaks. Cancellation (both queued and in-flight), 30 s timeouts, and worker crashes terminate and cleanly recreate the worker.
- **Analyses & AC branch currents**: Analyses are emitted as dot-cards in the visible netlist; `src/sim/deckBuilder.ts` wraps them in `.control` commands and writes each plot to an appended ASCII rawfile (`/out.raw` in MEMFS). Because upstream ngspice 45–47 `.option savecurrents` yields zero-length `@dev[i]` vectors in AC, AC runs in its own pass without `savecurrents`, instrumented with ideal `0 V` DC sensing sources on top-level `R/C/D/G/F/S/I` devices (preserving exact DC operating point and small-signal nonlinear models) while aliasing native AC inductor branch currents `i(l*)` → `i(@l*[i])`. Internal `__aci_*` nodes are stripped and sense currents mapped back to canonical Probe vector names (`i(@r1[i])`, `i(@c1[i])`, `i(@d1[id])`, etc.).
- **Node names**: ground → `0`; net alias → alias; otherwise `N0001…` ordered by lowest `REF:pin`. Never coordinates.
- **Undo/redo**: immutable document snapshots per command (structural sharing), max 200.
- **Current sign**: every current vector is "into pin 1 / + terminal" (SPICE convention); marker on the other pin is shown as `-I(Rx)` with negated values.
- **File format** `.osch`: JSON `{format:"openspice-schematic", version:1, title, parts[], wires[], junctions[], labels[], markers[], profile, view}`. Coordinates in world units (grid = 10). Loader enforces size, prototype-pollution, and finite-geometry validation and fills profile defaults.
