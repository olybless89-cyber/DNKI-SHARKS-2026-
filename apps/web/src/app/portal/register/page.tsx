"use client";

import { formatMoney } from "@dnki/shared";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, ErrorNote, Field, Loading, PageTitle, Select } from "@/components/ui";
import { ApiError, api, useApi } from "@/lib/api";

type Opt = { id: string; label: string };
type PublicEvent = {
  event: { name: string; edition: string; registration: { open: boolean; reason: string | null } };
  categories: {
    id: string;
    name: string;
    description: string;
    fee_minor: string;
    currency: string;
    requires_identity_check: boolean;
  }[];
  options: { patrol: Opt[]; designation: Opt[]; meal_friday: Opt[]; meal_saturday: Opt[] };
};

/** Downscale a photo in the browser so uploads stay small (max 800 px, JPEG). */
async function preparePhoto(file: File): Promise<{ contentType: "image/jpeg"; dataBase64: string; previewUrl: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new ApiError(400, "PHOTO_INVALID", "Choose a JPEG, PNG or WebP photo.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { contentType: "image/jpeg", dataBase64: dataUrl.split(",")[1] ?? "", previewUrl: dataUrl };
}

export default function Register() {
  const { data, error, loading } = useApi<PublicEvent>("/public/event");
  const [category, setCategory] = useState<string>("");
  const [photo, setPhoto] = useState<{ previewUrl: string; uploaded: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const chosen = data.categories.find((c) => c.id === category);
  const o = data.options;

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setErr(null);
    try {
      const p = await preparePhoto(file);
      await api("/me/photo", { method: "PUT", body: { contentType: p.contentType, dataBase64: p.dataBase64 } });
      setPhoto({ previewUrl: p.previewUrl, uploaded: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError(400, "PHOTO_INVALID", "That photo could not be used. Try another."));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      const reg = await api<{ id: string }>("/registrations", {
        body: {
          categoryId: category,
          norishName: f.get("norishName"),
          norsicalName: f.get("norsicalName"),
          patrolId: f.get("patrolId"),
          designationId: f.get("designationId"),
          mealFridayId: f.get("mealFridayId"),
          mealSaturdayId: f.get("mealSaturdayId"),
          hardDrugs: f.get("hardDrugs"),
          acceptConductRules: f.get("conduct") === "on",
          acceptTerms: f.get("terms") === "on",
        },
      });
      const checkout = await api<{ checkoutUrl: string }>(`/registrations/${reg.id}/checkout`, { method: "POST" });
      window.location.assign(checkout.checkoutUrl);
    } catch (e2) {
      setErr(e2 as ApiError);
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <>
      <PageTitle title="Complete registration" sub={`${data.event.edition} · ${data.event.name}`} />
      {!data.event.registration.open ? (
        <Alert tone="info" title={data.event.registration.reason ?? "Registration is closed."} />
      ) : (
        <form onSubmit={submit} className="max-w-2xl space-y-10">
          <ErrorNote error={err} />

          <fieldset className="space-y-5">
            <legend className="mb-4 font-display text-2xl font-semibold">Delegate details</legend>
            <Field label="Norish name" name="norishName" required minLength={2} maxLength={120} autoComplete="name" />
            <Field label="Norsical name" name="norsicalName" required minLength={2} maxLength={120} />
            <Select label="Patrol" name="patrolId" required defaultValue="">
              <option value="" disabled>
                Select your patrol
              </option>
              {o.patrol.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </Select>
            <Select label="Designation" name="designationId" required defaultValue="">
              <option value="" disabled>
                Select your designation
              </option>
              {o.designation.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </Select>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-2 font-display text-2xl font-semibold">Passport photo</legend>
            <p className="text-slate">
              Gate staff compare this photo with you at entry. Use a clear, recent, front-facing photo.
            </p>
            <div className="flex items-center gap-5">
              {photo ? (
                // biome-ignore lint/performance/noImgElement: local preview of the selected file
                <img
                  src={photo.previewUrl}
                  alt="Your passport photo"
                  className="h-32 w-26 rounded-sm border-2 border-ink object-cover"
                />
              ) : (
                <span className="flex h-32 w-26 items-center justify-center rounded-sm border-2 border-dashed border-line text-sm text-slate">
                  No photo
                </span>
              )}
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-sm border-2 border-ink px-5 font-display text-lg font-semibold hover:bg-fog">
                {photoBusy ? "Uploading…" : photo ? "Change photo" : "Upload photo"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => onPhoto(e.target.files?.[0])}
                />
              </label>
            </div>
            {photo?.uploaded && <p className="text-sm text-admit">Photo saved.</p>}
          </fieldset>

          <fieldset className="space-y-5">
            <legend className="mb-4 font-display text-2xl font-semibold">Meals on arrival</legend>
            <Select label="What would you like to eat on Friday?" name="mealFridayId" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {o.meal_friday.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </Select>
            <Select label="What would you like to eat on Saturday?" name="mealSaturdayId" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              {o.meal_saturday.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </Select>
          </fieldset>

          <fieldset>
            <legend className="font-display text-2xl font-semibold">Registration category</legend>
            {data.categories.length === 0 && <p className="mt-3 text-slate">No categories are available yet.</p>}
            <div className="mt-4 space-y-3">
              {data.categories.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-start gap-4 border-2 border-line p-4 has-[:checked]:border-crimson has-[:checked]:bg-[#fdf0f2]"
                >
                  <input
                    type="radio"
                    name="category"
                    value={c.id}
                    checked={category === c.id}
                    onChange={() => setCategory(c.id)}
                    className="mt-1.5 size-5 accent-crimson"
                    required
                  />
                  <span className="flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-display text-2xl font-semibold">{c.name}</span>
                      <span className="display text-2xl">{formatMoney(c.fee_minor, c.currency)}</span>
                    </span>
                    {c.description && <span className="block text-slate">{c.description}</span>}
                    {c.requires_identity_check && (
                      <span className="block text-sm text-slate">Photo ID is checked at the gate.</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-4 border-t-2 border-ink pt-6">
            <legend className="sr-only">Declarations</legend>
            <h2 className="font-display text-2xl font-semibold">Declarations</h2>
            <Select label="Do you use hard drugs or any obnoxious substance?" name="hardDrugs" required defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
            <label className="flex items-start gap-3">
              <input type="checkbox" name="conduct" className="mt-1 size-5 accent-crimson" required />
              <span>
                I agree to all the rules prohibiting the use of hard drugs and other obnoxious substances at Norsical activities,
                and I agree to face the consequences of violating them.
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" name="terms" className="mt-1 size-5 accent-crimson" required />
              <span>
                I accept the{" "}
                <Link href="/terms" target="_blank" className="underline">
                  registration terms
                </Link>{" "}
                and understand my pass is personal and admits me once.
              </span>
            </label>
          </fieldset>

          <div className="space-y-3">
            {chosen ? (
              <p>
                You will pay <strong>{formatMoney(chosen.fee_minor, chosen.currency)}</strong> through our payment provider's
                secure checkout. Your accreditation pass is issued only after the payment is verified.
              </p>
            ) : (
              <p className="text-slate">Choose a category to see the fee.</p>
            )}
            {!photo && (
              <p className="text-sm text-warn">
                You have not uploaded a passport photo. You can still register, but entry may take longer.
              </p>
            )}
            <Button type="submit" busy={busy} disabled={!category}>
              Submit and continue to payment
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
