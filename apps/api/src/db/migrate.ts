import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSIONS, ROLES } from "@dnki/shared";
import type pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));

function migrationsDir(): string {
  // src/db -> ../../migrations ; dist -> ../migrations
  return process.env.MIGRATIONS_DIR ?? join(here, here.endsWith("db") ? "../../migrations" : "../migrations");
}

/** Applies pending SQL migrations under an advisory lock, then syncs the RBAC matrix. */
export async function migrate(pool: pg.Pool, log: (msg: string) => void = () => {}): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("select pg_advisory_lock(727274)");
    await client.query(
      "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (await client.query<{ version: string }>("select version from schema_migrations")).rows.map((r) => r.version),
    );
    const files = (await readdir(migrationsDir())).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(migrationsDir(), file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
        log(`applied ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    await syncRbac(client);
  } finally {
    await client.query("select pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
  return applied;
}

async function syncRbac(client: pg.PoolClient): Promise<void> {
  await client.query("begin");
  try {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await client.query(
        "insert into permissions (key, description) values ($1, $2) on conflict (key) do update set description = excluded.description",
        [key, description],
      );
    }
    for (const [key, role] of Object.entries(ROLES)) {
      await client.query(
        "insert into roles (key, name, privileged) values ($1, $2, $3) on conflict (key) do update set name = excluded.name, privileged = excluded.privileged",
        [key, role.name, role.privileged],
      );
      await client.query("delete from role_permissions where role_key = $1 and not (permission_key = any($2))", [
        key,
        role.permissions,
      ]);
      for (const p of role.permissions) {
        await client.query("insert into role_permissions (role_key, permission_key) values ($1, $2) on conflict do nothing", [
          key,
          p,
        ]);
      }
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}
