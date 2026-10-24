/**
 * Creates (or promotes) a super administrator from the command line.
 * No default administrator exists; this is the only bootstrap path.
 *
 *   pnpm --filter @dnki/api admin:create -- --email ops@example.org --name "Full Name"
 *
 * A strong random password is generated and printed once. The administrator must
 * sign in, enrol MFA immediately (enforced) and change the password.
 */
import { parseArgs } from "node:util";
import { hash } from "@node-rs/argon2";
import { createPool } from "../db/pool";
import { randomToken } from "../lib/crypto";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { email: { type: "string" }, name: { type: "string" } },
});
if (!values.email || !values.name) {
  console.error('Usage: admin:create -- --email <email> --name "<full name>"');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url, 2);
const password = randomToken(18);
const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const client = await pool.connect();
try {
  await client.query("begin");
  const u = await client.query<{ id: string; created: boolean }>(
    `insert into users (email, full_name, password_hash, email_verified_at) values (lower($1), $2, $3, now())
     on conflict (email) do update set full_name = users.full_name
     returning id, (xmax = 0) as created`,
    [values.email, values.name, passwordHash],
  );
  const row = u.rows[0];
  if (!row) throw new Error("user upsert failed");
  await client.query(
    "insert into user_roles (user_id, role_key, reason) values ($1, 'super_admin', 'bootstrap via CLI') on conflict do nothing",
    [row.id],
  );
  await client.query(
    "insert into administrative_audit_events (action, entity_type, entity_id, reason) values ('user.role_granted', 'user', $1, 'bootstrap super_admin via CLI')",
    [row.id],
  );
  await client.query("commit");
  if (row.created) {
    console.log(
      `Super administrator created: ${values.email}\nOne-time password (shown once): ${password}\nSign in, enrol MFA, then change this password.`,
    );
  } else {
    console.log(`Existing account ${values.email} granted super_admin. Password unchanged.`);
  }
} catch (err) {
  await client.query("rollback");
  throw err;
} finally {
  client.release();
  await pool.end();
}
