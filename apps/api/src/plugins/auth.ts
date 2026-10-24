import { hasPrivilegedRole, type Permission, permissionsForRoles } from "@dnki/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { AuthState } from "../context";
import { one } from "../db/pool";
import { sha256Hex } from "../lib/crypto";
import { Errors } from "../lib/errors";

export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-dnki_session" : "dnki_session";
}

type SessionRow = {
  session_id: string;
  expires_at: Date;
  last_seen_at: Date;
  mfa_verified_at: Date | null;
  user_id: string;
  email: string;
  full_name: string;
  status: string;
  email_verified_at: Date | null;
  mfa_enabled_at: Date | null;
  roles: string[];
};

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function authPlugin(app: FastifyInstance) {
  const { config, db } = app.ctx;
  const cookieName = sessionCookieName(config.COOKIE_SECURE);

  // CSRF defence: state-changing requests must carry a custom header, which a
  // cross-site form cannot send and cross-origin fetch cannot send without CORS
  // (CORS is not enabled). Provider webhooks are authenticated by signature instead.
  app.addHook("onRequest", async (req) => {
    if (!UNSAFE.has(req.method)) return;
    if (req.url.startsWith("/api/v1/payments/webhooks/")) return;
    if (req.headers["x-dnki-csrf"] !== "1") {
      throw Errors.forbidden("Request rejected by CSRF protection.");
    }
  });

  app.addHook("onRequest", async (req) => {
    const token = req.cookies[cookieName];
    if (!token || token.length > 200) return;
    const row = await one<SessionRow>(
      db,
      `select s.id as session_id, s.expires_at, s.last_seen_at, s.mfa_verified_at,
              u.id as user_id, u.email, u.full_name, u.status, u.email_verified_at, u.mfa_enabled_at,
              coalesce(array_agg(ur.role_key) filter (where ur.role_key is not null), '{}') as roles
         from sessions s
         join users u on u.id = s.user_id
         left join user_roles ur on ur.user_id = u.id
        where s.token_hash = $1 and s.revoked_at is null
        group by s.id, u.id`,
      [sha256Hex(token)],
    );
    if (!row) return;
    const now = app.ctx.now();
    const idleLimit = new Date(row.last_seen_at.getTime() + config.SESSION_IDLE_MINUTES * 60_000);
    if (row.expires_at <= now || idleLimit <= now || row.status !== "active") {
      await db.query("update sessions set revoked_at = now(), revoked_reason = $2 where id = $1 and revoked_at is null", [
        row.session_id,
        row.status !== "active" ? "account_inactive" : "expired",
      ]);
      return;
    }
    if (now.getTime() - row.last_seen_at.getTime() > 60_000) {
      await db.query("update sessions set last_seen_at = now() where id = $1", [row.session_id]);
    }
    const mfaEnabled = row.mfa_enabled_at !== null;
    const mfaVerified = row.mfa_verified_at !== null;
    req.auth = {
      user: {
        id: row.user_id,
        email: row.email,
        fullName: row.full_name,
        status: row.status,
        emailVerified: row.email_verified_at !== null,
        mfaEnabled,
      },
      sessionId: row.session_id,
      mfaVerified,
      mfaPending: mfaEnabled && !mfaVerified,
      roles: row.roles,
      permissions: permissionsForRoles(row.roles),
      privileged: hasPrivilegedRole(row.roles),
    } satisfies AuthState;
  });
}

export const authHooks = fp(authPlugin, { name: "auth-hooks" });

/** Signed in with MFA completed (if enrolled). */
export function requireAuth(req: FastifyRequest, opts: { allowMfaPending?: boolean } = {}): AuthState {
  const auth = req.auth;
  if (!auth) throw Errors.unauthenticated();
  if (auth.mfaPending && !opts.allowMfaPending) throw Errors.mfaRequired();
  return auth;
}

/** Participant-facing actions require a verified email address. */
export function requireVerifiedAccount(req: FastifyRequest): AuthState {
  const auth = requireAuth(req);
  if (!auth.user.emailVerified) {
    throw Errors.forbidden("Verify your email address to continue.");
  }
  return auth;
}

/**
 * Staff guard. Holders of any privileged role must have enrolled MFA and completed
 * it on this session before any permission-guarded endpoint will respond.
 */
export function requirePermission(req: FastifyRequest, ...perms: Permission[]): AuthState {
  const auth = requireAuth(req);
  if (auth.privileged && !auth.mfaVerified) throw Errors.mfaRequired();
  for (const p of perms) if (!auth.permissions.has(p)) throw Errors.forbidden();
  return auth;
}

export function hasPermission(auth: AuthState, p: Permission): boolean {
  return auth.mfaVerified && auth.permissions.has(p);
}

export function noStore(reply: FastifyReply): void {
  reply.header("cache-control", "no-store");
}
