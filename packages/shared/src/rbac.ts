/**
 * Role-based access control matrix.
 *
 * This file is the single source of truth for roles and permissions. The API
 * syncs it into the `roles`, `permissions` and `role_permissions` tables on
 * migration so the database reflects what the code enforces, and the backend
 * guards resolve permissions from here. Participant actions (my registration,
 * my pass) are ownership-based and are not modelled as permissions.
 */

export const PERMISSIONS = {
  "event.read_admin": "View administrative event configuration",
  "event.configure": "Change event details, categories, fees, capacity and dates",
  "announcement.manage": "Publish public announcements and Facebook broadcast links",
  "membership.read": "View member records and verification requests",
  "membership.review": "Approve or reject membership verification requests",
  "membership.import": "Validate and apply membership data imports",
  "membership.correct": "Correct conflicting member records (audited)",
  "registration.read": "View registrations",
  "registration.manage": "Cancel, suspend or reinstate registrations (audited)",
  "payment.read": "View payment orders, transactions and webhook events",
  "payment.reconcile": "Trigger provider re-verification of uncertain payments",
  "payment.refund": "Request refunds",
  "credential.read": "View accreditation credentials (never raw tokens)",
  "credential.revoke": "Revoke accreditation credentials",
  "credential.reissue": "Reissue accreditation credentials",
  "scan.admit": "Scan credentials at an assigned gate",
  "scan.manual_lookup": "Look up a credential by accreditation ID at a gate",
  "scan.override": "Supervisor override of a scan decision (audited, any gate)",
  "gate.manage": "Create gates and assign staff to gates",
  "device.manage": "Register and deactivate scanner devices",
  "attendance.read": "View attendance reports",
  "incident.create": "Log security or operational incidents",
  "incident.manage": "Triage and resolve incidents",
  "streaming.manage": "Configure protected streaming sessions",
  "user.read": "View staff and participant accounts",
  "user.manage_roles": "Grant and revoke roles",
  "audit.read": "View the administrative audit log",
  "report.export": "Export restricted reports",
  "metrics.read": "View the operational overview",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLES = {
  participant: {
    name: "Participant",
    privileged: false,
    permissions: [] as Permission[],
  },
  membership_officer: {
    name: "Membership Verification Officer",
    privileged: true,
    permissions: [
      "membership.read",
      "membership.review",
      "membership.import",
      "membership.correct",
      "registration.read",
      "metrics.read",
    ],
  },
  finance_officer: {
    name: "Finance Officer",
    privileged: true,
    permissions: ["payment.read", "payment.reconcile", "payment.refund", "registration.read", "report.export", "metrics.read"],
  },
  accreditation_officer: {
    name: "Accreditation Officer",
    privileged: true,
    permissions: [
      "credential.read",
      "credential.revoke",
      "credential.reissue",
      "scan.admit",
      "scan.manual_lookup",
      "attendance.read",
      "registration.read",
      "incident.create",
    ],
  },
  gate_supervisor: {
    name: "Gate Supervisor",
    privileged: true,
    permissions: [
      "scan.admit",
      "scan.manual_lookup",
      "scan.override",
      "device.manage",
      "attendance.read",
      "credential.read",
      "incident.create",
      "incident.manage",
    ],
  },
  streaming_admin: {
    name: "Streaming Administrator",
    privileged: true,
    permissions: ["streaming.manage", "announcement.manage", "metrics.read"],
  },
  event_admin: {
    name: "Event Administrator",
    privileged: true,
    permissions: [
      "event.read_admin",
      "event.configure",
      "announcement.manage",
      "membership.read",
      "registration.read",
      "registration.manage",
      "payment.read",
      "credential.read",
      "gate.manage",
      "device.manage",
      "attendance.read",
      "incident.create",
      "incident.manage",
      "user.read",
      "report.export",
      "metrics.read",
    ],
  },
  auditor: {
    name: "Auditor / Oversight Committee",
    privileged: true,
    permissions: [
      "event.read_admin",
      "membership.read",
      "registration.read",
      "payment.read",
      "credential.read",
      "attendance.read",
      "user.read",
      "audit.read",
      "metrics.read",
    ],
  },
  super_admin: {
    name: "Super Administrator",
    privileged: true,
    permissions: Object.keys(PERMISSIONS) as Permission[],
  },
} as const satisfies Record<string, { name: string; privileged: boolean; permissions: Permission[] }>;

export type RoleKey = keyof typeof ROLES;

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

export function isRoleKey(value: string): value is RoleKey {
  return Object.hasOwn(ROLES, value);
}

export function permissionsForRoles(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) {
    if (!isRoleKey(role)) continue;
    for (const p of ROLES[role].permissions) out.add(p);
  }
  return out;
}

export function hasPrivilegedRole(roles: readonly string[]): boolean {
  return roles.some((r) => isRoleKey(r) && ROLES[r].privileged);
}
