/**
 * Foursquare — re-probe the 404, and recover the taxonomy from data.
 *
 * READ-ONLY: GETs against Foursquare's public Places API. No DB, no writes.
 *
 * WHY THIS EXISTS. #366 reported that Foursquare's category-taxonomy endpoint
 * 404s across 24 path/version/auth combinations, and concluded the vocabulary
 * is "unenumerable" — which forced every Foursquare finding in #364/#366 to
 * come from a NAME TEXT-SEARCH rather than a category filter, and left the
 * Mapbox-vs-Foursquare comparison explicitly unsettled ("category-filter vs
 * name-search are different instruments").
 *
 * ⚠ A DISTINCTION THAT MATTERS AND HAS BEEN BLURRED IN THE HANDOFFS. What 404s
 * is the taxonomy ENUMERATION endpoint (`/places/categories`). The SEARCH
 * endpoint does not 404 — `foursquare.ts` calls it in production TODAY with a
 * `fsq_category_ids=` filter and it works. So "Foursquare category search is
 * 404ing" is not the state of the world; "Foursquare's category LIST cannot be
 * downloaded" is. This script establishes which of the two is true, by running
 * both.
 *
 * THE NEW MOVE. If the list cannot be downloaded, the ids can still be
 * RECOVERED from data: every place in a search response carries its own
 * `categories[].fsq_category_id`. So a free-text search for "auto repair"
 * hands back the very category ids that classify auto repair shops. This pass
 * harvests ids that way, then FEEDS THEM BACK as `fsq_category_ids=` filters —
 * which is the like-for-like category-filter instrument #366 said was
 * unavailable. That closes #366's open comparison rather than repeating it.
 *
 * LIMITS on what the recovered ids license. A harvested id is evidence that
 * Foursquare HAS that category, and the filtered counts that follow are real
 * category-filter measurements. But the harvest is seeded by text queries, so
 * the id set is a SAMPLE of the taxonomy reachable from those seeds — it is not
 * the taxonomy. Nothing here is a population claim about Foursquare's
 * vocabulary.
 */
/** This script has no imports, so without an explicit export it would be a
 *  GLOBAL script rather than a module — and its top-level `POINTS` would
 *  collide with the identically-named const in the sibling coverage scripts,
 *  failing `npm run -w web typecheck` in a file this one never touches. */
export {};

const FSQ_SEARCH = "https://places-api.foursquare.com/places/search";
const FSQ_VERSION = "2025-06-17";

/** Every combination #366 tried, re-run verbatim so "still broken" is a
 *  measurement rather than an assumption. */
const TAXONOMY_ATTEMPTS: { url: string; version?: string; auth: "bearer" | "raw" | "none" }[] = [];
for (const path of [
  "https://places-api.foursquare.com/places/categories",
  "https://places-api.foursquare.com/categories",
  "https://places-api.foursquare.com/places/taxonomy",
  "https://api.foursquare.com/v3/places/categories",
]) {
  for (const version of ["2025-06-17", "2025-02-05", undefined]) {
    for (const auth of ["bearer", "raw"] as const) {
      TAXONOMY_ATTEMPTS.push({ url: path, version, auth });
    }
  }
}

/** Six points, one per state — the metro tier from #366, so Foursquare's
 *  numbers land on the same ground as the Mapbox pass. */
const POINTS: { state: string; label: string; ll: [number, number] }[] = [
  { state: "OR", label: "Portland", ll: [45.515, -122.7] },
  { state: "WA", label: "Seattle", ll: [47.6, -122.35] },
  { state: "AZ", label: "Phoenix", ll: [33.45, -112.1] },
  { state: "UT", label: "Salt Lake City", ll: [40.75, -111.9] },
  { state: "NV", label: "Las Vegas", ll: [36.15, -115.2] },
  { state: "CA", label: "San Diego", ll: [32.74, -117.28] },
];

/** Two genuinely remote points, to check whether Foursquare thins out in the
 *  same places Mapbox does. Same coords as the Mapbox pass's remote tier. */
const REMOTE: { state: string; label: string; ll: [number, number] }[] = [
  { state: "UT", label: "Hole-in-the-Rock Rd", ll: [37.55, -111.0] },
  { state: "NV", label: "Black Rock Desert", ll: [40.87, -119.06] },
];

/** Seed queries — the routing rows this investigation has to answer for. */
const SEEDS = [
  "auto repair", "car wash", "ev charging", "electric vehicle charging",
  "gas station", "rv dump station", "public shower", "potable water",
  "shopping mall", "grocery", "trailhead", "campground",
];

