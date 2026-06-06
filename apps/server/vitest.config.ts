import { defineConfig } from 'vitest/config';
import { testDbUrl } from './src/test/test-db';

// Mirrors apps/web: plain Node environment, *.test.ts co-located under src.
//
// Unit tests (auth/*.test.ts) need no database. Integration tests
// (routes/auth.test.ts) run buildApp() + app.inject() against a DEDICATED
// Postgres database that global-setup provisions and migrates, so they never
// touch dev data. Workers connect to it via the DATABASE_URL injected below.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/test/global-setup.ts'],
    // Integration test files share the one chatapp_test database, so run files
    // serially — otherwise their TRUNCATE-based cleanup races across files.
    fileParallelism: false,
    // Test DB for workers; silence Fastify's per-request logs to keep output
    // clean. Dummy VAPID keys make push "configured" so the §5 endpoints +
    // dispatcher are exercised; the real `web-push` sender never runs (tests
    // with no subscriptions no-op, and the dispatcher test injects a fake
    // sender), so these placeholders are never validated by the library.
    env: {
      DATABASE_URL: testDbUrl(),
      LOG_LEVEL: 'silent',
      VAPID_PUBLIC_KEY: 'test-vapid-public-key',
      VAPID_PRIVATE_KEY: 'test-vapid-private-key',
    },
    // argon2 hashing in the auth tests is ~250ms each; give some headroom.
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
