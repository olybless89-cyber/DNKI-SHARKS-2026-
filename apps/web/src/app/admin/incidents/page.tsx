"use client";

import { useState } from "react";
import { SearchBar, useList } from "@/components/admin";
import { Alert, Button, ErrorNote, Loading, Pager, PageTitle, Select, StatusPill, TextArea } from "@/components/ui";
import { type ApiError, api, fmtDate } from "@/lib/api";

type Incident = {
  id: string;
  category: string;
  severity: string;
  description: string;
  status: string;
  resolution: string | null;
  created_at: string;
  gate: string | null;
  reported_by_name: string;
};

export default function Incidents() {
  const list = useList<Incident>("/admin/incidents");
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      void list.reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <>
      <PageTitle title="Incidents" sub="Security and operational incidents raised by staff." />
      <ErrorNote error={err} />
      {msg && <Alert tone="success">{msg}</Alert>}
      <details className="my-6 max-w-2xl border-2 border-line p-4">
        <summary className="cursor-pointer font-display text-xl font-semibold">Log an incident</summary>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void run(async () => {
              await api("/incidents", {
                body: {
                  gateId: null,
                  category: f.get("category"),
                  severity: f.get("severity"),
                  description: f.get("description"),
                },
              });
              form.reset();
            }, "Incident logged.");
          }}
        >
          <Select label="Category" name="category">
            <option value="duplicate_entry">Duplicate entry attempt</option>
            <option value="fraud_suspected">Suspected fraud</option>
            <option value="identity_mismatch">Identity mismatch</option>
            <option value="system">System problem</option>
            <option value="safety">Safety</option>
            <option value="other">Other</option>
          </Select>
          <Select label="Severity" name="severity" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
          <div className="sm:col-span-2">
            <TextArea label="What happened" name="description" rows={4} required minLength={10} />
          </div>
          <div>
            <Button type="submit">Log incident</Button>
          </div>
        </form>
      </details>
      <SearchBar
        placeholder="(filter by status)"
        onSearch={() => {}}
        statuses={["open", "investigating", "resolved"]}
        status={list.status}
        onStatus={list.setStatus}
      />
      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Loading />}
      <ul className="space-y-4">
        {list.data?.items.map((i) => (
          <li key={i.id} className="border-2 border-ink p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-xl font-semibold">
                {i.category.replace(/_/g, " ")} —{" "}
                <span className={i.severity === "critical" || i.severity === "high" ? "text-crimson" : ""}>{i.severity}</span>
              </p>
              <StatusPill status={i.status} />
            </div>
            <p className="text-sm text-slate">
              {fmtDate(i.created_at)} by {i.reported_by_name}
              {i.gate ? ` at ${i.gate}` : ""}
            </p>
            <p className="mt-2 whitespace-pre-line">{i.description}</p>
            {i.resolution && <p className="mt-2 border-l-4 border-admit pl-3">{i.resolution}</p>}
            {i.status !== "resolved" && (
              <div className="mt-3 flex flex-wrap gap-3">
                {i.status === "open" && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      run(
                        () => api(`/admin/incidents/${i.id}`, { method: "PATCH", body: { status: "investigating" } }),
                        "Marked as investigating.",
                      )
                    }
                  >
                    Start investigating
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={() => {
                    const resolution = window.prompt("How was this resolved?");
                    if (resolution)
                      void run(
                        () => api(`/admin/incidents/${i.id}`, { method: "PATCH", body: { status: "resolved", resolution } }),
                        "Incident resolved.",
                      );
                  }}
                >
                  Resolve
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {list.data && list.data.items.length === 0 && <p className="text-slate">No incidents.</p>}
      {list.data && <Pager page={list.page} pages={list.data.pages} onPage={list.setPage} />}
    </>
  );
}