const RADIUS_M = 10_000;

type FsqCat = { fsq_category_id: string; name: string };
type FsqPlace = { fsq_place_id: string; name: string; categories?: FsqCat[] };
type FsqResp = { results?: FsqPlace[]; message?: string };

async function fsq(
  params: Record<string, string>,
  key: string,
): Promise<{ status: number; body: FsqResp | null }> {
  const url = `${FSQ_SEARCH}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-places-api-version": FSQ_VERSION,
      authorization: `Bearer ${key}`,
    },
  });
  const body = (await res.json().catch(() => null)) as FsqResp | null;
  return { status: res.status, body };
}

async function main() {
  const key = process.env.FSQ_API_KEY;
  if (!key) {
    console.error(
      "FSQ_API_KEY not set. From web/:\n" +
        `  export FSQ_API_KEY=$(grep '^FSQ_API_KEY=' .env.local | cut -d= -f2-)`,
    );
    process.exit(2);
  }
  console.log(`Run started: ${new Date().toISOString()}\n`);

  // ── 1. Control: does the SEARCH endpoint work at all? ──────────────────
  console.log("── Control: /places/search (the endpoint production uses) ──");
  const ctrl = await fsq(
    { ll: `${POINTS[0].ll[0]},${POINTS[0].ll[1]}`, radius: String(RADIUS_M), limit: "10" },
    key,
  );
  console.log(
    `HTTP ${ctrl.status} · ${ctrl.body?.results?.length ?? 0} results` +
      (ctrl.body?.message ? ` · message: ${ctrl.body.message}` : ""),
  );

  // ── 2. Control: category FILTER on search, with an id the app ships ────
  //    FSQ_TOP_LEVEL_IDS.scenic = Outdoors and Recreation.
  console.log("\n── Control: /places/search WITH fsq_category_ids (app's own id) ──");
  const filtered = await fsq(
    {
      ll: `${POINTS[0].ll[0]},${POINTS[0].ll[1]}`,
      radius: String(RADIUS_M),
      limit: "10",
      fsq_category_ids: "4d4b7105d754a06377d81259",
    },
    key,
  );
  console.log(
    `HTTP ${filtered.status} · ${filtered.body?.results?.length ?? 0} results` +
      (filtered.body?.message ? ` · message: ${filtered.body.message}` : ""),
  );

  // ── 3. The taxonomy endpoint — all 24 combinations, re-run ─────────────
  console.log(`\n── Taxonomy enumeration: ${TAXONOMY_ATTEMPTS.length} combinations ──`);
  const statuses = new Map<number, number>();
  let anyOk = false;
  for (const a of TAXONOMY_ATTEMPTS) {
    const headers: Record<string, string> = { accept: "application/json" };
    if (a.version) headers["x-places-api-version"] = a.version;
    if (a.auth === "bearer") headers.authorization = `Bearer ${key}`;
    else headers.authorization = key;
    let status = 0;
    let snippet = "";
    try {
      const res = await fetch(a.url, { headers });
      status = res.status;
      snippet = (await res.text().catch(() => "")).slice(0, 120);
      if (res.ok) anyOk = true;
    } catch (e) {
      snippet = String(e).slice(0, 120);
    }
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    if (status === 200) {
      console.log(`  200 ← ${a.url} v=${a.version ?? "(none)"} auth=${a.auth}`);
      console.log(`      ${snippet}`);
    }
  }
  console.log(
    `Status distribution: ${[...statuses.entries()].map(([s, n]) => `${s}×${n}`).join(" ")}`,
  );
  console.log(
    anyOk
      ? "⚠ AT LEAST ONE COMBINATION SUCCEEDED — #366's finding no longer holds."
      : "Every combination failed — #366's finding REPRODUCES.",
  );

  // ── 4. Recover category ids from search data ──────────────────────────
  console.log(`\n── Taxonomy recovery: harvest fsq_category_id from search results ──`);
  const harvested = new Map<string, { name: string; seeds: Set<string>; places: number }>();
  for (const seed of SEEDS) {
    const perSeed = new Map<string, number>();
    for (const p of POINTS) {
      const r = await fsq(
        { ll: `${p.ll[0]},${p.ll[1]}`, radius: String(RADIUS_M), limit: "50", query: seed },
        key,
      );
      for (const pl of r.body?.results ?? []) {
        for (const c of pl.categories ?? []) {
          perSeed.set(c.fsq_category_id, (perSeed.get(c.fsq_category_id) ?? 0) + 1);
          let h = harvested.get(c.fsq_category_id);
          if (!h) harvested.set(c.fsq_category_id, (h = { name: c.name, seeds: new Set(), places: 0 }));
          h.seeds.add(seed);
          h.places++;
        }
      }
    }
    const top = [...perSeed.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => `${harvested.get(id)?.name ?? id}(${n})`);
    console.log(`  "${seed}" → ${top.join(" · ") || "(nothing)"}`);
  }
  console.log(`\nDistinct category ids recovered: ${harvested.size}`);

  // ── 5. Feed recovered ids back as FILTERS — the like-for-like probe ────
  //    Pick the single best-matching recovered id per routing row by name.
  //    ⚠ These patterns are deliberately anchored on WHOLE category names, not
  //    loose substrings. The first draft used /dump|sanitary/ and matched
  //    "Dumpling Restaurant" — which would have been printed as a dump-station
  //    coverage figure. A matcher that can name the wrong category is the same
  //    class of error this whole investigation is trying to find.
  const WANT: { row: string; match: RegExp }[] = [
    { row: "Auto/Repair", match: /^(automotive repair shop|auto (repair|workshop)|mechanic)$/i },
    { row: "Car wash", match: /^car wash( and detail)?$/i },
    { row: "EV charging", match: /^electric vehicle charging station$/i },
    { row: "Gas", match: /^(fuel|gas) station$/i },
    { row: "Dump station", match: /^(rv )?(dump|sanitary dump) station$/i },
    { row: "Shower", match: /^(public )?shower/i },
    { row: "Drinking water", match: /^(drinking|potable) (water|fountain)/i },
    { row: "Shopping mall", match: /^shopping mall$/i },
    { row: "Grocery", match: /^grocery store$/i },
    { row: "Trailhead", match: /^(hiking )?trail(head)?$/i },
    { row: "Campground", match: /^campground$/i },
    { row: "RV park", match: /^rv park$/i },
  ];
  console.log(`\n── Category-FILTER coverage using recovered ids (6 metro + 2 remote) ──`);
  console.log(
    `This is the like-for-like instrument #366 lacked: a category filter, not a\n` +
      `name search. "metro"/"remote" = points returning >=1 result.\n`,
  );
  console.log(`${"row".padEnd(16)} ${"category id / name".padEnd(46)} ${"metro".padStart(6)} ${"remote".padStart(7)} ${"feat".padStart(6)}`);
  for (const w of WANT) {
    const cand = [...harvested.entries()]
      .filter(([, v]) => w.match.test(v.name))
      .sort((a, b) => b[1].places - a[1].places)[0];
    if (!cand) {
      // Characterise the absence rather than just reporting it: list every
      // harvested name sharing a keyword, so "no id" is distinguishable from
      // "the strict matcher missed one".
      const kw = w.row.split("/")[0].split(" ")[0].toLowerCase();
      const near = [...harvested.values()]
        .filter((v) => v.name.toLowerCase().includes(kw))
        .map((v) => v.name);
      console.log(
        `${w.row.padEnd(16)} ${"(no id recovered)".padEnd(46)} ${"—".padStart(6)} ${"—".padStart(7)} ${"—".padStart(6)}` +
          `   near-names: ${near.length ? near.join(", ") : "(none at all)"}`,
      );
      continue;
    }
    const [id, meta] = cand;
    let metroHits = 0, remoteHits = 0, feats = 0;
    for (const p of POINTS) {
      const r = await fsq(
        { ll: `${p.ll[0]},${p.ll[1]}`, radius: String(RADIUS_M), limit: "50", fsq_category_ids: id },
        key,
      );
      const n = r.body?.results?.length ?? 0;
      if (n > 0) metroHits++;
      feats += n;
    }
    for (const p of REMOTE) {
      const r = await fsq(
        { ll: `${p.ll[0]},${p.ll[1]}`, radius: String(RADIUS_M), limit: "50", fsq_category_ids: id },
        key,
      );
      const n = r.body?.results?.length ?? 0;
      if (n > 0) remoteHits++;
      feats += n;
    }
    console.log(
      `${w.row.padEnd(16)} ${`${id} ${meta.name}`.slice(0, 46).padEnd(46)} ${`${metroHits}/6`.padStart(6)} ${`${remoteHits}/2`.padStart(7)} ${String(feats).padStart(6)}`,
    );
  }

  console.log(`\nRun finished: ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
