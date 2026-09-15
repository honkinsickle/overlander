import { describe, it, expect, vi } from "vitest";
import { homedir } from "node:os";
import {
  buildMeta,
  cleanLocalPath,
  csvExportUrl,
  fetchTabRows,
  nextUnposted,
  parseCategoryTab,
  parseCsv,
  parseCsvRows,
  parsePostsTab,
  queueIndexOf,
  sameGrid,
  tabCsvUrl,
  templateForCategoryRow,
  templateForRow,
  toSheetRows,
} from "./from-sheet.ts";
import type { PostRow } from "./from-sheet.ts";
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

describe("parseCsvRows", () => {
  it("KEEPS blank rows, so an index is a sheet position", () => {
    // The row-number contract: with the spacer kept, "1,2" is index 2 = sheet
    // row 3, which is where it actually sits in the sheet.
    expect(parseCsvRows("a,b\n,\n1,2")).toEqual([
      ["a", "b"],
      ["", ""],
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

describe("queueIndexOf", () => {
  const queue = parsePostsTab([
    ["photo_url", "place", "state", "country", "posted"],
    ["a.jpg", "Alpha", "CA", "USA", "2026-09-01"],
    ["b.jpg", "Beta", "OR", "USA", "2026-09-02"],
    ["c.jpg", "Gamma", "WA", "USA", ""],
    ["d.jpg", "Delta", "NV", "USA", ""],
  ], "scenic posts");

  it("maps a sheet row number back to its 0-based queue position", () => {
    expect(queueIndexOf({ photo: "p.jpg", place: "P", state: "OR", country: "USA", posted: "", rowNumber: 5 })).toBe(3);
    expect(queue.map(queueIndexOf)).toEqual([0, 1, 2, 3]);
  });

  it("keeps the original queue position after the posted rows are filtered out", () => {
    // The bug this guards: indexing the rotation off the FILTERED array would
    // give Gamma 0 and Delta 1 instead of their true queue positions 2 and 3.
    const pending = queue.filter((r) => r.posted === "");
    expect(pending.map((r) => r.place)).toEqual(["Gamma", "Delta"]);
    expect(pending.map(queueIndexOf)).toEqual([2, 3]);
    expect(pending.map((r) => templateForCategoryRow(queueIndexOf(r), 4))).toEqual([3, 4]);
  });

  it("gives --next-only a template that advances as rows are ticked posted", () => {
    // A one-element batch always has batch index 0; only the queue index moves.
    const first = nextUnposted(queue)!;
    expect(templateForCategoryRow(queueIndexOf(first), 4)).toBe(3);
    const afterTick = queue.map((r) => (r.place === "Gamma" ? { ...r, posted: "2026-09-03" } : r));
    const second = nextUnposted(afterTick)!;
    expect(templateForCategoryRow(queueIndexOf(second), 4)).toBe(4);
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

  it("throws on a token with stray spaces inside the braces", () => {
    const rows = [["art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "hello { place }"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/\{ place \}/);
  });

  it("throws on a token with punctuation inside the braces", () => {
    const rows = [["art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "hello {place,}"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/\{place,\}/);
  });

  it("throws on an unpaired brace", () => {
    const rows = [["art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "hello {place"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/unmatched brace/);
  });
});

describe("parseCategoryTab against the shape the LIVE endpoint really returns", () => {
  // Measured, not invented. gviz types a column once for the whole column: A
  // holds template numbers 1..12, so it is typed `number`
  // (cols: [("A","","number"), ("B","","string")]) and every TEXT cell in A —
  // the `art_url` label in A1 and the `n` label in A3 — comes back null/empty.
  // The literal string "art_url" is therefore NEVER present in the payload.
  const LIVE_CSV =
    ',/Users/adam/Desktop/potd/scenic_overlay.png \n' +
    ",\n" +
    ",template\n" +
    '1,"A {place} in {state}."\n' +
    '2,"B {place} — {category}."\n';

  it("finds and trims the art url from column B of row 1 (no label row present)", () => {
    const rows = parseCsvRows(LIVE_CSV);
    expect(rows[0]).toEqual(["", "/Users/adam/Desktop/potd/scenic_overlay.png "]);
    expect(rows.some((r) => (r[0] ?? "").trim().toLowerCase() === "art_url")).toBe(false);

    const cat = parseCategoryTab(rows, "scenic");
    expect(cat.artUrl).toBe("/Users/adam/Desktop/potd/scenic_overlay.png");
    expect(cat.templates).toEqual(["A {place} in {state}.", "B {place} — {category}."]);
  });

  it("finds it in the blank-filtered form of the same grid", () => {
    // The same payload with the spacer row removed — the reviewer's measured
    // grid verbatim. The art url must be found either way.
    const grid = [
      ["", "/Users/adam/Desktop/potd/scenic_overlay.png"],
      ["", "template"],
      ["1", "A {place} in {state}."],
    ];
    expect(parseCategoryTab(grid, "scenic").artUrl).toBe("/Users/adam/Desktop/potd/scenic_overlay.png");
  });

  it("still prefers an explicit art_url label row when the column IS typed as text", () => {
    // A tab whose column A gviz types `string` does carry the label; the label
    // row wins over row 1 so a labelled tab is read from its label, not by
    // position.
    const grid = [
      ["n", "template"],
      ["art_url", " /tmp/labelled.png "],
      ["1", "A {place}"],
    ];
    expect(parseCategoryTab(grid, "scenic").artUrl).toBe("/tmp/labelled.png");
  });
});

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

  it("numbers rows by their TRUE sheet position across an interior blank row", () => {
    // rowNumber is the sheet write-back target: after publishing, today's date
    // is typed into THIS row's `posted` cell. Numbering after the blanks were
    // filtered out reported Gamma as row 4 — so the date would land on Beta's
    // row (already posted), Gamma would stay unposted, and the next run would
    // publish Gamma a second time.
    const out = parsePostsTab(
      [
        ["photo_url", "place", "state", "country", "posted"], // sheet row 1
        ["a.jpg", "Alpha", "CA", "USA", "2026-09-01"], //          sheet row 2
        ["", "", "", "", ""], //                                   sheet row 3 (spacer)
        ["b.jpg", "Beta", "OR", "USA", ""], //                     sheet row 4
        ["c.jpg", "Gamma", "WA", "USA", ""], //                    sheet row 5
      ],
      "scenic posts",
    );
    expect(out.map((r) => r.place)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(out.map((r) => r.rowNumber)).toEqual([2, 4, 5]);
    // …and the template derived from those rows survives the blank too: Gamma
    // is queue index 3 → template 4, not index 2 → template 3.
    expect(out.map((r) => templateForCategoryRow(queueIndexOf(r), 4))).toEqual([1, 3, 4]);
  });

  it("carries the true sheet row all the way through a fetched tab", async () => {
    const body =
      "photo_url,place,state,country,posted\n" +
      "a.jpg,Alpha,CA,USA,2026-09-01\n" +
      ",,,,\n" +
      "c.jpg,Gamma,WA,USA,\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const rows = await fetchTabRows("https://docs.google.com/spreadsheets/d/ABC123/edit", "scenic posts", null);
    vi.unstubAllGlobals();
    const queue = parsePostsTab(rows, "scenic posts");
    expect(nextUnposted(queue)).toMatchObject({ place: "Gamma", rowNumber: 4 });
  });
});

describe("parsePostsTab against the shape the LIVE endpoint returns AFTER a publish", () => {
  // Measured, not invented. gviz types a column ONCE for the whole column. The
  // moment a real post is published and today's date is written into `posted`,
  // gviz types column E as `date` — so the TEXT cell in that column, the
  // `posted` HEADER in E1, comes back null. Measured after the first real
  // Instagram publish: cols [(A,string)…(D,string),(E,date)] and
  // rows[0].c[4] == {v: None}. The raw /export?format=csv of the same tab still
  // shows `photo_url,place,state,country,posted`, so the header IS there — only
  // this endpoint blanks it.
  const AFTER_PUBLISH = [
    ["photo_url", "place", "state", "country", ""],
    ["/Users/adam/Desktop/potd/devils_post_pile.png ", "Devils Post Pile", "CA", "USA", "2026-09-15"],
  ];

  it("parses a tab whose `posted` header gviz blanked, reading posted from column E", () => {
    const out = parsePostsTab(AFTER_PUBLISH, "scenic posts");
    expect(out).toEqual([
      {
        photo: "/Users/adam/Desktop/potd/devils_post_pile.png",
        place: "Devils Post Pile",
        state: "CA",
        country: "USA",
        posted: "2026-09-15",
        rowNumber: 2,
      },
    ]);
  });

  it("sees that row as POSTED — a blank-read `posted` would republish it forever", () => {
    // The failure this guards is worse than the crash: if the fallback picked
    // the wrong column (or read nothing), `posted` would be "" and the queue
    // would re-publish an already-published post on every run.
    expect(nextUnposted(parsePostsTab(AFTER_PUBLISH, "scenic posts"))).toBeNull();
  });

  it("carries the blanked header through a fetched tab", async () => {
    const body =
      "photo_url,place,state,country,\n" +
      "/Users/adam/Desktop/potd/devils_post_pile.png ,Devils Post Pile,CA,USA,2026-09-15\n" +
      "b.jpg,Beta,OR,USA,\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const fetched = await fetchTabRows("https://docs.google.com/spreadsheets/d/ABC123/edit", "scenic posts", null);
    vi.unstubAllGlobals();
    const queue = parsePostsTab(fetched, "scenic posts");
    expect(queue.map((r) => r.posted)).toEqual(["2026-09-15", ""]);
    expect(nextUnposted(queue)).toMatchObject({ place: "Beta", rowNumber: 3 });
  });

  it("still parses the PRE-publish shape, where the header is present and posted is empty", () => {
    // Campground before its first post: no date anywhere, so column E is still
    // typed `string` and the header survives. This is the path that works today
    // and must keep working.
    const out = parsePostsTab(
      [
        ["photo_url", "place", "state", "country", "posted"],
        ["a.jpg", "Alpha", "CA", "USA", ""],
      ],
      "campground posts",
    );
    expect(out[0]).toEqual({
      photo: "a.jpg", place: "Alpha", state: "CA", country: "USA", posted: "", rowNumber: 2,
    });
  });

  it("tolerates a blanked photo_url header too, since any column can be typed", () => {
    const out = parsePostsTab(
      [
        ["", "place", "state", "country", "posted"],
        ["a.jpg", "Alpha", "CA", "USA", ""],
      ],
      "scenic posts",
    );
    expect(out[0]).toMatchObject({ photo: "a.jpg", place: "Alpha" });
  });

  it("still throws when the fifth header is a DIFFERENT name — that is malformed, not blanked", () => {
    // The tolerance must be narrow: only an EMPTY header cell is evidence of
    // gviz column typing. A header that says something else is a real mistake
    // and must still fail loudly, or a `notes` column would be read as `posted`
    // and the queue would silently skip or republish rows.
    expect(() =>
      parsePostsTab(
        [
          ["photo_url", "place", "state", "country", "notes"],
          ["a.jpg", "Alpha", "CA", "USA", "hello"],
        ],
        "scenic posts",
      ),
    ).toThrow(/missing column\(s\): posted/);
  });

  it("still throws when the posted column is absent entirely (header row of four)", () => {
    expect(() =>
      parsePostsTab([["photo_url", "place", "state", "country"], ["a.jpg", "Alpha", "CA", "USA"]], "scenic posts"),
    ).toThrow(/missing column\(s\): posted/);
  });

  it("still names every genuinely missing column", () => {
    expect(() => parsePostsTab([["place", "state"]], "scenic posts")).toThrow(
      /missing column\(s\): photo_url, country, posted/,
    );
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

  it("names the first-tab case, which is indistinguishable from a missing tab", async () => {
    // The guard cannot tell "no such tab" from "this IS tab 1" — both return the
    // first tab's bytes. Sending the operator hunting for a typo that does not
    // exist is the whole defect, so the message must offer both readings and the
    // fix for the second.
    const body = FIRST_TAB.map((r) => r.join(",")).join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const err: unknown = await fetchTabRows(SHEET, "campground posts", FIRST_TAB).then(
      () => null,
      (e: unknown) => e,
    );
    vi.unstubAllGlobals();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/FIRST tab/);
    expect((err as Error).message).toMatch(/throwaway tab/);
  });

  it("throws on a non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    await expect(fetchTabRows(SHEET, "scenic", null)).rejects.toThrow(/HTTP 401/);
    vi.unstubAllGlobals();
  });
});
