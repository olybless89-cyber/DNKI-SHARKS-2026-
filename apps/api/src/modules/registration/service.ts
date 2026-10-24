import { type ActorType, canTransition, type RegistrationStatus } from "@dnki/shared";
import { one, type Tx } from "../../db/pool";
import { Errors } from "../../lib/errors";

export type RegistrationRow = {
  id: string;
  reference: string;
  event_id: string;
  category_id: string;
  user_id: string;
  member_record_id: string;
  status: RegistrationStatus;
  fee_minor: string;
  currency: string;
};

export async function lockRegistration(tx: Tx, id: string): Promise<RegistrationRow> {
  const reg = await one<RegistrationRow>(tx, "select * from registrations where id = $1 for update", [id]);
  if (!reg) throw Errors.notFound("Registration");
  return reg;
}

/**
 * The only code path that changes registrations.status. Enforces the state
 * machine in @dnki/shared and records history. Call inside a transaction.
 */
export async function transitionRegistration(
  tx: Tx,
  reg: RegistrationRow,
  to: RegistrationStatus,
  actor: { type: ActorType; userId?: string | null },
  reason?: string | null,
): Promise<RegistrationRow> {
  if (reg.status === to) return reg;
  if (!canTransition(reg.status, to, actor.type)) {
    throw Errors.conflict(
      "INVALID_STATE_TRANSITION",
      `A registration cannot move from ${reg.status} to ${to}${actor.type === "system" ? "" : ` by ${actor.type}`}.`,
    );
  }
  await tx.query("update registrations set status = $2, status_reason = $3, updated_at = now() where id = $1", [
    reg.id,
    to,
    reason ?? null,
  ]);
  await tx.query(
    `insert into registration_status_history (registration_id, from_status, to_status, actor_type, actor_user_id, reason)
     values ($1, $2, $3, $4, $5, $6)`,
    [reg.id, reg.status, to, actor.type, actor.userId ?? null, reason ?? null],
  );
  return { ...reg, status: to };
}
