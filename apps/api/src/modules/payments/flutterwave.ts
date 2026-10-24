import type { IncomingHttpHeaders } from "node:http";
import { minorDigits } from "@dnki/shared";
import type { AppConfig } from "../../config";
import { safeEqual, sha256Hex } from "../../lib/crypto";
import {
  type CheckoutInput,
  majorToMinor,
  minorToMajor,
  type ParsedWebhook,
  type PaymentProvider,
  ProviderError,
  type RefundResult,
  type VerifiedTransaction,
} from "./provider";

/**
 * Flutterwave adapter (v3 Standard hosted checkout).
 *
 * Written against Flutterwave's public v3 documentation. It has NOT yet been
 * exercised against a Flutterwave test account. Before go-live, confirm against
 * the current docs whether the account uses v3 (verif-hash header compared to the
 * secret hash configured in the dashboard) or the newer signed-webhook scheme, and
 * complete the checklist in docs/PAYMENT_INTEGRATION.md.
 *  - Amounts are sent and returned in major units; converted here without floats.
 */
export class FlutterwaveProvider implements PaymentProvider {
  readonly name = "flutterwave" as const;
  readonly isSandbox = false;
  constructor(private readonly config: AppConfig) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    let res: Response;
    try {
      res = await fetch(`${this.config.FLUTTERWAVE_BASE_URL}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.config.FLUTTERWAVE_SECRET_KEY}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new ProviderError(`Flutterwave unreachable: ${(err as Error).message}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as T;
    if (res.status >= 500) throw new ProviderError(`Flutterwave error ${res.status}`, true);
    return { status: res.status, body };
  }

  async initializeCheckout(input: CheckoutInput) {
    const { status, body } = await this.call<{ status: string; message?: string; data?: { link: string } }>("/v3/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: minorToMajor(input.amountMinor, minorDigits(input.currency)),
        currency: input.currency,
        redirect_url: input.callbackUrl,
        customer: { email: input.email, name: input.customerName },
        meta: input.metadata,
        customizations: { title: "DNKI SHARKS Registration" },
      }),
    });
    if (status !== 200 || body.status !== "success" || !body.data) {
      throw new ProviderError(`Flutterwave initialize failed: ${body.message ?? status}`, false);
    }
    return { checkoutUrl: body.data.link, accessCode: null };
  }

  async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const { status, body } = await this.call<{
      status: string;
      data?: {
        id: number;
        tx_ref: string;
        status: string;
        amount: number;
        currency: string;
        payment_type?: string;
        created_at?: string;
      };
    }>(`/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
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
    if (status !== 200 || !body.data) throw new ProviderError(`Flutterwave verify failed: ${status}`, true);
    const d = body.data;
    const s = d.status.toLowerCase();
    return {
      status: s === "successful" ? "success" : s === "failed" ? "failed" : s === "cancelled" ? "abandoned" : "pending",
      reference: d.tx_ref,
      providerTransactionId: String(d.id),
      amountMinor: majorToMinor(d.amount, minorDigits(d.currency)),
      currency: d.currency,
      channel: d.payment_type ?? null,
      paidAt: d.created_at ?? null,
    };
  }

  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): ParsedWebhook {
    const hash = String(headers["verif-hash"] ?? "");
    const signatureValid = hash.length > 0 && safeEqual(hash, this.config.FLUTTERWAVE_WEBHOOK_HASH ?? "");
    let body: { event?: string; data?: { id?: number; tx_ref?: string; status?: string } } = {};
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      /* rejected below */
    }
    return {
      signatureValid,
      dedupeKey: body.data?.id
        ? `${body.event ?? "event"}:${body.data.id}:${body.data.status ?? ""}`
        : sha256Hex(rawBody.toString("utf8")),
      eventType: body.event ?? null,
      reference: body.data?.tx_ref ?? null,
      providerTransactionId: body.data?.id ? String(body.data.id) : null,
      kind: body.event === "charge.completed" ? "charge" : body.event?.includes("refund") ? "refund" : "other",
      storedPayload: { event: body.event, data: { id: body.data?.id, tx_ref: body.data?.tx_ref, status: body.data?.status } },
    };
  }

  async refund(input: { providerTransactionId: string | null; amountMinor: bigint; currency: string }): Promise<RefundResult> {
    if (!input.providerTransactionId) return { providerRefundId: null, status: "failed" };
    const { status, body } = await this.call<{ status: string; data?: { id: number; status: string } }>(
      `/v3/transactions/${encodeURIComponent(input.providerTransactionId)}/refund`,
      { method: "POST", body: JSON.stringify({ amount: minorToMajor(input.amountMinor, minorDigits(input.currency)) }) },
    );
    if (status >= 400 || body.status !== "success" || !body.data) return { providerRefundId: null, status: "failed" };
    return { providerRefundId: String(body.data.id), status: body.data.status === "completed" ? "completed" : "processing" };
  }
}
