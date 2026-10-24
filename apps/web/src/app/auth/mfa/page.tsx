"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field } from "@/components/ui";
import { type ApiError, api } from "@/lib/api";

export default function MfaChallenge() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/mfa/challenge", { body: { code: new FormData(e.currentTarget).get("code") } });
      const me = await api<{ privileged: boolean }>("/auth/me");
      router.push(me.privileged ? "/admin" : "/portal");
    } catch (err) {
      setError(err as ApiError);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="display text-5xl">Two-step verification</h1>
      <p className="mt-3 text-slate">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <ErrorNote error={error} />
        <Field label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
        <Button type="submit" busy={busy} className="w-full">
          Verify
        </Button>
      </form>
    </>
  );
}
