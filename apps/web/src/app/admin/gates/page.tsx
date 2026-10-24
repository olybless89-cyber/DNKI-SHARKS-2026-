"use client";

import { useState } from "react";
import { useMe } from "@/components/app-shell";
import { Alert, Button, ErrorNote, Field, Loading, PageTitle, StatusPill } from "@/components/ui";
import { type ApiError, api, fmtDate, useApi } from "@/lib/api";

type Gate = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  admitted: number;
  staff: { userId: string; name: string; email: string }[];
  devices: { id: string; label: string; active: boolean; lastSeenAt: string | null }[];
};

export default function Gates() {
  const me = useMe();
  const { data, error, loading, reload } = useApi<{ items: Gate[] }>("/admin/gates");
  const staffList = useApi<{ items: { id: string; full_name: string; email: string; roles: string[] }[] }>(
    me.permissions.includes("user.read") ? "/admin/users?staffOnly=true&pageSize=100" : null,
  );
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canManage = me.permissions.includes("gate.manage");
  const canDevices = me.permissions.includes("device.manage");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      void reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const gateStaff = (staffList.data?.items ?? []).filter((u) =>
    u.roles.some((r) => r === "accreditation_officer" || r === "gate_supervisor"),
  );

  return (
    <>
      <PageTitle title="Gates and scanners" sub="Scanner devices are registered from the scanner screen by a gate supervisor." />
      <ErrorNote error={err} />
      {msg && <Alert tone="success">{msg}</Alert>}
      <div className="mt-4 grid gap-6 xl:grid-cols-2">
        {data.items.map((g) => (
          <section key={g.id} className="border-2 border-ink p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-semibold">{g.name}</h2>
                <p className="text-slate">Code {g.code}</p>
              </div>
              <div className="text-right">
                <p className="display text-4xl">{g.admitted}</p>
                <p className="text-sm text-slate">admitted</p>
              </div>
            </div>
            {!g.is_active && <StatusPill status="inactive" />}
            <h3 className="mt-4 font-semibold">Assigned staff</h3>
            <ul className="mt-1 space-y-1">
              {g.staff.map((s) => (
                <li key={s.userId} className="flex items-center justify-between gap-2">
                  <span>
                    {s.name} <span className="text-sm text-slate">{s.email}</span>
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      className="min-h-0 text-base"
                      onClick={() =>
                        run(() => api(`/admin/gates/${g.id}/staff/${s.userId}`, { method: "DELETE" }), "Staff removed from gate.")
                      }
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
              {g.staff.length === 0 && <li className="text-slate">Nobody assigned. Supervisors can scan at any gate.</li>}
            </ul>
            {canManage && gateStaff.length > 0 && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const userId = new FormData(e.currentTarget).get("userId");
                  if (userId) void run(() => api(`/admin/gates/${g.id}/staff`, { body: { userId } }), "Staff assigned.");
                }}
              >
                <label htmlFor={`assign-${g.id}`} className="sr-only">
                  Assign staff
                </label>
                <select id={`assign-${g.id}`} name="userId" className="min-h-11 flex-1 rounded-sm border-2 border-line px-2">
                  {gateStaff.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.email})
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="secondary">
                  Assign
                </Button>
              </form>
            )}
            <h3 className="mt-4 font-semibold">Scanner devices</h3>
            <ul className="mt-1 space-y-1">
              {g.devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span>
                    {d.label} <span className="text-sm text-slate">last seen {fmtDate(d.lastSeenAt)}</span>
                  </span>
                  {d.active ? (
                    canDevices && (
                      <Button
                        variant="ghost"
                        className="min-h-0 text-base"
                        onClick={() =>
                          run(() => api(`/admin/devices/${d.id}/deactivate`, { method: "POST" }), "Device deactivated.")
                        }
                      >
                        Deactivate
                      </Button>
                    )
                  ) : (
                    <StatusPill status="inactive" />
                  )}
                </li>
              ))}
              {g.devices.length === 0 && <li className="text-slate">No devices registered.</li>}
            </ul>
          </section>
        ))}
      </div>
      {canManage && (
        <form
          className="mt-10 grid max-w-2xl gap-4 border-2 border-line p-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            void run(async () => {
              await api("/admin/gates", { body: { code: f.get("code"), name: f.get("name"), description: "", isActive: true } });
              form.reset();
            }, "Gate added.");
          }}
        >
          <h2 className="font-display text-xl font-semibold sm:col-span-3">Add a gate</h2>
          <Field label="Code" name="code" required placeholder="C" />
          <Field label="Name" name="name" required placeholder="Gate C — North" />
          <div className="self-end">
            <Button type="submit" variant="secondary">
              Add gate
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
