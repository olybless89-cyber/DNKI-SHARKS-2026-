export const SCAN_RESULTS = [
  "VALID_ADMIT",
  "VALID_EXIT",
  "ALREADY_CHECKED_IN",
  "INVALID_CREDENTIAL",
  "PAYMENT_OR_ELIGIBILITY_ISSUE",
  "REVOKED_CREDENTIAL",
  "EXPIRED_CREDENTIAL",
  "MANUAL_REVIEW_REQUIRED",
  "TEMPORARY_SYSTEM_FAILURE",
] as const;

export type ScanResult = (typeof SCAN_RESULTS)[number];

/** Display metadata for scanner staff. Tone drives colour; label and icon never rely on colour alone. */
export const SCAN_RESULT_DISPLAY: Record<
  ScanResult,
  { label: string; tone: "admit" | "deny" | "warn"; icon: "check" | "cross" | "alert" | "repeat"; instruction: string }
> = {
  VALID_ADMIT: { label: "VALID — ADMIT", tone: "admit", icon: "check", instruction: "Admit the participant." },
  VALID_EXIT: { label: "EXIT RECORDED", tone: "admit", icon: "check", instruction: "Exit recorded." },
  ALREADY_CHECKED_IN: {
    label: "ALREADY CHECKED IN",
    tone: "deny",
    icon: "repeat",
    instruction: "Do not admit. Refer to the gate supervisor.",
  },
  INVALID_CREDENTIAL: {
    label: "INVALID CREDENTIAL",
    tone: "deny",
    icon: "cross",
    instruction: "Do not admit. The code is not a recognised credential.",
  },
  PAYMENT_OR_ELIGIBILITY_ISSUE: {
    label: "PAYMENT OR ELIGIBILITY ISSUE",
    tone: "deny",
    icon: "alert",
    instruction: "Do not admit. Direct the participant to the accreditation desk.",
  },
  REVOKED_CREDENTIAL: {
    label: "REVOKED CREDENTIAL",
    tone: "deny",
    icon: "cross",
    instruction: "Do not admit. Notify the gate supervisor.",
  },
  EXPIRED_CREDENTIAL: {
    label: "EXPIRED CREDENTIAL",
    tone: "deny",
    icon: "cross",
    instruction: "Do not admit. Direct the participant to the accreditation desk.",
  },
  MANUAL_REVIEW_REQUIRED: {
    label: "MANUAL REVIEW REQUIRED",
    tone: "warn",
    icon: "alert",
    instruction: "Confirm the participant's identity before admitting.",
  },
  TEMPORARY_SYSTEM_FAILURE: {
    label: "TEMPORARY SYSTEM FAILURE",
    tone: "warn",
    icon: "alert",
    instruction: "Do not admit on this result. Retry, or follow the supervisor fallback procedure.",
  },
};

/** QR payload prefix. The QR carries only this prefix and an opaque random token. */
export const QR_PAYLOAD_PREFIX = "DNKI1.";
