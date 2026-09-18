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
        storyPhoto: "",
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

  it("no longer arrives blanked at all, because the reader returns real header text", async () => {
    // The grid above is kept as coverage of the positional repair, but the input
    // itself can no longer occur: the blanking was gviz typing column E as `date`
    // the moment a real date was written into it. The Sheets API returns the
    // `posted` header as the text it is.
    const apiBody = {
      values: [
        ["photo_url", "place", "state", "country", "posted"],
        ["/Users/adam/Desktop/potd/devils_post_pile.png ", "Devils Post Pile", "CA", "USA", "2026-09-15"],
        ["b.jpg", "Beta", "OR", "USA"],
      ],
    };
    const deps = {
      fetch: (async () => new Response(JSON.stringify(apiBody))) as typeof fetch,
      token: async () => "TOK",
    };
    const fetched = await fetchTabGrid("https://docs.google.com/spreadsheets/d/ABC123/edit", "scenic posts", deps);
    expect(fetched[0][4]).toBe("posted");
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
      photo: "a.jpg", place: "Alpha", state: "CA", country: "USA", posted: "", storyPhoto: "", rowNumber: 2,
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

describe("parsePostsTab refuses to repair by position when the tab is WIDER than the contract", () => {
  // The blank-header gate proves "a column at this position was typed". It does
  // NOT prove "the column at this position is the one I want" — position 4 is
  // `posted` only if the tab has exactly five columns. An operator adding a
  // `scheduled` date column BEFORE `posted` gets both headers blanked by the
  // same gviz mechanism, and position 4 is then `scheduled`.
  const EXTRA_TYPED_COLUMN = [
    //                                    E = scheduled ↓   ↓ F = posted (both blanked)
    ["photo_url", "place", "state", "country", "", ""],
    ["b.jpg", "Beta", "OR", "USA", "2026-10-02", ""], // scheduled for Oct 2, NOT published
    ["c.jpg", "Gamma", "WA", "USA", "", "2026-09-14"], // published, never scheduled
  ];

  it("throws rather than resolving `posted` to the `scheduled` column", () => {
    expect(() => parsePostsTab(EXTRA_TYPED_COLUMN, "scenic posts")).toThrow(
      /missing column\(s\): posted/,
    );
  });

  it("says WHY it cannot repair, naming the width", () => {
    expect(() => parsePostsTab(EXTRA_TYPED_COLUMN, "scenic posts")).toThrow(/6 columns wide/);
  });

  it("would otherwise invert BOTH rows' posted state — the harm the throw prevents", () => {
    // Documents exactly what mis-resolving costs, so the throw is not mistaken
    // for pedantry. Reading column E as `posted`: Beta (merely scheduled) reads
    // as published and never builds; Gamma (really published, blank in E) reads
    // as unposted and is republished. Loud beats silently wrong — this is the
    // same argument the `notes` test makes, arriving through the extra-column
    // door instead. The `notes` header only stays safe because TEXT columns do
    // not blank; a typed one does.
    const asIfRepaired = EXTRA_TYPED_COLUMN.slice(1).map((r) => r[4]);
    expect(asIfRepaired).toEqual(["2026-10-02", ""]);
  });

  it("still parses the five-wide post-publish tab — the live shape must not re-break", () => {
    // Measured before tightening: gviz returns EXACTLY 5 fields per row for both
    // live tabs (`scenic posts`, cols [string,string,string,string,date]; and
    // `campground posts`). The width refusal cannot reach them.
    const out = parsePostsTab(
      [
        ["photo_url", "place", "state", "country", ""],
        ["a.jpg", "Alpha", "CA", "USA", "2026-09-15"],
      ],
      "scenic posts",
    );
    expect(out[0]).toMatchObject({ place: "Alpha", posted: "2026-09-15" });
  });

  it("allows a wide tab whose headers are all present — width only blocks the REPAIR", () => {
    // Extra columns are not themselves an error. Only the positional fallback is
    // unsafe on them, so a wide tab with intact header text parses fine.
    const out = parsePostsTab(
      [
        ["photo_url", "place", "state", "country", "scheduled", "posted"],
        ["b.jpg", "Beta", "OR", "USA", "2026-10-02", ""],
      ],
      "scenic posts",
    );
    expect(out[0]).toMatchObject({ place: "Beta", posted: "" });
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

  it("still repairs a gviz-blanked `posted` header at six wide — the LIVE shape", () => {
    // This is the whole point of widening the contract. Publishing one scenic post
    // types column E as a date, so gviz blanks the `posted` header; the tab then
    // depends on positional repair. Adding story_photo_url made it six wide, which
    // the old bound refused outright — measured against the live sheet 2026-09-16,
    // it broke `scenic posts` immediately and would have broken `campground posts`
    // at its next publish.
    const out = parsePostsTab(
      [
        //                                        posted blanked by gviz ↓
        ["photo_url", "place", "state", "country", "", "story_photo_url"],
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

describe("parsePostsTab header-row sanity", () => {
  it("throws when row 1 is blank instead of reading the header row as data", () => {
    // A spacer row above the header made every column fall back to its position,
    // so the REAL header became a data row: it entered the queue with
    // photo: "photo_url" and aborted the batch with "photo could not be read".
    // All five headers blanking at once is impossible anyway — photo_url/place/
    // state/country hold text, so gviz types them `string` and they never blank.
    expect(() =>
      parsePostsTab(
        [
          ["", "", "", "", ""],
          ["photo_url", "place", "state", "country", "posted"],
          ["a.jpg", "Alpha", "CA", "USA", ""],
        ],
        "scenic posts",
      ),
    ).toThrow(/row 1 is blank/);
  });

  it("will not let the fuzzy url match paper over a blanked header on a wide tab", () => {
    // `includes("url")` is WEAK evidence — it would hand `photo` to any other
    // url-ish column and render the wrong image with NO error. The fuzzy match
    // is a repair like any other, so the width bound gates it too: this throws
    // instead of silently compositing `source_url`.
    expect(() =>
      parsePostsTab(
        [
          ["", "place", "state", "country", "posted", "source_url"],
          ["a.jpg", "Alpha", "CA", "USA", "", "https://example.com/src"],
        ],
        "scenic posts",
      ),
    ).toThrow(/missing column\(s\): photo_url/);
  });

  it("throws when the photo column is ambiguous rather than guessing", () => {
    // Misspelled photo column AND another url-ish column, within the contract
    // width: the fuzzy match has no basis to choose between them, so it refuses
    // instead of picking the first.
    expect(() =>
      parsePostsTab(
        [
          ["pohoto_url", "place", "state", "country_url", "posted"],
          ["a.jpg", "Alpha", "CA", "https://example.com/c", ""],
        ],
        "scenic posts",
      ),
    ).toThrow(/pohoto_url, country_url/);
  });

  it("keeps the fuzzy match when it is the ONLY url-ish header", () => {
    const out = parsePostsTab(
      [
        ["pohoto_url", "place", "state", "country", "posted"],
        ["a.jpg", "Alpha", "CA", "USA", ""],
      ],
      "scenic posts",
    );
    expect(out[0]).toMatchObject({ photo: "a.jpg" });
  });

  it("keeps an exact photo_url header even when another url column exists", () => {
    const out = parsePostsTab(
      [
        ["photo_url", "place", "state", "country", "posted", "source_url"],
        ["a.jpg", "Alpha", "CA", "USA", "", "https://example.com/src"],
      ],
      "scenic posts",
    );
    expect(out[0]).toMatchObject({ photo: "a.jpg" });
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

