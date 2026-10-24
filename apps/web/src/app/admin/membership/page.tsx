"use client";

import { useState } from "react";
import { ReasonAction, SearchBar, useList } from "@/components/admin";
import { useMe } from "@/components/app-shell";
import { Alert, Button, cx, Empty, ErrorNote, Loading, Pager, PageTitle, StatusPill, Table } from "@/components/ui";
import { type ApiError, api, fmtDate, useApi } from "@/lib/api";

type Verification = {
  id: string;
  status: string;
  method: string;
  membership_number_submitted: string;
  contact_submitted: string | null;
  submitted_note: string | null;
  created_at: string;
  account_name: string;
  account_email: string;
  candidate_id: string | null;
  candidate_number: string | null;
  candidate_name: string | null;
  candidate_chapter: string | null;
  candidate_standing: string | null;
  candidate_linked_user_id: string | null;
  user_id: string;
};

type MemberRow = {
  id: string;
  membership_number: string;
  full_name: string;
  chapter: string;
  email: string | null;
  standing: string;
  linked: boolean;
  is_synthetic: boolean;
};

const TABS = ["Review queue", "Member records", "Import"] as const;

export default function MembershipAdmin() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Review queue");
  return (
    <>
      <PageTitle title="Membership" sub="Verification decisions are audited. You cannot decide your own request." />
      <div role="tablist" className="mb-6 flex gap-1 border-b-2 border-ink">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("px-4 py-2 font-display text-lg font-semibold", tab === t ? "bg-ink text-paper" : "hover:bg-fog")}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Review queue" && <Queue />}
      {tab === "Member records" && <Records />}
      {tab === "Import" && <Import />}
    </>
  );
}

