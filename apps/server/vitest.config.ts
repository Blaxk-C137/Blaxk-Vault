import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@blaxkvault/shared': path.resolve(import.meta.dirname, '../../packages/shared/src/index.ts') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    reporters: ['default'],
  },
});
