# OpenSpice — Client-Side WebAssembly Simulation & Vercel Deployment

## 1. Architecture Overview

OpenSpice executes genuine **ngspice-46** completely client-side inside the user's browser using WebAssembly inside a dedicated ES module Web Worker:

```
OpenSpice UI (React + Zustand)
  -> Simulation Adapter (src/sim/wasmEngine.ts)
    -> Dedicated Module Web Worker (src/sim/ngspiceWorker.ts, ~64 KB JS)
      -> Streaming WASM Binary (dist/assets/ngspice-46-<hash>.wasm, 5.10 MB raw / 1.72 MB gz / 1.16 MB br)
        -> ngspice-46 WASM Runner (src/sim/wasmCore.ts + src/sim/deckBuilder.ts)
          -> ASCII Rawfile Parser + AC Current Normalization (src/sim/rawParser.ts, normalizePlots)
            -> Probe Expressions & Visualization (src/sim/expr.ts, src/ui/Probe.tsx)
```

### Key Properties
- **No backend server:** Zero API endpoints (`/api/simulate` and the old Vite simulation middleware are completely removed).
- **No native ngspice installation required:** Works identically in `npm run dev`, `npm run preview`, plain static HTTP hosting, and Vercel production deployments.
- **Split WASM binary + streaming compilation:** `vite.config.ts` splits the 5.10 MB ngspice-46 `.wasm` binary out of `@o.z/ngspice-wasm` into a dedicated content-hashed asset (`dist/assets/ngspice-46-<hash>.wasm`) paired with a 64 KB worker script (`dist/assets/ngspiceWorker-<hash>.js`). The browser downloads both **lazily** on first simulation, compiles via native `WebAssembly.compileStreaming(fetch(wasmUrl))`, and caches them immutably across reloads.
- **No external CDNs, API keys, or COOP/COEP headers:** Single-threaded WASM inside a dedicated Web Worker needs no `SharedArrayBuffer` or Cross-Origin Isolation headers.
- **Clean per-run isolation & bounded workloads:** The compiled `WebAssembly.Module` is cached once per worker lifecycle and instantiated fresh per pass (~1–2 ms) with a clean Emscripten MEMFS (`/proc/meminfo`, `/spinit`, `/circuit.cir`, `/out.raw`). Input netlists (1 MB / 50k lines), DC/AC sweep sizes (250k pts), transient step budgets (`tranPlan.ts`), log output (512 KB), raw output (64 MB), and `.osch` imports (10 MB, prototype-pollution & geometry checked) are all bounded.
- **Exact AC branch currents:** During AC analysis, top-level `R`, `C`, `D`, `G`, `F`, `S`, and `I` devices are instrumented with ideal `0 V` DC sensing sources (and native `i(l*)` inductor currents are aliased) so ngspice computes exact complex AC branch currents (including linearized nonlinear diode small-signal conductance and capacitance) without triggering upstream ngspice's AC `savecurrents` bug.
- **Cancellation, timeout, crash recovery & diagnostics:** Aborting a queued or active simulation (`AbortSignal`), exceeding the 30-second timeout, or encountering a worker crash / OOM terminates and cleanly respawns the worker. Non-intrusive engine diagnostics (version, init state, compile/run times, browser WebAssembly/Worker support) appear in `Analysis ▸ Examine Output` and `Help ▸ About OpenSpice Schematics...`.

### Selected WASM Engine
- **Package:** `@o.z/ngspice-wasm` pinned to exact version `0.0.0` (verified in `package-lock.json`)
- **Upstream:** `https://github.com/z-wasm/ngspice-wasm` (tag `ngspice-46`, compiled with KLU, CIDER, FFTW, `-O3`)
- **License:** BSD-3-Clause (ngspice core BSD-3-Clause; full notices in `THIRD_PARTY_LICENSES.md` and `node_modules/@o.z/ngspice-wasm/COPYING`)

---

## 2. Local Build & Verification

### Install reproducibly from lockfile (Linux/macOS CI-safe)
```bash
npm ci
```

### TypeScript check & full automated test suite
All 18 test suites (170 tests) run directly against the real ngspice-46 WebAssembly binary (no native `ngspice` required; if native `ngspice` is available on `PATH`, numerical cross-checks compare WASM vs native automatically):
```bash
npx tsc -p .
npm test
```

