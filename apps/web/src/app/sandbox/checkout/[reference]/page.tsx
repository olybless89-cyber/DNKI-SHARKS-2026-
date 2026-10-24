"use client";

import { formatMoney } from "@dnki/shared";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Loading } from "@/components/ui";
import { type ApiError, api, useApi } from "@/lib/api";

/**
 * SANDBOX CHECKOUT. Stands in for a payment provider's hosted checkout page while
 * no provider is configured. It moves no money and is unavailable when a real
 * provider is configured (the API route does not exist then).
 */
export default function SandboxCheckout() {
  const { reference } = useParams<{ reference: string }>();
  const router = useRouter();
  const { data, error, loading } = useApi<{
    amountMinor: string;
    currency: string;
    status: string;
    registrationReference: string;
  }>(`/sandbox/payments/${encodeURIComponent(reference)}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  async function complete(outcome: "success" | "failed") {
    setBusy(outcome);
    setErr(null);
    try {
      const r = await api<{ returnUrl: string }>(`/sandbox/payments/${encodeURIComponent(reference)}/complete`, {
        body: { outcome },
      });
      router.push(r.returnUrl);
    } catch (e) {
      setErr(e as ApiError);
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh bg-[repeating-linear-gradient(45deg,#fdf6e8_0_24px,#fbefd6_24px_48px)] px-4 py-10">
      <main id="main" className="mx-auto max-w-md border-4 border-dashed border-warn bg-paper p-6">
        <p className="font-display text-2xl font-bold text-warn">Sandbox checkout</p>
        <p className="mt-1 text-slate">This simulates a payment provider for testing. No card is charged and no money moves.</p>
        {loading && <Loading />}
        <ErrorNote error={error ?? err} />
        {data && (
          <div className="mt-6 space-y-6">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-slate">Registration</dt>
              <dd className="font-semibold">{data.registrationReference}</dd>
              <dt className="text-slate">Payment reference</dt>
              <dd>{reference}</dd>
              <dt className="text-slate">Amount</dt>
              <dd className="display text-3xl">{formatMoney(data.amountMinor, data.currency)}</dd>
            </dl>
            {data.status === "pending" ? (
              <div className="flex flex-col gap-3">
                <Button busy={busy === "success"} disabled={Boolean(busy)} onClick={() => complete("success")}>
                  Simulate successful payment
                </Button>
                <Button variant="secondary" busy={busy === "failed"} disabled={Boolean(busy)} onClick={() => complete("failed")}>
                  Simulate failed payment
                </Button>
              </div>
            ) : (
              <p>This sandbox payment is already {data.status}.</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
