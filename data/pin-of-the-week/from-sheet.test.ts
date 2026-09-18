import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import {
  buildMeta,
  cleanLocalPath,
  csvExportUrl,
  nextUnposted,
  parseCategoryTab,
  parseCsv,
  parseCsvRows,
  parsePostsTab,
  queueIndexOf,
  templateForCategoryRow,
  templateForRow,
  toSheetRows,
} from "./from-sheet.ts";
import type { PostRow } from "./from-sheet.ts";
import { regionLine } from "./image-prompt.ts";
import { fetchTabGrid } from "./sheet-read.ts";

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
    expect(queueIndexOf({ photo: "p.jpg", place: "P", state: "OR", country: "USA", posted: "", storyPhoto: "", rowNumber: 5 })).toBe(3);
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
      photo: "p.jpg", place: "Beta", state: "OR", country: "USA", posted: "", storyPhoto: "", rowNumber: 3,
    };
    expect(buildMeta("scenic", row, 7, "/tmp/o.png", "Beta caption")).toEqual({
      category: "scenic",
      place: "Beta",
      state: "OR",
      country: "USA",
      templateNumber: 7,
      artUrl: "/tmp/o.png",
      storyArtUrl: "",
      sourceRow: 3,
      caption: "Beta caption",
    });
  });

  it("records the story art when the category has some", () => {
    // Same provenance argument as artUrl: the art sits behind a path that can
    // change, so which one produced this story.png is worth keeping.
    const row: PostRow = {
      photo: "p.jpg", place: "Beta", state: "OR", country: "USA", posted: "", storyPhoto: "p-story.jpg", rowNumber: 3,
    };
    expect(buildMeta("scenic", row, 7, "/tmp/o.png", "Beta caption", "/tmp/o_story.png")).toMatchObject({
      artUrl: "/tmp/o.png",
      storyArtUrl: "/tmp/o_story.png",
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

describe("parseCategoryTab", () => {
  const good = [
    ["post_art_url", " /tmp/overlay.png "],
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

  describe("story_art_url", () => {
    // ~~Unlike `art_url`, this label IS machine-readable.~~ That distinction died
    // with gviz `[2026-09-17]`. gviz typed a column once for the whole column, so
    // column A — holding the template digits — was typed `number` and blanked the
    // `art_url` and `n` labels, while the story columns held only text and came
    // through. Reading through the Sheets API, EVERY label is real text, so both
    // are found the same way: the label names the cell to its right.
    const withStory = [
      ["post_art_url", " /tmp/overlay.png ", "story_art_url", " /tmp/overlay_story.png "],
      ["n", "template"],
      ["1", "A {place} in {state}."],
    ];

    it("is empty when the category has no story art", () => {
      expect(parseCategoryTab(good, "scenic").storyArtUrl).toBe("");
    });

    it("reads the value from the column AFTER the label, and trims it", () => {
      expect(parseCategoryTab(withStory, "scenic").storyArtUrl).toBe("/tmp/overlay_story.png");
    });

    it("reads the post art_url from its own label, not by position", () => {
      // Both labels live on the same row; each names the cell to its right, so the
      // story columns sitting further right cannot disturb the post path.
      expect(parseCategoryTab(withStory, "scenic").artUrl).toBe("/tmp/overlay.png");
    });

    it("is empty when the label is present but its cell is blank", () => {
      const rows = [
        ["post_art_url", "/tmp/overlay.png", "story_art_url", "   "],
        ["n", "template"],
        ["1", "A {place}"],
      ];
      expect(parseCategoryTab(rows, "scenic").storyArtUrl).toBe("");
    });

    it("is empty when the label is the last column, with nothing after it", () => {
      const rows = [["post_art_url", "/tmp/overlay.png", "story_art_url"], ["n", "template"], ["1", "A {place}"]];
      expect(parseCategoryTab(rows, "scenic").storyArtUrl).toBe("");
    });
  });

  it("throws when art_url is empty", () => {
    const rows = [["post_art_url", "  "], ["", ""], ["n", "template"], ["1", "x {place}"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/post_art_url is empty/);
  });

  it("throws when there are no templates", () => {
    const rows = [["post_art_url", "/tmp/o.png"], ["n", "template"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/no caption templates/);
  });

  it("throws when template numbers are not contiguous from 1", () => {
    const rows = [["post_art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "a {place}"], ["3", "c {place}"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/contiguous/);
  });

  it("throws on an unknown token", () => {
    const rows = [["post_art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "hello {nope}"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/\{nope\}/);
  });

  it("throws on a token with stray spaces inside the braces", () => {
    const rows = [["post_art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "hello { place }"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/\{ place \}/);
  });

  it("throws on a token with punctuation inside the braces", () => {
    const rows = [["post_art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "hello {place,}"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/\{place,\}/);
  });

  it("throws on an unpaired brace", () => {
    const rows = [["post_art_url", "/tmp/o.png"], ["", ""], ["n", "template"], ["1", "hello {place"]];
    expect(() => parseCategoryTab(rows, "scenic")).toThrow(/unmatched brace/);
  });
});

describe("parseCategoryTab against the two REAL tab layouts", () => {
  // Both grids are the live tabs as the Sheets API returns them
  // `[read 2026-09-17]`. This replaces a block that pinned gviz's behaviour —
  // typed columns blanking the labels, so `art_url` was NEVER in the payload and
  // had to be guessed as "column B of row 1". Reading through the API, the labels
  // are real text and one rule serves both layouts.

  // The original: labels across row 1, numbers in column A, templates in B.
  const ROW_ONE_LAYOUT = [
    ["post_art_url", "/Users/adam/scenic_overlay.png ", "story_art_url", "/Users/adam/scenic_story.png "],
    [],
    ["n", "template"],
    ["1", "A {place} in {state}."],
    ["2", "B {place} — {category}."],
  ];

  // The newer `test` tab: a title, section headings, blank spacers, labels down
  // column A, `n` at B10 so the numbers are in column B and the text in column C.
  // The word `template` sits in column A, above nothing — which is exactly why
  // the templates are located from `n` and not from `template`.
  const LABELLED_LAYOUT = [
    [],
    ["TEST"],
    [],
    [],
    ["Graphics"],
    ["post_art_url", "/Users/adam/scenic_overlay.png"],
    ["story_art_url", "/Users/adam/scenic_story.png "],
    [],
    ["Captions"],
    ["template", "n"],
    ["", "1", "A {place} in {state}."],
    ["", "2", "B {place} — {category}."],
  ];

  it("reads the row-one layout", () => {
    const cat = parseCategoryTab(ROW_ONE_LAYOUT, "scenic");
    expect(cat.artUrl).toBe("/Users/adam/scenic_overlay.png");
    expect(cat.storyArtUrl).toBe("/Users/adam/scenic_story.png");
    expect(cat.templates).toEqual(["A {place} in {state}.", "B {place} — {category}."]);
  });

  it("reads the labelled layout to exactly the same result", () => {
    const cat = parseCategoryTab(LABELLED_LAYOUT, "scenic");
    expect(cat.artUrl).toBe("/Users/adam/scenic_overlay.png");
    expect(cat.storyArtUrl).toBe("/Users/adam/scenic_story.png");
    expect(cat.templates).toEqual(["A {place} in {state}.", "B {place} — {category}."]);
  });

  it("ignores a `template` header that sits above the wrong column", () => {
    // On the real tab `template` is in column A while the text is in column C.
    // Keying off `n` is what makes that harmless; keying off `template` would
    // find an empty column and report no templates at all.
    expect(parseCategoryTab(LABELLED_LAYOUT, "scenic").templates).toHaveLength(2);
  });

  it("still reads the former name `art_url`, so sheet and code can be renamed in either order", () => {
    // Not speculative flexibility: the schedule publishes three times a day from
    // this sheet, so whichever of code/sheet is renamed first would otherwise
    // break the other until they matched.
    const oldName = [["art_url", "/tmp/o.png"], ["n", "template"], ["1", "A {place}"]];
    expect(parseCategoryTab(oldName, "scenic").artUrl).toBe("/tmp/o.png");
  });

  it("prefers post_art_url when a tab carries both names", () => {
    const both = [
      ["art_url", "/tmp/old.png"],
      ["post_art_url", "/tmp/new.png"],
      ["n", "template"],
      ["1", "A {place}"],
    ];
    expect(parseCategoryTab(both, "scenic").artUrl).toBe("/tmp/new.png");
  });

  it("does NOT guess the art url when the label is absent", () => {
    // The retired fallback took column B of the first row. That is why this
    // matters: see the swap test below for what it could have published.
    const noLabel = [["", "/Users/adam/scenic_overlay.png"], ["n", "template"], ["1", "A {place}"]];
    expect(() => parseCategoryTab(noLabel, "scenic")).toThrow(/no cell labelled post_art_url/);
  });

  it("cannot put STORY art on a feed post when the two rows are swapped", () => {
    // The concrete failure the old fallback allowed: with story art first, "column
    // B of row 1" IS the story overlay, so a 1080x1920 asset would have been
    // composited onto the 1080x1350 post and published, silently. Read by label,
    // each url stays with its own name whatever the order.
    const swapped = [
      ["story_art_url", "/Users/adam/scenic_story.png"],
      ["post_art_url", "/Users/adam/scenic_overlay.png"],
      ["n", "template"],
      ["1", "A {place}"],
    ];
    const cat = parseCategoryTab(swapped, "scenic");
    expect(cat.artUrl).toBe("/Users/adam/scenic_overlay.png");
    expect(cat.storyArtUrl).toBe("/Users/adam/scenic_story.png");
  });

  it("ignores a stray number ABOVE the n header rather than reading it as template 1", () => {
    const strayAbove = [
      ["post_art_url", "/tmp/o.png"],
      ["1", "not a template — a note that happens to start with a digit"],
      ["n", "template"],
      ["1", "A {place}"],
    ];
    expect(parseCategoryTab(strayAbove, "scenic").templates).toEqual(["A {place}"]);
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
      photo: "b.jpg", place: "Beta", state: "OR", country: "USA", posted: "", storyPhoto: "", rowNumber: 3,
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

  it("carries the true sheet row all the way through a fetched tab, spacer included", async () => {
    // THE REGRESSION THIS GUARDS, and it was live until 2026-09-17: gviz omitted
    // blank rows entirely, so a spacer row never reached the parser and every row
    // below it shifted up one. `posted` would then be written to the WRONG row —
    // dating an innocent one and leaving the real one queued to republish. The
    // Sheets API returns an interior blank row as [], which is what makes the
    // "number first, drop blanks after" contract actually hold.
    const apiBody = {
      values: [
        ["photo_url", "place", "state", "country", "posted"],
        ["a.jpg", "Alpha", "CA", "USA", "2026-09-01"],
        [],
        ["c.jpg", "Gamma", "WA", "USA"],
      ],
    };
    const deps = {
      fetch: (async () => new Response(JSON.stringify(apiBody))) as typeof fetch,
      token: async () => "TOK",
    };
    const rows = await fetchTabGrid("https://docs.google.com/spreadsheets/d/ABC123/edit", "scenic posts", deps);
    const queue = parsePostsTab(rows, "scenic posts");
    expect(nextUnposted(queue)).toMatchObject({ place: "Gamma", rowNumber: 4 });
  });
});

describe("parsePostsTab on a tab WIDER than the old contract", () => {
  // ~~Refuses to repair by position when the tab is wider than the contract.~~
  // Replaced 2026-09-17: there is no positional repair any more, so width is
  // simply not a constraint. The two blocks this stands in for tested the
  // blanked-header repair and the width bound that had to guard it — both
  // deleted with the move to the Sheets API, where a header is the text it is.
  const WIDE = [
    ["post_photo_url", "place", "state", "country", "posted", "story_photo_url", "notes", "scheduled"],
    ["a.jpg", "Alpha", "CA", "USA", "2026-09-01", "a_story.png", "some note", "2026-10-01"],
    ["b.jpg", "Beta", "OR", "USA", "", "b_story.png", "", ""],
  ];

  it("parses it, ignoring the extra columns", () => {
    const out = parsePostsTab(WIDE, "scenic posts");
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ place: "Beta", posted: "", storyPhoto: "b_story.png", rowNumber: 3 });
  });

  it("is not fooled by a `scheduled` date column, the old hazard", () => {
    // The width bound existed because a typed `scheduled` column inserted before
    // `posted` blanked both headers, so position 4 silently became `scheduled` —
    // every scheduled row reading as published. Named columns cannot confuse the
    // two at all.
    expect(parsePostsTab(WIDE, "scenic posts").map((r) => r.posted)).toEqual(["2026-09-01", ""]);
  });
});


describe("parsePostsTab reads the optional story_photo_url column", () => {
  // The story render needs its own photo: the post is 4:5 and a story is 9:16, so
  // reusing the post photo crops the subject. The column is OPTIONAL — every tab
  // that predates it must keep parsing untouched.
  it("is absent on a five-wide tab, and storyPhoto is empty", () => {
    const out = parsePostsTab(
      [
        ["photo_url", "place", "state", "country", "posted"],
        ["a.jpg", "Alpha", "CA", "USA", ""],
      ],
      "scenic posts",
    );
    expect(out[0]).toMatchObject({ place: "Alpha", photo: "a.jpg", storyPhoto: "" });
  });

  it("reads the story photo when the column is present", () => {
    const out = parsePostsTab(
      [
        ["photo_url", "place", "state", "country", "posted", "story_photo_url"],
        ["a.jpg", "Alpha", "CA", "USA", "", "a-story.jpg"],
      ],
      "scenic posts",
    );
    expect(out[0]).toMatchObject({ photo: "a.jpg", storyPhoto: "a-story.jpg" });
  });

  it("leaves storyPhoto empty for a row that has no story photo yet", () => {
    const out = parsePostsTab(
      [
        ["photo_url", "place", "state", "country", "posted", "story_photo_url"],
        ["a.jpg", "Alpha", "CA", "USA", "", ""],
      ],
      "scenic posts",
    );
    expect(out[0].storyPhoto).toBe("");
  });

  it("reads posted and story together on the six-wide live shape", () => {
    // ~~Still repairs a gviz-blanked `posted` header at six wide.~~ The blanking
    // was gviz typing column E as a date the moment a real date was written into
    // it; through the Sheets API the header is the text it is, so there is nothing
    // to repair. The shape itself still matters, so it is still covered.
    const out = parsePostsTab(
      [
        ["post_photo_url", "place", "state", "country", "posted", "story_photo_url"],
        ["a.jpg", "Alpha", "CA", "USA", "2026-09-15", "a-story.jpg"],
        ["b.jpg", "Beta", "OR", "USA", "", "b-story.jpg"],
      ],
      "scenic posts",
    );
    expect(out[0]).toMatchObject({ place: "Alpha", posted: "2026-09-15", storyPhoto: "a-story.jpg" });
    expect(out[1]).toMatchObject({ place: "Beta", posted: "", storyPhoto: "b-story.jpg" });
    expect(nextUnposted(out)?.place).toBe("Beta");
  });

  it("widens the contract ONLY for story_photo_url — any other sixth column still refuses", () => {
    // The `scheduled` hazard is unchanged: widening for one NAMED optional column
    // must not hand position 4 to some other typed column. Same fixture as the
    // width-refusal suite, which must stay red.
    expect(() =>
      parsePostsTab(
        [
          ["photo_url", "place", "state", "country", "", ""],
          ["b.jpg", "Beta", "OR", "USA", "2026-10-02", ""],
        ],
        "scenic posts",
      ),
    ).toThrow(/missing column\(s\): posted/);
  });
});

describe("parsePostsTab header resolution", () => {
  // ~~header-row sanity~~ — rewritten 2026-09-17. The rules this block used to
  // pin (a blank row 1 is fatal; a fuzzy `includes("url")` match; refusing to
  // choose between two url-ish headers) all belonged to the positional repair,
  // which is gone. What replaces them is stricter and simpler: columns are found
  // by exact name, anywhere.

  it("accepts a spacer row above the header, which used to be fatal", () => {
    const out = parsePostsTab(
      [
        ["", "", "", "", ""],
        ["post_photo_url", "place", "state", "country", "posted"],
        ["a.jpg", "Alpha", "CA", "USA", ""],
      ],
      "scenic posts",
    );
    // And the real header is NOT read as data — the old failure mode was a row
    // entering the queue with photo: "photo_url".
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ photo: "a.jpg", place: "Alpha", rowNumber: 3 });
  });

  it("will not take a url-ish column as the photo column", () => {
    // `includes("url")` was weak evidence — it would hand `photo` to any url-ish
    // column and render the wrong image with no error. Only the real names count,
    // so a tab with `source_url` and no photo column fails to find a header.
    expect(() =>
      parsePostsTab(
        [
          ["", "place", "state", "country", "posted", "source_url"],
          ["a.jpg", "Alpha", "CA", "USA", "", "https://example.com/src"],
        ],
        "scenic posts",
      ),
    ).toThrow(/no header row found/);
  });

  it("REFUSES a misspelled photo header, which the fuzzy match used to tolerate", () => {
    // A real loss, recorded deliberately: `pohoto_url` parsed before, because it
    // was the only url-ish header. It now fails. The trade is that nothing is ever
    // guessed — and the error says what it found, so the fix is obvious.
    expect(() =>
      parsePostsTab(
        [
          ["pohoto_url", "place", "state", "country", "posted"],
          ["a.jpg", "Alpha", "CA", "USA", ""],
        ],
        "scenic posts",
      ),
    ).toThrow(/no header row found/);
  });

  it("takes an exact post_photo_url even when another url column exists", () => {
    const out = parsePostsTab(
      [
        ["post_photo_url", "place", "state", "country", "posted", "source_url"],
        ["a.jpg", "Alpha", "CA", "USA", "", "https://example.com/src"],
      ],
      "scenic posts",
    );
    expect(out[0]).toMatchObject({ photo: "a.jpg" });
  });
});

describe("parsePostsTab against the REFORMATTED layout", () => {
  // The live `oddities posts` tab as the Sheets API returns it `[read 2026-09-17]`:
  // a padded title row, a blank row, the header on row 3, columns in a different
  // order, `photo_url` renamed `post_photo_url`, two blank spacer columns, and
  // `posted` out at H. Under the old positional contract this tab did not parse at
  // all — it failed with "missing column(s): photo_url, place, state, country,
  // posted ... this tab is 8 columns wide".
  const REFORMATTED = [
    [" Oddities Posts"],
    [],
    ["place", "state", "country", "post_photo_url", "", "story_photo_url", "", "posted"],
    ["Trees of Mystery", "Klamath, CA", "USA", "t.png", "", "t_story.png", "", "2026-09-17"],
    ["Gus's Fresh Jerky", "Hwy 395, CA", "USA", "g.png", "", "g_story.png", "", ""],
  ];

  it("parses it, mapping every column by name", () => {
    const out = parsePostsTab(REFORMATTED, "oddities posts");
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      photo: "g.png",
      place: "Gus's Fresh Jerky",
      state: "Hwy 395, CA",
      country: "USA",
      posted: "",
      storyPhoto: "g_story.png",
      rowNumber: 5,
    });
  });

  it("gives rows their TRUE sheet numbers, counting the title and blank rows", () => {
    // Not 2 and 3. The tick writes to this number, so counting from the header
    // would date the wrong row and leave the real one queued.
    expect(parsePostsTab(REFORMATTED, "oddities posts").map((r) => r.rowNumber)).toEqual([4, 5]);
  });

  it("does not read the title row as data", () => {
    expect(parsePostsTab(REFORMATTED, "oddities posts").some((r) => r.place.includes("Oddities"))).toBe(
      false,
    );
  });

  it("still reads the former column name `photo_url`", () => {
    const oldName = [
      ["photo_url", "place", "state", "country", "posted"],
      ["a.jpg", "Alpha", "CA", "USA", ""],
    ];
    expect(parsePostsTab(oldName, "scenic posts")[0].photo).toBe("a.jpg");
  });

  it("names what is missing instead of guessing", () => {
    const noPosted = [
      ["place", "state", "country", "post_photo_url"],
      ["Alpha", "CA", "USA", "a.jpg"],
    ];
    expect(() => parsePostsTab(noPosted, "scenic posts")).toThrow(/missing column\(s\): posted/);
  });

  it("refuses a tab with no header row at all", () => {
    const noHeader = [["Oddities Posts"], [], ["Alpha", "CA", "USA"]];
    expect(() => parsePostsTab(noHeader, "scenic posts")).toThrow(/no header row found/);
  });

  it("needs BOTH a photo column and place to call a row the header", () => {
    // `place` alone is too weak — it could be a note or part of a title.
    const weak = [["place"], ["post_photo_url", "place", "state", "country", "posted"], ["a.jpg", "A", "CA", "USA", ""]];
    expect(parsePostsTab(weak, "scenic posts")[0].place).toBe("A");
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

