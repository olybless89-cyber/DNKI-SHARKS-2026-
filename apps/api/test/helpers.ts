import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { generate } from "otplib";
import { buildApp, createContext } from "../src/app";
import { type AppConfig, loadConfig } from "../src/config";
import type { AppContext } from "../src/context";
import { one } from "../src/db/pool";
import { crockford } from "../src/lib/crypto";
import { TEST_DB } from "./global-setup";

export const MOCK_SECRET = "test-mock-webhook-secret-0123456789";

export function testConfig(over: Record<string, string> = {}): AppConfig {
  return loadConfig({
    APP_ENV: "development",
    DEMO_MODE: "true",
    DATABASE_URL: TEST_DB,
    DATABASE_POOL_MAX: "40",
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    COOKIE_SECURE: "false",
    PAYMENT_PROVIDER: "mock",
    MOCK_PAYMENT_WEBHOOK_SECRET: MOCK_SECRET,
    EMAIL_PROVIDER: "log",
    LOG_LEVEL: "silent",
    WORKER_ENABLED: "false",
    RATE_LIMIT_ENABLED: "false",
    ...over,
  });
}

export type TestEnv = { app: FastifyInstance; ctx: AppContext };

export async function makeApp(over: Partial<AppContext> = {}, env: Record<string, string> = {}): Promise<TestEnv> {
  const ctx = createContext(testConfig(env), over);
  const app = await buildApp(ctx);
  await app.ready();
  return { app, ctx };
}

export const uid = () => crockford(8).toLowerCase();

/** Minimal browser-like client: cookie jar + CSRF header. */
export class Client {
  cookie = "";
  constructor(private readonly app: FastifyInstance) {}

