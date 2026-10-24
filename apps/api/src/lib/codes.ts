import { one, type Queryable } from "../db/pool";
import { hmacHex, numericCode } from "./crypto";
import { Errors } from "./errors";

type Purpose = "email_verification" | "membership_contact";

function codeHash(key: Buffer, purpose: Purpose, scope: string, code: string) {
  return hmacHex(key, `${purpose}:${scope}:${code}`);
}

/** Issues a new 6-digit code, invalidating earlier unconsumed codes for the same purpose and subject. */
export async function issueCode(
  q: Queryable,
  key: Buffer,
  opts: { userId: string; purpose: Purpose; subjectId?: string | null; ttlMinutes?: number },
): Promise<string> {
  const scope = opts.subjectId ?? opts.userId;
  await q.query(
    `update one_time_codes set consumed_at = now()
      where user_id = $1 and purpose = $2 and consumed_at is null and coalesce(subject_id, user_id) = $3`,
    [opts.userId, opts.purpose, scope],
  );
  const code = numericCode(6);
  await q.query(
    `insert into one_time_codes (user_id, purpose, subject_id, code_hash, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
    [opts.userId, opts.purpose, opts.subjectId ?? null, codeHash(key, opts.purpose, scope, code), opts.ttlMinutes ?? 15],
  );
  return code;
}

/** Returns seconds since the most recent code of this purpose was issued, for resend throttling. */
export async function secondsSinceLastCode(q: Queryable, userId: string, purpose: Purpose): Promise<number | null> {
  const row = await one<{ s: number }>(
    q,
    "select extract(epoch from now() - max(created_at))::int as s from one_time_codes where user_id = $1 and purpose = $2",
    [userId, purpose],
  );
  return row?.s ?? null;
}

/**
 * Verifies and consumes a code. Each wrong guess counts against the active code;
 * after max_attempts the code is burned and a new one must be requested.
 */
export async function consumeCode(
  q: Queryable,
  key: Buffer,
  opts: { userId: string; purpose: Purpose; subjectId?: string | null; code: string },
): Promise<void> {
  const scope = opts.subjectId ?? opts.userId;
  const active = await one<{ id: string; code_hash: string; attempts: number; max_attempts: number; expired: boolean }>(
    q,
    `select id, code_hash, attempts, max_attempts, expires_at <= now() as expired
       from one_time_codes
      where user_id = $1 and purpose = $2 and consumed_at is null and coalesce(subject_id, user_id) = $3
      order by created_at desc limit 1
      for update`,
    [opts.userId, opts.purpose, scope],
  );
  if (!active || active.expired || active.attempts >= active.max_attempts) {
    throw Errors.badRequest("CODE_EXPIRED", "This code has expired. Request a new one.");
  }
  if (active.code_hash !== codeHash(key, opts.purpose, scope, opts.code)) {
    await q.query("update one_time_codes set attempts = attempts + 1 where id = $1", [active.id]);
    throw Errors.badRequest("CODE_INVALID", "That code is not correct.");
  }
  await q.query("update one_time_codes set consumed_at = now() where id = $1", [active.id]);
}
