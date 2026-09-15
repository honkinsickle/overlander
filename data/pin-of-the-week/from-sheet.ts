/**
 * Pin of the Day — build posts from a Google Sheet (no database).
 *
 * One run builds ONE category from its own pair of tabs: `<category>` carries
 * that category's overlay art url and its caption templates, and
 * `<category> posts` is its queue (photo_url | place | state | country |
 * posted). Each unposted row gets the branded 1080x1350 composite (same
 * compositor as `potw:generate --render`, with this category's art as the
 * overlay) and a caption from that category's templates, rotated by row order.
 * Everything lands in one folder with a review.html to check and copy from.
 * Nothing is read from or written to Supabase, and nothing is marked posted.
 *
 * Usage (from repo root):
 *   npm run -w data potw:sheet -- --sheet <url> --category <name> [--out <dir>] [--next-only]
 *
 * The sheet must be shared "anyone with the link can view". photo_url and
 * art_url may be a local file path (shell-style "\ " escapes are accepted) or
 * an http(s) URL.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { TEMPLATE_COUNT, interpolate } from "./caption.ts";
import { compositePost } from "./composite.ts";
import { categoryLabel, regionLine } from "./image-prompt.ts";

export interface SheetRow {
  photo: string;
  place: string;
  category: string;
  state: string;
  country: string;
}

/**
 * Minimal RFC 4180 CSV parse, keeping EVERY row — blank ones included, so a
 * row's index is its position in the sheet (row i is sheet row i+1). Blank rows
 * must survive the parse: `parsePostsTab` numbers rows for the sheet write-back,
 * and dropping a spacer row here would shift every row below it.
 */
export function parseCsvRows(text: string): string[][] {
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
  return rows;
}

/** True when every cell in the row is empty or whitespace. */
export function isBlankRow(row: string[]): boolean {
  return row.every((f) => f.trim() === "");
}

