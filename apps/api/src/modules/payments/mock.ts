import { createHmac } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { AppConfig } from "../../config";
import { type Db, one } from "../../db/pool";
import { crockford, safeEqual, sha256Hex } from "../../lib/crypto";
import type { CheckoutInput, ParsedWebhook, PaymentProvider, RefundResult, VerifiedTransaction } from "./provider";

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

export function signMockWebhook(secret: string, body: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

/**
 * SANDBOX ONLY. Simulates a hosted-checkout provider so the whole flow can be
 * exercised without credentials. It never moves money. The configuration loader
 * refuses to start with this provider in production.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  readonly isSandbox = true;
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  async initializeCheckout(input: CheckoutInput) {
    await this.db.query(
      `insert into sandbox_mock_payments (reference, transaction_id, amount_minor, currency, status)
       values ($1, $2, $3, $4, 'pending') on conflict (reference) do nothing`,
      [input.reference, `MOCKTX-${crockford(10)}`, input.amountMinor.toString(), input.currency],
    );
    return {
      checkoutUrl: `${this.config.PUBLIC_WEB_URL}/sandbox/checkout/${encodeURIComponent(input.reference)}`,
      accessCode: null,
    };
  }

  async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const row = await one<{ transaction_id: string; amount_minor: string; currency: string; status: string; updated_at: Date }>(
      this.db,
      "select transaction_id, amount_minor, currency, status, updated_at from sandbox_mock_payments where reference = $1",
      [reference],
    );
    if (!row) {
      return {
        status: "not_found",
        reference,
        providerTransactionId: null,
        amountMinor: null,
        currency: null,
        channel: null,
        paidAt: null,
      };
    }
    const status =
      row.status === "success"
        ? "success"
        : row.status === "failed"
          ? "failed"
          : row.status === "reversed"
            ? "reversed"
            : "pending";
    return {
      status,
      reference,
      providerTransactionId: row.transaction_id,
      amountMinor: BigInt(row.amount_minor),
      currency: row.currency,
      channel: "sandbox",
      paidAt: status === "success" ? row.updated_at.toISOString() : null,
    };
  }

  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): ParsedWebhook {
    const sig = String(headers[MOCK_SIGNATURE_HEADER] ?? "");
    const expected = signMockWebhook(this.config.MOCK_PAYMENT_WEBHOOK_SECRET ?? "", rawBody.toString("utf8"));
    const signatureValid = sig.length > 0 && safeEqual(sig, expected);
    let body: { id?: string; event?: string; data?: { reference?: string; transaction_id?: string } } = {};
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      /* invalid JSON is rejected below */
    }
    return {
      signatureValid,
      dedupeKey: body.id ?? sha256Hex(rawBody.toString("utf8")),
      eventType: body.event ?? null,
      reference: body.data?.reference ?? null,
      providerTransactionId: body.data?.transaction_id ?? null,
      kind: body.event?.startsWith("refund") ? "refund" : body.event?.startsWith("charge") ? "charge" : "other",
      storedPayload: body,
    };
  }

  async refund(input: { reference: string }): Promise<RefundResult> {
    const r = await this.db.query(
      "update sandbox_mock_payments set status = 'reversed', updated_at = now() where reference = $1 and status = 'success'",
      [input.reference],
    );
    return { providerRefundId: r.rowCount ? `MOCKRF-${crockford(10)}` : null, status: r.rowCount ? "completed" : "failed" };
  }
}
