import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { AppContext } from "../../context";
import { many, one, withTx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { issueCredentialIfEligible, revokeActiveCredential } from "../accreditation/service";
import { enqueueEmail } from "../notifications/outbox";
import { templates } from "../notifications/templates";
import { lockRegistration, transitionRegistration } from "../registration/service";
import type { VerifiedTransaction } from "./provider";

export type OrderRow = {
  id: string;
  reference: string;
  registration_id: string;
  provider: string;
  amount_minor: string;
  currency: string;
  status: "initiated" | "pending" | "succeeded" | "failed" | "abandoned" | "refunded" | "disputed" | "needs_review";
  provider_transaction_id: string | null;
  expires_at: Date;
};

export type FulfilmentOutcome =
  | "fulfilled"
  | "already_fulfilled"
  | "needs_review"
  | "failed"
  | "pending"
  | "disputed"
  | "ignored";

type Source = "webhook" | "status_check" | "reconciliation";

/**
 * Applies an independently verified provider result to an order. This is the only
 * code path that marks a payment successful, and it is idempotent: repeated or
 * concurrent calls for the same reference fulfil at most once because the order
 * row is locked and the success state is guarded by unique indexes.
 */
export async function applyVerifiedPayment(
  ctx: AppContext,
  orderReference: string,
  v: VerifiedTransaction,
  source: Source,
  req: FastifyRequest | null = null,
): Promise<FulfilmentOutcome> {
  return withTx(ctx.db, async (tx) => {
    const order = await one<OrderRow>(tx, "select * from payment_orders where reference = $1 for update", [orderReference]);
    if (!order) return "ignored";
    await tx.query("update payment_orders set last_verified_at = now() where id = $1", [order.id]);

    if (v.reference !== order.reference) {
      await audit(tx, req, {
        action: "payment.verification_reference_mismatch",
        entityType: "payment_order",
        entityId: order.id,
        metadata: { returned: v.reference, source },
      });
      return "ignored";
    }

    if (v.status === "reversed") {
      if (order.status === "succeeded") {
        await tx.query(
          "update payment_orders set status = 'disputed', failure_reason = 'reversed by provider', updated_at = now() where id = $1",
          [order.id],
        );
        const reg = await lockRegistration(tx, order.registration_id);
        await revokeActiveCredential(tx, null, reg.id, "Payment reversed by provider", "suspended");
        await audit(tx, req, {
          action: "payment.reversed",
          entityType: "payment_order",
          entityId: order.id,
          metadata: { source },
        });
        return "disputed";
      }
      return "ignored";
    }

    if (v.status !== "success") {
      if (["initiated", "pending"].includes(order.status)) {
        const next = v.status === "pending" || v.status === "not_found" ? "pending" : "failed";
        if (next === "failed" || order.status !== next) {
          await tx.query("update payment_orders set status = $2, failure_reason = $3, updated_at = now() where id = $1", [
            order.id,
            next,
            next === "failed" ? `provider status: ${v.status}` : null,
          ]);
        }
        return next === "failed" ? "failed" : "pending";
      }
      return "ignored";
    }

    // --- provider says success: validate everything before fulfilling ---
    if (order.status === "succeeded") {
      await recordTransaction(tx, order, v, source);
      return "already_fulfilled";
    }
    if (order.status === "refunded" || order.status === "disputed") return "ignored";

    const mismatch: string[] = [];
    if (v.amountMinor === null || v.amountMinor !== BigInt(order.amount_minor)) mismatch.push("amount");
    if (!v.currency || v.currency.toUpperCase() !== order.currency) mismatch.push("currency");
    if (mismatch.length) {
      await markNeedsReview(tx, order.id, `verified ${mismatch.join(" and ")} did not match the order`);
      await recordTransaction(tx, order, v, source);
      await audit(tx, req, {
        action: "payment.verification_mismatch",
        entityType: "payment_order",
        entityId: order.id,
        metadata: {
          mismatch,
          expected: { amount: order.amount_minor, currency: order.currency },
          got: { amount: v.amountMinor?.toString(), currency: v.currency },
          source,
        },
      });
      return "needs_review";
    }

    const reg = await lockRegistration(tx, order.registration_id);
    const otherSuccess = await one(
      tx,
      "select 1 from payment_orders where registration_id = $1 and id <> $2 and status in ('succeeded', 'refunded', 'disputed')",
      [reg.id, order.id],
    );
    if (otherSuccess || reg.status !== "awaiting_payment") {
      // Money arrived for a registration that is already paid or no longer payable
      // (e.g. cancelled while the checkout was open). Never auto-fulfil; finance reviews and refunds.
      await markNeedsReview(tx, order.id, otherSuccess ? "duplicate payment for registration" : `registration is ${reg.status}`);
      await recordTransaction(tx, order, v, source);
      await audit(tx, req, {
        action: "payment.unexpected_success",
        entityType: "payment_order",
        entityId: order.id,
        metadata: { registrationStatus: reg.status, duplicate: Boolean(otherSuccess), source },
      });
      return "needs_review";
    }

    await recordTransaction(tx, order, v, source);
    await tx.query(
      `update payment_orders set status = 'succeeded', succeeded_at = now(), provider_transaction_id = $2, failure_reason = null,
              updated_at = now() where id = $1`,
      [order.id, v.providerTransactionId],
    );
    await tx.query(
      "update payment_orders set status = 'abandoned', failure_reason = 'superseded by successful payment', updated_at = now() where registration_id = $1 and id <> $2 and status in ('initiated', 'pending')",
      [reg.id, order.id],
    );
    const paid = await transitionRegistration(
      tx,
      reg,
      "paid",
      { type: "system" },
      `Payment ${order.reference} verified via ${source}`,
    );
    await audit(tx, req, {
      action: "payment.fulfilled",
      entityType: "payment_order",
      entityId: order.id,
      metadata: { registrationId: reg.id, source, provider: order.provider },
    });

    const user = await one<{ email: string; full_name: string }>(tx, "select email, full_name from users where id = $1", [
      reg.user_id,
    ]);
    if (user) {
      await enqueueEmail(tx, {
        userId: reg.user_id,
        to: user.email,
        template: "payment_receipt",
        ...templates.paymentConfirmed(user.full_name, reg.reference, order.reference, order.amount_minor, order.currency),
        idempotencyKey: `payment_receipt:${order.id}`,
      });
    }
    await issueCredentialIfEligible(ctx, tx, paid);
    return "fulfilled";
  });
}

async function markNeedsReview(tx: import("../../db/pool").Tx, orderId: string, reason: string) {
  await tx.query("update payment_orders set status = 'needs_review', failure_reason = $2, updated_at = now() where id = $1", [
    orderId,
    reason,
  ]);
}

async function recordTransaction(tx: import("../../db/pool").Tx, order: OrderRow, v: VerifiedTransaction, source: Source) {
  if (!v.providerTransactionId) return;
  await tx.query(
    `insert into payment_transactions
       (order_id, provider, provider_transaction_id, status, amount_minor, currency, channel, paid_at, verification_source, verified_summary)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (provider, provider_transaction_id) do update set status = excluded.status`,
    [
      order.id,
      order.provider,
      v.providerTransactionId,
      v.status,
      (v.amountMinor ?? 0n).toString(),
      (v.currency ?? order.currency).toUpperCase(),
      v.channel,
      v.paidAt,
      source,
      JSON.stringify({ status: v.status, amount: v.amountMinor?.toString() ?? null, currency: v.currency }),
    ],
  );
}

/** Verifies an order with the provider and applies the result. */
export async function verifyAndApply(ctx: AppContext, reference: string, source: Source, req: FastifyRequest | null = null) {
  const order = await one<OrderRow>(ctx.db, "select * from payment_orders where reference = $1", [reference]);
  if (!order) return "ignored" as const;
  const v = await ctx.payments.verifyTransaction(order.reference, order.provider_transaction_id);
  return applyVerifiedPayment(ctx, order.reference, v, source, req);
}

/**
 * Re-verifies uncertain orders (initiated/pending) and expires abandoned ones.
 * Covers lost or delayed webhooks. Safe to run concurrently with webhooks.
 */
export async function reconcilePayments(ctx: AppContext, log: FastifyBaseLogger, limit = 200) {
  const due = await many<{ reference: string; expired: boolean }>(
    ctx.db,
    `select reference, expires_at < now() as expired from payment_orders
      where status in ('initiated', 'pending')
        and created_at < now() - interval '2 minutes'
        and (last_verified_at is null or last_verified_at < now() - interval '2 minutes')
      order by created_at limit $1`,
    [limit],
  );
  const summary: Record<string, number> = {};
  for (const o of due) {
    try {
      const outcome = await verifyAndApply(ctx, o.reference, "reconciliation");
      if (outcome === "pending" && o.expired) {
        await ctx.db.query(
          "update payment_orders set status = 'abandoned', failure_reason = 'checkout expired', updated_at = now() where reference = $1 and status in ('initiated', 'pending')",
          [o.reference],
        );
        summary.abandoned = (summary.abandoned ?? 0) + 1;
      } else {
        summary[outcome] = (summary[outcome] ?? 0) + 1;
      }
    } catch (err) {
      summary.errors = (summary.errors ?? 0) + 1;
      log.warn({ err, reference: o.reference }, "reconciliation verify failed");
    }
  }
  return { checked: due.length, ...summary };
}

/** Completes a refund: order refunded, registration refunded, credential revoked, participant notified. */
export async function completeRefund(
  ctx: AppContext,
  refundId: string,
  providerRefundId: string | null,
  req: FastifyRequest | null,
) {
  return withTx(ctx.db, async (tx) => {
    const refund = await one<{
      id: string;
      order_id: string;
      registration_id: string;
      status: string;
      amount_minor: string;
      currency: string;
    }>(tx, "select * from refunds where id = $1 for update", [refundId]);
    if (!refund || refund.status === "completed") return false;
    await tx.query(
      "update refunds set status = 'completed', completed_at = now(), provider_refund_id = coalesce($2, provider_refund_id) where id = $1",
      [refund.id, providerRefundId],
    );
    await tx.query("update payment_orders set status = 'refunded', updated_at = now() where id = $1", [refund.order_id]);
    const reg = await lockRegistration(tx, refund.registration_id);
    await revokeActiveCredential(tx, req, reg.id, "Registration refunded");
    await tx.query(
      "update accreditation_credentials set status = 'revoked', updated_at = now() where registration_id = $1 and status = 'suspended'",
      [reg.id],
    );
    if (reg.status !== "refunded") await transitionRegistration(tx, reg, "refunded", { type: "system" }, "Refund completed");
    await audit(tx, req, {
      action: "payment.refund_completed",
      entityType: "refund",
      entityId: refund.id,
      metadata: { orderId: refund.order_id },
    });
    const user = await one<{ email: string; full_name: string }>(tx, "select email, full_name from users where id = $1", [
      reg.user_id,
    ]);
    if (user) {
      await enqueueEmail(tx, {
        userId: reg.user_id,
        to: user.email,
        template: "refund_completed",
        ...templates.refundCompleted(user.full_name, reg.reference, refund.amount_minor, refund.currency),
        idempotencyKey: `refund_completed:${refund.id}`,
      });
    }
    return true;
  });
}

export function startReconciliationWorker(ctx: AppContext, log: FastifyBaseLogger, intervalMs = 5 * 60_000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await reconcilePayments(ctx, log);
      if (r.checked) log.info({ reconciliation: r }, "payment reconciliation run");
    } catch (err) {
      log.error({ err }, "reconciliation worker error");
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
