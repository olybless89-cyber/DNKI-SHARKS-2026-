import type { IncomingHttpHeaders } from "node:http";

export type ProviderName = "mock" | "paystack" | "flutterwave";

export type CheckoutInput = {
  reference: string;
  amountMinor: bigint;
  currency: string;
  email: string;
  customerName: string;
  callbackUrl: string;
  metadata: Record<string, string>;
};

export type VerifiedStatus = "success" | "failed" | "pending" | "abandoned" | "reversed" | "not_found";

export type VerifiedTransaction = {
  status: VerifiedStatus;
  reference: string;
  providerTransactionId: string | null;
  amountMinor: bigint | null;
  currency: string | null;
  channel: string | null;
  paidAt: string | null;
};

export type ParsedWebhook = {
  signatureValid: boolean;
  /** Stable key so redeliveries of the same notification are processed once. */
  dedupeKey: string;
  eventType: string | null;
  reference: string | null;
  providerTransactionId: string | null;
  kind: "charge" | "refund" | "other";
  /** Payload with anything sensitive removed, for storage. */
  storedPayload: unknown;
};

export type RefundResult = { providerRefundId: string | null; status: "processing" | "completed" | "failed" };

/**
 * Payment provider abstraction. Core business logic never trusts a webhook body or
 * a browser redirect: it always calls verifyTransaction() server-to-server and
 * checks reference, amount, currency and status before fulfilling.
 */
export interface PaymentProvider {
  readonly name: ProviderName;
  /** True for the mock adapter. The UI must label sandbox payments clearly. */
  readonly isSandbox: boolean;
  initializeCheckout(input: CheckoutInput): Promise<{ checkoutUrl: string; accessCode: string | null }>;
  verifyTransaction(reference: string, providerTransactionId?: string | null): Promise<VerifiedTransaction>;
  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): ParsedWebhook;
  refund(input: {
    reference: string;
    providerTransactionId: string | null;
    amountMinor: bigint;
    currency: string;
  }): Promise<RefundResult>;
}

/** Converts a provider decimal amount (major units) to integer minor units without floating point. */
export function majorToMinor(value: string | number, digits = 2): bigint {
  const s = typeof value === "number" ? value.toFixed(digits) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount ${s}`);
  const [whole = "0", frac = ""] = s.split(".");
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) throw new Error(`Amount ${s} has sub-minor precision`);
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt((frac + "0".repeat(digits)).slice(0, digits) || "0");
}

export function minorToMajor(minor: bigint, digits = 2): string {
  const d = 10n ** BigInt(digits);
  return `${minor / d}.${(minor % d).toString().padStart(digits, "0")}`;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}
