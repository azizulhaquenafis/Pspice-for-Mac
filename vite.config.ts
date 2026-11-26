import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VIRTUAL_WASM_ID = 'virtual:ngspice-wasm-url';
const RESOLVED_VIRTUAL_WASM_ID = '\0' + VIRTUAL_WASM_ID;
const DEV_WASM_PATH = '/@ngspice-46.wasm';
const BASE64_WASM_RE = /base64Decode\("([A-Za-z0-9+/=]+)"\)/;

let cachedWasmBytes: Uint8Array | null = null;
function getNgspiceWasmBytes(): Uint8Array {
  if (cachedWasmBytes) return cachedWasmBytes;
  const srcPath = resolve(__dirname, 'node_modules/@o.z/ngspice-wasm/ngspice.js');
  const src = readFileSync(srcPath, 'utf8');
  const match = BASE64_WASM_RE.exec(src);
  if (!match) {
    throw new Error('Could not extract embedded WebAssembly binary from @o.z/ngspice-wasm/ngspice.js');
  }
  const bytes = Uint8Array.from(Buffer.from(match[1], 'base64'));
  // Sanity check WASM magic bytes (\0asm)
  if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error('Extracted @o.z/ngspice-wasm binary failed WebAssembly magic header check');
  }
  cachedWasmBytes = bytes;
  return bytes;
}

/**
 * Splits the 5.10 MB ngspice-46 WASM binary out of @o.z/ngspice-wasm's single-file JS bundle
 * into a genuine hashed `.wasm` asset for browser dev/production builds:
 * - Cuts worker JS from ~7.19 MB to ~80 KB (eliminating 7.1 MB JS base64 string parsing).
 * - Reduces total compressed transfer by ~26% gzip / ~28% brotli.
 * - Enables native browser `WebAssembly.compileStreaming(fetch(wasmUrl))` with `application/wasm`.
 * - Leaves Vitest/Node execution untouched (`virtual:ngspice-wasm-url` resolves to `null`).
 */
function splitNgspiceWasmPlugin(): Plugin {
  const isVitest = !!process.env.VITEST;
  let isBuild = false;

  return {
    name: 'openspice-split-ngspice-wasm',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    configureServer(server) {
      if (isVitest) return;
      server.middlewares.use(DEV_WASM_PATH, (_req, res) => {
        const bytes = getNgspiceWasmBytes();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/wasm');
        res.setHeader('Content-Length', String(bytes.byteLength));
        res.setHeader('Cache-Control', 'no-cache');
        res.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      });
    },
    resolveId(id) {
      if (id === VIRTUAL_WASM_ID) return RESOLVED_VIRTUAL_WASM_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_WASM_ID) return null;
      if (isVitest) return 'export default null;';
      if (!isBuild) return `export default ${JSON.stringify(DEV_WASM_PATH)};`;
      const refId = this.emitFile({
        type: 'asset',
        name: 'ngspice-46.wasm',
        source: getNgspiceWasmBytes(),
      });
      return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
    },
    transform(code, id) {
      if (isVitest) return null;
      if (!id.includes('@o.z/ngspice-wasm') || !id.endsWith('ngspice.js')) return null;
      let transformed = code.replace(BASE64_WASM_RE, 'new Uint8Array(0)');
      // Strip dead Node-only `await import("module")` branch in browser bundles to avoid externalization noise.
      transformed = transformed.replace(
        /const\{createRequire\}=await import\("module"\);var require=createRequire\(import\.meta\.url\)/g,
        'var require=undefined',
      );
      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), splitNgspiceWasmPlugin()],
  server: { port: 5173, host: '127.0.0.1' },
  preview: { port: 4173, host: '127.0.0.1' },
  worker: {
    format: 'es',
    plugins: () => [splitNgspiceWasmPlugin()],
  },
  optimizeDeps: {
    exclude: ['@o.z/ngspice-wasm'],
  },
  test: { globals: true, environment: 'node', testTimeout: 60000 },
} as any);
