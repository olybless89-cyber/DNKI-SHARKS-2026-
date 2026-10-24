"use client";

import { formatMoney } from "@dnki/shared";
import { useState } from "react";
import { useMe } from "@/components/app-shell";
import { Alert, Button, ErrorNote, Field, Loading, PageTitle, Select, StatusPill, Table, TextArea } from "@/components/ui";
import { type ApiError, api, fmtDate, useApi } from "@/lib/api";

type Ev = {
  name: string;
  edition: string;
  contacts: { role: string; name: string; phone: string | null }[];
  theme: string;
  description: string;
  venue_text: string | null;
  starts_at: string | null;
  ends_at: string | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  registration_open: boolean;
  reentry_policy: "single_entry" | "reentry_allowed";
  credential_valid_from: string | null;
  credential_valid_until: string | null;
  support_email: string | null;
  support_phone: string | null;
  privacy_notice: string;
  terms: string;
  faqs: { q: string; a: string }[];
};
type Category = {
  id: string;
  code: string;
  name: string;
  description: string;
  fee_minor: string;
  currency: string;
  capacity: number | null;
  requires_identity_check: boolean;
  is_active: boolean;
  active_registrations: number;
};
type Data = {
  event: Ev;
  categories: Category[];
  programme: { id: string; title: string; starts_at: string; location: string | null }[];
  options: { id: string; kind: string; label: string; sort: number; is_active: boolean; used: number }[];
};

const OPTION_KINDS = [
  ["patrol", "Patrols"],
  ["designation", "Designations"],
  ["meal_friday", "Friday meals"],
  ["meal_saturday", "Saturday meals"],
] as const;

/** One contact per line: Role | Name | Phone */
const contactsToText = (c: Ev["contacts"]) => c.map((x) => [x.role, x.name, x.phone ?? ""].join(" | ")).join("\n");
const textToContacts = (t: string) =>
  t
    .split("\n")
    .map((l) => l.split("|").map((p) => p.trim()))
    .filter((p) => p[0] && p[1])
    .map(([role = "", name = "", phone = ""]) => ({ role, name, phone: phone || null }));

/** datetime-local value (Lagos wall time) <-> ISO */
const toLocal = (v: string | null) => (v ? new Date(new Date(v).getTime() + 60 * 60_000).toISOString().slice(0, 16) : "");
const fromLocal = (v: FormDataEntryValue | null) => (v ? new Date(`${v}:00+01:00`).toISOString() : null);