### Production dependency vulnerability check
```bash
npm audit --omit=dev
```
(Expected: **0 production vulnerabilities**. Reported dev-only advisories are confined to `vite`/`vitest` development tooling and are never shipped in `dist/`.)

### Production build & local preview
```bash
npm run build
npm run preview
```

### Static-only verification (no Vite server)
Serve `dist/` with any plain static HTTP server that serves `.wasm` as `application/wasm`:
```bash
python3 -m http.server 4174 --directory dist --bind 127.0.0.1
```
Open `http://127.0.0.1:4174/` and verify:
- Initial page load downloads **only** `index.html`, `assets/index-*.css`, and `assets/index-*.js` (neither `ngspiceWorker-*.js` nor `ngspice-46-*.wasm` loads until a simulation runs).
- Running examples (Bias point, RC transient, DC sweep, AC sweep with `I(R1)`/`I(C1)` traces, Switched RL parametric sweep, Netlist Mode) succeeds with zero console errors, `200 OK` on `assets/ngspiceWorker-*.js` and `assets/ngspice-46-*.wasm` (`Content-Type: application/wasm`), and **zero** requests to `/api/simulate`.
- Reloading the page serves `ngspiceWorker-*.js` and `ngspice-46-*.wasm` from browser cache (`Cache-Control: immutable`).

---

## 3. Vercel Deployment Settings

OpenSpice deploys as a pure static Vite site on Vercel with **zero server functions**, **zero environment variables**, and **no native build dependencies** (no Emscripten, Docker, or native ngspice needed on Vercel).

The committed [`vercel.json`](./vercel.json) configures Vercel automatically:

| Setting | Value |
|---|---|
| **Framework Preset** | Vite |
| **Root Directory** | `.` (repository root) |
| **Install Command** | `npm ci` |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |
| **Node.js Version** | 18.x or newer (tested on Node 20+ / 26) |
| **Environment Variables** | None required |

### Asset & Routing Protections (`vercel.json`)
- Explicitly sets `Content-Type: application/wasm` and `Cache-Control: public, max-age=31536000, immutable` for `/*.wasm`.
- Sets `Cache-Control: public, max-age=31536000, immutable` for hashed `/assets/*` bundles.
- SPA fallback rewrite `/((?!assets/|.*\\.[A-Za-z0-9]+$).* -> /index.html` allows deep SPA refreshes while guaranteeing that `/assets/*` and any missing file with an extension (`.wasm`, `.js`, `.mjs`, `.css`, etc.) return `404` instead of `index.html`.

### Manual Preview Deployment & Post-Deploy Verification Procedure
1. Push the repository branch to GitHub/GitLab/Bitbucket connected to Vercel, or run `npx vercel` (preview deployment — **do not** pass `--prod` until verified).
2. Open the generated `https://<preview>.vercel.app/` URL over HTTPS in Chrome, Firefox, and Safari (plus a mobile device).
3. In DevTools Network tab:
   - Confirm initial load does not fetch `.wasm` or worker assets.
   - Run `File ▸ Open Example: RC low-pass (AC sweep)` → `Simulate (F11)`.
   - Confirm `/assets/ngspiceWorker-*.js` (`200`, `application/javascript`) and `/assets/ngspice-46-*.wasm` (`200`, `application/wasm`, `content-encoding: br` ~1.16 MB) succeed with `cache-control: public, max-age=31536000, immutable` and zero `/api/simulate` calls.
   - Open `Add Trace…` in Probe and confirm `I(R1)` and `I(C1)` plot alongside `V(OUT)`.
   - Navigate directly to `https://<preview>.vercel.app/assets/missing.wasm` and confirm `404` (not HTML).
   - Refresh `https://<preview>.vercel.app/` and confirm cached reload with zero console errors.
4. Once verified across target browsers, promote the preview deployment to production.

---

## 4. Optional Native Reference Runner (Development Only)

`server/ngspiceRunner.ts` and `src/sim/nodeEngine.ts` are retained strictly as optional Node.js utilities for comparing WebAssembly outputs against a locally installed native `ngspice` binary during numerical validation. They are never imported by the browser application or included in `dist/`.
