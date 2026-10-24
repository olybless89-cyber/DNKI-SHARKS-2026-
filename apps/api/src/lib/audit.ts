import type { FastifyRequest } from "fastify";
import type { Queryable } from "../db/pool";

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Write an append-only audit record. Pass the transaction client when the audited
 * change is transactional so the audit row commits or rolls back with it.
 * Never put secrets, raw tokens or full personal records in metadata.
 */
export async function audit(q: Queryable, req: FastifyRequest | null, input: AuditInput): Promise<void> {
  const actor = req?.auth?.user;
  await q.query(
    `insert into administrative_audit_events
       (actor_user_id, actor_roles, action, entity_type, entity_id, reason, correlation_id, ip, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actor?.id ?? null,
      req?.auth?.roles ?? [],
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.reason ?? null,
      req?.id ?? null,
      req?.ip ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
