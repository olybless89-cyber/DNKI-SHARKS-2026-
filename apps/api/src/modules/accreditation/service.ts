import { QR_PAYLOAD_PREFIX } from "@dnki/shared";
import type { FastifyRequest } from "fastify";
import type { AppContext } from "../../context";
import { one, type Tx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { encrypt, generateAccreditationId, randomToken, sha256Hex } from "../../lib/crypto";
import { enqueueEmail } from "../notifications/outbox";
import { templates } from "../notifications/templates";
import { type RegistrationRow, transitionRegistration } from "../registration/service";

export type CredentialRow = {
  id: string;
  accreditation_id: string;
  registration_id: string;
  user_id: string;
  event_id: string;
  status: "active" | "revoked" | "superseded" | "suspended";
  admitted_at: Date | null;
};

/** QR payload: fixed prefix + 256-bit opaque random token. Contains no personal data. */
export function qrPayload(token: string): string {
  return `${QR_PAYLOAD_PREFIX}${token}`;
}

export function tokenFromPayload(payload: string): string | null {
  const p = payload.trim();
  if (!p.startsWith(QR_PAYLOAD_PREFIX)) return null;
  const token = p.slice(QR_PAYLOAD_PREFIX.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function credentialTokenHash(token: string): string {
  return sha256Hex(`credential:${token}`);
}

async function uniqueAccreditationId(tx: Tx): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const id = generateAccreditationId();
    if (!(await one(tx, "select 1 from accreditation_credentials where accreditation_id = $1", [id]))) return id;
  }
  throw new Error("Could not allocate a unique accreditation ID");
}

/** Creates a new active credential. Caller must hold the registration lock. */
async function createCredential(ctx: AppContext, tx: Tx, reg: RegistrationRow, replacesId: string | null) {
  const token = randomToken(32);
  const accreditationId = await uniqueAccreditationId(tx);
  const ev = await one<{ credential_valid_from: Date | null; credential_valid_until: Date | null }>(
    tx,
    "select credential_valid_from, credential_valid_until from events where id = $1",
    [reg.event_id],
  );
  const cred = await one<CredentialRow>(
    tx,
    `insert into accreditation_credentials
       (accreditation_id, token_hash, token_enc, registration_id, user_id, event_id, status, valid_from, valid_until, replaces_id)
     values ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9)
     returning id, accreditation_id, registration_id, user_id, event_id, status, admitted_at`,
    [
      accreditationId,
      credentialTokenHash(token),
      encrypt(token, ctx.config.encryptionKey),
      reg.id,
      reg.user_id,
      reg.event_id,
      ev?.credential_valid_from ?? null,
      ev?.credential_valid_until ?? null,
      replacesId,
    ],
  );
  if (!cred) throw new Error("credential insert failed");
  return cred;
}

/**
 * Issues the accreditation credential for a paid registration, but only if the
 * member is still verified and in good standing. Otherwise the registration stays
 * "paid" and is flagged for review. Call inside the payment-fulfilment transaction.
 */
export async function issueCredentialIfEligible(
  ctx: AppContext,
  tx: Tx,
  reg: RegistrationRow,
): Promise<{ issued: boolean; credential?: CredentialRow; reason?: string }> {
  if (reg.status !== "paid") return { issued: false, reason: `registration is ${reg.status}` };
  const existing = await one<CredentialRow>(
    tx,
    "select id, accreditation_id, registration_id, user_id, event_id, status, admitted_at from accreditation_credentials where registration_id = $1 and status = 'active'",
    [reg.id],
  );
  if (existing) return { issued: false, credential: existing, reason: "already issued" };

  const eligibility = await one<{ standing: string; linked_user_id: string | null; approved: boolean }>(
    tx,
    `select m.standing, m.linked_user_id,
            exists (select 1 from membership_verifications v where v.user_id = $2 and v.status = 'approved') as approved
       from member_records m where m.id = $1`,
    [reg.member_record_id, reg.user_id],
  );
  if (eligibility?.standing !== "good_standing" || eligibility.linked_user_id !== reg.user_id || !eligibility.approved) {
    await audit(tx, null, {
      action: "accreditation.withheld",
      entityType: "registration",
      entityId: reg.id,
      reason: "Membership no longer eligible at time of payment confirmation",
      metadata: { standing: eligibility?.standing ?? null },
    });
    return { issued: false, reason: "membership not eligible" };
  }

  const cred = await createCredential(ctx, tx, reg, null);
  await tx.query("insert into credential_events (credential_id, event_type) values ($1, 'issued')", [cred.id]);
  await transitionRegistration(tx, reg, "accredited", { type: "system" }, "Payment verified; credential issued");

  const user = await one<{ email: string; full_name: string }>(tx, "select email, full_name from users where id = $1", [
    reg.user_id,
  ]);
  const ev = await one<{ name: string }>(tx, "select name from events where id = $1", [reg.event_id]);
  if (user) {
    await enqueueEmail(tx, {
      userId: reg.user_id,
      to: user.email,
      template: "digital_invitation",
      ...templates.invitation(
        user.full_name,
        cred.accreditation_id,
        `${ctx.config.PUBLIC_WEB_URL}/portal/pass`,
        ev?.name ?? "the event",
      ),
      idempotencyKey: `invitation:${cred.id}`,
    });
  }
  return { issued: true, credential: cred };
}

/** Revokes the active credential (if any). Caller holds the registration lock. */
export async function revokeActiveCredential(
  tx: Tx,
  req: FastifyRequest | null,
  registrationId: string,
  reason: string,
  status: "revoked" | "suspended" = "revoked",
): Promise<CredentialRow | null> {
  const cred = await one<CredentialRow>(
    tx,
    `update accreditation_credentials
        set status = $2, revoked_at = now(), revoked_by = $3, revocation_reason = $4, updated_at = now()
      where registration_id = $1 and status = 'active'
      returning id, accreditation_id, registration_id, user_id, event_id, status, admitted_at`,
    [registrationId, status, req?.auth?.user.id ?? null, reason],
  );
  if (cred) {
    await tx.query("insert into credential_events (credential_id, event_type, actor_user_id, reason) values ($1, $2, $3, $4)", [
      cred.id,
      status === "revoked" ? "revoked" : "suspended",
      req?.auth?.user.id ?? null,
      reason,
    ]);
  }
  return cred ?? null;
}

/** Reinstates a suspended credential. */
export async function reinstateCredential(tx: Tx, req: FastifyRequest, registrationId: string, reason: string) {
  const cred = await one<{ id: string }>(
    tx,
    `update accreditation_credentials set status = 'active', revoked_at = null, revoked_by = null, revocation_reason = null,
            updated_at = now()
      where id = (select id from accreditation_credentials where registration_id = $1 and status = 'suspended'
                   order by issued_at desc limit 1)
      returning id`,
    [registrationId],
  );
  if (cred) {
    await tx.query(
      "insert into credential_events (credential_id, event_type, actor_user_id, reason) values ($1, 'reinstated', $2, $3)",
      [cred.id, req.auth?.user.id ?? null, reason],
    );
  }
  return cred;
}

/** Replaces the active credential with a new token and ID. The old QR stops working immediately. */
export async function reissueCredential(ctx: AppContext, tx: Tx, req: FastifyRequest, reg: RegistrationRow, reason: string) {
  const old = await one<CredentialRow & { admitted_at: Date | null; presence: string }>(
    tx,
    `update accreditation_credentials set status = 'superseded', revoked_at = now(), revoked_by = $2, revocation_reason = $3,
            updated_at = now()
      where registration_id = $1 and status = 'active'
      returning id, accreditation_id, registration_id, user_id, event_id, status, admitted_at, admitted_gate_id, presence`,
    [reg.id, req.auth?.user.id ?? null, reason],
  );
  if (!old) return null;
  const fresh = await createCredential(ctx, tx, reg, old.id);
  // Carry admission state forward so a reissue cannot be used to enter twice.
  await tx.query(
    `update accreditation_credentials n
        set admitted_at = o.admitted_at, admitted_gate_id = o.admitted_gate_id, presence = o.presence
       from accreditation_credentials o where n.id = $1 and o.id = $2`,
    [fresh.id, old.id],
  );
  await tx.query(
    "insert into credential_events (credential_id, event_type, actor_user_id, reason, metadata) values ($1, 'superseded', $2, $3, $4), ($5, 'reissued', $2, $3, $6)",
    [
      old.id,
      req.auth?.user.id ?? null,
      reason,
      JSON.stringify({ replacedBy: fresh.id }),
      fresh.id,
      JSON.stringify({ replaces: old.id }),
    ],
  );
  const user = await one<{ email: string; full_name: string }>(tx, "select email, full_name from users where id = $1", [
    reg.user_id,
  ]);
  if (user) {
    await enqueueEmail(tx, {
      userId: reg.user_id,
      to: user.email,
      template: "credential_reissued",
      ...templates.credentialReissued(user.full_name, fresh.accreditation_id, `${ctx.config.PUBLIC_WEB_URL}/portal/pass`),
      idempotencyKey: `credential_reissued:${fresh.id}`,
    });
  }
  return { old, fresh };
}
