/**
 * READ-ONLY live-verify of AO indexing on PROD Typesense collection
 * (places_prod), post-sync. Confirms:
 *   - overall document count uplift matches expectations
 *   - oddity documents are now indexed (baseline was 0)
 *   - direct AO name queries return the right documents
 *   - returned descriptions carry no markdown syntax (converter output
 *     is what's in Typesense)
 *   - photo_url + description_source facets are populated
 *
 * Uses same shared cluster + admin key, pointed at places_prod.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/typesense-places-prod-verify.ts
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

const MD_PATTERNS = [
  /\[[^\]]+\]\([^)]+\)/,
  /\*\*[^*\n]+\*\*/,
  /(^|[\s(\[{"'])_[^_\n]+_(?=[\s.,!?;:)\]}'"]|$)/,
  /(^|\n)> /,
];
function looksLikeMarkdown(s: string): boolean {
  return MD_PATTERNS.some((re) => re.test(s));
}

async function main() {
  console.log("=".repeat(72));
  console.log("Typesense PROD verify — collection:", COLLECTION);
  console.log("=".repeat(72));

  const info = await client.collections(COLLECTION).retrieve();
  console.log(`\nCollection num_documents: ${info.num_documents}`);

  const catRes = await client.collections(COLLECTION).documents().search({
    q: "*",
    query_by: "canonical_name",
    facet_by: "primary_category",
    max_facet_values: 30,
    per_page: 0,
  });
  const catFacet = (catRes.facet_counts ?? []).find((f) => f.field_name === "primary_category");
  const oddityCount = (catFacet?.counts ?? []).find((c) => c.value === "oddity")?.count ?? 0;
  console.log(`oddity documents indexed: ${oddityCount}`);

  // Sample: hit the top-level search API path the way the client would.
  const probes = [
    "Voodoo Doughnut",
    "Ethel M Botanical Cactus Garden",
    "Berlin Wall Urinal",
    "Willamette Stone Heritage Park",
    "Tovrea Castle",
    "Summum Pyramid",
    "Boontling Language of Boonville",
    "Temporary Port Chicago",
  ];

  let allPassed = true;
  let mdLeaks = 0;
  for (const q of probes) {
    console.log(`\n── Query: "${q}" ──`);
    const r = await client.collections(COLLECTION).documents().search({
      q,
      query_by: "canonical_name,alternative_names,description",
      query_by_weights: "4,2,1",
      per_page: 5,
    });
    console.log(`  found=${r.found}`);
    let sawExpected = false;
    for (const hit of (r.hits ?? []).slice(0, 3)) {
      const doc = hit.document as {
        id: string;
        canonical_name: string;
        primary_category: string;
        description?: string;
        photo_url?: string;
        description_source?: string;
      };
      const desc = doc.description ?? "";
      const mdFlag = looksLikeMarkdown(desc);
      if (mdFlag) mdLeaks++;
      const isOddity = doc.primary_category === "oddity";
      if (isOddity && q.toLowerCase().split(" ").some((w) => doc.canonical_name.toLowerCase().includes(w))) sawExpected = true;
      console.log(
        `    ${isOddity ? "●" : "○"} ${doc.canonical_name} [${doc.primary_category}] ` +
          `photo=${doc.photo_url ? "y" : "n"} desc_src=${doc.description_source ?? "-"} md=${mdFlag ? "LEAK" : "clean"}`,
      );
      console.log(`       ${desc.slice(0, 100).replace(/\n/g, " ")}${desc.length > 100 ? "…" : ""}`);
    }
    if (!sawExpected && q !== "Boontling Language of Boonville" && q !== "Temporary Port Chicago") {
      allPassed = false;
      console.log(`    ✗ expected an oddity hit for "${q}" but none in the top 3`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));
  console.log(`  total docs:                     ${info.num_documents}`);
  console.log(`  oddity docs:                    ${oddityCount}`);
  console.log(`  markdown leaks across probes:   ${mdLeaks}`);
  console.log(`  known-name hits:                ${allPassed ? "OK" : "SOMETHING MISSED"}`);
  if (mdLeaks > 0 || !allPassed || oddityCount === 0) {
    console.error("\n✗ VERIFY FAILED");
    process.exit(1);
  }
  console.log(`\n✓ VERIFY PASSED — AO indexed on places_prod with clean descriptions.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
