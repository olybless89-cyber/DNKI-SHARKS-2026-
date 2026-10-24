import Link from "next/link";
import { Wordmark } from "@/components/ui";
import { getLegal } from "@/lib/server-api";

export async function LegalPage({ which, title }: { which: "privacyNotice" | "terms"; title: string }) {
  const legal = await getLegal();
  const text = legal?.[which];
  return (
    <>
      <header className="bg-ink px-4 py-4 sm:px-6">
        <Link href="/">
          <Wordmark invert />
        </Link>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="display text-5xl">{title}</h1>
        {text ? (
          <div className="measure mt-8 whitespace-pre-line">{text}</div>
        ) : (
          <p className="mt-8 text-slate">
            This document has not been published yet. It will be provided by DNKI before registration opens.
          </p>
        )}
      </main>
    </>
  );
}
