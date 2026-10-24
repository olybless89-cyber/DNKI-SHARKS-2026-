import { formatMoney } from "@dnki/shared";
import Image from "next/image";
import Link from "next/link";
import { PassBadge, SampleQr } from "@/components/pass-badge";
import { LinkButton, Wordmark } from "@/components/ui";
import { getPublicEvent } from "@/lib/server-api";

// Rendered per request (with a 30 s data cache) so a build without a reachable API never caches a fallback page.
export const dynamic = "force-dynamic";

/** "Thursday 10th – Sunday 13th December 2026" style date range in the event's timezone. */
function dateRange(start: string | null, end: string | null, tz: string): string | null {
  if (!start) return null;
  const parts = (d: string) => {
    const f = new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: tz,
    }).formatToParts(new Date(d));
    const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
    return { weekday: get("weekday"), day: get("day"), month: get("month"), year: get("year") };
  };
  const a = parts(start);
  if (!end) return `${a.weekday} ${a.day} ${a.month} ${a.year}`;
  const b = parts(end);
  return a.month === b.month && a.year === b.year
    ? `${a.weekday} ${a.day} – ${b.weekday} ${b.day} ${b.month} ${b.year}`
    : `${a.weekday} ${a.day} ${a.month} – ${b.weekday} ${b.day} ${b.month} ${b.year}`;
}

const fmtTime = (v: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(v));

const STEPS = [
  {
    title: "Verify your membership",
    body: "Create an account and confirm your DNKI membership. We send a code to the contact your chapter holds on record, or an officer reviews your request.",
  },
  {
    title: "Register as a delegate",
    body: "Give your Norish and Norsical names, patrol, designation and meal choices, upload a passport photo, and accept the conduct rules.",
  },
  {
    title: "Pay securely",
    body: "Pay through our payment provider's hosted checkout. Your registration is confirmed only after we verify the payment with the provider.",
  },
  {
    title: "Receive your pass",
    body: "Your digital pass and QR code appear in your dashboard and arrive by email. It admits you once; gate staff check your photo.",
  },
];

