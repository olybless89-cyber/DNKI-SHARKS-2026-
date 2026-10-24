/**
 * End-to-end scenario from the master specification (section 12), run against a
 * real PostgreSQL database through the HTTP API with the sandbox payment provider.
 * Streaming steps (11, 14) belong to Phase 5 and are not covered yet.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { many, one } from "../src/db/pool";
import { signMockWebhook } from "../src/modules/payments/mock";
import {
  type Client,
  device,
  MOCK_SECRET,
  makeApp,
  member,
  participant,
  passToken,
  regBody,
  registerAndPay,
  setupEvent,
  staff,
  type TestEnv,
  verifyMembership,
} from "./helpers";

let env: TestEnv;
let ev: Awaited<ReturnType<typeof setupEvent>>;
let gate: Client;
let deviceA: string;
let deviceB: string;

beforeAll(async () => {
  env = await makeApp();
  ev = await setupEvent(env);
  gate = (await staff(env, ["gate_supervisor"])).c;
  deviceA = await device(env, gate, ev.gates[0] as string);
  deviceB = await device(env, gate, ev.gates[1] as string);
});
afterAll(async () => {
  await env.app.close();
  await env.ctx.db.end();
});

describe("complete participant journey", () => {
  let p: Awaited<ReturnType<typeof participant>>;
  let token: string;
  let reference: string;
  let registrationId: string;

  it("1–2: an eligible synthetic member creates an account and verifies membership", async () => {
    p = await participant(env);
    const m = await member(env);
    await verifyMembership(env, p.c, m);
    const s = (await p.c.get("/portal/summary")).json();
    expect(s.stage).toBe("eligible");
  });

  it("3–6: registers, pays in the sandbox, backend verifies independently, credential issued", async () => {
    ({ reference, registrationId } = await registerAndPay(env, p.c, ev.categoryId));
    const status = (await p.c.get(`/payments/orders/${reference}/status`)).json();
    expect(status.status).toBe("succeeded");
    expect(status.registrationStatus).toBe("accredited");
    const tx = await many(
      env.ctx.db,
      "select * from payment_transactions t join payment_orders o on o.id = t.order_id where o.reference = $1",
      [reference],
    );
    expect(tx).toHaveLength(1);
    const creds = await many<{ accreditation_id: string }>(
      env.ctx.db,
      "select accreditation_id from accreditation_credentials where registration_id = $1",
      [registrationId],
    );
    expect(creds).toHaveLength(1);
    expect(creds[0]?.accreditation_id).toMatch(/^DNKI-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  });

  it("7: member retrieves the digital pass; QR carries no personal data", async () => {
    const r = await p.c.get("/me/credential");
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const cred = r.json().credential;
    expect(cred.status).toBe("active");
    expect(cred.qrSvg).toContain("<svg");
    expect(JSON.stringify(cred)).not.toContain("token");
    token = await passToken(env, p.c);
    expect(token).toMatch(/^DNKI1\.[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain(p.email);
  });

  it("8–10: first scanner admits; a second scanner at another gate detects the duplicate", async () => {
    const first = await gate.post("/scanner/scan", { token, gateId: ev.gates[0], deviceId: deviceA });
    expect(first.json().result).toBe("VALID_ADMIT");
    const second = await gate.post("/scanner/scan", { token, gateId: ev.gates[1], deviceId: deviceB });
    expect(second.json().result).toBe("ALREADY_CHECKED_IN");
    expect(second.json().previous.gate).toBe("Test Gate A");
  });

  it("15: a redelivered payment webhook does not create another credential", async () => {
    const tx = await one<{ transaction_id: string }>(
      env.ctx.db,
      "select transaction_id from sandbox_mock_payments where reference = $1",
      [reference],
    );
    const body = JSON.stringify({
      id: `evt_replay_${Date.now()}`,
      event: "charge.success",
      data: { reference, transaction_id: tx?.transaction_id },
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        env.app.inject({
          method: "POST",
          url: "/api/v1/payments/webhooks/mock",
          headers: { "content-type": "application/json", "x-mock-signature": signMockWebhook(MOCK_SECRET, body) },
          payload: body,
        }),
      ),
    );
    for (const r of results) expect(r.statusCode).toBe(200);
    const creds = await many(env.ctx.db, "select 1 from accreditation_credentials where registration_id = $1", [registrationId]);
    expect(creds).toHaveLength(1);
  });
});

describe("denials", () => {
  it("12: an ineligible (lapsed) member cannot verify or register", async () => {
    const p = await participant(env);
    const m = await member(env, { standing: "lapsed" });
    const r = await p.c.post("/membership/verify", { membershipNumber: m.number, contactOnRecord: m.email });
    expect(r.statusCode).toBe(200); // generic response
    const sent = await many(env.ctx.db, "select 1 from notifications where recipient = $1", [m.email]);
    expect(sent).toHaveLength(0); // but no code is sent
    const reg = await p.c.post("/registrations", regBody(ev.categoryId));
    expect(reg.statusCode).toBe(403);
  });

  it("13: an unpaid member is not accredited, and a failed payment issues nothing", async () => {
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    const { registrationId, reference } = await registerAndPay(env, p.c, ev.categoryId, "failed");
    const s = (await p.c.get(`/payments/orders/${reference}/status`)).json();
    expect(s.status).toBe("failed");
    expect(s.registrationStatus).toBe("awaiting_payment");
    expect((await p.c.get("/me/credential")).json().credential).toBeNull();
    expect(
      await many(env.ctx.db, "select 1 from accreditation_credentials where registration_id = $1", [registrationId]),
    ).toHaveLength(0);
  });

  it("the browser return URL alone never marks a payment successful", async () => {
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    const reg = (await p.c.post("/registrations", regBody(ev.categoryId))).json();
    const { reference } = (await p.c.post(`/registrations/${reg.id}/checkout`)).json();
    const s = (await p.c.get(`/payments/orders/${reference}/status`)).json();
    expect(s.status).toBe("pending");
    expect(s.registrationStatus).toBe("awaiting_payment");
  });

  it("rejects a forged webhook signature and records the rejection", async () => {
    const body = JSON.stringify({ id: "evt_forged", event: "charge.success", data: { reference: "PAY-AAAAAAAAAAAA" } });
    const r = await env.app.inject({
      method: "POST",
      url: "/api/v1/payments/webhooks/mock",
      headers: { "content-type": "application/json", "x-mock-signature": "0".repeat(128) },
      payload: body,
    });
    expect(r.statusCode).toBe(401);
    const row = await one<{ processing_status: string }>(
      env.ctx.db,
      "select processing_status from payment_webhook_events where reference = 'PAY-AAAAAAAAAAAA'",
    );
    expect(row?.processing_status).toBe("rejected");
  });

  it("a duplicate registration for the same member and event is refused", async () => {
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    expect((await p.c.post("/registrations", regBody(ev.categoryId))).statusCode).toBe(201);
    const again = await p.c.post("/registrations", regBody(ev.categoryId));
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ALREADY_REGISTERED");
  });

  it("registration requires accepting the terms", async () => {
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    const r = await p.c.post("/registrations", regBody(ev.categoryId, { acceptTerms: false }));
    expect(r.statusCode).toBe(400);
  });
});
