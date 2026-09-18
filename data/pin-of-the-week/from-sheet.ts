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
 * post_art_url may be a local file path (shell-style "\ " escapes are accepted) or
 * an http(s) URL.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { TEMPLATE_COUNT, interpolate } from "./caption.ts";
import { compositePost, padStoryForWeb } from "./composite.ts";
import { categoryLabel, regionLine } from "./image-prompt.ts";
import {
  defaultReadDeps,
  fetchTabGrid,
  findLabel,
  findPostsHeader,
  valueRightOf,
} from "./sheet-read.ts";

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

export interface CategoryTab {
  /** Direct image url or local path to this category's 1080x1350 overlay. */
  artUrl: string;
  /**
   * This category's 1080x1920 STORY overlay. Empty when the category has none,
   * which simply means no story is rendered for it. Separate art rather than a
   * re-crop of `artUrl`: Instagram's story composer center-crops a 4:5 asset to
   * fill 9:16 and slices the header, the category chip and the title
   * `[measured 2026-09-16]`.
   */
  storyArtUrl: string;
  /** Caption templates in n order. Index 0 is template 1. */
  templates: string[];
}

const ALLOWED_TOKENS = new Set(["place", "category", "state"]);

/**
 * Parse a `<category>` tab. Everything is found BY LABEL, anywhere in the grid:
 * `post_art_url`, `story_art_url`, and `n` each name the cell to their right
 * (for `n`, the column to its right). `art_url` is still read as the former name
 * of `post_art_url` — see the note in the body.
 *
 * ~~`art_url` in row 1, then `n | template` rows.~~ **Rewritten 2026-09-17**,
 * when the reader moved from the gviz CSV endpoint to the Sheets API. Under gviz
 * the labels were not readable at all — it types a column once for the whole
 * column, and column A of a category tab holds the template numbers, so every
 * TEXT cell in it (`art_url` in A1, `n` in A3) came back blank. The old parser
 * therefore fell back to "column B of the first row", which worked only because
 * `art_url` happened to be first: swap those two rows and it would have put the
 * STORY overlay on a feed post, silently. That fallback is gone.
 *
 * ONE RULE, TWO LAYOUTS `[both verified against the live sheet 2026-09-17]`:
 *   - the original — `art_url | <url> | story_art_url | <url>` across row 1,
 *     `n` at A3, numbers in column A and templates in column B;
 *   - the newer — labels down column A under section headings (`art_url` at A6,
 *     `story_art_url` at A7), `n` at B10, numbers in column B and templates in
 *     column C.
 *
 * The templates are located from `n` rather than pinned to column A, because the
 * `template` header can sit above the wrong column — on the newer tab it is in
 * A10 while the text is in column C. Keying off `n` makes the position of the
 * word `template` irrelevant.
 */
export function parseCategoryTab(rows: string[][], tab: string): CategoryTab {
  // `post_art_url` is the name; `art_url` is still accepted, and deliberately so
  // rather than as speculative flexibility. The schedule publishes three times a
  // day from a live sheet, so code and sheet cannot be renamed in the same
  // instant — whichever moves first would break the other. Both names read here
  // makes the order irrelevant. Drop `art_url` once no tab uses it.
  const artUrl = valueRightOf(rows, "post_art_url") ?? valueRightOf(rows, "art_url");
  if (artUrl === null) {
    throw new Error(
      `tab "${tab}": no cell labelled post_art_url — the post overlay's path goes in the cell to its right`,
    );
  }
  if (artUrl === "") {
    throw new Error(`tab "${tab}": post_art_url is empty — set it to the overlay's url or path`);
  }

  // Optional throughout: absent means this category renders no story, which is
  // not an error. A category with no story art simply publishes posts.
  const storyArtUrl = valueRightOf(rows, "story_art_url") ?? "";

  // `n` names the column of template NUMBERS; the text is the column to its
  // right. Only rows BELOW the header are considered, so a stray number above it
  // cannot be read as template 1.
  const nAt = findLabel(rows, "n");
  if (!nAt) {
    throw new Error(
      `tab "${tab}": no cell labelled n — it must head the column of template numbers, ` +
        `with the template text in the column to its right`,
    );
  }
  const numbered = rows
    .slice(nAt.row + 1)
    .map((r) => [(r[nAt.col] ?? "").trim(), (r[nAt.col + 1] ?? "").trim()] as const)
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
  return { artUrl, storyArtUrl, templates };
}