export default async function Home() {
  const data = await getPublicEvent();
  const ev = data?.event;
  const tz = ev?.timezone ?? "Africa/Lagos";
  const when = dateRange(ev?.startsAt ?? null, ev?.endsAt ?? null, tz);
  const tickerText = [
    ev?.edition ?? "The 18th DNKI Converge",
    ev?.theme ?? "Rebuilding the Brotherhood, Empowering Our Future",
    when,
  ]
    .filter(Boolean)
    .join(" — ")
    .toUpperCase();

  return (
    <>
      <header className="bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="DNKI Converge 2026 home" className="flex items-center gap-3">
            <Wordmark invert />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-5 text-[0.95rem]">
            <a href="#how" className="hidden hover:underline sm:inline">
              How it works
            </a>
            <a href="#programme" className="hidden hover:underline sm:inline">
              Programme
            </a>
            <a href="#contacts" className="hidden hover:underline md:inline">
              Contacts
            </a>
            <Link href="/auth/login" className="font-semibold hover:underline">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <div className="overflow-hidden border-y-2 border-crimson bg-paper py-1.5" aria-label={tickerText}>
        <div className="ticker font-display text-sm font-bold tracking-[0.12em] text-crimson" aria-hidden>
          {[0, 1].map((i) => (
            <span key={i} className="px-8 whitespace-nowrap">
              {tickerText} &nbsp;•&nbsp; {tickerText} &nbsp;•&nbsp;
            </span>
          ))}
        </div>
      </div>

      <main id="main">
        <section className="relative overflow-hidden bg-ink text-paper">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-20 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:pt-16">
            <div>
              <p className="font-display text-xl font-semibold tracking-wide text-paper/80">
                {ev?.edition ?? "The 18th DNKI Converge"}
              </p>
              <h1 className="display glow mt-3 text-[clamp(3.5rem,11vw,8rem)] uppercase">Sharks 2026</h1>
              <p className="display mt-1 text-[clamp(1.8rem,5vw,3.25rem)] font-semibold">International Converge</p>
              <p className="mt-2 font-display text-xl tracking-wide text-paper/80">Delegates Accreditation Portal</p>
              <div className="mt-6 flex items-start gap-3">
                <span aria-hidden className="mt-3 h-1 w-8 shrink-0 bg-crimson sm:w-12" />
                <p className="font-display text-xl font-semibold tracking-[0.06em] uppercase sm:text-2xl">
                  {ev?.theme ?? "Rebuilding the Brotherhood, Empowering Our Future"}
                </p>
              </div>
              <dl className="mt-8 space-y-1 text-lg">
                <div>
                  <dt className="sr-only">When</dt>
                  <dd className="font-semibold">{when ?? "Dates will be announced by DNKI."}</dd>
                </div>
                <div>
                  <dt className="sr-only">Where</dt>
                  <dd className="text-paper/80">{ev?.venue ?? "Venue details will be shared with registered delegates."}</dd>
                </div>
              </dl>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                {ev?.registration.open ? (
                  <LinkButton href="/auth/signup">Register here</LinkButton>
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
                Registration is open only to verified members of De Norsemen Kclub International and requires payment.
              </p>
            </div>
            <div className="mx-auto w-full max-w-[420px]">
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-full border-[10px] border-crimson bg-paper shadow-[0_0_60px_rgb(200_16_46/0.35)]">
                <Image
                  src="/brand/sharks-2026-emblem.webp"
                  alt="SHARKS 2026 emblem: De Norsemen Kclub International, Rebuilding the Brotherhood, Empowering our Future, 10th–13th December 2026"
                  width={260}
                  height={281}
                  className="h-auto w-[72%]"
                  priority
                />
              </div>
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
          <div className="grid gap-12 lg:grid-cols-[1fr_340px]">
            <div>
              <h2 className="display text-5xl">How accreditation works</h2>
              <ol className="mt-10 grid gap-x-10 gap-y-12 md:grid-cols-2">
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
            </div>
            <aside aria-label="Sample delegate pass" className="lg:pt-4">
              <PassBadge
                name="Your Norish Name"
                category="Delegate"
                accreditationId="DNKI-XXXXX-XXXXX"
                chapter="Your patrol"
                qr={<SampleQr />}
                sample
              />
            </aside>
          </div>
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
                <p>
                  Every delegate must agree to the rule prohibiting the use of hard drugs and other obnoxious substances at
                  Norsical activities, and to face the consequences of violating it.
                </p>
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
                  <p className="text-sm text-slate">{fmtTime(p.starts_at, tz)}</p>
                  <p className="font-display text-2xl font-semibold">{p.title}</p>
                  {p.location && <p className="text-slate">{p.location}</p>}
                  {p.description && <p className="measure mt-1">{p.description}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-6 text-slate">The approved programme for {when ?? "the Converge"} will be published here.</p>
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

        <section id="contacts" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <h2 className="display text-5xl">For more information</h2>
              <ul className="mt-6 space-y-5">
                {(ev?.contacts ?? []).map((c) => (
                  <li key={`${c.role}${c.name}`} className="border-l-4 border-crimson pl-4">
                    <p className="text-sm font-semibold text-slate">{c.role}</p>
                    <p className="font-display text-2xl font-semibold">{c.name}</p>
                    {c.phone && (
                      <a
                        href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                        className="text-lg font-semibold text-crimson underline-offset-4 hover:underline"
                      >
                        {c.phone}
                      </a>
                    )}
                  </li>
                ))}
                {!ev?.contacts?.length && <li className="text-slate">Accreditation contacts will be published here.</li>}
                {ev?.support.email && (
                  <li className="border-l-4 border-ink pl-4">
                    <p className="text-sm font-semibold text-slate">Email</p>
                    <a href={`mailto:${ev.support.email}`} className="text-lg underline">
                      {ev.support.email}
                    </a>
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h2 className="display text-5xl">Questions</h2>
              <div className="mt-6 divide-y-2 divide-line border-y-2 border-line">
                {(ev?.faqs ?? []).map((f) => (
                  <details key={f.q} className="group py-4">
                    <summary className="cursor-pointer list-none font-display text-xl font-semibold marker:hidden">
                      <span className="mr-3 inline-block w-4 text-crimson transition-transform group-open:rotate-45" aria-hidden>
                        +
                      </span>
                      {f.q}
                    </summary>
                    <p className="mt-2 pl-7">{f.a}</p>
                  </details>
                ))}
                {!ev?.faqs?.length && <p className="py-4 text-slate">Questions and answers will be published here.</p>}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t-4 border-crimson bg-ink text-paper">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
          <div>
            <Wordmark invert />
            <p className="mt-3 text-sm text-paper/60">De Norsemen Kclub International · RC 7458 · Service to Humanity</p>
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold">Accreditation</h2>
            <p className="mt-2 text-sm text-paper/70">
              Official delegates accreditation portal for SHARKS 2026 International Converge.
            </p>
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
            <p className="mt-4 text-sm text-paper/50">© DNKI Converge 2026. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
