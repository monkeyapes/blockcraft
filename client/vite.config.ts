import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative, so one build works both at a domain root and inside a
  // subdirectory like /play/ on the marketing site. Absolute asset paths
  // 404 in the subdirectory case.
  base: './',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The game talks to the server over ws://<host>/ ; in dev that is :8787.
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
