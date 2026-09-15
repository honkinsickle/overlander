import { describe, it, expect, vi } from "vitest";
import { homedir } from "node:os";
import {
  cleanLocalPath,
  csvExportUrl,
  fetchTabRows,
  parseCsv,
  sameGrid,
  tabCsvUrl,
  templateForRow,
  toSheetRows,
} from "./from-sheet.ts";
import { regionLine } from "./image-prompt.ts";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });

  it("drops blank rows", () => {
    expect(parseCsv("a,b\n,\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("toSheetRows", () => {
  it("maps the real sheet's header, including the misspelled photo column", () => {
    const rows = toSheetRows(
      parseCsv(
        "pohoto_url,place,category,state,country\n" +
          "/Users/me/images/McArthur\\ Falls\\ State\\ Park.png ,McArthur Falls State Park,campground,CA,USA\n",
      ),
    );
    expect(rows).toEqual([
      {
        photo: "/Users/me/images/McArthur\\ Falls\\ State\\ Park.png",
        place: "McArthur Falls State Park",
        category: "campground",
        state: "CA",
        country: "USA",
      },
    ]);
  });

  it("names every missing column", () => {
    expect(() => toSheetRows([["photo_url", "place"]])).toThrow("category, state, country");
  });
});

describe("cleanLocalPath", () => {
  it("removes shell escapes and trailing space", () => {
    expect(cleanLocalPath("/Users/me/McArthur\\ Falls.png ")).toBe("/Users/me/McArthur Falls.png");
  });

  it("expands ~", () => {
    expect(cleanLocalPath("~/a.png")).toBe(`${homedir()}/a.png`);
  });
});

describe("csvExportUrl", () => {
  it("builds the export URL from an edit link", () => {
    expect(csvExportUrl("https://docs.google.com/spreadsheets/d/ABC123/edit?usp=sharing")).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv",
    );
  });

  it("keeps the tab gid", () => {
    expect(csvExportUrl("https://docs.google.com/spreadsheets/d/ABC123/edit#gid=42")).toBe(
      "https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=42",
    );
  });
});

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

describe("templateForRow", () => {
  it("cycles 1..12 in row order", () => {
    expect([0, 1, 11, 12, 13].map(templateForRow)).toEqual([1, 2, 12, 1, 2]);
  });
});

describe("regionLine with a country", () => {
  it("uses the sheet's country instead of assuming USA", () => {
    expect(regionLine("CA", "USA")).toBe("California, USA");
    expect(regionLine("British Columbia", "Canada")).toBe("British Columbia, Canada");
  });

  it("is unchanged when no country is passed", () => {
    expect(regionLine("UT")).toBe("Utah, USA");
    expect(regionLine("BC")).toBe("BC");
  });

  it("falls back to whichever of state/country exists", () => {
    expect(regionLine(null, "Mexico")).toBe("Mexico");
    expect(regionLine("CA", "")).toBe("California");
  });
});

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
