"use client";

import { SCAN_RESULT_DISPLAY, type ScanResult } from "@dnki/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx, ErrorNote, Field, Loading, Select, Wordmark } from "@/components/ui";
import { ApiError, api, fmtDate, type Me } from "@/lib/api";

type Context = {
  event: { name: string; reentryPolicy: "single_entry" | "reentry_allowed" };
  gates: { id: string; code: string; name: string }[];
  devices: { id: string; label: string; gate_id: string; last_seen_at: string | null }[];
  canOverride: boolean;
  canManualLookup: boolean;
  canRegisterDevice: boolean;
};

type ScanResponse = {
  result: ScanResult;
  detail: string | null;
  participant: { accreditationId: string; name: string; chapter: string; category: string } | null;
  previous: { at: string; gate: string | null } | null;
  credentialId?: string;
};

type Shown = ScanResponse & { input: { token?: string; accreditationId?: string } };

const STORE = "dnki.scanner";
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as { gateId?: string; deviceId?: string };
  } catch {
    return {};
  }
};
const save = (v: { gateId?: string; deviceId?: string }) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* storage unavailable: selection lasts for this page only */
  }
};

export default function Scanner() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Context | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [gateId, setGateId] = useState<string>("");
  const [deviceId, setDeviceId] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>("/auth/me");
      if (me.mfa.pending) return router.replace("/auth/mfa");
      if (me.mfa.enrollmentRequired) return router.replace("/account/security?enrol=1");
      const c = await api<Context>("/scanner/context");
      setCtx(c);
      const stored = load();
      const g = c.gates.find((x) => x.id === stored.gateId) ? stored.gateId : c.gates.length === 1 ? c.gates[0]?.id : "";
      setGateId(g ?? "");
      const d = c.devices.find((x) => x.id === stored.deviceId && x.gate_id === g);
      setDeviceId(d?.id ?? "");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return router.replace("/auth/login");
      setError(e as ApiError);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <Frame>
        <ErrorNote error={error} />
        <Link href="/admin" className="mt-4 inline-block underline">
          Back to admin
        </Link>
      </Frame>
    );
  }
  if (!ctx)
    return (
      <Frame>
        <Loading label="Loading gate assignment" />
      </Frame>
    );

  if (!gateId || !deviceId) {
    return (
      <Frame>
        <Setup
          ctx={ctx}
          gateId={gateId}
          onGate={(g) => {
            setGateId(g);
            setDeviceId("");
          }}
          onDevice={(d) => {
            setDeviceId(d);
            save({ gateId, deviceId: d });
          }}
          onRegistered={async (d) => {
            save({ gateId, deviceId: d });
            await refresh();
          }}
        />
      </Frame>
    );
  }

  const gate = ctx.gates.find((g) => g.id === gateId);
  return (
    <ScanStation
      ctx={ctx}
      gateId={gateId}
      gateName={gate?.name ?? ""}
      deviceId={deviceId}
      onChangeGate={() => {
        save({});
        setGateId("");
        setDeviceId("");
      }}
    />
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink text-paper">
      <header className="flex items-center justify-between px-4 py-3">
        <Wordmark invert />
        <span className="text-sm text-paper/70">Gate scanner</span>
      </header>
      <main id="main" className="mx-auto max-w-md bg-paper p-5 text-ink sm:mt-6">
        {children}
      </main>
    </div>
  );
}

