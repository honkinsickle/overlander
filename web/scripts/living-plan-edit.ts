/**
 * Living-plan NL-edit harness (Stage 3 MVP): PARSE → APPLY → RE-RUN, staged
 * so each step can be reviewed before the next runs. Operates on a trip's
 * persisted `payload.generationInput` (step-0 field) and re-runs the shipped
 * pipeline with the edited input.
 *
 * SAFETY RAILS (hard, not conventions):
 *   - Supabase writes require the TEST project ref (znldzjdatkogdktymtvi);
 *     any other ref aborts before the write.
 *   - The live trip id `dawson-vancouver-cassiar` is refused outright.
 *
 * Run (Supabase → TEST via the SECOND env-file, which wins; Anthropic /
 * Google / Mapbox keys come from .env.local). NOTE: TEST's corpus is the
 * thin smoke corpus — a sparser POI/fuel picture than PROD is EXPECTED
 * here; this harness tests the EDIT MECHANISM, not corpus richness:
 *   tsx --env-file=.env.local --env-file=.env.test.local scripts/living-plan-edit.ts \
 *     --trip dawson-cassiar-livingplan-test \
 *     --request "arrive at Salmon Glacier on the 19th" --parse
 *   …then --apply, then --rerun (each loads the prior stage's state file).
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Trip } from "../src/lib/trips/types";
import { preComputeFacts, type GenerationInput } from "../src/lib/itinerary/facts";
import { generateAndAudit } from "../src/lib/itinerary/generate";
import { bakeGeneratedDays } from "../src/lib/itinerary/bake";
import { itineraryToTrip } from "../src/lib/itinerary/to-trip";
import { attachHeroPhotos } from "../src/lib/imagery/destination-photo";
import { PlaceResolver } from "../src/lib/itinerary/resolve";
import { geocode } from "../src/lib/routing/geocode";
import {
  parseEditRequest,
  groundParsedEdit,
  applyEdit,
  type GroundedEdit,
} from "../src/lib/itinerary/edit";

const TEST_REF = "znldzjdatkogdktymtvi";
const FORBIDDEN_IDS = new Set(["dawson-vancouver-cassiar"]);

const STATE_DIR = `${process.cwd()}/.living-plan-state`;

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
}

function projectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "unknown";
}

/** TEST-or-abort service client. Every DB touch in this harness goes
 *  through this — there is no code path to any other project. */
