"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Alert, Button, ErrorNote, Field } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError(new ApiError(400, "MISMATCH", "The passwords do not match."));
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password/reset", { body: { token, password: f.get("password") } });
      setDone(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Alert tone="error" title="This reset link is incomplete. Request a new one." />;
  if (done)
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Password changed">
          All other sessions were signed out.
        </Alert>
        <Link href="/auth/login" className="font-semibold underline">
          Sign in
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-5">
      <ErrorNote error={error} />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        hint="At least 12 characters."
      />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
      <Button type="submit" busy={busy} className="w-full">
        Change password
      </Button>
    </form>
  );
}

export default function Reset() {
  return (
    <>
      <h1 className="display mb-8 text-5xl">Choose a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
