import { isRoleKey, PageQuery, ROLES, RoleGrantInput } from "@dnki/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { many, one, withTx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { Errors } from "../../lib/errors";
import { likePrefix, pageClause, paged } from "../../lib/paging";
import { noStore, requirePermission } from "../../plugins/auth";
import { getActiveEvent } from "../events/routes";

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function adminRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db, config, payments } = app.ctx;

  app.get("/admin/overview", { schema: { tags: ["admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "metrics.read");
    const ev = await getActiveEvent(db);
    const m = await one<Record<string, number>>(
      db,
      `select
         (select count(*)::int from member_records where standing = 'good_standing') as eligible_members,
         (select count(*)::int from member_records where is_synthetic) as synthetic_members,
         (select count(*)::int from membership_verifications where status = 'pending_review') as pending_verifications,
         (select count(*)::int from membership_verifications where status = 'approved') as verified_members,
         (select count(*)::int from registrations where event_id = $1) as total_registrations,
         (select count(*)::int from registrations where event_id = $1 and status in ('paid', 'accredited')) as paid_registrations,
         (select count(*)::int from registrations where event_id = $1 and status = 'awaiting_payment') as awaiting_payment,
         (select count(*)::int from payment_orders where status in ('initiated', 'pending')) as pending_payments,
         (select count(*)::int from payment_orders where status = 'failed') as failed_payments,
         (select count(*)::int from payment_orders where status = 'needs_review') as payments_needing_review,
         (select count(*)::int from accreditation_credentials where event_id = $1 and status = 'active') as active_credentials,
         (select count(*)::int from accreditation_credentials where event_id = $1 and status = 'revoked') as revoked_credentials,
         (select count(*)::int from accreditation_credentials where event_id = $1 and admitted_at is not null) as checked_in,
         (select count(*)::int from attendance_events where event_id = $1 and result in ('ALREADY_CHECKED_IN', 'INVALID_CREDENTIAL', 'REVOKED_CREDENTIAL')) as suspicious_scans,
         (select count(*)::int from security_incidents where event_id = $1 and status <> 'resolved') as open_incidents,
         (select count(*)::int from notifications where status = 'failed') as failed_notifications`,
      [ev.id],
    );
    const byGate = await many(
      db,
      `select g.name, count(a.*) filter (where a.counted)::int as admitted
         from gates g left join attendance_events a on a.gate_id = g.id where g.event_id = $1 group by g.id order by g.name`,
      [ev.id],
    );
    // Catering counts from confirmed (paid or accredited) delegates only.
    const catering = await many(
      db,
      `select o.kind, o.label, count(r.id)::int as delegates
         from registration_options o
         left join registrations r on r.status in ('paid', 'accredited')
               and (r.meal_friday_option_id = o.id or r.meal_saturday_option_id = o.id)
        where o.event_id = $1 and o.kind in ('meal_friday', 'meal_saturday')
        group by o.kind, o.label, o.sort order by o.kind, o.sort`,
      [ev.id],
    );
    return {
      metrics: m,
      catering,
      attendanceByGate: byGate,
      environment: {
        demoMode: config.DEMO_MODE,
        appEnv: config.APP_ENV,
        paymentProvider: payments.name,
        paymentSandbox: payments.isSandbox,
        membershipProvider: app.ctx.membership.name,
        streaming: "not_configured",
      },
      generatedAt: new Date().toISOString(),
    };
  });

  // ------------------------------------------------------------ users & roles

  app.get(
    "/admin/users",
    { schema: { querystring: PageQuery.extend({ staffOnly: z.coerce.boolean().optional() }), tags: ["admin"] } },
    async (req, reply) => {
      noStore(reply);
      requirePermission(req, "user.read");
      const params: unknown[] = [];
      const where: string[] = [];
      if (req.query.q) {
        params.push(likePrefix(req.query.q));
        where.push(`(u.email like lower($${params.length}) or lower(u.full_name) like lower($${params.length}))`);
      }
      if (req.query.staffOnly)
        where.push("exists (select 1 from user_roles x where x.user_id = u.id and x.role_key <> 'participant')");
      const w = where.length ? `where ${where.join(" and ")}` : "";
      const page = pageClause(req.query, params.length + 1);
      const items = await many(
        db,
        `select u.id, u.email, u.full_name, u.status, u.email_verified_at is not null as email_verified,
              u.mfa_enabled_at is not null as mfa_enabled, u.created_at,
              coalesce(array_agg(ur.role_key order by ur.role_key) filter (where ur.role_key is not null), '{}') as roles
         from users u left join user_roles ur on ur.user_id = u.id ${w}
        group by u.id order by u.created_at desc${page.sql}`,
        [...params, ...page.params],
      );
      const total = await one<{ n: number }>(db, `select count(*)::int as n from users u ${w}`, params);
      return {
        ...paged(items, total?.n ?? 0, req.query),
        roles: Object.entries(ROLES).map(([key, r]) => ({ key, name: r.name, privileged: r.privileged })),
      };
    },
  );

  app.post(
    "/admin/users/:id/roles",
    { schema: { params: z.object({ id: z.uuid() }), body: RoleGrantInput, tags: ["admin"] } },
    async (req) => {
      const auth = requirePermission(req, "user.manage_roles");
      const { role, reason } = req.body;
      if (!isRoleKey(role) || role === "participant") throw Errors.badRequest("UNKNOWN_ROLE", "Unknown or non-assignable role.");
      if (req.params.id === auth.user.id) throw Errors.forbidden("You cannot change your own roles.");
      return withTx(db, async (tx) => {
        const target = await one<{ id: string; status: string }>(tx, "select id, status from users where id = $1 for update", [
          req.params.id,
        ]);
        if (!target) throw Errors.notFound("User");
        await tx.query(
          "insert into user_roles (user_id, role_key, granted_by, reason) values ($1, $2, $3, $4) on conflict do nothing",
          [target.id, role, auth.user.id, reason],
        );
        // Force re-authentication so the privileged session TTL and MFA requirement apply.
        await tx.query(
          "update sessions set revoked_at = now(), revoked_reason = 'roles_changed' where user_id = $1 and revoked_at is null",
          [target.id],
        );
        await audit(tx, req, {
          action: "user.role_granted",
          entityType: "user",
          entityId: target.id,
          reason,
          metadata: { role },
        });
        return { ok: true };
      });
    },
  );

  app.delete(
    "/admin/users/:id/roles/:role",
    {
      schema: {
        params: z.object({ id: z.uuid(), role: z.string() }),
        body: z.object({ reason: z.string().trim().min(5).max(500) }),
        tags: ["admin"],
      },
    },
    async (req) => {
      const auth = requirePermission(req, "user.manage_roles");
      if (req.params.id === auth.user.id) throw Errors.forbidden("You cannot change your own roles.");
      if (req.params.role === "super_admin") {
        const remaining = await one<{ n: number }>(
          db,
          "select count(*)::int as n from user_roles where role_key = 'super_admin' and user_id <> $1",
          [req.params.id],
        );
        if ((remaining?.n ?? 0) < 1) throw Errors.conflict("LAST_SUPER_ADMIN", "At least one super administrator must remain.");
      }
      return withTx(db, async (tx) => {
        const r = await tx.query("delete from user_roles where user_id = $1 and role_key = $2 and role_key <> 'participant'", [
          req.params.id,
          req.params.role,
        ]);
        if (!r.rowCount) throw Errors.notFound("Role assignment");
        await tx.query(
          "update sessions set revoked_at = now(), revoked_reason = 'roles_changed' where user_id = $1 and revoked_at is null",
          [req.params.id],
        );
        await audit(tx, req, {
          action: "user.role_revoked",
          entityType: "user",
          entityId: req.params.id,
          reason: req.body.reason,
          metadata: { role: req.params.role },
        });
        return { ok: true };
      });
    },
  );

  app.post(
    "/admin/users/:id/status",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({ status: z.enum(["active", "suspended", "disabled"]), reason: z.string().trim().min(5).max(500) }),
        tags: ["admin"],
      },
    },
    async (req) => {
      const auth = requirePermission(req, "user.manage_roles");
      if (req.params.id === auth.user.id) throw Errors.forbidden("You cannot change your own account status.");
      return withTx(db, async (tx) => {
        const r = await tx.query("update users set status = $2, updated_at = now() where id = $1", [
          req.params.id,
          req.body.status,
        ]);
        if (!r.rowCount) throw Errors.notFound("User");
        if (req.body.status !== "active") {
          await tx.query(
            "update sessions set revoked_at = now(), revoked_reason = 'account_status' where user_id = $1 and revoked_at is null",
            [req.params.id],
          );
        }
        await audit(tx, req, {
          action: "user.status_changed",
          entityType: "user",
          entityId: req.params.id,
          reason: req.body.reason,
          metadata: { status: req.body.status },
        });
        return { ok: true };
      });
    },
  );

  // ------------------------------------------------------------ audit log

  app.get(
    "/admin/audit",
    {
      schema: {
        querystring: PageQuery.extend({ action: z.string().max(80).optional(), entityId: z.string().max(80).optional() }),
        tags: ["admin"],
      },
    },
    async (req, reply) => {
      noStore(reply);
      requirePermission(req, "audit.read");
      const params: unknown[] = [];
      const where: string[] = [];
      const action = req.query.action ?? req.query.q;
      if (action) {
        params.push(likePrefix(action));
        where.push(`a.action like $${params.length}`);
      }
      if (req.query.entityId) {
        params.push(req.query.entityId);
        where.push(`a.entity_id = $${params.length}`);
      }
      const w = where.length ? `where ${where.join(" and ")}` : "";
      const page = pageClause(req.query, params.length + 1);
      const items = await many(
        db,
        `select a.id, a.occurred_at, a.action, a.entity_type, a.entity_id, a.reason, a.correlation_id, a.ip, a.metadata, a.actor_roles,
                u.full_name as actor_name, u.email as actor_email
           from administrative_audit_events a left join users u on u.id = a.actor_user_id ${w}
          order by a.occurred_at desc${page.sql}`,
        [...params, ...page.params],
      );
      const total = await one<{ n: number }>(db, `select count(*)::int as n from administrative_audit_events a ${w}`, params);
      return paged(items, total?.n ?? 0, req.query);
    },
  );

  // ------------------------------------------------------------ restricted export

  app.get("/admin/exports/registrations.csv", { schema: { tags: ["admin"] } }, async (req, reply) => {
    requirePermission(req, "report.export");
    const ev = await getActiveEvent(db);
    // Deliberately minimal columns: no emails, phones, payment details or tokens.
    const rows = await many<Record<string, unknown>>(
      db,
      `select r.reference, r.status, m.membership_number, u.full_name, r.norish_name, r.norsical_name, m.chapter,
              po.label as patrol, de.label as designation, c.name as category, mf.label as meal_friday,
              ms.label as meal_saturday, a.accreditation_id, a.status as credential_status, a.admitted_at, r.created_at
         from registrations r join users u on u.id = r.user_id join member_records m on m.id = r.member_record_id
         join registration_categories c on c.id = r.category_id
         left join registration_options po on po.id = r.patrol_option_id
         left join registration_options de on de.id = r.designation_option_id
         left join registration_options mf on mf.id = r.meal_friday_option_id
         left join registration_options ms on ms.id = r.meal_saturday_option_id
         left join accreditation_credentials a on a.registration_id = r.id and a.status in ('active', 'suspended')
        where r.event_id = $1 order by r.created_at`,
      [ev.id],
    );
    await audit(db, req, {
      action: "export.registrations",
      entityType: "event",
      entityId: ev.id,
      metadata: { rows: rows.length },
    });
    const header = [
      "reference",
      "status",
      "membership_number",
      "full_name",
      "norish_name",
      "norsical_name",
      "chapter",
      "patrol",
      "designation",
      "category",
      "meal_friday",
      "meal_saturday",
      "accreditation_id",
      "credential_status",
      "admitted_at",
      "created_at",
    ];
    const body = [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(","))].join("\n");
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="registrations-${new Date().toISOString().slice(0, 10)}.csv"`);
    reply.header("cache-control", "no-store");
    return body;
  });

  // ------------------------------------------------------------ development-only mailbox

  if (config.DEMO_MODE && config.APP_ENV === "development") {
    app.get("/dev/mailbox", { schema: { querystring: z.object({ to: z.email() }), tags: ["dev"] } }, async (req, reply) => {
      noStore(reply);
      return {
        notice: "DEMO MODE ONLY — this inbox does not exist outside local development.",
        items: await many(
          db,
          "select id, recipient, subject, body_text, created_at from dev_mailbox where recipient = $1 order by id desc limit 20",
          [req.query.to.toLowerCase()],
        ),
      };
    });
  }
}