function testClient(): SupabaseClient {
  const ref = projectRef();
  if (ref !== TEST_REF) {
    console.error(
      `[edit] ABORT: Supabase ref is ${ref}, not TEST (${TEST_REF}). ` +
        "Run with --env-file=.env.test.local LAST so TEST overrides.",
    );
    process.exit(1);
  }
  console.log(`[edit] Supabase → ${ref} [TEST]`);
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function loadTrip(supabase: SupabaseClient, tripId: string) {
  const { data, error } = await supabase
    .from("reference_trips")
    .select("payload, source_version")
    .eq("id", tripId)
    .single();
  if (error) {
    console.error(`[edit] load "${tripId}" failed: ${error.message}`);
    process.exit(1);
  }
  const payload = data.payload as Trip;
  const input = payload.generationInput as GenerationInput | undefined;
  if (!input) {
    console.error(
      `[edit] "${tripId}" has no payload.generationInput — not editable. ` +
        "(Pre-step-0 trip? Seed a reconstructed input first.)",
    );
    process.exit(1);
  }
  return { payload, input, sourceVersion: data.source_version as string };
}

function statePath(tripId: string, stage: string): string {
  return `${STATE_DIR}/${tripId}.${stage}.json`;
}

function saveState(tripId: string, stage: string, data: unknown) {
  mkdirSync(STATE_DIR, { recursive: true });
  const p = statePath(tripId, stage);
  writeFileSync(p, JSON.stringify(data, null, 2));
  console.log(`[edit] state → ${p}`);
}

function fmtAnchor(a: {
  place: string;
  role: string;
  datePin: string;
  date: string | null;
  dwell: number;
}): string {
  return `${a.place} [${a.role}/${a.datePin}${a.date ? " " + a.date : ""}/dwell ${a.dwell}]`;
}

async function main() {
  const tripId = arg("--trip");
  if (!tripId) {
    console.error("[edit] --trip <id> is required");
    process.exit(1);
  }
  if (FORBIDDEN_IDS.has(tripId)) {
    console.error(
      `[edit] REFUSED: "${tripId}" is the LIVE trip. This harness never touches it.`,
    );
    process.exit(1);
  }
  const supabase = testClient();

  // ---------- STAGE 1: PARSE ----------
  if (process.argv.includes("--parse")) {
    const request = arg("--request");
    if (!request) {
      console.error("[edit] --parse needs --request \"<text>\"");
      process.exit(1);
    }
    const { input } = await loadTrip(supabase, tripId);

    console.log(`\n[parse] request: "${request}"`);
    console.log("[parse] anchors in scope:");
    for (const a of input.anchors) console.log(`  ${fmtAnchor(a)}`);

    const parsed = await parseEditRequest(request, input);
    if (parsed.type === "unsupported") {
      console.log(`\n[parse] UNSUPPORTED: ${parsed.reason}`);
      process.exit(0);
    }
    console.log(`\n[parse] → type: ${parsed.type}`);
    console.log(`[parse] → place: "${parsed.place}"`);
    console.log(`[parse] → date: ${parsed.date}`);
    console.log(`[parse] → targetAnchor: ${parsed.targetAnchor ?? "(none)"}`);

    // Ground: resolve the place (Google, biased at the target anchor when we
    // have one — else the trip start) + measure place↔anchor distance.
    const anchorCoords = parsed.targetAnchor
      ? await geocode(parsed.targetAnchor)
      : undefined;
    const bias =
      anchorCoords ?? (await geocode(input.anchors[0].place));
    const resolver = new PlaceResolver();
    const grounded = await groundParsedEdit(parsed, resolver, bias, anchorCoords);

    console.log(
      `[ground] "${parsed.place}" → ${grounded.resolved.displayName} ` +
        `(${grounded.resolved.placeId}) @ [${grounded.resolved.coords.map((c) => c.toFixed(4)).join(", ")}]`,
    );
    if (grounded.anchorDistanceMi !== null) {
      console.log(
        `[ground] distance to target anchor "${parsed.targetAnchor}": ${grounded.anchorDistanceMi} mi straight-line`,
      );
    }
    saveState(tripId, "parsed", grounded);
    console.log("\n[edit] PARSE done — review, then run --apply.");
    return;
  }

  // ---------- STAGE 2: APPLY ----------
  if (process.argv.includes("--apply")) {
    const grounded = JSON.parse(
      readFileSync(statePath(tripId, "parsed"), "utf8"),
    ) as GroundedEdit;
    const { input } = await loadTrip(supabase, tripId);

    const applied = applyEdit(input, grounded);
    console.log("\n[apply] anchor edit:");
    console.log(`  BEFORE: ${fmtAnchor(applied.before)}`);
    console.log(`  AFTER:  ${fmtAnchor(applied.after)}`);
    console.log("\n[apply] full anchor set after edit:");
    for (const a of applied.input.anchors) console.log(`  ${fmtAnchor(a)}`);

    saveState(tripId, "applied", applied.input);
    console.log("\n[edit] APPLY done — review, then run --rerun.");
    return;
  }

  // ---------- STAGE 3: RE-RUN ----------
  if (process.argv.includes("--rerun")) {
    const editedInput = JSON.parse(
      readFileSync(statePath(tripId, "applied"), "utf8"),
    ) as GenerationInput;
    // Trip must exist + be editable before we spend money regenerating.
    const { sourceVersion } = await loadTrip(supabase, tripId);

    console.log("\n[rerun] preComputeFacts…");
    const facts = await preComputeFacts(editedInput);
    console.log(
      `[rerun] facts: ${facts.route.totalMi} mi, baseline ${facts.route.baselineDriveDays} drive days, ` +
        `${facts.corridorCities.length} corridor cities, ${facts.poolPOIs.length} pool POIs`,
    );

    console.log("[rerun] generateAndAudit…");
    const { audited, report, regenAttempts, unresolved, dayRoutes } =
      await generateAndAudit(editedInput, facts);
    console.log(`[rerun] audit: ${report.summary}`);
    if (regenAttempts > 0) console.log(`[rerun] regen attempts: ${regenAttempts}`);

    // ---- QUALITY GATE (refuse to persist junk) ----
    const gate: string[] = [];
    const fabricated = report.droppedPois.filter((d) =>
      d.poiId.startsWith("mp:"),
    );
    if (fabricated.length > 0)
      gate.push(`${fabricated.length} fabricated mp: ids`);
    const withOvernight = audited.days.filter(
      (d) => d.overnight.name || d.overnight.desc,
    ).length;
    if (withOvernight / audited.days.length < 0.7)
      gate.push(`overnight coverage ${withOvernight}/${audited.days.length} < 70%`);
    if (unresolved)
      gate.push(
        `UNRESOLVED structural violations: ${unresolved.map((s) => s.kind).join(", ")}`,
      );
    if (gate.length > 0) {
      console.error(`\n[rerun] QUALITY GATE FAILED — not persisting:\n  - ${gate.join("\n  - ")}`);
      saveState(tripId, "rerun-failed", { report, unresolved });
      process.exit(1);
    }
    console.log("[rerun] quality gate: PASS (0 fabricated, overnights OK, structural clean)");

    console.log("[rerun] bakeGeneratedDays…");
    const baked = await bakeGeneratedDays(audited, editedInput, supabase, dayRoutes);

    const trip = await attachHeroPhotos(
      itineraryToTrip(tripId, editedInput, facts, audited, baked),
    );

    // Persist — testClient() already proved [TEST]; assert the id once more.
    if (FORBIDDEN_IDS.has(trip.id)) throw new Error("forbidden id"); // unreachable, belt+braces
    const { error } = await supabase.from("reference_trips").upsert({
      id: tripId,
      title: trip.title,
      payload: trip,
      source_version: `livingplan-edit@${new Date().toISOString().slice(0, 10)} (was ${sourceVersion})`,
    });
    if (error) {
      console.error(`[rerun] persist failed: ${error.message}`);
      process.exit(1);
    }

    // Read-back verification (measure, don't trust the write).
    const { data: back } = await supabase
      .from("reference_trips")
      .select("payload")
      .eq("id", tripId)
      .single();
    const p = back!.payload as Trip;
    console.log(`\n[rerun] PERSISTED + read back: ${p.days.length} days`);
    console.log(`[rerun] generationInput persisted: ${Boolean(p.generationInput)}`);
    for (const d of p.days) {
      console.log(
        `  ${d.date}  ${String(d.miles).padStart(4)} mi  ${d.label}`,
      );
    }
    console.log("\n[edit] RE-RUN done — verify the plan above.");
    return;
  }

  console.error("[edit] pass one of --parse / --apply / --rerun");
  process.exit(1);
}

main().catch((err) => {
  console.error("[edit] fatal:", err);
  process.exit(1);
});
