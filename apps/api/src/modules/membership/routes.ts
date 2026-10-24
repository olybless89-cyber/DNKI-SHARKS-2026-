import {
  MemberCorrectionInput,
  MemberImportRow,
  MembershipCodeInput,
  MembershipDecisionInput,
  MembershipManualReviewInput,
  MembershipSubmitInput,
  PageQuery,
} from "@dnki/shared";
import { parse as parseCsv } from "csv-parse/sync";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { many, one, withTx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { consumeCode, issueCode } from "../../lib/codes";
import { sha256Hex } from "../../lib/crypto";
import { AppError, Errors } from "../../lib/errors";
import { likePrefix, pageClause, paged } from "../../lib/paging";
import { noStore, requirePermission, requireVerifiedAccount } from "../../plugins/auth";
import { enqueueEmail } from "../notifications/outbox";
import { templates } from "../notifications/templates";

const GENERIC_SUBMIT_MESSAGE =
  "If these details match a member in good standing, a verification code has been sent to the email address on record. If no code arrives within 10 minutes, request a manual review.";

export async function membershipRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db, config, membership } = app.ctx;

  async function currentVerification(userId: string) {
    return one<{ id: string; status: string; method: string; created_at: Date; decision_reason: string | null }>(
      db,
      `select id, status, method, created_at, decision_reason from membership_verifications
        where user_id = $1 order by (status = 'approved') desc, created_at desc limit 1`,
      [userId],
    );
  }

  // ------------------------------------------------------------ participant

  app.get("/membership", { schema: { tags: ["membership"] } }, async (req, reply) => {
    noStore(reply);
    const auth = requireVerifiedAccount(req);
    const v = await currentVerification(auth.user.id);
    const member = await one<{ membership_number: string; full_name: string; chapter: string; standing: string }>(
      db,
      "select membership_number, full_name, chapter, standing from member_records where linked_user_id = $1",
      [auth.user.id],
    );
    return {
      provider: membership.name,
      contactVerificationAvailable: membership.supportsContactVerification,
      verification: v ?? null,
      member: member ?? null,
    };
  });

  app.post(
    "/membership/verify",
    {
      schema: { body: MembershipSubmitInput, tags: ["membership"] },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (req) => {
      const auth = requireVerifiedAccount(req);
      const { membershipNumber, contactOnRecord } = req.body;
      if (!membership.supportsContactVerification) {
        throw Errors.conflict("MANUAL_REVIEW_ONLY", "Membership is verified by officers. Request a manual review.");
      }
      const recent = await one<{ n: number }>(
        db,
        "select count(*)::int as n from membership_verifications where user_id = $1 and created_at > now() - interval '1 hour'",
        [auth.user.id],
      );
      if ((recent?.n ?? 0) >= 5) {
        throw new AppError(429, "TOO_MANY_ATTEMPTS", "Too many verification attempts. Try again later.");
      }

      let record: Awaited<ReturnType<typeof membership.lookup>>;
      try {
        record = await membership.lookup(db, membershipNumber);
      } catch (err) {
        req.log.error({ err }, "membership provider lookup failed");
        throw Errors.unavailable("MEMBERSHIP_SOURCE_UNAVAILABLE", "Membership verification is temporarily unavailable.");
      }

      const contactMatches = Boolean(record?.email && record.email.toLowerCase() === contactOnRecord.toLowerCase());
      const linkedElsewhere = Boolean(record?.linked_user_id && record.linked_user_id !== auth.user.id);
      const eligible = Boolean(record && contactMatches && record.standing === "good_standing" && !linkedElsewhere);

      const verificationId = await withTx(db, async (tx) => {
        const approved = await one(tx, "select 1 from membership_verifications where user_id = $1 and status = 'approved'", [
          auth.user.id,
        ]);
        if (approved) throw Errors.conflict("ALREADY_VERIFIED", "Your membership is already verified.");
        await tx.query(
          `update membership_verifications set status = 'superseded', updated_at = now()
            where user_id = $1 and status in ('pending_contact', 'pending_review')`,
          [auth.user.id],
        );
        const v = await one<{ id: string }>(
          tx,
          `insert into membership_verifications
             (user_id, membership_number_submitted, contact_submitted, member_record_id, method, provider, status)
           values ($1, $2, $3, $4, $5, $6, 'pending_contact') returning id`,
          [
            auth.user.id,
            membershipNumber,
            contactOnRecord,
            eligible ? record?.id : null,
            membership.name === "api" ? "api_contact_code" : "registry_contact_code",
            membership.name,
          ],
        );
        if (!v) throw new Error("insert failed");
        if (eligible && record?.email) {
          const code = await issueCode(tx, config.encryptionKey, {
            userId: auth.user.id,
            purpose: "membership_contact",
            subjectId: v.id,
          });
          await enqueueEmail(tx, {
            userId: auth.user.id,
            to: record.email,
            template: "membership_contact_code",
            ...templates.membershipContactCode(code),
            sensitive: true,
            idempotencyKey: `membership_contact:${v.id}`,
          });
        }
        if (linkedElsewhere) {
          await audit(tx, req, {
            action: "membership.duplicate_identity_attempt",
            entityType: "member_record",
            entityId: record?.id ?? null,
            metadata: { verificationId: v.id },
          });
        }
        return v.id;
      });
      // Identical response whether or not the member exists, to resist enumeration.
      return { verificationId, message: GENERIC_SUBMIT_MESSAGE };
    },
  );

  app.post(
    "/membership/verify/confirm",
    { schema: { body: MembershipCodeInput, tags: ["membership"] }, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req) => {
      const auth = requireVerifiedAccount(req);
      const v = await one<{ id: string; member_record_id: string | null; status: string }>(
        db,
        "select id, member_record_id, status from membership_verifications where id = $1 and user_id = $2",
        [req.body.verificationId, auth.user.id],
      );
      if (v?.status !== "pending_contact" || !v.member_record_id) {
        throw Errors.badRequest("CODE_INVALID", "That code is not correct.");
      }
      // Consumed outside the approval transaction so failed attempts are always counted.
      await consumeCode(db, config.encryptionKey, {
        userId: auth.user.id,
        purpose: "membership_contact",
        subjectId: v.id,
        code: req.body.code,
      });
      await withTx(db, async (tx) => {
        const rec = await one<{ id: string; standing: string; linked_user_id: string | null }>(
          tx,
          "select id, standing, linked_user_id from member_records where id = $1 for update",
          [v.member_record_id],
        );
        if (rec?.standing !== "good_standing" || (rec.linked_user_id && rec.linked_user_id !== auth.user.id)) {
          await tx.query(
            "update membership_verifications set status = 'pending_review', updated_at = now(), submitted_note = 'Automatic check failed after code confirmation' where id = $1",
            [v.id],
          );
          return;
        }
        await tx.query("update member_records set linked_user_id = $2, updated_at = now() where id = $1", [rec.id, auth.user.id]);
        await tx.query(
          "update membership_verifications set status = 'approved', verified_at = now(), updated_at = now() where id = $1",
          [v.id],
        );
        await audit(tx, req, {
          action: "membership.verified_by_contact_code",
          entityType: "membership_verification",
          entityId: v.id,
          metadata: { memberRecordId: rec.id, provider: membership.name },
        });
      });
      return { status: (await currentVerification(auth.user.id))?.status };
    },
  );

  app.post(
    "/membership/manual-review",
    {
      schema: { body: MembershipManualReviewInput, tags: ["membership"] },
      config: { rateLimit: { max: 3, timeWindow: "1 hour" } },
    },
    async (req) => {
      const auth = requireVerifiedAccount(req);
      let candidateId: string | null = null;
      try {
        candidateId = (await membership.lookup(db, req.body.membershipNumber))?.id ?? null;
      } catch {
        candidateId = null; // provider outage must not block a manual request
      }
      const id = await withTx(db, async (tx) => {
        const approved = await one(tx, "select 1 from membership_verifications where user_id = $1 and status = 'approved'", [
          auth.user.id,
        ]);
        if (approved) throw Errors.conflict("ALREADY_VERIFIED", "Your membership is already verified.");
        await tx.query(
          `update membership_verifications set status = 'superseded', updated_at = now()
            where user_id = $1 and status in ('pending_contact', 'pending_review')`,
          [auth.user.id],
        );
        const row = await one<{ id: string }>(
          tx,
          `insert into membership_verifications
             (user_id, membership_number_submitted, member_record_id, method, provider, status, submitted_note)
           values ($1, $2, $3, 'manual_review', $4, 'pending_review', $5) returning id`,
          [auth.user.id, req.body.membershipNumber, candidateId, membership.name, req.body.note],
        );
        return row?.id;
      });
      return { verificationId: id, status: "pending_review" };
    },
  );

  // ------------------------------------------------------------ officers

  app.get(
    "/admin/membership/verifications",
    { schema: { querystring: PageQuery, tags: ["membership-admin"] } },
    async (req, reply) => {
      noStore(reply);
      requirePermission(req, "membership.read");
      const { status = "pending_review" } = req.query;
      const page = pageClause(req.query, 2);
      const items = await many(
        db,
        `select v.id, v.status, v.method, v.provider, v.membership_number_submitted, v.contact_submitted,
                v.submitted_note, v.decision_reason, v.created_at, v.decided_at,
                u.id as user_id, u.full_name as account_name, u.email as account_email,
                m.id as candidate_id, m.membership_number as candidate_number, m.full_name as candidate_name,
                m.chapter as candidate_chapter, m.standing as candidate_standing, m.email as candidate_email,
                m.linked_user_id as candidate_linked_user_id
           from membership_verifications v
           join users u on u.id = v.user_id
           left join member_records m on m.id = v.member_record_id
          where v.status = $1
          order by v.created_at${page.sql}`,
        [status, ...page.params],
      );
      const total = await one<{ n: number }>(db, "select count(*)::int as n from membership_verifications where status = $1", [
        status,
      ]);
      return paged(items, total?.n ?? 0, req.query);
    },
  );

  app.post(
    "/admin/membership/verifications/:id/decision",
    { schema: { params: z.object({ id: z.uuid() }), body: MembershipDecisionInput, tags: ["membership-admin"] } },
    async (req) => {
      const auth = requirePermission(req, "membership.review");
      const body = req.body;
      return withTx(db, async (tx) => {
        const v = await one<{ id: string; user_id: string; status: string }>(
          tx,
          "select id, user_id, status from membership_verifications where id = $1 for update",
          [req.params.id],
        );
        if (!v) throw Errors.notFound("Verification request");
        if (v.user_id === auth.user.id) throw Errors.forbidden("You cannot decide your own verification request.");
        if (v.status !== "pending_review" && v.status !== "pending_contact") {
          throw Errors.conflict("ALREADY_DECIDED", "This request has already been decided.");
        }
        const user = await one<{ email: string; full_name: string }>(tx, "select email, full_name from users where id = $1", [
          v.user_id,
        ]);
        if (body.decision === "approve") {
          const rec = await one<{ id: string; standing: string; linked_user_id: string | null }>(
            tx,
            "select id, standing, linked_user_id from member_records where id = $1 for update",
            [body.memberRecordId],
          );
          if (!rec) throw Errors.notFound("Member record");
          if (rec.standing !== "good_standing") {
            throw Errors.conflict("MEMBER_NOT_IN_GOOD_STANDING", "This member record is not in good standing.");
          }
          if (rec.linked_user_id && rec.linked_user_id !== v.user_id) {
            throw Errors.conflict("MEMBER_ALREADY_LINKED", "This member record is already linked to another account.");
          }
          const otherLink = await one(tx, "select 1 from member_records where linked_user_id = $1 and id <> $2", [
            v.user_id,
            rec.id,
          ]);
          if (otherLink) throw Errors.conflict("ACCOUNT_ALREADY_LINKED", "This account is already linked to a member.");
          await tx.query("update member_records set linked_user_id = $2, updated_at = now() where id = $1", [rec.id, v.user_id]);
          await tx.query(
            `update membership_verifications
                set status = 'approved', member_record_id = $2, decided_by = $3, decided_at = now(), verified_at = now(),
                    decision_reason = $4, updated_at = now()
              where id = $1`,
            [v.id, rec.id, auth.user.id, body.reason],
          );
        } else {
          await tx.query(
            `update membership_verifications
                set status = 'rejected', decided_by = $2, decided_at = now(), decision_reason = $3, updated_at = now()
              where id = $1`,
            [v.id, auth.user.id, body.reason],
          );
        }
        await audit(tx, req, {
          action: `membership.${body.decision === "approve" ? "approved" : "rejected"}`,
          entityType: "membership_verification",
          entityId: v.id,
          reason: body.reason,
          metadata: body.decision === "approve" ? { memberRecordId: body.memberRecordId } : {},
        });
        if (user) {
          await enqueueEmail(tx, {
            userId: v.user_id,
            to: user.email,
            template: "membership_decision",
            ...templates.membershipDecision(user.full_name, body.decision === "approve"),
            idempotencyKey: `membership_decision:${v.id}`,
          });
        }
        return { ok: true };
      });
    },
  );

  app.get("/admin/membership/records", { schema: { querystring: PageQuery, tags: ["membership-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "membership.read");
    const q = req.query.q?.trim();
    const where = q ? "where membership_number like upper($1) or lower(full_name) like lower($1)" : "where $1::text is null";
    const param = q ? likePrefix(q) : null;
    const page = pageClause(req.query, 2);
    const items = await many(
      db,
      `select id, membership_number, full_name, chapter, zone, email, standing, source, linked_user_id is not null as linked,
              is_synthetic, updated_at
         from member_records ${where} order by membership_number${page.sql}`,
      [param, ...page.params],
    );
    const total = await one<{ n: number }>(db, `select count(*)::int as n from member_records ${where}`, [param]);
    return paged(items, total?.n ?? 0, req.query);
  });

  app.patch(
    "/admin/membership/records/:id",
    { schema: { params: z.object({ id: z.uuid() }), body: MemberCorrectionInput, tags: ["membership-admin"] } },
    async (req) => {
      requirePermission(req, "membership.correct");
      const { reason, ...changes } = req.body;
      return withTx(db, async (tx) => {
        const before = await one<Record<string, unknown>>(
          tx,
          "select full_name, chapter, zone, email, phone, standing from member_records where id = $1 for update",
          [req.params.id],
        );
        if (!before) throw Errors.notFound("Member record");
        const map: Record<string, string> = {
          fullName: "full_name",
          chapter: "chapter",
          zone: "zone",
          email: "email",
          phone: "phone",
          standing: "standing",
        };
        const sets: string[] = [];
        const params: unknown[] = [req.params.id];
        const diff: Record<string, { from: unknown; to: unknown }> = {};
        for (const [k, v] of Object.entries(changes)) {
          const col = map[k];
          if (v === undefined || !col) continue;
          params.push(v);
          sets.push(`${col} = $${params.length}`);
          diff[col] = { from: before[col] ?? null, to: v };
        }
        if (!sets.length) throw Errors.badRequest("NO_CHANGES", "No changes supplied.");
        await tx.query(`update member_records set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
        await audit(tx, req, {
          action: "membership.record_corrected",
          entityType: "member_record",
          entityId: req.params.id,
          reason,
          metadata: { fields: Object.keys(diff), standingChange: diff.standing ?? null },
        });
        return { ok: true };
      });
    },
  );

  // ------------------------------------------------------------ controlled import

  app.post(
    "/admin/membership/imports",
    {
      schema: {
        body: z.object({ filename: z.string().trim().min(1).max(200), csv: z.string().min(1).max(5_000_000) }),
        tags: ["membership-admin"],
      },
      bodyLimit: 6_000_000,
    },
    async (req) => {
      const auth = requirePermission(req, "membership.import");
      let rows: Record<string, string>[];
      try {
        rows = parseCsv(req.body.csv, { columns: true, skip_empty_lines: true, trim: true, bom: true, max_record_size: 4096 });
      } catch (err) {
        throw Errors.badRequest("CSV_UNREADABLE", `The file could not be read as CSV: ${(err as Error).message}`);
      }
      if (rows.length > 50_000) throw Errors.badRequest("CSV_TOO_LARGE", "Import at most 50,000 rows per file.");
      const errors: { row: number; field: string; message: string }[] = [];
      const valid: unknown[] = [];
      const seen = new Map<string, number>();
      rows.forEach((raw, i) => {
        const rowNo = i + 2; // header is row 1
        const parsed = MemberImportRow.safeParse(raw);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            errors.push({ row: rowNo, field: issue.path.join(".") || "row", message: issue.message });
          }
          return;
        }
        const prior = seen.get(parsed.data.membership_number);
        if (prior) {
          errors.push({ row: rowNo, field: "membership_number", message: `Duplicate of row ${prior}` });
          return;
        }
        seen.set(parsed.data.membership_number, rowNo);
        valid.push(parsed.data);
      });
      const job = await one<{ id: string }>(
        db,
        `insert into import_jobs (uploaded_by, filename, status, total_rows, valid_rows, error_rows, errors, staged_rows)
         values ($1, $2, 'validated', $3, $4, $5, $6, $7) returning id`,
        [
          auth.user.id,
          req.body.filename,
          rows.length,
          valid.length,
          rows.length - valid.length,
          JSON.stringify(errors.slice(0, 2000)),
          JSON.stringify(valid),
        ],
      );
      await audit(db, req, {
        action: "membership.import_validated",
        entityType: "import_job",
        entityId: job?.id,
        metadata: { filename: req.body.filename, total: rows.length, valid: valid.length, fileSha256: sha256Hex(req.body.csv) },
      });
      return {
        importJobId: job?.id,
        totalRows: rows.length,
        validRows: valid.length,
        errorRows: rows.length - valid.length,
        errors: errors.slice(0, 200),
      };
    },
  );

  app.get("/admin/membership/imports", { schema: { tags: ["membership-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "membership.read");
    return {
      items: await many(
        db,
        `select j.id, j.filename, j.status, j.total_rows, j.valid_rows, j.error_rows, j.created_at, j.applied_at,
                u.full_name as uploaded_by_name
           from import_jobs j join users u on u.id = j.uploaded_by order by j.created_at desc limit 50`,
      ),
    };
  });

  app.get(
    "/admin/membership/imports/:id/errors",
    { schema: { params: z.object({ id: z.uuid() }), tags: ["membership-admin"] } },
    async (req, reply) => {
      noStore(reply);
      requirePermission(req, "membership.read");
      const job = await one<{ errors: unknown }>(db, "select errors from import_jobs where id = $1", [req.params.id]);
      if (!job) throw Errors.notFound("Import job");
      return { errors: job.errors };
    },
  );

  app.post(
    "/admin/membership/imports/:id/apply",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({ reason: z.string().trim().min(5).max(500) }),
        tags: ["membership-admin"],
      },
    },
    async (req) => {
      const auth = requirePermission(req, "membership.import");
      return withTx(db, async (tx) => {
        const job = await one<{
          id: string;
          status: string;
          staged_rows: z.infer<typeof MemberImportRow>[];
          uploaded_by: string;
        }>(tx, "select id, status, staged_rows, uploaded_by from import_jobs where id = $1 for update", [req.params.id]);
        if (!job) throw Errors.notFound("Import job");
        if (job.status !== "validated") throw Errors.conflict("IMPORT_NOT_PENDING", "This import has already been processed.");
        let inserted = 0;
        let updated = 0;
        const conflicts: { membership_number: string; reason: string }[] = [];
        for (const r of job.staged_rows ?? []) {
          const existing = await one<{ id: string; full_name: string; email: string | null; linked_user_id: string | null }>(
            tx,
            "select id, full_name, email, linked_user_id from member_records where membership_number = $1 for update",
            [r.membership_number],
          );
          if (!existing) {
            await tx.query(
              `insert into member_records (membership_number, full_name, chapter, zone, email, phone, standing, source, import_job_id)
               values ($1, $2, $3, $4, $5, $6, $7, 'import', $8)`,
              [r.membership_number, r.full_name, r.chapter, r.zone, r.email ?? null, r.phone || null, r.standing, job.id],
            );
            inserted++;
            continue;
          }
          const identityChanged = existing.full_name !== r.full_name || (existing.email ?? null) !== (r.email ?? null);
          if (existing.linked_user_id && identityChanged) {
            // Never silently rewrite the identity of a record already linked to an account.
            conflicts.push({
              membership_number: r.membership_number,
              reason: "Linked record: name or email differs; use a controlled correction",
            });
            await tx.query("update member_records set standing = $2, chapter = $3, zone = $4, updated_at = now() where id = $1", [
              existing.id,
              r.standing,
              r.chapter,
              r.zone,
            ]);
            updated++;
            continue;
          }
          await tx.query(
            `update member_records set full_name = $2, chapter = $3, zone = $4, email = $5, phone = $6, standing = $7,
                    import_job_id = $8, updated_at = now() where id = $1`,
            [existing.id, r.full_name, r.chapter, r.zone, r.email ?? null, r.phone || null, r.standing, job.id],
          );
          updated++;
        }
        await tx.query(
          "update import_jobs set status = 'applied', applied_by = $2, applied_at = now(), staged_rows = null, errors = errors || $3::jsonb where id = $1",
          [
            job.id,
            auth.user.id,
            JSON.stringify(conflicts.map((c) => ({ row: null, field: c.membership_number, message: c.reason }))),
          ],
        );
        await audit(tx, req, {
          action: "membership.import_applied",
          entityType: "import_job",
          entityId: job.id,
          reason: req.body.reason,
          metadata: { inserted, updated, conflicts: conflicts.length },
        });
        return { inserted, updated, conflicts };
      });
    },
  );
}
