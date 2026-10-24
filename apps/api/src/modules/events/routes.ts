import { AnnouncementInput, CategoryInput, EventConfigInput, ProgrammeItemInput } from "@dnki/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { many, one, type Queryable, withTx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { Errors } from "../../lib/errors";
import { noStore, requirePermission } from "../../plugins/auth";

export type EventRow = {
  id: string;
  slug: string;
  name: string;
  theme: string;
  description: string;
  venue_text: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  timezone: string;
  registration_opens_at: Date | null;
  registration_closes_at: Date | null;
  registration_open: boolean;
  reentry_policy: "single_entry" | "reentry_allowed";
  credential_valid_from: Date | null;
  credential_valid_until: Date | null;
  support_email: string | null;
  support_phone: string | null;
  privacy_notice: string;
  terms: string;
  faqs: { q: string; a: string }[];
};

export async function getActiveEvent(q: Queryable): Promise<EventRow> {
  const ev = await one<EventRow>(q, "select * from events where is_active");
  if (!ev) throw Errors.unavailable("NO_ACTIVE_EVENT", "No event is currently configured.");
  return ev;
}

/** Registration window check against administrator-configured dates and the open flag. */
export function registrationWindow(ev: EventRow, now: Date): { open: boolean; reason: string | null } {
  if (!ev.registration_open) return { open: false, reason: "Registration is not open." };
  if (ev.registration_opens_at && now < ev.registration_opens_at)
    return { open: false, reason: "Registration has not opened yet." };
  if (ev.registration_closes_at && now > ev.registration_closes_at) return { open: false, reason: "Registration has closed." };
  return { open: true, reason: null };
}

function publicEvent(ev: EventRow, now: Date) {
  return {
    name: ev.name,
    theme: ev.theme,
    description: ev.description,
    venue: ev.venue_text,
    startsAt: ev.starts_at,
    endsAt: ev.ends_at,
    timezone: ev.timezone,
    registration: { ...registrationWindow(ev, now), opensAt: ev.registration_opens_at, closesAt: ev.registration_closes_at },
    support: { email: ev.support_email, phone: ev.support_phone },
    faqs: ev.faqs,
  };
}

