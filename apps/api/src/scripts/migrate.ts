import { migrate } from "../db/migrate";
import { createPool } from "../db/pool";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url, 2);
const applied = await migrate(pool, (m) => console.log(m));
console.log(applied.length ? `Applied ${applied.length} migration(s); RBAC synced.` : "Database is up to date; RBAC synced.");
await pool.end();
