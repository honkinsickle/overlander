import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { cleanLocalPath, csvExportUrl, parseCsv, templateForRow, toSheetRows } from "./from-sheet.ts";
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