export default function EventSettings() {
  const me = useMe();
  const { data, error, loading, reload } = useApi<Data>("/admin/event");
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = me.permissions.includes("event.configure");

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const e = data.event;

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      void reload();
    } catch (x) {
      setErr(x as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        title="Event settings"
        sub="Times are entered in Lagos time (WAT). Changes are recorded in the audit log with your reason."
      />
      <ErrorNote error={err} />
      {msg && <Alert tone="success">{msg}</Alert>}
      <form
        className="mt-4 grid max-w-3xl gap-5 sm:grid-cols-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          const reason = window.prompt("Reason for this change (audit log):");
          if (!reason) return;
          void run(async () => {
            await api("/admin/event", {
              method: "PUT",
              body: {
                name: f.get("name"),
                edition: f.get("edition") ?? "",
                contacts: textToContacts(String(f.get("contacts") ?? "")),
                theme: f.get("theme"),
                description: f.get("description"),
                venueText: f.get("venue") || null,
                startsAt: fromLocal(f.get("startsAt")),
                endsAt: fromLocal(f.get("endsAt")),
                registrationOpensAt: fromLocal(f.get("opens")),
                registrationClosesAt: fromLocal(f.get("closes")),
                registrationOpen: f.get("open") === "on",
                reentryPolicy: f.get("reentry"),
                credentialValidFrom: fromLocal(f.get("validFrom")),
                credentialValidUntil: fromLocal(f.get("validUntil")),
                supportEmail: f.get("supportEmail") || null,
                supportPhone: f.get("supportPhone") || null,
                privacyNotice: f.get("privacy"),
                terms: f.get("terms"),
                faqs: e.faqs,
                reason,
              },
            });
          }, "Event settings saved.");
        }}
      >
        <fieldset disabled={!canEdit} className="contents">
          <Field label="Event name" name="name" defaultValue={e.name} required />
          <Field label="Edition" name="edition" defaultValue={e.edition} placeholder="The 18th DNKI Converge" />
          <div className="sm:col-span-2">
            <Field label="Theme" name="theme" defaultValue={e.theme} />
          </div>
          <div className="sm:col-span-2">
            <TextArea
              label="Accreditation contacts"
              name="contacts"
              rows={3}
              defaultValue={contactsToText(e.contacts)}
              hint="One per line: Role | Name | Phone. Shown publicly on the event page."
            />
          </div>
          <div className="sm:col-span-2">
            <TextArea label="Overview" name="description" defaultValue={e.description} rows={4} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Venue" name="venue" defaultValue={e.venue_text ?? ""} />
          </div>
          <Field label="Starts" name="startsAt" type="datetime-local" defaultValue={toLocal(e.starts_at)} />
          <Field label="Ends" name="endsAt" type="datetime-local" defaultValue={toLocal(e.ends_at)} />
          <Field label="Registration opens" name="opens" type="datetime-local" defaultValue={toLocal(e.registration_opens_at)} />
          <Field
            label="Registration closes"
            name="closes"
            type="datetime-local"
            defaultValue={toLocal(e.registration_closes_at)}
          />
          <Field
            label="Passes valid from"
            name="validFrom"
            type="datetime-local"
            defaultValue={toLocal(e.credential_valid_from)}
          />
          <Field
            label="Passes valid until"
            name="validUntil"
            type="datetime-local"
            defaultValue={toLocal(e.credential_valid_until)}
          />
          <Select label="Gate policy" name="reentry" defaultValue={e.reentry_policy}>
            <option value="single_entry">Single entry — each pass admits once</option>
            <option value="reentry_allowed">Re-entry allowed — scan in and out</option>
          </Select>
          <label className="flex items-center gap-3 self-end pb-2 font-semibold">
            <input type="checkbox" name="open" defaultChecked={e.registration_open} className="size-5 accent-crimson" />
            Registration is open
          </label>
          <Field label="Support email" name="supportEmail" type="email" defaultValue={e.support_email ?? ""} />
          <Field label="Support phone" name="supportPhone" defaultValue={e.support_phone ?? ""} />
          <div className="sm:col-span-2">
            <TextArea
              label="Privacy notice (requires DNKI legal approval)"
              name="privacy"
              defaultValue={e.privacy_notice}
              rows={6}
            />
          </div>
          <div className="sm:col-span-2">
            <TextArea label="Registration terms (requires DNKI approval)" name="terms" defaultValue={e.terms} rows={6} />
          </div>
          {canEdit && (
            <div>
              <Button type="submit" busy={busy}>
                Save event settings
              </Button>
            </div>
          )}
        </fieldset>
      </form>

      <section className="mt-14">
        <h2 className="font-display text-3xl font-semibold">Registration categories and fees</h2>
        <p className="text-slate">
          Fee changes apply to new registrations only; existing registrations keep the fee they were created with.
        </p>
        <div className="mt-4">
          <Table head={["Code", "Name", "Fee", "Capacity", "ID check", "Status"]}>
            {data.categories.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">{c.code}</td>
                <td>{c.name}</td>
                <td>{formatMoney(c.fee_minor, c.currency)}</td>
                <td>
                  {c.active_registrations}
                  {c.capacity ? ` / ${c.capacity}` : " (no limit)"}
                </td>
                <td>{c.requires_identity_check ? "Yes" : "No"}</td>
                <td>
                  <StatusPill status={c.is_active ? "active" : "inactive"} />
                </td>
              </tr>
            ))}
          </Table>
        </div>
        {canEdit && (
          <form
            className="mt-6 grid max-w-3xl gap-4 border-2 border-line p-4 sm:grid-cols-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              const form = ev.currentTarget;
              const f = new FormData(form);
              const major = String(f.get("fee") ?? "");
              if (!/^\d+(\.\d{1,2})?$/.test(major)) {
                window.alert("Enter the fee as a number, e.g. 25000 or 25000.50");
                return;
              }
              const [w, fr = ""] = major.split(".");
              const feeMinor = Number(w) * 100 + Number(`${fr}00`.slice(0, 2));
              void run(async () => {
                await api("/admin/event/categories", {
                  body: {
                    code: f.get("code"),
                    name: f.get("cname"),
                    description: f.get("cdesc") ?? "",
                    feeMinor,
                    currency: f.get("currency"),
                    capacity: f.get("capacity") ? Number(f.get("capacity")) : null,
                    requiresIdentityCheck: f.get("idcheck") === "on",
                    isActive: true,
                    reason: f.get("creason"),
                  },
                });
                form.reset();
              }, "Category added.");
            }}
          >
            <h3 className="font-display text-xl font-semibold sm:col-span-3">Add a category</h3>
            <Field label="Code" name="code" required placeholder="STANDARD" />
            <Field label="Name" name="cname" required />
            <Field label="Fee (major units)" name="fee" required inputMode="decimal" placeholder="Approved fee" />
            <Field label="Currency" name="currency" required defaultValue="NGN" maxLength={3} />
            <Field label="Capacity (optional)" name="capacity" type="number" min={1} />
            <label className="flex items-center gap-3 self-end pb-2">
              <input type="checkbox" name="idcheck" className="size-5 accent-crimson" /> Photo ID check at gate
            </label>
            <div className="sm:col-span-3">
              <Field label="Description" name="cdesc" />
            </div>
            <div className="sm:col-span-2">
              <Field label="Reason (audit log)" name="creason" required minLength={3} />
            </div>
            <div className="self-end">
              <Button type="submit" variant="secondary" busy={busy}>
                Add category
              </Button>
            </div>
          </form>
        )}
      </section>

      <section className="mt-14">
        <h2 className="font-display text-3xl font-semibold">Registration choices</h2>
        <p className="text-slate">
          Options delegates pick from. Disable an option instead of deleting it; existing registrations keep their choice.
        </p>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          {OPTION_KINDS.map(([kind, title]) => {
            const items = data.options.filter((x) => x.kind === kind);
            return (
              <details key={kind} className="border-2 border-line p-4" open={kind !== "patrol"}>
                <summary className="cursor-pointer font-display text-xl font-semibold">
                  {title} ({items.filter((x) => x.is_active).length} active)
                </summary>
                <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto">
                  {items.map((x) => (
                    <li key={x.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className={x.is_active ? "" : "text-slate line-through"}>
                        {x.label} <span className="text-xs text-slate">({x.used})</span>
                      </span>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          className="min-h-0 px-0 text-sm"
                          onClick={() =>
                            run(
                              async () =>
                                void (await api(`/admin/event/options/${x.id}/active`, { body: { isActive: !x.is_active } })),
                              `${x.label} ${x.is_active ? "disabled" : "enabled"}.`,
                            )
                          }
                        >
                          {x.is_active ? "Disable" : "Enable"}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      const form = ev.currentTarget;
                      const label = String(new FormData(form).get("label") ?? "").trim();
                      if (!label) return;
                      void run(async () => {
                        await api("/admin/event/options", { body: { kind, label, sort: items.length + 1 } });
                        form.reset();
                      }, `${label} added.`);
                    }}
                  >
                    <label htmlFor={`add-${kind}`} className="sr-only">
                      Add to {title}
                    </label>
                    <input
                      id={`add-${kind}`}
                      name="label"
                      placeholder="Add option"
                      className="min-h-10 flex-1 rounded-sm border-2 border-line px-2"
                    />
                    <Button type="submit" variant="secondary" className="min-h-10 text-base">
                      Add
                    </Button>
                  </form>
                )}
              </details>
            );
          })}
        </div>
      </section>

      <section className="mt-14">
        <h2 className="font-display text-3xl font-semibold">Programme</h2>
        <ul className="mt-3 divide-y-2 divide-line border-y-2 border-line">
          {data.programme.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-3">
              <span>
                <strong>{p.title}</strong> — {fmtDate(p.starts_at)} {p.location ? `· ${p.location}` : ""}
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(
                      async () => void (await api(`/admin/event/programme/${p.id}`, { method: "DELETE" })),
                      "Programme item removed.",
                    )
                  }
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
          {data.programme.length === 0 && <li className="py-3 text-slate">No programme items yet.</li>}
        </ul>
        {canEdit && (
          <form
            className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              const form = ev.currentTarget;
              const f = new FormData(form);
              void run(async () => {
                await api("/admin/event/programme", {
                  body: {
                    title: f.get("title"),
                    startsAt: fromLocal(f.get("pstart")),
                    endsAt: fromLocal(f.get("pend")),
                    location: f.get("loc") || null,
                    description: f.get("pdesc") ?? "",
                  },
                });
                form.reset();
              }, "Programme item added.");
            }}
          >
            <Field label="Title" name="title" required />
            <Field label="Location" name="loc" />
            <Field label="Starts" name="pstart" type="datetime-local" required />
            <Field label="Ends" name="pend" type="datetime-local" />
            <div className="sm:col-span-2">
              <Field label="Description" name="pdesc" />
            </div>
            <div>
              <Button type="submit" variant="secondary" busy={busy}>
                Add programme item
              </Button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
