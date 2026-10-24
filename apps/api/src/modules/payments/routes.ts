import { PageQuery, RefundInput } from "@dnki/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { many, one, withTx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { generateReference } from "../../lib/crypto";
import { AppError, Errors } from "../../lib/errors";
import { likePrefix, pageClause, paged } from "../../lib/paging";
import { noStore, requirePermission, requireVerifiedAccount } from "../../plugins/auth";
import { MOCK_SIGNATURE_HEADER, signMockWebhook } from "./mock";
import { ProviderError } from "./provider";
import { applyVerifiedPayment, completeRefund, type OrderRow, reconcilePayments, verifyAndApply } from "./service";

export async function paymentRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const ctx = app.ctx;
  const { db, config, payments } = ctx;

  // ------------------------------------------------------------ participant checkout

  app.post(
    "/registrations/:id/checkout",
    {
      schema: { params: z.object({ id: z.uuid() }), tags: ["payments"] },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const auth = requireVerifiedAccount(req);
      // Reserve or reuse an order inside a transaction; call the provider outside it.
      const order = await withTx(db, async (tx) => {
        const reg = await one<{
          id: string;
          user_id: string;
          status: string;
          fee_minor: string;
          currency: string;
          reference: string;
        }>(tx, "select id, user_id, status, fee_minor, currency, reference from registrations where id = $1 for update", [
          req.params.id,
        ]);
        if (!reg || reg.user_id !== auth.user.id) throw Errors.notFound("Registration");
        if (reg.status !== "awaiting_payment") throw Errors.conflict("NOT_PAYABLE", "This registration is not awaiting payment.");
        const open = await one<OrderRow & { checkout_url: string | null; expired: boolean }>(
          tx,
          "select *, expires_at < now() as expired from payment_orders where registration_id = $1 and status in ('initiated', 'pending') for update",
          [reg.id],
        );
        if (open && !open.expired && open.checkout_url && open.amount_minor === reg.fee_minor)
          return { ...open, reused: true, reg };
        if (open) {
          await tx.query(
            "update payment_orders set status = 'abandoned', failure_reason = 'replaced by new checkout', updated_at = now() where id = $1",
            [open.id],
          );
        }
        const created = await one<OrderRow>(
          tx,
          `insert into payment_orders (reference, registration_id, provider, amount_minor, currency, status, expires_at)
           values ($1, $2, $3, $4, $5, 'initiated', now() + make_interval(mins => $6)) returning *`,
          [generateReference("PAY"), reg.id, payments.name, reg.fee_minor, reg.currency, config.PAYMENT_ORDER_TTL_MINUTES],
        );
        if (!created) throw new Error("order insert failed");
        return { ...created, checkout_url: null as string | null, reused: false, reg };
      });

      if (order.reused && order.checkout_url) {
        return { reference: order.reference, checkoutUrl: order.checkout_url, sandbox: payments.isSandbox };
      }
      try {
        const { checkoutUrl, accessCode } = await payments.initializeCheckout({
          reference: order.reference,
          amountMinor: BigInt(order.amount_minor),
          currency: order.currency,
          email: auth.user.email,
          customerName: auth.user.fullName,
          callbackUrl: `${config.PUBLIC_WEB_URL}/portal/payment/return?reference=${encodeURIComponent(order.reference)}`,
          metadata: { registration_reference: order.reg.reference, order_reference: order.reference },
        });
        await db.query(
          "update payment_orders set checkout_url = $2, provider_access_code = $3, status = 'pending', updated_at = now() where id = $1",
          [order.id, checkoutUrl, accessCode],
        );
        return { reference: order.reference, checkoutUrl, sandbox: payments.isSandbox };
      } catch (err) {
        await db.query("update payment_orders set status = 'failed', failure_reason = $2, updated_at = now() where id = $1", [
          order.id,
          `checkout initialisation failed: ${(err as Error).message}`.slice(0, 300),
        ]);
        req.log.error({ err, reference: order.reference }, "checkout initialisation failed");
        throw Errors.unavailable(
          "PAYMENT_PROVIDER_UNAVAILABLE",
          "The payment service is temporarily unavailable. Please try again shortly.",
        );
      }
    },
  );

  // The browser lands here after checkout. The redirect itself proves nothing: we
  // re-verify with the provider server-to-server before reporting status.
  app.get(
    "/payments/orders/:reference/status",
    {
      schema: { params: z.object({ reference: z.string().regex(/^PAY-[0-9A-Z]{12}$/) }), tags: ["payments"] },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      noStore(reply);
      const auth = requireVerifiedAccount(req);
      const order = await one<OrderRow & { user_id: string }>(
        db,
        "select o.*, r.user_id from payment_orders o join registrations r on r.id = o.registration_id where o.reference = $1",
        [req.params.reference],
      );
      if (!order || order.user_id !== auth.user.id) throw Errors.notFound("Payment");
      if (order.status === "initiated" || order.status === "pending") {
        try {
          await verifyAndApply(ctx, order.reference, "status_check", req);
        } catch (err) {
          req.log.warn({ err }, "status check verification failed");
        }
      }
      const fresh = await one<{ status: string; failure_reason: string | null; registration_status: string }>(
        db,
        "select o.status, o.failure_reason, r.status as registration_status from payment_orders o join registrations r on r.id = o.registration_id where o.reference = $1",
        [order.reference],
      );
      return {
        reference: order.reference,
        status: fresh?.status,
        registrationStatus: fresh?.registration_status,
        sandbox: payments.isSandbox,
      };
    },
  );

  // ------------------------------------------------------------ provider webhooks (raw body, signature auth)

  await app.register(async (hooks) => {
    hooks.removeAllContentTypeParsers();
    hooks.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));

    hooks.post(
      "/payments/webhooks/:provider",
      { schema: { hide: true }, config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
      async (req, reply) => {
        const { provider } = req.params as { provider: string };
        if (provider !== payments.name) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found." } });
        const raw = req.body as Buffer;
        if (!Buffer.isBuffer(raw) || raw.length === 0)
          return reply.code(400).send({ error: { code: "EMPTY_BODY", message: "Empty body." } });
        const parsed = payments.parseWebhook(raw, req.headers);

        const inserted = await one<{ id: string }>(
          db,
          `insert into payment_webhook_events (provider, dedupe_key, signature_valid, event_type, reference, payload, processing_status)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (provider, dedupe_key) do nothing returning id`,
          [
            payments.name,
            parsed.signatureValid ? parsed.dedupeKey : `rejected:${parsed.dedupeKey}:${Date.now()}`,
            parsed.signatureValid,
            parsed.eventType,
            parsed.reference,
            JSON.stringify(parsed.storedPayload),
            parsed.signatureValid ? "received" : "rejected",
          ],
        );
        if (!parsed.signatureValid) {
          req.log.warn({ provider }, "webhook rejected: invalid signature");
          return reply.code(401).send({ error: { code: "INVALID_SIGNATURE", message: "Invalid signature." } });
        }
        if (!inserted) {
          const prior = await one<{ processing_status: string }>(
            db,
            "select processing_status from payment_webhook_events where provider = $1 and dedupe_key = $2",
            [payments.name, parsed.dedupeKey],
          );
          if (prior?.processing_status !== "failed") return { ok: true, duplicate: true };
        }
        const eventRowKey = parsed.dedupeKey;
        if (parsed.kind !== "charge" || !parsed.reference) {
          if (parsed.kind === "refund" && parsed.reference) {
            const pending = await one<{ id: string }>(
              db,
              `select f.id from refunds f join payment_orders o on o.id = f.order_id
                where o.reference = $1 and f.status = 'processing'`,
              [parsed.reference],
            );
            const done = /processed|completed/i.test(JSON.stringify(parsed.storedPayload));
            if (pending && done) await completeRefund(ctx, pending.id, null, null);
          }
          await db.query(
            "update payment_webhook_events set processing_status = 'ignored', processed_at = now() where provider = $1 and dedupe_key = $2",
            [payments.name, eventRowKey],
          );
          return { ok: true };
        }
        try {
          // Never trust the webhook body: verify independently with the provider.
          const verified = await payments.verifyTransaction(parsed.reference, parsed.providerTransactionId);
          const outcome = await applyVerifiedPayment(ctx, parsed.reference, verified, "webhook", req);
          await db.query(
            `update payment_webhook_events set processing_status = 'processed', processed_at = now(), attempts = attempts + 1, error = null
              where provider = $1 and dedupe_key = $2`,
            [payments.name, eventRowKey],
          );
          return { ok: true, outcome };
        } catch (err) {
          await db.query(
            `update payment_webhook_events set processing_status = 'failed', attempts = attempts + 1, error = $3
              where provider = $1 and dedupe_key = $2`,
            [payments.name, eventRowKey, (err as Error).message.slice(0, 500)],
          );
          req.log.error({ err }, "webhook processing failed");
          // Non-2xx so the provider retries; reconciliation is the second safety net.
          return reply.code(503).send({ error: { code: "RETRY", message: "Temporarily unable to process." } });
        }
      },
    );
  });

  // ------------------------------------------------------------ sandbox (mock provider only)

  if (payments.name === "mock") {
    app.get(
      "/sandbox/payments/:reference",
      { schema: { params: z.object({ reference: z.string().regex(/^PAY-[0-9A-Z]{12}$/) }), tags: ["sandbox"] } },
      async (req, reply) => {
        noStore(reply);
        const auth = requireVerifiedAccount(req);
        const row = await one<{
          amount_minor: string;
          currency: string;
          status: string;
          user_id: string;
          registration_reference: string;
        }>(
          db,
          `select s.amount_minor, s.currency, s.status, r.user_id, r.reference as registration_reference
             from sandbox_mock_payments s join payment_orders o on o.reference = s.reference
             join registrations r on r.id = o.registration_id where s.reference = $1`,
          [req.params.reference],
        );
        if (!row || row.user_id !== auth.user.id) throw Errors.notFound("Sandbox payment");
        return {
          reference: req.params.reference,
          amountMinor: row.amount_minor,
          currency: row.currency,
          status: row.status,
          registrationReference: row.registration_reference,
          sandbox: true,
        };
      },
    );

    app.post(
      "/sandbox/payments/:reference/complete",
      {
        schema: {
          params: z.object({ reference: z.string().regex(/^PAY-[0-9A-Z]{12}$/) }),
          body: z.object({ outcome: z.enum(["success", "failed"]) }),
          tags: ["sandbox"],
        },
      },
      async (req) => {
        const auth = requireVerifiedAccount(req);
        const row = await one<{ user_id: string; status: string; transaction_id: string }>(
          db,
          `select r.user_id, s.status, s.transaction_id from sandbox_mock_payments s join payment_orders o on o.reference = s.reference
             join registrations r on r.id = o.registration_id where s.reference = $1`,
          [req.params.reference],
        );
        if (!row || row.user_id !== auth.user.id) throw Errors.notFound("Sandbox payment");
        if (row.status === "pending") {
          await db.query("update sandbox_mock_payments set status = $2, updated_at = now() where reference = $1", [
            req.params.reference,
            req.body.outcome,
          ]);
        }
        // Deliver a signed webhook through the real webhook endpoint, as a provider would.
        const body = JSON.stringify({
          id: `evt_${row.transaction_id}_${req.body.outcome}`,
          event: req.body.outcome === "success" ? "charge.success" : "charge.failed",
          data: { reference: req.params.reference, transaction_id: row.transaction_id },
        });
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/payments/webhooks/mock",
          headers: {
            "content-type": "application/json",
            [MOCK_SIGNATURE_HEADER]: signMockWebhook(config.MOCK_PAYMENT_WEBHOOK_SECRET ?? "", body),
          },
          payload: body,
        });
        return {
          delivered: res.statusCode === 200,
          returnUrl: `/portal/payment/return?reference=${encodeURIComponent(req.params.reference)}`,
        };
      },
    );
  }

  // ------------------------------------------------------------ finance

  app.get("/admin/payments/orders", { schema: { querystring: PageQuery, tags: ["payments-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "payment.read");
    const { q, status } = req.query;
    const params: unknown[] = [];
    const where: string[] = [];
    if (status) {
      params.push(status);
      where.push(`o.status = $${params.length}`);
    }
    if (q) {
      params.push(likePrefix(q));
      where.push(
        `(o.reference like upper($${params.length}) or r.reference like upper($${params.length}) or u.email like lower($${params.length}))`,
      );
    }
    const w = where.length ? `where ${where.join(" and ")}` : "";
    const page = pageClause(req.query, params.length + 1);
    const items = await many(
      db,
      `select o.id, o.reference, o.provider, o.status, o.amount_minor, o.currency, o.failure_reason, o.created_at, o.succeeded_at,
              o.last_verified_at, r.reference as registration_reference, r.status as registration_status, u.full_name, u.email
         from payment_orders o join registrations r on r.id = o.registration_id join users u on u.id = r.user_id
         ${w} order by o.created_at desc${page.sql}`,
      [...params, ...page.params],
    );
    const total = await one<{ n: number }>(
      db,
      `select count(*)::int as n from payment_orders o join registrations r on r.id = o.registration_id join users u on u.id = r.user_id ${w}`,
      params,
    );
    return paged(items, total?.n ?? 0, req.query);
  });

  app.get("/admin/payments/summary", { schema: { tags: ["payments-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "payment.read");
    const byStatus = await many(
      db,
      "select status, currency, count(*)::int as count, coalesce(sum(amount_minor), 0)::text as amount_minor from payment_orders group by status, currency order by status",
    );
    const webhooks = await many(
      db,
      "select processing_status, count(*)::int as count from payment_webhook_events group by processing_status",
    );
    return { provider: payments.name, sandbox: payments.isSandbox, byStatus, webhooks };
  });

  app.get("/admin/payments/webhooks", { schema: { querystring: PageQuery, tags: ["payments-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "payment.read");
    const page = pageClause(req.query, 1);
    const items = await many(
      db,
      `select id, provider, event_type, reference, signature_valid, processing_status, error, attempts, received_at, processed_at
         from payment_webhook_events order by received_at desc${page.sql}`,
      page.params,
    );
    const total = await one<{ n: number }>(db, "select count(*)::int as n from payment_webhook_events");
    return paged(items, total?.n ?? 0, req.query);
  });

  app.post(
    "/admin/payments/orders/:id/verify",
    { schema: { params: z.object({ id: z.uuid() }), tags: ["payments-admin"] } },
    async (req) => {
      requirePermission(req, "payment.reconcile");
      const order = await one<{ reference: string }>(db, "select reference from payment_orders where id = $1", [req.params.id]);
      if (!order) throw Errors.notFound("Payment order");
      try {
        const outcome = await verifyAndApply(ctx, order.reference, "reconciliation", req);
        await audit(db, req, {
          action: "payment.manual_reverification",
          entityType: "payment_order",
          entityId: req.params.id,
          metadata: { outcome },
        });
        return { outcome };
      } catch (err) {
        if (err instanceof ProviderError) throw Errors.unavailable("PAYMENT_PROVIDER_UNAVAILABLE", err.message);
        throw err;
      }
    },
  );

  app.post("/admin/payments/reconcile", { schema: { tags: ["payments-admin"] } }, async (req) => {
    requirePermission(req, "payment.reconcile");
    const result = await reconcilePayments(ctx, req.log);
    await audit(db, req, { action: "payment.reconciliation_run", entityType: "payment_order", metadata: result });
    return result;
  });

  app.post(
    "/admin/payments/orders/:id/refund",
    { schema: { params: z.object({ id: z.uuid() }), body: RefundInput, tags: ["payments-admin"] } },
    async (req) => {
      const auth = requirePermission(req, "payment.refund");
      const refund = await withTx(db, async (tx) => {
        const order = await one<OrderRow>(tx, "select * from payment_orders where id = $1 for update", [req.params.id]);
        if (!order) throw Errors.notFound("Payment order");
        if (order.status !== "succeeded" && order.status !== "needs_review") {
          throw Errors.conflict("NOT_REFUNDABLE", "Only successful or under-review payments can be refunded.");
        }
        const row = await one<{ id: string }>(
          tx,
          `insert into refunds (order_id, registration_id, amount_minor, currency, status, reason, requested_by)
           values ($1, $2, $3, $4, 'requested', $5, $6) returning id`,
          [order.id, order.registration_id, order.amount_minor, order.currency, req.body.reason, auth.user.id],
        ).catch((err: { code?: string }) => {
          if (err.code === "23505") throw Errors.conflict("REFUND_EXISTS", "A refund already exists for this payment.");
          throw err;
        });
        await audit(tx, req, {
          action: "payment.refund_requested",
          entityType: "payment_order",
          entityId: order.id,
          reason: req.body.reason,
        });
        return { id: row?.id as string, order };
      });
      let result: Awaited<ReturnType<typeof payments.refund>>;
      try {
        result = await payments.refund({
          reference: refund.order.reference,
          providerTransactionId: refund.order.provider_transaction_id,
          amountMinor: BigInt(refund.order.amount_minor),
          currency: refund.order.currency,
        });
      } catch (err) {
        result = { providerRefundId: null, status: "failed" };
        req.log.error({ err }, "provider refund failed");
      }
      if (result.status === "failed") {
        await db.query("update refunds set status = 'failed', failure_reason = 'provider refused or unreachable' where id = $1", [
          refund.id,
        ]);
        throw new AppError(
          502,
          "REFUND_FAILED",
          "The payment provider did not accept the refund. No changes were made to the registration.",
        );
      }
      if (result.status === "completed") {
        if (refund.order.status === "needs_review") {
          // Duplicate/unexpected payment: refund money only; the registration itself is unaffected.
          await withTx(db, async (tx) => {
            await tx.query(
              "update refunds set status = 'completed', completed_at = now(), provider_refund_id = $2 where id = $1",
              [refund.id, result.providerRefundId],
            );
            await tx.query("update payment_orders set status = 'refunded', updated_at = now() where id = $1", [refund.order.id]);
            await audit(tx, req, {
              action: "payment.refund_completed",
              entityType: "refund",
              entityId: refund.id,
              metadata: { registrationUnaffected: true },
            });
          });
        } else {
          await completeRefund(ctx, refund.id, result.providerRefundId, req);
        }
        return { refundId: refund.id, status: "completed" };
      }
      await db.query("update refunds set status = 'processing', provider_refund_id = $2 where id = $1", [
        refund.id,
        result.providerRefundId,
      ]);
      return { refundId: refund.id, status: "processing" };
    },
  );
}
