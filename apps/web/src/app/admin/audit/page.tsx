"use client";

import { SearchBar, useList } from "@/components/admin";
import { ErrorNote, Loading, Pager, PageTitle, Table } from "@/components/ui";
import { fmtDate } from "@/lib/api";

type Row = {
  id: string;
  occurred_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  correlation_id: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  actor_name: string | null;
  actor_email: string | null;
};

export default function Audit() {
  const list = useList<Row>("/admin/audit");
  return (
    <>
      <PageTitle title="Audit log" sub="Append-only. Records cannot be edited or deleted, including by administrators." />
      <SearchBar placeholder="Action prefix, e.g. payment. or membership.approved" onSearch={(q) => list.setQ(q)} />
      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Loading />}
      {list.data && (
        <Table head={["When", "Actor", "Action", "Record", "Reason", "Details"]}>
          {list.data.items.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap">{fmtDate(a.occurred_at)}</td>
              <td>{a.actor_name ?? "System"}</td>
              <td className="font-semibold">{a.action}</td>
              <td className="text-sm">
                {a.entity_type}
                {a.entity_id && <span className="block break-all text-slate">{a.entity_id}</span>}
              </td>
              <td>{a.reason ?? "—"}</td>
              <td className="max-w-xs text-xs break-all text-slate">
                {Object.keys(a.metadata ?? {}).length ? JSON.stringify(a.metadata) : ""}
                {a.correlation_id && <span className="block">ref {a.correlation_id}</span>}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {list.data && <Pager page={list.page} pages={list.data.pages} onPage={list.setPage} />}
    </>
  );
}
