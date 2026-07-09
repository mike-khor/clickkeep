/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 5173,
  },
  test: {
    // Keep vitest out of the Playwright e2e folder. Vitest's default include
    // pattern matches *.spec.ts, which is what Playwright uses too — without
    // this exclude, `pnpm test` tries to evaluate the e2e specs as vitest
    // suites and fails with "Playwright Test did not expect test() here".
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
