/**
 * Tests for the shared STRONG/WEAK/NONE eligibility bucketing logic,
 * including the has_real_description signal added after the full-corpus
 * pass found facility/visitor_center wrongly bucketed NONE despite
 * RIDB/NPS populating a real description on 99-100% of their rows.
 */
import { describe, expect, it } from "vitest";
import {
  computeSignals,
  emptyAggregatedSignals,
  foldSignalsInto,
  isStrong,
  isWeak,
  bucketOf,
  DESCRIPTION_MIN_LENGTH,
} from "./eligibility.ts";

// ───── has_real_description — the new signal ────────────────────────────

describe("computeSignals: has_real_description", () => {
  it("a real, substantial description (real RIDB visitor_center sample) qualifies", () => {
    const np = {
      description:
        "The central backcountry office is located at park administrative offices south of Moab. Rangers can answer questions about backcountry travel over phone or email and issue permits online.",
    };
    expect(computeSignals(np, {}).has_real_description).toBe(true);
  });

  it("a templated name-restatement (real USFS trailhead sample, 'NAME (Category)') does NOT qualify", () => {
    expect(computeSignals({ description: "DAM POINT (Picnic Site)" }, {}).has_real_description).toBe(false);
    expect(computeSignals({ description: "SLOAN PEAK TRAILHEAD (Trailhead)" }, {}).has_real_description).toBe(false);
  });

  it("a literal placeholder (real RIDB facility sample) does NOT qualify", () => {
    expect(computeSignals({ description: "To Be Updated" }, {}).has_real_description).toBe(false);
  });

  it("generic boilerplate unrelated to the place's own name (real RIDB sample) does NOT qualify", () => {
    expect(computeSignals({ description: "Trailhead and Day Use Area." }, {}).has_real_description).toBe(false);
  });

  it("description: null does NOT qualify", () => {
    expect(computeSignals({ description: null }, {}).has_real_description).toBe(false);
  });

  it("description key absent entirely does NOT qualify", () => {
    expect(computeSignals({}, {}).has_real_description).toBe(false);
  });

  it("description: '' (non-null empty string — real RIDB campground sample) does NOT qualify", () => {
    expect(computeSignals({ description: "" }, {}).has_real_description).toBe(false);
  });

  it("description present but whitespace-only does NOT qualify (trims before measuring)", () => {
    expect(computeSignals({ description: "   \n\t  " }, {}).has_real_description).toBe(false);
  });

  it("a non-string description value does NOT qualify", () => {
    expect(computeSignals({ description: 12345 }, {}).has_real_description).toBe(false);
    expect(computeSignals({ description: { text: "real content padded to be long enough to pass" } }, {}).has_real_description).toBe(false);
  });

  it("exactly at the threshold qualifies; one character short does not (boundary check)", () => {
    const atThreshold = "x".repeat(DESCRIPTION_MIN_LENGTH);
    const belowThreshold = "x".repeat(DESCRIPTION_MIN_LENGTH - 1);
    expect(computeSignals({ description: atThreshold }, {}).has_real_description).toBe(true);
    expect(computeSignals({ description: belowThreshold }, {}).has_real_description).toBe(false);
  });

  it("leading/trailing whitespace is trimmed before measuring length", () => {
    const padded = "  " + "x".repeat(DESCRIPTION_MIN_LENGTH) + "  ";
    expect(computeSignals({ description: padded }, {}).has_real_description).toBe(true);
  });
});

// ───── has_real_directions — added 2026-08-20 (RIDB FacilityDirections /
// USFS directions gap found by the NONE-bucket characterization pass) ────

