import { defineConfig } from 'vitest/config';

// Unit tests run in a plain Node environment — the units under test (e.g. the
// API client) depend only on `fetch` and `document.cookie`, which we stub, so
// we avoid pulling in jsdom. Add a DOM environment per-file if/when component
// tests arrive.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
