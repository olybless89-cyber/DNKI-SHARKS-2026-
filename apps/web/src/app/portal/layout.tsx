import { AppShell } from "@/components/app-shell";

const NAV = [
  { href: "/portal", label: "My registration" },
  { href: "/portal/membership", label: "Membership" },
  { href: "/portal/pass", label: "My pass" },
  { href: "/account/security", label: "Account security" },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell nav={NAV} area="Member portal">
      {children}
    </AppShell>
  );
}
