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
