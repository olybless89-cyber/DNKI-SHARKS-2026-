"use client";

import { useState } from "react";
import { Alert, Button, ErrorNote, Field, Loading, PageTitle, Select, StatusPill, TextArea } from "@/components/ui";
import { type ApiError, api, fmtDate, useApi } from "@/lib/api";

type Item = {
  id: string;
  title: string;
  body: string;
  kind: string;
  url: string | null;
  status: string;
  published_at: string | null;
  created_at: string;
};

export default function Content() {
  const { data, error, loading, reload } = useApi<{ items: Item[] }>("/admin/announcements");
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(body: Record<string, unknown>, id?: string) {
    setErr(null);
    setMsg(null);
    try {
      await api(id ? `/admin/announcements/${id}` : "/admin/announcements", { method: id ? "PUT" : "POST", body });
      setMsg(id ? "Updated." : "Saved.");
      void reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <>
      <PageTitle
        title="Public content"
        sub="Everything here is PUBLIC and appears on the event page. Never link members-only streams here."
      />
      <Alert tone="warn" title="Public only">
        Facebook broadcasts are public: anyone with the link can watch, and this platform cannot restrict who views them.
        Protected member sessions are configured separately under streaming (Phase 5).
      </Alert>
      <ErrorNote error={err} />
      {msg && (
        <div className="mt-4">
          <Alert tone="success">{msg}</Alert>
        </div>
      )}
      <form
        className="mt-6 grid max-w-2xl gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          void save({
            title: f.get("title"),
            body: f.get("body") ?? "",
            kind: f.get("kind"),
            url: f.get("url") || null,
            status: f.get("status"),
          }).then(() => form.reset());
        }}
      >
        <h2 className="font-display text-2xl font-semibold">New public item</h2>
        <Select label="Type" name="kind">
          <option value="announcement">Announcement</option>
          <option value="facebook_broadcast">Facebook broadcast (public)</option>
          <option value="link">Link</option>
        </Select>
        <Field label="Title" name="title" required minLength={3} />
        <TextArea label="Text" name="body" rows={3} />
        <Field
          label="Link (https only; required for broadcasts and links)"
          name="url"
          type="url"
          placeholder="https://www.facebook.com/…"
        />
        <Select label="Status" name="status" defaultValue="draft">
          <option value="draft">Draft</option>
          <option value="published">Publish now</option>
        </Select>
        <div>
          <Button type="submit">Save</Button>
        </div>
      </form>
      <section className="mt-12">
        <h2 className="font-display text-2xl font-semibold">All items</h2>
        {loading && !data && <Loading />}
        <ErrorNote error={error} />
        <ul className="mt-3 space-y-3">
          {data?.items.map((a) => (
            <li key={a.id} className="border-2 border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  <span className="mr-2 border border-ink px-1 text-sm">PUBLIC</span>
                  {a.title}
                </p>
                <StatusPill status={a.status} />
              </div>
              <p className="text-sm text-slate">
                {a.kind.replace(/_/g, " ")} ·{" "}
                {a.published_at ? `published ${fmtDate(a.published_at)}` : `created ${fmtDate(a.created_at)}`}
              </p>
              {a.url && <p className="text-sm break-all">{a.url}</p>}
              <div className="mt-2 flex gap-3">
                {a.status !== "published" && (
                  <Button variant="secondary" onClick={() => save({ ...a, status: "published" }, a.id)}>
                    Publish
                  </Button>
                )}
                {a.status !== "archived" && (
                  <Button variant="ghost" onClick={() => save({ ...a, status: "archived" }, a.id)}>
                    Archive
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
