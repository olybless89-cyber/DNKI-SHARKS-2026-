/**
 * DEVELOPMENT / DEMO SEED — synthetic data only.
 *
 * Refuses to run unless APP_ENV=development. Everything created here is labelled
 * as synthetic: member numbers start with DEMO-, emails use the reserved
 * .test domain, and category names are prefixed [DEMO]. Fees are placeholders,
 * not DNKI's actual prices.
 *
 *   pnpm db:seed                 # event config, demo categories, gates, synthetic members
 *   pnpm db:seed -- --demo-staff # also creates demo staff accounts with random passwords
 */
import { parseArgs } from "node:util";
import { hash } from "@node-rs/argon2";
import { migrate } from "../db/migrate";
import { createPool } from "../db/pool";
import { randomToken } from "../lib/crypto";

if ((process.env.APP_ENV ?? "development") !== "development") {
  console.error("Refusing to seed synthetic data outside APP_ENV=development.");
  process.exit(1);
}
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { "demo-staff": { type: "boolean", default: false }, members: { type: "string", default: "250" } },
});
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = createPool(url, 4);
await migrate(pool);

const ev = (await pool.query<{ id: string }>("select id from events where is_active")).rows[0];
if (!ev) throw new Error("No active event");

await pool.query(
  `update events set
     description = '[DEMO CONTENT] Event overview to be supplied by DNKI. This text is a placeholder for development.',
     venue_text = '[Venue to be announced]',
     registration_open = true,
     support_email = 'support@example.test',
     privacy_notice = '[DRAFT — FOR LEGAL REVIEW] This placeholder privacy notice must be replaced with text approved by DNKI''s authorised representative before launch.',
     terms = '[DRAFT — FOR LEGAL REVIEW] Placeholder registration terms. Registration is limited to verified members of De Norsemen Kclub International. Fees, refunds and conduct rules will be published by DNKI.',
     faqs = $2
   where id = $1`,
  [
    ev.id,
    JSON.stringify([
      { q: "Who can register?", a: "Only verified members of De Norsemen Kclub International in good standing." },
      {
        q: "How do I get my accreditation pass?",
        a: "After your membership is verified and your payment is confirmed by our payment provider, your digital pass appears in your dashboard and is emailed to you.",
      },
      {
        q: "Can I share my QR pass?",
        a: "No. Your pass is personal and can only be used once for entry. Gate staff may confirm your identity.",
      },
    ]),
  ],
);

for (const c of [
  { code: "DEMO_STANDARD", name: "[DEMO] Standard Delegate", fee: 1_000_00, cap: null, idCheck: false },
  { code: "DEMO_EXEC", name: "[DEMO] Executive Delegate", fee: 2_500_00, cap: 50, idCheck: true },
]) {
  await pool.query(
    `insert into registration_categories (event_id, code, name, description, fee_minor, currency, capacity, requires_identity_check)
     values ($1, $2, $3, 'Placeholder category and fee for development. Not DNKI pricing.', $4, 'NGN', $5, $6)
     on conflict (event_id, code) do nothing`,
    [ev.id, c.code, c.name, c.fee, c.cap, c.idCheck],
  );
}

for (const g of [
  { code: "A", name: "Gate A — Main Entrance" },
  { code: "B", name: "Gate B — VIP Entrance" },
]) {
  await pool.query("insert into gates (event_id, code, name) values ($1, $2, $3) on conflict do nothing", [
    ev.id,
    g.code,
    g.name,
  ]);
}

const n = Number(values.members);
const standings = ["good_standing", "good_standing", "good_standing", "good_standing", "lapsed", "suspended"];
for (let i = 1; i <= n; i++) {
  const num = String(i).padStart(4, "0");
  await pool.query(
    `insert into member_records (membership_number, full_name, chapter, zone, email, standing, source, is_synthetic)
     values ($1, $2, $3, $4, $5, $6, 'manual', true) on conflict (membership_number) do nothing`,
    [
      `DEMO-${num}`,
      `Synthetic Member ${num}`,
      `Demo Chapter ${(i % 12) + 1}`,
      `Demo Zone ${(i % 4) + 1}`,
      `member${num}@example.test`,
      standings[i % standings.length],
    ],
  );
}
console.log(`Seeded demo event configuration, 2 demo categories, 2 gates and ${n} synthetic members (DEMO-0001…).`);

if (values["demo-staff"]) {
  const staff = [
    ["admin@example.test", "Demo Super Admin", "super_admin"],
    ["events@example.test", "Demo Event Admin", "event_admin"],
    ["membership@example.test", "Demo Membership Officer", "membership_officer"],
    ["finance@example.test", "Demo Finance Officer", "finance_officer"],
    ["gate@example.test", "Demo Gate Supervisor", "gate_supervisor"],
    ["scanner@example.test", "Demo Accreditation Officer", "accreditation_officer"],
    ["auditor@example.test", "Demo Auditor", "auditor"],
  ] as const;
  console.log("\nDemo staff accounts (random passwords, shown once; MFA enrolment is required at first sign-in):");
  for (const [email, name, role] of staff) {
    const password = randomToken(12);
    const r = await pool.query<{ id: string; created: boolean }>(
      `insert into users (email, full_name, password_hash, email_verified_at) values ($1, $2, $3, now())
       on conflict (email) do update set full_name = users.full_name returning id, (xmax = 0) as created`,
      [email, name, await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 })],
    );
    const row = r.rows[0];
    if (!row) continue;
    await pool.query("insert into user_roles (user_id, role_key, reason) values ($1, $2, 'demo seed') on conflict do nothing", [
      row.id,
      role,
    ]);
    if (role === "accreditation_officer") {
      await pool.query(
        "insert into scanner_gate_assignments (user_id, gate_id, assigned_by) select $1, id, $1 from gates where code = 'A' and event_id = $2 on conflict do nothing",
        [row.id, ev.id],
      );
    }
    console.log(`  ${role.padEnd(22)} ${email.padEnd(26)} ${row.created ? password : "(already existed; password unchanged)"}`);
  }
}
await pool.end();
