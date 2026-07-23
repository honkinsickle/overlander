/**
 * Stage-1 generation contract (spec §8.2).
 *
 * This is the single source of truth shared by three consumers:
 *   1. generate.ts — passes ITINERARY_OUTPUT_SCHEMA to the LLM as the
 *      structured-output constraint, so the model MUST return this shape.
 *   2. the audit (Stage 2) — verifies each field against engine/corpus truth.
 *   3. Day Detail render — maps DayPlan → the reasoned fill on each Day.
 *
 * The LLM REASONS but NEVER ORIGINATES facts (spec §4): `keyStops` and
 * `overnight.name` are plain place NAMES the audit matches to the pool or
 * resolves live (never model-authored ids — nothing to fabricate); `distanceMi` /
 * `driveHours` are the model's STATED values, audited against the engine
 * before display.
 */

// ── TypeScript types (what the rest of the app consumes) ──────────────

export type ObligationAction =
  | "book"
  | "permit"
  | "ticket"
  | "fuel"
  | "resupply"
  | "reserve";

export type ObligationSeverity = "info" | "recommended" | "critical";

export type Obligation = {
  action: ObligationAction;
  severity: ObligationSeverity;
  /** Why it matters — "no cell in Hyder; buy the ticket in Stewart". */
  reason: string;
  /** Optional hard date this obligation is anchored to (ISO). */
  eventDate: string | null;
  /** Optional lead time in days (e.g. reserve 90 days ahead). */
  leadTimeDays: number | null;
};

export type DayType = "drive" | "layover" | "sidetrip";

// ── Audit provenance (Stage 2, spec §8.3) ────────────────────────────
// Every navigable fact carries a confidence tag so the render can show
// where it came from. `measured` = re-routed by the engine; `corpus-backed`
// = a real POI in the fed pool (tier 1); `google-resolved` = a name the LLM
// gave, resolved live to a real place_id + on-corridor coords (tier 2);
// `advisory` = a knowledge claim to verify.
export type FactConfidence =
  | "measured"
  | "corpus-backed"
  | "google-resolved"
  | "advisory";

/** A place the LLM referenced by NAME, resolved live to a real Google
 *  place_id whose coords were verified to sit on the day's route (tier 2). */
export type ResolvedPlace = {
  /** The name the LLM emitted. */
  name: string;
  /** Google's canonical display name. */
  displayName: string;
  placeId: string;
  coords: [number, number];
  /** Corpus primary_category from Google's primaryType, null when Google gave
   *  none (see resolve.ts inferCategory). Carried so a corpus write-back can
   *  set inferred_category instead of null. */
  category: string | null;
  where: "keyStop" | "overnight" | "endpoint";
};

export type AuditFlag = {
  kind:
    | "distance-snapped"
    | "dropped-poi"
    | "dropped-overnight"
    | "seasonal-advisory"
    | "structural";
  severity: "info" | "warning" | "critical";
  /** User-facing message shown on the day. */
  message: string;
};

/** Per-day audit result, attached by `auditItinerary`. Absent on raw
 *  (unaudited) LLM output; the generation schema never produces it. */
export type DayAudit = {
  /** Confidence in this day's distance/drive after the audit. */
  distanceConfidence: FactConfidence;
  /** What the LLM originally claimed, kept for provenance/display. */
  statedDistanceMi: number;
  statedDriveHours: number;
  flags: AuditFlag[];
  /** Tier-2 names that resolved live + passed the corridor guard. */
  resolvedPlaces: ResolvedPlace[];
};

/** One key stop: a grounded place NAME + inline context note (purpose / caveat
 *  / food). Gold weaves per-stop context and food into the key-stops cell; this
 *  is where both live. */
export type KeyStop = {
  name: string;
  note: string;
};

export type DayPlan = {
  /** 1-based day number. */
  n: number;
  /** ISO date this day falls on. */
  date: string;
  /** Start / end place labels (human-readable). */
  startPlace: string;
  endPlace: string;
  type: DayType;
  /** LLM's STATED distance/drive — audited against the engine next. */
  distanceMi: number;
  driveHours: number;
  /** Typical/climate weather note (advisory until a live source backs it). */
  weather: string;
  /** Short narrative of the day's drive (road, transitions, why this pacing). */
  rationale: string;
  /** The day's key stops. `name` is a real place NAME (always a name, never an
   *  id — the audit matches it to the pool or resolves it live); `note` is the
   *  inline context gold weaves in ("fuel + lunch, hot tub"; "rough gravel —
   *  fine for GX470, not RVs"; "cinnamon buns worth the stop"). Per-day food
   *  rides here, as food stops with food notes. After the audit, `name` holds
   *  the RESOLVED ref (corpus id on a pool-hit, the name on a live-resolve) —
   *  same reuse the pre-object `string[]` had; `note` is carried through. */
  keyStops: KeyStop[];
  overnight: {
    /** The overnight's real place NAME — the audit matches it to the pool or
     *  resolves it live. null only when no real place fits (use `desc`). */
    name: string | null;
    /** Free-text fallback when no real place fits ("informal boondock…"). */
    desc: string | null;
    /** camp | dispersed | motel | lodge … */
    type: string;
    /** Why it fits the rig + style ("level gravel, great for GX470 + RTT"). */
    rationale: string;
  };
  /** Per-day logistics ("cross the border by 6pm AK; top off in Tok"). */
  logistics: string;
  obligations: Obligation[];
  /** Populated by the Stage-2 audit (spec §8.3). Absent on raw LLM output. */
  audit?: DayAudit;
};

