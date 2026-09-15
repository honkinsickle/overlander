/**
 * Pin of the Day — build posts from a Google Sheet (no database).
 *
 * One sheet row per post: photo_url | place | category | state | country.
 * Each row gets the branded 1080x1350 composite (same compositor as
 * `potw:generate --render`) and a caption from the 12 templates, rotated by row
 * order. Everything lands in one folder with a review.html to check and copy
 * from. Nothing is read from or written to Supabase, and nothing is marked used.
 *
 * Usage (from repo root):
 *   npm run -w data potw:sheet -- --sheet <google sheet url> [--out <dir>]
 *
 * The sheet must be shared "anyone with the link can view". photo_url may be a
 * local file path (shell-style "\ " escapes are accepted) or an http(s) URL.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CAPTION_TEMPLATES, TEMPLATE_COUNT, interpolate } from "./caption.ts";
import { compositePost } from "./composite.ts";
import { categoryLabel, regionLine } from "./image-prompt.ts";

export interface SheetRow {
  photo: string;
  place: string;
  category: string;
  state: string;
  country: string;
}

/** Minimal RFC 4180 CSV parse: quoted fields, "" escapes, CRLF, newlines in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/**
 * Map CSV rows to SheetRows by header name. The photo column is the first header
 * containing "url" (so a misspelled "pohoto_url" still works); the rest match by
 * exact name, case-insensitive.
 */
export function toSheetRows(csv: string[][]): SheetRow[] {
  const [header, ...body] = csv;
  if (!header) throw new Error("sheet is empty");
  const names = header.map((h) => h.trim().toLowerCase());
  const col = (name: string) => names.indexOf(name);
  const photo = names.findIndex((n) => n.includes("url"));
  const missing = [
    photo === -1 ? "photo_url" : null,
    ...["place", "category", "state", "country"].filter((n) => col(n) === -1),
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`sheet is missing column(s): ${missing.join(", ")}`);
  const get = (r: string[], i: number) => (r[i] ?? "").trim();
  return body.map((r) => ({
    photo: get(r, photo),
    place: get(r, col("place")),
    category: get(r, col("category")),
    state: get(r, col("state")),
    country: get(r, col("country")),
  }));
}

/** "https://docs.google.com/spreadsheets/d/<id>/edit..." → its CSV export URL. */
export function csvExportUrl(sheetUrl: string): string {
  const m = sheetUrl.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!m) throw new Error(`not a Google Sheets URL: ${sheetUrl}`);
  const gid = sheetUrl.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

/** "https://docs.google.com/spreadsheets/d/<id>/edit..." + a tab name → that
 *  tab's CSV url. `headers=0` is REQUIRED: without it gviz guesses a header row
 *  and fuses separate cells into one field. */
