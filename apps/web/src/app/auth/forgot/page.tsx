"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, ErrorNote, Field } from "@/components/ui";
import { type ApiError, api } from "@/lib/api";

export default function Forgot() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("/auth/password/forgot", {
        body: { email: new FormData(e.currentTarget).get("email") },
      });
      setSent(r.message);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="display text-5xl">Reset your password</h1>
      {sent ? (
        <div className="mt-6">
          <Alert tone="success">{sent}</Alert>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-5">
          <ErrorNote error={error} />
          <Field label="Email address" name="email" type="email" autoComplete="email" required />
          <Button type="submit" busy={busy} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
      <Link href="/auth/login" className="mt-6 inline-block underline underline-offset-4">
        Back to sign in
      </Link>
    </>
  );
}
