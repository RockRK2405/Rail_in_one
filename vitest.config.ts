import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Concurrency/transaction tests hit a real database; keep DB-touching suites
    // serial by default so tests do not interfere. Individual files may opt into
    // concurrency internally.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