/** `parseCsvRows` with blank rows removed. For callers that do not number rows. */
export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).filter((r) => !isBlankRow(r));
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
  const rows = parseCsvRows(await res.text());
  if (fallback && sameGrid(rows, fallback)) {
    throw new Error(
      `no tab named "${tab}" — Google returned the first tab instead. ` +
        `Two different things look identical here, because this endpoint cannot ` +
        `tell them apart: either (a) there really is no such tab — check the name ` +
        `for typos or a stray leading/trailing space — or (b) "${tab}" IS the ` +
        `workbook's FIRST tab, whose data is byte-for-byte what a missing tab ` +
        `returns. If it is the first tab, add any throwaway tab ahead of it in the ` +
        `sheet (drag it to position 1) and re-run.`,
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

/**
 * Parse a `<category>` tab: `art_url` in row 1, then `n | template` rows.
 *
 * The `art_url` LABEL is usually not in the payload at all. gviz types a column
 * ONCE for the whole column, and column A of a category tab holds the template
 * numbers 1..12 — so gviz calls column A a `number` column and returns every
 * TEXT cell in it (the `art_url` label in A1, the `n` label in A3) as null.
 * Measured against the live sheet: `cols: [("A","","number"), ("B","","string")]`
 * and row 1 = `[None, "/…/scenic_overlay.png"]`, i.e. the grid arrives as
 * `[["", "<path>"], ["", "template"], ["1", "…"], …]`. So when no label row is
 * found, the art url is simply column B of the first row.
 */
export function parseCategoryTab(rows: string[][], tab: string): CategoryTab {
  const artRow = rows.find((r) => (r[0] ?? "").trim().toLowerCase() === "art_url");
  const artUrl = (artRow ? (artRow[1] ?? "") : (rows[0]?.[1] ?? "")).trim();
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
  /**
   * The row's TRUE 1-based position in the sheet (header is row 1, so the first
   * body row is 2), counting blank rows. Not just an error-message label: it
   * drives the caption-template rotation (`queueIndexOf`) AND it is the cell the
   * operator ticks `posted` in after publishing. Numbering rows AFTER dropping
   * blanks would point both of those at the wrong row — a wrong template plus a
   * date written into an innocent row, leaving the real one to republish.
   */
  rowNumber: number;
}

/** The documented, fixed column order of a `<category> posts` tab. This ORDER is
 *  the trustworthy signal; the header TEXT is not, for any column gviz has
 *  typed (see `parsePostsTab`). */
const POSTS_COLUMNS = ["photo_url", "place", "state", "country", "posted"] as const;

/**
 * Parse a `<category> posts` tab. No category column — the tab name carries it.
 *
 * Columns resolve by header NAME first (`photo_url` loosely, as the first header
 * containing "url", so a misspelled "pohoto_url" still works; the rest exactly).
 *
 * A name that does not resolve then falls back to its fixed position — but ONLY
 * when the header cell AT that position is empty. gviz types a column ONCE for
 * the whole column, so publishing one post (writing a date into `posted`) makes
 * column E a `date` column, and the TEXT cell in it — the `posted` header in E1 —
 * comes back null. Measured after the first real publish: `cols` = [(A,string),
 * (B,string),(C,string),(D,string),(E,date)] with `rows[0].c[4] == {v: None}`,
 * while the raw `/export?format=csv` of the same tab still shows
 * `photo_url,place,state,country,posted`. The header IS there; this endpoint
 * blanks it. Same root cause as the blanked `art_url` label in
 * `parseCategoryTab`. Without the fallback, publishing one post broke the NEXT
 * build of that category, for every category, forever.
 *
 * The blank test is what keeps this narrow: an EMPTY header cell is the evidence
 * of column typing, so only that is tolerated. A header holding some OTHER name
 * is a genuinely malformed tab and still fails loudly — reading a `notes` column
 * as `posted` would silently skip or republish rows, which is worse than the
 * crash. A header row too short to have the position at all fails the same way.
 */
export function parsePostsTab(rows: string[][], tab: string): PostRow[] {
  const [header, ...body] = rows;
  if (!header) throw new Error(`tab "${tab}": empty`);
  const names = header.map((h) => h.trim().toLowerCase());
  const byName = (want: string) =>
    want === "photo_url" ? names.findIndex((n) => n.includes("url")) : names.indexOf(want);

  const missing: string[] = [];
  const at = POSTS_COLUMNS.map((want, position) => {
    const named = byName(want);
    if (named !== -1) return named;
    if (names[position] === "") return position;
    missing.push(want);
    return -1;
  });
  if (missing.length > 0) throw new Error(`tab "${tab}": missing column(s): ${missing.join(", ")}`);
  const [photo, place, state, country, posted] = at;

  const get = (r: string[], i: number) => (r[i] ?? "").trim();
  // Number FIRST, drop blanks AFTER — a spacer row must not shift the rows below
  // it (see PostRow.rowNumber). `rows` arrives from parseCsvRows, which keeps
  // blank rows for exactly this reason.
  return body
    .map((r, i) => ({ cells: r, rowNumber: i + 2 }))
    .filter(({ cells }) => !isBlankRow(cells))
    .map(({ cells, rowNumber }) => ({
      photo: get(cells, photo),
      place: get(cells, place),
      state: get(cells, state),
      country: get(cells, country),
      posted: get(cells, posted),
      rowNumber,
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

/** Rotation is per category, by row order within that category's queue. */
export function templateForCategoryRow(index: number, count: number): number {
  if (count <= 0) throw new Error("category has no templates");
  return (index % count) + 1;
}

/**
 * A row's 0-based position in its category's FULL queue — the index the template
 * rotation must use. `parsePostsTab` numbers rows from the sheet (row 2 is the
 * first body row), so this inverts that. It is keyed to the SHEET row, so a
 * row's template is fixed by where it sits in the sheet and cannot drift when
 * rows above it are ticked posted or when a blank spacer row is added.
 *
 * Never index the rotation off a filtered array: the unposted subset shrinks as
 * rows are ticked `posted`, so a row's template would drift, and `--next-only`
 * (always a one-element batch) would render template 1 on every run forever.
 */
export function queueIndexOf(row: PostRow): number {
  return row.rowNumber - 2;
}

export interface PostMeta {
  category: string;
  place: string;
  state: string;
  country: string;
  templateNumber: number;
  /** Recorded because art lives behind a url that can change. */
  artUrl: string;
  sourceRow: number;
  caption: string;
}

export function buildMeta(
  category: string,
  row: PostRow,
  templateNumber: number,
  artUrl: string,
  caption: string,
): PostMeta {
  return {
    category,
    place: row.place,
    state: row.state,
    country: row.country,
    templateNumber,
    artUrl,
    sourceRow: row.rowNumber,
    caption,
  };
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
  row: PostRow;
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

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const sheet = flag("--sheet");
  const category = flag("--category")?.trim();
  if (!sheet || !category) {
    throw new Error("usage: potw:sheet -- --sheet <url> --category <name> [--out <dir>] [--next-only]");
  }
  const nextOnly = argv.includes("--next-only");
  const out = resolve(flag("--out") ?? join("pin-of-the-week/output/sheet", category));

  // Learn what a MISSING tab returns, so every later read can be checked against it.
  const fallback = await fetchTabRows(sheet, BOGUS_TAB, null).catch(() => null);
  if (!fallback) {
    // Degrade open, but never silently: with no probe grid to compare against,
    // fetchTabRows cannot tell a real tab from Google's first-tab fallback.
    console.log(
      `⚠ tab-existence guard is OFF (the probe fetch failed) — ` +
        `a mistyped --category may silently build another category's posts`,
    );
  }

  const cat = parseCategoryTab(await fetchTabRows(sheet, category, fallback), category);
  const postsTab = `${category} posts`;
  const queue = parsePostsTab(await fetchTabRows(sheet, postsTab, fallback), postsTab);

  const pending = queue.filter((r) => r.posted === "");
  const next = nextUnposted(queue);
  const chosen = nextOnly ? (next ? [next] : []) : pending;
  if (chosen.length === 0) {
    console.log(`nothing to build — every row in "${postsTab}" is already posted`);
    return;
  }

  // VALIDATE EVERYTHING FIRST — one bad row means zero output. Photos are read
  // here, not in the render loop, so a broken photo cannot leave a half batch on
  // disk; the render loop below reuses these buffers.
  const problems: string[] = [];
  const photos = new Map<number, Buffer>();
  for (const r of chosen) {
    if (!r.place || !r.photo) {
      problems.push(`${postsTab} row ${r.rowNumber}: place and photo_url are required`);
      continue;
    }
    try {
      photos.set(r.rowNumber, await loadPhoto(r.photo));
    } catch (e) {
      problems.push(`${postsTab} row ${r.rowNumber}: photo could not be read — ${errText(e)}`);
    }
  }
  const overlay = await loadPhoto(cat.artUrl).catch((e) => {
    problems.push(`tab "${category}": art_url could not be read — ${errText(e)}`);
    return null;
  });
  if (problems.length > 0) {
    console.log(`✗ nothing built — ${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  // RENDER EVERYTHING, WRITE NOTHING. Template rotation is indexed off the row's
  // position in the FULL queue, not in this batch — see queueIndexOf.
  const built: Built[] = [];
  for (const row of chosen) {
    const templateNumber = templateForCategoryRow(queueIndexOf(row), cat.templates.length);
    const caption = interpolate(cat.templates[templateNumber - 1], {
      place: row.place,
      category: categoryLabel(category.toLowerCase()),
      state: row.state,
    });
    const image = await compositePost({
      baseImage: photos.get(row.rowNumber)!,
      overlayImage: overlay!,
      overlayText: { title: row.place, subline: regionLine(row.state || null, row.country) },
      dimensions: { width: 1080, height: 1350 },
    });
    built.push({ row, slug: slugify(row.place), templateNumber, caption, image });
  }

  // ONLY NOW touch the disk — every composite has already succeeded, so an I/O
  // failure here cannot leave a half-written batch behind.
  for (const b of built) {
    const dir = join(out, b.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "image.png"), b.image);
    await writeFile(join(dir, "caption.txt"), b.caption + "\n");
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify(buildMeta(category, b.row, b.templateNumber, cat.artUrl, b.caption), null, 2) + "\n",
    );
    // The dir is printed in full (it is absolute — `out` is resolved above)
    // because it is what the operator stages from: earlier runs leave their own
    // dirs on disk, so "find the folder" by globbing can land on a stale post.
    console.log(`✓ ${b.row.place} → ${category} template ${b.templateNumber} → ${dir}`);
  }

  await mkdir(out, { recursive: true });
  await writeFile(join(out, "review.html"), reviewHtml(built));
  console.log(`\n${built.length} built → ${join(out, "review.html")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
