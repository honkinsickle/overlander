import { describe, it, expect } from "vitest";
import { regionLine, categoryLabel } from "./image-prompt.ts";

describe("regionLine — the post's 'State, USA' second line", () => {
  it("maps US state codes to 'Full Name, USA'", () => {
    expect(regionLine("OR")).toBe("Oregon, USA");
    expect(regionLine("CA")).toBe("California, USA");
    expect(regionLine("WA")).toBe("Washington, USA");
  });

  it("is case- and whitespace-insensitive on the code", () => {
    expect(regionLine("or")).toBe("Oregon, USA");
    expect(regionLine("  ca ")).toBe("California, USA");
  });

  it("does NOT map Canadian provinces (US-scoped) — returns the raw code", () => {
    expect(regionLine("BC")).toBe("BC");
  });

  it("returns the raw value for an unmapped code (never invents a name/country)", () => {
    expect(regionLine("XX")).toBe("XX");
  });

  it("returns '' when the state is absent (line is omitted)", () => {
    expect(regionLine(null)).toBe("");
    expect(regionLine("")).toBe("");
  });
});

describe("categoryLabel", () => {
  it("maps known categories and title-cases unknown ones", () => {
    expect(categoryLabel("recreation_area")).toBe("Recreation Area");
    expect(categoryLabel("campground")).toBe("Campground");
    expect(categoryLabel("some_new_kind")).toBe("Some New Kind");
  });
});
