/** DNKI Converge 2026 delegate details: choice lists, declarations, passport photos, catering, export. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { one } from "../src/db/pool";
import {
  Client,
  device,
  makeApp,
  member,
  participant,
  passToken,
  regBody,
  registerAndPay,
  setupEvent,
  staff,
  type TestEnv,
  verifyMembership,
} from "./helpers";

// 1x1 transparent PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let env: TestEnv;
let ev: Awaited<ReturnType<typeof setupEvent>>;

beforeAll(async () => {
  env = await makeApp();
  ev = await setupEvent(env);
});
afterAll(async () => {
  await env.app.close();
  await env.ctx.db.end();
});

async function verified() {
  const p = await participant(env);
  await verifyMembership(env, p.c, await member(env));
  return p;
}

describe("public event details", () => {
  it("publishes the edition, theme, dates, contacts and choice lists from DNKI", async () => {
    const r = (await new Client(env.app).get("/public/event")).json();
    expect(r.event.name).toBe("SHARKS 2026 International Converge");
    expect(r.event.edition).toBe("The 18th DNKI Converge");
    expect(r.event.theme).toBe("Rebuilding the Brotherhood, Empowering Our Future");
    expect(r.event.startsAt).toBe("2026-12-09T23:00:00.000Z");
    expect(r.event.contacts.map((c: { role: string }) => c.role)).toEqual(["Director, Accreditation", "Skull Pilot Team"]);
    expect(r.options.patrol).toHaveLength(66);
    expect(r.options.designation.map((o: { label: string }) => o.label)).toEqual([
      "FF",
      "PAC",
      "Bot Member",
      "NEC",
      "Sailyn Council",
      "Deckhand",
    ]);
    expect(r.options.meal_friday).toHaveLength(4);
  });
});

describe("registration form rules", () => {
  it("requires the delegate details and declarations", async () => {
    const p = await verified();
    const bad = await p.c.post("/registrations", { categoryId: ev.categoryId, acceptTerms: true });
    expect(bad.statusCode).toBe(400);
    const fields = bad.json().error.details.map((d: { field: string }) => d.field);
    for (const f of [
      "norishName",
      "norsicalName",
      "patrolId",
      "designationId",
      "mealFridayId",
      "mealSaturdayId",
      "hardDrugs",
      "acceptConductRules",
    ]) {
      expect(fields).toContain(f);
    }
  });

  it("refuses a registration that does not accept the conduct rule", async () => {
    const p = await verified();
    expect((await p.c.post("/registrations", regBody(ev.categoryId, { acceptConductRules: false }))).statusCode).toBe(400);
  });

  it("rejects an option of the wrong kind or a disabled option", async () => {
    const p = await verified();
    const body = regBody(ev.categoryId);
    const swapped = await p.c.post("/registrations", { ...body, patrolId: body.designationId });
    expect(swapped.statusCode).toBe(400);
    expect(swapped.json().error.code).toBe("INVALID_OPTION");

    const admin = await staff(env, ["event_admin"]);
    const added = (await admin.c.post("/admin/event/options", { kind: "patrol", label: "Test Patrol MP", sort: 999 })).json();
    await admin.c.post(`/admin/event/options/${added.id}/active`, { isActive: false });
    const disabled = await p.c.post("/registrations", { ...body, patrolId: added.id });
    expect(disabled.json().error.code).toBe("INVALID_OPTION");
  });

  it("stores the delegate details and shows them to staff", async () => {
    const p = await verified();
    const reg = (
      await p.c.post("/registrations", regBody(ev.categoryId, { hardDrugs: "no", norsicalName: "Captain Synthetic" }))
    ).json();
    const admin = await staff(env, ["event_admin"]);
    const d = (await admin.c.get(`/admin/registrations/${reg.id}`)).json().registration;
    expect(d.norsical_name).toBe("Captain Synthetic");
    expect(d.patrol).toBe("Adaka MP");
    expect(d.designation).toBe("FF");
    expect(d.meal_friday).toBe("Jollof Rice/Fried Rice with Salad & Chicken");
    expect(d.hard_drugs_declaration).toBe("no");
    expect(d.conduct_rules_accepted_at).toBeTruthy();
  });
});

describe("passport photos", () => {
  it("accepts a real image and rejects mismatched or non-image data", async () => {
    const p = await verified();
    expect((await p.c.put("/me/photo", { contentType: "image/png", dataBase64: PNG })).statusCode).toBe(200);
    expect((await p.c.put("/me/photo", { contentType: "image/jpeg", dataBase64: PNG })).json().error.code).toBe("PHOTO_INVALID");
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    expect((await p.c.put("/me/photo", { contentType: "image/png", dataBase64: html })).json().error.code).toBe("PHOTO_INVALID");
    const own = await p.c.get("/me/photo");
    expect(own.statusCode).toBe(200);
    expect(own.headers["content-type"]).toBe("image/png");
    expect(own.headers["cache-control"]).toBe("no-store");
  });

  it("shows the photo to gate staff at scan time, but not to other participants", async () => {
    const sup = (await staff(env, ["gate_supervisor"])).c;
    const dev = await device(env, sup, ev.gates[0] as string);
    const p = await verified();
    await p.c.put("/me/photo", { contentType: "image/png", dataBase64: PNG });
    await registerAndPay(env, p.c, ev.categoryId);
    const scan = (
      await sup.post("/scanner/scan", { token: await passToken(env, p.c), gateId: ev.gates[0], deviceId: dev })
    ).json();
    expect(scan.result).toBe("VALID_ADMIT");
    expect(scan.participant.patrol).toBe("Adaka MP");
    expect(scan.participant.photoUrl).toMatch(/^\/api\/v1\/staff\/photos\/credential\//);
    const viaStaff = await sup.get(scan.participant.photoUrl.replace("/api/v1", ""));
    expect(viaStaff.statusCode).toBe(200);
    const stranger = await participant(env);
    expect((await stranger.c.get(scan.participant.photoUrl.replace("/api/v1", ""))).statusCode).toBe(403);
  });
});

describe("catering and export", () => {
  it("counts meals for confirmed delegates and exports delegate fields", async () => {
    const admin = await staff(env, ["event_admin"]);
    const before = (await admin.c.get("/admin/overview")).json().catering as { kind: string; label: string; delegates: number }[];
    const jollof = (c: typeof before) => c.find((x) => x.kind === "meal_friday" && x.label.startsWith("Jollof"))?.delegates ?? 0;
    const p = await verified();
    await registerAndPay(env, p.c, ev.categoryId);
    const after = (await admin.c.get("/admin/overview")).json().catering;
    expect(jollof(after)).toBe(jollof(before) + 1);

    const csv = await admin.c.get("/admin/exports/registrations.csv");
    const header = csv.body.split("\n")[0] ?? "";
    expect(header).toContain("patrol");
    expect(header).toContain("meal_saturday");
    expect(header).not.toContain("hard_drugs");
    expect(header).not.toContain("email");
  });

  it("keeps photo bytes out of list and export responses", async () => {
    const row = await one<{ n: number }>(env.ctx.db, "select count(*)::int as n from participant_photos");
    expect(row?.n).toBeGreaterThan(0);
    const admin = await staff(env, ["event_admin"]);
    const list = await admin.c.get("/admin/registrations");
    expect(list.body).not.toContain(PNG.slice(0, 20));
  });
});
