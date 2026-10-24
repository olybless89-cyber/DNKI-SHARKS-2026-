/** Authentication, authorisation, CSRF, enumeration resistance, audit immutability. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { many, one } from "../src/db/pool";
import { Client, latestEmailBody, makeApp, member, participant, setupEvent, staff, type TestEnv, uid } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await makeApp();
  await setupEvent(env);
});
afterAll(async () => {
  await env.app.close();
  await env.ctx.db.end();
});

describe("authentication", () => {
  it("stores passwords as argon2id hashes, never plaintext", async () => {
    const p = await participant(env);
    const row = await one<{ password_hash: string }>(env.ctx.db, "select password_hash from users where email = $1", [p.email]);
    expect(row?.password_hash.startsWith("$argon2id$")).toBe(true);
    expect(row?.password_hash).not.toContain(p.password);
  });

  it("signup does not reveal whether an email is already registered", async () => {
    const p = await participant(env);
    const fresh = await new Client(env.app).post("/auth/signup", {
      email: `n-${uid()}@example.test`,
      password: "another long password",
      fullName: "New Person",
    });
    const dup = await new Client(env.app).post("/auth/signup", {
      email: p.email,
      password: "another long password",
      fullName: "New Person",
    });
    expect(dup.statusCode).toBe(fresh.statusCode);
    expect(dup.json()).toEqual(fresh.json());
  });

  it("locks an account after repeated failures with a generic error", async () => {
    const p = await participant(env);
    const c = new Client(env.app);
    for (let i = 0; i < 5; i++) {
      const r = await c.post("/auth/login", { email: p.email, password: "wrong password here" });
      expect(r.json().error.code).toBe("INVALID_CREDENTIALS");
    }
    const locked = await c.post("/auth/login", { email: p.email, password: p.password });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("ACCOUNT_LOCKED");
  });

  it("expires idle sessions server-side", async () => {
    const p = await participant(env);
    expect((await p.c.get("/auth/me")).statusCode).toBe(200);
    await env.ctx.db.query(
      "update sessions set last_seen_at = now() - interval '1 day' where user_id = (select id from users where email = $1)",
      [p.email],
    );
    expect((await p.c.get("/auth/me")).statusCode).toBe(401);
  });

  it("logout invalidates the session token on the server", async () => {
    const p = await participant(env);
    const stolen = p.c.cookie;
    await p.c.post("/auth/logout");
    const replay = new Client(env.app);
    replay.cookie = stolen;
    expect((await replay.get("/auth/me")).statusCode).toBe(401);
  });

  it("password reset revokes all existing sessions", async () => {
    const p = await participant(env);
    await new Client(env.app).post("/auth/password/forgot", { email: p.email });
    const link = await latestEmailBody(env.ctx, p.email, "password_reset");
    const token = decodeURIComponent(link.match(/token=([^\s]+)/)?.[1] ?? "");
    const r = await new Client(env.app).post("/auth/password/reset", { token, password: "a brand new long password" });
    expect(r.statusCode).toBe(200);
    expect((await p.c.get("/auth/me")).statusCode).toBe(401);
    // tokens are single use
    expect(
      (await new Client(env.app).post("/auth/password/reset", { token, password: "yet another long password" })).statusCode,
    ).toBe(400);
  });

  it("rejects state-changing requests without the CSRF header", async () => {
    const p = await participant(env);
    const r = await env.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: p.c.cookie, "content-type": "application/json" },
      payload: "{}",
    });
    expect(r.statusCode).toBe(403);
    expect((await p.c.get("/auth/me")).statusCode).toBe(200);
  });

  it("does not leak internals in error responses", async () => {
    const r = await new Client(env.app).post("/auth/login", { email: "not-an-email", password: "x" });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toMatch(/stack|select |postgres/i);
    expect(r.json().error.correlationId).toBeTruthy();
  });
});

describe("privileged access and MFA", () => {
  it("privileged roles get no permissions until MFA is enrolled and verified", async () => {
    const s = await staff(env, ["auditor"], { mfa: false });
    const r = await s.c.get("/admin/audit");
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("MFA_REQUIRED");
    expect((await s.c.get("/auth/me")).json().mfa.enrollmentRequired).toBe(true);
  });

  it("after MFA enrolment, a new sign-in must complete the TOTP challenge", async () => {
    const s = await staff(env, ["auditor"]);
    expect((await s.c.get("/admin/audit")).statusCode).toBe(200);
    const c2 = new Client(env.app);
    const l = await c2.post("/auth/login", { email: s.email, password: "staff password long 123" });
    expect(l.json().mfaRequired).toBe(true);
    expect((await c2.get("/admin/audit")).json().error.code).toBe("MFA_REQUIRED");
    expect((await c2.post("/auth/mfa/challenge", { code: "000000" })).statusCode).toBe(400);
  });

  it("participants cannot reach any admin endpoint", async () => {
    const p = await participant(env);
    for (const url of [
      "/admin/overview",
      "/admin/registrations",
      "/admin/payments/orders",
      "/admin/audit",
      "/admin/users",
      "/scanner/context",
    ]) {
      expect((await p.c.get(url)).statusCode).toBe(403);
    }
  });

  it("enforces separation of duties between roles", async () => {
    const membershipOfficer = await staff(env, ["membership_officer"]);
    const finance = await staff(env, ["finance_officer"]);
    const scanner = await staff(env, ["accreditation_officer"]);
    const fakeId = "00000000-0000-4000-8000-000000000000";
    // membership officers cannot refund or touch payments
    expect(
      (await membershipOfficer.c.post(`/admin/payments/orders/${fakeId}/refund`, { reason: "attempted refund" })).statusCode,
    ).toBe(403);
    expect((await membershipOfficer.c.get("/admin/payments/orders")).statusCode).toBe(403);
    // finance cannot decide membership
    expect(
      (await finance.c.post(`/admin/membership/verifications/${fakeId}/decision`, { decision: "reject", reason: "nope" }))
        .statusCode,
    ).toBe(403);
    // accreditation officers cannot configure fees or export
    expect((await scanner.c.post("/admin/event/categories", {})).statusCode).toBeGreaterThanOrEqual(400);
    expect((await scanner.c.get("/admin/exports/registrations.csv")).statusCode).toBe(403);
    // nobody but super admins grant roles
    expect(
      (await finance.c.post(`/admin/users/${scanner.id}/roles`, { role: "super_admin", reason: "escalate" })).statusCode,
    ).toBe(403);
  });

  it("staff cannot grant roles to themselves and role changes force re-authentication", async () => {
    const admin = await staff(env, ["super_admin"]);
    expect((await admin.c.post(`/admin/users/${admin.id}/roles`, { role: "auditor", reason: "self grant" })).statusCode).toBe(
      403,
    );
    const target = await participant(env);
    const t = await one<{ id: string }>(env.ctx.db, "select id from users where email = $1", [target.email]);
    expect(
      (await admin.c.post(`/admin/users/${t?.id}/roles`, { role: "auditor", reason: "oversight committee" })).statusCode,
    ).toBe(200);
    expect((await target.c.get("/auth/me")).statusCode).toBe(401);
  });
});

describe("membership verification", () => {
  it("gives identical responses for existing and non-existent members (anti-enumeration)", async () => {
    const p = await participant(env);
    const m = await member(env);
    const a = await p.c.post("/membership/verify", { membershipNumber: m.number, contactOnRecord: m.email });
    const p2 = await participant(env);
    const b = await p2.c.post("/membership/verify", { membershipNumber: "T-NOSUCHONE", contactOnRecord: "nobody@example.test" });
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.json().message).toBe(b.json().message);
  });

  it("knowing a membership number alone is not enough: the code goes to the contact on record", async () => {
    const attacker = await participant(env);
    const m = await member(env);
    await attacker.c.post("/membership/verify", { membershipNumber: m.number, contactOnRecord: attacker.email });
    expect(
      await many(env.ctx.db, "select 1 from notifications where template = 'membership_contact_code' and recipient = $1", [
        attacker.email,
      ]),
    ).toHaveLength(0);
  });

  it("one member record cannot be linked to two accounts", async () => {
    const m = await member(env);
    const first = await participant(env);
    const { verifyMembership } = await import("./helpers");
    await verifyMembership(env, first.c, m);
    const second = await participant(env);
    await second.c.post("/membership/verify", { membershipNumber: m.number, contactOnRecord: m.email });
    const audit = await many(
      env.ctx.db,
      "select 1 from administrative_audit_events where action = 'membership.duplicate_identity_attempt'",
    );
    expect(audit.length).toBeGreaterThan(0);
  });

  it("manual review: officers decide, but never their own request", async () => {
    const officer = await staff(env, ["membership_officer"]);
    const p = await participant(env);
    const m = await member(env);
    const req = await p.c.post("/membership/manual-review", {
      membershipNumber: m.number,
      note: "Lost access to the email on file.",
    });
    expect(req.statusCode).toBe(200);
    const queue = (await officer.c.get("/admin/membership/verifications?status=pending_review")).json();
    const item = queue.items.find((i: { id: string }) => i.id === req.json().verificationId);
    expect(item.candidate_id).toBe(m.id);
    const ok = await officer.c.post(`/admin/membership/verifications/${item.id}/decision`, {
      decision: "approve",
      memberRecordId: m.id,
      reason: "Confirmed with chapter secretary",
    });
    expect(ok.statusCode).toBe(200);
    expect((await p.c.get("/portal/summary")).json().stage).toBe("eligible");

    // An officer who is also a participant cannot approve themselves.
    const selfReq = await officer.c.post("/membership/manual-review", {
      membershipNumber: (await member(env)).number,
      note: "Officer registering personally",
    });
    const self = await officer.c.post(`/admin/membership/verifications/${selfReq.json().verificationId}/decision`, {
      decision: "reject",
      reason: "self",
    });
    expect(self.statusCode).toBe(403);
  });

  it("validates CSV imports, reports row errors, and applies only valid rows", async () => {
    const officer = await staff(env, ["membership_officer"]);
    const n1 = `T-IMP${uid().toUpperCase()}`;
    const csv = [
      "membership_number,full_name,chapter,zone,email,phone,standing",
      `${n1},Imported Member,Chapter 1,Zone 1,imp1@example.test,,good_standing`,
      `${n1},Duplicate Row,Chapter 1,Zone 1,imp2@example.test,,good_standing`,
      "BAD NUMBER!,X,,,,,good_standing",
      `T-IMPOK${uid().toUpperCase()},Second Member,Chapter 2,Zone 2,,,unknown_standing`,
    ].join("\n");
    const v = (await officer.c.post("/admin/membership/imports", { filename: "members.csv", csv })).json();
    expect(v.totalRows).toBe(4);
    expect(v.validRows).toBe(1);
    expect(v.errors.length).toBeGreaterThanOrEqual(3);
    const applied = (
      await officer.c.post(`/admin/membership/imports/${v.importJobId}/apply`, { reason: "Initial import" })
    ).json();
    expect(applied.inserted).toBe(1);
    expect((await officer.c.post(`/admin/membership/imports/${v.importJobId}/apply`, { reason: "again" })).statusCode).toBe(409);
  });
});

describe("audit trail", () => {
  it("is append-only at the database level", async () => {
    await expect(env.ctx.db.query("update administrative_audit_events set action = 'tampered'")).rejects.toThrow(/append-only/);
    await expect(env.ctx.db.query("delete from administrative_audit_events")).rejects.toThrow(/append-only/);
  });

  it("records staff overrides with actor, reason and correlation id", async () => {
    const rows = await many<{ actor_user_id: string | null; correlation_id: string | null; reason: string | null }>(
      env.ctx.db,
      "select actor_user_id, correlation_id, reason from administrative_audit_events where action = 'membership.approved' order by id desc limit 1",
    );
    expect(rows[0]?.actor_user_id).toBeTruthy();
    expect(rows[0]?.correlation_id).toBeTruthy();
    expect(rows[0]?.reason).toBeTruthy();
  });
});
