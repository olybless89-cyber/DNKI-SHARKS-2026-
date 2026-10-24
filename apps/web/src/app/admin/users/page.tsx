"use client";

import { useState } from "react";
import { SearchBar, useList } from "@/components/admin";
import { useMe } from "@/components/app-shell";
import { Alert, Button, ErrorNote, Loading, Pager, PageTitle, StatusPill, Table } from "@/components/ui";
import { type ApiError, api, fmtDate } from "@/lib/api";

type U = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  email_verified: boolean;
  mfa_enabled: boolean;
  created_at: string;
  roles: string[];
};

export default function Users() {
  const me = useMe();
  const list = useList<U>("/admin/users");
  const roles = (list.data as unknown as { roles?: { key: string; name: string }[] } | null)?.roles ?? [];
  const canManage = me.permissions.includes("user.manage_roles");
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
      <PageTitle
        title="Users and roles"
        sub="Role changes sign the user out everywhere so new permissions and MFA rules apply immediately."
      />
      <ErrorNote error={err} />
      {msg && <Alert tone="success">{msg}</Alert>}
      <SearchBar placeholder="Email or name" onSearch={list.setQ} />
      {list.loading && !list.data && <Loading />}
      {list.data && (
        <Table head={["Name", "Roles", "Security", "Status", "Joined", canManage ? "Manage" : ""]}>
          {list.data.items.map((u) => (
            <tr key={u.id}>
              <td>
                {u.full_name}
                <span className="block text-sm text-slate">{u.email}</span>
              </td>
              <td>
                <ul className="space-y-1">
                  {u.roles.map((r) => (
                    <li key={r} className="flex items-center gap-2">
                      <span>{roles.find((x) => x.key === r)?.name ?? r}</span>
                      {canManage && r !== "participant" && u.id !== me.user.id && (
                        <button
                          type="button"
                          className="text-sm text-crimson underline"
                          onClick={() => {
                            const reason = window.prompt(`Remove the ${r} role from ${u.full_name}? Reason:`);
                            if (reason)
                              void run(
                                () => api(`/admin/users/${u.id}/roles/${r}`, { method: "DELETE", body: { reason } }),
                                "Role removed.",
                              );
                          }}
                        >
                          remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </td>
              <td className="text-sm">
                {u.email_verified ? "Email verified" : "Email unverified"}
                <br />
                {u.mfa_enabled ? "MFA on" : "MFA off"}
              </td>
              <td>
                <StatusPill status={u.status} />
              </td>
              <td>{fmtDate(u.created_at, false)}</td>
              <td>
                {canManage && u.id !== me.user.id && (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const role = new FormData(e.currentTarget).get("role");
                      const reason = window.prompt(`Grant ${role} to ${u.full_name}? Reason (audit log):`);
                      if (reason) void run(() => api(`/admin/users/${u.id}/roles`, { body: { role, reason } }), "Role granted.");
                    }}
                  >
                    <label className="sr-only" htmlFor={`role-${u.id}`}>
                      Role to grant
                    </label>
                    <select id={`role-${u.id}`} name="role" className="min-h-9 rounded-sm border-2 border-line px-2">
                      {roles
                        .filter((r) => r.key !== "participant" && !u.roles.includes(r.key))
                        .map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                    <Button type="submit" variant="secondary" className="min-h-9 text-base">
                      Grant role
                    </Button>
                    <button
                      type="button"
                      className="text-left text-sm underline"
                      onClick={() => {
                        const next = u.status === "active" ? "suspended" : "active";
                        const reason = window.prompt(`Set ${u.full_name}'s account to ${next}? Reason:`);
                        if (reason)
                          void run(
                            () => api(`/admin/users/${u.id}/status`, { body: { status: next, reason } }),
                            `Account ${next}.`,
                          );
                      }}
                    >
                      {u.status === "active" ? "Suspend account" : "Reactivate account"}
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {list.data && <Pager page={list.page} pages={list.data.pages} onPage={list.setPage} />}
    </>
  );
}
