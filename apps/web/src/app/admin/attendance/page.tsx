"use client";

import { SearchBar, useList } from "@/components/admin";
import { cx, ErrorNote, Loading, Pager, PageTitle, Table } from "@/components/ui";
import { fmtDate } from "@/lib/api";

type Row = {
  id: string;
  result: string;
  method: string;
  direction: string;
  counted: boolean;
  override_reason: string | null;
  created_at: string;
  gate: string;
  accreditation_id: string | null;
  full_name: string | null;
  scanned_by: string;
};

export default function Attendance() {
  const list = useList<Row>("/admin/attendance");
  const extra = list.data as unknown as {
    byGate?: { id: string; name: string; admitted: number; scans: number; suspicious: number }[];
    totals?: { checked_in: number; inside: number; active_credentials: number };
  } | null;
  return (
    <>
      <PageTitle title="Attendance" sub="Every scan is recorded, including refusals." />
      {extra?.totals && (
        <dl className="mb-8 grid grid-cols-3 gap-px border-2 border-ink bg-ink">
          {[
            ["Checked in", extra.totals.checked_in],
            ["Currently inside", extra.totals.inside],
            ["Active passes", extra.totals.active_credentials],
          ].map(([l, v]) => (
            <div key={l} className="bg-paper p-4">
              <dt className="text-sm text-slate">{l}</dt>
              <dd className="display text-4xl">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {extra?.byGate && (
        <div className="mb-8">
          <Table head={["Gate", "Admitted", "Scans", "Duplicate / invalid / revoked"]}>
            {extra.byGate.map((g) => (
              <tr key={g.id}>
                <td className="font-semibold">{g.name}</td>
                <td>{g.admitted}</td>
                <td>{g.scans}</td>
                <td className={g.suspicious ? "font-semibold text-crimson" : ""}>{g.suspicious}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      <SearchBar placeholder="Accreditation ID or name" onSearch={list.setQ} />
      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Loading />}
      {list.data && (
        <Table head={["Time", "Gate", "Participant", "Result", "Method", "Scanned by"]}>
          {list.data.items.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{fmtDate(r.created_at)}</td>
              <td>{r.gate}</td>
              <td>
                {r.full_name ?? "—"}
                {r.accreditation_id && <span className="block text-sm text-slate">{r.accreditation_id}</span>}
              </td>
              <td className={cx("font-semibold", r.result.startsWith("VALID") ? "text-admit" : "text-crimson")}>
                {r.result.replace(/_/g, " ")}
                {r.counted && <span className="block text-xs font-normal text-slate">counted admission</span>}
                {r.override_reason && <span className="block text-xs font-normal text-slate">override: {r.override_reason}</span>}
              </td>
              <td>
                {r.method.replace("_", " ")} · {r.direction}
              </td>
              <td>{r.scanned_by}</td>
            </tr>
          ))}
        </Table>
      )}
      {list.data && <Pager page={list.page} pages={list.data.pages} onPage={list.setPage} />}
    </>
  );
}
