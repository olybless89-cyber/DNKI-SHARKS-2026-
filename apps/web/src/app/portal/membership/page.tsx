"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, ErrorNote, Field, Loading, PageTitle, StatusPill, TextArea } from "@/components/ui";
import { type ApiError, api, useApi } from "@/lib/api";

type MembershipState = {
  provider: string;
  contactVerificationAvailable: boolean;
  verification: { id: string; status: string; method: string } | null;
  member: { membership_number: string; full_name: string; chapter: string; standing: string } | null;
};

export default function Membership() {
  const { data, error, loading, reload } = useApi<MembershipState>("/membership");
  const [pending, setPending] = useState<{ id: string; message: string } | null>(null);
  const [mode, setMode] = useState<"code" | "manual">("code");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;

  if (data.verification?.status === "approved" && data.member) {
    return (
      <>
        <PageTitle title="Membership" sub="Your membership is verified." />
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t-2 border-ink pt-3">
          <dt className="text-slate">Membership number</dt>
          <dd className="font-semibold">{data.member.membership_number}</dd>
          <dt className="text-slate">Name on record</dt>
          <dd>{data.member.full_name}</dd>
          <dt className="text-slate">Chapter</dt>
          <dd>{data.member.chapter || "—"}</dd>
          <dt className="text-slate">Standing</dt>
          <dd>
            <StatusPill status={data.member.standing} />
          </dd>
        </dl>
        <Link href="/portal" className="mt-8 inline-block font-semibold underline underline-offset-4">
          Continue to registration
        </Link>
      </>
    );
  }

  if (data.verification?.status === "pending_review") {
    return (
      <>
        <PageTitle title="Membership" />
        <Alert tone="warn" title="Your request is with a membership officer">
          We will email you when a decision has been made.
        </Alert>
      </>
    );
  }

  const codeAvailable = data.contactVerificationAvailable && mode === "code";

  return (
    <>
      <PageTitle
        title="Verify your membership"
        sub="We confirm your membership against DNKI's records before you can register."
      />
      <div className="max-w-xl space-y-6">
        <ErrorNote error={err} />
        {done && <Alert tone="success">{done}</Alert>}

        {codeAvailable && !pending && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const r = await api<{ verificationId: string; message: string }>("/membership/verify", {
                  body: { membershipNumber: f.get("membershipNumber"), contactOnRecord: f.get("contact") },
                });
                setPending({ id: r.verificationId, message: r.message });
              });
            }}
          >
            <Field
              label="Membership number"
              name="membershipNumber"
              required
              autoComplete="off"
              hint="As shown on your membership card."
            />
            <Field
              label="Email address held by your chapter"
              name="contact"
              type="email"
              required
              hint="We send a one-time code to this address only if it matches your membership record."
            />
            <Button type="submit" busy={busy}>
              Send verification code
            </Button>
          </form>
        )}

        {codeAvailable && pending && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              const code = new FormData(e.currentTarget).get("code");
              void run(async () => {
                const r = await api<{ status: string }>("/membership/verify/confirm", {
                  body: { verificationId: pending.id, code },
                });
                if (r.status === "approved") {
                  setDone("Your membership is verified.");
                  reload();
                } else {
                  setDone("Your details need a manual check. A membership officer will review them.");
                  reload();
                }
              });
            }}
          >
            <Alert tone="info">{pending.message}</Alert>
            <Field label="Verification code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
            <div className="flex flex-wrap gap-3">
              <Button type="submit" busy={busy}>
                Verify membership
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPending(null)}>
                Start again
              </Button>
            </div>
          </form>
        )}

        {(mode === "manual" || !data.contactVerificationAvailable) && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void run(async () => {
                await api("/membership/manual-review", {
                  body: { membershipNumber: f.get("membershipNumber"), note: f.get("note") },
                });
                reload();
              });
            }}
          >
            <h2 className="font-display text-2xl font-semibold">Ask a membership officer</h2>
            <p className="text-slate">An officer will check your details against DNKI's records. This can take a few days.</p>
            <Field label="Membership number" name="membershipNumber" required />
            <TextArea
              label="Details for the officer"
              name="note"
              rows={4}
              required
              minLength={10}
              hint="For example your chapter, when you joined, and why the code route did not work."
            />
            <Button type="submit" busy={busy}>
              Request review
            </Button>
          </form>
        )}

        {data.contactVerificationAvailable && (
          <p className="border-t-2 border-line pt-4">
            {mode === "code" ? (
              <button type="button" className="underline underline-offset-4" onClick={() => setMode("manual")}>
                No access to the email on record? Request a manual review instead.
              </button>
            ) : (
              <button type="button" className="underline underline-offset-4" onClick={() => setMode("code")}>
                Verify with a code instead
              </button>
            )}
          </p>
        )}
      </div>
    </>
  );
}
