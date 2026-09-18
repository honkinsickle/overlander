/**
 * Pin of the Day — read a sheet tab through the Sheets API.
 *
 * Replaces the gviz CSV endpoint, which was free of credentials and wrong in
 * three ways that all bit `[measured 2026-09-17]`:
 *
 *   - **It blanks text in a column it has typed.** gviz types a column ONCE for
 *     the whole column, so `art_url` in A1 of a category tab — sitting above the
 *     template numbers 1..12 — comes back as an empty cell. Labels could not be
 *     trusted, which is why the old parser fell back to "column B of the first
 *     row" and would silently have used STORY art on a feed post if the two rows
 *     were ever swapped.
 *   - **It drops blank rows.** The campground tab's empty row 2 never arrived,
 *     so gviz's second row was the sheet's third. `parsePostsTab` numbers rows
 *     before dropping blanks specifically so a spacer cannot shift the rows
 *     below it — but the row was already gone upstream, so a spacer in a posts
 *     tab would have shifted every row under it and ticked the WRONG cell.
 *   - **It serves stale reads.** Minutes after a confirmed write, gviz still
 *     returned the old value. That made the build re-select a row it had just
 *     published; only the local published-log stopped a duplicate going out.
 *
 * The API returns real cell text, keeps interior blank rows as empty arrays, and
 * reads through no cache. It also fails loudly on an unknown tab, which retires
 * the BOGUS_TAB probe: gviz answered a missing tab with the FIRST tab's data and
 * HTTP 200, so the only way to detect it was to fetch a deliberately impossible
 * tab and compare grids.
 *
 * The cost is that building a post now needs the service-account key. That is a
 * real loss — `potw:sheet` used to need no credentials at all — and it is taken
 * deliberately rather than falling back to gviz when the key is missing, because
 * a silent fallback would quietly restore all three bugs above.
 */

import { serviceAccountToken, sheetIdFrom, type FetchLike } from "./sheet-write.ts";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export interface SheetReadDeps {
  fetch: FetchLike;
  token: () => Promise<string>;
}

/** The real reader: service-account key from disk, real network. */
export function defaultReadDeps(keyPath?: string): SheetReadDeps {
  return { fetch, token: serviceAccountToken(keyPath) };
}

/**
 * Fetch a whole tab as a grid of trimmed strings.
 *
 * A range of just the quoted tab name returns its entire used grid. Rows are
 * returned in SHEET ORDER with interior blanks present as empty arrays, so a
 * row's index is its true row number minus one. Trailing empty cells and
 * trailing empty rows are omitted by the API; callers already index defensively.
 */
interface ValuesResponse {
  values?: string[][];
  error?: { message?: string };
}

export interface RetryOptions {
  /** Total attempts, including the first. Default 3. */
  attempts?: number;
  /** Delay between attempts, in ms. Default 500. */
  delayMs?: number;
}

/**
 * A Sheets GET that survives a blip and explains one that it cannot.
 *
 * Two failures this exists for, both seen `[2026-09-17]`:
 *   - **Google answered with an HTML error page.** `res.json()` then threw
 *     `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` — which names
 *     neither the tab, nor the status, nor the fact that it was transient. In an
 *     unattended 3pm run that line would be the only trace. The body is read as
 *     TEXT first, so a non-JSON response reports its status and a snippet.
 *   - **It was transient.** The same tab read cleanly on the next attempt. One
 *     retry is the difference between a missed post and a slow one.
 *
 * WHAT IS NOT RETRIED: 400 and 403. A missing tab and an unshared sheet are
 * facts about the world, not weather — retrying them only delays the message and
 * makes the log harder to read. 429 and 5xx and a non-JSON body are retried.
 */
async function sheetsGet(
  url: string,
  deps: SheetReadDeps,
  tab: string,
  retry?: RetryOptions,
): Promise<ValuesResponse> {
  const attempts = retry?.attempts ?? 3;
  const delayMs = retry?.delayMs ?? 500;
  let last = "";
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await deps.fetch(url, {
        headers: { Authorization: `Bearer ${await deps.token()}` },
      });
      const text = await res.text();
      let body: ValuesResponse | null = null;
      try {
        body = JSON.parse(text) as ValuesResponse;
      } catch {
        // Not JSON at all — an HTML error or proxy page. Keep a snippet: the
        // first line is usually the only useful part.
        last = `HTTP ${res.status} returned non-JSON (${text.replace(/\s+/g, " ").slice(0, 80)}…)`;
      }
      if (body) {
        if (res.ok) return body;
        const msg = body.error?.message ?? "no message";
        // Permanent: say so once and stop.
        if (res.status === 400 || res.status === 403) {
          const hint = /unable to parse range/i.test(msg)
            ? ` — there is probably no tab named "${tab}". Check for a typo or a stray leading/trailing space in the TAB's own name (the name passed here is trimmed, so it can never match a tab whose name carries the space).`
            : res.status === 403
              ? " — is the sheet shared with the service account as an Editor?"
              : "";
          throw new Error(`sheet read failed for tab "${tab}": HTTP ${res.status} — ${msg}${hint}`);
        }
        last = `HTTP ${res.status} — ${msg}`;
      }
    } catch (e) {
      // A thrown Error from the permanent branch above must not be retried.
      if (e instanceof Error && e.message.startsWith("sheet read failed for ")) throw e;
      last = e instanceof Error ? e.message : String(e);
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`sheet read failed for tab "${tab}" after ${attempts} attempt(s): ${last}`);
}

