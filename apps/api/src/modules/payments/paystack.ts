import { createHmac } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { AppConfig } from "../../config";
import { safeEqual, sha256Hex } from "../../lib/crypto";
import {
  type CheckoutInput,
  type ParsedWebhook,
  type PaymentProvider,
  ProviderError,
  type RefundResult,
  type VerifiedStatus,
  type VerifiedTransaction,
} from "./provider";

/**
 * Paystack adapter (hosted checkout via Transaction Initialize).
 *
 * Written against Paystack's public API documentation. It has NOT yet been
 * exercised against a Paystack test account; see docs/PAYMENT_INTEGRATION.md for
 * the sandbox validation checklist that must pass before go-live.
 *  - Amounts are sent in the currency's subunit (kobo for NGN).
 *  - Webhooks are signed with HMAC-SHA512 of the raw body using the secret key,
 *    delivered in the x-paystack-signature header.
 */
export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack" as const;
  readonly isSandbox = false;
  constructor(private readonly config: AppConfig) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    let res: Response;
    try {
      res = await fetch(`${this.config.PAYSTACK_BASE_URL}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.config.PAYSTACK_SECRET_KEY}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new ProviderError(`Paystack unreachable: ${(err as Error).message}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as T;
    if (res.status >= 500) throw new ProviderError(`Paystack error ${res.status}`, true);
    return { status: res.status, body };
  }

  async initializeCheckout(input: CheckoutInput) {
    const { status, body } = await this.call<{
      status: boolean;
      message?: string;
      data?: { authorization_url: string; access_code: string };
    }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: input.amountMinor.toString(),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });
    if (status !== 200 || !body.status || !body.data)
      throw new ProviderError(`Paystack initialize failed: ${body.message ?? status}`, false);
    return { checkoutUrl: body.data.authorization_url, accessCode: body.data.access_code };
  }

  async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const { status, body } = await this.call<{
      status: boolean;
      data?: {
        id: number;
        status: string;
        reference: string;
        amount: number;
        currency: string;
        channel: string;
        paid_at: string | null;
      };
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (status === 404 || (status === 400 && !body.data)) {
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
    if (status !== 200 || !body.data) throw new ProviderError(`Paystack verify failed: ${status}`, true);
    const d = body.data;
    const map: Record<string, VerifiedStatus> = {
      success: "success",
      failed: "failed",
      abandoned: "abandoned",
      reversed: "reversed",
      ongoing: "pending",
      pending: "pending",
      processing: "pending",
      queued: "pending",
    };
    return {
      status: map[d.status] ?? "pending",
      reference: d.reference,
      providerTransactionId: String(d.id),
      amountMinor: BigInt(Math.trunc(d.amount)),
      currency: d.currency,
      channel: d.channel ?? null,
      paidAt: d.paid_at,
    };
  }

  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): ParsedWebhook {
    const sig = String(headers["x-paystack-signature"] ?? "");
    const expected = createHmac("sha512", this.config.PAYSTACK_SECRET_KEY ?? "")
      .update(rawBody)
      .digest("hex");
    const signatureValid = sig.length > 0 && safeEqual(sig, expected);
    let body: { event?: string; data?: { id?: number; reference?: string; transaction_reference?: string; status?: string } } =
      {};
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      /* rejected below */
    }
    const event = body.event ?? null;
    const isRefund = Boolean(event?.startsWith("refund."));
    return {
      signatureValid,
      // Paystack payloads carry no delivery ID; identical redeliveries hash identically.
      dedupeKey: sha256Hex(rawBody.toString("utf8")),
      eventType: event,
      reference: (isRefund ? body.data?.transaction_reference : body.data?.reference) ?? null,
      providerTransactionId: body.data?.id ? String(body.data.id) : null,
      kind: isRefund ? "refund" : event === "charge.success" ? "charge" : "other",
      storedPayload: { event, data: { id: body.data?.id, reference: body.data?.reference, status: body.data?.status } },
    };
  }

  async refund(input: { reference: string; amountMinor: bigint }): Promise<RefundResult> {
    const { status, body } = await this.call<{ status: boolean; data?: { id: number; status: string } }>("/refund", {
      method: "POST",
      body: JSON.stringify({ transaction: input.reference, amount: input.amountMinor.toString() }),
    });
    if (status >= 400 || !body.status || !body.data) return { providerRefundId: null, status: "failed" };
    return { providerRefundId: String(body.data.id), status: body.data.status === "processed" ? "completed" : "processing" };
  }
}
