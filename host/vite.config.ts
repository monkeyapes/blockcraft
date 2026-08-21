import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative, for the same reason the game uses it: the built page is loaded
  // from a custom protocol, not from a server root.
  base: './',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  clearScreen: false,
  server: { port: 5174, strictPort: true },
});
