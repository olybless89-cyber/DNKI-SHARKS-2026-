import { AppShell } from "@/components/app-shell";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/event", label: "Event settings", perm: "event.read_admin" },
  { href: "/admin/membership", label: "Membership", perm: "membership.read" },
  { href: "/admin/registrations", label: "Registrations", perm: "registration.read" },
  { href: "/admin/payments", label: "Payments", perm: "payment.read" },
  { href: "/admin/credentials", label: "Credentials", perm: "credential.read" },
  { href: "/admin/gates", label: "Gates & scanners", perm: "attendance.read" },
  { href: "/admin/attendance", label: "Attendance", perm: "attendance.read" },
  { href: "/admin/incidents", label: "Incidents", perm: "incident.manage" },
  { href: "/admin/content", label: "Public content", perm: "announcement.manage" },
  { href: "/admin/users", label: "Users & roles", perm: "user.read" },
  { href: "/admin/audit", label: "Audit log", perm: "audit.read" },
  { href: "/scanner", label: "Open gate scanner", perm: "scan.admit" },
  { href: "/account/security", label: "Account security" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell nav={NAV} area="Admin" requireStaff>
      {children}
    </AppShell>
  );
}
