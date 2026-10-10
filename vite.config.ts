import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ngspicePlugin } from './server/ngspicePlugin';

export default defineConfig({
  plugins: [react(), ngspicePlugin()],
  server: { port: 5173, host: '127.0.0.1' },
  test: { globals: true, environment: 'node', testTimeout: 30000 },
} as any);
