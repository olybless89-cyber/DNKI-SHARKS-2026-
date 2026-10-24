"use client";

import { formatMoney } from "@dnki/shared";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, ErrorNote, Loading, PageTitle } from "@/components/ui";
import { type ApiError, api, useApi } from "@/lib/api";

type PublicEvent = {
  event: { name: string; registration: { open: boolean; reason: string | null } };
  categories: {
    id: string;
    name: string;
    description: string;
    fee_minor: string;
    currency: string;
    requires_identity_check: boolean;
  }[];
};

export default function Register() {
  const { data, error, loading } = useApi<PublicEvent>("/public/event");
  const [category, setCategory] = useState<string>("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const chosen = data.categories.find((c) => c.id === category);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const reg = await api<{ id: string }>("/registrations", { body: { categoryId: category, acceptTerms: accepted } });
      const checkout = await api<{ checkoutUrl: string }>(`/registrations/${reg.id}/checkout`, { method: "POST" });
      window.location.assign(checkout.checkoutUrl);
    } catch (e2) {
      setErr(e2 as ApiError);
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle title="Register" sub={data.event.name} />
      {!data.event.registration.open ? (
        <Alert tone="info" title={data.event.registration.reason ?? "Registration is closed."} />
      ) : (
        <form onSubmit={submit} className="max-w-2xl space-y-8">
          <ErrorNote error={err} />
          <fieldset>
            <legend className="font-display text-2xl font-semibold">Choose your registration category</legend>
            {data.categories.length === 0 && <p className="mt-3 text-slate">No categories are available yet.</p>}
            <div className="mt-4 space-y-3">
              {data.categories.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-start gap-4 border-2 border-line p-4 has-[:checked]:border-crimson has-[:checked]:bg-[#fdf0f2]"
                >
                  <input
                    type="radio"
                    name="category"
                    value={c.id}
                    checked={category === c.id}
                    onChange={() => setCategory(c.id)}
                    className="mt-1.5 size-5 accent-crimson"
                    required
                  />
                  <span className="flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-display text-2xl font-semibold">{c.name}</span>
                      <span className="display text-2xl">{formatMoney(c.fee_minor, c.currency)}</span>
                    </span>
                    {c.description && <span className="block text-slate">{c.description}</span>}
                    {c.requires_identity_check && (
                      <span className="block text-sm text-slate">Photo ID is checked at the gate.</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-3 border-t-2 border-ink pt-6">
            <h2 className="font-display text-2xl font-semibold">Review and confirm</h2>
            {chosen ? (
              <p>
                You will pay <strong>{formatMoney(chosen.fee_minor, chosen.currency)}</strong> through our payment provider's
                secure checkout. Your accreditation pass is issued only after the payment is verified.
              </p>
            ) : (
              <p className="text-slate">Choose a category to see the fee.</p>
            )}
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-1 size-5 accent-crimson"
                required
              />
              <span>
                I accept the{" "}
                <Link href="/terms" target="_blank" className="underline">
                  registration terms
                </Link>{" "}
                and understand my pass is personal and admits me once.
              </span>
            </label>
          </div>
          <Button type="submit" busy={busy} disabled={!category || !accepted}>
            Register and continue to payment
          </Button>
        </form>
      )}
    </>
  );
}
