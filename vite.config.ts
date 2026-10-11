import { defineConfig } from 'vite';

// base './' lets the built site be dropped into any folder on a VPS.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
