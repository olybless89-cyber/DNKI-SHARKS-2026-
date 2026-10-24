import Image from "next/image";
import Link from "next/link";
import { Wordmark } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="flex flex-col justify-between bg-ink p-6 text-paper sm:p-10">
        <Link href="/" aria-label="Back to the event page">
          <Wordmark invert />
        </Link>
        <div className="hidden lg:block">
          <Image
            src="/brand/sharks-2026-emblem.webp"
            alt="SHARKS 2026 emblem"
            width={260}
            height={281}
            className="mb-8 size-56 rounded-full border-8 border-crimson bg-paper object-contain p-6"
          />
          <p className="display glow text-7xl uppercase">Sharks 2026</p>
          <p className="font-display text-2xl font-semibold">International Converge</p>
          <div className="mt-4 flex items-start gap-3">
            <span aria-hidden className="mt-2.5 h-1 w-10 shrink-0 bg-crimson" />
            <p className="font-display text-lg tracking-[0.08em]">REBUILDING THE BROTHERHOOD, EMPOWERING OUR FUTURE</p>
          </div>
        </div>
        <p className="hidden text-sm text-paper/50 lg:block">Delegates accreditation portal · De Norsemen Kclub International</p>
      </aside>
      <main id="main" className="flex items-start justify-center px-4 py-10 sm:px-8 lg:items-center">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