describe("computeSignals: has_real_directions", () => {
  it("real turn-by-turn directions (real RIDB FacilityDirections sample) qualifies", () => {
    const np = {
      directions:
        "Riley Springs Trailhead is located approximately 15 miles northeast of Loa, Utah. Head north on N Main St toward W 100 N St 0.6 miles.",
    };
    expect(computeSignals(np, {}).has_real_directions).toBe(true);
  });

  it("directions: null does NOT qualify", () => {
    expect(computeSignals({ directions: null }, {}).has_real_directions).toBe(false);
  });

  it("directions key absent entirely does NOT qualify", () => {
    expect(computeSignals({}, {}).has_real_directions).toBe(false);
  });

  it("short directions text below DESCRIPTION_MIN_LENGTH does NOT qualify (same threshold as description)", () => {
    expect(computeSignals({ directions: "Turn left." }, {}).has_real_directions).toBe(false);
  });

  it("exactly at the threshold qualifies; one character short does not (boundary check)", () => {
    const atThreshold = "x".repeat(DESCRIPTION_MIN_LENGTH);
    const belowThreshold = "x".repeat(DESCRIPTION_MIN_LENGTH - 1);
    expect(computeSignals({ directions: atThreshold }, {}).has_real_directions).toBe(true);
    expect(computeSignals({ directions: belowThreshold }, {}).has_real_directions).toBe(false);
  });

  it("has_real_directions and has_real_description are independent signals", () => {
    const directionsOnly = computeSignals(
      { description: "DAM POINT (Picnic Site)", directions: "y".repeat(50) },
      {},
    );
    expect(directionsOnly.has_real_description).toBe(false);
    expect(directionsOnly.has_real_directions).toBe(true);
  });

  it("a row with ONLY real directions (nothing else) is STRONG", () => {
    const agg = emptyAggregatedSignals();
    foldSignalsInto(agg, computeSignals({ directions: "z".repeat(60) }, {}));
    expect(isStrong(agg)).toBe(true);
    expect(bucketOf(agg)).toBe("STRONG");
  });
});

// ───── has_template_description — added 2026-08-21 (combined eligibility
// + provenance + review pass). Unlike every other signal above, this is
// master_place-level (a master_place_generated_content row), not derived
// from a source_record's payloads, so it's set directly on the aggregate
// rather than via computeSignals/foldSignalsInto. ─────────────────────

describe("isStrong / isWeak / bucketOf: has_template_description qualifies STRONG alone", () => {
  it("a row with ONLY a template description (no other signal) is STRONG", () => {
    const agg = emptyAggregatedSignals();
    agg.has_template_description = true;
    expect(isStrong(agg)).toBe(true);
    expect(isWeak(agg)).toBe(false);
    expect(bucketOf(agg)).toBe("STRONG");
  });

  it("no signals at all, has_template_description false, is still NONE", () => {
    const agg = emptyAggregatedSignals();
    expect(agg.has_template_description).toBe(false);
    expect(bucketOf(agg)).toBe("NONE");
  });

  it("a WEAK row (phone/hours only) is unaffected when has_template_description is false", () => {
    const agg = emptyAggregatedSignals();
    foldSignalsInto(agg, computeSignals({ contact: { phone: "555" } }, {}));
    expect(bucketOf(agg)).toBe("WEAK");
  });
});

// ───── Existing OSM-shape signals — confirm unchanged by the refactor ───

