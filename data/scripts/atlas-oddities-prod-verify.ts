/**
 * READ-ONLY live-verify of AO content on PROD, post-promotion.
 * Loads PROD creds from ~/.config/overlander/env-backups/.env.production-backup,
 * refuses if the URL mismatches, and only issues SELECT-shaped calls
 * (pois_along_corridor RPC + source_record/trips SELECT).
 *
 * Verifies:
 *   - AO descriptions and photos surface on PROD via pois_along_corridor
 *     across the same 5 corridors used by PR #311's TEST verify.
 *   - No markdown syntax leaks in the returned descriptions.
 *   - Existing PROD trips do NOT auto-refresh (frozen-snapshot lesson from
 *     PR #302) — inspects `payload.segmentSuggestions` on the la-to-portland
 *     reference trip to confirm no atlas_oddities tiles landed there.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const PROD_URL = "https://nqzeywzcowujzyegxbsr.supabase.co";
const PROD_ENV_PATH = `${process.env.HOME}/.config/overlander/env-backups/.env.production-backup`;

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv(PROD_ENV_PATH);
if (env["SUPABASE_URL"] !== PROD_URL) {
  console.error("Refusing to run — PROD env URL mismatch.");
  process.exit(1);
}

const prod: SupabaseClient = createClient(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"], {
  auth: { persistSession: false },
});

const ROUTES: ReadonlyArray<{ label: string; route: { type: "LineString"; coordinates: [number, number][] } }> = [
  { label: "Portland OR (wave 1)", route: { type: "LineString", coordinates: [[-122.7000, 45.5150], [-122.6300, 45.5350]] } },
  { label: "Seattle WA (wave 2)", route: { type: "LineString", coordinates: [[-122.3500, 47.6000], [-122.3000, 47.6300]] } },
  { label: "Phoenix AZ (wave 2)", route: { type: "LineString", coordinates: [[-112.1000, 33.4500], [-111.9500, 33.4700]] } },
  { label: "Salt Lake City UT (wave 2)", route: { type: "LineString", coordinates: [[-111.9000, 40.7500], [-111.8500, 40.7700]] } },
  { label: "Las Vegas NV (wave 2)", route: { type: "LineString", coordinates: [[-115.2000, 36.1500], [-115.1000, 36.1800]] } },
];

type Row = {
  id: string;
  canonical_name: string;
  primary_category: string;
  description: string | null;
  nps_photo_url: string | null;
  photo_credit: string | null;
  description_source: string | null;
  attribution: Record<string, string> | null;
};

const MD_PATTERNS = [
  /\[[^\]]+\]\([^)]+\)/,
  /\*\*[^*\n]+\*\*/,
  /(^|[\s(\[{"'])_[^_\n]+_(?=[\s.,!?;:)\]}'"]|$)/,
  /(^|\n)> /,
  /(^|\n) {0,4}[-*+]\s+/,
];

function looksLikeMarkdown(s: string): boolean {
  return MD_PATTERNS.some((re) => re.test(s));
}

async function verifyCorridor(label: string, route: (typeof ROUTES)[number]["route"]): Promise<{ passed: boolean; note: string }> {
  const r = await prod.rpc("pois_along_corridor", { p_route: route, p_buffer_m: 16000, p_categories: null });
  if (r.error || r.data == null) {
    return { passed: false, note: `RPC failed: ${JSON.stringify(r.error)}` };
  }
  const rows = r.data as Row[];
  const withAoDesc = rows.filter((row) => row.attribution?.description === "atlas_oddities");
  const withAoPhoto = rows.filter((row) => row.photo_credit === "Atlas Obscura");
  const mdContaminated = rows.filter(
    (row) => row.attribution?.description === "atlas_oddities" && looksLikeMarkdown(row.description ?? ""),
  );
  console.log(`\n── ${label} ──`);
  console.log(`  rows: ${rows.length}   AO desc: ${withAoDesc.length}   AO photo: ${withAoPhoto.length}   md-leak: ${mdContaminated.length}`);
  const sample = rows.filter((row) => row.attribution?.description === "atlas_oddities" && row.photo_credit === "Atlas Obscura");
  for (const s of sample.slice(0, 2)) {
    console.log(`    - ${s.canonical_name} (${s.primary_category})`);
    console.log(`      ${(s.description ?? "").slice(0, 110).replace(/\n/g, " ")}…`);
  }
  const passed = withAoDesc.length > 0 && withAoPhoto.length > 0 && mdContaminated.length === 0;
  const note = passed ? "OK" : `desc=${withAoDesc.length} photo=${withAoPhoto.length} md=${mdContaminated.length}`;
  return { passed, note };
}

async function verifyExistingTripsDontAutoRefresh() {
  console.log("\n" + "=".repeat(72));
  console.log("Existing PROD trips — frozen-snapshot check");
  console.log("=".repeat(72));
  // la-to-portland is the in-scope PROD reference trip. Its payload.segmentSuggestions
  // is a baked snapshot from generation time — new corpus content (AO) does NOT
  // retroactively appear unless refreshCorpusTiles() runs or the trip regenerates.
  // Structural expectation: zero AO-attributed tiles in the pre-existing snapshot.
  const r = await prod
    .from("reference_trips")
    .select("id, title, payload")
    .in("id", ["la-to-portland", "la-to-deadhorse"]);
  if (r.error || !r.data) {
    console.error("QUERY FAILED (reference_trips):", r.error);
    return { passed: false };
  }
  let passed = true;
  for (const trip of r.data) {
    const payload = trip.payload as { days?: { segmentSuggestions?: unknown[] }[]; segmentSuggestions?: unknown[] };
    const days = payload?.days ?? [];
    let totalTiles = 0;
    let aoTiles = 0;
    for (const day of days) {
      const suggestions = (day?.segmentSuggestions ?? []) as { id?: string; primary_category?: string; category?: string; sourceId?: string; attribution?: Record<string, string> }[];
      for (const s of suggestions) {
        totalTiles++;
        if (s?.attribution?.description === "atlas_oddities" || s?.sourceId === "atlas_oddities") aoTiles++;
      }
    }
    console.log(`\n${trip.id}: ${totalTiles} baked segmentSuggestion tiles across ${days.length} days`);
    console.log(`  AO-attributed tiles in baked snapshot: ${aoTiles}`);
    if (aoTiles > 0) {
      console.log("  ✗ UNEXPECTED — AO content appears on a baked snapshot without refresh.");
      passed = false;
    } else {
      console.log("  ✓ No AO tiles on baked snapshot — frozen-snapshot lesson holds.");
    }
  }
  return { passed };
}

async function main() {
  console.log("=".repeat(72));
  console.log("AO PROD live-verify");
  console.log(`Target: ${PROD_URL}   (read-only)`);
  console.log("=".repeat(72));

  const results: { label: string; passed: boolean; note: string }[] = [];
  for (const { label, route } of ROUTES) {
    results.push({ label, ...(await verifyCorridor(label, route)) });
  }

  const tripsCheck = await verifyExistingTripsDontAutoRefresh();

  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));
  for (const r of results) {
    console.log(`  ${r.passed ? "✓" : "✗"} ${r.label}   ${r.note}`);
  }
  console.log(`  ${tripsCheck.passed ? "✓" : "✗"} existing PROD trips remain on their frozen snapshot (no AO auto-refresh)`);

  const allPassed = results.every((r) => r.passed) && tripsCheck.passed;
  if (!allPassed) {
    console.error("\n✗ VERIFY FAILED");
    process.exit(1);
  }
  console.log("\n✓ VERIFY PASSED — AO descriptions + photos surface on PROD via pois_along_corridor; no markdown leaks; existing trips remain frozen.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
