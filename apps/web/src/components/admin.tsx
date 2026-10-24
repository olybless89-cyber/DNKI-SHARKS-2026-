"use client";

import { useState } from "react";
import { type ApiError, api, type Paged, useApi } from "@/lib/api";
import { Button, ErrorNote } from "./ui";

/** Paginated, searchable list bound to an admin endpoint. */
export function useList<T>(base: string, initial: { status?: string } = {}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(initial.status ?? "");
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const sep = base.includes("?") ? "&" : "?";
  const res = useApi<Paged<T>>(`${base}${sep}${params}`);
  return {
    ...res,
    page,
    setPage,
    q,
    setQ: (v: string) => {
      setPage(1);
      setQ(v);
    },
    status,
    setStatus: (v: string) => {
      setPage(1);
      setStatus(v);
    },
  };
}

export function SearchBar({
  onSearch,
  placeholder,
  statuses,
  status,
  onStatus,
}: {
  onSearch: (q: string) => void;
  placeholder: string;
  statuses?: string[];
  status?: string;
  onStatus?: (s: string) => void;
}) {
  return (
    <form
      className="mb-4 flex flex-wrap gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(String(new FormData(e.currentTarget).get("q") ?? "").trim());
      }}
    >
      <label htmlFor="admin-search" className="sr-only">
        Search
      </label>
      <input
        id="admin-search"
        name="q"
        placeholder={placeholder}
        className="min-h-11 flex-1 rounded-sm border-2 border-line px-3 focus:border-ink sm:max-w-sm"
      />
      {statuses && onStatus && (
        <>
          <label htmlFor="admin-status" className="sr-only">
            Status
          </label>
          <select
            id="admin-status"
            value={status}
            onChange={(e) => onStatus(e.target.value)}
            className="min-h-11 rounded-sm border-2 border-line px-3"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </>
      )}
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

/**
 * Action that requires a written reason (recorded in the audit log). Confirms
 * before sending because these actions affect real participants.
 */
export function ReasonAction({
  label,
  confirm,
  path,
  body = {},
  variant = "secondary",
  onDone,
}: {
  label: string;
  confirm: string;
  path: string;
  body?: Record<string, unknown>;
  variant?: "secondary" | "danger" | "primary";
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  return (
    <div className="inline-block">
      <Button
        variant={variant}
        busy={busy}
        className="min-h-9 px-3 text-base"
        onClick={async () => {
          const reason = window.prompt(`${confirm}\n\nReason (recorded in the audit log):`);
          if (!reason) return;
          setBusy(true);
          setErr(null);
          try {
            await api(path, { body: { ...body, reason } });
            onDone();
          } catch (e) {
            setErr(e as ApiError);
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      {err && (
        <div className="mt-2">
          <ErrorNote error={err} />
        </div>
      )}
    </div>
  );
}