export interface PostRow {
  photo: string;
  place: string;
  state: string;
  country: string;
  /** Empty means not yet posted. */
  posted: string;
  /**
   * The row's 9:16 story photo. Empty when the tab has no `story_photo_url`
   * column, or the row leaves it blank. Separate from `photo` because a story is
   * 9:16 and the post is 4:5 — reusing the post photo crops the subject.
   */
  storyPhoto: string;
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

/**
 * Parse a `<category> posts` tab. No category column — the tab name carries it.
 *
 * Every column is resolved BY NAME via `findPostsHeader`, so the tab may carry a
 * title row, blank spacer rows and columns, its own column order and extra
 * columns. Nothing is inferred from position.
 *
 * ~~Columns resolve by fixed position, with a narrow repair when a typed header
 * came back blank.~~ **Replaced 2026-09-17** along with the move to the Sheets
 * API — see `findPostsHeader` for why the repair had nothing left to repair.
 *
 * `rowNumber` is the row's TRUE position in the sheet, taken from the grid index
 * and NOT counted from the header. It drives the caption-template rotation and it
 * is the row whose `posted` cell gets ticked, so an off-by-one here writes a date
 * into an innocent row and leaves the real one queued to republish.
 */
export function parsePostsTab(rows: string[][], tab: string): PostRow[] {
  const header = findPostsHeader(rows, tab);
  const get = (r: string[], i: number) => (i === -1 ? "" : (r[i] ?? "").trim());

  // Number FIRST, drop blanks AFTER — a spacer row must not shift the rows below
  // it (see PostRow.rowNumber).
  return rows
    .map((cells, i) => ({ cells: cells ?? [], rowNumber: i + 1 }))
    .filter(({ rowNumber }) => rowNumber > header.row + 1)
    .filter(({ cells }) => !isBlankRow(cells))
    .map(({ cells, rowNumber }) => ({
      photo: get(cells, header.photo),
      place: get(cells, header.place),
      state: get(cells, header.state),
      country: get(cells, header.country),
      posted: get(cells, header.posted),
      storyPhoto: get(cells, header.storyPhoto),
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
  /** Empty when this category has no story art, i.e. no story was rendered. */
  storyArtUrl: string;
  sourceRow: number;
  caption: string;
}

export function buildMeta(
  category: string,
  row: PostRow,
  templateNumber: number,
  artUrl: string,
  caption: string,
  storyArtUrl = "",
): PostMeta {
  return {
    category,
    place: row.place,
    state: row.state,
    country: row.country,
    templateNumber,
    artUrl,
    storyArtUrl,
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
  /** The 9:16 story, when this category AND this row both supply story art. */
  story?: Buffer;
  /** The same story padded to 1080x2340 — the only shape Instagram's WEB story
   *  composer publishes without cropping. See padStoryForWeb. */
  storyWeb?: Buffer;
}

/** The Instagram story canvas. The post is 1080x1350; a story is 9:16. */
const STORY_DIMENSIONS = { width: 1080, height: 1920 } as const;

/**
 * Vertical nudge for the story's place name + region line, in px against the
 * proportional default (`H * 0.05` = 96 at 1920). POSITIVE moves the block DOWN,
 * negative moves it UP. This is the one number to tune when the story art's name
 * slot moves; story-only, so the post's placement is never affected.
 */
const STORY_NAME_OFFSET_PX = -10;
const STORY_LAYOUT = {
  bottomPad: Math.round(STORY_DIMENSIONS.height * 0.05) - STORY_NAME_OFFSET_PX,
} as const;

/**
 * Space above the story art on the 1080x2340 web canvas; the remainder becomes
 * the bottom band. 210 is dead centre for 1920-tall art.
 *
 * Instagram draws its own chrome (progress bar, avatar, "Your story · 3m", menu,
 * close) over the TOP of a story, and it will sit on the yoTrippin! header unless
 * something clears it `[measured on a real phone 2026-09-17]`. That clearance now
 * lives in the ARTWORK — the story overlays carry their own top band — so this
 * stays centred and adds none of its own. Raise it only if a category's art does
 * not carry that space.
 */
const STORY_WEB_TOP_PAD_PX = 210;

function reviewHtml(built: Built[]): string {
  const cards = built
    .map(
      (b, i) => `<section>
  <img src="data:image/png;base64,${b.image.toString("base64")}" alt="${escapeHtml(b.row.place)}">
  ${b.story ? `<img class="story" src="data:image/png;base64,${b.story.toString("base64")}" alt="${escapeHtml(b.row.place)} story">` : ""}
  <div class="meta">
    <h2>${escapeHtml(b.row.place)}</h2>
    <p class="sub">Template ${b.templateNumber}${b.story ? " · post + story" : ""}</p>
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
  img.story { width: 260px; }
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

  // Read through the Sheets API, not the gviz CSV endpoint. This is what makes
  // labels readable, keeps blank rows in place so a row's index IS its row
  // number, and reads through no cache. The old BOGUS_TAB probe is gone with it:
  // gviz answered a MISSING tab with the first tab's data and HTTP 200, so the
  // only way to spot it was to fetch an impossible tab and compare grids. The
  // API simply errors, so a mistyped --category can no longer build another
  // category's posts.
  const read = defaultReadDeps();
  const cat = parseCategoryTab(await fetchTabGrid(sheet, category, read), category);
  const postsTab = `${category} posts`;
  const queue = parsePostsTab(await fetchTabGrid(sheet, postsTab, read), postsTab);

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
    problems.push(`tab "${category}": post_art_url could not be read — ${errText(e)}`);
    return null;
  });
  if (problems.length > 0) {
    console.log(`✗ nothing built — ${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  // The STORY is strictly additive and must never be able to block the post.
  // Every story failure is a WARNING, not a `problem`: a missing story.png
  // publishes nothing, whereas a failed batch means today's post does not exist
  // at all. The post is the thing that must not break.
  const warnings: string[] = [];
  const storyOverlay = cat.storyArtUrl
    ? await loadPhoto(cat.storyArtUrl).catch((e) => {
        warnings.push(`tab "${category}": story_art_url could not be read — ${errText(e)}`);
        return null;
      })
    : null;

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
    const overlayText = { title: row.place, subline: regionLine(row.state || null, row.country) };
    const image = await compositePost({
      baseImage: photos.get(row.rowNumber)!,
      overlayImage: overlay!,
      overlayText,
      dimensions: { width: 1080, height: 1350 },
    });
    // Needs BOTH halves: the category's 9:16 art and this row's 9:16 photo.
    // Either one absent simply means no story for this post.
    let story: Buffer | undefined;
    if (storyOverlay && row.storyPhoto) {
      try {
        story = await compositePost({
          baseImage: await loadPhoto(row.storyPhoto),
          overlayImage: storyOverlay,
          overlayText,
          dimensions: STORY_DIMENSIONS,
          layout: STORY_LAYOUT,
        });
      } catch (e) {
        warnings.push(`${postsTab} row ${row.rowNumber}: story not rendered — ${errText(e)}`);
      }
    }
    // The web-publishable variant, in its OWN try: a padding failure must not
    // also cost the 9:16 story.png, which is still postable from a phone.
    let storyWeb: Buffer | undefined;
    if (story) {
      try {
        storyWeb = await padStoryForWeb(story, { topPad: STORY_WEB_TOP_PAD_PX });
      } catch (e) {
        warnings.push(`${postsTab} row ${row.rowNumber}: story-web not rendered — ${errText(e)}`);
      }
    }
    built.push({ row, slug: slugify(row.place), templateNumber, caption, image, story, storyWeb });
  }

  // ONLY NOW touch the disk — every composite has already succeeded, so an I/O
  // failure here cannot leave a half-written batch behind.
  for (const b of built) {
    const dir = join(out, b.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "image.png"), b.image);
    await writeFile(join(dir, "caption.txt"), b.caption + "\n");
    if (b.story) await writeFile(join(dir, "story.png"), b.story);
    // The file to upload when publishing through a BROWSER; story.png is the one
    // to use from a phone.
    if (b.storyWeb) await writeFile(join(dir, "story-web.png"), b.storyWeb);
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify(
        buildMeta(category, b.row, b.templateNumber, cat.artUrl, b.caption, cat.storyArtUrl),
        null,
        2,
      ) + "\n",
    );
    // The dir is printed in full (it is absolute — `out` is resolved above)
    // because it is what the operator stages from: earlier runs leave their own
    // dirs on disk, so "find the folder" by globbing can land on a stale post.
    // Whether a story was rendered is called out: silence would read as "there
    // is one" and the operator would go looking for a file that is not there.
    const storyNote = b.story ? " + story" : " (no story)";
    console.log(`✓ ${b.row.place} → ${category} template ${b.templateNumber}${storyNote} → ${dir}`);
  }

  await mkdir(out, { recursive: true });
  await writeFile(join(out, "review.html"), reviewHtml(built));
  console.log(`\n${built.length} built → ${join(out, "review.html")}`);
  // Printed AFTER the ✓ lines so they are the last thing on screen. The post
  // still succeeded; these say only that its story did not.
  for (const w of warnings) console.log(`⚠ ${w}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
