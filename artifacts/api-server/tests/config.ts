// Shared test configuration. The integration tests run against a REAL
// PostgreSQL database (never mocks/SQLite); use TEST_DATABASE_URL to point at
// it, otherwise a local default is used.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/heiba_test";
