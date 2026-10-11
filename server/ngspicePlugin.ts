// Vite dev-server middleware: POST /api/simulate {netlist} -> {raw, log, errors}
// Local only (server binds 127.0.0.1). Request size and run time are limited.
import type { Plugin } from 'vite';
import { runNgspice } from './ngspiceRunner';

export function ngspicePlugin(): Plugin {
  return {
    name: 'ngspice-local-service',
    configureServer(server) {
      server.middlewares.use('/api/health', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, engine: 'native ngspice' }));
      });
      server.middlewares.use('/api/simulate', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        let body = '';
        req.on('data', c => { body += c; if (body.length > 2_000_000) req.destroy(); });
        req.on('end', async () => {
          const ac = new AbortController();
          res.on('close', () => { if (!res.writableEnded) ac.abort(); });
          try {
            const { netlist } = JSON.parse(body);
            const out = await runNgspice(String(netlist), { signal: ac.signal });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(out));
          } catch (e) {
            res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, errors: [(e as Error).message] }));
          }
        });
      });
    },
  };
}
