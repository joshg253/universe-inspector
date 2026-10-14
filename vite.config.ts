import { hostname } from 'node:os';
import { defineConfig } from 'vite';

// base './' lets the built site be dropped into any folder on a VPS.
// server.host: the dev server listens on the LAN too, so other devices can open http://<this-pc>:5173.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: { host: true, allowedHosts: [hostname().toLowerCase(), '.local', '.ts.net'] }, // Vite 403s a hostname it does not know; this PC's own name (browsers send it lowercase) is allowed
});
