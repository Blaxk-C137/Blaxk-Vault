import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Web tests run in jsdom and render real components against a stubbed `fetch`.
 * The point is not pixel coverage — it is that a first-render crash, a missing
 * provider or a broken API contract cannot hide behind a clean typecheck.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@blaxkvault/shared': path.resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
