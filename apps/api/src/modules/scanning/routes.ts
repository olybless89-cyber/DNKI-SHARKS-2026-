import {
  DeviceRegisterInput,
  GateAssignmentInput,
  GateInput,
  IncidentInput,
  IncidentUpdateInput,
  PageQuery,
  SCAN_RESULT_DISPLAY,
  ScanInput,
  ScanOverrideInput,
  type ScanResult,
} from "@dnki/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AuthState } from "../../context";
import { many, one, type Tx, withTx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { Errors } from "../../lib/errors";
import { likePrefix, pageClause, paged } from "../../lib/paging";
import { hasPermission, noStore, requirePermission } from "../../plugins/auth";
import { credentialTokenHash, tokenFromPayload } from "../accreditation/service";
import { getActiveEvent } from "../events/routes";

type CredentialForScan = {
  id: string;
  accreditation_id: string;
  status: string;
  valid_from: Date | null;
  valid_until: Date | null;
  admitted_at: Date | null;
  admitted_gate_name: string | null;
  presence: "inside" | "outside";
  registration_status: string;
  standing: string;
  holder_name: string;
  chapter: string;
  category: string;
  requires_identity_check: boolean;
  event_id: string;
  norsical_name: string | null;
  patrol: string | null;
  designation: string | null;
  has_photo: boolean;
};

export async function scanningRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const ctx = app.ctx;
  const { db } = ctx;

  async function assertGateAccess(q: Tx | typeof db, auth: AuthState, gateId: string, deviceId: string, eventId: string) {
    const gate = await one<{ id: string; name: string; is_active: boolean; event_id: string }>(
      q,
      "select id, name, is_active, event_id from gates where id = $1",
      [gateId],
    );
    if (!gate || gate.event_id !== eventId || !gate.is_active) throw Errors.forbidden("This gate is not active.");
    const device = await one<{ gate_id: string; is_active: boolean }>(
      q,
      "select gate_id, is_active from scanner_devices where id = $1",
      [deviceId],
    );
    if (!device?.is_active || device.gate_id !== gateId) {
      throw Errors.forbidden("This scanner device is not registered for this gate.");
    }
    if (!hasPermission(auth, "scan.override")) {
      const assigned = await one(q, "select 1 from scanner_gate_assignments where user_id = $1 and gate_id = $2", [
        auth.user.id,
        gateId,
      ]);
      if (!assigned) throw Errors.forbidden("You are not assigned to this gate.");
    }
    return gate;
  }

  function loadCredential(q: Tx, where: "token" | "accreditation", value: string) {
    return one<CredentialForScan>(
      q,
      `select c.id, c.accreditation_id, c.status, c.valid_from, c.valid_until, c.admitted_at, g.name as admitted_gate_name,
              c.presence, r.status as registration_status, m.standing, u.full_name as holder_name, m.chapter,
              cat.name as category, cat.requires_identity_check, c.event_id,
              r.norsical_name, po.label as patrol, de.label as designation,
              exists (select 1 from participant_photos ph where ph.user_id = c.user_id) as has_photo
         from accreditation_credentials c
         join registrations r on r.id = c.registration_id
         join member_records m on m.id = r.member_record_id
         join users u on u.id = c.user_id
         join registration_categories cat on cat.id = r.category_id
         left join registration_options po on po.id = r.patrol_option_id
         left join registration_options de on de.id = r.designation_option_id
         left join gates g on g.id = c.admitted_gate_id
        where ${where === "token" ? "c.token_hash" : "c.accreditation_id"} = $1`,
      [value],
    );
  }

  /** Non-consuming eligibility classification. Order matters: hard denials first. */
  function classify(c: CredentialForScan, eventId: string, now: Date): { result: ScanResult; detail: string | null } | null {
    if (c.event_id !== eventId) return { result: "INVALID_CREDENTIAL", detail: "Credential is for a different event" };
    if (c.status === "revoked") return { result: "REVOKED_CREDENTIAL", detail: "Credential revoked" };
    if (c.status === "superseded") return { result: "REVOKED_CREDENTIAL", detail: "Superseded by a reissued pass" };
    if (c.status === "suspended" || c.registration_status !== "accredited") {
      return { result: "PAYMENT_OR_ELIGIBILITY_ISSUE", detail: `Registration ${c.registration_status}` };
    }
    if (c.standing !== "good_standing")
      return { result: "PAYMENT_OR_ELIGIBILITY_ISSUE", detail: "Membership not in good standing" };
    if (c.valid_from && now < c.valid_from) return { result: "EXPIRED_CREDENTIAL", detail: "Not yet valid" };
    if (c.valid_until && now > c.valid_until) return { result: "EXPIRED_CREDENTIAL", detail: "Validity period has ended" };
    return null;
  }

  function participantView(c: CredentialForScan) {
    // Minimum needed for identity confirmation at the gate.
    return {
      accreditationId: c.accreditation_id,
      name: c.holder_name,
      norsicalName: c.norsical_name,
      chapter: c.chapter,
      patrol: c.patrol,
      designation: c.designation,
      category: c.category,
      photoUrl: c.has_photo ? `/api/v1/staff/photos/credential/${c.id}` : null,
    };
  }

  async function recordAttendance(
    tx: Tx,
    req: FastifyRequest,
    a: {
      eventId: string;
      credentialId: string | null;
      gateId: string;
      deviceId: string;
      method: "qr" | "manual_lookup" | "override";
      direction: "entry" | "exit";
      result: ScanResult;
      counted: boolean;
      overrideReason?: string;
    },
  ) {
    const row = await one<{ id: string; created_at: Date }>(
      tx,
      `insert into attendance_events (event_id, credential_id, gate_id, device_id, scanned_by, method, direction, result, counted, override_reason, correlation_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id, created_at`,
      [
        a.eventId,
        a.credentialId,
        a.gateId,
        a.deviceId,
        req.auth?.user.id,
        a.method,
        a.direction,
        a.result,
        a.counted,
        a.overrideReason ?? null,
        req.id,
      ],
    );
    // Device heartbeat and credential last-scan are written outside the admission
    // transaction (see touchDevice) so hot rows are never locked in two orders.
    return row;
  }

  function touchDevice(deviceId: string, userId: string | undefined) {
    db.query(
      `update scanner_devices set last_seen_at = now(), last_user_id = $2
        where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '5 seconds')`,
      [deviceId, userId ?? null],
    ).catch(() => {});
  }

  // ------------------------------------------------------------ scanner

  app.get("/scanner/context", { schema: { tags: ["scanner"] } }, async (req, reply) => {
    noStore(reply);
    const auth = requirePermission(req, "scan.admit");
    const ev = await getActiveEvent(db);
    const all = hasPermission(auth, "scan.override");
    const gates = await many<{ id: string; code: string; name: string }>(
      db,
      `select g.id, g.code, g.name from gates g
        where g.event_id = $1 and g.is_active
          and ($2 or exists (select 1 from scanner_gate_assignments a where a.gate_id = g.id and a.user_id = $3))
        order by g.code`,
      [ev.id, all, auth.user.id],
    );
    const devices = await many(
      db,
      "select id, label, gate_id, last_seen_at from scanner_devices where is_active and gate_id = any($1::uuid[]) order by label",
      [gates.map((g) => g.id)],
    );
    return {
      event: { name: ev.name, reentryPolicy: ev.reentry_policy },
      gates,
      devices,
      canOverride: all,
      canManualLookup: hasPermission(auth, "scan.manual_lookup"),
      canRegisterDevice: hasPermission(auth, "device.manage"),
      serverTime: new Date().toISOString(),
    };
  });

  app.post("/scanner/devices", { schema: { body: DeviceRegisterInput, tags: ["scanner"] } }, async (req) => {
    const auth = requirePermission(req, "device.manage");
    const ev = await getActiveEvent(db);
    const gate = await one<{ event_id: string }>(db, "select event_id from gates where id = $1 and is_active", [req.body.gateId]);
    if (!gate || gate.event_id !== ev.id) throw Errors.notFound("Gate");
    const row = await one<{ id: string }>(
      db,
      "insert into scanner_devices (label, gate_id, registered_by) values ($1, $2, $3) returning id",
      [req.body.label, req.body.gateId, auth.user.id],
    );
    await audit(db, req, {
      action: "scanner.device_registered",
      entityType: "scanner_device",
      entityId: row?.id,
      metadata: { gateId: req.body.gateId },
    });
    return { id: row?.id };
  });

  app.post(
    "/scanner/scan",
    { schema: { body: ScanInput, tags: ["scanner"] }, config: { rateLimit: { max: 240, timeWindow: "1 minute" } } },
    async (req, reply) => {
      noStore(reply);
      const auth = requirePermission(req, "scan.admit");
      const b = req.body;
      const method = b.accreditationId ? "manual_lookup" : "qr";
      if (method === "manual_lookup" && !hasPermission(auth, "scan.manual_lookup")) {
        throw Errors.forbidden("Manual lookup is not permitted for your role.");
      }
      const ev = await getActiveEvent(db);
      if (b.direction === "exit" && ev.reentry_policy !== "reentry_allowed") {
        throw Errors.badRequest("EXIT_NOT_ENABLED", "Exit scanning is only used when re-entry is allowed.");
      }
      const now = ctx.now();

      const out = await withTx(db, async (tx) => {
        const gate = await assertGateAccess(tx, auth, b.gateId, b.deviceId, ev.id);
        const base = { eventId: ev.id, gateId: b.gateId, deviceId: b.deviceId, method, direction: b.direction } as const;

        let cred: CredentialForScan | undefined;
        if (b.token) {
          const token = tokenFromPayload(b.token);
          cred = token ? await loadCredential(tx, "token", credentialTokenHash(token)) : undefined;
        } else if (b.accreditationId) {
          cred = await loadCredential(tx, "accreditation", b.accreditationId);
        }
        if (!cred) {
          const a = await recordAttendance(tx, req, {
            ...base,
            credentialId: null,
            result: "INVALID_CREDENTIAL",
            counted: false,
          });
          return {
            result: "INVALID_CREDENTIAL" as ScanResult,
            detail: null,
            participant: null,
            previous: null,
            at: a?.created_at,
            gate: gate.name,
          };
        }

        const denial = classify(cred, ev.id, now);
        if (denial) {
          const a = await recordAttendance(tx, req, { ...base, credentialId: cred.id, result: denial.result, counted: false });
          return {
            ...denial,
            participant: participantView(cred),
            previous: null,
            at: a?.created_at,
            gate: gate.name,
            credentialId: cred.id,
          };
        }

        if (b.direction === "entry" && cred.requires_identity_check && !b.identityConfirmed) {
          const a = await recordAttendance(tx, req, {
            ...base,
            credentialId: cred.id,
            result: "MANUAL_REVIEW_REQUIRED",
            counted: false,
          });
          return {
            result: "MANUAL_REVIEW_REQUIRED" as ScanResult,
            detail: "Identity check required for this category. Confirm identity, then scan again with confirmation.",
            participant: participantView(cred),
            previous: null,
            at: a?.created_at,
            gate: gate.name,
            credentialId: cred.id,
          };
        }

        // Atomic admission: the conditional UPDATE is the arbiter between concurrent
        // scanners. Exactly one statement can move the credential into the admitted /
        // inside state; every other concurrent attempt matches zero rows.
        let changed: { id: string } | undefined;
        if (b.direction === "entry") {
          changed = await one<{ id: string }>(
            tx,
            ev.reentry_policy === "single_entry"
              ? `update accreditation_credentials c set admitted_at = now(), admitted_gate_id = $2, presence = 'inside', last_scan_at = now(), updated_at = now()
                   from registrations r
                  where c.id = $1 and r.id = c.registration_id and r.status = 'accredited' and c.status = 'active'
                    and c.admitted_at is null
                  returning c.id`
              : `update accreditation_credentials c set admitted_at = coalesce(c.admitted_at, now()),
                        admitted_gate_id = coalesce(c.admitted_gate_id, $2), presence = 'inside', last_scan_at = now(), updated_at = now()
                   from registrations r
                  where c.id = $1 and r.id = c.registration_id and r.status = 'accredited' and c.status = 'active'
                    and c.presence = 'outside'
                  returning c.id`,
            [cred.id, b.gateId],
          );
        } else {
          changed = await one<{ id: string }>(
            tx,
            "update accreditation_credentials set presence = 'outside', updated_at = now() where id = $1 and status = 'active' and presence = 'inside' returning id",
            [cred.id],
          );
        }

        if (changed) {
          const result: ScanResult = b.direction === "entry" ? "VALID_ADMIT" : "VALID_EXIT";
          const firstEntry = b.direction === "entry" && cred.admitted_at === null;
          const a = await recordAttendance(tx, req, { ...base, credentialId: cred.id, result, counted: firstEntry });
          if (firstEntry) {
            await tx.query(
              "insert into credential_events (credential_id, event_type, actor_user_id, metadata) values ($1, 'admitted', $2, $3)",
              [cred.id, auth.user.id, JSON.stringify({ gateId: b.gateId })],
            );
          }
          return {
            result,
            detail: null,
            participant: participantView(cred),
            previous: null,
            at: a?.created_at,
            gate: gate.name,
            credentialId: cred.id,
          };
        }

        // Lost the race or already admitted. Re-read to report accurately.
        const current = await one<{ admitted_at: Date | null; gate: string | null; status: string; presence: string }>(
          tx,
          "select c.admitted_at, g.name as gate, c.status, c.presence from accreditation_credentials c left join gates g on g.id = c.admitted_gate_id where c.id = $1",
          [cred.id],
        );
        const result: ScanResult =
          current?.status !== "active"
            ? "REVOKED_CREDENTIAL"
            : b.direction === "exit"
              ? "MANUAL_REVIEW_REQUIRED"
              : "ALREADY_CHECKED_IN";
        const a = await recordAttendance(tx, req, { ...base, credentialId: cred.id, result, counted: false });
        return {
          result,
          detail: b.direction === "exit" && result === "MANUAL_REVIEW_REQUIRED" ? "Participant is not recorded as inside" : null,
          participant: participantView(cred),
          previous: current?.admitted_at ? { at: current.admitted_at, gate: current.gate } : null,
          at: a?.created_at,
          gate: gate.name,
          credentialId: cred.id,
        };
      });
      touchDevice(b.deviceId, auth.user.id);
      return { ...out, display: SCAN_RESULT_DISPLAY[out.result] };
    },
  );

  app.post("/scanner/override", { schema: { body: ScanOverrideInput, tags: ["scanner"] } }, async (req) => {
    const auth = requirePermission(req, "scan.override");
    const b = req.body;
    const ev = await getActiveEvent(db);
    const out = await withTx(db, async (tx) => {
      const gate = await assertGateAccess(tx, auth, b.gateId, b.deviceId, ev.id);
      const cred = await one<CredentialForScan & { registration_id: string }>(
        tx,
        `select c.*, r.status as registration_status, m.standing from accreditation_credentials c
             join registrations r on r.id = c.registration_id join member_records m on m.id = r.member_record_id
            where c.id = $1 for update of c`,
        [b.credentialId],
      );
      if (!cred) throw Errors.notFound("Credential");
      // An override resolves identity checks and duplicate-scan disputes. It never
      // bypasses revocation, payment or membership eligibility.
      if (cred.status !== "active" || cred.registration_status !== "accredited" || cred.standing !== "good_standing") {
        throw Errors.conflict("NOT_OVERRIDABLE", "Overrides cannot admit revoked, unpaid or ineligible credentials.");
      }
      const firstEntry = cred.admitted_at === null;
      await tx.query(
        `update accreditation_credentials set admitted_at = coalesce(admitted_at, now()), admitted_gate_id = coalesce(admitted_gate_id, $2),
                  presence = 'inside', updated_at = now() where id = $1`,
        [cred.id, b.gateId],
      );
      await recordAttendance(tx, req, {
        eventId: ev.id,
        credentialId: cred.id,
        gateId: b.gateId,
        deviceId: b.deviceId,
        method: "override",
        direction: "entry",
        result: "VALID_ADMIT",
        counted: firstEntry,
        overrideReason: b.reason,
      });
      await tx.query(
        "insert into credential_events (credential_id, event_type, actor_user_id, reason, metadata) values ($1, 'override_admitted', $2, $3, $4)",
        [cred.id, auth.user.id, b.reason, JSON.stringify({ gateId: b.gateId, firstEntry })],
      );
      await audit(tx, req, {
        action: "scanner.override_admit",
        entityType: "credential",
        entityId: cred.id,
        reason: b.reason,
        metadata: { gate: gate.name, firstEntry },
      });
      return { result: "VALID_ADMIT" as const, firstEntry };
    });
    return { ...out, display: SCAN_RESULT_DISPLAY.VALID_ADMIT };
  });

  app.get(
    "/scanner/history",
    { schema: { querystring: z.object({ gateId: z.uuid() }), tags: ["scanner"] } },
    async (req, reply) => {
      noStore(reply);
      const auth = requirePermission(req, "scan.admit");
      if (!hasPermission(auth, "scan.override")) {
        const assigned = await one(db, "select 1 from scanner_gate_assignments where user_id = $1 and gate_id = $2", [
          auth.user.id,
          req.query.gateId,
        ]);
        if (!assigned) throw Errors.forbidden("You are not assigned to this gate.");
      }
      const [items, totals] = await Promise.all([
        many(
          db,
          `select a.id, a.result, a.method, a.direction, a.created_at, c.accreditation_id, u.full_name
             from attendance_events a left join accreditation_credentials c on c.id = a.credential_id
             left join users u on u.id = c.user_id
            where a.gate_id = $1 order by a.created_at desc limit 50`,
          [req.query.gateId],
        ),
        one<{ admitted: number; scans: number; denied: number }>(
          db,
          `select count(*) filter (where counted)::int as admitted, count(*)::int as scans,
                  count(*) filter (where result not in ('VALID_ADMIT', 'VALID_EXIT'))::int as denied
             from attendance_events where gate_id = $1`,
          [req.query.gateId],
        ),
      ]);
      return { items, totals, serverTime: new Date().toISOString() };
    },
  );

  // ------------------------------------------------------------ gates & devices (admin)

  app.get("/admin/gates", { schema: { tags: ["gates-admin"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "attendance.read");
    const ev = await getActiveEvent(db);
    const gates = await many(
      db,
      `select g.*, (select count(*)::int from attendance_events a where a.gate_id = g.id and a.counted) as admitted,
              (select coalesce(json_agg(json_build_object('userId', u.id, 'name', u.full_name, 'email', u.email)), '[]')
                 from scanner_gate_assignments sa join users u on u.id = sa.user_id where sa.gate_id = g.id) as staff,
              (select coalesce(json_agg(json_build_object('id', d.id, 'label', d.label, 'active', d.is_active, 'lastSeenAt', d.last_seen_at)), '[]')
                 from scanner_devices d where d.gate_id = g.id) as devices
         from gates g where g.event_id = $1 order by g.code`,
      [ev.id],
    );
    return { items: gates };
  });

  app.post("/admin/gates", { schema: { body: GateInput, tags: ["gates-admin"] } }, async (req) => {
    requirePermission(req, "gate.manage");
    const ev = await getActiveEvent(db);
    const row = await one<{ id: string }>(
      db,
      "insert into gates (event_id, code, name, description, is_active) values ($1, $2, $3, $4, $5) on conflict (event_id, code) do nothing returning id",
      [ev.id, req.body.code, req.body.name, req.body.description, req.body.isActive],
    );
    if (!row) throw Errors.conflict("GATE_EXISTS", "A gate with this code already exists.");
    await audit(db, req, { action: "gate.created", entityType: "gate", entityId: row.id, metadata: { code: req.body.code } });
    return { id: row.id };
  });

  app.put(
    "/admin/gates/:id",
    { schema: { params: z.object({ id: z.uuid() }), body: GateInput, tags: ["gates-admin"] } },
    async (req) => {
      requirePermission(req, "gate.manage");
      const r = await db.query("update gates set code = $2, name = $3, description = $4, is_active = $5 where id = $1", [
        req.params.id,
        req.body.code,
        req.body.name,
        req.body.description,
        req.body.isActive,
      ]);
      if (!r.rowCount) throw Errors.notFound("Gate");
      await audit(db, req, {
        action: "gate.updated",
        entityType: "gate",
        entityId: req.params.id,
        metadata: { isActive: req.body.isActive },
      });
      return { ok: true };
    },
  );

  app.post(
    "/admin/gates/:id/staff",
    { schema: { params: z.object({ id: z.uuid() }), body: GateAssignmentInput, tags: ["gates-admin"] } },
    async (req) => {
      const auth = requirePermission(req, "gate.manage");
      const staff = await one<{ roles: string[] }>(
        db,
        "select coalesce(array_agg(role_key), '{}') as roles from user_roles where user_id = $1",
        [req.body.userId],
      );
      if (!staff?.roles.some((r) => r === "accreditation_officer" || r === "gate_supervisor")) {
        throw Errors.conflict("NOT_GATE_STAFF", "Only accreditation officers or gate supervisors can be assigned to gates.");
      }
      await db.query(
        "insert into scanner_gate_assignments (user_id, gate_id, assigned_by) values ($1, $2, $3) on conflict do nothing",
        [req.body.userId, req.params.id, auth.user.id],
      );
      await audit(db, req, {
        action: "gate.staff_assigned",
        entityType: "gate",
        entityId: req.params.id,
        metadata: { userId: req.body.userId },
      });
      return { ok: true };
    },
  );

  app.delete(
    "/admin/gates/:id/staff/:userId",
    { schema: { params: z.object({ id: z.uuid(), userId: z.uuid() }), tags: ["gates-admin"] } },
    async (req) => {
      requirePermission(req, "gate.manage");
      await db.query("delete from scanner_gate_assignments where gate_id = $1 and user_id = $2", [
        req.params.id,
        req.params.userId,
      ]);
      await audit(db, req, {
        action: "gate.staff_unassigned",
        entityType: "gate",
        entityId: req.params.id,
        metadata: { userId: req.params.userId },
      });
      return { ok: true };
    },
  );

  app.post(
    "/admin/devices/:id/deactivate",
    { schema: { params: z.object({ id: z.uuid() }), tags: ["gates-admin"] } },
    async (req) => {
      requirePermission(req, "device.manage");
      const r = await db.query("update scanner_devices set is_active = false where id = $1", [req.params.id]);
      if (!r.rowCount) throw Errors.notFound("Device");
      await audit(db, req, { action: "scanner.device_deactivated", entityType: "scanner_device", entityId: req.params.id });
      return { ok: true };
    },
  );

  // ------------------------------------------------------------ attendance & incidents

  app.get("/admin/attendance", { schema: { querystring: PageQuery, tags: ["attendance"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "attendance.read");
    const ev = await getActiveEvent(db);
    const { q } = req.query;
    const params: unknown[] = [ev.id];
    let w = "where a.event_id = $1";
    if (q) {
      params.push(likePrefix(q));
      w += ` and (c.accreditation_id like upper($2) or lower(u.full_name) like lower($2))`;
    }
    const page = pageClause(req.query, params.length + 1);
    const [items, total, byGate, totals] = await Promise.all([
      many(
        db,
        `select a.id, a.result, a.method, a.direction, a.counted, a.override_reason, a.created_at,
                  g.name as gate, c.accreditation_id, u.full_name, s.full_name as scanned_by
             from attendance_events a join gates g on g.id = a.gate_id
             left join accreditation_credentials c on c.id = a.credential_id left join users u on u.id = c.user_id
             join users s on s.id = a.scanned_by
             ${w} order by a.created_at desc${page.sql}`,
        [...params, ...page.params],
      ),
      one<{ n: number }>(
        db,
        `select count(*)::int as n from attendance_events a left join accreditation_credentials c on c.id = a.credential_id
             left join users u on u.id = c.user_id ${w}`,
        params,
      ),
      many(
        db,
        `select g.id, g.name, count(a.*) filter (where a.counted)::int as admitted, count(a.*)::int as scans,
                  count(a.*) filter (where a.result in ('ALREADY_CHECKED_IN', 'INVALID_CREDENTIAL', 'REVOKED_CREDENTIAL'))::int as suspicious
             from gates g left join attendance_events a on a.gate_id = g.id where g.event_id = $1 group by g.id order by g.name`,
        [ev.id],
      ),
      one(
        db,
        `select (select count(*)::int from accreditation_credentials where event_id = $1 and admitted_at is not null) as checked_in,
                  (select count(*)::int from accreditation_credentials where event_id = $1 and presence = 'inside') as inside,
                  (select count(*)::int from accreditation_credentials where event_id = $1 and status = 'active') as active_credentials`,
        [ev.id],
      ),
    ]);
    return { ...paged(items, total?.n ?? 0, req.query), byGate, totals };
  });

  app.post("/incidents", { schema: { body: IncidentInput, tags: ["incidents"] } }, async (req) => {
    const auth = requirePermission(req, "incident.create");
    const ev = await getActiveEvent(db);
    const row = await one<{ id: string }>(
      db,
      `insert into security_incidents (event_id, gate_id, reported_by, category, severity, description)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [ev.id, req.body.gateId, auth.user.id, req.body.category, req.body.severity, req.body.description],
    );
    await audit(db, req, {
      action: "incident.created",
      entityType: "security_incident",
      entityId: row?.id,
      metadata: { severity: req.body.severity, category: req.body.category },
    });
    return { id: row?.id };
  });

  app.get("/admin/incidents", { schema: { querystring: PageQuery, tags: ["incidents"] } }, async (req, reply) => {
    noStore(reply);
    requirePermission(req, "incident.manage");
    const status = req.query.status ?? null;
    const page = pageClause(req.query, 2);
    const items = await many(
      db,
      `select i.*, g.name as gate, u.full_name as reported_by_name from security_incidents i
         left join gates g on g.id = i.gate_id join users u on u.id = i.reported_by
        where ($1::text is null or i.status = $1) order by i.created_at desc${page.sql}`,
      [status, ...page.params],
    );
    const total = await one<{ n: number }>(
      db,
      "select count(*)::int as n from security_incidents where ($1::text is null or status = $1)",
      [status],
    );
    return paged(items, total?.n ?? 0, req.query);
  });

  app.patch(
    "/admin/incidents/:id",
    { schema: { params: z.object({ id: z.uuid() }), body: IncidentUpdateInput, tags: ["incidents"] } },
    async (req) => {
      const auth = requirePermission(req, "incident.manage");
      const resolved = req.body.status === "resolved";
      if (resolved && !req.body.resolution)
        throw Errors.badRequest("RESOLUTION_REQUIRED", "Describe how the incident was resolved.");
      const r = await db.query(
        `update security_incidents set status = $2, resolution = coalesce($3, resolution),
                resolved_by = case when $4 then $5::uuid else resolved_by end,
                resolved_at = case when $4 then now() else resolved_at end, updated_at = now() where id = $1`,
        [req.params.id, req.body.status, req.body.resolution ?? null, resolved, auth.user.id],
      );
      if (!r.rowCount) throw Errors.notFound("Incident");
      await audit(db, req, {
        action: "incident.updated",
        entityType: "security_incident",
        entityId: req.params.id,
        metadata: { status: req.body.status },
      });
      return { ok: true };
    },
  );
}
