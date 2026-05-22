/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
  },
  test: {
    // Preserve vitest defaults and additionally skip Playwright e2e specs,
    // which live under apps/web/e2e and use @playwright/test (not vitest).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,tsup,build,eslint,prettier}.config.*',
      'e2e/**',
      '**/e2e/**',
    ],
  },
});
