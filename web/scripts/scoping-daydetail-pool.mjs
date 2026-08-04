// Read-only scoping measurement: placePool(day) size distribution per trip.
// pool = segmentSuggestions ∪ Object.values(suggestions) ∪ waypoints
// (exactly placePool()'s composition in day-detail-corridor-column.tsx:1148).
import { readFileSync } from "node:fs";

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function fetchRow(base, key, table, col, id) {
  const url = `${base}/rest/v1/${table}?${col}=eq.${id}&select=payload`;
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.payload ?? null;
}

function poolCount(day) {
  const seg = (day.segmentSuggestions ?? []).length;
  const sug = Object.values(day.suggestions ?? {}).length;
  const wp = (day.waypoints ?? []).length;
  return { seg, sug, wp, total: seg + sug + wp };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

async function measure(label, envPath, id) {
  const env = loadEnv(envPath);
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  let payload = await fetchRow(base, key, "trips", "id", id);
  let src = "trips.id";
  if (!payload) { payload = await fetchRow(base, key, "reference_trips", "id", id); src = "reference_trips.id"; }
  if (!payload) { console.log(`\n### ${label} (${id}) — NOT FOUND in trips or reference_trips`); return; }
  const days = payload.days ?? [];
  const per = days.map((d, i) => {
    const c = poolCount(d);
    const rest = !!(d.startCoord && d.coords && d.startCoord[0] === d.coords[0] && d.startCoord[1] === d.coords[1] && (d.miles ?? 0) === 0 && (d.corridorCities?.length ?? 0) === 0);
    return { day: d.dayNumber ?? i + 1, ...c, rest };
  });
  const totals = per.map((p) => p.total);
  console.log(`\n### ${label} (${id}) — source=${src}, ${days.length} days`);
  console.log(`curatedMode(any curated seg)=${days.some((d) => (d.segmentSuggestions ?? []).some((s) => s.curated))}`);
  console.log(`pool.total: min=${Math.min(...totals)} median=${median(totals)} max=${Math.max(...totals)} sum=${totals.reduce((a, b) => a + b, 0)}`);
  console.log(`composition sums: seg=${per.reduce((a, p) => a + p.seg, 0)} suggestions=${per.reduce((a, p) => a + p.sug, 0)} waypoints=${per.reduce((a, p) => a + p.wp, 0)}`);
  console.log(`rest days: ${per.filter((p) => p.rest).map((p) => `day${p.day}(pool=${p.total})`).join(", ") || "none"}`);
  console.log("per-day pool.total: " + per.map((p) => p.total).join(", "));
  const top = [...per].sort((a, b) => b.total - a.total).slice(0, 3);
  console.log("top-3 days: " + top.map((p) => `day${p.day}=${p.total}(seg${p.seg}/sug${p.sug}/wp${p.wp})`).join(", "));
}

await measure("PROD 4534add5 SD→Portland", ".env.local", "4534add5-3787-4b5f-ade6-584ce0fc27e7");
await measure("TEST expedition-ms28y793", ".env.development.local", "expedition-ms28y793");
await measure("TEST fork 05b346df", ".env.development.local", "05b346df-3bb5-4c46-8ff1-e0c5cfe26301");
