import { describe, it, expect } from "vitest";
import { fetchTabGrid, findLabel, valueRightOf, type SheetReadDeps } from "./sheet-read.ts";

const SHEET = "https://docs.google.com/spreadsheets/d/ABC123/edit";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function deps(res: Response, calls: string[] = []): SheetReadDeps {
  return {
    fetch: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return res;
    }) as typeof fetch,
    token: async () => "TOK",
  };
}

function scripted(responses: Array<Response | Error>, calls: string[] = []): SheetReadDeps {
  let i = 0;
  return {
    fetch: (async (url: string | URL | Request) => {
      calls.push(String(url));
      const next = responses[Math.min(i, responses.length - 1)];
      i++;
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
    token: async () => "TOK",
  };
}

const NO_WAIT = { attempts: 3, delayMs: 0 };

describe("fetchTabGrid transient failures", () => {
  it("names the tab and the status when Google returns an HTML error page", async () => {
    // The real failure: res.json() threw `Unexpected token '<', "<!DOCTYPE "...`,
    // which named neither the tab nor the status. In an unattended run that line
    // would have been the only trace.
    const html = () => new Response("<!DOCTYPE html><html><body>Error 502</body></html>", { status: 502 });
    const err = await fetchTabGrid(SHEET, "scenic posts", scripted([html(), html(), html()]), NO_WAIT).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toMatch(/tab "scenic posts"/);
    expect(err?.message).toMatch(/HTTP 502 returned non-JSON/);
    expect(err?.message).toMatch(/after 3 attempt\(s\)/);
  });

  it("recovers when the blip clears on a later attempt", async () => {
    const calls: string[] = [];
    const deps = scripted(
      [
        new Response("<!DOCTYPE html>", { status: 502 }),
        new Response(JSON.stringify({ values: [["post_photo_url", "place"]] })),
      ],
      calls,
    );
    expect(await fetchTabGrid(SHEET, "scenic posts", deps, NO_WAIT)).toEqual([["post_photo_url", "place"]]);
    expect(calls).toHaveLength(2);
  });

  it("retries a thrown network error too", async () => {
    const deps = scripted([
      new TypeError("fetch failed"),
      new Response(JSON.stringify({ values: [["a"]] })),
    ]);
    expect(await fetchTabGrid(SHEET, "x", deps, NO_WAIT)).toEqual([["a"]]);
  });

  it("does NOT retry a 403 — an unshared sheet is not weather", async () => {
    const calls: string[] = [];
    const deps = scripted(
      [new Response(JSON.stringify({ error: { message: "The caller does not have permission" } }), { status: 403 })],
      calls,
    );
    await expect(fetchTabGrid(SHEET, "scenic posts", deps, NO_WAIT)).rejects.toThrow(
      /shared with the service account/,
    );
    expect(calls).toHaveLength(1);
  });

  it("does NOT retry a 400 for a tab that does not exist", async () => {
    const calls: string[] = [];
    const deps = scripted(
      [new Response(JSON.stringify({ error: { message: "Unable to parse range: 'nope'" } }), { status: 400 })],
      calls,
    );
    await expect(fetchTabGrid(SHEET, "nope", deps, NO_WAIT)).rejects.toThrow(/no tab named "nope"/);
    expect(calls).toHaveLength(1);
  });

  it("retries a 429, which IS weather", async () => {
    const calls: string[] = [];
    const deps = scripted(
      [
        new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 }),
        new Response(JSON.stringify({ values: [["a"]] })),
      ],
      calls,
    );
    expect(await fetchTabGrid(SHEET, "x", deps, NO_WAIT)).toEqual([["a"]]);
    expect(calls).toHaveLength(2);
  });
});

describe("findLabel", () => {
  // The whole grid is searched, not a fixed row, because that is what lets one
  // rule read both real tab layouts.
  const grid = [
    [],
    ["TEST"],
    ["Graphics"],
    ["art_url", "/tmp/o.png"],
    ["story_art_url", "/tmp/s.png"],
    ["template", "n"],
  ];

  it("finds a label below row 1", () => {
    expect(findLabel(grid, "art_url")).toEqual({ row: 3, col: 0 });
  });

  it("finds a label that is not in column A", () => {
    expect(findLabel(grid, "n")).toEqual({ row: 5, col: 1 });
  });

  it("is case- and whitespace-insensitive", () => {
    expect(findLabel([["  ART_URL  ", "x"]], "art_url")).toEqual({ row: 0, col: 0 });
  });

  it("returns null rather than a guess when the label is absent", () => {
    expect(findLabel(grid, "nope")).toBeNull();
  });

  it("tolerates the empty arrays the API returns for blank rows", () => {
    expect(findLabel([[], [], ["n", "template"]], "n")).toEqual({ row: 2, col: 0 });
  });
});

describe("valueRightOf", () => {
  it("returns the trimmed cell to the right of the label", () => {
    expect(valueRightOf([["art_url", "  /tmp/o.png  "]], "art_url")).toBe("/tmp/o.png");
  });

  it("returns an empty string when the label is last in its row", () => {
    // Distinct from "no label at all": the label exists, its value is missing.
    // The caller treats those differently — a missing story label is legal, a
    // missing art label is an error.
    expect(valueRightOf([["story_art_url"]], "story_art_url")).toBe("");
  });

  it("returns null when the label does not exist", () => {
    expect(valueRightOf([["art_url", "/tmp/o.png"]], "story_art_url")).toBeNull();
  });
});

describe("fetchTabGrid", () => {
  it("quotes the tab name, because every posts tab name contains a space", async () => {
    const calls: string[] = [];
    await fetchTabGrid(SHEET, "scenic posts", deps(json({ values: [["a"]] }), calls));
    expect(decodeURIComponent(calls[0])).toContain("/values/'scenic posts'");
  });

  it("keeps interior blank rows as empty arrays, so an index is a row number", async () => {
    const grid = await fetchTabGrid(
      SHEET,
      "campground",
      deps(json({ values: [["art_url", "/tmp/o.png"], [], ["n", "template"]] })),
    );
    expect(grid).toEqual([["art_url", "/tmp/o.png"], [], ["n", "template"]]);
  });

  it("returns an empty grid for a tab with no data", async () => {
    expect(await fetchTabGrid(SHEET, "empty", deps(json({})))).toEqual([]);
  });

  it("explains an unparseable range as a missing tab, which is what it means", async () => {
    const res = json({ error: { message: "Unable to parse range: 'nope'" } }, 400);
    await expect(fetchTabGrid(SHEET, "nope", deps(res))).rejects.toThrow(/no tab named "nope"/);
  });

  it("names the stray-space case, which the trimmed name can never match", async () => {
    const res = json({ error: { message: "Unable to parse range: 'scenic'" } }, 400);
    await expect(fetchTabGrid(SHEET, "scenic", deps(res))).rejects.toThrow(/stray leading\/trailing space/);
  });

  it("explains a 403 as the sharing step", async () => {
    const res = json({ error: { message: "The caller does not have permission" } }, 403);
    await expect(fetchTabGrid(SHEET, "scenic", deps(res))).rejects.toThrow(/shared with the service account/);
  });

  it("refuses a url that is not a spreadsheet", async () => {
    await expect(fetchTabGrid("https://example.com/x", "scenic", deps(json({})))).rejects.toThrow(
      /not a Google Sheets url/,
    );
  });
});
