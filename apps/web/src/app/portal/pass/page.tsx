"use client";

import { PassBadge } from "@/components/pass-badge";
import { Alert, Button, ErrorNote, LinkButton, Loading, PageTitle } from "@/components/ui";
import { fmtDate, useApi } from "@/lib/api";

type Credential = {
  accreditation_id: string;
  status: string;
  issued_at: string;
  valid_from: string | null;
  valid_until: string | null;
  admitted_at: string | null;
  holder_name: string;
  chapter: string;
  category: string;
  requires_identity_check: boolean;
  event_name: string;
  event_theme: string;
  norsical_name: string | null;
  patrol: string | null;
  designation: string | null;
  has_photo: boolean;
  qrSvg: string | null;
};

export default function Pass() {
  const { data, error, loading } = useApi<{ credential: Credential | null }>("/me/credential");
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const c = data.credential;
  if (!c) {
    return (
      <>
        <PageTitle title="My pass" />
        <Alert tone="info" title="You do not have a pass yet">
          Your pass is issued after your membership is verified and your payment is confirmed.
        </Alert>
        <div className="mt-6">
          <LinkButton href="/portal" variant="secondary">
            Go to my registration
          </LinkButton>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="no-print">
        <PageTitle title="My pass" sub={c.event_name} />
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,360px)_1fr]">
        <PassBadge
          name={c.holder_name}
          chapter={c.patrol ?? c.chapter}
          norsicalName={c.norsical_name}
          designation={c.designation}
          photoUrl={c.has_photo ? "/api/v1/me/photo" : null}
          tagline={c.event_theme}
          category={c.category}
          accreditationId={c.accreditation_id}
          status={c.status}
          qr={
            c.qrSvg ? (
              // Server-generated SVG from the qrcode library; contains only the opaque pass token.
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted server-rendered QR SVG
              <div className="mx-auto w-56 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: c.qrSvg }} />
            ) : (
              <div className="mx-auto flex size-56 items-center justify-center border-2 border-dashed border-line text-slate">
                No active code
              </div>
            )
          }
        />
        <div className="no-print max-w-lg space-y-5">
          {c.status === "active" ? (
            <Alert tone="success" title="Your pass is active">
              Show this code at the gate. It admits you once.
            </Alert>
          ) : (
            <Alert tone="error" title="This pass is not valid for entry">
              Contact the accreditation desk.
            </Alert>
          )}
          {c.admitted_at && <p>Checked in: {fmtDate(c.admitted_at)}</p>}
          <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">
            <li>Do not share or post your QR code. Anyone holding it could try to use your entry.</li>
            {c.requires_identity_check && <li>Bring photo ID — your category requires an identity check at the gate.</li>}
            <li>
              If your phone is lost, ask the accreditation desk to reissue your pass. Your old code will stop working immediately.
            </li>
          </ul>
          {c.status === "active" && (
            <div className="flex flex-wrap gap-3">
              <a
                href="/api/v1/me/credential/qr.svg"
                download
                className="inline-flex min-h-11 items-center rounded-sm border-2 border-ink px-5 font-display text-lg font-semibold hover:bg-fog"
              >
                Download QR code
              </a>
              <Button variant="secondary" onClick={() => window.print()}>
                Print badge
              </Button>
            </div>
          )}
          <p className="text-sm text-slate">Issued {fmtDate(c.issued_at)}</p>
        </div>
      </div>
    </>
  );
}
