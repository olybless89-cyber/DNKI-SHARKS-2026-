import {
  CreateRegistrationInput,
  JOURNEY_LABELS,
  PageQuery,
  type ParticipantJourneyStage,
  RegistrationActionInput,
} from "@dnki/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { many, one, withTx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { generateReference } from "../../lib/crypto";
import { Errors } from "../../lib/errors";
import { likePrefix, pageClause, paged } from "../../lib/paging";
import { noStore, requireAuth, requirePermission, requireVerifiedAccount } from "../../plugins/auth";
import { reinstateCredential, revokeActiveCredential } from "../accreditation/service";
import { getActiveEvent, registrationWindow } from "../events/routes";
import { enqueueEmail } from "../notifications/outbox";
import { templates } from "../notifications/templates";
import { lockRegistration, transitionRegistration } from "./service";

export async function registrationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db } = app.ctx;

  // ------------------------------------------------------------ participant

  app.get("/portal/summary", { schema: { tags: ["participant"] } }, async (req, reply) => {
    noStore(reply);
    const auth = requireAuth(req);
    const ev = await getActiveEvent(db);
    const verification = await one<{ id: string; status: string; method: string }>(
      db,
      `select id, status, method from membership_verifications where user_id = $1
        order by (status = 'approved') desc, created_at desc limit 1`,
      [auth.user.id],
    );
    const registration = await one<{
      id: string;
      reference: string;
      status: ParticipantJourneyStage;
      fee_minor: string;
      currency: string;
      category_name: string;
      created_at: Date;
    }>(
      db,
      `select r.id, r.reference, r.status, r.fee_minor, r.currency, c.name as category_name, r.created_at
         from registrations r join registration_categories c on c.id = r.category_id
        where r.user_id = $1 and r.event_id = $2
        order by (r.status not in ('cancelled', 'refunded')) desc, r.created_at desc limit 1`,
      [auth.user.id, ev.id],
    );
    const latestOrder = registration
      ? await one<{ reference: string; status: string; checkout_url: string | null; expires_at: Date }>(
          db,
          "select reference, status, checkout_url, expires_at from payment_orders where registration_id = $1 order by created_at desc limit 1",
          [registration.id],
        )
      : undefined;

    let stage: ParticipantJourneyStage;
    if (!auth.user.emailVerified) stage = "account_unverified";
    else if (registration) stage = registration.status;
    else if (verification?.status === "approved") stage = "eligible";
    else if (verification?.status === "pending_review") stage = "membership_under_review";
    else if (verification?.status === "rejected") stage = "membership_rejected";
    else stage = "pending_membership_verification";

    return {
      stage,
      stageLabel: JOURNEY_LABELS[stage],
      registrationWindow: registrationWindow(ev, app.ctx.now()),
      verification: verification ?? null,
      registration: registration ?? null,
      payment: latestOrder ?? null,
      demoMode: app.ctx.config.DEMO_MODE,
      paymentProvider: { name: app.ctx.payments.name, sandbox: app.ctx.payments.isSandbox },
    };
  });

  app.post(
    "/registrations",
    {
      schema: { body: CreateRegistrationInput, tags: ["participant"] },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const auth = requireVerifiedAccount(req);
      const result = await withTx(db, async (tx) => {
        const ev = await getActiveEvent(tx);
        const window = registrationWindow(ev, app.ctx.now());
        if (!window.open) throw Errors.conflict("REGISTRATION_CLOSED", window.reason ?? "Registration is closed.");

        const member = await one<{ id: string; standing: string }>(
          tx,
          `select m.id, m.standing from member_records m
            where m.linked_user_id = $1
              and exists (select 1 from membership_verifications v where v.user_id = $1 and v.status = 'approved')`,
          [auth.user.id],
        );
        if (!member) throw Errors.forbidden("Only verified members may register. Complete membership verification first.");
        if (member.standing !== "good_standing") {
          throw Errors.forbidden("Your membership is not in good standing. Contact your chapter.");
        }

        // Lock the category row so capacity checks are serialised per category.
        const cat = await one<{
          id: string;
          fee_minor: string;
          currency: string;
          capacity: number | null;
          is_active: boolean;
          event_id: string;
        }>(
          tx,
          "select id, fee_minor, currency, capacity, is_active, event_id from registration_categories where id = $1 for update",
          [req.body.categoryId],
        );
        if (!cat || cat.event_id !== ev.id || !cat.is_active) throw Errors.notFound("Registration category");
        if (cat.capacity !== null) {
          const used = await one<{ n: number }>(
            tx,
            "select count(*)::int as n from registrations where category_id = $1 and status not in ('cancelled', 'refunded')",
            [cat.id],
          );
          if ((used?.n ?? 0) >= cat.capacity) throw Errors.conflict("CATEGORY_FULL", "This registration category is full.");
        }

        const existing = await one<{ id: string; status: string }>(
          tx,
          `select id, status from registrations where event_id = $1 and (user_id = $2 or member_record_id = $3)
              and status not in ('cancelled', 'refunded')`,
          [ev.id, auth.user.id, member.id],
        );
        if (existing) throw Errors.conflict("ALREADY_REGISTERED", "You already have a registration for this event.");

        // Every choice must be an active option of the right kind for this event.
        const b = req.body;
        const wanted: [string, string][] = [
          [b.patrolId, "patrol"],
          [b.designationId, "designation"],
          [b.mealFridayId, "meal_friday"],
          [b.mealSaturdayId, "meal_saturday"],
        ];
        const valid = await many<{ id: string; kind: string }>(
          tx,
          "select id, kind from registration_options where event_id = $1 and is_active and id = any($2::uuid[])",
          [ev.id, wanted.map(([id]) => id)],
        );
        for (const [id, kind] of wanted) {
          if (!valid.some((v) => v.id === id && v.kind === kind)) {
            throw Errors.badRequest("INVALID_OPTION", `Choose a valid ${kind.replace("_", " ")}.`);
          }
        }

        const reference = generateReference("REG");
        const reg = await one<{ id: string; reference: string }>(
          tx,
          `insert into registrations (reference, event_id, category_id, user_id, member_record_id, status, fee_minor, currency,
                                      terms_accepted_at, norish_name, norsical_name, patrol_option_id, designation_option_id,
                                      meal_friday_option_id, meal_saturday_option_id, hard_drugs_declaration, conduct_rules_accepted_at)
           values ($1, $2, $3, $4, $5, 'awaiting_payment', $6, $7, now(), $8, $9, $10, $11, $12, $13, $14, now())
           returning id, reference`,
          [
            reference,
            ev.id,
            cat.id,
            auth.user.id,
            member.id,
            cat.fee_minor,
            cat.currency,
            b.norishName,
            b.norsicalName,
            b.patrolId,
            b.designationId,
            b.mealFridayId,
            b.mealSaturdayId,
            b.hardDrugs,
          ],
        );
        if (!reg) throw new Error("insert failed");
        await tx.query(
          "insert into registration_status_history (registration_id, to_status, actor_type, actor_user_id, reason) values ($1, 'awaiting_payment', 'participant', $2, 'created')",
          [reg.id, auth.user.id],
        );
        await enqueueEmail(tx, {
          userId: auth.user.id,
          to: auth.user.email,
          template: "registration_created",
          ...templates.registrationCreated(auth.user.fullName, reg.reference, cat.fee_minor, cat.currency),
          idempotencyKey: `registration_created:${reg.id}`,
        });
        return { ...reg, feeMinor: cat.fee_minor, currency: cat.currency };
      }).catch((err: { code?: string }) => {
        if (err.code === "23505") throw Errors.conflict("ALREADY_REGISTERED", "You already have a registration for this event.");
        throw err;
      });
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/registrations/:id/cancel",
    { schema: { params: z.object({ id: z.uuid() }), tags: ["participant"] } },
    async (req) => {
      const auth = requireVerifiedAccount(req);
      return withTx(db, async (tx) => {
        const reg = await lockRegistration(tx, req.params.id);
        if (reg.user_id !== auth.user.id) throw Errors.notFound("Registration");
        if (reg.status !== "awaiting_payment") {
          throw Errors.conflict("CANNOT_CANCEL", "Paid registrations can only be cancelled by the accreditation desk.");
        }
        // An in-flight checkout may still complete; fulfilment will then flag it for refund review.
        await tx.query(
          "update payment_orders set status = 'abandoned', failure_reason = 'registration cancelled', updated_at = now() where registration_id = $1 and status in ('initiated', 'pending')",
          [reg.id],
        );
        await transitionRegistration(
          tx,
          reg,
          "cancelled",
          { type: "participant", userId: auth.user.id },
          "Cancelled by participant",
        );
        return { ok: true };
      });
    },
  );

  // ------------------------------------------------------------ staff

  app.get("/admin/registrations", { schema: { querystring: PageQuery, tags: ["registration-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "registration.read");
    const { q, status } = req.query;
    const params: unknown[] = [];
    const where: string[] = [];
    if (status) {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }
    if (q) {
      params.push(likePrefix(q));
      where.push(
        `(r.reference like upper($${params.length}) or m.membership_number like upper($${params.length}) or lower(u.full_name) like lower($${params.length}) or u.email like lower($${params.length}))`,
      );
    }
    const w = where.length ? `where ${where.join(" and ")}` : "";
    const page = pageClause(req.query, params.length + 1);
    const items = await many(
      db,
      `select r.id, r.reference, r.status, r.fee_minor, r.currency, r.created_at, r.updated_at,
                r.norsical_name, r.hard_drugs_declaration, p.label as patrol, d.label as designation,
                u.full_name, u.email, m.membership_number, m.chapter, c.name as category
           from registrations r
           join users u on u.id = r.user_id
           join member_records m on m.id = r.member_record_id
           join registration_categories c on c.id = r.category_id
           left join registration_options p on p.id = r.patrol_option_id
           left join registration_options d on d.id = r.designation_option_id
           ${w} order by r.created_at desc${page.sql}`,
      [...params, ...page.params],
    );
    const total = await one<{ n: number }>(
      db,
      `select count(*)::int as n from registrations r join users u on u.id = r.user_id
           join member_records m on m.id = r.member_record_id ${w}`,
      params,
    );
    return paged(items, total?.n ?? 0, req.query);
  });

  app.get(
    "/admin/registrations/:id",
    { schema: { params: z.object({ id: z.uuid() }), tags: ["registration-admin"] } },
    async (req, reply) => {
      noStore(reply);
      const auth = requirePermission(req, "registration.read");
      const reg = await one(
        db,
        `select r.*, u.full_name, u.email, u.phone, m.membership_number, m.chapter, m.standing, c.name as category,
                p.label as patrol, d.label as designation, mf.label as meal_friday, ms.label as meal_saturday,
                exists (select 1 from participant_photos ph where ph.user_id = r.user_id) as has_photo
           from registrations r join users u on u.id = r.user_id join member_records m on m.id = r.member_record_id
           join registration_categories c on c.id = r.category_id
           left join registration_options p on p.id = r.patrol_option_id
           left join registration_options d on d.id = r.designation_option_id
           left join registration_options mf on mf.id = r.meal_friday_option_id
           left join registration_options ms on ms.id = r.meal_saturday_option_id
          where r.id = $1`,
        [req.params.id],
      );
      if (!reg) throw Errors.notFound("Registration");
      const [history, orders, credentials] = await Promise.all([
        many(
          db,
          `select h.from_status, h.to_status, h.actor_type, h.reason, h.created_at, u.full_name as actor_name
             from registration_status_history h left join users u on u.id = h.actor_user_id
            where registration_id = $1 order by h.created_at`,
          [req.params.id],
        ),
        auth.permissions.has("payment.read")
          ? many(
              db,
              "select id, reference, provider, status, amount_minor, currency, failure_reason, created_at, succeeded_at from payment_orders where registration_id = $1 order by created_at",
              [req.params.id],
            )
          : Promise.resolve(null),
        auth.permissions.has("credential.read")
          ? many(
              db,
              "select id, accreditation_id, status, issued_at, revoked_at, revocation_reason, admitted_at from accreditation_credentials where registration_id = $1 order by issued_at",
              [req.params.id],
            )
          : Promise.resolve(null),
      ]);
      return { registration: reg, history, orders, credentials };
    },
  );

  app.post(
    "/admin/registrations/:id/action",
    { schema: { params: z.object({ id: z.uuid() }), body: RegistrationActionInput, tags: ["registration-admin"] } },
    async (req) => {
      const auth = requirePermission(req, "registration.manage");
      const { action, reason } = req.body;
      return withTx(db, async (tx) => {
        const reg = await lockRegistration(tx, req.params.id);
        const actor = { type: "staff" as const, userId: auth.user.id };
        switch (action) {
          case "cancel":
            if (reg.status !== "awaiting_payment") {
              throw Errors.conflict("USE_REFUND", "Paid registrations are closed through a refund by a finance officer.");
            }
            await tx.query(
              "update payment_orders set status = 'abandoned', failure_reason = 'registration cancelled', updated_at = now() where registration_id = $1 and status in ('initiated', 'pending')",
              [reg.id],
            );
            await transitionRegistration(tx, reg, "cancelled", actor, reason);
            break;
          case "suspend":
            await transitionRegistration(tx, reg, "suspended", actor, reason);
            await revokeActiveCredential(tx, req, reg.id, reason, "suspended");
            break;
          case "reinstate": {
            if (reg.status !== "suspended")
              throw Errors.conflict("NOT_SUSPENDED", "Only suspended registrations can be reinstated.");
            const cred = await reinstateCredential(tx, req, reg.id, reason);
            if (!cred) {
              throw Errors.conflict("NO_SUSPENDED_CREDENTIAL", "There is no suspended credential to reinstate; reissue instead.");
            }
            await transitionRegistration(tx, reg, "accredited", actor, reason);
            break;
          }
          case "revoke":
            await transitionRegistration(tx, reg, "revoked", actor, reason);
            await revokeActiveCredential(tx, req, reg.id, reason, "revoked");
            await tx.query(
              "update accreditation_credentials set status = 'revoked', updated_at = now() where registration_id = $1 and status = 'suspended'",
              [reg.id],
            );
            break;
        }
        await audit(tx, req, { action: `registration.${action}`, entityType: "registration", entityId: reg.id, reason });
        return { ok: true };
      });
    },
  );
}
