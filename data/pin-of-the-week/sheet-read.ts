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
export async function fetchTabGrid(
  sheetUrl: string,
  tab: string,
  deps: SheetReadDeps,
): Promise<string[][]> {
  const sheetId = sheetIdFrom(sheetUrl);
  // Quoted: every posts tab name contains a space, and an unquoted range with a
  // space is rejected rather than misread.
  const range = `'${tab.trim()}'`;
  const res = await deps.fetch(`${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${await deps.token()}` },
  });
  const body = (await res.json()) as { values?: string[][]; error?: { message?: string } };
  if (!res.ok) {
    const msg = body.error?.message ?? "no message";
    // The API says "Unable to parse range" for a tab that does not exist. Name
    // the likely causes, since the message itself points at the range syntax.
    const hint = /unable to parse range/i.test(msg)
      ? ` — there is probably no tab named "${tab}". Check for a typo or a stray leading/trailing space in the TAB's own name (the name passed here is trimmed, so it can never match a tab whose name carries the space).`
      : res.status === 403
        ? " — is the sheet shared with the service account as an Editor?"
        : "";
    throw new Error(`sheet read failed for tab "${tab}": HTTP ${res.status} — ${msg}${hint}`);
  }
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
