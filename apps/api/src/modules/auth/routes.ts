import {
  ChangePasswordInput,
  EmailCodeInput,
  ForgotPasswordInput,
  hasPrivilegedRole,
  LoginInput,
  MfaCodeInput,
  ResetPasswordInput,
  SignupInput,
} from "@dnki/shared";
import { hash, verify } from "@node-rs/argon2";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { generateSecret, generateURI, verify as verifyTotp } from "otplib";
import QRCode from "qrcode";
import { many, one, withTx } from "../../db/pool";
import { audit } from "../../lib/audit";
import { consumeCode, issueCode, secondsSinceLastCode } from "../../lib/codes";
import { crockford, decrypt, encrypt, randomToken, sha256Hex } from "../../lib/crypto";
import { AppError, Errors } from "../../lib/errors";
import { noStore, requireAuth, sessionCookieName } from "../../plugins/auth";
import { enqueueEmail } from "../notifications/outbox";
import { templates } from "../notifications/templates";

// Used to equalise timing when the account does not exist.
const DUMMY_HASH = await hash("not-a-real-password-dnki", { memoryCost: 19456, timeCost: 2 });
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const MAX_FAILED_BEFORE_LOCK = 5;

export async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db, config } = app.ctx;
  const cookieName = sessionCookieName(config.COOKIE_SECURE);
  const strict = { rateLimit: { max: 10, timeWindow: "1 minute" } };

  async function startSession(reply: FastifyReply, userId: string, roles: string[], ip: string, ua?: string) {
    const token = randomToken(32);
    const ttlHours = hasPrivilegedRole(roles) ? config.PRIVILEGED_SESSION_TTL_HOURS : config.SESSION_TTL_HOURS;
    await db.query(
      `insert into sessions (user_id, token_hash, expires_at, ip, user_agent)
       values ($1, $2, now() + make_interval(hours => $3), $4, $5)`,
      [userId, sha256Hex(token), ttlHours, ip, ua?.slice(0, 300) ?? null],
    );
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: ttlHours * 3600,
    });
  }

  app.post(
    "/signup",
    { schema: { body: SignupInput, tags: ["auth"] }, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { email, password, fullName, phone } = req.body;
      const passwordHash = await hash(password, ARGON);
      const created = await withTx(db, async (tx) => {
        const user = await one<{ id: string }>(
          tx,
          `insert into users (email, full_name, phone, password_hash) values ($1, $2, $3, $4)
           on conflict (email) do nothing returning id`,
          [email, fullName, phone ?? null, passwordHash],
        );
        if (user) {
          await tx.query("insert into user_roles (user_id, role_key, reason) values ($1, 'participant', 'self signup')", [
            user.id,
          ]);
          const code = await issueCode(tx, config.encryptionKey, { userId: user.id, purpose: "email_verification" });
          const t = templates.emailVerification(fullName, code);
          await enqueueEmail(tx, {
            userId: user.id,
            to: email,
            template: "email_verification",
            ...t,
            sensitive: true,
            idempotencyKey: `email_verification:${user.id}:${sha256Hex(code)}`,
          });
        }
        return Boolean(user);
      });
      if (!created) {
        // Do not reveal whether the address is registered. Tell the real owner instead.
        await enqueueEmail(db, {
          userId: null,
          to: email,
          template: "signup_existing_account",
          subject: "DNKI SHARKS sign-up attempt",
          text: "Someone tried to create a DNKI SHARKS account with this email address. If this was you, sign in or reset your password instead.",
          idempotencyKey: `signup_existing:${sha256Hex(email)}:${Math.floor(Date.now() / 3_600_000)}`,
        });
      }
      return reply.code(202).send({
        message: "If this email can be used, your account has been created. Sign in to verify your email address.",
      });
    },
  );

  app.post("/login", { schema: { body: LoginInput, tags: ["auth"] }, config: strict }, async (req, reply) => {
    const { email, password } = req.body;
    const user = await one<{
      id: string;
      password_hash: string;
      status: string;
      locked: boolean;
      failed_login_count: number;
      mfa_enabled_at: Date | null;
      roles: string[];
    }>(
      db,
      `select u.id, u.password_hash, u.status, coalesce(u.locked_until > now(), false) as locked, u.failed_login_count,
              u.mfa_enabled_at,
              coalesce(array_agg(ur.role_key) filter (where ur.role_key is not null), '{}') as roles
         from users u left join user_roles ur on ur.user_id = u.id
        where u.email = $1 group by u.id`,
      [email],
    );
    if (!user) {
      await verify(DUMMY_HASH, password).catch(() => false);
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    if (user.locked) {
      throw new AppError(429, "ACCOUNT_LOCKED", "Too many failed sign-in attempts. Try again later or reset your password.");
    }
    const ok = await verify(user.password_hash, password).catch(() => false);
    if (!ok) {
      const n = user.failed_login_count + 1;
      const lockMinutes = n >= MAX_FAILED_BEFORE_LOCK ? Math.min(60, 2 ** (n - MAX_FAILED_BEFORE_LOCK)) : 0;
      await db.query(
        `update users set failed_login_count = $2,
                locked_until = case when $3 > 0 then now() + make_interval(mins => $3) else locked_until end
          where id = $1`,
        [user.id, n, lockMinutes],
      );
      if (lockMinutes > 0) {
        await audit(db, req, {
          action: "auth.account_locked",
          entityType: "user",
          entityId: user.id,
          metadata: { failedAttempts: n, lockMinutes },
        });
      }
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    if (user.status !== "active") {
      throw Errors.forbidden("This account is not active. Contact the accreditation support desk.");
    }
    await db.query("update users set failed_login_count = 0, locked_until = null where id = $1", [user.id]);
    await startSession(reply, user.id, user.roles, req.ip, req.headers["user-agent"]);
    const privileged = hasPrivilegedRole(user.roles);
    if (privileged) {
      await audit(db, null, { action: "auth.staff_login", entityType: "user", entityId: user.id });
    }
    noStore(reply);
    return {
      mfaRequired: user.mfa_enabled_at !== null,
      mfaEnrollmentRequired: privileged && user.mfa_enabled_at === null,
    };
  });

  app.post("/logout", { schema: { tags: ["auth"] } }, async (req, reply) => {
    if (req.auth) {
      await db.query("update sessions set revoked_at = now(), revoked_reason = 'logout' where id = $1", [req.auth.sessionId]);
    }
    reply.clearCookie(cookieName, { path: "/" });
    return { ok: true };
  });

  app.get("/me", { schema: { tags: ["auth"] } }, async (req, reply) => {
    noStore(reply);
    const auth = requireAuth(req, { allowMfaPending: true });
    return {
      user: auth.user,
      roles: auth.roles,
      permissions: auth.mfaPending || (auth.privileged && !auth.mfaVerified) ? [] : [...auth.permissions],
      privileged: auth.privileged,
      mfa: {
        enabled: auth.user.mfaEnabled,
        verifiedThisSession: auth.mfaVerified,
        pending: auth.mfaPending,
        enrollmentRequired: auth.privileged && !auth.user.mfaEnabled,
      },
    };
  });

  app.post("/email/verify", { schema: { body: EmailCodeInput, tags: ["auth"] }, config: strict }, async (req) => {
    const auth = requireAuth(req);
    if (auth.user.emailVerified) return { ok: true };
    await consumeCode(db, config.encryptionKey, {
      userId: auth.user.id,
      purpose: "email_verification",
      code: req.body.code,
    });
    await db.query("update users set email_verified_at = now(), updated_at = now() where id = $1", [auth.user.id]);
    return { ok: true };
  });

  app.post(
    "/email/resend",
    { schema: { tags: ["auth"] }, config: { rateLimit: { max: 3, timeWindow: "5 minutes" } } },
    async (req) => {
      const auth = requireAuth(req);
      if (auth.user.emailVerified) return { ok: true };
      const since = await secondsSinceLastCode(db, auth.user.id, "email_verification");
      if (since !== null && since < 60) throw Errors.conflict("TOO_SOON", "Wait a minute before requesting a new code.");
      await withTx(db, async (tx) => {
        const code = await issueCode(tx, config.encryptionKey, { userId: auth.user.id, purpose: "email_verification" });
        await enqueueEmail(tx, {
          userId: auth.user.id,
          to: auth.user.email,
          template: "email_verification",
          ...templates.emailVerification(auth.user.fullName, code),
          sensitive: true,
          idempotencyKey: `email_verification:${auth.user.id}:${sha256Hex(code)}`,
        });
      });
      return { ok: true };
    },
  );

  app.post(
    "/password/forgot",
    { schema: { body: ForgotPasswordInput, tags: ["auth"] }, config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const user = await one<{ id: string; full_name: string; email: string }>(
        db,
        "select id, full_name, email from users where email = $1 and status = 'active'",
        [req.body.email],
      );
      if (user) {
        const token = randomToken(32);
        await withTx(db, async (tx) => {
          await tx.query(
            "update one_time_codes set consumed_at = now() where user_id = $1 and purpose = 'password_reset' and consumed_at is null",
            [user.id],
          );
          await tx.query(
            `insert into one_time_codes (user_id, purpose, code_hash, expires_at)
             values ($1, 'password_reset', $2, now() + interval '30 minutes')`,
            [user.id, sha256Hex(token)],
          );
          const link = `${config.PUBLIC_WEB_URL}/auth/reset?token=${encodeURIComponent(token)}`;
          await enqueueEmail(tx, {
            userId: user.id,
            to: user.email,
            template: "password_reset",
            ...templates.passwordReset(user.full_name, link),
            sensitive: true,
            idempotencyKey: `password_reset:${sha256Hex(token)}`,
          });
        });
      }
      return reply.code(202).send({ message: "If an account exists for this email, a reset link has been sent." });
    },
  );

  app.post("/password/reset", { schema: { body: ResetPasswordInput, tags: ["auth"] }, config: strict }, async (req) => {
    const passwordHash = await hash(req.body.password, ARGON);
    const user = await withTx(db, async (tx) => {
      const code = await one<{ id: string; user_id: string }>(
        tx,
        `select id, user_id from one_time_codes
          where code_hash = $1 and purpose = 'password_reset' and consumed_at is null and expires_at > now()
          for update`,
        [sha256Hex(req.body.token)],
      );
      if (!code) throw Errors.badRequest("RESET_TOKEN_INVALID", "This reset link is invalid or has expired.");
      await tx.query("update one_time_codes set consumed_at = now() where id = $1", [code.id]);
      const u = await one<{ id: string; full_name: string; email: string }>(
        tx,
        `update users set password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = null,
                updated_at = now()
          where id = $1 returning id, full_name, email`,
        [code.user_id, passwordHash],
      );
      await tx.query(
        "update sessions set revoked_at = now(), revoked_reason = 'password_reset' where user_id = $1 and revoked_at is null",
        [code.user_id],
      );
      if (!u) throw Errors.notFound("Account");
      await enqueueEmail(tx, {
        userId: u.id,
        to: u.email,
        template: "password_changed",
        ...templates.passwordChanged(u.full_name),
        idempotencyKey: `password_changed:${code.id}`,
      });
      return u;
    });
    return { ok: true, userId: user.id };
  });

  app.post("/password/change", { schema: { body: ChangePasswordInput, tags: ["auth"] }, config: strict }, async (req) => {
    const auth = requireAuth(req);
    const row = await one<{ password_hash: string }>(db, "select password_hash from users where id = $1", [auth.user.id]);
    if (!row || !(await verify(row.password_hash, req.body.currentPassword).catch(() => false))) {
      throw Errors.badRequest("INVALID_CREDENTIALS", "Your current password is incorrect.");
    }
    const passwordHash = await hash(req.body.newPassword, ARGON);
    await withTx(db, async (tx) => {
      await tx.query("update users set password_hash = $2, password_changed_at = now(), updated_at = now() where id = $1", [
        auth.user.id,
        passwordHash,
      ]);
      await tx.query(
        "update sessions set revoked_at = now(), revoked_reason = 'password_changed' where user_id = $1 and id <> $2 and revoked_at is null",
        [auth.user.id, auth.sessionId],
      );
      await enqueueEmail(tx, {
        userId: auth.user.id,
        to: auth.user.email,
        template: "password_changed",
        ...templates.passwordChanged(auth.user.fullName),
        idempotencyKey: `password_changed:${auth.sessionId}:${Date.now()}`,
      });
    });
    return { ok: true };
  });

  // ------------------------------------------------------------------ MFA (TOTP)

  app.post("/mfa/setup", { schema: { tags: ["auth"] } }, async (req, reply) => {
    noStore(reply);
    const auth = requireAuth(req);
    if (auth.user.mfaEnabled) throw Errors.conflict("MFA_ALREADY_ENABLED", "MFA is already enabled.");
    const secret = generateSecret();
    await db.query("update users set mfa_secret_enc = $2 where id = $1", [auth.user.id, encrypt(secret, config.encryptionKey)]);
    const uri = generateURI({ issuer: "DNKI SHARKS Accreditation", label: auth.user.email, secret });
    return { otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }), secret };
  });

  app.post("/mfa/enable", { schema: { body: MfaCodeInput, tags: ["auth"] }, config: strict }, async (req, reply) => {
    noStore(reply);
    const auth = requireAuth(req);
    const row = await one<{ mfa_secret_enc: string | null; mfa_enabled_at: Date | null }>(
      db,
      "select mfa_secret_enc, mfa_enabled_at from users where id = $1",
      [auth.user.id],
    );
    if (!row?.mfa_secret_enc || row.mfa_enabled_at) throw Errors.conflict("MFA_NOT_PENDING", "Start MFA setup first.");
    const result = await verifyTotp({
      secret: decrypt(row.mfa_secret_enc, config.encryptionKey),
      token: req.body.code,
      epochTolerance: 30,
    });
    if (!result.valid) throw Errors.badRequest("CODE_INVALID", "That code is not correct.");
    const recoveryCodes = Array.from({ length: 10 }, () => `${crockford(5)}-${crockford(5)}`);
    await withTx(db, async (tx) => {
      await tx.query("update users set mfa_enabled_at = now(), mfa_last_timestep = $2 where id = $1", [
        auth.user.id,
        "timeStep" in result ? result.timeStep : null,
      ]);
      await tx.query("update sessions set mfa_verified_at = now() where id = $1", [auth.sessionId]);
      await tx.query("delete from mfa_recovery_codes where user_id = $1", [auth.user.id]);
      for (const c of recoveryCodes) {
        await tx.query("insert into mfa_recovery_codes (user_id, code_hash) values ($1, $2)", [
          auth.user.id,
          sha256Hex(c.toUpperCase()),
        ]);
      }
      await audit(tx, req, { action: "auth.mfa_enabled", entityType: "user", entityId: auth.user.id });
    });
    return { ok: true, recoveryCodes };
  });

  app.post("/mfa/challenge", { schema: { body: MfaCodeInput, tags: ["auth"] }, config: strict }, async (req, reply) => {
    noStore(reply);
    const auth = requireAuth(req, { allowMfaPending: true });
    if (!auth.user.mfaEnabled) throw Errors.conflict("MFA_NOT_ENABLED", "MFA is not enabled for this account.");
    const code = req.body.code.toUpperCase();
    let ok = false;
    if (code.includes("-")) {
      const used = await one<{ id: string }>(
        db,
        `update mfa_recovery_codes set used_at = now()
          where id = (select id from mfa_recovery_codes where user_id = $1 and code_hash = $2 and used_at is null limit 1)
          returning id`,
        [auth.user.id, sha256Hex(code)],
      );
      ok = Boolean(used);
      if (ok) await audit(db, req, { action: "auth.mfa_recovery_code_used", entityType: "user", entityId: auth.user.id });
    } else {
      const row = await one<{ mfa_secret_enc: string; mfa_last_timestep: string | null }>(
        db,
        "select mfa_secret_enc, mfa_last_timestep from users where id = $1",
        [auth.user.id],
      );
      if (row) {
        const result = await verifyTotp({
          secret: decrypt(row.mfa_secret_enc, config.encryptionKey),
          token: code,
          epochTolerance: 30,
          ...(row.mfa_last_timestep ? { afterTimeStep: Number(row.mfa_last_timestep) } : {}),
        });
        if (result.valid) {
          ok = true;
          await db.query("update users set mfa_last_timestep = $2 where id = $1", [
            auth.user.id,
            "timeStep" in result ? result.timeStep : null,
          ]);
        }
      }
    }
    if (!ok) throw Errors.badRequest("CODE_INVALID", "That code is not correct.");
    await db.query("update sessions set mfa_verified_at = now() where id = $1", [auth.sessionId]);
    return { ok: true };
  });

  app.get("/sessions", { schema: { tags: ["auth"] } }, async (req, reply) => {
    noStore(reply);
    const auth = requireAuth(req);
    const rows = await many<{ id: string; created_at: Date; last_seen_at: Date; user_agent: string | null }>(
      db,
      "select id, created_at, last_seen_at, user_agent from sessions where user_id = $1 and revoked_at is null and expires_at > now() order by last_seen_at desc",
      [auth.user.id],
    );
    return { items: rows.map((r) => ({ ...r, current: r.id === auth.sessionId })) };
  });

  app.post("/sessions/revoke-others", { schema: { tags: ["auth"] } }, async (req) => {
    const auth = requireAuth(req);
    const r = await db.query(
      "update sessions set revoked_at = now(), revoked_reason = 'user_revoked' where user_id = $1 and id <> $2 and revoked_at is null",
      [auth.user.id, auth.sessionId],
    );
    return { revoked: r.rowCount };
  });
}
