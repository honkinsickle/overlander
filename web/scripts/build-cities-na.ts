/**
 * Build the bundled North-America gazetteer for the corridor-cities
 * derivation (docs/corridor-cities-spec.md §2.1.1).
 *
 * Inputs — download fresh from GeoNames (refresh ~annually; cities don't move):
 *   curl -O https://download.geonames.org/export/dump/cities5000.zip && unzip cities5000.zip
 *   curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
 *
 * Usage:
 *   npx tsx scripts/build-cities-na.ts <path/to/cities5000.txt> <path/to/admin1CodesASCII.txt>
 *
 * Output: src/lib/corridor/data/cities-na.json — a JSON array, one row per
 * line for reviewable diffs. Fields per row: { name, admin, lat, lng, pop }.
 * Filtered to US + Canada. `admin` is a postal abbreviation ("CA", "YT").
 * Only the fields the §2.1.2 prominence filter consumes are kept.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// GeoNames "geoname" table columns (readme.txt): 0 geonameid, 1 name,
// 2 asciiname, 3 alternatenames, 4 latitude, 5 longitude, 6 feature_class,
// 7 feature_code, 8 country_code, 9 cc2, 10 admin1_code, 11 admin2_code,
// 12 admin3_code, 13 admin4_code, 14 population, 15 elevation, 16 dem,
// 17 timezone, 18 modification_date
const COL = {
  name: 1,
  lat: 4,
  lng: 5,
  featureClass: 6,
  country: 8,
  admin1: 10,
  population: 14,
} as const;

/** GeoNames Canadian admin1 codes are numeric (admin1CodesASCII.txt gives
 *  full names only), so postal abbreviations need a static map. US admin1
 *  codes are already postal ("CA", "AZ") and pass through unchanged. */
const CA_ADMIN1_TO_POSTAL: Record<string, string> = {
  "01": "AB",
  "02": "BC",
  "03": "MB",
  "04": "NB",
  "05": "NL",
  "07": "NS",
  "08": "ON",
  "09": "PE",
  "10": "QC",
  "11": "SK",
  "12": "YT",
  "13": "NT",
  "14": "NU",
};

type GazetteerCity = {
  name: string;
  admin: string;
  lat: number;
  lng: number;
  pop: number;
};

const [citiesPath, admin1Path] = process.argv.slice(2);
if (!citiesPath || !admin1Path) {
  console.error(
    "usage: npx tsx scripts/build-cities-na.ts <cities5000.txt> <admin1CodesASCII.txt>",
  );
  process.exit(1);
}

// admin1CodesASCII.txt is only used to VERIFY the static Canada map is
// complete — every CA.* code in the lookup must have a postal mapping.
const admin1Lines = readFileSync(admin1Path, "utf8").split("\n");
for (const line of admin1Lines) {
  if (!line.startsWith("CA.")) continue;
  const code = line.split("\t")[0].slice(3);
  if (!CA_ADMIN1_TO_POSTAL[code]) {
    console.error(`Canada admin1 code CA.${code} missing from postal map`);
    process.exit(1);
  }
}

const rows = readFileSync(citiesPath, "utf8").split("\n");
const cities: GazetteerCity[] = [];
let skippedMalformed = 0;
let usCount = 0;
let caCount = 0;

for (const row of rows) {
  if (!row.trim()) continue;
  const f = row.split("\t");
  const country = f[COL.country];
  if (country !== "US" && country !== "CA") continue;
  if (f[COL.featureClass] !== "P") continue;

  const name = f[COL.name];
  const lat = Number(f[COL.lat]);
  const lng = Number(f[COL.lng]);
  const pop = Number(f[COL.population]);
  const admin =
    country === "US" ? f[COL.admin1] : CA_ADMIN1_TO_POSTAL[f[COL.admin1]];

  if (
    !name ||
    !admin ||
    !/^[A-Z]{2}$/.test(admin) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isInteger(pop) ||
    pop < 0
  ) {
    skippedMalformed++;
    console.error(`skipping malformed row: ${f.slice(0, 3).join(" | ")}`);
    continue;
  }
  cities.push({ name, admin, lat, lng, pop });
  if (country === "US") usCount++;
  else caCount++;
}

// Stable order across refreshes → reviewable diffs.
cities.sort(
  (a, b) =>
    a.name.localeCompare(b.name) ||
    a.admin.localeCompare(b.admin) ||
    b.pop - a.pop,
);

const outPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/corridor/data/cities-na.json",
);
mkdirSync(dirname(outPath), { recursive: true });
const body = cities.map((c) => JSON.stringify(c)).join(",\n");
writeFileSync(outPath, `[\n${body}\n]\n`);

console.log(
  `wrote ${cities.length} cities (US ${usCount}, CA ${caCount}; skipped ${skippedMalformed} malformed) → ${outPath}`,
);
