import { z } from "zod";
import { SCAN_RESULTS } from "./scan";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(12, "Use at least 12 characters").max(128, "Use at most 128 characters");
const code6 = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code");
const uuid = z.uuid();

export const SignupInput = z.object({
  email,
  password,
  fullName: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number")
    .optional(),
});

export const LoginInput = z.object({ email, password: z.string().min(1).max(128) });
export const EmailCodeInput = z.object({ code: code6 });
export const ForgotPasswordInput = z.object({ email });
export const ResetPasswordInput = z.object({ token: z.string().min(20).max(200), password });
export const ChangePasswordInput = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
export const MfaCodeInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^(\d{6}|[A-Z0-9]{5}-[A-Z0-9]{5})$/i, "Enter a 6-digit code or a recovery code"),
});

export const MembershipSubmitInput = z.object({
  membershipNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9/-]{3,40}$/, "Enter your membership number as it appears on your card"),
  contactOnRecord: email,
});
export const MembershipCodeInput = z.object({ verificationId: uuid, code: code6 });
export const MembershipManualReviewInput = z.object({
  membershipNumber: MembershipSubmitInput.shape.membershipNumber,
  note: z.string().trim().min(10).max(1000),
});
export const MembershipDecisionInput = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), memberRecordId: uuid, reason: z.string().trim().min(3).max(500) }),
  z.object({ decision: z.literal("reject"), reason: z.string().trim().min(3).max(500) }),
]);

export const MEMBER_STANDINGS = ["good_standing", "lapsed", "suspended", "expelled"] as const;
export const MemberImportRow = z.object({
  membership_number: MembershipSubmitInput.shape.membershipNumber,
  full_name: z.string().trim().min(2).max(160),
  chapter: z.string().trim().max(120).optional().default(""),
  zone: z.string().trim().max(120).optional().default(""),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email())
    .optional()
    .or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(32).optional().default(""),
  standing: z.enum(MEMBER_STANDINGS),
});
export const MemberCorrectionInput = z.object({
  fullName: z.string().trim().min(2).max(160).optional(),
  chapter: z.string().trim().max(120).optional(),
  zone: z.string().trim().max(120).optional(),
  email: email.optional(),
  phone: z.string().trim().max(32).optional(),
  standing: z.enum(MEMBER_STANDINGS).optional(),
  reason: z.string().trim().min(5).max(500),
});

export const CreateRegistrationInput = z.object({
  categoryId: uuid,
  acceptTerms: z.literal(true, { error: "You must accept the terms to register" }),
});

const isoDate = z.iso.datetime({ offset: true });
export const EventConfigInput = z.object({
  name: z.string().trim().min(3).max(160),
  theme: z.string().trim().max(160),
  description: z.string().trim().max(5000),
  venueText: z.string().trim().max(500).nullable(),
  startsAt: isoDate.nullable(),
  endsAt: isoDate.nullable(),
  registrationOpensAt: isoDate.nullable(),
  registrationClosesAt: isoDate.nullable(),
  registrationOpen: z.boolean(),
  reentryPolicy: z.enum(["single_entry", "reentry_allowed"]),
  credentialValidFrom: isoDate.nullable(),
  credentialValidUntil: isoDate.nullable(),
  supportEmail: z.email().nullable(),
  supportPhone: z.string().trim().max(40).nullable(),
  privacyNotice: z.string().max(20000),
  terms: z.string().max(20000),
  faqs: z.array(z.object({ q: z.string().min(3).max(300), a: z.string().min(1).max(3000) })).max(50),
  reason: z.string().trim().min(3).max(500),
});

export const CategoryInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,20}$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(""),
  feeMinor: z.number().int().positive().max(1_000_000_000_00),
  currency: z.string().trim().toUpperCase().length(3),
  capacity: z.number().int().positive().nullable(),
  requiresIdentityCheck: z.boolean().default(false),
  isActive: z.boolean().default(true),
  reason: z.string().trim().min(3).max(500),
});

export const ProgrammeItemInput = z.object({
  title: z.string().trim().min(2).max(200),
  startsAt: isoDate,
  endsAt: isoDate.nullable(),
  location: z.string().trim().max(200).nullable(),
  description: z.string().trim().max(2000).default(""),
});

export const AnnouncementInput = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().max(5000).default(""),
  kind: z.enum(["announcement", "facebook_broadcast", "link"]),
  url: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullable(),
  status: z.enum(["draft", "published", "archived"]),
});

export const ScanInput = z
  .object({
    token: z.string().trim().max(200).optional(),
    accreditationId: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^DNKI-[0-9A-Z]{5}-[0-9A-Z]{5}$/)
      .optional(),
    gateId: uuid,
    deviceId: uuid,
    direction: z.enum(["entry", "exit"]).default("entry"),
    identityConfirmed: z.boolean().default(false),
  })
  .refine((v) => Boolean(v.token) !== Boolean(v.accreditationId), {
    message: "Provide exactly one of token or accreditationId",
  });

export const ScanOverrideInput = z.object({
  credentialId: uuid,
  gateId: uuid,
  deviceId: uuid,
  reason: z.string().trim().min(10).max(500),
});

export const ScanResultSchema = z.enum(SCAN_RESULTS);

export const CredentialActionInput = z.object({ reason: z.string().trim().min(5).max(500) });
export const RegistrationActionInput = z.object({
  action: z.enum(["cancel", "suspend", "reinstate", "revoke"]),
  reason: z.string().trim().min(5).max(500),
});
export const RefundInput = z.object({ reason: z.string().trim().min(5).max(500) });
export const RoleGrantInput = z.object({ role: z.string(), reason: z.string().trim().min(5).max(500) });
export const GateInput = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(""),
  isActive: z.boolean().default(true),
});
export const GateAssignmentInput = z.object({ userId: uuid });
export const DeviceRegisterInput = z.object({ label: z.string().trim().min(2).max(80), gateId: uuid });
export const IncidentInput = z.object({
  gateId: uuid.nullable().default(null),
  category: z.enum(["duplicate_entry", "fraud_suspected", "identity_mismatch", "system", "safety", "other"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().trim().min(10).max(4000),
});
export const IncidentUpdateInput = z.object({
  status: z.enum(["open", "investigating", "resolved"]),
  resolution: z.string().trim().max(4000).optional(),
});

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(40).optional(),
});
