"use client";

import { formatMoney, type ParticipantJourneyStage } from "@dnki/shared";
import Link from "next/link";
import { useState } from "react";
import { useMe } from "@/components/app-shell";
import { Alert, Button, ErrorNote, Field, LinkButton, Loading, PageTitle, SandboxFlag, StatusPill } from "@/components/ui";
import { type ApiError, api, fmtDate, useApi } from "@/lib/api";

type Summary = {
  stage: ParticipantJourneyStage;
  stageLabel: string;
  registrationWindow: { open: boolean; reason: string | null };
  registration: {
    id: string;
    reference: string;
    status: string;
    fee_minor: string;
    currency: string;
    category_name: string;
    created_at: string;
  } | null;
  payment: { reference: string; status: string; expires_at: string } | null;
  demoMode: boolean;
  paymentProvider: { name: string; sandbox: boolean };
};

const TRACK: { key: string; label: string; stages: ParticipantJourneyStage[] }[] = [
  { key: "email", label: "Email confirmed", stages: ["account_unverified"] },
  {
    key: "member",
    label: "Membership verified",
    stages: ["pending_membership_verification", "membership_under_review", "membership_rejected"],
  },
  { key: "register", label: "Registered", stages: ["eligible"] },
  { key: "pay", label: "Payment verified", stages: ["awaiting_payment"] },
  { key: "pass", label: "Pass issued", stages: ["paid"] },
];

function trackIndex(stage: ParticipantJourneyStage): number {
  const i = TRACK.findIndex((t) => t.stages.includes(stage));
  return i === -1 ? TRACK.length : i;
}

export default function Portal() {
  const me = useMe();
  const { data, error, loading, reload } = useApi<Summary>("/portal/summary");
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const current = trackIndex(data.stage);
  const terminal = ["cancelled", "refunded", "suspended", "revoked"].includes(data.stage);

  return (
    <>
      <PageTitle title={`Welcome, ${me.user.fullName.split(" ")[0]}`} sub={data.stageLabel} />
      {data.demoMode && (
        <div className="mb-6">
          <SandboxFlag>Demo environment — synthetic data and sandbox payments only</SandboxFlag>
        </div>
      )}

      {!terminal && (
        <ol aria-label="Registration progress" className="mb-10 grid grid-cols-5 gap-1">
          {TRACK.map((t, i) => (
            <li key={t.key} className="text-sm">
              <span
                aria-hidden
                className={i < current ? "block h-2 bg-ink" : i === current ? "block h-2 bg-crimson" : "block h-2 bg-line"}
              />
              <span className={i === current ? "mt-2 block font-semibold" : "mt-2 block text-slate"}>
                {t.label}
                <span className="sr-only">{i < current ? " (done)" : i === current ? " (current step)" : " (to do)"}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <section className="max-w-2xl">
        <NextStep s={data} email={me.user.email} reload={reload} />
      </section>

      {data.registration && (
        <section className="mt-12 max-w-2xl">
          <h2 className="font-display text-2xl font-semibold">Registration details</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t-2 border-ink pt-3">
            <dt className="text-slate">Reference</dt>
            <dd className="font-semibold">{data.registration.reference}</dd>
            <dt className="text-slate">Category</dt>
            <dd>{data.registration.category_name}</dd>
            <dt className="text-slate">Fee</dt>
            <dd>{formatMoney(data.registration.fee_minor, data.registration.currency)}</dd>
            <dt className="text-slate">Status</dt>
            <dd>
              <StatusPill status={data.registration.status} />
            </dd>
            <dt className="text-slate">Created</dt>
            <dd>{fmtDate(data.registration.created_at)}</dd>
          </dl>
        </section>
      )}
    </>
  );
}

function NextStep({ s, email, reload }: { s: Summary; email: string; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  switch (s.stage) {
    case "account_unverified":
      return (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const code = new FormData(e.currentTarget).get("code");
            void run(async () => {
              await api("/auth/email/verify", { body: { code } });
              reload();
            });
          }}
        >
          <h2 className="font-display text-3xl font-semibold">Confirm your email address</h2>
          <p>We sent a 6-digit code to {email}.</p>
          <ErrorNote error={error} />
          {note && <Alert tone="success">{note}</Alert>}
          <Field label="Verification code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" busy={busy}>
              Confirm email
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                run(async () => {
                  await api("/auth/email/resend", { method: "POST" });
                  setNote("A new code is on its way.");
                })
              }
            >
              Send a new code
            </Button>
          </div>
        </form>
      );
    case "pending_membership_verification":
    case "membership_rejected":
      return (
        <div className="space-y-4">
          <h2 className="font-display text-3xl font-semibold">Verify your DNKI membership</h2>
          {s.stage === "membership_rejected" && (
            <Alert tone="error" title="We could not verify your membership with the details provided." />
          )}
          <p>Only verified members in good standing can register for the Convergence.</p>
          <LinkButton href="/portal/membership">Verify membership</LinkButton>
        </div>
      );
    case "membership_under_review":
      return (
        <Alert tone="warn" title="Your membership is being reviewed">
          A membership officer is checking your details. We will email you when there is a decision.
        </Alert>
      );
    case "eligible":
      return s.registrationWindow.open ? (
        <div className="space-y-4">
          <h2 className="font-display text-3xl font-semibold">You are eligible to register</h2>
          <LinkButton href="/portal/register">Register now</LinkButton>
        </div>
      ) : (
        <Alert tone="info" title={s.registrationWindow.reason ?? "Registration is closed."} />
      );
    case "awaiting_payment":
      return (
        <div className="space-y-4">
          <h2 className="font-display text-3xl font-semibold">Complete your payment</h2>
          {s.paymentProvider.sandbox && <SandboxFlag />}
          <p>
            Your registration is reserved. Pay{" "}
            {s.registration ? formatMoney(s.registration.fee_minor, s.registration.currency) : "the fee"} to receive your
            accreditation pass. Your pass is issued once we have verified the payment with the provider.
          </p>
          {s.payment && s.payment.status === "failed" && (
            <Alert tone="error" title="Your last payment attempt did not go through. You can try again." />
          )}
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-3">
            <Button
              busy={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<{ checkoutUrl: string }>(`/registrations/${s.registration?.id}/checkout`, {
                    method: "POST",
                  });
                  window.location.assign(r.checkoutUrl);
                })
              }
            >
              Pay now
            </Button>
            {s.payment && ["pending", "initiated"].includes(s.payment.status) && (
              <Link
                href={`/portal/payment/return?reference=${s.payment.reference}`}
                className="self-center underline underline-offset-4"
              >
                I've already paid — check status
              </Link>
            )}
            <Button
              variant="ghost"
              onClick={() =>
                window.confirm("Cancel this registration? You can register again while registration is open.") &&
                run(async () => {
                  await api(`/registrations/${s.registration?.id}/cancel`, { method: "POST" });
                  reload();
                })
              }
            >
              Cancel registration
            </Button>
          </div>
        </div>
      );
    case "paid":
      return (
        <Alert tone="warn" title="Payment confirmed — accreditation pending">
          Your payment is verified. Your accreditation is awaiting a membership check by the accreditation desk.
        </Alert>
      );
    case "accredited":
      return (
        <div className="space-y-4">
          <h2 className="font-display text-3xl font-semibold">You are accredited</h2>
          <p>Your digital pass is ready. Keep it private: it admits you once.</p>
          <LinkButton href="/portal/pass">View my pass</LinkButton>
        </div>
      );
    default:
      return (
        <Alert tone="error" title={s.stageLabel}>
          Contact the accreditation support desk if you have questions about your registration.
        </Alert>
      );
  }
}
