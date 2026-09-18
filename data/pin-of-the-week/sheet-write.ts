/**
 * Pin of the Day — write the `posted` cell back to the Google Sheet.
 *
 * The pipeline could only ever READ the sheet (a gviz CSV url, no credentials).
 * Every tick until now was a human in a browser, or a throwaway script driving
 * one. Neither survives a scheduled run: Chrome may be closed, and — the part
 * that matters — **if the tick fails, the next run rebuilds and republishes the
 * same row.** Three runs a day turns that into a loop on a live account. So an
 * unattended post needs a real write, and that is this module.
 *
 * Auth is a service account (`potd-sheet-writer@…`), key file outside the repo.
 * A JWT is signed locally and exchanged for an access token; nothing is cached
 * between runs, because a run is once every few hours and a token lasts an hour.
 *
 * ⚠️ **A successful READ proves nothing here.** The sheet is publicly readable —
 * gviz fetches it with no credentials at all — so a read check would pass with
 * the sharing step skipped entirely `[measured 2026-09-17: read ok, write 403]`.
 * Only a write distinguishes viewer from editor. Hence `verifyWrite`, which
 * reads the cell back after writing rather than trusting HTTP 200.
 */

import { readFileSync } from "node:fs";
import { columnLetter, fetchTabGrid, findPostsHeader } from "./sheet-read.ts";
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** Where the service-account key lives. Outside the repo, so it cannot be committed. */
export const DEFAULT_KEY_PATH = `${process.env.HOME ?? ""}/.config/overlander/sheets-service-account.json`;

/**
 * ~~The `posted` column is E: the posts-tab contract is a fixed six columns read
 * BY POSITION, so it cannot drift without the build breaking first.~~
 * **WRONG AS OF 2026-09-17, and dangerous** — a posts tab may now name its
 * columns in any order, so `posted` is wherever its header says it is. Writing to
 * a hardcoded E would have put the date in a blank spacer column: the row would
 * still read unposted, and every later run would try to republish it. The column
 * is located from the header instead — see `markPosted`.
 */

export type FetchLike = typeof fetch;

export interface SheetWriteDeps {
  fetch: FetchLike;
  /** An OAuth access token for the Sheets scope. */
  token: () => Promise<string>;
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Pull the spreadsheet id out of any /spreadsheets/d/<id>/… url. */
export function sheetIdFrom(url: string): string {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error(`not a Google Sheets url: ${url}`);
  return m[1];
}

/**
 * The A1 range for one row's `posted` cell.
 *
 * Quoted because every posts tab name contains a space (`scenic posts`), and an
 * unquoted range with a space is rejected by the API rather than misread — but
 * the error names the range, not the cause, so it reads as a bad row number.
 */
export function postedRange(tab: string, rowNumber: number, column: string): string {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    // Row 1 can never be a data row on any layout — the header is at least there.
    throw new Error(`row ${rowNumber} is not a data row (data starts below the header)`);
  }
  return `'${tab}'!${column}${rowNumber}`;
}

/** Build the signed JWT assertion a service account exchanges for a token. */
export function buildAssertion(key: ServiceAccountKey, nowSeconds: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = [
    b64({ alg: "RS256", typ: "JWT" }),
    b64({
      iss: key.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  ].join(".");
  const sig = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  return `${unsigned}.${sig}`;
}

/** Read the key file and exchange a JWT for an access token. */
export function serviceAccountToken(
  keyPath: string = DEFAULT_KEY_PATH,
  fetchImpl: FetchLike = fetch,
): () => Promise<string> {
  return async () => {
    let key: ServiceAccountKey;
    try {
      key = JSON.parse(readFileSync(keyPath, "utf8")) as ServiceAccountKey;
    } catch (e) {
      throw new Error(`service-account key not readable at ${keyPath} — ${errText(e)}`);
    }
    if (!key.client_email || !key.private_key) {
      throw new Error(`${keyPath} is not a service-account key (no client_email / private_key)`);
    }
    const assertion = buildAssertion(key, Math.floor(Date.now() / 1000));
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const body = (await res.json()) as { access_token?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      throw new Error(`token exchange failed: HTTP ${res.status} — ${body.error_description ?? "no detail"}`);
    }
    return body.access_token;
  };
}

async function readCell(deps: SheetWriteDeps, sheetId: string, range: string): Promise<string> {
  const res = await deps.fetch(`${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${await deps.token()}` },
  });
  const body = (await res.json()) as { values?: string[][]; error?: { message?: string } };
  if (!res.ok) throw new Error(`sheet read failed: HTTP ${res.status} — ${body.error?.message ?? "no message"}`);
  return body.values?.[0]?.[0] ?? "";
}

/**
 * Write today's date into a row's `posted` cell, and prove it landed.
 *
 * Two guards, both learned the hard way:
 *   - **Refuses a cell that is already filled.** A non-empty `posted` means that
 *     row has been published before, so writing over it would hide a
 *     double-post instead of surfacing it.
 *   - **Reads the cell back.** HTTP 200 is not proof — and a gviz read of the
 *     same cell can return a STALE value for seconds afterwards, so the check
 *     deliberately uses the Sheets API, not gviz.
 */
export async function markPosted(
  opts: { sheetUrl: string; tab: string; rowNumber: number; date: string },
  deps: SheetWriteDeps,
): Promise<void> {
  const sheetId = sheetIdFrom(opts.sheetUrl);

  // WHERE `posted` is has to be discovered, not assumed. Reading the tab first
  // costs one call and removes the failure this function used to be able to
  // cause: a hardcoded column E writing into a blank spacer, leaving the row
  // readable as unposted and queued to republish forever.
  const grid = await fetchTabGrid(opts.sheetUrl, opts.tab, deps);
  const header = findPostsHeader(grid, opts.tab);
  if (opts.rowNumber <= header.row + 1) {
    throw new Error(
      `${opts.tab} row ${opts.rowNumber} is not below the header (row ${header.row + 1}) — refusing to write`,
    );
  }
  const range = postedRange(opts.tab, opts.rowNumber, columnLetter(header.posted));

  const existing = await readCell(deps, sheetId, range);
  if (existing.trim() !== "") {
    throw new Error(
      `${opts.tab} row ${opts.rowNumber} is already marked posted ("${existing}") — refusing to overwrite`,
    );
  }

  const res = await deps.fetch(
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${await deps.token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ values: [[opts.date]] }),
    },
  );
  const body = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) {
    const msg = body.error?.message ?? "no message";
    const hint = res.status === 403 ? " — is the sheet shared with the service account as an Editor?" : "";
    throw new Error(`sheet write failed: HTTP ${res.status} — ${msg}${hint}`);
  }

  const wrote = await readCell(deps, sheetId, range);
  if (wrote.trim() !== opts.date) {
    throw new Error(`write not confirmed: ${range} reads "${wrote}", expected "${opts.date}"`);
  }
}

/** The local date, which is what a human reading the sheet expects to see. */
export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
