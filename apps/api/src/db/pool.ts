import pg from "pg";

// bigint (int8) columns hold money in minor units; return them as strings to avoid
// silent precision loss, and convert explicitly where arithmetic is needed.
pg.types.setTypeParser(20, (v) => v);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string, max: number): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    application_name: "dnki-api",
  });
  return pool;
}

/** Run fn inside a transaction. Retries serialization failures and deadlocks a bounded number of times. */
export async function withTx<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      const code = (err as { code?: string }).code;
      if ((code === "40001" || code === "40P01") && i < attempts) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function one<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await q.query(sql, params);
  return r.rows[0] as T | undefined;
}

export async function many<T>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await q.query(sql, params);
  return r.rows as T[];
}