function Setup({
  ctx,
  gateId,
  onGate,
  onDevice,
  onRegistered,
}: {
  ctx: Context;
  gateId: string;
  onGate: (g: string) => void;
  onDevice: (d: string) => void;
  onRegistered: (d: string) => Promise<void>;
}) {
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const devices = ctx.devices.filter((d) => d.gate_id === gateId);
  if (!ctx.gates.length) {
    return <p>You are not assigned to any gate. Ask the event administrator to assign you.</p>;
  }
  return (
    <div className="space-y-5">
      <h1 className="display text-4xl">Set up this scanner</h1>
      <ErrorNote error={err} />
      <Select label="Gate" value={gateId} onChange={(e) => onGate(e.target.value)}>
        <option value="">Choose your gate</option>
        {ctx.gates.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>
      {gateId && (
        <>
          {devices.length > 0 && (
            <Select label="This device" defaultValue="" onChange={(e) => e.target.value && onDevice(e.target.value)}>
              <option value="">Choose the label on this device</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
          {ctx.canRegisterDevice ? (
            <form
              className="space-y-3 border-t-2 border-line pt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const r = await api<{ id: string }>("/scanner/devices", {
                    body: { label: new FormData(e.currentTarget).get("label"), gateId },
                  });
                  await onRegistered(r.id);
                } catch (x) {
                  setErr(x as ApiError);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Register a new device" name="label" required minLength={2} placeholder="e.g. Gate A — Phone 3" />
              <Button type="submit" variant="secondary" busy={busy}>
                Register device
              </Button>
            </form>
          ) : devices.length === 0 ? (
            <p className="text-slate">
              No scanner devices are registered for this gate. Ask your gate supervisor to register this device.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

const ICONS: Record<string, string> = { check: "✓", cross: "✕", alert: "!", repeat: "↻" };

function ScanStation({
  ctx,
  gateId,
  gateName,
  deviceId,
  onChangeGate,
}: {
  ctx: Context;
  gateId: string;
  gateName: string;
  deviceId: string;
  onChangeGate: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState<"starting" | "on" | "off" | "denied">("starting");
  const [direction, setDirection] = useState<"entry" | "exit">("entry");
  const [online, setOnline] = useState(true);
  const [totals, setTotals] = useState<{ admitted: number; scans: number; denied: number } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [opError, setOpError] = useState<ApiError | null>(null);
  const lastText = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const pausedRef = useRef(false);
  pausedRef.current = Boolean(shown) || busy;

  const poll = useCallback(async () => {
    try {
      const h = await api<{ totals: { admitted: number; scans: number; denied: number }; serverTime: string }>(
        `/scanner/history?gateId=${gateId}`,
      );
      setTotals(h.totals);
      setLastSync(h.serverTime);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, [gateId]);

  useEffect(() => {
    void poll();
    const t = setInterval(poll, 15_000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [poll]);

  const submit = useCallback(
    async (input: { token?: string; accreditationId?: string }, extra: { identityConfirmed?: boolean } = {}) => {
      setBusy(true);
      setOpError(null);
      try {
        const r = await api<ScanResponse>("/scanner/scan", { body: { ...input, gateId, deviceId, direction, ...extra } });
        setShown({ ...r, input });
        if (navigator.vibrate) navigator.vibrate(SCAN_RESULT_DISPLAY[r.result].tone === "admit" ? 80 : [60, 60, 60, 60, 200]);
        void poll();
      } catch (e) {
        // Never show anything that could be read as an admission when the server could not decide.
        if (e instanceof ApiError && e.status !== 0 && e.status < 500) setOpError(e);
        else
          setShown({
            result: "TEMPORARY_SYSTEM_FAILURE",
            detail: "The server could not be reached or did not respond.",
            participant: null,
            previous: null,
            input,
          });
      } finally {
        setBusy(false);
      }
    },
    [gateId, deviceId, direction, poll],
  );

  useEffect(() => {
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    (async () => {
      if (!videoRef.current || !navigator.mediaDevices?.getUserMedia) {
        setCamera("off");
        return;
      }
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
        controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current, (res) => {
          if (!res || pausedRef.current) return;
          const text = res.getText();
          const now = Date.now();
          if (text === lastText.current.text && now - lastText.current.at < 4000) return;
          lastText.current = { text, at: now };
          void submit({ token: text });
        });
        if (cancelled) controls.stop();
        else setCamera("on");
      } catch (e) {
        setCamera((e as Error).name === "NotAllowedError" ? "denied" : "off");
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [submit]);

  async function override() {
    if (!shown?.credentialId) return;
    const reason = window.prompt("Reason for supervisor override (recorded in the audit log):");
    if (!reason || reason.trim().length < 10) {
      if (reason !== null) window.alert("Give a reason of at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      await api("/scanner/override", { body: { credentialId: shown.credentialId, gateId, deviceId, reason } });
      setShown({ ...shown, result: "VALID_ADMIT", detail: "Admitted by supervisor override" });
      void poll();
    } catch (e) {
      setOpError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const display = shown ? SCAN_RESULT_DISPLAY[shown.result] : null;

  return (
    <div className="flex min-h-dvh flex-col bg-ink text-paper">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <p className="font-display text-2xl font-semibold leading-none">{gateName}</p>
          <p className="text-sm text-paper/70">{ctx.event.name}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span
            className={cx(
              "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-semibold",
              online ? "bg-admit" : "bg-crimson",
            )}
          >
            <span aria-hidden className="size-2 rounded-full bg-paper" />
            {online ? "Online" : "Offline — do not admit"}
          </span>
          <button type="button" className="underline" onClick={onChangeGate}>
            Change gate
          </button>
        </div>
      </header>

      {ctx.event.reentryPolicy === "reentry_allowed" && (
        <div className="flex gap-2 px-4 pb-3" role="radiogroup" aria-label="Scan direction">
          {(["entry", "exit"] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              onClick={() => setDirection(d)}
              className={cx(
                "flex-1 rounded-sm border-2 py-2 font-display text-lg font-semibold",
                direction === d ? "border-paper bg-paper text-ink" : "border-paper/40",
              )}
            >
              {d === "entry" ? "Entry" : "Exit"}
            </button>
          ))}
        </div>
      )}

      <div className="relative mx-4 aspect-square max-h-[55dvh] overflow-hidden rounded-md bg-[#111] sm:mx-auto sm:w-[420px]">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        <div aria-hidden className="pointer-events-none absolute inset-[18%] border-4 border-paper/80" />
        {camera !== "on" && (
          <p className="absolute inset-0 z-10 flex items-center justify-center bg-[#111] p-6 text-center">
            {camera === "starting"
              ? "Starting camera…"
              : camera === "denied"
                ? "Camera permission was refused. Allow camera access, or use manual lookup."
                : "No camera available. Use manual lookup."}
          </p>
        )}
      </div>

      {opError && (
        <div className="mx-4 mt-3 bg-paper text-ink">
          <ErrorNote error={opError} />
        </div>
      )}

      {shown && display && (
        <section
          aria-live="assertive"
          className={cx(
            "fixed inset-0 z-30 flex flex-col p-6",
            display.tone === "admit" && "bg-admit text-paper",
            display.tone === "deny" && "bg-crimson text-paper",
            display.tone === "warn" && "bg-[#f4b740] text-ink",
          )}
        >
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span
              aria-hidden
              className="flex size-28 items-center justify-center rounded-full border-8 border-current display text-7xl"
            >
              {ICONS[display.icon]}
            </span>
            <h2 className="display mt-6 text-[clamp(2.5rem,10vw,4.5rem)]">{display.label}</h2>
            <p className="mt-3 max-w-md text-xl">{display.instruction}</p>
            {shown.detail && <p className="mt-2 max-w-md">{shown.detail}</p>}
            {shown.participant && (
              <div className="mt-6 w-full max-w-md bg-paper p-4 text-left text-ink">
                <p className="display text-3xl">{shown.participant.name}</p>
                <p>{shown.participant.chapter}</p>
                <p className="font-semibold">{shown.participant.category}</p>
                <p className="mt-1 font-display text-lg tracking-widest">{shown.participant.accreditationId}</p>
              </div>
            )}
            {shown.previous && (
              <p className="mt-4 text-lg">
                First admitted {fmtDate(shown.previous.at)} at {shown.previous.gate ?? "another gate"}
              </p>
            )}
          </div>
          <div className="mx-auto flex w-full max-w-md flex-col gap-3">
            {shown.result === "MANUAL_REVIEW_REQUIRED" && direction === "entry" && shown.input && (
              <Button variant="secondary" busy={busy} onClick={() => submit(shown.input, { identityConfirmed: true })}>
                Identity confirmed — admit
              </Button>
            )}
            {ctx.canOverride && shown.credentialId && ["ALREADY_CHECKED_IN", "MANUAL_REVIEW_REQUIRED"].includes(shown.result) && (
              <Button variant="secondary" busy={busy} onClick={override}>
                Supervisor override
              </Button>
            )}
            <Button variant="secondary" onClick={() => setShown(null)} autoFocus>
              Next scan
            </Button>
          </div>
        </section>
      )}

      <div className="mt-auto space-y-4 px-4 py-4">
        {ctx.canManualLookup && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = String(new FormData(e.currentTarget).get("id") ?? "")
                .trim()
                .toUpperCase();
              if (v) void submit({ accreditationId: v });
              e.currentTarget.reset();
            }}
          >
            <label htmlFor="manual" className="sr-only">
              Accreditation ID
            </label>
            <input
              id="manual"
              name="id"
              placeholder="DNKI-XXXXX-XXXXX"
              autoCapitalize="characters"
              autoComplete="off"
              className="min-h-11 flex-1 rounded-sm border-2 border-paper/40 bg-transparent px-3 font-display text-lg tracking-widest placeholder:text-paper/40"
            />
            <Button type="submit" busy={busy}>
              Look up
            </Button>
          </form>
        )}
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-paper/10 py-2">
            <dt className="text-xs text-paper/70">Admitted here</dt>
            <dd className="display text-3xl">{totals?.admitted ?? "—"}</dd>
          </div>
          <div className="bg-paper/10 py-2">
            <dt className="text-xs text-paper/70">Scans</dt>
            <dd className="display text-3xl">{totals?.scans ?? "—"}</dd>
          </div>
          <div className="bg-paper/10 py-2">
            <dt className="text-xs text-paper/70">Refused</dt>
            <dd className="display text-3xl">{totals?.denied ?? "—"}</dd>
          </div>
        </dl>
        <p className="text-center text-xs text-paper/60">
          Last synced {lastSync ? fmtDate(lastSync) : "never"}. Every decision is made online by the server.
        </p>
      </div>
    </div>
  );
}
