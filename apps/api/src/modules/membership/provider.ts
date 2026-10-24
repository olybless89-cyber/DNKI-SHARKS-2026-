import type { AppConfig } from "../../config";
import { type Db, one, type Queryable } from "../../db/pool";

export type MemberRecord = {
  id: string;
  membership_number: string;
  full_name: string;
  chapter: string;
  zone: string;
  email: string | null;
  standing: "good_standing" | "lapsed" | "suspended" | "expelled";
  linked_user_id: string | null;
  source: string;
};

/**
 * Authoritative membership source. Implementations return the member record a
 * membership number refers to (cached locally so it can be linked to an account),
 * or null when the source has no such member.
 *
 * A lookup result is NOT proof of identity. Identity is established by a one-time
 * code sent to the contact the authoritative source holds for that member, or by
 * an authorised officer through manual review.
 */
export interface MembershipVerificationProvider {
  readonly name: "registry" | "api" | "manual";
  /** Whether lookups can be confirmed automatically via a code sent to the contact on record. */
  readonly supportsContactVerification: boolean;
  lookup(q: Queryable, membershipNumber: string): Promise<MemberRecord | null>;
}

const SELECT = `select id, membership_number, full_name, chapter, zone, email, standing, linked_user_id, source
                  from member_records`;

/** Local registry populated by controlled imports (CSV) and officer corrections. */
export class RegistryMembershipProvider implements MembershipVerificationProvider {
  readonly name = "registry" as const;
  readonly supportsContactVerification = true;
  async lookup(q: Queryable, membershipNumber: string) {
    return (await one<MemberRecord>(q, `${SELECT} where membership_number = $1`, [membershipNumber])) ?? null;
  }
}

/** No automated source: every request goes to the officer review queue. */
export class ManualMembershipProvider implements MembershipVerificationProvider {
  readonly name = "manual" as const;
  readonly supportsContactVerification = false;
  async lookup(q: Queryable, membershipNumber: string) {
    // Officers still see any locally held record as a candidate during review.
    return (await one<MemberRecord>(q, `${SELECT} where membership_number = $1`, [membershipNumber])) ?? null;
  }
}

/**
 * Adapter for an existing DNKI membership API. The contract below is a
 * placeholder until DNKI supplies the real API specification; see
 * docs/MEMBERSHIP_INTEGRATION.md. It has NOT been tested against a real endpoint.
 *
 *   GET {MEMBERSHIP_API_URL}/members/{membershipNumber}
 *   Authorization: Bearer {MEMBERSHIP_API_KEY}
 *   200 -> { membershipNumber, fullName, chapter, zone, email, standing }
 *   404 -> not found
 */
export class ApiMembershipProvider implements MembershipVerificationProvider {
  readonly name = "api" as const;
  readonly supportsContactVerification = true;
  constructor(private readonly config: AppConfig) {}

  async lookup(q: Queryable, membershipNumber: string) {
    const url = new URL(`members/${encodeURIComponent(membershipNumber)}`, ensureSlash(this.config.MEMBERSHIP_API_URL ?? ""));
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${this.config.MEMBERSHIP_API_KEY}`, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Membership API responded ${res.status}`);
    const m = (await res.json()) as {
      membershipNumber: string;
      fullName: string;
      chapter?: string;
      zone?: string;
      email?: string | null;
      standing: MemberRecord["standing"];
    };
    if (m.membershipNumber !== membershipNumber) throw new Error("Membership API returned a different member");
    return (
      (await one<MemberRecord>(
        q,
        `insert into member_records (membership_number, full_name, chapter, zone, email, standing, source)
         values ($1, $2, $3, $4, $5, $6, 'api')
         on conflict (membership_number) do update
           set full_name = excluded.full_name, chapter = excluded.chapter, zone = excluded.zone,
               email = excluded.email, standing = excluded.standing, updated_at = now()
         returning id, membership_number, full_name, chapter, zone, email, standing, linked_user_id, source`,
        [membershipNumber, m.fullName, m.chapter ?? "", m.zone ?? "", m.email ?? null, m.standing],
      )) ?? null
    );
  }
}

function ensureSlash(u: string) {
  return u.endsWith("/") ? u : `${u}/`;
}

export function createMembershipProvider(config: AppConfig, _db: Db): MembershipVerificationProvider {
  switch (config.MEMBERSHIP_PROVIDER) {
    case "api":
      return new ApiMembershipProvider(config);
    case "manual":
      return new ManualMembershipProvider();
    default:
      return new RegistryMembershipProvider();
  }
}
