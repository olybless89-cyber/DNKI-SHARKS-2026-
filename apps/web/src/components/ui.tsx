"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import type { ApiError } from "@/lib/api";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** Typographic placeholder mark. Replace with the official DNKI logo when supplied. */
export function Wordmark({ invert = false, compact = false }: { invert?: boolean; compact?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2", invert ? "text-paper" : "text-ink")} title="DNKI placeholder wordmark">
      <span aria-hidden className="inline-block h-6 w-1.5 bg-crimson" />
      <span className="font-display text-xl font-800 leading-none tracking-wide" style={{ fontWeight: 800 }}>
        DNKI{compact ? "" : " SHARKS"}
      </span>
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
};

export function Button({ variant = "primary", busy, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-5 font-display text-lg font-semibold tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-crimson text-paper hover:bg-crimson-deep",
        variant === "secondary" && "border-2 border-ink bg-paper text-ink hover:bg-fog",
        variant === "ghost" && "text-ink underline-offset-4 hover:underline",
        variant === "danger" && "border-2 border-crimson bg-paper text-crimson hover:bg-crimson hover:text-paper",
        className,
      )}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex min-h-11 items-center justify-center rounded-sm px-5 font-display text-lg font-semibold tracking-wide",
        variant === "primary"
          ? "bg-crimson text-paper hover:bg-crimson-deep"
          : "border-2 border-current hover:bg-fog hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

export function Spinner() {
  return (
    <span aria-hidden className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
  );
}

type FieldBase = { label: string; hint?: string; error?: string };

export function Field({ label, hint, error, ...input }: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={hint || error ? `${id}-d` : undefined}
        {...input}
        className="block min-h-11 w-full rounded-sm border-2 border-line bg-paper px-3 text-base aria-invalid:border-crimson focus:border-ink"
      />
      {(hint || error) && (
        <p id={`${id}-d`} className={cx("text-sm", error ? "text-crimson" : "text-slate")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function TextArea({ label, hint, error, ...input }: FieldBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        {...input}
        className="block w-full rounded-sm border-2 border-line bg-paper px-3 py-2 text-base focus:border-ink"
      />
      {(hint || error) && <p className={cx("text-sm", error ? "text-crimson" : "text-slate")}>{error ?? hint}</p>}
    </div>
  );
}

export function Select({
  label,
  children,
  ...rest
}: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      <select
        id={id}
        {...rest}
        className="block min-h-11 w-full rounded-sm border-2 border-line bg-paper px-3 text-base focus:border-ink"
      >
        {children}
      </select>
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "error" | "success" | "warn";
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "border-l-4 px-4 py-3",
        tone === "error" && "border-crimson bg-[#fdf0f2]",
        tone === "success" && "border-admit bg-[#ecf7f0]",
        tone === "warn" && "border-warn bg-[#fdf6e8]",
        tone === "info" && "border-ink bg-fog",
      )}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className="text-[0.95rem]">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: ApiError | null | undefined }) {
  if (!error) return null;
  return (
    <Alert tone="error" title={error.message}>
      {error.details?.length ? (
        <ul className="mt-1 list-disc pl-5">
          {error.details.map((d) => (
            <li key={`${d.field}${d.message}`}>
              {d.field ? `${d.field}: ` : ""}
              {d.message}
            </li>
          ))}
        </ul>
      ) : null}
      {error.status >= 500 && error.correlationId ? <p className="text-sm text-slate">Reference: {error.correlationId}</p> : null}
    </Alert>
  );
}

const PILL: Record<string, string> = {
  accredited: "bg-admit text-paper",
  active: "bg-admit text-paper",
  succeeded: "bg-admit text-paper",
  approved: "bg-admit text-paper",
  paid: "bg-ink text-paper",
  awaiting_payment: "bg-[#fdf6e8] text-warn border border-warn",
  pending: "bg-[#fdf6e8] text-warn border border-warn",
  initiated: "bg-[#fdf6e8] text-warn border border-warn",
  pending_review: "bg-[#fdf6e8] text-warn border border-warn",
  pending_contact: "bg-[#fdf6e8] text-warn border border-warn",
  needs_review: "bg-[#fdf6e8] text-warn border border-warn",
  open: "bg-[#fdf6e8] text-warn border border-warn",
  revoked: "bg-crimson text-paper",
  rejected: "bg-crimson text-paper",
  failed: "bg-crimson text-paper",
  suspended: "bg-crimson text-paper",
  disputed: "bg-crimson text-paper",
};

export function StatusPill({ status }: { status: string | null | undefined }) {
  const s = status ?? "unknown";
  return (
    <span
      className={cx(
        "inline-block rounded-sm px-2 py-0.5 text-sm font-semibold whitespace-nowrap",
        PILL[s] ?? "bg-fog text-slate",
      )}
    >
      {s.replace(/_/g, " ")}
    </span>
  );
}

export function SandboxFlag({ children = "Sandbox — no real money moves" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-sm border-2 border-dashed border-warn bg-[#fdf6e8] px-2 py-0.5 text-sm font-semibold text-warn">
      {children}
    </span>
  );
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
      <div>
        <h1 className="display text-4xl sm:text-5xl">{title}</h1>
        {sub && <p className="mt-2 text-slate">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border-2 border-dashed border-line px-4 py-8 text-center text-slate">{children}</p>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 py-8 text-slate" role="status">
      <Spinner /> {label}…
    </p>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center gap-3">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-slate">
        Page {page} of {pages}
      </span>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto border-2 border-ink">
      <table className="w-full min-w-[640px] border-collapse text-left text-[0.95rem]">
        <thead className="bg-ink text-paper">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-display text-base font-semibold tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:nth-child(even)]:bg-fog [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}
