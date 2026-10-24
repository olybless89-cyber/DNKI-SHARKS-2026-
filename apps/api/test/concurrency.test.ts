/** Concurrency guarantees: atomic single-use admission and at-most-once payment fulfilment. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { many, one } from "../src/db/pool";
import { applyVerifiedPayment, verifyAndApply } from "../src/modules/payments/service";
import {
  type Client,
  device,
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
let sup: Client;
let devices: string[];

beforeAll(async () => {
  env = await makeApp({}, { LOG_LEVEL: process.env.TEST_LOG ?? "silent" });
  ev = await setupEvent(env);
  sup = (await staff(env, ["gate_supervisor"])).c;
  devices = [await device(env, sup, ev.gates[0] as string), await device(env, sup, ev.gates[1] as string)];
});
afterAll(async () => {
  await env.app.close();
  await env.ctx.db.end();
});

describe("atomic check-in", () => {
  it("admits exactly once when 30 scans race across two gates", async () => {
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    await registerAndPay(env, p.c, ev.categoryId);
    const token = await passToken(env, p.c);
    // Separate staff sessions per gate to mirror real concurrent devices.
    const sup2 = (await staff(env, ["gate_supervisor"])).c;
    const scans = await Promise.all(
      Array.from({ length: 30 }, (_, i) => {
        const g = i % 2;
        return (g ? sup2 : sup).post("/scanner/scan", { token, gateId: ev.gates[g], deviceId: devices[g] });
      }),
    );
    const results = scans.map((s) => s.json().result);
    expect(results.filter((r) => r === "VALID_ADMIT")).toHaveLength(1);
    expect(results.filter((r) => r === "ALREADY_CHECKED_IN")).toHaveLength(29);
    const counted = await one<{ n: number }>(
      env.ctx.db,
      "select count(*)::int as n from attendance_events a join accreditation_credentials c on c.id = a.credential_id where a.counted and c.user_id = (select id from users where email = $1)",
      [p.email],
    );
    expect(counted?.n).toBe(1);
  });
});

describe("idempotent payment fulfilment", () => {
  it("fulfils once under 15 concurrent verifications of the same successful payment", async () => {
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    const reg = (await p.c.post("/registrations", regBody(ev.categoryId))).json();
    const { reference } = (await p.c.post(`/registrations/${reg.id}/checkout`)).json();
    await env.ctx.db.query("update sandbox_mock_payments set status = 'success' where reference = $1", [reference]);
    const outcomes = await Promise.all(Array.from({ length: 15 }, () => verifyAndApply(env.ctx, reference, "reconciliation")));
    expect(outcomes.filter((o) => o === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "already_fulfilled")).toHaveLength(14);
    expect(await many(env.ctx.db, "select 1 from accreditation_credentials where registration_id = $1", [reg.id])).toHaveLength(
      1,
    );
    expect(
      await many(
        env.ctx.db,
        "select 1 from notifications where idempotency_key like 'invitation:%' and user_id = (select user_id from registrations where id = $1)",
        [reg.id],
      ),
    ).toHaveLength(1);
  });

  it("handles out-of-order delivery: a late 'failed' after success changes nothing", async () => {
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    const { reference } = await registerAndPay(env, p.c, ev.categoryId, "success");
    const out = await applyVerifiedPayment(
      env.ctx,
      reference,
      {
        status: "failed",
        reference,
        providerTransactionId: null,
        amountMinor: null,
        currency: null,
        channel: null,
        paidAt: null,
      },
      "webhook",
    );
    expect(out).toBe("ignored");
    const o = await one<{ status: string }>(env.ctx.db, "select status from payment_orders where reference = $1", [reference]);
    expect(o?.status).toBe("succeeded");
  });

  it("an amount mismatch is held for review and never accredits", async () => {
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    const reg = (await p.c.post("/registrations", regBody(ev.categoryId))).json();
    const { reference } = (await p.c.post(`/registrations/${reg.id}/checkout`)).json();
    await env.ctx.db.query("update sandbox_mock_payments set status = 'success', amount_minor = 100 where reference = $1", [
      reference,
    ]);
    expect(await verifyAndApply(env.ctx, reference, "reconciliation")).toBe("needs_review");
    const r = await one<{ status: string }>(env.ctx.db, "select status from registrations where id = $1", [reg.id]);
    expect(r?.status).toBe("awaiting_payment");
    expect(await many(env.ctx.db, "select 1 from accreditation_credentials where registration_id = $1", [reg.id])).toHaveLength(
      0,
    );
  });

  it("money arriving after a cancellation is held for review, not fulfilled", async () => {
    const p = await participant(env);
    await verifyMembership(env, p.c, await member(env));
    const reg = (await p.c.post("/registrations", regBody(ev.categoryId))).json();
    const { reference } = (await p.c.post(`/registrations/${reg.id}/checkout`)).json();
    expect((await p.c.post(`/registrations/${reg.id}/cancel`)).statusCode).toBe(200);
    await env.ctx.db.query("update sandbox_mock_payments set status = 'success' where reference = $1", [reference]);
    expect(await verifyAndApply(env.ctx, reference, "webhook")).toBe("needs_review");
  });

  it("enforces category capacity under concurrent registration", async () => {
    const small = await setupEvent(env, { capacity: 3 });
    const people = await Promise.all(Array.from({ length: 8 }, () => participant(env)));
    for (const p of people) await verifyMembership(env, p.c, await member(env));
    const res = await Promise.all(people.map((p) => p.c.post("/registrations", regBody(small.categoryId))));
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(3);
    expect(res.filter((r) => r.json().error?.code === "CATEGORY_FULL")).toHaveLength(5);
  });
});
