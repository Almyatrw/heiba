import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { TEST_DATABASE_URL } from "./config";

const here = path.dirname(fileURLToPath(import.meta.url));
const libDbDir = path.resolve(here, "../../../lib/db");

export default async function setup(): Promise<void> {
  // Ensure the test database exists (connect to the maintenance DB).
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, "");
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Unsafe test database name: ${dbName}`);
  }
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE ${dbName}`);
    }
  } finally {
    await admin.end();
  }

  // Apply the current drizzle schema to the test database.
  execFileSync(
    path.join(libDbDir, "node_modules/.bin/drizzle-kit"),
    ["push", "--force"],
    {
      cwd: libDbDir,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "inherit",
    },
  );

  // Clean the test storage scratch directory
  await rm(path.resolve(here, "../.test-storage"), {
    recursive: true,
    force: true,
  });
}
