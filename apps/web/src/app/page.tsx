import { formatMoney } from "@dnki/shared";
import Link from "next/link";
import { PassBadge, SampleQr } from "@/components/pass-badge";
import { LinkButton, Wordmark } from "@/components/ui";
import { getPublicEvent } from "@/lib/server-api";

// Rendered per request (with a 30 s data cache) so a build without a reachable API never caches a fallback page.
export const dynamic = "force-dynamic";

const fmt = (v: string | null, tz: string) =>
  v ? new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(v)) : null;

const STEPS = [
  {
    title: "Verify your membership",
    body: "Create an account and confirm your DNKI membership. We send a code to the contact your chapter holds on record, or an officer reviews your request.",
  },
  {
    title: "Register",
    body: "Choose your registration category and accept the terms. Each verified member can hold one registration.",
  },
  {
    title: "Pay securely",
    body: "Pay through our payment provider's hosted checkout. Your registration is confirmed only after we verify the payment with the provider.",
  },
  {
    title: "Receive your pass",
    body: "Your digital pass and QR code appear in your dashboard and arrive by email. It admits you once; gate staff may confirm your identity.",
  },
];

export default async function Home() {
  const data = await getPublicEvent();
  const ev = data?.event;
  const tz = ev?.timezone ?? "Africa/Lagos";
  const when = fmt(ev?.startsAt ?? null, tz);

  return (
    <>
      <header className="bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" aria-label="DNKI SHARKS home">
            <Wordmark invert />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-5 text-[0.95rem]">
            <a href="#how" className="hidden hover:underline sm:inline">
              How it works
            </a>
            <a href="#programme" className="hidden hover:underline sm:inline">
              Programme
            </a>
            <a href="#faq" className="hidden hover:underline md:inline">
              Questions
            </a>
            <Link href="/auth/login" className="font-semibold hover:underline">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="relative overflow-hidden bg-ink text-paper">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[1.25fr_1fr] lg:pt-16">
            <div className="flex flex-col justify-center">
              <p className="text-paper/70">De Norsemen Kclub International</p>
              <h1 className="display mt-3 text-[clamp(3.5rem,11vw,8.5rem)] uppercase">
                Sharks
                <span className="block text-[0.52em] leading-[0.95] font-semibold tracking-normal normal-case">
                  International Convergence
                </span>
              </h1>
              <div className="mt-6 flex items-center gap-3">
                <span aria-hidden className="h-1 w-8 shrink-0 bg-crimson sm:w-12" />
                <p className="font-display text-xl font-semibold tracking-[0.06em] sm:text-2xl sm:tracking-[0.12em]">
                  {ev?.theme ?? "REBUILDING THE BROTHERHOOD"}
                </p>
              </div>
              <dl className="mt-8 grid gap-1 text-paper/85">
                <div className="flex gap-2">
                  <dt className="sr-only">When</dt>
                  <dd>{when ?? "Dates will be announced by DNKI."}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="sr-only">Where</dt>
                  <dd>{ev?.venue ?? "Venue will be announced by DNKI."}</dd>
                </div>
              </dl>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                {ev?.registration.open ? (
                  <LinkButton href="/auth/signup">Register as a member</LinkButton>
                ) : (
                  <p className="border-l-4 border-crimson pl-3 text-paper/90">
                    {ev?.registration.reason ?? "Registration is not open yet."}
                  </p>
                )}
                <Link href="/auth/login" className="underline-offset-4 hover:underline">
                  I already have an account
                </Link>
              </div>
              <p className="mt-6 max-w-md text-sm text-paper/60">
                Registration is open only to verified members of DNKI and requires payment.
              </p>
            </div>
            <div className="lg:rotate-[3deg] lg:pt-4">
              <PassBadge
                name="Your Name"
                category="Delegate"
                accreditationId="DNKI-XXXXX-XXXXX"
                chapter="Your chapter"
                qr={<SampleQr />}
                sample
              />
            </div>
          </div>
        </section>

        {!data && (
          <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
            <p className="border-l-4 border-warn bg-[#fdf6e8] px-4 py-3">
              Live event details are temporarily unavailable. Please check back shortly.
            </p>
          </div>
        )}

        <section id="how" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="display text-5xl">How accreditation works</h2>
          <ol className="mt-10 grid gap-x-10 gap-y-12 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-t-4 border-ink pt-4">
                <span className="display text-6xl text-crimson" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="mt-2 font-display text-2xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-slate">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-fog">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="display text-5xl">Who can register</h2>
              <div className="measure mt-6 space-y-4">
                <p>
                  Registration is limited to members of De Norsemen Kclub International in good standing. A name or membership
                  number alone is not accepted as proof of identity; we confirm membership against DNKI's records before you can
                  register.
                </p>
                <p>Each member may hold one registration. Your accreditation is personal and cannot be transferred.</p>
              </div>
            </div>
            <div>
              <h2 className="display text-5xl">Registration fees</h2>
              {data?.categories.length ? (
                <ul className="mt-6 divide-y-2 divide-ink border-y-2 border-ink">
                  {data.categories.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-4">
                      <div>
                        <p className="font-display text-2xl font-semibold">{c.name}</p>
                        {c.description && <p className="text-sm text-slate">{c.description}</p>}
                        {c.requires_identity_check && (
                          <p className="text-sm text-slate">Photo ID is checked at the gate for this category.</p>
                        )}
                      </div>
                      <p className="display text-3xl">{formatMoney(c.fee_minor, c.currency)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-6 text-slate">Fees will be published by DNKI when registration opens.</p>
              )}
            </div>
          </div>
        </section>

        <section id="programme" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="display text-5xl">Programme</h2>
          {data?.programme.length ? (
            <ol className="mt-8 border-l-4 border-ink">
              {data.programme.map((p) => (
                <li key={p.id} className="relative py-4 pl-6">
                  <span aria-hidden className="absolute top-6 -left-[10px] size-4 bg-crimson" />
                  <p className="text-sm text-slate">{fmt(p.starts_at, tz)}</p>
                  <p className="font-display text-2xl font-semibold">{p.title}</p>
                  {p.location && <p className="text-slate">{p.location}</p>}
                  {p.description && <p className="measure mt-1">{p.description}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-6 text-slate">The approved programme will be published here.</p>
          )}
        </section>

        {data?.announcements.length ? (
          <section className="bg-ink text-paper">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
              <h2 className="display text-5xl">Announcements</h2>
              <p className="mt-2 text-paper/70">
                Public updates and broadcasts. Members-only sessions are never streamed publicly.
              </p>
              <ul className="mt-8 grid gap-6 md:grid-cols-2">
                {data.announcements.map((a) => (
                  <li key={a.id} className="border-2 border-paper/25 p-5">
                    <p className="text-sm">
                      <span className="mr-2 inline-block border border-paper/60 px-1.5 font-semibold">Public</span>
                      {a.kind === "facebook_broadcast" ? "Facebook broadcast" : a.kind === "link" ? "Link" : "Announcement"}
                    </p>
                    <h3 className="mt-2 font-display text-2xl font-semibold">{a.title}</h3>
                    {a.body && <p className="mt-2 whitespace-pre-line text-paper/85">{a.body}</p>}
                    {a.url && (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="mt-3 inline-block font-semibold underline underline-offset-4"
                      >
                        {a.kind === "facebook_broadcast" ? "Watch on Facebook" : "Open link"}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section id="faq" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="display text-5xl">Questions</h2>
          <div className="measure mt-8 divide-y-2 divide-line border-y-2 border-line">
            {(ev?.faqs ?? []).map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="cursor-pointer list-none font-display text-2xl font-semibold marker:hidden">
                  <span className="mr-3 inline-block w-4 text-crimson group-open:rotate-45 transition-transform" aria-hidden>
                    +
                  </span>
                  {f.q}
                </summary>
                <p className="mt-2 pl-7">{f.a}</p>
              </details>
            ))}
            {!ev?.faqs.length && <p className="py-4 text-slate">Questions and answers will be published here.</p>}
          </div>
        </section>
      </main>

      <footer className="border-t-4 border-crimson bg-ink text-paper">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
          <div>
            <Wordmark invert />
            <p className="mt-3 text-sm text-paper/60">Official accreditation portal for the SHARKS International Convergence.</p>
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold">Support</h2>
            <p className="mt-2 text-paper/80">
              {ev?.support.email ? (
                <a href={`mailto:${ev.support.email}`} className="underline">
                  {ev.support.email}
                </a>
              ) : (
                "Support contact to be announced."
              )}
            </p>
            {ev?.support.phone && <p className="text-paper/80">{ev.support.phone}</p>}
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold">Legal</h2>
            <p className="mt-2 flex gap-4">
              <Link href="/privacy" className="underline">
                Privacy notice
              </Link>
              <Link href="/terms" className="underline">
                Terms
              </Link>
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
