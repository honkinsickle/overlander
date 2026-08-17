/**
 * recgovIds() — the source-agnostic recreation.gov-facility-id extractor the
 * queue rule uses. These lock in that widening the rule to NPS needs NO
 * extraction change: the id the NPS ingester leaves in
 * raw_payload.campground.reservationUrl is picked up by the SAME function the
 * rule already runs on USFS rows.
 *
 * Fixtures mirror the real stored shapes:
 *   - NPS: persistCampground stores rawPayload = { campground: c, ... }, and
 *     c.reservationUrl is a recreation.gov/camping/campgrounds/<id> URL.
 *   - USFS: the recreation.gov link rides inside the INFRA raw_payload text.
 */
import { describe, expect, it } from "vitest";

import { recgovIds } from "./resolve-recgov-rule.ts";

describe("recgovIds", () => {
  it("extracts the facility id from an NPS campground reservationUrl (no extraction change needed)", () => {
    // Exactly the shape persistCampground() writes for e.g. Jumbo Rocks (jotr).
    const npsCampground = {
      raw_payload: {
        campground: {
          id: "6742B85D-65DA-447C-95C2-80E110AA5E6A",
          name: "Jumbo Rocks Campground",
          reservationUrl: "https://www.recreation.gov/camping/campgrounds/272300",
        },
        fetched_at: "2026-05-28T01:17:20.000Z",
      },
      normalized_payload: {
        canonical_name: "Jumbo Rocks Campground",
        // contact.website holds the nps.gov page, NOT the recreation.gov URL —
        // the id must come from raw_payload for this to pass.
        contact: { website: "https://www.nps.gov/jotr/planyourvisit/jumbo-rocks-campground.htm" },
      },
    };
    expect(recgovIds(npsCampground)).toEqual(["272300"]);
  });

  it("still extracts from a USFS INFRA payload (regression — existing behavior)", () => {
    const usfs = {
      raw_payload: { description: "Reserve at https://www.recreation.gov/camping/campgrounds/234059 in season." },
      normalized_payload: {},
    };
    expect(recgovIds(usfs)).toEqual(["234059"]);
  });

  it("returns [] for a non-reservable NPS campground (empty reservationUrl, e.g. White Tank)", () => {
    const noRes = {
      raw_payload: { campground: { name: "White Tank Campground", reservationUrl: "" } },
      normalized_payload: { contact: { website: "https://www.nps.gov/jotr/planyourvisit/white-tank-campground.htm" } },
    };
    expect(recgovIds(noRes)).toEqual([]);
  });

  it("dedupes a repeated id and returns multiple distinct ids", () => {
    const sr = {
      raw_payload: {
        campground: { reservationUrl: "https://www.recreation.gov/camping/campgrounds/272300" },
        also: "https://www.recreation.gov/camping/campgrounds/272300",
        sibling: "https://www.recreation.gov/camping/campgrounds/232470",
      },
    };
    expect(recgovIds(sr).sort()).toEqual(["232470", "272300"]);
  });

  it("returns [] when there is no recreation.gov reference at all", () => {
    expect(recgovIds({ raw_payload: { name: "Barker Dam Trailhead" }, normalized_payload: {} })).toEqual([]);
  });
});
