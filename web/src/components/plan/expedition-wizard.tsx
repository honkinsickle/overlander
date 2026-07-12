"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import type { Vehicle } from "@/lib/vehicles/types";
import { DEFAULT_RIG, vehicleTitle } from "@/lib/vehicles/types";
import {
  AVOID_OPTIONS,
  BUILD_OPTIONS,
  PREFERENCE_OPTIONS,
  type ExpeditionDestination,
  type ExpeditionForm,
} from "@/lib/plan/expedition";
import { generateExpeditionTripAction } from "@/lib/plan/expedition-actions";

const CAPABILITIES = ["mild", "moderate", "avoid-hardcore"] as const;
const BUDGETS = ["budget", "mid", "premium"] as const;
const RETURN_ROUTING = ["shortest", "scenic", "same", "loop"] as const;

const blankDestination = (): ExpeditionDestination => ({
  place: "",
  datePin: "flexible",
  date: null,
  dwell: 0,
  note: null,
});

// ── small styled primitives (globals.css tokens only) ────────────────
const fieldCls =
  "h-10 px-3 rounded-lg bg-input-surface border border-input-border text-sm text-text-primary placeholder:text-text-muted focus:border-input-border-focus focus:outline-none";
const labelCls = "block font-mono text-[11px] uppercase tracking-wider text-text-muted mb-1.5";