export function tabCsvUrl(sheetUrl: string, tab: string): string {
  const m = sheetUrl.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`no spreadsheet id in url: ${sheetUrl}`);
  const name = encodeURIComponent(tab.trim());
  return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&headers=0&sheet=${name}`;
}

/** A tab name that cannot exist. Fetching it tells us what Google returns for a
 *  MISSING tab — which is the first tab's data, with HTTP 200. */
export const BOGUS_TAB = "__potw_missing_tab_probe__";

/** Deep equality for parsed CSV grids. */
export function sameGrid(a: string[][], b: string[][]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) => row.length === b[i].length && row.every((c, j) => c === b[i][j]));
}

/** Fetch one tab by name. `fallback` is the grid returned for a known-missing
 *  tab; if this tab's payload matches it, the tab does not exist and Google
 *  silently served the first tab instead. */
export async function fetchTabRows(
  sheetUrl: string,
  tab: string,
  fallback: string[][] | null,
): Promise<string[][]> {
  const res = await fetch(tabCsvUrl(sheetUrl, tab));
  if (!res.ok) {
    throw new Error(
      `sheet fetch failed for tab "${tab}": HTTP ${res.status} ` +
        `(is it shared "anyone with the link can view"?)`,
    );
  }
  const rows = parseCsv(await res.text());
  if (fallback && sameGrid(rows, fallback)) {
    throw new Error(
      `no tab named "${tab}" — Google returned the first tab instead. ` +
        `Check the tab name for typos or a trailing space.`,
    );
  }
  return rows;
}

export interface CategoryTab {
  /** Direct image url or local path to this category's 1080x1350 overlay. */
  artUrl: string;
  /** Caption templates in n order. Index 0 is template 1. */
  templates: string[];
}

const ALLOWED_TOKENS = new Set(["place", "category", "state"]);

/** Parse a `<category>` tab: `art_url` in row 1, then `n | template` rows. */
export function parseCategoryTab(rows: string[][], tab: string): CategoryTab {
  const artRow = rows.find((r) => (r[0] ?? "").trim().toLowerCase() === "art_url");
  const artUrl = (artRow?.[1] ?? "").trim();
  if (!artUrl) throw new Error(`tab "${tab}": art_url is empty — set it to the overlay's url or path`);

  const numbered = rows
    .map((r) => [(r[0] ?? "").trim(), (r[1] ?? "").trim()] as const)
    .filter(([n, t]) => /^\d+$/.test(n) && t !== "");
  if (numbered.length === 0) throw new Error(`tab "${tab}": no caption templates found`);

  numbered.sort((a, b) => Number(a[0]) - Number(b[0]));
  numbered.forEach(([n], i) => {
    if (Number(n) !== i + 1) {
      throw new Error(`tab "${tab}": template numbers must be contiguous from 1 — saw ${n} at position ${i + 1}`);
    }
  });

  const templates = numbered.map(([, t]) => t);
  for (const [i, t] of templates.entries()) {
    for (const m of t.match(/\{[^{}]*\}/g) ?? []) {
      const token = m.slice(1, -1);
      if (!ALLOWED_TOKENS.has(token)) {
        throw new Error(`tab "${tab}" template ${i + 1}: unknown token ${m} — only {place} {category} {state}`);
      }
    }
    const stripped = t.replace(/\{[^{}]*\}/g, "");
    if (stripped.includes("{") || stripped.includes("}")) {
      throw new Error(`tab "${tab}" template ${i + 1}: unmatched brace in "${t}" — only {place} {category} {state}`);
    }
  }
  return { artUrl, templates };
}

export interface PostRow {
  photo: string;
  place: string;
  state: string;
  country: string;
  /** Empty means not yet posted. */
  posted: string;
  /** 1-based row number in the sheet, for error messages. */
  rowNumber: number;
}

/** Parse a `<category> posts` tab. No category column — the tab name carries it. */
export function parsePostsTab(rows: string[][], tab: string): PostRow[] {
  const [header, ...body] = rows;
  if (!header) throw new Error(`tab "${tab}": empty`);
  const names = header.map((h) => h.trim().toLowerCase());
  const col = (want: string) => names.findIndex((n) => n === want);
  const photo = names.findIndex((n) => n.includes("url"));
  const missing = [
    photo === -1 ? "photo_url" : null,
    ...["place", "state", "country", "posted"].filter((n) => col(n) === -1),
  ].filter(Boolean);
  if (missing.length > 0) throw new Error(`tab "${tab}": missing column(s): ${missing.join(", ")}`);

  const get = (r: string[], i: number) => (r[i] ?? "").trim();
  return body.map((r, i) => ({
    photo: get(r, photo),
    place: get(r, col("place")),
    state: get(r, col("state")),
    country: get(r, col("country")),
    posted: get(r, col("posted")),
    rowNumber: i + 2,
  }));
}

/** The queue is row order. The next post is the first row with an empty `posted`. */
export function nextUnposted(rows: PostRow[]): PostRow | null {
  return rows.find((r) => r.posted === "") ?? null;
}

