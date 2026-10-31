import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Dev server proxies the API + websocket to the Fastify backend so the browser
// only ever talks to one origin. In production Fastify serves ../web/dist.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Always type against / bundle the shared source, so a workspace dev run
      // never depends on a stale build of the shared package.
      '@blaxkvault/shared': path.resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': { target: process.env.API_ORIGIN ?? 'http://127.0.0.1:3000', changeOrigin: true },
      '/ws': { target: process.env.API_ORIGIN ?? 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