function Queue() {
  const me = useMe();
  const list = useList<Verification>("/admin/membership/verifications", { status: "pending_review" });
  const canDecide = me.permissions.includes("membership.review");
  return (
    <>
      <SearchBar
        placeholder="(filter by status)"
        onSearch={() => {}}
        statuses={["pending_review", "pending_contact", "approved", "rejected"]}
        status={list.status}
        onStatus={list.setStatus}
      />
      {list.loading && !list.data ? <Loading /> : null}
      <ErrorNote error={list.error} />
      {list.data && list.data.items.length === 0 && <Empty>No requests with this status.</Empty>}
      <ul className="space-y-4">
        {list.data?.items.map((v) => (
          <li key={v.id} className="border-2 border-ink p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-2xl font-semibold">{v.account_name}</p>
                <p className="text-slate">{v.account_email}</p>
              </div>
              <StatusPill status={v.status} />
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
              <dt className="text-slate">Submitted number</dt>
              <dd className="font-semibold">{v.membership_number_submitted}</dd>
              <dt className="text-slate">Requested</dt>
              <dd>{fmtDate(v.created_at)}</dd>
              {v.submitted_note && (
                <>
                  <dt className="text-slate">Note</dt>
                  <dd className="whitespace-pre-line">{v.submitted_note}</dd>
                </>
              )}
              <dt className="text-slate">Matching record</dt>
              <dd>
                {v.candidate_id ? (
                  <>
                    {v.candidate_number} — {v.candidate_name}, {v.candidate_chapter || "no chapter"}{" "}
                    <StatusPill status={v.candidate_standing} />
                    {v.candidate_linked_user_id && v.candidate_linked_user_id !== v.user_id && (
                      <span className="ml-2 font-semibold text-crimson">Already linked to another account</span>
                    )}
                  </>
                ) : (
                  <span className="text-crimson">No record with this number</span>
                )}
              </dd>
            </dl>
            {canDecide && ["pending_review", "pending_contact"].includes(v.status) && (
              <div className="mt-4 flex flex-wrap gap-3">
                {v.candidate_id && v.candidate_standing === "good_standing" && (
                  <ReasonAction
                    label="Approve"
                    variant="primary"
                    confirm={`Approve ${v.account_name} as member ${v.candidate_number}? Confirm you have checked their identity.`}
                    path={`/admin/membership/verifications/${v.id}/decision`}
                    body={{ decision: "approve", memberRecordId: v.candidate_id }}
                    onDone={list.reload}
                  />
                )}
                <ReasonAction
                  label="Reject"
                  variant="danger"
                  confirm={`Reject the request from ${v.account_name}?`}
                  path={`/admin/membership/verifications/${v.id}/decision`}
                  body={{ decision: "reject" }}
                  onDone={list.reload}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      {list.data && <Pager page={list.page} pages={list.data.pages} onPage={list.setPage} />}
    </>
  );
}

function Records() {
  const list = useList<MemberRow>("/admin/membership/records");
  return (
    <>
      <SearchBar placeholder="Membership number or name" onSearch={list.setQ} />
      <ErrorNote error={list.error} />
      {list.data && (
        <Table head={["Number", "Name", "Chapter", "Email on record", "Standing", "Account"]}>
          {list.data.items.map((m) => (
            <tr key={m.id}>
              <td className="font-semibold">
                {m.membership_number}
                {m.is_synthetic && <span className="ml-2 text-xs text-warn">synthetic</span>}
              </td>
              <td>{m.full_name}</td>
              <td>{m.chapter}</td>
              <td>{m.email ?? "—"}</td>
              <td>
                <StatusPill status={m.standing} />
              </td>
              <td>{m.linked ? "Linked" : "—"}</td>
            </tr>
          ))}
        </Table>
      )}
      {list.data && <Pager page={list.page} pages={list.data.pages} onPage={list.setPage} />}
    </>
  );
}

type ImportResult = {
  importJobId: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: { row: number; field: string; message: string }[];
};

function Import() {
  const me = useMe();
  const jobs = useApi<{
    items: {
      id: string;
      filename: string;
      status: string;
      total_rows: number;
      valid_rows: number;
      error_rows: number;
      created_at: string;
      uploaded_by_name: string;
    }[];
  }>("/admin/membership/imports");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  if (!me.permissions.includes("membership.import")) return <Alert title="You do not have permission to import member data." />;

  return (
    <div className="space-y-8">
      <form
        className="max-w-xl space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const file = (new FormData(e.currentTarget).get("file") as File | null) ?? null;
          if (!file?.size) return;
          setBusy(true);
          setErr(null);
          setApplied(null);
          try {
            setResult(
              await api<ImportResult>("/admin/membership/imports", { body: { filename: file.name, csv: await file.text() } }),
            );
            void jobs.reload();
          } catch (x) {
            setErr(x as ApiError);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Upload a CSV with the columns <code>membership_number, full_name, chapter, zone, email, phone, standing</code>. Standing
          is one of good_standing, lapsed, suspended, expelled. The file is validated first; nothing changes until you apply it.
        </p>
        <label className="block">
          <span className="block font-semibold">CSV file</span>
          <input type="file" name="file" accept=".csv,text/csv" required className="mt-1 block" />
        </label>
        <Button type="submit" busy={busy}>
          Validate file
        </Button>
      </form>
      <ErrorNote error={err} />
      {applied && <Alert tone="success">{applied}</Alert>}
      {result && (
        <section className="space-y-4">
          <Alert tone={result.errorRows ? "warn" : "success"} title={`${result.validRows} of ${result.totalRows} rows are valid`}>
            {result.errorRows ? `${result.errorRows} rows have errors and will be skipped.` : "No errors found."}
          </Alert>
          {result.errors.length > 0 && (
            <Table head={["Row", "Field", "Problem"]}>
              {result.errors.slice(0, 100).map((e) => (
                <tr key={`${e.row}-${e.field}-${e.message}`}>
                  <td>{e.row}</td>
                  <td>{e.field}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </Table>
          )}
          {result.validRows > 0 && (
            <ReasonAction
              label={`Apply ${result.validRows} valid rows`}
              variant="primary"
              confirm="Apply this import to the member registry? Records already linked to accounts keep their name and email; conflicts are reported."
              path={`/admin/membership/imports/${result.importJobId}/apply`}
              onDone={() => {
                setApplied("Import applied. See the job list for details.");
                setResult(null);
                void jobs.reload();
              }}
            />
          )}
        </section>
      )}
      <section>
        <h2 className="font-display text-2xl font-semibold">Recent imports</h2>
        {jobs.data?.items.length ? (
          <Table head={["File", "Status", "Rows", "Valid", "Errors", "Uploaded"]}>
            {jobs.data.items.map((j) => (
              <tr key={j.id}>
                <td>{j.filename}</td>
                <td>
                  <StatusPill status={j.status} />
                </td>
                <td>{j.total_rows}</td>
                <td>{j.valid_rows}</td>
                <td>{j.error_rows}</td>
                <td>
                  {fmtDate(j.created_at)} by {j.uploaded_by_name}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No imports yet.</Empty>
        )}
      </section>
    </div>
  );
}