  async req(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(method !== "GET" ? { "x-dnki-csrf": "1" } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers["set-cookie"];
    const first = Array.isArray(set) ? set[0] : set;
    if (first) {
      const pair = first.split(";")[0] ?? "";
      this.cookie = pair.endsWith("=") ? "" : pair;
    }
    return res;
  }
  get = (url: string) => this.req("GET", url);
  post = (url: string, body: unknown = {}) => this.req("POST", url, body);
  put = (url: string, body: unknown) => this.req("PUT", url, body);
  patch = (url: string, body: unknown) => this.req("PATCH", url, body);
}

export async function latestEmailBody(ctx: AppContext, to: string, template: string): Promise<string> {
  const row = await one<{ body_text: string }>(
    ctx.db,
    "select body_text from notifications where recipient = $1 and template = $2 order by created_at desc limit 1",
    [to, template],
  );
  if (!row) throw new Error(`no ${template} email for ${to}`);
  return row.body_text;
}

export function extractCode(body: string): string {
  const m = body.match(/\b(\d{6})\b/);
  if (!m?.[1]) throw new Error("no code in email");
  return m[1];
}

/** Signs up, signs in and verifies email. Returns a signed-in participant client. */
export async function participant(env: TestEnv, email = `p-${uid()}@example.test`, password = "correct horse battery 1") {
  const c = new Client(env.app);
  const s = await c.post("/auth/signup", { email, password, fullName: "Test Participant" });
  if (s.statusCode !== 202) throw new Error(`signup ${s.statusCode} ${s.body}`);
  const l = await c.post("/auth/login", { email, password });
  if (l.statusCode !== 200) throw new Error(`login ${l.statusCode} ${l.body}`);
  const code = extractCode(await latestEmailBody(env.ctx, email, "email_verification"));
  const v = await c.post("/auth/email/verify", { code });
  if (v.statusCode !== 200) throw new Error(`verify ${v.statusCode} ${v.body}`);
  return { c, email, password };
}

/** Inserts a synthetic member record. */
export async function member(env: TestEnv, opts: { standing?: string; email?: string } = {}) {
  const number = `T-${crockford(8)}`;
  const email = opts.email ?? `m-${uid()}@example.test`;
  const row = await one<{ id: string }>(
    env.ctx.db,
    `insert into member_records (membership_number, full_name, chapter, email, standing, source, is_synthetic)
     values ($1, 'Synthetic Test Member', 'Test Chapter', $2, $3, 'manual', true) returning id`,
    [number, email, opts.standing ?? "good_standing"],
  );
  return { id: row?.id as string, number, email };
}

/** Full membership verification through the contact-code flow. */
export async function verifyMembership(env: TestEnv, c: Client, m: { number: string; email: string }) {
  const r = await c.post("/membership/verify", { membershipNumber: m.number, contactOnRecord: m.email });
  if (r.statusCode !== 200) throw new Error(`membership verify ${r.statusCode} ${r.body}`);
  const code = extractCode(await latestEmailBody(env.ctx, m.email, "membership_contact_code"));
  const conf = await c.post("/membership/verify/confirm", { verificationId: r.json().verificationId, code });
  if (conf.statusCode !== 200 || conf.json().status !== "approved") throw new Error(`confirm ${conf.statusCode} ${conf.body}`);
}

/** Creates a staff account with the given roles, signs in and completes MFA enrolment. */
export async function staff(env: TestEnv, roles: string[], opts: { mfa?: boolean } = {}) {
  const email = `s-${uid()}@example.test`;
  const password = "staff password long 123";
  const u = await one<{ id: string }>(
    env.ctx.db,
    "insert into users (email, full_name, password_hash, email_verified_at) values ($1, 'Test Staff', $2, now()) returning id",
    [email, await hash(password)],
  );
  for (const r of roles) await env.ctx.db.query("insert into user_roles (user_id, role_key) values ($1, $2)", [u?.id, r]);
  const c = new Client(env.app);
  const l = await c.post("/auth/login", { email, password });
  if (l.statusCode !== 200) throw new Error(`staff login ${l.body}`);
  if (opts.mfa !== false) {
    const setup = (await c.post("/auth/mfa/setup")).json();
    const code = await generate({ secret: setup.secret });
    const en = await c.post("/auth/mfa/enable", { code });
    if (en.statusCode !== 200) throw new Error(`mfa enable ${en.body}`);
  }
  return { c, id: u?.id as string, email };
}

export async function setupEvent(
  env: TestEnv,
  opts: { capacity?: number | null; identityCheck?: boolean; fee?: number; reentry?: boolean } = {},
) {
  const ev = await one<{ id: string }>(env.ctx.db, "select id from events where is_active");
  await env.ctx.db.query(
    "update events set registration_open = true, registration_opens_at = null, registration_closes_at = null, reentry_policy = $2, credential_valid_from = null, credential_valid_until = null where id = $1",
    [ev?.id, opts.reentry ? "reentry_allowed" : "single_entry"],
  );
  const cat = await one<{ id: string }>(
    env.ctx.db,
    `insert into registration_categories (event_id, code, name, fee_minor, currency, capacity, requires_identity_check)
     values ($1, $2, 'Test Category', $3, 'NGN', $4, $5) returning id`,
    [ev?.id, `T${crockford(6)}`, opts.fee ?? 1_500_000, opts.capacity ?? null, opts.identityCheck ?? false],
  );
  const gates: string[] = [];
  for (const code of ["A", "B"]) {
    const g = await one<{ id: string }>(env.ctx.db, "insert into gates (event_id, code, name) values ($1, $2, $3) returning id", [
      ev?.id,
      `${code}${crockford(4)}`,
      `Test Gate ${code}`,
    ]);
    gates.push(g?.id as string);
  }
  return { eventId: ev?.id as string, categoryId: cat?.id as string, gates };
}

export async function device(_env: TestEnv, supervisor: Client, gateId: string): Promise<string> {
  const r = await supervisor.post("/scanner/devices", { label: `Device ${uid()}`, gateId });
  if (r.statusCode !== 200) throw new Error(`device ${r.body}`);
  return r.json().id;
}

/** Registration + sandbox checkout + simulated provider outcome. Returns the order reference. */
export async function registerAndPay(_env: TestEnv, c: Client, categoryId: string, outcome: "success" | "failed" = "success") {
  const reg = await c.post("/registrations", { categoryId, acceptTerms: true });
  if (reg.statusCode !== 201) throw new Error(`register ${reg.statusCode} ${reg.body}`);
  const checkout = await c.post(`/registrations/${reg.json().id}/checkout`);
  if (checkout.statusCode !== 200) throw new Error(`checkout ${checkout.body}`);
  const reference = checkout.json().reference as string;
  const done = await c.post(`/sandbox/payments/${reference}/complete`, { outcome });
  if (done.statusCode !== 200) throw new Error(`complete ${done.body}`);
  return { registrationId: reg.json().id as string, reference };
}

export async function passToken(env: TestEnv, c: Client): Promise<string> {
  const r = await c.get("/me/credential");
  const svg = r.json().credential?.qrSvg as string | undefined;
  if (!svg) throw new Error("no active pass");
  // The test reads the token from the database via the encrypted copy, exactly as the pass endpoint does.
  const row = await one<{ token_enc: string }>(
    env.ctx.db,
    "select token_enc from accreditation_credentials c join users u on u.id = c.user_id where u.email = $1 and c.status = 'active'",
    [(await c.get("/auth/me")).json().user.email],
  );
  const { decrypt } = await import("../src/lib/crypto");
  return `DNKI1.${decrypt(row?.token_enc as string, env.ctx.config.encryptionKey)}`;
}