/** Undo shell-style escaping a pasted path may carry ("McArthur\ Falls") and expand "~". */
export function cleanLocalPath(p: string): string {
  const unescaped = p.trim().replace(/\\(.)/g, "$1");
  return unescaped.startsWith("~/") ? join(homedir(), unescaped.slice(2)) : unescaped;
}

/** Row index (0-based) → template number 1..12, cycling in order. */
export function templateForRow(index: number): number {
  return (index % TEMPLATE_COUNT) + 1;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function loadPhoto(photo: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(photo)) {
    const res = await fetch(photo);
    if (!res.ok) throw new Error(`photo fetch failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(cleanLocalPath(photo));
}

interface Built {
  row: SheetRow;
  slug: string;
  templateNumber: number;
  caption: string;
  image: Buffer;
}

function reviewHtml(built: Built[]): string {
  const cards = built
    .map(
      (b, i) => `<section>
  <img src="data:image/png;base64,${b.image.toString("base64")}" alt="${escapeHtml(b.row.place)}">
  <div class="meta">
    <h2>${escapeHtml(b.row.place)}</h2>
    <p class="sub">Template ${b.templateNumber}</p>
    <pre id="c${i}">${escapeHtml(b.caption)}</pre>
    <button onclick="navigator.clipboard.writeText(document.getElementById('c${i}').textContent);this.textContent='Copied'">Copy caption</button>
  </div>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>Pin of the Day — review</title>
<style>
  body { margin: 0; padding: 24px 16px; background: #0a0b0c; color: #eee; font: 15px/1.5 Barlow, system-ui, sans-serif; }
  section { display: flex; flex-wrap: wrap; gap: 24px; max-width: 1000px; margin: 0 auto 48px; }
  img { width: 360px; max-width: 100%; border-radius: 6px; }
  .meta { flex: 1; min-width: 260px; }
  h2 { margin: 0; }
  .sub { color: #c8a96e; margin: 4px 0 12px; }
  pre { white-space: pre-wrap; font: inherit; background: #17191b; padding: 12px; border-radius: 6px; }
  button { background: #c8a96e; color: #0a0b0c; border: 0; padding: 8px 14px; border-radius: 4px; font-weight: 600; cursor: pointer; }
</style>
${cards}
`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const sheet = flag("--sheet");
  if (!sheet) throw new Error("usage: potw:sheet -- --sheet <google sheet url> [--out <dir>]");
  const out = resolve(flag("--out") ?? "pin-of-the-week/output/sheet");

  const res = await fetch(csvExportUrl(sheet));
  if (!res.ok) throw new Error(`sheet fetch failed: HTTP ${res.status} (is it shared "anyone with the link"?)`);
  const rows = toSheetRows(parseCsv(await res.text()));

  const built: Built[] = [];
  const failures: string[] = [];
  for (const [i, row] of rows.entries()) {
    const label = `row ${i + 2} (${row.place || "no place"})`;
    if (!row.place || !row.photo) {
      failures.push(`${label}: place and photo_url are required`);
      continue;
    }
    try {
      const templateNumber = templateForRow(i);
      const caption = interpolate(CAPTION_TEMPLATES[templateNumber - 1], {
        place: row.place,
        category: categoryLabel(row.category.toLowerCase()),
        state: row.state,
      });
      const image = await compositePost({
        baseImage: await loadPhoto(row.photo),
        overlayText: { title: row.place, subline: regionLine(row.state || null, row.country) },
        dimensions: { width: 1080, height: 1350 },
      });
      const slug = slugify(row.place);
      const dir = join(out, slug);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "image.png"), image);
      await writeFile(join(dir, "caption.txt"), caption + "\n");
      built.push({ row, slug, templateNumber, caption, image });
      console.log(`✓ ${label} → template ${templateNumber}`);
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await mkdir(out, { recursive: true });
  await writeFile(join(out, "review.html"), reviewHtml(built));
  console.log(`\n${built.length} built, ${failures.length} failed → ${join(out, "review.html")}`);
  for (const f of failures) console.log(`✗ ${f}`);
  if (failures.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
