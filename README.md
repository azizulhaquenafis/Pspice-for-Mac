# OpenSpice Schematics

A PSpice 9.1 Schematics–style circuit editor with real ngspice simulation and a Probe-style waveform viewer.
Browser version first (Milestone 1); native macOS app (Tauri) planned for Milestone 4.

## Online (Vercel or any static host)
`npm run build` produces a static site in `dist/`. Simulations run with ngspice compiled to WebAssembly in the
visitor's browser — no server, nothing to install. Vercel: import the GitHub repo (framework Vite, see vercel.json).
Test the production build locally: `npm run build && npm run preview` → http://127.0.0.1:4173

## Run
Requirements: Node 20+, ngspice on PATH (`brew install ngspice`).

    npm install
    npm run dev        # open http://127.0.0.1:5173
    npm test           # reference + unit tests (native ngspice)
    npm run test:wasm  # same suite on ngspice-WebAssembly (the online backend)

Set `NGSPICE_BIN=/path/to/ngspice` to use a specific binary.

See PROJECT_SPEC.md, ARCHITECTURE.md, FEATURE_MATRIX.md, KNOWN_ISSUES.md.
Not affiliated with Cadence, OrCAD or MicroSim. ngspice is BSD-3-Clause licensed.
