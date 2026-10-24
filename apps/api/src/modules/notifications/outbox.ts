import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../../context";
import { many, type Queryable } from "../../db/pool";

export type EnqueueInput = {
  userId: string | null;
  to: string;
  template: string;
  subject: string;
  text: string;
  /** Sensitive bodies (one-time codes, reset links) are scrubbed after delivery. */
  sensitive?: boolean;
  /** Same key => same notification. Lets callers enqueue inside retried transactions safely. */
  idempotencyKey: string;
};

/**
 * Enqueue an email in the durable outbox. Call with the transaction client so the
 * notification commits atomically with the business change that caused it.
 */
export async function enqueueEmail(q: Queryable, input: EnqueueInput): Promise<void> {
  await q.query(
    `insert into notifications (user_id, channel, template, recipient, subject, body_text, sensitive, idempotency_key)
     values ($1, 'email', $2, $3, $4, $5, $6, $7)
     on conflict (idempotency_key) do nothing`,
    [input.userId, input.template, input.to, input.subject, input.text, input.sensitive ?? false, input.idempotencyKey],
  );
}

type DueRow = {
  id: string;
  recipient: string;
  subject: string;
  body_text: string;
  attempts: number;
  max_attempts: number;
  sensitive: boolean;
};

/** Claims and sends due notifications. Safe to run on several instances (SKIP LOCKED + lease). */
export async function processOutboxBatch(ctx: AppContext, log: FastifyBaseLogger, batchSize = 20): Promise<number> {
  const due = await many<DueRow>(
    ctx.db,
    `update notifications n
        set status = 'sending', locked_until = now() + interval '2 minutes', attempts = attempts + 1
      where n.id in (
        select id from notifications
         where status in ('pending', 'sending')
           and next_attempt_at <= now()
           and (locked_until is null or locked_until < now())
         order by next_attempt_at
         limit $1
         for update skip locked)
      returning id, recipient, subject, body_text, attempts, max_attempts, sensitive`,
    [batchSize],
  );
  for (const n of due) {
    try {
      const { messageId } = await ctx.email.send({ to: n.recipient, subject: n.subject, text: n.body_text });
      await ctx.db.query(
        `update notifications
            set status = 'sent', sent_at = now(), provider_message_id = $2, locked_until = null, last_error = null,
                body_text = case when sensitive then '[redacted after delivery]' else body_text end
          where id = $1`,
        [n.id, messageId],
      );
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      const final = n.attempts >= n.max_attempts;
      const backoffSeconds = Math.min(3600, 30 * 2 ** (n.attempts - 1));
      await ctx.db.query(
        `update notifications
            set status = $2, last_error = $3, locked_until = null,
                next_attempt_at = now() + make_interval(secs => $4)
          where id = $1`,
        [n.id, final ? "failed" : "pending", message, backoffSeconds],
      );
      log.warn({ notificationId: n.id, attempt: n.attempts, final }, "notification delivery failed");
    }
  }
  return due.length;
}

export function startOutboxWorker(ctx: AppContext, log: FastifyBaseLogger, intervalMs = 2000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      while ((await processOutboxBatch(ctx, log)) > 0) {
        /* drain */
      }
    } catch (err) {
      log.error({ err }, "outbox worker error");
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