describe("computeSignals: existing OSM-shape signals (unchanged)", () => {
  const osmRaw = (tags: Record<string, string>) => ({ element: { tags } });

  it("has_wikipedia from raw_payload.element.tags (OSM shape)", () => {
    const s = computeSignals({}, osmRaw({ wikipedia: "en:Some Place" }));
    expect(s.has_wikipedia).toBe(true);
  });

  it("has_wikidata from raw_payload.element.tags", () => {
    const s = computeSignals({}, osmRaw({ wikidata: "Q12345" }));
    expect(s.has_wikidata).toBe(true);
  });

  it("meaningful_tag_count counts only MEANINGFUL_OSM_KEYS", () => {
    const s = computeSignals({}, osmRaw({ operator: "USFS", cuisine: "bbq", tourism: "camp_site" }));
    // operator + cuisine are meaningful; tourism is a category marker, excluded.
    expect(s.meaningful_tag_count).toBe(2);
  });

  it("raw_tag_count >= 5 fallback (no MEANINGFUL_OSM_KEYS needed)", () => {
    const s = computeSignals({}, osmRaw({ a: "1", b: "2", c: "3", d: "4", e: "5" }));
    expect(s.raw_tag_count).toBe(5);
    expect(s.meaningful_tag_count).toBe(0);
  });

  it("has_website from normalized_payload.contact.website", () => {
    const s = computeSignals({ contact: { website: "https://example.com" } }, {});
    expect(s.has_website).toBe(true);
  });

  it("has_phone from normalized_payload.contact.phone", () => {
    const s = computeSignals({ contact: { phone: "555-1234" } }, {});
    expect(s.has_phone).toBe(true);
  });

  it("has_hours from a string normalized_payload.hours", () => {
    expect(computeSignals({ hours: "Mon-Fri 9-5" }, {}).has_hours).toBe(true);
  });

  it("has_hours from an object normalized_payload.hours with keys", () => {
    expect(computeSignals({ hours: { monday: "9-5" } }, {}).has_hours).toBe(true);
  });

  it("no signals present → everything false", () => {
    const s = computeSignals({}, {});
    expect(s.has_website).toBe(false);
    expect(s.has_phone).toBe(false);
    expect(s.has_hours).toBe(false);
    expect(s.has_wikipedia).toBe(false);
    expect(s.has_wikidata).toBe(false);
    expect(s.meaningful_tag_count).toBe(0);
    expect(s.has_real_description).toBe(false);
    expect(s.has_real_directions).toBe(false);
  });
});

// ───── Tier placement: has_real_description folds into STRONG ──────────

describe("isStrong / isWeak / bucketOf: has_real_description qualifies STRONG alone", () => {
  it("a row with ONLY a real description (nothing else) is STRONG", () => {
    const agg = emptyAggregatedSignals();
    foldSignalsInto(agg, computeSignals({ description: "A" + "x".repeat(60) }, {}));
    expect(isStrong(agg)).toBe(true);
    expect(isWeak(agg)).toBe(false);
    expect(bucketOf(agg)).toBe("STRONG");
  });

  it("a row with only a templated/low-content description is NONE (not STRONG, not WEAK)", () => {
    const agg = emptyAggregatedSignals();
    foldSignalsInto(agg, computeSignals({ description: "DAM POINT (Picnic Site)" }, {}));
    expect(isStrong(agg)).toBe(false);
    expect(isWeak(agg)).toBe(false);
    expect(bucketOf(agg)).toBe("NONE");
  });

  it("a templated description plus phone/hours is WEAK, not STRONG", () => {
    const agg = emptyAggregatedSignals();
    foldSignalsInto(agg, computeSignals({ description: "Trailhead and Day Use Area.", contact: { phone: "555" } }, {}));
    expect(isStrong(agg)).toBe(false);
    expect(isWeak(agg)).toBe(true);
    expect(bucketOf(agg)).toBe("WEAK");
  });

  it("real description alone outranks WEAK signals — still STRONG even with no phone/hours", () => {
    const agg = emptyAggregatedSignals();
    foldSignalsInto(agg, computeSignals({ description: "y".repeat(50) }, {}));
    expect(bucketOf(agg)).toBe("STRONG");
  });

  it("the existing STRONG signals (wiki/website/meaningful tags) still qualify without a description", () => {
    const agg = emptyAggregatedSignals();
    foldSignalsInto(agg, computeSignals({ contact: { website: "https://x.com" } }, {}));
    expect(bucketOf(agg)).toBe("STRONG");
  });

  it("no signals at all is NONE", () => {
    const agg = emptyAggregatedSignals();
    foldSignalsInto(agg, computeSignals({}, {}));
    expect(bucketOf(agg)).toBe("NONE");
  });

  it("folding multiple source_records' signals into one aggregate ORs correctly (RIDB real desc + OSM meaningful tags)", () => {
    const agg = emptyAggregatedSignals();
    foldSignalsInto(agg, computeSignals({}, { element: { tags: { operator: "USFS" } } })); // OSM: meaningful tag
    foldSignalsInto(agg, computeSignals({ description: "z".repeat(60) }, {})); // RIDB: real description
    expect(agg.has_meaningful).toBe(true);
    expect(agg.has_real_description).toBe(true);
    expect(bucketOf(agg)).toBe("STRONG");
  });
});
