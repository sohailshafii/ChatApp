// Test database URL derived from the dev connection, so integration tests run
// against a SEPARATE database (chatapp_test) and never touch dev data. Falls
// back to the compose.yml credentials when DATABASE_URL is unset (common local
// case, since vitest does not load .env files).

const DEFAULT_URL = 'postgres://chatapp:chatapp_dev@localhost:5432/chatapp';

export const TEST_DB_NAME = 'chatapp_test';

function withDatabase(name: string): string {
  const url = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

// Connection string for the dedicated test database.
export function testDbUrl(): string {
  return withDatabase(TEST_DB_NAME);
}

// Connection string for the default `postgres` maintenance DB, used to issue
// CREATE DATABASE for the test DB.
export function adminDbUrl(): string {
  return withDatabase('postgres');
}
