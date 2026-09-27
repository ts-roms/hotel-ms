import path from 'node:path';
import { config } from 'dotenv';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Suites share one test database, seeded per file.
    fileParallelism: false,
  },
});
