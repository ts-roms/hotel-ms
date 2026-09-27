import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC so decorator metadata (Nest DI) is emitted when Vitest transforms TypeScript.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
