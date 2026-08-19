import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Db = NodePgDatabase<typeof schema>;

let _pool: pg.Pool | undefined;
let _db: Db | undefined;

function getDb(): Db {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      );
    }
    _pool = new Pool({ connectionString });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

// Lazily initialized so importing this module (e.g. by the API server for
// health checks or by tooling) does not require DATABASE_URL; the error is
// raised on first actual database use instead.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    getDb();
    const value = Reflect.get(_pool!, prop);
    return typeof value === "function" ? value.bind(_pool) : value;
  },
});

export * from "./schema";
