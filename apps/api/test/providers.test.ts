/** Unit tests for provider adapters (no network) and rate limiting. */
import { createHmac } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { FlutterwaveProvider } from "../src/modules/payments/flutterwave";
import { PaystackProvider } from "../src/modules/payments/paystack";
import { majorToMinor, minorToMajor } from "../src/modules/payments/provider";
import { Client, makeApp, testConfig } from "./helpers";

const paystackCfg = testConfig({ PAYMENT_PROVIDER: "paystack", PAYSTACK_SECRET_KEY: "sk_test_dummy_value" });
const flwCfg = testConfig({
  PAYMENT_PROVIDER: "flutterwave",
  FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-dummy",
  FLUTTERWAVE_WEBHOOK_HASH: "my-secret-hash",
});

describe("money conversion", () => {
  it("converts major to minor units exactly", () => {
    expect(majorToMinor("25000")).toBe(2_500_000n);
    expect(majorToMinor("25000.5")).toBe(2_500_050n);
    expect(majorToMinor(19.99)).toBe(1999n);
    expect(majorToMinor(0.1 + 0.2)).toBe(30n);
    expect(() => majorToMinor("1.005")).toThrow();
    expect(minorToMajor(2_500_050n)).toBe("25000.50");
  });
});

describe("Paystack adapter", () => {
  const p = new PaystackProvider(paystackCfg);
  const body = Buffer.from(
    JSON.stringify({ event: "charge.success", data: { id: 42, reference: "PAY-ABCDEFGHJKMN", status: "success" } }),
  );

  it("accepts a correct HMAC-SHA512 signature and rejects others", () => {
    const sig = createHmac("sha512", "sk_test_dummy_value").update(body).digest("hex");
    const ok = p.parseWebhook(body, { "x-paystack-signature": sig });
    expect(ok.signatureValid).toBe(true);
    expect(ok.reference).toBe("PAY-ABCDEFGHJKMN");
    expect(ok.kind).toBe("charge");
    expect(p.parseWebhook(body, { "x-paystack-signature": "deadbeef" }).signatureValid).toBe(false);
    expect(p.parseWebhook(body, {}).signatureValid).toBe(false);
  });

  it("maps verify responses and keeps amounts in kobo", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            id: 9,
            status: "success",
            reference: "PAY-X",
            amount: 1500000,
            currency: "NGN",
            channel: "card",
            paid_at: "2026-01-01T00:00:00Z",
          },
        }),
        { status: 200 },
      ),
    );
    const v = await p.verifyTransaction("PAY-X");
    expect(v).toMatchObject({ status: "success", amountMinor: 1_500_000n, currency: "NGN", providerTransactionId: "9" });
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://api.paystack.co/transaction/verify/PAY-X");
    spy.mockRestore();
  });
});

describe("Flutterwave adapter", () => {
  const f = new FlutterwaveProvider(flwCfg);
  const body = Buffer.from(
    JSON.stringify({ event: "charge.completed", data: { id: 77, tx_ref: "PAY-ABCDEFGHJKMN", status: "successful" } }),
  );

  it("checks the verif-hash header in constant time", () => {
    expect(f.parseWebhook(body, { "verif-hash": "my-secret-hash" }).signatureValid).toBe(true);
    expect(f.parseWebhook(body, { "verif-hash": "wrong" }).signatureValid).toBe(false);
  });

  it("converts major-unit amounts without floating point errors", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "success",
          data: { id: 77, tx_ref: "PAY-X", status: "successful", amount: 15000.1, currency: "NGN" },
        }),
        { status: 200 },
      ),
    );
    const v = await f.verifyTransaction("PAY-X");
    expect(v.amountMinor).toBe(1_500_010n);
    expect(v.status).toBe("success");
    spy.mockRestore();
  });
});

describe("configuration safety", () => {
  it("refuses unsafe production configuration", () => {
    expect(() =>
      testConfig({ APP_ENV: "production", DEMO_MODE: "false", COOKIE_SECURE: "true", RATE_LIMIT_ENABLED: "true" }),
    ).toThrow(/mock is not allowed/);
    expect(() => testConfig({ APP_ENV: "staging" })).toThrow(/DEMO_MODE/);
    expect(() => testConfig({ ENCRYPTION_KEY: "c2hvcnQ=" })).toThrow(/32 bytes/);
  });
});

describe("rate limiting", async () => {
  const env = await makeApp({}, { RATE_LIMIT_ENABLED: "true" });
  afterAll(async () => {
    await env.app.close();
    await env.ctx.db.end();
  });
  it("throttles repeated sign-in attempts", async () => {
    const c = new Client(env.app);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++)
      codes.push((await c.post("/auth/login", { email: "nobody@example.test", password: "irrelevant" })).statusCode);
    expect(codes).toContain(429);
  });
});
