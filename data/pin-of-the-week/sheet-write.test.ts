import { describe, it, expect } from "vitest";
import {
  POSTED_COLUMN,
  markPosted,
  postedRange,
  sheetIdFrom,
  todayLocal,
  type FetchLike,
  type SheetWriteDeps,
} from "./sheet-write.ts";

const SHEET_URL = "https://docs.google.com/spreadsheets/d/10d_Ho3FupLTldBpNIfnjappcOqNyAoZU0YksPYIa89U/edit";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface Call {
  url: string;
  method: string;
  body: string | null;
}

/**
 * markPosted makes exactly three calls: read the cell, write it, read it back.
 * The fake is scripted in that order so a changed call sequence fails loudly
 * rather than matching on a substring and passing by accident.
 */
function fakeSheet(responses: Response[]): { deps: SheetWriteDeps; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    const res = responses[i++];
    if (!res) throw new Error(`unexpected extra fetch (#${i}) to ${String(url)}`);
    return res;
  }) as FetchLike;
  return { calls, deps: { fetch: fetchImpl, token: async () => "TOK" } };
}

describe("sheetIdFrom", () => {
  it("pulls the id out of an edit url", () => {
    expect(sheetIdFrom(SHEET_URL)).toBe("10d_Ho3FupLTldBpNIfnjappcOqNyAoZU0YksPYIa89U");
  });

  it("refuses something that is not a sheets url", () => {
    expect(() => sheetIdFrom("https://example.com/whatever")).toThrow(/not a Google Sheets url/);
  });
});

describe("postedRange", () => {
  it("quotes the tab name, because every posts tab has a space in it", () => {
    expect(postedRange("scenic posts", 3)).toBe(`'scenic posts'!${POSTED_COLUMN}3`);
  });

  it("refuses row 1 — that is the header, and writing there breaks the column contract", () => {
    expect(() => postedRange("scenic posts", 1)).toThrow(/not a data row/);
  });

  it("refuses a non-integer row", () => {
    expect(() => postedRange("scenic posts", 2.5)).toThrow(/not a data row/);
  });
});

describe("todayLocal", () => {
  it("zero-pads to match the dates already in the sheet", () => {
    expect(todayLocal(new Date(2026, 8, 7))).toBe("2026-09-07");
  });
});

describe("markPosted", () => {
  const opts = { sheetUrl: SHEET_URL, tab: "scenic posts", rowNumber: 3, date: "2026-09-17" };

  it("reads, writes, then reads back to prove the write landed", async () => {
    const { deps, calls } = fakeSheet([
      json({}), // cell currently empty
      json({}), // write accepted
      json({ values: [["2026-09-17"]] }), // read-back
    ]);
    await expect(markPosted(opts, deps)).resolves.toBeUndefined();
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT", "GET"]);
    expect(calls[1].body).toBe(JSON.stringify({ values: [["2026-09-17"]] }));
    expect(calls[1].url).toContain("valueInputOption=RAW");
  });

  it("refuses a row that is already marked, rather than hiding a double-post", async () => {
    const { deps, calls } = fakeSheet([json({ values: [["2026-09-15"]] })]);
    await expect(markPosted(opts, deps)).rejects.toThrow(/already marked posted \("2026-09-15"\)/);
    // Nothing was written — the refusal happens before the PUT.
    expect(calls).toHaveLength(1);
  });

  it("explains a 403 as the sharing step, which is the actual cause", async () => {
    const { deps } = fakeSheet([
      json({}),
      json({ error: { message: "The caller does not have permission" } }, 403),
    ]);
    await expect(markPosted(opts, deps)).rejects.toThrow(/shared with the service account as an Editor/);
  });

  it("fails when the read-back disagrees — HTTP 200 is not proof", async () => {
    const { deps } = fakeSheet([
      json({}),
      json({}),
      json({}), // still empty after a "successful" write
    ]);
    await expect(markPosted(opts, deps)).rejects.toThrow(/write not confirmed/);
  });
});
