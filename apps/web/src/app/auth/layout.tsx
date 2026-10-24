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
          <p className="display text-7xl uppercase">Sharks</p>
          <p className="font-display text-2xl font-semibold">International Convergence</p>
          <div className="mt-4 flex items-center gap-3">
            <span aria-hidden className="h-1 w-10 bg-crimson" />
            <p className="font-display text-lg tracking-[0.12em]">REBUILDING THE BROTHERHOOD</p>
          </div>
        </div>
        <p className="hidden text-sm text-paper/50 lg:block">Members-only accreditation portal</p>
      </aside>
      <main id="main" className="flex items-start justify-center px-4 py-10 sm:px-8 lg:items-center">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
