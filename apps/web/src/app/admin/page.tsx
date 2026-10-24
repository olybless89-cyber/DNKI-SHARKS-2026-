"use client";

import Link from "next/link";
import { useMe } from "@/components/app-shell";
import { Alert, ErrorNote, Loading, PageTitle, SandboxFlag } from "@/components/ui";
import { fmtDate, useApi } from "@/lib/api";

type Overview = {
  metrics: Record<string, number>;
  attendanceByGate: { name: string; admitted: number }[];
  environment: {
    demoMode: boolean;
    appEnv: string;
    paymentProvider: string;
    paymentSandbox: boolean;
    membershipProvider: string;
    streaming: string;
  };
  generatedAt: string;
};

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Membership",
    items: [
      ["eligible_members", "Members in good standing"],
      ["verified_members", "Accounts verified"],
      ["pending_verifications", "Awaiting officer review"],
    ],
  },
  {
    title: "Registration and payment",
    items: [
      ["total_registrations", "Registrations"],
      ["paid_registrations", "Paid"],
      ["awaiting_payment", "Awaiting payment"],
      ["pending_payments", "Payments pending"],
      ["failed_payments", "Payments failed"],
      ["payments_needing_review", "Payments needing review"],
    ],
  },
  {
    title: "Accreditation and venue",
    items: [
      ["active_credentials", "Active passes"],
      ["revoked_credentials", "Revoked passes"],
      ["checked_in", "Checked in"],
      ["suspicious_scans", "Refused or duplicate scans"],
      ["open_incidents", "Open incidents"],
      ["failed_notifications", "Undelivered emails"],
    ],
  },
];

export default function AdminHome() {
  const me = useMe();
  const canMetrics = me.permissions.includes("metrics.read");
  const { data, error, loading } = useApi<Overview>(canMetrics ? "/admin/overview" : null);

  if (!canMetrics) {
    return (
      <>
        <PageTitle title="Operations" sub={`Signed in as ${me.user.fullName}`} />
        {me.permissions.includes("scan.admit") && (
          <Link href="/scanner" className="inline-block bg-crimson px-6 py-4 font-display text-2xl font-semibold text-paper">
            Open gate scanner
          </Link>
        )}
      </>
    );
  }
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const m = data.metrics;
  const maxGate = Math.max(1, ...data.attendanceByGate.map((g) => g.admitted));

  return (
    <>
      <PageTitle title="Overview" sub={`Live figures from the platform, generated ${fmtDate(data.generatedAt)}`} />
      {data.environment.demoMode && (
        <div className="mb-6 space-y-2">
          <SandboxFlag>Demo mode — figures include synthetic records</SandboxFlag>
          {(m.synthetic_members ?? 0) > 0 && (
            <p className="text-sm text-slate">{m.synthetic_members} synthetic member records are loaded.</p>
          )}
        </div>
      )}
      {(m.payments_needing_review ?? 0) > 0 && (
        <div className="mb-6">
          <Alert tone="warn" title={`${m.payments_needing_review} payment(s) need finance review`}>
            Amount mismatches, duplicate payments or payments for cancelled registrations.{" "}
            <Link href="/admin/payments" className="underline">
              Review payments
            </Link>
          </Alert>
        </div>
      )}
      <div className="space-y-10">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="font-display text-2xl font-semibold">{g.title}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-px border-2 border-ink bg-ink sm:grid-cols-3">
              {g.items.map(([k, label]) => (
                <div key={k} className="bg-paper p-4">
                  <dt className="text-sm text-slate">{label}</dt>
                  <dd className="display mt-1 text-4xl">{(m[k] ?? 0).toLocaleString("en-GB")}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section>
          <h2 className="font-display text-2xl font-semibold">Admissions by gate</h2>
          {data.attendanceByGate.length ? (
            <ul className="mt-3 space-y-2">
              {data.attendanceByGate.map((g) => (
                <li key={g.name} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3">
                  <span className="truncate">{g.name}</span>
                  <span className="h-4 bg-fog">
                    <span className="block h-4 bg-ink" style={{ width: `${(g.admitted / maxGate) * 100}%` }} />
                  </span>
                  <span className="text-right font-semibold">{g.admitted}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-slate">No gates configured yet.</p>
          )}
        </section>
        <section>
          <h2 className="font-display text-2xl font-semibold">Integrations</h2>
          <dl className="mt-3 grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-slate">Membership source</dt>
            <dd>{data.environment.membershipProvider}</dd>
            <dt className="text-slate">Payment provider</dt>
            <dd>
              {data.environment.paymentProvider}
              {data.environment.paymentSandbox ? " (sandbox)" : ""}
            </dd>
            <dt className="text-slate">Protected streaming</dt>
            <dd>Not configured (Phase 5)</dd>
          </dl>
        </section>
      </div>
    </>
  );
}
