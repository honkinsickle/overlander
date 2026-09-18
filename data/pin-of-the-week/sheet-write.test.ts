import { describe, it, expect } from "vitest";
import {
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
    expect(postedRange("scenic posts", 3, "E")).toBe("'scenic posts'!E3");
  });

  it("takes the column it is given — nothing is hardcoded any more", () => {
    // The layout change that made this necessary: `posted` moved to column H on a
    // reformatted tab, and a hardcoded E would have written into a blank spacer.
    expect(postedRange("oddities posts", 6, "H")).toBe("'oddities posts'!H6");
  });

  it("refuses row 1 — the header is at least there, so it is never a data row", () => {
    expect(() => postedRange("scenic posts", 1, "E")).toThrow(/not a data row/);
  });

  it("refuses a non-integer row", () => {
    expect(() => postedRange("scenic posts", 2.5, "E")).toThrow(/not a data row/);
  });
});

describe("todayLocal", () => {
  it("zero-pads to match the dates already in the sheet", () => {
    expect(todayLocal(new Date(2026, 8, 7))).toBe("2026-09-07");
  });
});

describe("markPosted", () => {
  const opts = { sheetUrl: SHEET_URL, tab: "scenic posts", rowNumber: 3, date: "2026-09-17" };

  // markPosted now reads the whole tab FIRST, to find out where `posted` is. So
  // every script starts with a grid, then the cell read, the write, the re-read.
  const ORIGINAL_LAYOUT = {
    values: [
      ["post_photo_url", "place", "state", "country", "posted", "story_photo_url"],
      ["a.jpg", "Alpha", "CA", "USA", "2026-09-01", ""],
      ["b.jpg", "Beta", "OR", "USA", "", ""],
    ],
  };

  // The reformatted `oddities posts` tab, as the API returns it: a title row, a
  // blank row, the header on row 3, reordered columns, two blank spacer columns,
  // and `posted` out at H.
  const REFORMATTED = {
    values: [
      [" Oddities Posts"],
      [],
      ["place", "state", "country", "post_photo_url", "", "story_photo_url", "", "posted"],
      ["Trees of Mystery", "Klamath, CA", "USA", "t.png", "", "t_story.png", "", "2026-09-17"],
      ["Gus's Fresh Jerky", "Hwy 395, CA", "USA", "g.png", "", "g_story.png", "", ""],
    ],
  };

  it("reads the tab, then the cell, then writes, then reads back", async () => {
    const { deps, calls } = fakeSheet([
      json(ORIGINAL_LAYOUT),
      json({}), // cell currently empty
      json({}), // write accepted
      json({ values: [["2026-09-17"]] }), // read-back
    ]);
    await expect(markPosted(opts, deps)).resolves.toBeUndefined();
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "PUT", "GET"]);
    expect(calls[2].body).toBe(JSON.stringify({ values: [["2026-09-17"]] }));
    expect(calls[2].url).toContain("valueInputOption=RAW");
    expect(decodeURIComponent(calls[2].url)).toContain("'scenic posts'!E3");
  });

  it("writes to the column the HEADER names, not a hardcoded E", async () => {
    // The failure this replaces: on the reformatted tab, column E is a blank
    // spacer. A hardcoded E would have written the date there, the row would
    // still read unposted, and every later run would try to republish it.
    const { deps, calls } = fakeSheet([
      json(REFORMATTED),
      json({}),
      json({}),
      json({ values: [["2026-09-17"]] }),
    ]);
    await markPosted({ ...opts, tab: "oddities posts", rowNumber: 5 }, deps);
    expect(decodeURIComponent(calls[2].url)).toContain("'oddities posts'!H5");
  });

  it("refuses a row at or above the header row", async () => {
    // Row 3 IS the header on the reformatted tab. Writing there would destroy it.
    const { deps } = fakeSheet([json(REFORMATTED)]);
    await expect(markPosted({ ...opts, tab: "oddities posts", rowNumber: 3 }, deps)).rejects.toThrow(
      /not below the header \(row 3\)/,
    );
  });

  it("refuses a row that is already marked, rather than hiding a double-post", async () => {
    const { deps, calls } = fakeSheet([json(ORIGINAL_LAYOUT), json({ values: [["2026-09-15"]] })]);
    await expect(markPosted(opts, deps)).rejects.toThrow(/already marked posted \("2026-09-15"\)/);
    // Nothing was written — the refusal happens before the PUT.
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
  });

  it("explains a 403 as the sharing step, which is the actual cause", async () => {
    const { deps } = fakeSheet([
      json(ORIGINAL_LAYOUT),
      json({}),
      json({ error: { message: "The caller does not have permission" } }, 403),
    ]);
    await expect(markPosted(opts, deps)).rejects.toThrow(/shared with the service account as an Editor/);
  });

  it("fails when the read-back disagrees — HTTP 200 is not proof", async () => {
    const { deps } = fakeSheet([
      json(ORIGINAL_LAYOUT),
      json({}),
      json({}),
      json({}), // still empty after a "successful" write
    ]);
    await expect(markPosted(opts, deps)).rejects.toThrow(/write not confirmed/);
  });
});
