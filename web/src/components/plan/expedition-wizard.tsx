"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, ArrowUp, ArrowDown, Loader2, Minus, Check } from "lucide-react";
import type { Vehicle } from "@/lib/vehicles/types";
import { DEFAULT_RIG, vehicleTitle } from "@/lib/vehicles/types";
import { LocationAutocomplete } from "@/components/plan/location-autocomplete";
import { CoordinateInput } from "@/components/plan/coordinate-input";
import { DateRangeInput } from "@/components/plan/date-range-input";
import { SelectableChip } from "@/components/plan/selectable-chip";
import { GUARANTEE_CHIP_CATEGORIES } from "@/lib/plan/guarantee-categories";
import {
  AVOID_OPTIONS,
  BUILD_OPTIONS,
  PREFERENCE_OPTIONS,
  normalizePreferences,
  validateExpeditionForm,
  type ExpeditionDestination,
  type ExpeditionForm,
} from "@/lib/plan/expedition";
import { generateExpeditionTripAction } from "@/lib/plan/expedition-actions";
import { PLANNING_REGION_NAMES } from "@/lib/plan/planning-region";

const CAPABILITIES = ["mild", "moderate", "avoid-hardcore"] as const;
const BUDGETS = ["budget", "mid", "premium"] as const;
const RETURN_ROUTING = ["shortest", "scenic", "same", "loop"] as const;
const AMBER = "var(--amber)";

type Dest = ExpeditionDestination & { id: number };

const fieldCls =
  "h-10 px-3 rounded-lg bg-input-surface border border-input-border text-sm text-text-primary focus:border-input-border-focus focus:outline-none";
const labelCls =
  "block font-mono text-[11px] uppercase tracking-wider text-text-muted mb-1.5";

function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="inline-flex items-center rounded-lg border border-input-border bg-input-surface h-10">
      <button
        type="button"
        onClick={() => onChange(clamp(value - step))}
        className="w-9 h-full grid place-items-center text-text-muted hover:text-text-primary disabled:opacity-30"
        disabled={value <= min}
        aria-label="decrease"
      >
        <Minus className="w-4 h-4" />
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        className="w-12 bg-transparent text-center text-sm text-text-primary focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(clamp(value + step))}
        className="w-9 h-full grid place-items-center text-text-muted hover:text-text-primary disabled:opacity-30"
        disabled={value >= max}
        aria-label="increase"
      >
        <Plus className="w-4 h-4" />
      </button>
      {suffix && <span className="pr-3 text-xs text-text-muted">{suffix}</span>}
    </div>
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

function ChipGroup({
  options,
  selected,
  onToggle,
  name,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
  name: string;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((o) => (
        <SelectableChip
          key={o}
          id={o}
          label={o}
          accent={AMBER}
          name={name}
          checked={selected.includes(o)}
          onChange={() => onToggle(o)}
        />
      ))}
    </div>
  );
}