export async function eventRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db } = app.ctx;

  // ------------------------------------------------------------ public

  app.get("/public/event", { schema: { tags: ["public"] } }, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=30");
    const ev = await getActiveEvent(db);
    const [categories, programme, announcements] = await Promise.all([
      many(
        db,
        `select id, code, name, description, fee_minor, currency, requires_identity_check
           from registration_categories where event_id = $1 and is_active order by fee_minor, name`,
        [ev.id],
      ),
      many(
        db,
        "select id, title, starts_at, ends_at, location, description from event_sessions where event_id = $1 order by starts_at",
        [ev.id],
      ),
      many<Record<string, unknown>>(
        db,
        `select id, title, body, kind, url, published_at from announcements
          where event_id = $1 and status = 'published' order by published_at desc limit 20`,
        [ev.id],
      ),
    ]);
    return {
      event: publicEvent(ev, app.ctx.now()),
      categories,
      programme,
      announcements: announcements.map((a) => ({ ...a, visibility: "PUBLIC" })),
    };
  });

  app.get("/public/legal", { schema: { tags: ["public"] } }, async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60");
    const ev = await getActiveEvent(db);
    return { privacyNotice: ev.privacy_notice, terms: ev.terms };
  });

  // ------------------------------------------------------------ admin: event

  app.get("/admin/event", { schema: { tags: ["event-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "event.read_admin");
    const ev = await getActiveEvent(db);
    const [categories, programme] = await Promise.all([
      many(
        db,
        `select c.*, (select count(*)::int from registrations r where r.category_id = c.id
                       and r.status not in ('cancelled', 'refunded')) as active_registrations
           from registration_categories c where event_id = $1 order by created_at`,
        [ev.id],
      ),
      many(db, "select * from event_sessions where event_id = $1 order by starts_at", [ev.id]),
    ]);
    return { event: ev, categories, programme };
  });

  app.put("/admin/event", { schema: { body: EventConfigInput, tags: ["event-admin"] } }, async (req) => {
    requirePermission(req, "event.configure");
    const b = req.body;
    return withTx(db, async (tx) => {
      const ev = await getActiveEvent(tx);
      await tx.query(
        `update events set name = $2, theme = $3, description = $4, venue_text = $5, starts_at = $6, ends_at = $7,
                registration_opens_at = $8, registration_closes_at = $9, registration_open = $10, reentry_policy = $11,
                credential_valid_from = $12, credential_valid_until = $13, support_email = $14, support_phone = $15,
                privacy_notice = $16, terms = $17, faqs = $18, updated_at = now()
          where id = $1`,
        [
          ev.id,
          b.name,
          b.theme,
          b.description,
          b.venueText,
          b.startsAt,
          b.endsAt,
          b.registrationOpensAt,
          b.registrationClosesAt,
          b.registrationOpen,
          b.reentryPolicy,
          b.credentialValidFrom,
          b.credentialValidUntil,
          b.supportEmail,
          b.supportPhone,
          b.privacyNotice,
          b.terms,
          JSON.stringify(b.faqs),
        ],
      );
      const changed = Object.entries({
        registration_open: [ev.registration_open, b.registrationOpen],
        reentry_policy: [ev.reentry_policy, b.reentryPolicy],
      })
        .filter(([, [a, c]]) => a !== c)
        .map(([k]) => k);
      await audit(tx, req, {
        action: "event.configured",
        entityType: "event",
        entityId: ev.id,
        reason: b.reason,
        metadata: { sensitiveFieldsChanged: changed },
      });
      return { ok: true };
    });
  });

  app.post("/admin/event/categories", { schema: { body: CategoryInput, tags: ["event-admin"] } }, async (req) => {
    requirePermission(req, "event.configure");
    const { reason, ...c } = req.body;
    return withTx(db, async (tx) => {
      const ev = await getActiveEvent(tx);
      const row = await one<{ id: string }>(
        tx,
        `insert into registration_categories (event_id, code, name, description, fee_minor, currency, capacity, requires_identity_check, is_active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (event_id, code) do nothing returning id`,
        [ev.id, c.code, c.name, c.description, c.feeMinor, c.currency, c.capacity, c.requiresIdentityCheck, c.isActive],
      );
      if (!row) throw Errors.conflict("CATEGORY_EXISTS", "A category with this code already exists.");
      await audit(tx, req, {
        action: "event.category_created",
        entityType: "registration_category",
        entityId: row.id,
        reason,
        metadata: { code: c.code, feeMinor: c.feeMinor, currency: c.currency, capacity: c.capacity },
      });
      return { id: row.id };
    });
  });

  app.put(
    "/admin/event/categories/:id",
    { schema: { params: z.object({ id: z.uuid() }), body: CategoryInput, tags: ["event-admin"] } },
    async (req) => {
      requirePermission(req, "event.configure");
      const { reason, ...c } = req.body;
      return withTx(db, async (tx) => {
        const before = await one<{ fee_minor: string; currency: string; capacity: number | null }>(
          tx,
          "select fee_minor, currency, capacity from registration_categories where id = $1 for update",
          [req.params.id],
        );
        if (!before) throw Errors.notFound("Category");
        // Existing registrations keep the fee snapshot taken when they were created.
        await tx.query(
          `update registration_categories set code = $2, name = $3, description = $4, fee_minor = $5, currency = $6,
                  capacity = $7, requires_identity_check = $8, is_active = $9, updated_at = now() where id = $1`,
          [req.params.id, c.code, c.name, c.description, c.feeMinor, c.currency, c.capacity, c.requiresIdentityCheck, c.isActive],
        );
        await audit(tx, req, {
          action: "event.category_updated",
          entityType: "registration_category",
          entityId: req.params.id,
          reason,
          metadata: {
            fee: { from: before.fee_minor, to: String(c.feeMinor) },
            currency: { from: before.currency, to: c.currency },
            capacity: { from: before.capacity, to: c.capacity },
          },
        });
        return { ok: true };
      });
    },
  );

  app.post("/admin/event/programme", { schema: { body: ProgrammeItemInput, tags: ["event-admin"] } }, async (req) => {
    requirePermission(req, "event.configure");
    const ev = await getActiveEvent(db);
    const b = req.body;
    const row = await one<{ id: string }>(
      db,
      `insert into event_sessions (event_id, title, starts_at, ends_at, location, description)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [ev.id, b.title, b.startsAt, b.endsAt, b.location, b.description],
    );
    await audit(db, req, { action: "event.programme_item_created", entityType: "event_session", entityId: row?.id });
    return { id: row?.id };
  });

  app.delete(
    "/admin/event/programme/:id",
    { schema: { params: z.object({ id: z.uuid() }), tags: ["event-admin"] } },
    async (req) => {
      requirePermission(req, "event.configure");
      await db.query("delete from event_sessions where id = $1", [req.params.id]);
      await audit(db, req, { action: "event.programme_item_deleted", entityType: "event_session", entityId: req.params.id });
      return { ok: true };
    },
  );

  // ------------------------------------------------------------ admin: public content

  app.get("/admin/announcements", { schema: { tags: ["content-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "announcement.manage");
    const ev = await getActiveEvent(db);
    return { items: await many(db, "select * from announcements where event_id = $1 order by created_at desc", [ev.id]) };
  });

  app.post("/admin/announcements", { schema: { body: AnnouncementInput, tags: ["content-admin"] } }, async (req) => {
    const auth = requirePermission(req, "announcement.manage");
    const ev = await getActiveEvent(db);
    const b = req.body;
    if (b.kind !== "announcement" && !b.url) throw Errors.badRequest("URL_REQUIRED", "A link is required for this kind of item.");
    const row = await one<{ id: string }>(
      db,
      `insert into announcements (event_id, title, body, kind, url, status, published_at, created_by)
       values ($1, $2, $3, $4, $5, $6, case when $6 = 'published' then now() end, $7) returning id`,
      [ev.id, b.title, b.body, b.kind, b.url, b.status, auth.user.id],
    );
    await audit(db, req, {
      action: "content.announcement_created",
      entityType: "announcement",
      entityId: row?.id,
      metadata: { kind: b.kind, status: b.status },
    });
    return { id: row?.id };
  });

  app.put(
    "/admin/announcements/:id",
    { schema: { params: z.object({ id: z.uuid() }), body: AnnouncementInput, tags: ["content-admin"] } },
    async (req) => {
      requirePermission(req, "announcement.manage");
      const b = req.body;
      const r = await db.query(
        `update announcements set title = $2, body = $3, kind = $4, url = $5, status = $6,
                published_at = case when $6 = 'published' then coalesce(published_at, now()) else published_at end,
                updated_at = now() where id = $1`,
        [req.params.id, b.title, b.body, b.kind, b.url, b.status],
      );
      if (!r.rowCount) throw Errors.notFound("Announcement");
      await audit(db, req, {
        action: "content.announcement_updated",
        entityType: "announcement",
        entityId: req.params.id,
        metadata: { status: b.status },
      });
      return { ok: true };
    },
  );
}
