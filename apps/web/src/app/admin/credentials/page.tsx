"use client";

import { ReasonAction, SearchBar, useList } from "@/components/admin";
import { useMe } from "@/components/app-shell";
import { ErrorNote, Loading, Pager, PageTitle, StatusPill, Table } from "@/components/ui";
import { fmtDate } from "@/lib/api";

type Cred = {
  id: string;
  accreditation_id: string;
  status: string;
  issued_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
  admitted_at: string | null;
  presence: string;
  registration_reference: string;
  registration_status: string;
  full_name: string;
  membership_number: string;
  chapter: string;
  admitted_gate: string | null;
};

export default function Credentials() {
  const me = useMe();
  const list = useList<Cred>("/admin/credentials");
  const canRevoke = me.permissions.includes("credential.revoke");
  const canReissue = me.permissions.includes("credential.reissue");
  return (
    <>
      <PageTitle title="Credentials" sub="Pass tokens are never shown here. Reissuing invalidates the old QR immediately." />
      <SearchBar
        placeholder="Accreditation ID, name or member number"
        onSearch={list.setQ}
        statuses={["active", "suspended", "revoked", "superseded"]}
        status={list.status}
        onStatus={list.setStatus}
      />
      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Loading />}
      {list.data && (
        <Table head={["Accreditation ID", "Holder", "Status", "Issued", "Admitted", "Actions"]}>
          {list.data.items.map((c) => (
            <tr key={c.id}>
              <td className="font-display text-lg font-semibold tracking-wider">
                {c.accreditation_id}
                <span className="block font-sans text-sm font-normal tracking-normal text-slate">{c.registration_reference}</span>
              </td>
              <td>
                {c.full_name}
                <span className="block text-sm text-slate">
                  {c.membership_number} · {c.chapter}
                </span>
              </td>
              <td>
                <StatusPill status={c.status} />
                {c.revocation_reason && <span className="block text-sm text-slate">{c.revocation_reason}</span>}
              </td>
              <td>{fmtDate(c.issued_at)}</td>
              <td>{c.admitted_at ? `${fmtDate(c.admitted_at)} (${c.admitted_gate ?? "gate"})` : "—"}</td>
              <td className="space-x-2 whitespace-nowrap">
                {canReissue && c.status === "active" && (
                  <ReasonAction
                    label="Reissue"
                    confirm={`Reissue the pass for ${c.full_name}? Their current QR code stops working immediately and a new pass is emailed.`}
                    path={`/admin/credentials/${c.id}/reissue`}
                    onDone={list.reload}
                  />
                )}
                {canRevoke && ["active", "suspended"].includes(c.status) && (
                  <ReasonAction
                    label="Revoke"
                    variant="danger"
                    confirm={`Revoke ${c.accreditation_id} for ${c.full_name}? They will be refused entry.`}
                    path={`/admin/credentials/${c.id}/revoke`}
                    onDone={list.reload}
                  />
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {list.data && <Pager page={list.page} pages={list.data.pages} onPage={list.setPage} />}
    </>
  );
}
