"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, ErrorNote, Field } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

export default function Signup() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) {
      setError(new ApiError(400, "MISMATCH", "The passwords do not match."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("/auth/signup", {
        body: {
          fullName: f.get("fullName"),
          email: f.get("email"),
          phone: (f.get("phone") as string) || undefined,
          password: f.get("password"),
        },
      });
      setDone(r.message);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <h1 className="display text-5xl">Check your email</h1>
        <div className="mt-6 space-y-4">
          <Alert tone="success">{done}</Alert>
          <p>Sign in with your new password. We will ask for the 6-digit code from the email to confirm your address.</p>
          <Link href="/auth/login" className="inline-block font-semibold underline underline-offset-4">
            Go to sign in
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="display text-5xl">Create your account</h1>
      <p className="mt-3 text-slate">
        Use the email address you can access during registration. You will verify your DNKI membership in the next step.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <ErrorNote error={error} />
        <Field label="Full name" name="fullName" autoComplete="name" required minLength={2} />
        <Field label="Email address" name="email" type="email" autoComplete="email" required />
        <Field
          label="Phone number (optional)"
          name="phone"
          type="tel"
          autoComplete="tel"
          hint="Include the country code, e.g. +234…"
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          hint="At least 12 characters. A short phrase works well."
        />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
        <Button type="submit" busy={busy} className="w-full">
          Create account
        </Button>
        <p className="text-sm text-slate">
          By creating an account you acknowledge the{" "}
          <Link href="/privacy" className="underline">
            privacy notice
          </Link>
          .
        </p>
      </form>
    </>
  );
}
