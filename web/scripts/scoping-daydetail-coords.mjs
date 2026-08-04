// Read-only: coords coverage by pool SOURCE and by trip SHAPE, across every
// reachable trip on both databases. Answers "is the 48% coords gap tied to
// reference-derived shape or per-trip variation?"
import { readFileSync } from "node:fs";

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
async function fetchAll(base, key, table) {
  const url = `${base}/rest/v1/${table}?select=id,payload`;
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) return [];
  return res.json();
}
function hasCoords(t) {
  return Array.isArray(t.coords) && t.coords.length >= 2 &&
    typeof t.coords[0] === "number" && typeof t.coords[1] === "number";
}
// Per-source tallies for one trip.
function tally(payload) {
  const src = { seg: [0, 0], sug: [0, 0], wp: [0, 0] }; // [total, withCoords]
  for (const d of payload.days ?? []) {
    for (const t of d.segmentSuggestions ?? []) { src.seg[0]++; if (hasCoords(t)) src.seg[1]++; }
    for (const t of Object.values(d.suggestions ?? {})) { src.sug[0]++; if (hasCoords(t)) src.sug[1]++; }
    for (const t of d.waypoints ?? []) { src.wp[0]++; if (hasCoords(t)) src.wp[1]++; }
  }
  return src;
}
const pct = (a, b) => (b === 0 ? "  –" : `${Math.round((100 * a) / b)}%`.padStart(4));

const DBS = [
  { name: "PROD", env: "web/.env.local" },
  { name: "TEST", env: "web/.env.development.local" },
];
const agg = { generated: mk(), other: mk() };
function mk() { return { trips: 0, seg: [0, 0], sug: [0, 0], wp: [0, 0] }; }

for (const db of DBS) {
  const env = loadEnv(db.env);
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  for (const table of ["trips", "reference_trips"]) {
    const rows = await fetchAll(base, key, table);
    for (const r of rows) {
      const p = r.payload;
      if (!p || !Array.isArray(p.days)) continue;
      const gen = p.generated === true;
      const s = tally(p);
      const shape = gen ? "generated" : "other";
      const bucket = agg[shape];
      bucket.trips++;
      for (const k of ["seg", "sug", "wp"]) { bucket[k][0] += s[k][0]; bucket[k][1] += s[k][1]; }
      const tot = s.seg[0] + s.sug[0] + s.wp[0];
      const wc = s.seg[1] + s.sug[1] + s.wp[1];
      console.log(
        `${db.name}/${table.padEnd(15)} ${String(r.id).slice(0, 24).padEnd(24)} ` +
        `gen=${gen ? "Y" : "n"} days=${String(p.days.length).padStart(3)} ` +
        `tiles=${String(tot).padStart(4)} coords=${pct(wc, tot)}  ` +
        `seg ${String(s.seg[0]).padStart(3)}/${pct(s.seg[1], s.seg[0])} ` +
        `sug ${String(s.sug[0]).padStart(3)}/${pct(s.sug[1], s.sug[0])} ` +
        `wp ${String(s.wp[0]).padStart(3)}/${pct(s.wp[1], s.wp[0])}`,
      );
    }
  }
}
console.log("\n=== AGGREGATE by shape (coords coverage per source) ===");
for (const [shape, b] of Object.entries(agg)) {
  console.log(
    `${shape.padEnd(10)} trips=${b.trips}  ` +
    `seg ${b.seg[1]}/${b.seg[0]}=${pct(b.seg[1], b.seg[0])}  ` +
    `sug ${b.sug[1]}/${b.sug[0]}=${pct(b.sug[1], b.sug[0])}  ` +
    `wp ${b.wp[1]}/${b.wp[0]}=${pct(b.wp[1], b.wp[0])}`,
  );
}
