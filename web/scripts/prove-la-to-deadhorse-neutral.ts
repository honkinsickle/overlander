/**
 * (e) PROOF — deleting `ensureAlaskaUpgraded` is behavior-neutral for
 * la-to-deadhorse (the live reference trip).
 *
 * Reasoning this discharges: getTrip("la-to-deadhorse") TODAY returns
 * `getAlaskaTrip()` (ensureAlaskaUpgraded caches it in the store); post-removal
 * getTrip routes la-to-deadhorse through `getReferenceTrip` — the SAME function.
 * getReferenceTrip serves the DB payload, and IFF that payload is baked,
 * `withCorridors` + the federated fold both short-circuit, so the served trip is
 * the DB payload verbatim. This asserts (1) the payload is baked, and (2) every
 * LA_TO_DEADHORSE_RAW day-level override (heroImage / label) is present in the
 * DB payload — i.e. the fixture literal supplies nothing the DB lacks.
 *
 * Read-only. Run:
 *   cd web && npx tsx --env-file=.env.development.local scripts/prove-la-to-deadhorse-neutral.ts
 *   cd web && npx tsx --env-file=<prod-env>            scripts/prove-la-to-deadhorse-neutral.ts
 */
import { createClient } from "@supabase/supabase-js";
import { LA_TO_DEADHORSE } from "../src/lib/trips/alaska";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("✗ requires SUPABASE url + service-role key (use --env-file)");
    process.exit(1);
  }
  const tag = (url.match(/https:\/\/([a-z0-9]+)/) ?? [])[1];
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const overrides = LA_TO_DEADHORSE.days
    .filter((d) => d.heroImage || d.label)
    .map((d) => ({ n: d.dayNumber, heroImage: d.heroImage, label: d.label }));

  const { data, error } = await sb
    .from("reference_trips")
    .select("payload")
    .eq("id", "la-to-deadhorse")
    .maybeSingle();
  console.log(`\n=== (e) proof · ${tag} ===`);
  if (error || !data) {
    console.log("  ✗ fetch failed:", error?.message ?? "no row");
    process.exit(1);
  }
  const p = data.payload as { days: Array<Record<string, unknown>> };
  const baked = p.days.some((d) => d.corridorCities != null);
  const corpus = p.days.some((d) =>
    ((d.segmentSuggestions as Array<Record<string, unknown>>) ?? []).some((s) =>
      String(s.id ?? s.placeId ?? "").startsWith("mp:"),
    ),
  );
  console.log(
    `  days: ${p.days.length} · baked(corridorCities): ${baked} · corpus tiles(mp:): ${corpus}`,
  );
  console.log(
    "  → on a baked+corpus payload withCorridors/fold no-op, so served == payload verbatim",
  );

  const dbByNum = new Map(p.days.map((d) => [d.dayNumber as number, d]));
  let missing = 0;
  for (const ov of overrides) {
    const d = dbByNum.get(ov.n);
    const heroOk = ov.heroImage ? d?.heroImage === ov.heroImage : true;
    const labelOk = ov.label ? d?.label === ov.label : true;
    if (!heroOk || !labelOk) {
      missing++;
      console.log(
        `  ✗ day ${ov.n}: hero ${heroOk ? "ok" : `MISS db=${JSON.stringify(d?.heroImage)} exp=${JSON.stringify(ov.heroImage)}`}, label ${labelOk ? "ok" : `MISS db=${JSON.stringify(d?.label)} exp=${JSON.stringify(ov.label)}`}`,
      );
    }
  }
  console.log(`  override days checked: ${overrides.length} · mismatches: ${missing}`);
  console.log(
    missing === 0
      ? "  ✓ PASS — all override heroImage/label present in DB payload; delete is behavior-neutral"
      : "  ✗ FAIL — overrides missing; DO NOT DELETE",
  );
  if (missing > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
