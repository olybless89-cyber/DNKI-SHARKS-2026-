import { describe, expect, it } from "vitest";
import { canTransition, formatMoney, hasPrivilegedRole, permissionsForRoles, ROLES, ScanInput } from "../src/index";

describe("registration state machine", () => {
  it("only the system can mark a registration paid or accredited", () => {
    expect(canTransition("awaiting_payment", "paid", "system")).toBe(true);
    expect(canTransition("awaiting_payment", "paid", "staff")).toBe(false);
    expect(canTransition("awaiting_payment", "paid", "participant")).toBe(false);
    expect(canTransition("paid", "accredited", "staff")).toBe(false);
  });

  it("does not allow skipping payment", () => {
    expect(canTransition("awaiting_payment", "accredited", "system")).toBe(false);
  });

  it("treats cancelled and refunded as terminal", () => {
    for (const to of ["awaiting_payment", "paid", "accredited"] as const) {
      expect(canTransition("cancelled", to, "system")).toBe(false);
      expect(canTransition("refunded", to, "system")).toBe(false);
    }
  });

  it("lets participants cancel only before payment", () => {
    expect(canTransition("awaiting_payment", "cancelled", "participant")).toBe(true);
    expect(canTransition("paid", "cancelled", "participant")).toBe(false);
  });
});

describe("rbac separation of duties", () => {
  it("membership officers cannot touch payments", () => {
    const p = permissionsForRoles(["membership_officer"]);
    expect([...p].some((x) => x.startsWith("payment."))).toBe(false);
  });

  it("finance officers cannot review membership", () => {
    const p = permissionsForRoles(["finance_officer"]);
    expect(p.has("membership.review")).toBe(false);
  });

  it("accreditation officers cannot configure events or refund", () => {
    const p = permissionsForRoles(["accreditation_officer"]);
    expect(p.has("event.configure")).toBe(false);
    expect(p.has("payment.refund")).toBe(false);
  });

  it("auditors are read-only", () => {
    for (const p of ROLES.auditor.permissions) {
      expect(p.endsWith(".read") || p === "event.read_admin").toBe(true);
    }
  });

  it("participants hold no permissions and are not privileged", () => {
    expect(permissionsForRoles(["participant"]).size).toBe(0);
    expect(hasPrivilegedRole(["participant"])).toBe(false);
    expect(hasPrivilegedRole(["participant", "auditor"])).toBe(true);
  });

  it("ignores unknown role keys", () => {
    expect(permissionsForRoles(["root", "__proto__"]).size).toBe(0);
  });
});

describe("schemas", () => {
  it("requires exactly one of token or accreditation ID for a scan", () => {
    const base = {
      gateId: "6f1c0d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      deviceId: "6f1c0d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6f",
    };
    expect(ScanInput.safeParse(base).success).toBe(false);
    expect(ScanInput.safeParse({ ...base, token: "x", accreditationId: "DNKI-ABCDE-12345" }).success).toBe(false);
    expect(ScanInput.safeParse({ ...base, token: "DNKI1.abc" }).success).toBe(true);
  });
});

describe("money", () => {
  it("formats integer minor units without floating point", () => {
    expect(formatMoney(2500000, "NGN")).toBe("₦25,000.00");
    expect(formatMoney("1999", "USD", "en-US")).toBe("$19.99");
  });
});
