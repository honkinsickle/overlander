import { describe, it, expect } from "vitest";
import { convertAoMarkdown, looksLikeAoMarkdown } from "./atlas-oddities-markdown.ts";

describe("convertAoMarkdown", () => {
  it("passes plain text through unchanged", () => {
    const text = "The Witch's House is a stone ruin in Portland.";
    expect(convertAoMarkdown(text)).toBe(text);
  });

  it("handles the empty string and non-strings safely", () => {
    expect(convertAoMarkdown("")).toBe("");
    // @ts-expect-error — deliberate non-string
    expect(convertAoMarkdown(null)).toBe(null);
    // @ts-expect-error — deliberate non-string
    expect(convertAoMarkdown(undefined)).toBe(undefined);
  });

  it("strips inline link syntax and keeps the link text", () => {
    const input =
      "Located on a jetty in the [San Francisco](https://www.atlasobscura.com/things-to-do/san-francisco-california) Bay.";
    expect(convertAoMarkdown(input)).toBe(
      "Located on a jetty in the San Francisco Bay.",
    );
  });

  it("handles multiple inline links in one string", () => {
    const input =
      "Between [LA](https://one.example) and [SF](https://two.example) sits a place.";
    expect(convertAoMarkdown(input)).toBe("Between LA and SF sits a place.");
  });

  it("strips images (drops URL, keeps alt text)", () => {
    const input = "![The wave organ](https://img.example.com/wave.jpg) is a jetty.";
    expect(convertAoMarkdown(input)).toBe("The wave organ is a jetty.");
  });

  it("images with empty alt collapse to empty", () => {
    const input = "![](https://img.example.com/x.jpg)Coastal.";
    expect(convertAoMarkdown(input)).toBe("Coastal.");
  });

  it("strips bold markers", () => {
    expect(convertAoMarkdown("She was **famously** loud.")).toBe(
      "She was famously loud.",
    );
    expect(convertAoMarkdown("**Obscura Day location.**")).toBe(
      "Obscura Day location.",
    );
  });

  it("strips quadruple-asterisk emphasis (the Lola Montez case)", () => {
    expect(
      convertAoMarkdown('****"Exercise, not philosophically."-Lola Montez****'),
    ).toBe('"Exercise, not philosophically."-Lola Montez');
  });

  it("strips underscore italic at word boundaries", () => {
    expect(convertAoMarkdown("Featured in _House on Haunted Hill_ starring Vincent Price."))
      .toBe("Featured in House on Haunted Hill starring Vincent Price.");
    expect(convertAoMarkdown("_Update February 2018:_ Back open.")).toBe(
      "Update February 2018: Back open.",
    );
  });

  it("does NOT eat snake_case tokens", () => {
    // AO descriptions don't contain code, but be defensive.
    const input = "Use the field_name column and check word_boundary rules.";
    expect(convertAoMarkdown(input)).toBe(input);
  });

  it("strips a leading blockquote marker while keeping the quoted line", () => {
    expect(convertAoMarkdown("Someone once said:\n\n> \"I love this place.\"\n")).toBe(
      'Someone once said:\n\n"I love this place."\n',
    );
  });

  it("strips a leading list marker while keeping the list item", () => {
    const input = "The years included:\n\n*   1879: William Eddy\n*   1882: A. Roman\n";
    expect(convertAoMarkdown(input)).toBe(
      "The years included:\n\n1879: William Eddy\n1882: A. Roman\n",
    );
  });

  it("also strips `-` and `+` list markers", () => {
    expect(convertAoMarkdown("- one\n- two\n")).toBe("one\ntwo\n");
    expect(convertAoMarkdown("+ one\n+ two\n")).toBe("one\ntwo\n");
  });

  it("drops horizontal-rule lines (collapsing the surrounding whitespace)", () => {
    expect(convertAoMarkdown("Line 1.\n\n---\n\nLine 2.")).toBe(
      "Line 1.\n\nLine 2.",
    );
  });

  it("preserves paragraph breaks (double newlines)", () => {
    const input = "First paragraph.\n\nSecond paragraph.\n\nThird.";
    expect(convertAoMarkdown(input)).toBe(input);
  });

  it("handles a mix of link + bold + italic in one string", () => {
    const input =
      "In **1975**, [Corky Nowell](https://ex.example) said he encountered _highly intelligent beings_ called \"Summum\".";
    expect(convertAoMarkdown(input)).toBe(
      'In 1975, Corky Nowell said he encountered highly intelligent beings called "Summum".',
    );
  });

  it("is idempotent — running twice matches running once", () => {
    const input =
      "See [the Witch's Castle](https://www.atlasobscura.com/places/the-witches-castle-portland-oregon) trail. **Note:** _closed in winter_.";
    const once = convertAoMarkdown(input);
    const twice = convertAoMarkdown(once);
    expect(twice).toBe(once);
    expect(once).toBe("See the Witch's Castle trail. Note: closed in winter.");
  });

  it("does not touch trailing punctuation right after a stripped italic", () => {
    expect(convertAoMarkdown("She is _not_, in fact, a chemist.")).toBe(
      "She is not, in fact, a chemist.",
    );
  });

  it("leaves plain URLs alone (not inside link syntax)", () => {
    const input = "Visit https://example.com for details.";
    expect(convertAoMarkdown(input)).toBe(input);
  });
});

describe("looksLikeAoMarkdown", () => {
  it("returns false for plain text and empties", () => {
    expect(looksLikeAoMarkdown("")).toBe(false);
    expect(looksLikeAoMarkdown("just plain text")).toBe(false);
  });

  it("detects each supported markdown pattern", () => {
    expect(looksLikeAoMarkdown("![a](u)")).toBe(true);
    expect(looksLikeAoMarkdown("[a](u)")).toBe(true);
    expect(looksLikeAoMarkdown("**a**")).toBe(true);
    expect(looksLikeAoMarkdown("_a_")).toBe(true);
    expect(looksLikeAoMarkdown("> quote")).toBe(true);
    expect(looksLikeAoMarkdown("- item")).toBe(true);
  });

  it("does NOT flag snake_case tokens as markdown", () => {
    expect(looksLikeAoMarkdown("field_name here")).toBe(false);
  });
});