export type Phase = {
  name: string;
  /** e.g. "Days 1–4". */
  dayRange: string;
  goals: string;
  logistics: string;
};

export type Variant = {
  label: string;
  pros: string;
  cons: string;
  shifts: string;
};

export type Permit = {
  name: string;
  forWhat: string;
  howObtain: string;
  leadTime: string;
  notes: string;
};

export type Border = {
  crossing: string;
  countries: string;
  docs: string;
  hours: string;
  notes: string;
};

export type FuelGap = {
  segment: string;
  gapMi: number;
  action: string;
};

export type ItineraryOutput = {
  /** §A — high-level route summary. */
  routeSummary: string;
  /** The food thread woven through the trip (regional eats). */
  foodThread: string;
  /** One line per FIXED anchor confirming it was honored. */
  anchorsHonored: string[];
  /** §B — phase breakdown. */
  phases: Phase[];
  /** §C — the day-by-day; each maps onto a Day Detail row. */
  days: DayPlan[];
  /** §05 — computed-then-reasoned fuel gaps. */
  fuelGaps: FuelGap[];
  /** §D — optional routing variants. */
  variants: Variant[];
  /** §F — permits & reservations. */
  permits: Permit[];
  /** §F — border crossings. */
  borders: Border[];
};

// ── JSON Schema (the LLM structured-output constraint) ────────────────
//
// Structured-output rules (per the Claude API skill): every object needs
// `additionalProperties: false` and ALL keys in `required`; optionality is
// expressed via nullable types (`["string", "null"]`), never by omission.
// No min/max/length constraints (unsupported) — the audit enforces bounds.

const OBLIGATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: ["book", "permit", "ticket", "fuel", "resupply", "reserve"],
    },
    severity: { type: "string", enum: ["info", "recommended", "critical"] },
    reason: { type: "string" },
    eventDate: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD) or null",
    },
    leadTimeDays: { type: ["integer", "null"] },
  },
  required: ["action", "severity", "reason", "eventDate", "leadTimeDays"],
} as const;

const DAY_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    n: { type: "integer" },
    date: { type: "string", description: "ISO date YYYY-MM-DD" },
    startPlace: { type: "string" },
    endPlace: { type: "string" },
    type: { type: "string", enum: ["drive", "layover", "sidetrip"] },
    distanceMi: { type: "number" },
    driveHours: { type: "number" },
    weather: { type: "string" },
    rationale: { type: "string" },
    keyStops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            description:
              "A plain real-place NAME (e.g. \"Boya Lake Provincial Park\", \"Salmon Glacier\", \"Braeburn Lodge\"). NEVER an id or code — just the name, as you'd say it out loud.",
          },
          note: {
            type: "string",
            description:
              "Short inline context: what this stop is FOR — fuel / food / view / a caveat / optional. E.g. \"fuel + lunch, hot tub\", \"rough gravel — fine for GX470, not RVs\", \"cinnamon buns worth the stop\", \"optional, ~1.5 hr each way\".",
          },
        },
        required: ["name", "note"],
      },
      description:
        "2–4 entries. Include 1–2 FOOD stops where the route offers them (a real named cafe/lodge/bakery, with a food note), the way a great guide weaves food into the day. Every name is grounded like everything else.",
    },
    overnight: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: ["string", "null"],
          description:
            "The overnight's real place NAME (e.g. \"Meziadin Lake Provincial Park\"). Just the name — never an id. null only when no real place fits (then use desc).",
        },
        desc: { type: ["string", "null"] },
        type: { type: "string" },
        rationale: { type: "string" },
      },
      required: ["name", "desc", "type", "rationale"],
    },
    logistics: { type: "string" },
    obligations: { type: "array", items: OBLIGATION_SCHEMA },
  },
  required: [
    "n",
    "date",
    "startPlace",
    "endPlace",
    "type",
    "distanceMi",
    "driveHours",
    "weather",
    "rationale",
    "keyStops",
    "overnight",
    "logistics",
    "obligations",
  ],
} as const;

export const ITINERARY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    routeSummary: { type: "string" },
    foodThread: { type: "string" },
    anchorsHonored: { type: "array", items: { type: "string" } },
    phases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          dayRange: { type: "string" },
          goals: { type: "string" },
          logistics: { type: "string" },
        },
        required: ["name", "dayRange", "goals", "logistics"],
      },
    },
    days: { type: "array", items: DAY_PLAN_SCHEMA },
    fuelGaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          segment: { type: "string" },
          gapMi: { type: "number" },
          action: { type: "string" },
        },
        required: ["segment", "gapMi", "action"],
      },
    },
    variants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          pros: { type: "string" },
          cons: { type: "string" },
          shifts: { type: "string" },
        },
        required: ["label", "pros", "cons", "shifts"],
      },
    },
    permits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          forWhat: { type: "string" },
          howObtain: { type: "string" },
          leadTime: { type: "string" },
          notes: { type: "string" },
        },
        required: ["name", "forWhat", "howObtain", "leadTime", "notes"],
      },
    },
    borders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          crossing: { type: "string" },
          countries: { type: "string" },
          docs: { type: "string" },
          hours: { type: "string" },
          notes: { type: "string" },
        },
        required: ["crossing", "countries", "docs", "hours", "notes"],
      },
    },
  },
  required: [
    "routeSummary",
    "foodThread",
    "anchorsHonored",
    "phases",
    "days",
    "fuelGaps",
    "variants",
    "permits",
    "borders",
  ],
} as const;
