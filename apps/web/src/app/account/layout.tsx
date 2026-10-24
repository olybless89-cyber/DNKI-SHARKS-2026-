import { AppShell } from "@/components/app-shell";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell nav={[{ href: "/account/security", label: "Account security" }]} area="Account">
      {children}
    </AppShell>
  );
}
