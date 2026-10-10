# OpenSpice Schematics

A PSpice 9.1 Schematics–style circuit editor with real ngspice simulation and a Probe-style waveform viewer.
Browser version first (Milestone 1); native macOS app (Tauri) planned for Milestone 4.

## Run
Requirements: Node 20+, ngspice on PATH (`brew install ngspice`).

    npm install
    npm run dev        # open http://127.0.0.1:5173
    npm test           # reference + unit tests (uses real ngspice)

Set `NGSPICE_BIN=/path/to/ngspice` to use a specific binary.

See PROJECT_SPEC.md, ARCHITECTURE.md, FEATURE_MATRIX.md, KNOWN_ISSUES.md.
Not affiliated with Cadence, OrCAD or MicroSim. ngspice is BSD-3-Clause licensed.
