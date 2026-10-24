"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert, LinkButton, Loading, PageTitle, SandboxFlag } from "@/components/ui";
import { type ApiError, api } from "@/lib/api";

type Status = { reference: string; status: string; registrationStatus: string; sandbox: boolean };

function Checker() {
  const reference = useSearchParams().get("reference") ?? "";
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!/^PAY-[0-9A-Z]{12}$/.test(reference)) return;
    let stop = false;
    let n = 0;
    const tick = async () => {
      try {
        const r = await api<Status>(`/payments/orders/${reference}/status`);
        if (stop) return;
        setS(r);
        n++;
        setTries(n);
        if (["initiated", "pending"].includes(r.status) && n < 20) setTimeout(tick, 3000);
      } catch (e) {
        setErr(e as ApiError);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [reference]);

  if (!/^PAY-[0-9A-Z]{12}$/.test(reference)) return <Alert tone="error" title="This payment link is not valid." />;
  if (err) return <Alert tone="error" title={err.message} />;
  if (!s) return <Loading label="Confirming your payment with the provider" />;

  return (
    <div className="max-w-xl space-y-5">
      {s.sandbox && <SandboxFlag />}
      {s.registrationStatus === "accredited" ? (
        <>
          <Alert tone="success" title="Payment verified — you are accredited">
            Your receipt and digital invitation have been emailed to you.
          </Alert>
          <LinkButton href="/portal/pass">View my pass</LinkButton>
        </>
      ) : s.status === "succeeded" ? (
        <Alert tone="warn" title="Payment verified — accreditation pending">
          Your payment is confirmed. The accreditation desk is completing a membership check.
        </Alert>
      ) : ["initiated", "pending"].includes(s.status) ? (
        tries >= 20 ? (
          <Alert tone="warn" title="We have not received confirmation yet">
            If you completed payment, it will be confirmed automatically within a few minutes. You do not need to pay again.
          </Alert>
        ) : (
          <Loading label="Waiting for the payment provider to confirm" />
        )
      ) : s.status === "needs_review" ? (
        <Alert tone="warn" title="Your payment needs a manual check">
          Our finance team will review it. Please do not pay again. Quote reference {s.reference} if you contact support.
        </Alert>
      ) : (
        <Alert tone="error" title="Payment was not completed">
          No money has been taken for this attempt. You can try again from your dashboard.
        </Alert>
      )}
      <p className="text-sm text-slate">Payment reference: {s.reference}</p>
      <Link href="/portal" className="inline-block underline underline-offset-4">
        Back to my registration
      </Link>
    </div>
  );
}

export default function PaymentReturn() {
  return (
    <>
      <PageTitle title="Payment status" sub="We confirm every payment directly with the payment provider." />
      <Suspense>
        <Checker />
      </Suspense>
    </>
  );
}
