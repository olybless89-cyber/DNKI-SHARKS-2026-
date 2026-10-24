"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { ApiError, api, type Me } from "@/lib/api";
import { cx, Loading, Wordmark } from "./ui";

const MeContext = createContext<Me | null>(null);
export const useMe = () => {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside AppShell");
  return me;
};

export type NavItem = { href: string; label: string; perm?: string };

/**
 * Client-side session gate for signed-in areas. This is a convenience only:
 * every API endpoint enforces authentication and permissions on the server.
 */
export function AppShell({
  nav,
  area,
  children,
  requireStaff = false,
}: {
  nav: NavItem[];
  area: string;
  children: ReactNode;
  requireStaff?: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    api<Me>("/auth/me")
      .then((m) => {
        if (m.mfa.pending) return router.replace("/auth/mfa");
        if (m.mfa.enrollmentRequired && !path.startsWith("/account/security")) return router.replace("/account/security?enrol=1");
        if (requireStaff && !m.privileged) return router.replace("/portal");
        setMe(m);
      })
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) router.replace(`/auth/login`);
      });
  }, [router, path, requireStaff]);

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/auth/login");
  }

  const items = me ? nav.filter((n) => !n.perm || me.permissions.includes(n.perm)) : [];

  return (
    <div className="min-h-dvh bg-paper">
      <header className="no-print sticky top-0 z-20 bg-ink text-paper">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href={area === "Admin" ? "/admin" : "/portal"}>
              <Wordmark invert />
            </Link>
            <span className="hidden border-l border-paper/30 pl-4 text-paper/70 sm:inline">{area}</span>
          </div>
          <div className="flex items-center gap-4">
            {me && <span className="hidden text-sm text-paper/70 md:inline">{me.user.fullName}</span>}
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              className="lg:hidden"
              aria-expanded={menu}
              aria-controls="side-nav"
            >
              Menu
            </button>
            <button type="button" onClick={signOut} className="text-sm font-semibold underline-offset-4 hover:underline">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-8 px-4 sm:px-6">
        {items.length > 1 && (
          <nav
            id="side-nav"
            aria-label={`${area} navigation`}
            className={cx("no-print w-56 shrink-0 py-8", menu ? "block" : "hidden lg:block")}
          >
            <ul className="space-y-1">
              {items.map((n) => {
                const active = n.href === path || (n.href !== "/admin" && n.href !== "/portal" && path.startsWith(n.href));
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      onClick={() => setMenu(false)}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "block border-l-4 px-3 py-2",
                        active ? "border-crimson bg-fog font-semibold" : "border-transparent hover:bg-fog",
                      )}
                    >
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        <main id="main" className="min-w-0 flex-1 py-8">
          {me ? <MeContext.Provider value={me}>{children}</MeContext.Provider> : <Loading label="Checking your session" />}
        </main>
      </div>
    </div>
  );
}
