# Category-Driven Pin of the Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `potw:sheet` build posts for one named category at a time, taking that category's overlay art and caption set from its own pair of Google Sheet tabs.

**Architecture:** A category is a pair of tabs — `<category>` (its `art_url` + numbered caption templates) and `<category> posts` (its queue). The build fetches both **by tab name** through Google's `gviz` CSV endpoint, validates everything before rendering anything, then composites each queued row using that category's overlay. `caption.ts` and the database flow are not touched.

**Tech Stack:** TypeScript (Node 20, ESM, `.ts` import specifiers), vitest, `@napi-rs/canvas`.

**Spec:** `docs/superpowers/specs/2026-09-15-category-driven-pin-of-the-day-design.md`

## Global Constraints

- **Sheet-only.** Do NOT modify `caption.ts`, `generate.ts`, `select.ts`, or `posts.ts`. The database flow keeps its own templates and its wrong-chip bug.
- **Every fetch uses `headers=0`.** Without it gviz invents a header row and fuses separate cells into one field (measured: `art_url` and `template` merged into `"art_url n"`).
- **A missing tab does not error.** `?sheet=nosuchtab` returns HTTP 200 with the *first tab's* data (measured, reproduced twice). Every tab read must be guarded.
- **Tab names are trimmed before use.** A real tab in the live sheet is named `"campground "` with a trailing space; untrimmed matching silently returns the wrong tab.
- **Validate all rows before rendering any.** One failure → zero output and a row-referenced error list. Never a partial batch, never a silent fallback to another category's art.
- **Caption text is transported verbatim.** Nothing in this pipeline rewrites, trims or re-wraps a caption after interpolation.
- Gate for every task: `npm run -w data typecheck` (exit 0) and `cd data && npx vitest run` (all pass).

---

### Task 1: Address a tab by name

