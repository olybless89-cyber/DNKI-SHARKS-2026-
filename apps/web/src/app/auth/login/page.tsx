"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorNote, Field } from "@/components/ui";
import { type ApiError, api } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ mfaRequired: boolean; mfaEnrollmentRequired: boolean }>("/auth/login", {
        body: { email: f.get("email"), password: f.get("password") },
      });
      if (r.mfaRequired) router.push("/auth/mfa");
      else if (r.mfaEnrollmentRequired) router.push("/account/security?enrol=1");
      else {
        const me = await api<{ privileged: boolean }>("/auth/me");
        router.push(me.privileged ? "/admin" : "/portal");
      }
    } catch (err) {
      setError(err as ApiError);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="display text-5xl">Sign in</h1>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <ErrorNote error={error} />
        <Field label="Email address" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <Button type="submit" busy={busy} className="w-full">
          Sign in
        </Button>
      </form>
      <div className="mt-6 flex flex-wrap justify-between gap-3 text-[0.95rem]">
        <Link href="/auth/forgot" className="underline underline-offset-4">
          Forgot your password?
        </Link>
        <Link href="/auth/signup" className="underline underline-offset-4">
          Create an account
        </Link>
      </div>
    </>
  );
}
