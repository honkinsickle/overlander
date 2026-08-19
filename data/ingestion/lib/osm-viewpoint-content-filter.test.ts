import { describe, it, expect } from "vitest";
import {
  classifyViewpointDescription,
  passesViewpointContentFilter,
} from "./osm-viewpoint-content-filter.ts";

/**
 * Every string below is a REAL description observed on TEST during the
 * 2026-08-19 investigation — not invented fixtures. These pin the junk
 * definition so a later change cannot silently widen what goes live.
 */

describe("excluded — structurally contentless", () => {
  it("under the character minimum", () => {
    expect(classifyViewpointDescription("Great view", "Lookout Bench")).toBe("under-min-chars");
    expect(classifyViewpointDescription("cool place", "Unnamed viewpoint")).toBe("under-min-chars");
    expect(classifyViewpointDescription("Elevation 520", "Octopus Oak")).toBe("under-min-chars");
    expect(classifyViewpointDescription("3 cars", "Pullout")).toBe("under-min-chars");
  });

  it("a single word", () => {
    expect(classifyViewpointDescription("overlook", "top lookout")).toBe("single-word");
    expect(classifyViewpointDescription("bench", "Unnamed viewpoint")).toBe("single-word");
    expect(classifyViewpointDescription("Northbound", "Manastash Vista Point")).toBe("single-word");
    expect(classifyViewpointDescription("Cheetahs", "Unnamed viewpoint")).toBe("single-word");
  });

  it("an exact restatement of the place's own name", () => {
    expect(classifyViewpointDescription("Colorado River Overlook", "Colorado River Overlook")).toBe("name-restatement");
    expect(classifyViewpointDescription("Knob Point", "Knob Point")).toBe("name-restatement");
  });

  it("URL-only content", () => {
    expect(
      classifyViewpointDescription("http://rentiniprod.rentini.com/uploads/photo/image/16393/x.jpg?1347315986", "Top of the World"),
    ).toBe("url-only");
  });

  it("absent gets its OWN reason code, distinct from short-but-present", () => {
    // Absent is not the same as short. A row with no description never entered
    // the described population; a short one did and was judged contentless.
    // Both are excluded, but the reason code must not conflate them.
    expect(classifyViewpointDescription(null, "Anywhere")).toBe("no-description");
    expect(classifyViewpointDescription(undefined, "Anywhere")).toBe("no-description");
    expect(classifyViewpointDescription("   ", "Anywhere")).toBe("no-description");
    // …while a present-but-short string still reads as under-min-chars.
    expect(classifyViewpointDescription("Great view", "Lookout Bench")).toBe("under-min-chars");

    // City Hall Observation Deck's only source_record has description null —
    // it does not qualify under this filter and is not special-cased in.
    expect(passesViewpointContentFilter(null, "City Hall Observation Deck")).toBe(false);
    expect(classifyViewpointDescription(null, "City Hall Observation Deck")).toBe("no-description");
  });
});

describe("kept — short but real", () => {
  it("keeps content a pure length threshold would discard", () => {
    // 22 chars: tells a visitor exactly what they will see.
    expect(passesViewpointContentFilter("View of San Francisco.", "Unnamed viewpoint")).toBe(true);
    expect(passesViewpointContentFilter("nice view of the bridge", "Unnamed viewpoint")).toBe(true);
    expect(passesViewpointContentFilter("views of san pasqual valley", "Unnamed viewpoint")).toBe(true);
    expect(passesViewpointContentFilter("Delicate Arch viewpoint", "Unnamed viewpoint")).toBe(true);
  });
});

describe("kept — note-tag content, which is NOT mapper junk in this category", () => {
  it("keeps safety, access and trail information", () => {
    expect(passesViewpointContentFilter(
      "Follow the dirt path up the hill, you should see a big right. That has a ledge, climb the rock anyway to reach the ledge. Careful after rainy days gets slippery also watch out for snakes",
      "Unnamed viewpoint")).toBe(true);
    expect(passesViewpointContentFilter(
      "Sloped gravel path to shore view bench. Tidelands are privately owned. Water Access at High Tide only. No Public Beach Access. Parking for two cars at road end.",
      "Sanwick Place Road End")).toBe(true);
    expect(passesViewpointContentFilter("Be careful - overhanging brim", "Paria Rim Rocks")).toBe(true);
    expect(passesViewpointContentFilter("Private property", "Unnamed viewpoint")).toBe(true);
    expect(passesViewpointContentFilter("As of October 2012, view obstructed by trees.", "Unnamed viewpoint")).toBe(true);
  });
});

describe("kept — full prose", () => {
  it("keeps long descriptive content", () => {
    expect(passesViewpointContentFilter(
      "A landscape of dark lava flows and volcanic cinders abruptly gives way to the gash of Rainbow Canyon below this viewpoint.",
      "Father Crowley Vista Point")).toBe(true);
    expect(passesViewpointContentFilter(
      "Views of Mount Saint Helens, Mount Rainier, Mount Adams, Skamania Island and the Washington Side of the Columbia River Gorge.",
      "Unnamed viewpoint")).toBe(true);
  });

  it("KNOWN LIMITATION: this filter is structural, not a truth check", () => {
    // A 48-char dispute/vandalism entry. It is real prose by every structural
    // test, so filter C admits it — as would any length-based rule. Recorded so
    // nobody mistakes this filter for content moderation.
    expect(passesViewpointContentFilter("this place doesn't exists why is it on every map", "Echo Point")).toBe(true);
  });
});
