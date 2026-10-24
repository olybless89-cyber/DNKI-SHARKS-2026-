"use client";

import { formatMoney } from "@dnki/shared";
import { useState } from "react";
import { ReasonAction, SearchBar, useList } from "@/components/admin";
import { useMe } from "@/components/app-shell";
import { Alert, Button, ErrorNote, Loading, Pager, PageTitle, SandboxFlag, StatusPill, Table } from "@/components/ui";
import { type ApiError, api, fmtDate, useApi } from "@/lib/api";

type Order = {
  id: string;
  reference: string;
  provider: string;
  status: string;
  amount_minor: string;
  currency: string;
  failure_reason: string | null;
  created_at: string;
  last_verified_at: string | null;
  registration_reference: string;
  registration_status: string;
  full_name: string;
};

export default function Payments() {
  const me = useMe();
  const list = useList<Order>("/admin/payments/orders");
  const summary = useApi<{
    provider: string;
    sandbox: boolean;
    byStatus: { status: string; currency: string; count: number; amount_minor: string }[];
    webhooks: { processing_status: string; count: number }[];
  }>("/admin/payments/summary");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canReconcile = me.permissions.includes("payment.reconcile");
  const canRefund = me.permissions.includes("payment.refund");

  async function act(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      setMsg(await fn());
      void list.reload();
      void summary.reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle
        title="Payments"
        sub="Only server-verified provider results change payment status. Browser redirects are never trusted."
        actions={
          canReconcile ? (
            <Button
              variant="secondary"
              busy={busy === "reconcile"}
              onClick={() =>
                act(
                  "reconcile",
                  async () =>
                    `Reconciliation checked ${(await api<{ checked: number }>("/admin/payments/reconcile", { method: "POST" })).checked} order(s).`,
                )
              }
            >
              Run reconciliation
            </Button>
          ) : null
        }
      />
      {summary.data?.sandbox && (
        <div className="mb-4">
          <SandboxFlag>Sandbox provider — these are not real transactions</SandboxFlag>
        </div>
      )}
      {summary.data && (
        <div className="mb-6 flex flex-wrap gap-6">
          {summary.data.byStatus.map((s) => (
            <div key={`${s.status}${s.currency}`}>
              <p className="text-sm text-slate">{s.status.replace(/_/g, " ")}</p>
              <p className="display text-3xl">{s.count}</p>
              <p className="text-sm">{formatMoney(s.amount_minor, s.currency)}</p>
            </div>
          ))}
        </div>
      )}
      {msg && <Alert tone="success">{msg}</Alert>}
      <ErrorNote error={err} />
      <SearchBar
        placeholder="Payment or registration reference, email"
        onSearch={list.setQ}
        statuses={["initiated", "pending", "succeeded", "failed", "abandoned", "needs_review", "refunded", "disputed"]}
        status={list.status}
        onStatus={list.setStatus}
      />
      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Loading />}
      {list.data && (
        <Table head={["Reference", "Participant", "Amount", "Status", "Created", "Last verified", "Actions"]}>
          {list.data.items.map((o) => (
            <tr key={o.id}>
              <td className="font-semibold">
                {o.reference}
                <span className="block text-sm font-normal text-slate">{o.registration_reference}</span>
              </td>
              <td>{o.full_name}</td>
              <td>{formatMoney(o.amount_minor, o.currency)}</td>
              <td>
                <StatusPill status={o.status} />
                {o.failure_reason && <span className="block text-sm text-slate">{o.failure_reason}</span>}
              </td>
              <td>{fmtDate(o.created_at)}</td>
              <td>{fmtDate(o.last_verified_at)}</td>
              <td className="space-y-2">
                {canReconcile && ["initiated", "pending", "needs_review", "failed"].includes(o.status) && (
                  <Button
                    variant="ghost"
                    className="min-h-0 px-0 text-base"
                    busy={busy === o.id}
                    onClick={() =>
                      act(
                        o.id,
                        async () =>
                          `Re-verified ${o.reference}: ${(await api<{ outcome: string }>(`/admin/payments/orders/${o.id}/verify`, { method: "POST" })).outcome}.`,
                      )
                    }
                  >
                    Re-verify with provider
                  </Button>
                )}
                {canRefund && ["succeeded", "needs_review"].includes(o.status) && (
                  <ReasonAction
                    label="Refund"
                    variant="danger"
                    confirm={`Refund ${formatMoney(o.amount_minor, o.currency)} for ${o.reference}? ${o.status === "succeeded" ? "The participant's accreditation will be revoked." : "This is an unexpected payment; the registration is unaffected."}`}
                    path={`/admin/payments/orders/${o.id}/refund`}
                    onDone={() => {
                      setMsg(`Refund requested for ${o.reference}.`);
                      void list.reload();
                    }}
                  />
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {list.data && <Pager page={list.page} pages={list.data.pages} onPage={list.setPage} />}
      {summary.data && (
        <p className="mt-6 text-sm text-slate">
          Provider notifications: {summary.data.webhooks.map((w) => `${w.count} ${w.processing_status}`).join(", ") || "none yet"}
          .
        </p>
      )}
    </>
  );
}
