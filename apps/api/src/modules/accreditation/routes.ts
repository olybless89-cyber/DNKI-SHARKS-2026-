import { CredentialActionInput, PageQuery } from "@dnki/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import QRCode from "qrcode";
import { z } from "zod";
import { many, one, withTx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { decrypt } from "../../lib/crypto";
import { Errors } from "../../lib/errors";
import { likePrefix, pageClause, paged } from "../../lib/paging";
import { noStore, requirePermission, requireVerifiedAccount } from "../../plugins/auth";
import { enqueueEmail } from "../notifications/outbox";
import { templates } from "../notifications/templates";
import { lockRegistration, transitionRegistration } from "../registration/service";
import { qrPayload, reissueCredential, revokeActiveCredential } from "./service";

const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 2, color: { dark: "#0A0A0A", light: "#FFFFFF" } } as const;

export async function accreditationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const ctx = app.ctx;
  const { db, config } = ctx;

  async function ownCredential(userId: string) {
    return one<{
      id: string;
      accreditation_id: string;
      status: string;
      token_enc: string;
      issued_at: Date;
      valid_from: Date | null;
      valid_until: Date | null;
      admitted_at: Date | null;
      holder_name: string;
      membership_number: string;
      chapter: string;
      category: string;
      requires_identity_check: boolean;
      event_name: string;
      event_theme: string;
      event_starts_at: Date | null;
      venue: string | null;
      registration_reference: string;
    }>(
      db,
      `select c.id, c.accreditation_id, c.status, c.token_enc, c.issued_at, c.valid_from, c.valid_until, c.admitted_at,
              u.full_name as holder_name, m.membership_number, m.chapter, cat.name as category, cat.requires_identity_check,
              e.name as event_name, e.theme as event_theme, e.starts_at as event_starts_at, e.venue_text as venue,
              r.reference as registration_reference
         from accreditation_credentials c
         join registrations r on r.id = c.registration_id
         join users u on u.id = c.user_id
         join member_records m on m.id = r.member_record_id
         join registration_categories cat on cat.id = r.category_id
         join events e on e.id = c.event_id
        where c.user_id = $1 and e.is_active
        order by (c.status = 'active') desc, c.issued_at desc limit 1`,
      [userId],
    );
  }

  // ------------------------------------------------------------ participant pass

  app.get("/me/credential", { schema: { tags: ["participant"] } }, async (req, reply) => {
    noStore(reply);
    reply.header("x-robots-tag", "noindex");
    const auth = requireVerifiedAccount(req);
    const c = await ownCredential(auth.user.id);
    if (!c) return { credential: null };
    const { token_enc, ...rest } = c;
    const qrSvg =
      c.status === "active"
        ? await QRCode.toString(qrPayload(decrypt(token_enc, config.encryptionKey)), { ...QR_OPTIONS, type: "svg" })
        : null;
    return { credential: { ...rest, qrSvg } };
  });

  app.get("/me/credential/qr.svg", { schema: { tags: ["participant"] } }, async (req, reply) => {
    noStore(reply);
    const auth = requireVerifiedAccount(req);
    const c = await ownCredential(auth.user.id);
    if (c?.status !== "active") throw Errors.notFound("Active credential");
    const svg = await QRCode.toString(qrPayload(decrypt(c.token_enc, config.encryptionKey)), {
      ...QR_OPTIONS,
      type: "svg",
      width: 600,
    });
    reply.header("content-type", "image/svg+xml");
    reply.header("content-disposition", `attachment; filename="${c.accreditation_id}.svg"`);
    return svg;
  });

  // ------------------------------------------------------------ staff

  app.get("/admin/credentials", { schema: { querystring: PageQuery, tags: ["accreditation-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "credential.read");
    const { q, status } = req.query;
    const params: unknown[] = [];
    const where: string[] = [];
    if (status) {
      params.push(status);
      where.push(`c.status = $${params.length}`);
    }
    if (q) {
      params.push(likePrefix(q));
      where.push(
        `(c.accreditation_id like upper($${params.length}) or lower(u.full_name) like lower($${params.length}) or m.membership_number like upper($${params.length}))`,
      );
    }
    const w = where.length ? `where ${where.join(" and ")}` : "";
    const page = pageClause(req.query, params.length + 1);
    // Never return token material: only the hash exists for validation and it is not exposed either.
    const items = await many(
      db,
      `select c.id, c.accreditation_id, c.status, c.issued_at, c.revoked_at, c.revocation_reason, c.admitted_at, c.presence,
              c.registration_id, r.reference as registration_reference, r.status as registration_status,
              u.full_name, m.membership_number, m.chapter, g.name as admitted_gate
         from accreditation_credentials c
         join registrations r on r.id = c.registration_id
         join users u on u.id = c.user_id
         join member_records m on m.id = r.member_record_id
         left join gates g on g.id = c.admitted_gate_id
         ${w} order by c.issued_at desc${page.sql}`,
      [...params, ...page.params],
    );
    const total = await one<{ n: number }>(
      db,
      `select count(*)::int as n from accreditation_credentials c join registrations r on r.id = c.registration_id
         join users u on u.id = c.user_id join member_records m on m.id = r.member_record_id ${w}`,
      params,
    );
    return paged(items, total?.n ?? 0, req.query);
  });

  app.get(
    "/admin/credentials/:id/events",
    { schema: { params: z.object({ id: z.uuid() }), tags: ["accreditation-admin"] } },
    async (req, reply) => {
      noStore(reply);
      requirePermission(req, "credential.read");
      return {
        items: await many(
          db,
          `select e.event_type, e.reason, e.metadata, e.created_at, u.full_name as actor
             from credential_events e left join users u on u.id = e.actor_user_id where e.credential_id = $1 order by e.created_at`,
          [req.params.id],
        ),
      };
    },
  );

  app.post(
    "/admin/credentials/:id/revoke",
    { schema: { params: z.object({ id: z.uuid() }), body: CredentialActionInput, tags: ["accreditation-admin"] } },
    async (req) => {
      requirePermission(req, "credential.revoke");
      return withTx(db, async (tx) => {
        const c = await one<{ registration_id: string; status: string }>(
          tx,
          "select registration_id, status from accreditation_credentials where id = $1",
          [req.params.id],
        );
        if (!c) throw Errors.notFound("Credential");
        const reg = await lockRegistration(tx, c.registration_id);
        if (c.status !== "active" && c.status !== "suspended")
          throw Errors.conflict("NOT_ACTIVE", "This credential is not active.");
        await revokeActiveCredential(tx, req, reg.id, req.body.reason, "revoked");
        await tx.query(
          "update accreditation_credentials set status = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now() where id = $1 and status = 'suspended'",
          [req.params.id],
        );
        if (reg.status === "accredited" || reg.status === "suspended") {
          await transitionRegistration(tx, reg, "revoked", { type: "staff", userId: req.auth?.user.id }, req.body.reason);
        }
        await audit(tx, req, {
          action: "credential.revoked",
          entityType: "credential",
          entityId: req.params.id,
          reason: req.body.reason,
        });
        const user = await one<{ email: string; full_name: string }>(tx, "select email, full_name from users where id = $1", [
          reg.user_id,
        ]);
        if (user) {
          await enqueueEmail(tx, {
            userId: reg.user_id,
            to: user.email,
            template: "credential_revoked",
            ...templates.credentialRevoked(user.full_name),
            idempotencyKey: `credential_revoked:${req.params.id}`,
          });
        }
        return { ok: true };
      });
    },
  );

  app.post(
    "/admin/credentials/:id/reissue",
    { schema: { params: z.object({ id: z.uuid() }), body: CredentialActionInput, tags: ["accreditation-admin"] } },
    async (req) => {
      requirePermission(req, "credential.reissue");
      return withTx(db, async (tx) => {
        const c = await one<{ registration_id: string; status: string }>(
          tx,
          "select registration_id, status from accreditation_credentials where id = $1",
          [req.params.id],
        );
        if (!c) throw Errors.notFound("Credential");
        const reg = await lockRegistration(tx, c.registration_id);
        if (c.status !== "active" || reg.status !== "accredited") {
          throw Errors.conflict("NOT_REISSUABLE", "Only active credentials on accredited registrations can be reissued.");
        }
        const result = await reissueCredential(ctx, tx, req, reg, req.body.reason);
        if (!result) throw Errors.conflict("NOT_REISSUABLE", "No active credential to reissue.");
        await audit(tx, req, {
          action: "credential.reissued",
          entityType: "credential",
          entityId: result.fresh.id,
          reason: req.body.reason,
          metadata: { replaces: result.old.id, newAccreditationId: result.fresh.accreditation_id },
        });
        return { id: result.fresh.id, accreditationId: result.fresh.accreditation_id };
      });
    },
  );
}
