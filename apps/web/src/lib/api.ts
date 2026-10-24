"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { field: string; message: string }[],
    public readonly correlationId?: string,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T = unknown>(path: string, opts: { method?: Method; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(method !== "GET" ? { "x-dnki-csrf": "1", "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : method !== "GET" ? "{}" : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = (
      json as {
        error?: { code?: string; message?: string; details?: { field: string; message: string }[]; correlationId?: string };
      }
    )?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "HTTP_ERROR",
      e?.message ?? `Request failed (${res.status})`,
      e?.details,
      e?.correlationId,
    );
  }
  return json as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Fetch-on-mount hook with explicit reload. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", String(e)));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export type Me = {
  user: { id: string; email: string; fullName: string; emailVerified: boolean; mfaEnabled: boolean };
  roles: string[];
  permissions: string[];
  privileged: boolean;
  mfa: { enabled: boolean; verifiedThisSession: boolean; pending: boolean; enrollmentRequired: boolean };
};

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number; pages: number };

export function fmtDate(v: string | null | undefined, withTime = true): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Africa/Lagos",
  }).format(new Date(v));
}
