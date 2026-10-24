"use client";

import { formatMoney } from "@dnki/shared";
import { useState } from "react";
import { ReasonAction, SearchBar, useList } from "@/components/admin";
import { useMe } from "@/components/app-shell";
import { Button, ErrorNote, Loading, Pager, PageTitle, StatusPill, Table } from "@/components/ui";
import { fmtDate, useApi } from "@/lib/api";

type Row = {
  id: string;
  reference: string;
  status: string;
  fee_minor: string;
  currency: string;
  created_at: string;
  full_name: string;
  email: string;
  membership_number: string;
  chapter: string;
  category: string;
  norsical_name: string | null;
  patrol: string | null;
  designation: string | null;
  hard_drugs_declaration: "yes" | "no" | null;
};

export default function Registrations() {
  const me = useMe();
  const list = useList<Row>("/admin/registrations");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageTitle
        title="Registrations"
        sub={list.data ? `${list.data.total.toLocaleString("en-GB")} matching` : undefined}
        actions={
          me.permissions.includes("report.export") ? (
            <a href="/api/v1/admin/exports/registrations.csv" className="underline underline-offset-4">
              Export CSV (audited)
            </a>
          ) : null
        }
      />
      <SearchBar
        placeholder="Reference, member number, name or email"
        onSearch={list.setQ}
        statuses={["awaiting_payment", "paid", "accredited", "cancelled", "refunded", "suspended", "revoked"]}
        status={list.status}
        onStatus={list.setStatus}
      />
      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Loading />}
      {list.data && (
        <Table head={["Reference", "Delegate", "Patrol", "Category", "Fee", "Status", "Created", ""]}>
          {list.data.items.map((r) => (
            <tr key={r.id}>
              <td className="font-semibold">{r.reference}</td>
              <td>
                {r.full_name}
                {r.norsical_name && <span className="block text-sm font-semibold">“{r.norsical_name}”</span>}
                <span className="block text-sm text-slate">
                  {r.membership_number} · {r.chapter}
                </span>
              </td>
              <td>
                {r.patrol ?? "—"}
                {r.designation && <span className="block text-sm text-slate">{r.designation}</span>}
              </td>
              <td>
                {r.category}
                {r.hard_drugs_declaration === "yes" && (
                  <span className="mt-1 block w-fit bg-[#fdf6e8] px-1.5 text-xs font-semibold text-warn">Declared drug use</span>
                )}
              </td>
              <td>{formatMoney(r.fee_minor, r.currency)}</td>
              <td>
                <StatusPill status={r.status} />
              </td>
              <td>{fmtDate(r.created_at)}</td>
              <td>
                <Button variant="ghost" className="min-h-0 px-0 text-base" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {open === r.id ? "Close" : "Details"}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {list.data && <Pager page={list.page} pages={list.data.pages} onPage={list.setPage} />}
      {open && <Detail id={open} canManage={me.permissions.includes("registration.manage")} onChange={list.reload} />}
    </>
  );
}

type DetailData = {
  registration: {
    reference: string;
    status: string;
    full_name: string;
    email: string;
    membership_number: string;
    standing: string;
    category: string;
    phone: string | null;
    norish_name: string | null;
    norsical_name: string | null;
    patrol: string | null;
    designation: string | null;
    meal_friday: string | null;
    meal_saturday: string | null;
    hard_drugs_declaration: "yes" | "no" | null;
    conduct_rules_accepted_at: string | null;
    has_photo: boolean;
  };
  history: {
    from_status: string | null;
    to_status: string;
    actor_type: string;
    reason: string | null;
    created_at: string;
    actor_name: string | null;
  }[];
  orders:
    | {
        reference: string;
        status: string;
        amount_minor: string;
        currency: string;
        created_at: string;
        failure_reason: string | null;
      }[]
    | null;
  credentials: { accreditation_id: string; status: string; issued_at: string; admitted_at: string | null }[] | null;
};

function Detail({ id, canManage, onChange }: { id: string; canManage: boolean; onChange: () => void }) {
  const d = useApi<DetailData>(`/admin/registrations/${id}`);
  const reload = () => {
    void d.reload();
    onChange();
  };
  if (!d.data) return <Loading />;
  const r = d.data.registration;
  const actions: { action: string; label: string; when: string[] }[] = [
    { action: "cancel", label: "Cancel", when: ["awaiting_payment"] },
    { action: "suspend", label: "Suspend", when: ["paid", "accredited"] },
    { action: "reinstate", label: "Reinstate", when: ["suspended"] },
    { action: "revoke", label: "Revoke accreditation", when: ["accredited", "suspended"] },
  ];
  return (
    <section className="mt-8 border-2 border-ink p-5" aria-label={`Registration ${r.reference}`}>
      <h2 className="font-display text-3xl font-semibold">
        {r.reference} — {r.full_name}
      </h2>
      <p className="text-slate">
        {r.email}
        {r.phone ? ` · ${r.phone}` : ""} · member {r.membership_number} (<StatusPill status={r.standing} />)
      </p>
      <div className="mt-4 flex flex-wrap gap-6">
        {r.has_photo ? (
          // biome-ignore lint/performance/noImgElement: authenticated staff photo endpoint
          <img
            src={`/api/v1/staff/photos/registration/${id}`}
            alt={`Photo of ${r.full_name}`}
            className="h-36 w-28 rounded-sm border-2 border-ink object-cover"
          />
        ) : (
          <span className="flex h-36 w-28 items-center justify-center border-2 border-dashed border-line text-center text-xs text-slate">
            No photo
          </span>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[0.95rem]">
          <dt className="text-slate">Norish name</dt>
          <dd>{r.norish_name ?? "—"}</dd>
          <dt className="text-slate">Norsical name</dt>
          <dd>{r.norsical_name ?? "—"}</dd>
          <dt className="text-slate">Patrol</dt>
          <dd>{r.patrol ?? "—"}</dd>
          <dt className="text-slate">Designation</dt>
          <dd>{r.designation ?? "—"}</dd>
          <dt className="text-slate">Friday meal</dt>
          <dd>{r.meal_friday ?? "—"}</dd>
          <dt className="text-slate">Saturday meal</dt>
          <dd>{r.meal_saturday ?? "—"}</dd>
          <dt className="text-slate">Hard drugs declaration</dt>
          <dd className={r.hard_drugs_declaration === "yes" ? "font-semibold text-warn" : ""}>
            {r.hard_drugs_declaration ?? "—"}
          </dd>
          <dt className="text-slate">Conduct rules accepted</dt>
          <dd>{r.conduct_rules_accepted_at ? fmtDate(r.conduct_rules_accepted_at) : "—"}</dd>
        </dl>
      </div>
      {canManage && (
        <div className="mt-4 flex flex-wrap gap-3">
          {actions
            .filter((a) => a.when.includes(r.status))
            .map((a) => (
              <ReasonAction
                key={a.action}
                label={a.label}
                variant={a.action === "reinstate" ? "secondary" : "danger"}
                confirm={`${a.label} registration ${r.reference}?`}
                path={`/admin/registrations/${id}/action`}
                body={{ action: a.action }}
                onDone={reload}
              />
            ))}
        </div>
      )}
      <h3 className="mt-6 font-display text-xl font-semibold">History</h3>
      <ol className="mt-2 space-y-1">
        {d.data.history.map((h) => (
          <li key={`${h.created_at}${h.to_status}`}>
            {fmtDate(h.created_at)}: {h.from_status ?? "new"} → <strong>{h.to_status}</strong> ({h.actor_name ?? h.actor_type})
            {h.reason ? ` — ${h.reason}` : ""}
          </li>
        ))}
      </ol>
      {d.data.orders && (
        <>
          <h3 className="mt-6 font-display text-xl font-semibold">Payments</h3>
          <ul className="mt-2 space-y-1">
            {d.data.orders.map((o) => (
              <li key={o.reference}>
                {o.reference} — {formatMoney(o.amount_minor, o.currency)} <StatusPill status={o.status} />{" "}
                {o.failure_reason ? `(${o.failure_reason})` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {d.data.credentials && (
        <>
          <h3 className="mt-6 font-display text-xl font-semibold">Credentials</h3>
          <ul className="mt-2 space-y-1">
            {d.data.credentials.map((c) => (
              <li key={c.accreditation_id}>
                {c.accreditation_id} <StatusPill status={c.status} /> issued {fmtDate(c.issued_at)}
                {c.admitted_at ? `, admitted ${fmtDate(c.admitted_at)}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
