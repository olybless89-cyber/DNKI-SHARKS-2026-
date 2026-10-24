import type { ReactNode } from "react";

/**
 * The accreditation pass. Used as the landing-page sample (watermarked) and as the
 * participant's real pass. The QR only ever contains an opaque token.
 */
export function PassBadge({
  name,
  category,
  accreditationId,
  chapter,
  qr,
  sample = false,
  status,
}: {
  name: string;
  category: string;
  accreditationId: string;
  chapter?: string;
  qr: ReactNode;
  sample?: boolean;
  status?: string;
}) {
  const inactive = status && status !== "active";
  return (
    <figure
      className="print-badge relative mx-auto w-full max-w-[340px] overflow-hidden rounded-lg bg-paper text-ink shadow-[0_30px_60px_-20px_rgba(0,0,0,0.55)]"
      aria-label={sample ? "Sample accreditation pass" : `Accreditation pass for ${name}`}
    >
      <div className="lanyard flex h-16 items-start justify-center pt-3">
        <span aria-hidden className="h-5 w-16 rounded-full bg-paper/90 shadow-inner" />
      </div>
      <div className="bg-ink px-6 pt-5 pb-4 text-paper">
        <p className="display text-[2.75rem]">SHARKS</p>
        <p className="font-display text-lg font-medium tracking-wide text-paper/80">International Convergence</p>
      </div>
      <div className="relative px-6 pt-5 pb-6">
        <p className="display text-3xl break-words">{name}</p>
        {chapter ? <p className="text-slate">{chapter}</p> : null}
        <p className="mt-3 inline-block bg-crimson px-2 py-0.5 font-display text-lg font-semibold text-paper">{category}</p>
        <div className={inactive ? "mt-5 opacity-20" : "mt-5"}>{qr}</div>
        <p className="mt-3 text-center font-display text-xl font-semibold tracking-[0.08em]">{accreditationId}</p>
        <p className="mt-1 text-center text-xs text-slate">Rebuilding the Brotherhood</p>
        {inactive ? (
          <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 rotate-[-8deg] border-4 border-crimson bg-paper/90 py-2 text-center display text-3xl text-crimson">
            {status?.toUpperCase()} — NOT VALID
          </p>
        ) : null}
        {sample ? (
          <p
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center display text-[5.5rem] text-crimson/15 rotate-[-24deg] select-none"
          >
            SAMPLE
          </p>
        ) : null}
      </div>
    </figure>
  );
}

/** Decorative stand-in for a QR on the sample pass. Not a scannable code. */
export function SampleQr() {
  const cells = Array.from({ length: 21 * 21 }, (_, i) => {
    const x = i % 21;
    const y = Math.floor(i / 21);
    const finder = (fx: number, fy: number) =>
      x >= fx &&
      x < fx + 7 &&
      y >= fy &&
      y < fy + 7 &&
      !(x > fx && x < fx + 6 && y > fy && y < fy + 6 && !(x > fx + 1 && x < fx + 5 && y > fy + 1 && y < fy + 5));
    if (finder(0, 0) || finder(14, 0) || finder(0, 14)) return true;
    return (x * 7 + y * 13 + x * y) % 5 < 2;
  });
  return (
    <svg
      viewBox="0 0 21 21"
      className="mx-auto block size-44"
      role="img"
      aria-label="Sample code (not scannable)"
      shapeRendering="crispEdges"
    >
      {cells
        .flatMap((on, i) => (on ? [{ id: `c${i % 21}-${Math.floor(i / 21)}`, x: i % 21, y: Math.floor(i / 21) }] : []))
        .map((c) => (
          <rect key={c.id} x={c.x} y={c.y} width="1" height="1" fill="#000" />
        ))}
    </svg>
  );
}