function Chip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`h-8 px-3 rounded-full border text-sm transition-colors ${
        active
          ? "border-amber text-amber bg-amber/10 font-semibold"
          : "border-input-border text-text-muted hover:border-input-border-hover"
      }`}
    >
      {label}
    </button>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-panel border border-input-border p-5">
      <h2 className="font-display text-lg text-text-primary tracking-wide">{title}</h2>
      {hint && <p className="text-sm text-text-secondary mt-1 mb-4">{hint}</p>}
      <div className={hint ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

export function ExpeditionWizard({ vehicles }: { vehicles: Vehicle[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const firstVehicle = vehicles[0];
  const [destinations, setDestinations] = useState<ExpeditionDestination[]>([
    blankDestination(),
    blankDestination(),
  ]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState<ExpeditionForm["budget"]>("mid");
  const [maxDailyDriveMi, setMaxDailyDriveMi] = useState(350);
  const [bufferDays, setBufferDays] = useState(0);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [returnRouting, setReturnRouting] =
    useState<ExpeditionForm["returnRouting"]>("shortest");
  const [vehicleId, setVehicleId] = useState(firstVehicle?.id ?? "");
  const [rig, setRig] = useState(firstVehicle?.rig ?? DEFAULT_RIG);

  const lastIdx = destinations.length - 1;

  const setDest = (i: number, patch: Partial<ExpeditionDestination>) =>
    setDestinations((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const move = (i: number, dir: -1 | 1) =>
    setDestinations((ds) => {
      const j = i + dir;
      if (j < 0 || j >= ds.length) return ds;
      const next = [...ds];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  // Selecting a vehicle loads its saved rig as the starting point (§02 saved-once).
  const onVehicle = (id: string) => {
    setVehicleId(id);
    const v = vehicles.find((x) => x.id === id);
    if (v) setRig(v.rig ?? DEFAULT_RIG);
  };

  // End date binds to the end destination's FIXED date (same value).
  const setEnd = (v: string) => {
    setEndDate(v);
    setDestinations((ds) =>
      ds.map((d, j) =>
        j === ds.length - 1 && d.datePin === "fixed" ? { ...d, date: v } : d,
      ),
    );
  };

  const submit = () => {
    setError(null);
    const v = vehicles.find((x) => x.id === vehicleId);
    const form: ExpeditionForm = {
      destinations,
      startDate,
      endDate,
      objective,
      budget,
      maxDailyDriveMi,
      bufferDays,
      avoid,
      returnRouting,
      vehicleId,
      vehicleTitle: v ? vehicleTitle(v) : "",
      rig,
    };
    startTransition(async () => {
      const res = await generateExpeditionTripAction(form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/trip/${res.tripId}`);
    });
  };

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 flex flex-col gap-5">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-widest text-amber">
          YoTrippin · plan an expedition
        </p>
        <h1 className="font-display text-3xl text-text-primary mt-1">
          Where are you going?
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Give it your destinations and a few details — it plans the whole trip
          between them.
        </p>
      </header>

      {/* ── Destinations — the primary control ─────────────────────── */}
      <Section
        title="Your destinations"
        hint="Start, the places you want to hit, and where you end. Pin a date if it's fixed; set dwell for layover days."
      >
        <div className="flex flex-col gap-3">
          {destinations.map((d, i) => (
            <div
              key={i}
              className="rounded-lg bg-input-surface/40 border border-input-border p-3 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-amber w-12 shrink-0">
                  {i === 0 ? "START" : i === lastIdx ? "END" : `STOP ${i}`}
                </span>
                <input
                  className={`${fieldCls} flex-1`}
                  placeholder="City or destination (e.g. Dawson City, YT)"
                  value={d.place}
                  onChange={(e) => setDest(i, { place: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-text-muted hover:text-text-primary disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === lastIdx}
                  className="text-text-muted hover:text-text-primary disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDestinations((ds) => ds.filter((_, j) => j !== i))
                  }
                  disabled={destinations.length <= 2}
                  className="text-text-muted hover:text-input-error disabled:opacity-30"
                  aria-label="Remove"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap pl-14">
                <div className="inline-flex rounded-full border border-input-border overflow-hidden text-xs">
                  {(["fixed", "flexible"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setDest(i, {
                          datePin: p,
                          date: p === "fixed" ? d.date : null,
                        })
                      }
                      className={`px-3 h-7 ${
                        d.datePin === p
                          ? "bg-amber text-bg-base font-semibold"
                          : "text-text-muted"
                      }`}
                    >
                      {p === "fixed" ? "FIXED date" : "flexible"}
                    </button>
                  ))}
                </div>
                {d.datePin === "fixed" && (
                  <input
                    type="date"
                    className={`${fieldCls} h-7 text-xs`}
                    value={d.date ?? ""}
                    onChange={(e) => setDest(i, { date: e.target.value })}
                  />
                )}
                <label className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                  dwell
                  <input
                    type="number"
                    min={0}
                    max={30}
                    className={`${fieldCls} h-7 w-16 text-xs`}
                    value={d.dwell}
                    onChange={(e) =>
                      setDest(i, { dwell: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                  <span className="text-text-muted/60">days</span>
                </label>
                <input
                  className={`${fieldCls} h-7 flex-1 min-w-[120px] text-xs`}
                  placeholder="note (optional)"
                  value={d.note ?? ""}
                  onChange={(e) => setDest(i, { note: e.target.value || null })}
                />
              </div>
            </div>
          ))}
          {destinations.length < 8 && (
            <button
              type="button"
              onClick={() =>
                setDestinations((ds) => [
                  ...ds.slice(0, -1),
                  blankDestination(),
                  ds[ds.length - 1],
                ])
              }
              className="inline-flex items-center gap-1.5 h-9 px-3 self-start rounded-full border border-dashed border-input-border text-sm text-text-secondary hover:border-amber hover:text-amber"
            >
              <Plus className="w-4 h-4" /> Add a stop
            </button>
          )}
        </div>
      </Section>

      {/* ── Trip details (§01) ─────────────────────────────────────── */}
      <Section title="Trip details">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Start date</label>
            <input
              type="date"
              className={`${fieldCls} w-full`}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>End date</label>
            <input
              type="date"
              className={`${fieldCls} w-full`}
              value={endDate}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Objective / vibe (optional)</label>
            <input
              className={`${fieldCls} w-full`}
              placeholder="e.g. slow, scenic, solitude — no rushed days"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Budget</label>
            <select
              className={`${fieldCls} w-full`}
              value={budget}
              onChange={(e) => setBudget(e.target.value as ExpeditionForm["budget"])}
            >
              {BUDGETS.map((b) => (
                <option key={b} value={b}>
                  {b === "mid" ? "mid-range" : b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Return routing</label>
            <select
              className={`${fieldCls} w-full`}
              value={returnRouting}
              onChange={(e) =>
                setReturnRouting(e.target.value as ExpeditionForm["returnRouting"])
              }
            >
              {RETURN_ROUTING.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>
              Max daily drive · {maxDailyDriveMi} mi
            </label>
            <input
              type="range"
              min={100}
              max={700}
              step={25}
              value={maxDailyDriveMi}
              onChange={(e) => setMaxDailyDriveMi(Number(e.target.value))}
              className="w-full accent-amber"
            />
          </div>
          <div>
            <label className={labelCls}>Buffer days</label>
            <input
              type="number"
              min={0}
              max={30}
              className={`${fieldCls} w-full`}
              value={bufferDays}
              onChange={(e) => setBufferDays(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Avoid</label>
            <div className="flex gap-2 flex-wrap">
              {AVOID_OPTIONS.map((a) => (
                <Chip
                  key={a}
                  label={a}
                  active={avoid.includes(a)}
                  onToggle={() => setAvoid((l) => toggle(l, a))}
                />
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Rig (§02) ──────────────────────────────────────────────── */}
      <Section title="Your rig" hint="Saved on the vehicle — reused across trips.">
        <div className="flex flex-col gap-4">
          <div>
            <label className={labelCls}>Vehicle</label>
            <select
              className={`${fieldCls} w-full`}
              value={vehicleId}
              onChange={(e) => onVehicle(e.target.value)}
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {vehicleTitle(v)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Build</label>
            <div className="flex gap-2 flex-wrap">
              {BUILD_OPTIONS.map((b) => (
                <Chip
                  key={b}
                  label={b}
                  active={rig.build.includes(b)}
                  onToggle={() => setRig((r) => ({ ...r, build: toggle(r.build, b) }))}
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Fuel range · {rig.fuelRangeMi} mi</label>
              <input
                type="number"
                min={50}
                max={1000}
                step={10}
                className={`${fieldCls} w-full`}
                value={rig.fuelRangeMi}
                onChange={(e) =>
                  setRig((r) => ({ ...r, fuelRangeMi: Number(e.target.value) || 0 }))
                }
              />
            </div>
            <div>
              <label className={labelCls}>Capability</label>
              <select
                className={`${fieldCls} w-full`}
                value={rig.capability}
                onChange={(e) =>
                  setRig((r) => ({
                    ...r,
                    capability: e.target.value as (typeof CAPABILITIES)[number],
                  }))
                }
              >
                {CAPABILITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Group size</label>
              <input
                className={`${fieldCls} w-full`}
                value={rig.groupSize}
                onChange={(e) => setRig((r) => ({ ...r, groupSize: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Skill</label>
              <input
                className={`${fieldCls} w-full`}
                value={rig.skill}
                onChange={(e) => setRig((r) => ({ ...r, skill: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Preferences</label>
            <div className="flex gap-2 flex-wrap">
              {PREFERENCE_OPTIONS.map((p) => (
                <Chip
                  key={p}
                  label={p}
                  active={rig.preferences.includes(p)}
                  onToggle={() =>
                    setRig((r) => ({ ...r, preferences: toggle(r.preferences, p) }))
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </Section>

      {error && (
        <p className="text-sm text-input-error bg-input-error/10 border border-input-error/30 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="h-12 rounded-full bg-amber text-bg-base font-display text-base tracking-wide hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
      >
        {pending ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" /> Generating your expedition…
          </>
        ) : (
          "Generate the expedition"
        )}
      </button>
      <p className="text-center text-xs text-text-muted">
        Runs the grounded planner + audit. Persists to the TEST project only.
      </p>
    </div>
  );
}
