/**
 * Registration lifecycle.
 *
 * A registration row only exists once a member is verified and eligible, so the
 * pre-registration stages (pending membership verification, eligible) are
 * represented by the membership verification record and surfaced to the
 * participant through `ParticipantJourneyStage`.
 */

export const REGISTRATION_STATUSES = [
  "awaiting_payment",
  "paid",
  "accredited",
  "cancelled",
  "refunded",
  "suspended",
  "revoked",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export type ActorType = "participant" | "staff" | "system";

type Transition = { to: RegistrationStatus; actors: readonly ActorType[] };

export const REGISTRATION_TRANSITIONS: Record<RegistrationStatus, readonly Transition[]> = {
  awaiting_payment: [
    { to: "paid", actors: ["system"] },
    { to: "cancelled", actors: ["participant", "staff", "system"] },
  ],
  paid: [
    { to: "accredited", actors: ["system"] },
    { to: "refunded", actors: ["system"] },
    { to: "suspended", actors: ["staff"] },
  ],
  accredited: [
    { to: "refunded", actors: ["system"] },
    { to: "suspended", actors: ["staff"] },
    { to: "revoked", actors: ["staff"] },
  ],
  suspended: [
    { to: "accredited", actors: ["staff"] },
    { to: "revoked", actors: ["staff"] },
    { to: "refunded", actors: ["system"] },
  ],
  revoked: [{ to: "refunded", actors: ["system"] }],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: RegistrationStatus, to: RegistrationStatus, actor: ActorType): boolean {
  return REGISTRATION_TRANSITIONS[from].some((t) => t.to === to && t.actors.includes(actor));
}

/** Statuses that hold a member's single registration slot for an event. */
export const ACTIVE_REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  "awaiting_payment",
  "paid",
  "accredited",
  "suspended",
  "revoked",
];

export type ParticipantJourneyStage =
  | "account_unverified"
  | "pending_membership_verification"
  | "membership_under_review"
  | "membership_rejected"
  | "eligible"
  | RegistrationStatus;

export const JOURNEY_LABELS: Record<ParticipantJourneyStage, string> = {
  account_unverified: "Verify your email address",
  pending_membership_verification: "Membership verification required",
  membership_under_review: "Membership under review",
  membership_rejected: "Membership verification unsuccessful",
  eligible: "Eligible — ready to register",
  awaiting_payment: "Awaiting payment",
  paid: "Payment confirmed — accreditation pending",
  accredited: "Accredited",
  cancelled: "Registration cancelled",
  refunded: "Refunded",
  suspended: "Registration suspended",
  revoked: "Accreditation revoked",
};
