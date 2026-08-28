/**
 * READ-ONLY baseline query against Typesense `places_prod` collection.
 * Reports:
 *   - total document count
 *   - counts by primary_category (top values)
 *   - result counts for a handful of known AO-only queries
 *
 * Uses the same shared cluster + admin key as TEST (per the 2026-07-23
 * typesense-collection-per-env ADR), pointed explicitly at `places_prod`.
 * No writes, no schema changes.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/typesense-places-prod-baseline.ts
 */

import Typesense from "typesense";

const HOST = process.env.TYPESENSE_HOST ?? "";
const PORT = Number(process.env.TYPESENSE_PORT ?? "");
const PROTOCOL = process.env.TYPESENSE_PROTOCOL ?? "";
const API_KEY = process.env.TYPESENSE_ADMIN_API_KEY ?? "";
const COLLECTION = "places_prod";

if (!HOST || !PORT || !PROTOCOL || !API_KEY) {
  console.error("Missing Typesense env vars.");
  process.exit(1);
}

const client = new Typesense.Client({
  nodes: [{ host: HOST, port: PORT, protocol: PROTOCOL }],
  apiKey: API_KEY,
  connectionTimeoutSeconds: 15,
});

async function main() {
  console.log("=".repeat(72));
  console.log("Typesense baseline — collection:", COLLECTION);
  console.log(`Cluster: ${PROTOCOL}://${HOST}:${PORT}`);
  console.log("=".repeat(72));

  const info = await client.collections(COLLECTION).retrieve();
  console.log(`\nCollection num_documents (Typesense's own count): ${info.num_documents}`);
  console.log(`Fields: ${info.fields?.length ?? 0}   Created at: ${new Date((info as { created_at?: number }).created_at! * 1000).toISOString()}`);

  // Category facet — get a coarse composition breakdown.
  const catRes = await client.collections(COLLECTION).documents().search({
    q: "*",
    query_by: "canonical_name",
    facet_by: "primary_category",
    max_facet_values: 30,
    per_page: 0,
  });
  console.log("\nprimary_category breakdown:");
  const catFacet = (catRes.facet_counts ?? []).find((f) => f.field_name === "primary_category");
  for (const c of (catFacet?.counts ?? []).slice(0, 30)) {
    console.log(`  ${c.value.padEnd(28)} ${String(c.count).padStart(6)}`);
  }
  console.log(`  (total distinct: ${catFacet?.counts.length ?? 0})`);

  const oddityCount = (catFacet?.counts ?? []).find((c) => c.value === "oddity")?.count ?? 0;
  console.log(`\noddity documents currently indexed: ${oddityCount}`);

  // Direct AO name probes — these should return zero hits pre-sync.
  const probes = [
    "Voodoo Doughnut",
    "Ethel M Botanical Cactus Garden",
    "Berlin Wall Urinal",
    "Willamette Stone",
    "Tovrea Castle",
    "Summum Pyramid",
  ];
  console.log("\nAO-name probes (should be 0 pre-sync):");
  for (const q of probes) {
    const r = await client.collections(COLLECTION).documents().search({
      q,
      query_by: "canonical_name,alternative_names,description",
      per_page: 3,
    });
    console.log(`  ${q.padEnd(40)} found=${r.found}`);
    for (const hit of r.hits ?? []) {
      const doc = hit.document as { id: string; canonical_name: string; primary_category: string };
      console.log(`    - ${doc.canonical_name} [${doc.primary_category}] id=${doc.id.slice(0, 8)}…`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
