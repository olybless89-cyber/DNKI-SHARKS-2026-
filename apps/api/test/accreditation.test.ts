/** Credential lifecycle and gate operations. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { many, one } from "../src/db/pool";
import type { EmailSender } from "../src/modules/notifications/email";
import { processOutboxBatch } from "../src/modules/notifications/outbox";
import {
  type Client,
  device,
  makeApp,
  member,
  participant,
  passToken,
  registerAndPay,
  setupEvent,
  staff,
  type TestEnv,
  verifyMembership,
} from "./helpers";

let env: TestEnv;
let ev: Awaited<ReturnType<typeof setupEvent>>;
let sup: Client;
let dev: string;

let failSends = 0;
const flakyEmail: EmailSender = {
  name: "flaky",
  async send() {
    if (failSends > 0) {
      failSends--;
      throw new Error("SMTP unavailable");
    }
    return { messageId: "ok" };
  },
};

beforeAll(async () => {
  env = await makeApp({ email: flakyEmail });
  ev = await setupEvent(env);
  sup = (await staff(env, ["gate_supervisor"])).c;
  dev = await device(env, sup, ev.gates[0] as string);
});
afterAll(async () => {
  await env.app.close();
  await env.ctx.db.end();
});

async function accredited() {
  const p = await participant(env);
  await verifyMembership(env, p.c, await member(env));
  const r = await registerAndPay(env, p.c, ev.categoryId);
  return { ...p, ...r, token: await passToken(env, p.c) };
}

const scan = (c: Client, body: Record<string, unknown>) =>
  c.post("/scanner/scan", { gateId: ev.gates[0], deviceId: dev, ...body });

describe("credential lifecycle", () => {
  it("revoked credentials are refused at the gate", async () => {
    const officer = await staff(env, ["accreditation_officer"]);
    const p = await accredited();
    const cred = await one<{ id: string }>(env.ctx.db, "select id from accreditation_credentials where registration_id = $1", [
      p.registrationId,
    ]);
    expect((await officer.c.post(`/admin/credentials/${cred?.id}/revoke`, { reason: "Membership dispute" })).statusCode).toBe(
      200,
    );
    expect((await scan(sup, { token: p.token })).json().result).toBe("REVOKED_CREDENTIAL");
    expect((await p.c.get("/me/credential")).json().credential.qrSvg).toBeNull();
  });

  it("reissue invalidates the old QR immediately and carries admission state forward", async () => {
    const officer = await staff(env, ["accreditation_officer"]);
    const p = await accredited();
    expect((await scan(sup, { token: p.token })).json().result).toBe("VALID_ADMIT");
    const cred = await one<{ id: string }>(
      env.ctx.db,
      "select id from accreditation_credentials where registration_id = $1 and status = 'active'",
      [p.registrationId],
    );
    const r = await officer.c.post(`/admin/credentials/${cred?.id}/reissue`, { reason: "Phone lost" });
    expect(r.statusCode).toBe(200);
    expect((await scan(sup, { token: p.token })).json().result).toBe("REVOKED_CREDENTIAL");
    const fresh = await passToken(env, p.c);
    expect(fresh).not.toBe(p.token);
    // a reissued pass cannot be used to enter a second time
    expect((await scan(sup, { token: fresh })).json().result).toBe("ALREADY_CHECKED_IN");
  });

  it("stores only a hash of the bearer token and never returns it to staff", async () => {
    const p = await accredited();
    const raw = p.token.slice("DNKI1.".length);
    const rows = await many(env.ctx.db, "select * from accreditation_credentials where token_hash = $1 or token_enc like $2", [
      raw,
      `%${raw}%`,
    ]);
    expect(rows).toHaveLength(0);
    const admin = await staff(env, ["auditor"]);
    const list = await admin.c.get(
      `/admin/credentials?q=${encodeURIComponent((await p.c.get("/me/credential")).json().credential.accreditation_id)}`,
    );
    expect(list.body).not.toContain(raw);
    expect(list.body).not.toMatch(/token/);
  });

  it("refund revokes accreditation and refunds the registration", async () => {
    const finance = await staff(env, ["finance_officer"]);
    const p = await accredited();
    const order = await one<{ id: string }>(env.ctx.db, "select id from payment_orders where reference = $1", [p.reference]);
    const r = await finance.c.post(`/admin/payments/orders/${order?.id}/refund`, { reason: "Member withdrew" });
    expect(r.json().status).toBe("completed");
    expect((await p.c.get("/portal/summary")).json().stage).toBe("refunded");
    expect((await scan(sup, { token: p.token })).json().result).toBe("REVOKED_CREDENTIAL");
  });

  it("suspending a registration blocks entry; reinstating restores it", async () => {
    const admin = await staff(env, ["event_admin"]);
    const p = await accredited();
    await admin.c.post(`/admin/registrations/${p.registrationId}/action`, { action: "suspend", reason: "Under investigation" });
    expect((await scan(sup, { token: p.token })).json().result).toBe("PAYMENT_OR_ELIGIBILITY_ISSUE");
    await admin.c.post(`/admin/registrations/${p.registrationId}/action`, { action: "reinstate", reason: "Cleared" });
    expect((await scan(sup, { token: p.token })).json().result).toBe("VALID_ADMIT");
  });

  it("a member who loses good standing is refused at the gate even with a valid pass", async () => {
    const p = await accredited();
    await env.ctx.db.query(
      "update member_records set standing = 'suspended' where id = (select member_record_id from registrations where id = $1)",
      [p.registrationId],
    );
    expect((await scan(sup, { token: p.token })).json().result).toBe("PAYMENT_OR_ELIGIBILITY_ISSUE");
  });
});

describe("gate operations", () => {
  it("rejects unknown and malformed QR codes", async () => {
    expect((await scan(sup, { token: "DNKI1.not-a-real-token" })).json().result).toBe("INVALID_CREDENTIAL");
    expect((await scan(sup, { token: `DNKI1.${"A".repeat(43)}` })).json().result).toBe("INVALID_CREDENTIAL");
    expect((await scan(sup, { token: "https://evil.example/phish" })).json().result).toBe("INVALID_CREDENTIAL");
  });

  it("refuses scans from unassigned staff and from devices registered to other gates", async () => {
    const officer = await staff(env, ["accreditation_officer"]); // not assigned to any gate
    const p = await accredited();
    expect((await scan(officer.c, { token: p.token })).statusCode).toBe(403);
    expect((await sup.post("/scanner/scan", { token: p.token, gateId: ev.gates[1], deviceId: dev })).statusCode).toBe(403);
  });

  it("assigned accreditation officers can scan; manual lookup requires its permission", async () => {
    const admin = await staff(env, ["event_admin"]);
    const officer = await staff(env, ["accreditation_officer"]);
    await admin.c.post(`/admin/gates/${ev.gates[0]}/staff`, { userId: officer.id });
    const p = await accredited();
    const cred = (await p.c.get("/me/credential")).json().credential;
    const r = await scan(officer.c, { accreditationId: cred.accreditation_id });
    expect(r.json().result).toBe("VALID_ADMIT");
    expect(r.json().participant.name).toBe("Test Participant");
  });

  it("identity-check categories require confirmation before admission", async () => {
    const vip = await setupEvent(env, { identityCheck: true });
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    await registerAndPay(env, p.c, vip.categoryId);
    const token = await passToken(env, p.c);
    expect((await scan(sup, { token })).json().result).toBe("MANUAL_REVIEW_REQUIRED");
    expect((await scan(sup, { token, identityConfirmed: true })).json().result).toBe("VALID_ADMIT");
  });

  it("supervisor override resolves disputes but never admits revoked credentials", async () => {
    const p = await accredited();
    await scan(sup, { token: p.token });
    const cred = await one<{ id: string }>(env.ctx.db, "select id from accreditation_credentials where registration_id = $1", [
      p.registrationId,
    ]);
    const ok = await sup.post("/scanner/override", {
      credentialId: cred?.id,
      gateId: ev.gates[0],
      deviceId: dev,
      reason: "Stepped out to car with escort",
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().firstEntry).toBe(false);
    await env.ctx.db.query("update accreditation_credentials set status = 'revoked' where id = $1", [cred?.id]);
    const denied = await sup.post("/scanner/override", {
      credentialId: cred?.id,
      gateId: ev.gates[0],
      deviceId: dev,
      reason: "Trying to override revoked",
    });
    expect(denied.statusCode).toBe(409);
  });

  it("re-entry policy models entry and exit separately", async () => {
    const re = await setupEvent(env, { reentry: true });
    const s2 = (await staff(env, ["gate_supervisor"])).c;
    const d2 = await device(env, s2, re.gates[0] as string);
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    await registerAndPay(env, p.c, re.categoryId);
    const token = await passToken(env, p.c);
    const go = (direction: string) =>
      s2.post("/scanner/scan", { token, gateId: re.gates[0], deviceId: d2, direction }).then((r) => r.json().result);
    expect(await go("entry")).toBe("VALID_ADMIT");
    expect(await go("entry")).toBe("ALREADY_CHECKED_IN");
    expect(await go("exit")).toBe("VALID_EXIT");
    expect(await go("entry")).toBe("VALID_ADMIT");
    const counted = await one<{ n: number }>(
      env.ctx.db,
      "select count(*)::int as n from attendance_events a join accreditation_credentials c on c.id = a.credential_id where a.counted and c.user_id = (select id from users where email = $1)",
      [p.email],
    );
    expect(counted?.n).toBe(1);
    await env.ctx.db.query("update events set reentry_policy = 'single_entry' where is_active");
  });
});

describe("notifications outbox", () => {
  it("retries failed deliveries with backoff and scrubs sensitive bodies after sending", async () => {
    const p = await participant(env); // email verification code is a sensitive notification
    await env.ctx.db.query("update notifications set status = 'sent' where recipient <> $1 and status = 'pending'", [p.email]);
    failSends = 1;
    await processOutboxBatch(env.ctx, env.app.log);
    const after1 = await one<{ status: string; attempts: number; last_error: string }>(
      env.ctx.db,
      "select status, attempts, last_error from notifications where recipient = $1 and template = 'email_verification'",
      [p.email],
    );
    expect(after1?.status).toBe("pending");
    expect(after1?.attempts).toBe(1);
    expect(after1?.last_error).toContain("SMTP unavailable");
    await env.ctx.db.query("update notifications set next_attempt_at = now() where recipient = $1", [p.email]);
    await processOutboxBatch(env.ctx, env.app.log);
    const after2 = await one<{ status: string; body_text: string }>(
      env.ctx.db,
      "select status, body_text from notifications where recipient = $1 and template = 'email_verification'",
      [p.email],
    );
    expect(after2?.status).toBe("sent");
    expect(after2?.body_text).not.toMatch(/\d{6}/);
  });
});
