import pg from "pg";
import { migrate } from "../src/db/migrate";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/dnki_test";

/** Recreates the test database from migrations once per run. Never point this at a real database. */
export default async function setup() {
  const url = new URL(TEST_DB);
  const dbName = url.pathname.slice(1);
  if (!/test/.test(dbName)) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const admin = new URL(TEST_DB);
  admin.pathname = "/postgres";
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`drop database if exists "${dbName}" with (force)`);
  await c.query(`create database "${dbName}"`);
  await c.end();
  const pool = new pg.Pool({ connectionString: TEST_DB, max: 2 });
  await migrate(pool);
  await pool.end();
}