**Files:**
- Modify: `data/pin-of-the-week/from-sheet.ts`
- Test: `data/pin-of-the-week/from-sheet.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `tabCsvUrl(sheetUrl: string, tab: string): string`

- [ ] **Step 1: Write the failing test**

```ts
describe("tabCsvUrl", () => {
  const SHEET = "https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0";

  it("builds a gviz CSV url for a named tab with headers disabled", () => {
    expect(tabCsvUrl(SHEET, "scenic")).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/gviz/tq?tqx=out:csv&headers=0&sheet=scenic",
    );
  });

  it("url-encodes tab names containing spaces", () => {
    expect(tabCsvUrl(SHEET, "scenic posts")).toContain("sheet=scenic%20posts");
  });

  it("trims the tab name before encoding", () => {
    expect(tabCsvUrl(SHEET, "campground ")).toContain("sheet=campground");
    expect(tabCsvUrl(SHEET, "campground ")).not.toContain("%20");
  });

  it("throws on a url with no spreadsheet id", () => {
    expect(() => tabCsvUrl("https://example.com/nope", "scenic")).toThrow(/spreadsheet id/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: FAIL — `tabCsvUrl is not exported` / not defined.

- [ ] **Step 3: Implement**

Add to `from-sheet.ts`, directly below the existing `csvExportUrl`:

```ts
/** "https://docs.google.com/spreadsheets/d/<id>/edit..." + a tab name → that
 *  tab's CSV url. `headers=0` is REQUIRED: without it gviz guesses a header row
 *  and fuses separate cells into one field. */
export function tabCsvUrl(sheetUrl: string, tab: string): string {
  const m = sheetUrl.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`no spreadsheet id in url: ${sheetUrl}`);
  const name = encodeURIComponent(tab.trim());
  return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&headers=0&sheet=${name}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/pin-of-the-week/from-sheet.ts data/pin-of-the-week/from-sheet.test.ts
git commit -m "feat(data): address sheet tabs by name via gviz"
```

---

### Task 2: Guard against the silent-fallback trap

**Files:**
- Modify: `data/pin-of-the-week/from-sheet.ts`
- Test: `data/pin-of-the-week/from-sheet.test.ts`

**Interfaces:**
- Consumes: `tabCsvUrl` (Task 1), existing `parseCsv`.
- Produces: `sameGrid(a: string[][], b: string[][]): boolean`, `BOGUS_TAB: string`, `fetchTabRows(sheetUrl: string, tab: string, fallback: string[][] | null): Promise<string[][]>`

**Why:** a tab name that does not exist returns HTTP 200 carrying the *first tab's* rows. Measured twice against the live sheet. Without this guard a renamed or mistyped tab yields plausible wrong output instead of an error.

- [ ] **Step 1: Write the failing test**

```ts
describe("sameGrid", () => {
  it("is true for identical grids", () => {
    expect(sameGrid([["a", "b"], ["1"]], [["a", "b"], ["1"]])).toBe(true);
  });
  it("is false when a cell differs", () => {
    expect(sameGrid([["a"]], [["b"]])).toBe(false);
  });
  it("is false when the shape differs", () => {
    expect(sameGrid([["a"]], [["a"], ["b"]])).toBe(false);
  });
});

describe("fetchTabRows", () => {
  const SHEET = "https://docs.google.com/spreadsheets/d/ABC123/edit";
  const FIRST_TAB = [["photo_url", "place"], ["p.jpg", "Somewhere"]];

  it("returns the tab's rows when they differ from the fallback", async () => {
    const stub = vi.fn(async () => new Response("art_url,x\n"));
    vi.stubGlobal("fetch", stub);
    await expect(fetchTabRows(SHEET, "scenic", FIRST_TAB)).resolves.toEqual([["art_url", "x"]]);
    vi.unstubAllGlobals();
  });

  it("throws when the payload is identical to the bogus-tab fallback", async () => {
    const body = FIRST_TAB.map((r) => r.join(",")).join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(fetchTabRows(SHEET, "scenic", FIRST_TAB)).rejects.toThrow(/no tab named "scenic"/);
    vi.unstubAllGlobals();
  });

  it("throws on a non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    await expect(fetchTabRows(SHEET, "scenic", null)).rejects.toThrow(/HTTP 401/);
    vi.unstubAllGlobals();
  });
});
```

Add `vi` to the vitest import at the top of the test file: `import { describe, it, expect, vi } from "vitest";`

- [ ] **Step 2: Run it and watch it fail**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: FAIL — `sameGrid`/`fetchTabRows` not defined.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/pin-of-the-week/from-sheet.ts data/pin-of-the-week/from-sheet.test.ts
git commit -m "feat(data): reject tabs that silently fall back to the first tab"
```

---

### Task 3: Parse a category tab

**Files:**
- Modify: `data/pin-of-the-week/from-sheet.ts`
- Test: `data/pin-of-the-week/from-sheet.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface CategoryTab { artUrl: string; templates: string[] }`, `parseCategoryTab(rows: string[][], tab: string): CategoryTab`

**Shape of the live tab** (verified against the real sheet):

```
row 1:  art_url | /Users/…/campground_overlay.png
row 2:  (blank)
row 3:  n       | template
row 4:  1       | Three hours out. … {place} … {category} · {state}. …
…
row 15: 12      | …
```

- [ ] **Step 1: Write the failing test**

```ts
describe("parseCategoryTab", () => {
  const good = [
    ["art_url", " /tmp/overlay.png "],
    ["", ""],
    ["n", "template"],
    ["1", "A {place} in {state}."],
    ["2", "B {place} — {category}."],
  ];

  it("reads art_url and trims it", () => {
    expect(parseCategoryTab(good, "scenic").artUrl).toBe("/tmp/overlay.png");
  });

  it("reads templates in n order", () => {
    expect(parseCategoryTab(good, "scenic").templates).toEqual([
      "A {place} in {state}.",
      "B {place} — {category}.",
    ]);
  });

  it("throws when art_url is empty", () => {
    const rows = [["art_url", "  "], ["", ""], ["n", "template"], ["1", "x {place}"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/art_url is empty/);
  });

  it("throws when there are no templates", () => {
    expect(() => parseCategoryTab([["art_url", "/tmp/o.png"]], "scenic")).toThrow(/no caption templates/);
  });

  it("throws when template numbers are not contiguous from 1", () => {
    const rows = [["art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "a {place}"], ["3", "c {place}"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/contiguous/);
  });

  it("throws on an unknown token", () => {
    const rows = [["art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "hello {nope}"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/\{nope\}/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: FAIL — `parseCategoryTab` not defined.

- [ ] **Step 3: Implement**

```ts
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
    for (const m of t.matchAll(/\{(\w+)\}/g)) {
      if (!ALLOWED_TOKENS.has(m[1])) {
        throw new Error(`tab "${tab}" template ${i + 1}: unknown token {${m[1]}} — only {place} {category} {state}`);
      }
    }
  }
  return { artUrl, templates };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/pin-of-the-week/from-sheet.ts data/pin-of-the-week/from-sheet.test.ts
git commit -m "feat(data): parse a category tab's art_url and caption templates"
```

---

### Task 4: Parse a posts tab, including `posted`

**Files:**
- Modify: `data/pin-of-the-week/from-sheet.ts`
- Test: `data/pin-of-the-week/from-sheet.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface PostRow { photo: string; place: string; state: string; country: string; posted: string; rowNumber: number }`, `parsePostsTab(rows: string[][], tab: string): PostRow[]`, `nextUnposted(rows: PostRow[]): PostRow | null`

**Note:** the posts tab has **no `category` column** — the tab name carries it.

- [ ] **Step 1: Write the failing test**

```ts
describe("parsePostsTab", () => {
  const rows = [
    ["photo_url", "place", "state", "country", "posted"],
    ["a.jpg", "Alpha", "CA", "USA", "2026-09-01"],
    ["b.jpg", "Beta", "OR", "USA", ""],
  ];

  it("maps columns by header name and records the sheet row number", () => {
    const out = parsePostsTab(rows, "scenic posts");
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      photo: "b.jpg", place: "Beta", state: "OR", country: "USA", posted: "", rowNumber: 3,
    });
  });

  it("throws when a required header is missing", () => {
    expect(() => parsePostsTab([["place", "state"]], "scenic posts")).toThrow(/photo_url/);
  });
});

describe("nextUnposted", () => {
  it("returns the first row whose posted cell is empty", () => {
    const rows = parsePostsTab([
      ["photo_url", "place", "state", "country", "posted"],
      ["a.jpg", "Alpha", "CA", "USA", "2026-09-01"],
      ["b.jpg", "Beta", "OR", "USA", ""],
      ["c.jpg", "Gamma", "WA", "USA", ""],
    ], "scenic posts");
    expect(nextUnposted(rows)?.place).toBe("Beta");
  });

  it("returns null when every row is posted", () => {
    const rows = parsePostsTab([
      ["photo_url", "place", "state", "country", "posted"],
      ["a.jpg", "Alpha", "CA", "USA", "2026-09-01"],
    ], "scenic posts");
    expect(nextUnposted(rows)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: FAIL — `parsePostsTab` not defined.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/pin-of-the-week/from-sheet.ts data/pin-of-the-week/from-sheet.test.ts
git commit -m "feat(data): parse posts tabs with a posted column"
```

---

### Task 5: Let the compositor take an overlay per call

**Files:**
- Modify: `data/pin-of-the-week/composite.ts:88-100` (`CompositeOptions`, `compositePost`) and `:181` (`drawFrame`)
- Test: `data/pin-of-the-week/composite.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CompositeOptions` gains `overlayImage?: Buffer`. When absent, behaviour is unchanged (loads `brand/header.png`), so `generate.ts` keeps working untouched.

- [ ] **Step 1: Write the failing test**

Append to `composite.test.ts`:

```ts
import { compositePost } from "./composite.ts";

describe("compositePost overlay source", () => {
  const base = { width: 1080, height: 1350 };
  const photo = /* a 1x1 png */ Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  it("accepts an explicit overlay buffer and still returns a png of the right size", async () => {
    const overlay = photo;
    const out = await compositePost({
      baseImage: photo,
      overlayImage: overlay,
      overlayText: { title: "X", subline: "Y" },
      dimensions: base,
    });
    expect(out.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("still works with no overlayImage (falls back to the bundled brand asset)", async () => {
    const out = await compositePost({
      baseImage: photo,
      overlayText: { title: "X", subline: "Y" },
      dimensions: base,
    });
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd data && npx vitest run pin-of-the-week/composite.test.ts`
Expected: FAIL — `overlayImage` is not a known property of `CompositeOptions` (typecheck), or the test errors.

- [ ] **Step 3: Implement**

In `composite.ts`, extend the options and thread the buffer through:

```ts
export interface CompositeOptions {
  baseImage: Buffer;
  /** This post's overlay. When omitted the bundled brand/header.png is used, so
   *  existing callers (generate.ts) are unaffected. */
  overlayImage?: Buffer;
  overlayText: ImagePromptSpec["overlayText"];
  dimensions: { width: number; height: number };
}
```

Change the call site inside `compositePost` from `await drawFrame(ctx, W, H);` to:

```ts
  await drawFrame(ctx, W, H, opts.overlayImage);
```

and widen `drawFrame`:

```ts
async function drawFrame(ctx: SKRSContext2D, W: number, H: number, overlay?: Buffer): Promise<void> {
  try {
    const frame = await loadImage(overlay ?? HEADER_PATH);
    ctx.drawImage(frame, 0, 0, W, H);
  } catch {
    // overlay absent or unreadable — leave the composite without the frame
  }
}
```

That is the whole change. No size or content-type probe: the overlay is trusted
to be a real 1080×1350 image. `drawFrame` already swallows an unreadable overlay
and renders the photo without a frame, which is the accepted failure mode.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd data && npx vitest run pin-of-the-week/composite.test.ts && npm run -w data typecheck`
Expected: PASS, typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add data/pin-of-the-week/composite.ts data/pin-of-the-week/composite.test.ts
git commit -m "feat(data): allow a per-call overlay image in compositePost"
```

---

### Task 6: Wire the category build

**Files:**
- Modify: `data/pin-of-the-week/from-sheet.ts` (`main`, `reviewHtml`, `Built`)
- Test: `data/pin-of-the-week/from-sheet.test.ts`

**Interfaces:**
- Consumes: `tabCsvUrl`, `fetchTabRows`, `BOGUS_TAB`, `parseCategoryTab`, `parsePostsTab`, `nextUnposted`, `CategoryTab`, `PostRow`, existing `loadPhoto`/`slugify`/`interpolate`/`categoryLabel`/`regionLine`/`compositePost`.
- Produces: `templateForCategoryRow(index: number, count: number): number`, `buildMeta(...)`.

**CLI contract:** `npm run -w data potw:sheet -- --sheet <url> --category <name> [--out <dir>] [--next-only]`

`--category` is required. The build fetches exactly two tabs — `<name>` and `<name> posts` — so no tab enumeration is needed (the CSV endpoint cannot list tabs).

- [ ] **Step 1: Write the failing test**

```ts
describe("templateForCategoryRow", () => {
  it("is row order, 1-based, wrapping at the category's template count", () => {
    expect(templateForCategoryRow(0, 12)).toBe(1);
    expect(templateForCategoryRow(11, 12)).toBe(12);
    expect(templateForCategoryRow(12, 12)).toBe(1);
  });

  it("wraps at four when a category only has four templates", () => {
    expect(templateForCategoryRow(4, 4)).toBe(1);
    expect(templateForCategoryRow(5, 4)).toBe(2);
  });

  it("throws when the category has no templates", () => {
    expect(() => templateForCategoryRow(0, 0)).toThrow(/no templates/);
  });
});

describe("buildMeta", () => {
  it("records the category, template number, art_url and source row", () => {
    const row: PostRow = {
      photo: "p.jpg", place: "Beta", state: "OR", country: "USA", posted: "", rowNumber: 3,
    };
    expect(buildMeta("scenic", row, 7, "/tmp/o.png", "Beta caption")).toEqual({
      category: "scenic",
      place: "Beta",
      state: "OR",
      country: "USA",
      templateNumber: 7,
      artUrl: "/tmp/o.png",
      sourceRow: 3,
      caption: "Beta caption",
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: FAIL — `templateForCategoryRow` / `buildMeta` not defined.

- [ ] **Step 3: Implement the helpers**

```ts
/** Rotation is per category, by row order within that category's queue. */
export function templateForCategoryRow(index: number, count: number): number {
  if (count <= 0) throw new Error("category has no templates");
  return (index % count) + 1;
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
```

- [ ] **Step 4: Run the helper tests**

Run: `cd data && npx vitest run pin-of-the-week/from-sheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `main()` to build one category**

Replace the body of `main()` with:

```ts
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

  const cat = parseCategoryTab(await fetchTabRows(sheet, category, fallback), category);
  const postsTab = `${category} posts`;
  const queue = parsePostsTab(await fetchTabRows(sheet, postsTab, fallback), postsTab);

  const pending = queue.filter((r) => r.posted === "");
  const chosen = nextOnly ? (nextUnposted(queue) ? [nextUnposted(queue)!] : []) : pending;
  if (chosen.length === 0) {
    console.log(`nothing to build — every row in "${postsTab}" is already posted`);
    return;
  }

  // VALIDATE EVERYTHING FIRST — one bad row means zero output.
  const problems: string[] = [];
  for (const r of chosen) {
    if (!r.place || !r.photo) problems.push(`${postsTab} row ${r.rowNumber}: place and photo_url are required`);
  }
  const overlay = await loadPhoto(cat.artUrl).catch((e) => {
    problems.push(`tab "${category}": art_url could not be read — ${e instanceof Error ? e.message : String(e)}`);
    return null;
  });
  if (problems.length > 0) {
    console.log(`✗ nothing built — ${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  const built: Built[] = [];
  for (const [i, row] of chosen.entries()) {
    const templateNumber = templateForCategoryRow(i, cat.templates.length);
    const caption = interpolate(cat.templates[templateNumber - 1], {
      place: row.place,
      category: categoryLabel(category.toLowerCase()),
      state: row.state,
    });
    const image = await compositePost({
      baseImage: await loadPhoto(row.photo),
      overlayImage: overlay!,
      overlayText: { title: row.place, subline: regionLine(row.state || null, row.country) },
      dimensions: { width: 1080, height: 1350 },
    });
    const slug = slugify(row.place);
    const dir = join(out, slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "image.png"), image);
    await writeFile(join(dir, "caption.txt"), caption + "\n");
    await writeFile(
      join(dir, "meta.json"),
      JSON.stringify(buildMeta(category, row, templateNumber, cat.artUrl, caption), null, 2) + "\n",
    );
    built.push({ row, slug, templateNumber, caption, image });
    console.log(`✓ ${row.place} → ${category} template ${templateNumber}`);
  }

  await mkdir(out, { recursive: true });
  await writeFile(join(out, "review.html"), reviewHtml(built));
  console.log(`\n${built.length} built → ${join(out, "review.html")}`);
}
```

`Built`'s `row` field type changes from `SheetRow` to `PostRow`; update the interface and `reviewHtml`'s use of `b.row.place` accordingly (the field name is unchanged, so only the type annotation moves).

- [ ] **Step 6: Run the full data suite and the typecheck**

Run: `npm run -w data typecheck && cd data && npx vitest run`
Expected: typecheck exit 0; all test files pass.

- [ ] **Step 7: Commit**

```bash
git add data/pin-of-the-week/from-sheet.ts data/pin-of-the-week/from-sheet.test.ts
git commit -m "feat(data): build one category per run from its own tab pair"
```

---

### Task 7: Update the skill to the category flow

**Files:**
- Modify: `.claude/skills/pin-of-the-day/SKILL.md`

**Interfaces:**
- Consumes: the CLI contract from Task 6.
- Produces: nothing code-facing.

- [ ] **Step 1: Update the Sheet section**

Document the new invocation and the queue semantics. Add, in the flow section:

```
### Building from the Google Sheet

npm run -w data potw:sheet -- --sheet <url> --category <name> --next-only

`--category` names a PAIR of tabs: `<name>` (its art_url + caption templates)
and `<name> posts` (its queue). The tab name IS the category — there is no
category column and no registry.

- `--next-only` builds just the next row whose `posted` cell is empty. Row order
  is the queue.
- Adding a category is three spreadsheet actions and no code: duplicate both
  tabs, set the new `art_url` and captions, add rows.
- If the build reports `no tab named "<x>"`, the tab name has a typo or a
  trailing space. Google returns the FIRST tab for a missing name with HTTP 200,
  so this check is the only thing standing between a typo and silently wrong
  output.
```

- [ ] **Step 2: Record the publish step's write-back**

In step 9c, after the Share click, add:

```
- **Yes** → click Share/Post, confirm it published, report the result, then
  write today's date into that row's `posted` cell in the sheet. If the browser
  cannot write, say which row to tick rather than leaving the queue wrong.
```

- [ ] **Step 3: Verify the skill still describes reality**

Read the whole file once. Confirm every command it names exists in `data/package.json` and that the publish gate in §Non-negotiables is unchanged.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/pin-of-the-day/SKILL.md
git commit -m "docs(skill): category-driven sheet builds + posted write-back"
```

---

## Out of scope (from the spec, restated so nobody adds it)

- The database flow. `potw:generate` keeps the single baked overlay and its wrong-chip bug.
- Producing artwork. Each category needs its own 1080×1350 overlay with the chip baked in.
- Recurrence protection across flows. The Sheet flow does not stamp `featured_at`.
- Multi-category runs. One `--category` per invocation; the CSV endpoint cannot enumerate tabs.