export async function fetchTabGrid(
  sheetUrl: string,
  tab: string,
  deps: SheetReadDeps,
  retry?: RetryOptions,
): Promise<string[][]> {
  const sheetId = sheetIdFrom(sheetUrl);
  // Quoted: every posts tab name contains a space, and an unquoted range with a
  // space is rejected rather than misread.
  const range = `'${tab.trim()}'`;
  const body = await sheetsGet(
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}`,
    deps,
    tab,
    retry,
  );
  return (body.values ?? []).map((row) => row.map((cell) => (cell ?? "").toString()));
}

/**
 * Find a label anywhere in the grid, case-insensitively, and return its
 * position. Searching the WHOLE grid rather than a fixed row is what lets one
 * rule serve both tab layouts: the original keeps `art_url` in A1 and
 * `story_art_url` in C1 of row 1; the newer one runs labels down column A under
 * section headings.
 */
export function findLabel(rows: string[][], label: string): { row: number; col: number } | null {
  const want = label.trim().toLowerCase();
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if ((row[c] ?? "").trim().toLowerCase() === want) return { row: r, col: c };
    }
  }
  return null;
}

/** The cell to the right of a label — the value it names. */
export function valueRightOf(rows: string[][], label: string): string | null {
  const at = findLabel(rows, label);
  if (!at) return null;
  return (rows[at.row]?.[at.col + 1] ?? "").trim();
}

/**
 * `post_photo_url` is the name; `photo_url` is the former one, still read for the
 * same reason `art_url` is — a live sheet and running code cannot be renamed in
 * the same instant.
 */
const PHOTO_LABELS = ["post_photo_url", "photo_url"] as const;

/** Where each column of a `<category> posts` tab actually is. */
export interface PostsHeader {
  /** 0-based index of the header row. Data begins on the row after it. */
  row: number;
  photo: number;
  place: number;
  state: number;
  country: number;
  posted: number;
  /** -1 when the tab has no story column, which is legal. */
  storyPhoto: number;
}

/**
 * Locate the header row of a posts tab and every column in it, BY NAME.
 *
 * ~~Columns resolve by fixed position, with a narrow repair when gviz blanked a
 * typed header.~~ **Replaced 2026-09-17.** That entire apparatus — the width
 * bound, the blank-header-cell evidence test, the fuzzy url match, the
 * refuse-to-guess rules — existed for ONE reason: gviz typed a column once for
 * the whole column, so writing a date into `posted` blanked the `posted` HEADER
 * and broke the next build of that category forever. Reading through the Sheets
 * API, headers are the text they are, and the repair has nothing left to repair.
 *
 * What that buys, beyond deleting the machinery: a posts tab may now carry a
 * title row, blank spacer rows and columns, its own column order, and extra
 * columns — because nothing is inferred from position any more.
 *
 * The header row is found as the first row holding BOTH a photo label and
 * `place`. One label alone is too weak — "place" could plausibly appear in a
 * title or a note.
 */
export function findPostsHeader(rows: string[][], tab: string): PostsHeader {
  const norm = (c: string | undefined) => (c ?? "").trim().toLowerCase();
  const headerRow = rows.findIndex((row) => {
    const names = (row ?? []).map(norm);
    return PHOTO_LABELS.some((p) => names.includes(p)) && names.includes("place");
  });
  if (headerRow === -1) {
    throw new Error(
      `tab "${tab}": no header row found — one row must contain both a photo column ` +
        `(post_photo_url) and place. Columns may be in any order, with spacers, but ` +
        `they have to be named.`,
    );
  }

  const names = (rows[headerRow] ?? []).map(norm);
  const at = (label: string) => names.indexOf(label);
  const photo = PHOTO_LABELS.map(at).find((i) => i !== -1) ?? -1;
  const header: PostsHeader = {
    row: headerRow,
    photo,
    place: at("place"),
    state: at("state"),
    country: at("country"),
    posted: at("posted"),
    // Optional: a category may legitimately publish posts with no stories.
    storyPhoto: at("story_photo_url"),
  };

  const missing: string[] = (["place", "state", "country", "posted"] as const).filter(
    (k) => header[k] === -1,
  );
  if (header.photo === -1) missing.unshift("post_photo_url");
  if (missing.length > 0) {
    throw new Error(
      `tab "${tab}": header row ${headerRow + 1} is missing column(s): ${missing.join(", ")} ` +
        `— found ${JSON.stringify(names.filter((n) => n !== ""))}`,
    );
  }
  return header;
}

/** Spreadsheet column letter for a 0-based index. Handles past Z (AA, AB, …). */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}