export function ExpeditionWizard({ vehicles }: { vehicles: Vehicle[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const nextId = useRef(2);

  const firstVehicle = vehicles[0];
  const [destinations, setDestinations] = useState<Dest[]>([
    { id: 0, place: "", coords: null, region: null, manualCoords: false, datePin: "flexible", date: null, dwell: 0, note: null },
    { id: 1, place: "", coords: null, region: null, manualCoords: false, datePin: "flexible", date: null, dwell: 0, note: null },
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
  // Seeded through normalizePreferences so a rig saved before an option was
  // retired can't keep an invisible, un-untickable preference (it would still
  // ride into the LLM payload via `rig`).
  const [rig, setRig] = useState(() => {
    const seeded = firstVehicle?.rig ?? DEFAULT_RIG;
    return { ...seeded, preferences: normalizePreferences(seeded.preferences) };
  });
  // Interest-Category-Chips. Holds the user-selected guarantee categories as
  // `SlideCategoryKey` strings — `fuel` from the checkbox (live-resolve path)
  // plus any of the 6 pool-side chips (`GUARANTEE_CHIP_CATEGORIES`). Forwarded
  // to the audit via `ExpeditionForm.guaranteedCategories`.
  const [guaranteedCategories, setGuaranteedCategories] = useState<string[]>([]);

  const lastIdx = destinations.length - 1;
  const setDest = (id: number, patch: Partial<ExpeditionDestination>) =>
    setDestinations((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
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

  const onVehicle = (id: string) => {
    setVehicleId(id);
    const v = vehicles.find((x) => x.id === id);
    if (v) {
      const seeded = v.rig ?? DEFAULT_RIG;
      setRig({ ...seeded, preferences: normalizePreferences(seeded.preferences) });
    }
  };

  // Dates come from the shared range picker and reach the pipeline as
  // `TripParams.startDate/endDate`. This used to ALSO copy the end date onto the
  // end destination's anchor when that anchor was pinned FIXED; that mirroring is
  // gone with the start/end date-pin toggle, which was the only way to pin them.
  const onDates = (s: string, e: string) => {
    setStartDate(s);
    setEndDate(e);
  };

  const form: ExpeditionForm = useMemo(() => {
    const v = vehicles.find((x) => x.id === vehicleId);
    const end = destinations.length - 1;
    return {
      // START and END are normalized to flexible/null, matching the hidden
      // toggle below. This is not just tidiness: rows are REORDERABLE, so a
      // middle stop set to FIXED can be moved into first/last position, where
      // its control is no longer rendered. Without this, `validateExpeditionForm`
      // could reject "A FIXED destination needs a date" for a row the user can
      // no longer see or edit — an unfixable form.
      destinations: destinations.map(({ id: _id, ...d }, i) =>
        i === 0 || i === end ? { ...d, datePin: "flexible" as const, date: null } : d,
      ),
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
      // Cast: `guaranteedCategories` is stored as `string[]` in local state so
      // one setter serves any future chip additions without a type churn;
      // ExpeditionForm requires `SlideCategoryKey[]`. Values fed in today are
      // hardcoded `"fuel"` from the checkbox below, so the cast is safe.
      guaranteedCategories: guaranteedCategories as ExpeditionForm["guaranteedCategories"],
    };
  }, [destinations, startDate, endDate, objective, budget, maxDailyDriveMi, bufferDays, avoid, returnRouting, vehicleId, rig, guaranteedCategories, vehicles]);

  const validationError = validateExpeditionForm(form);
  const isValid = validationError === null;

  const submit = () => {
    setSubmitted(true);
    setServerError(null);
    if (!isValid) return;
    startTransition(async () => {
      const res = await generateExpeditionTripAction(form);
      if (!res.ok) {
        setServerError(res.error);
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
      {/* The planning-region sentence is appended to the EXISTING hint rather
       *  than given its own element: `Section`'s `hint` is the established
       *  helper-text slot in this wizard. A silent filter is the failure mode
       *  here — someone typing "Boise" gets an empty list and no reason why.
       *  "for now" marks it as the current limit, not a permanent policy. */}
      <Section
        title="Your destinations"
        hint={`Type a city and PICK it from the list so it lands on the real place. Start, the stops you want, and where you end. Planning covers ${PLANNING_REGION_NAMES} for now — places outside those states won't appear in the list.`}
      >
        <div className="flex flex-col gap-3">
          {destinations.map((d, i) => {
            const unresolved = submitted && d.place.trim() !== "" && !d.coords;
            return (
              <div
                key={d.id}
                className="rounded-lg bg-input-surface/40 border border-input-border p-3 flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-amber w-12 shrink-0">
                    {i === 0 ? "START" : i === lastIdx ? "END" : `STOP ${i}`}
                  </span>
                  <div className="flex-1">
                    {d.manualCoords ? (
                      <CoordinateInput
                        defaultLat={d.coords?.[1]}
                        defaultLng={d.coords?.[0]}
                        invalid={unresolved}
                        onResolve={(coords, label) =>
                          setDest(d.id, { place: label, coords, region: null })
                        }
                      />
                    ) : (
                      <LocationAutocomplete
                        name={`dest-${d.id}`}
                        placeholder="City or destination (e.g. Dawson City)"
                        defaultValue={d.place}
                        invalid={unresolved}
                        onSelect={(label, coords, region) =>
                          setDest(d.id, { place: label, coords, region })
                        }
                        // Freeform typing invalidates the resolved pick — clear the
                        // region with the coords so the two never disagree.
                        onTextChange={(t) =>
                          setDest(d.id, { place: t, coords: null, region: null })
                        }
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDest(d.id, {
                        manualCoords: !d.manualCoords,
                        place: "",
                        coords: null,
                        region: null,
                      })
                    }
                    className="font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-amber shrink-0 px-1.5"
                  >
                    {d.manualCoords ? "search" : "coords"}
                  </button>
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
                      setDestinations((ds) => ds.filter((x) => x.id !== d.id))
                    }
                    disabled={destinations.length <= 2}
                    className="text-text-muted hover:text-input-error disabled:opacity-30"
                    aria-label="Remove"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap pl-14">
                  {d.coords ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber">
                      <Check className="w-3 h-3" /> resolved
                    </span>
                  ) : (
                    <span
                      className={`text-[11px] ${unresolved ? "text-input-error" : "text-text-muted/60"}`}
                    >
                      pick a suggestion
                    </span>
                  )}
                  {/* Date pin is for INTERMEDIATE stops only. START and END are
                   *  already pinned by the trip's date range: `expeditionToGenerationInput`
                   *  puts those on `TripParams.startDate/endDate`, which reach the
                   *  pipeline independently of any anchor's `datePin`. Offering the
                   *  toggle here asked the user to re-state a date they had already
                   *  given, and let them state a DIFFERENT one. */}
                  {i !== 0 && i !== lastIdx && (
                    <>
                      <div className="inline-flex rounded-full border border-input-border overflow-hidden text-xs">
                        {(["fixed", "flexible"] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() =>
                              setDest(d.id, {
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
                          onChange={(e) => setDest(d.id, { date: e.target.value })}
                        />
                      )}
                    </>
                  )}
                  <label className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                    dwell
                    <Stepper
                      value={d.dwell}
                      min={0}
                      max={30}
                      onChange={(v) => setDest(d.id, { dwell: v })}
                    />
                  </label>
                  <input
                    className={`${fieldCls} h-7 flex-1 min-w-[120px] text-xs placeholder:text-text-muted`}
                    placeholder="note (optional)"
                    value={d.note ?? ""}
                    onChange={(e) => setDest(d.id, { note: e.target.value || null })}
                  />
                </div>
              </div>
            );
          })}
          {destinations.length < 8 && (
            <button
              type="button"
              onClick={() =>
                setDestinations((ds) => {
                  const id = nextId.current++;
                  return [
                    ...ds.slice(0, -1),
                    { id, place: "", coords: null, region: null, manualCoords: false, datePin: "flexible", date: null, dwell: 0, note: null },
                    ds[ds.length - 1],
                  ];
                })
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
          <div className="col-span-2">
            <label className={labelCls}>Trip dates</label>
            <DateRangeInput name="trip" onChange={onDates} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Objective / vibe (optional)</label>
            <input
              className={`${fieldCls} w-full placeholder:text-text-muted`}
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
              Max daily drive · <span className="text-amber">{maxDailyDriveMi} mi</span>
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
            <Stepper value={bufferDays} min={0} max={30} onChange={setBufferDays} suffix="days" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Avoid</label>
            <ChipGroup
              name="avoid"
              options={AVOID_OPTIONS}
              selected={avoid}
              onToggle={(v) => setAvoid((l) => toggle(l, v))}
            />
          </div>
        </div>
      </Section>

      {/* ── Interest categories (Interest-Category-Chips) ────────────────
          Multi-select chips for the pool-side categories the D-B per-city
          guarantee mechanism honors — the 6 in `GUARANTEE_CATEGORIES`
          (anchor-backfill.ts). `fuel` keeps its own checkbox (separate
          live-resolve path); `hotel`/`overnight` and `interest` get no chip
          because the backend gate no-ops them — see
          `lib/plan/guarantee-categories.ts` and the ADR. */}
      <Section
        title="Interest categories"
        hint="Guarantee certain kinds of stop appear on your trip. Priority within the existing per-city stop cap — not additional stops."
      >
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 flex-wrap">
            {GUARANTEE_CHIP_CATEGORIES.map(({ key, label }) => (
              <SelectableChip
                key={key}
                id={key}
                label={label}
                accent={`var(--cat-${key}-title)`}
                name="guaranteedCategories"
                checked={guaranteedCategories.includes(key)}
                onChange={() =>
                  setGuaranteedCategories((l) =>
                    l.includes(key)
                      ? l.filter((c) => c !== key)
                      : [...l, key],
                  )
                }
              />
            ))}
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={guaranteedCategories.includes("fuel")}
              onChange={(e) =>
                setGuaranteedCategories((l) =>
                  e.target.checked
                    ? Array.from(new Set([...l, "fuel"]))
                    : l.filter((c) => c !== "fuel"),
                )
              }
            />
            <span className="flex flex-col gap-1">
              <span className="text-sm">Guarantee a fuel stop at each anchor</span>
              <span className="text-xs opacity-70">
                Calls Google Places live for a gas station near each day-start
                and mid-corridor city that doesn&apos;t already have one in
                range. Costs a few cents per trip (capped per-generation).
              </span>
            </span>
          </label>
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
            <ChipGroup
              name="build"
              options={BUILD_OPTIONS}
              selected={rig.build}
              onToggle={(v) => setRig((r) => ({ ...r, build: toggle(r.build, v) }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Fuel range</label>
              <Stepper
                value={rig.fuelRangeMi}
                min={50}
                max={1000}
                step={10}
                suffix="mi"
                onChange={(v) => setRig((r) => ({ ...r, fuelRangeMi: v }))}
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
            <ChipGroup
              name="preferences"
              options={PREFERENCE_OPTIONS}
              selected={rig.preferences}
              onToggle={(v) =>
                setRig((r) => ({ ...r, preferences: toggle(r.preferences, v) }))
              }
            />
          </div>
        </div>
      </Section>

      {(serverError || (submitted && validationError)) && (
        <p className="text-sm text-input-error bg-input-error/10 border border-input-error/30 rounded-lg px-4 py-3">
          {serverError ?? validationError}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending || !isValid}
        className="h-12 rounded-full bg-amber text-bg-base font-display text-base tracking-wide hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
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
