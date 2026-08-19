import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // Tests share one PostgreSQL database; run serially to avoid inter-file
    // truncation races.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: "vitest-session-secret",
      // Login rate limit stays enabled in production (default 20/15min); tests
      // raise it so repeated logins across cases do not interfere.
      LOGIN_RATE_LIMIT: "100000",
      // Uploaded test files go to a scratch dir cleaned by global-setup
      VIDEO_STORAGE_DIR: ".test-storage",
    },
  },
});
