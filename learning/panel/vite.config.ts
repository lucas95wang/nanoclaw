import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built files are served by the learning server (src/learning/server.ts) from
// learning/panel/dist at http://127.0.0.1:7788/. `base: './'` keeps asset
// paths relative so the same build works behind any prefix.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:7788', changeOrigin: false } },
  },
});
