/**
 * Unit tests for padus.ts pure helpers (no network/DB).
 *
 * Covers the locked external_id key, the public_land/land_status category
 * split, the dispersed_camping const map (incl. restricted-beats-allowed),
 * and the unit-grain dissolve.
 */

import { describe, expect, it } from "vitest";

import type { GeoJsonFeature } from "../lib/geojson.ts";
import { _internals } from "./padus.ts";

const { tupleKey, externalIdFor, inferCategory, deriveDispersedCamping, dissolveByTuple, normalizeUnit } =
  _internals;

const poly = (ring: number[][]) =>
  ({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} }) as unknown as GeoJsonFeature;

function feat(props: Record<string, unknown>, ring: number[][] = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]): GeoJsonFeature {
  const f = poly(ring) as unknown as { properties: Record<string, unknown> };
  f.properties = props;
  return f as unknown as GeoJsonFeature;
}

describe("tupleKey + externalIdFor", () => {
  it("lowercases and joins the 4 locked components, ignoring loc_nm/state_nm", () => {
    expect(
      tupleKey({ Mang_Name: "USFS", Mang_Type: "FED", Unit_Nm: "Lolo National Forest", Des_Tp: "NF", Loc_Nm: "X", State_Nm: "MT" }),
    ).toBe("usfs|fed|lolo national forest|nf");
  });
  it("is deterministic and padus-prefixed", () => {
    const k = tupleKey({ Mang_Name: "BLM", Mang_Type: "FED", Unit_Nm: "Kingman Field Office", Des_Tp: "PUB" });
    expect(externalIdFor(k)).toBe(externalIdFor(k));
    expect(externalIdFor(k)).toMatch(/^padus:[0-9a-f]{40}$/);
  });
  it("different units → different ids", () => {
    expect(externalIdFor(tupleKey({ Unit_Nm: "A", Des_Tp: "NF" }))).not.toBe(
      externalIdFor(tupleKey({ Unit_Nm: "B", Des_Tp: "NF" })),
    );
  });
});

describe("inferCategory (exhaustive des_tp classification)", () => {
  it("federal named → public_land", () => {
    for (const d of ["NF", "nf", "NG", "NLS", "NM", "NP", "NRA", "NCA", "NWR", "NT", "WSR", "WA", "WPA", "REA", "REC", "ACC", "FORE"])
      expect(inferCategory(d)).toBe("public_land");
  });
  it("state named → public_land", () => {
    for (const d of ["SP", "SW", "SDA", "SREC"])
      expect(inferCategory(d)).toBe("public_land");
  });
  it("private/NGO named public-access parks → public_land", () => {
    for (const d of ["PPRK", "PROC"])
      expect(inferCategory(d)).toBe("public_land");
  });
  it("generic / ownership / jurisdiction → land_status", () => {
    for (const d of ["PUB", "ND", "UNK", "RMA", "SRMA", "LRMA", "MIL", "MIT", "FOTH", "HCA",
      "PHCA", "SHCA", "LHCA", "SCA", "SOTH", "PAGR", "PCON", "PFOR", "POTH", "PRAN",
      "LP", "LREC", "LOTH", "LCA", "TRIBL", "CONE", null])
      expect(inferCategory(d)).toBe("land_status");
  });
  it("National Monument variant and NSBV → public_land", () => {
    expect(inferCategory("NSBV")).toBe("public_land");
  });
});

describe("deriveDispersedCamping (const map; restricted-beats-allowed)", () => {
  const d = (mangName: string | null, mangType: string | null, desTp: string | null, pubAccess: string | null = "OA") =>
    deriveDispersedCamping({ mangName, mangType, desTp, pubAccess }).dispersed_camping;

  it("BLM / USFS non-wilderness → likely_allowed", () => {
    expect(d("BLM", "FED", "PUB")).toBe("likely_allowed");
    expect(d("USFS", "FED", "NF")).toBe("likely_allowed");
  });
  it("NPS / FWS / state park / private / local → likely_restricted", () => {
    expect(d("NPS", "FED", "NP")).toBe("likely_restricted");
    expect(d("FWS", "FED", "NWR")).toBe("likely_restricted");
    expect(d("State Parks", "STAT", "SP")).toBe("likely_restricted");
    expect(d("Private", "PVT", "PCON")).toBe("likely_restricted");
    expect(d("City", "LOC", "LP")).toBe("likely_restricted");
  });
  it("NGO → likely_restricted (conservancy, land trust — no dispersed camping)", () => {
    expect(d("Nature Conservancy", "NGO", "PCON")).toBe("likely_restricted");
    expect(d("Land Trust", "NGO", "POTH")).toBe("likely_restricted");
  });
  it("DIST (special district) → likely_restricted", () => {
    expect(d("REG", "DIST", "LP")).toBe("likely_restricted");
    expect(d("Regional Parks", "DIST", "LREC")).toBe("likely_restricted");
  });
  it("TRIB (tribal land) → likely_restricted (no permission assumed)", () => {
    expect(d("TRIB", "TRIB", "TRIBL")).toBe("likely_restricted");
  });
  it("Wilderness overrides an otherwise-allowed manager (restricted beats allowed)", () => {
    expect(d("USFS", "FED", "WA")).toBe("likely_restricted"); // forest manager but Wilderness designation
    expect(d("BLM", "FED", "WA")).toBe("likely_restricted");
  });
  it("closed public access → likely_restricted; truly-unknown manager type → unknown", () => {
    expect(d("BLM", "FED", "PUB", "XA")).toBe("likely_restricted");
    // JNT (joint/interagency) has no Mang_Name match and type is not in the
    // caught set — genuinely ambiguous, should be unknown
    expect(d("JNT", "JNT", "UNK")).toBe("unknown");
  });
  it("always carries verify_locally:true and a null mvum_corridor stub", () => {
    const r = deriveDispersedCamping({ mangName: "BLM", mangType: "FED", desTp: "PUB", pubAccess: "OA" });
    expect(r.verify_locally).toBe(true);
    expect(r.mvum_corridor).toBeNull();
  });
});

describe("dissolveByTuple (unit grain)", () => {
  it("merges same-tuple polygon shards into ONE unit with N MultiPolygon members", () => {
    const props = { Mang_Name: "USFS", Mang_Type: "FED", Unit_Nm: "Lolo National Forest", Des_Tp: "NF", Source_PAID: "P1" };
    const units = dissolveByTuple([
      feat(props, [[0, 0], [0, 1], [1, 1], [0, 0]]),
      feat({ ...props, Source_PAID: "P2" }, [[5, 5], [5, 6], [6, 6], [5, 5]]),
    ]);
    expect(units).toHaveLength(1);
    expect(units[0].members).toHaveLength(2);
    // 18%-collision case: distinct Source_PAIDs collapse into one unit, kept as provenance
    expect([...units[0].sourcePaids].sort()).toEqual(["P1", "P2"]);
  });
  it("distinct tuples → distinct units", () => {
    const units = dissolveByTuple([
      feat({ Mang_Name: "USFS", Mang_Type: "FED", Unit_Nm: "Lolo National Forest", Des_Tp: "NF" }),
      feat({ Mang_Name: "BLM", Mang_Type: "FED", Unit_Nm: "Kingman Field Office", Des_Tp: "PUB" }),
    ]);
    expect(units).toHaveLength(2);
  });
  it("a MultiPolygon shard spreads its members", () => {
    const f = {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [0, 1], [1, 1], [0, 0]]], [[[2, 2], [2, 3], [3, 3], [2, 2]]]] },
      properties: { Mang_Name: "BLM", Mang_Type: "FED", Unit_Nm: "X Field Office", Des_Tp: "PUB" },
    } as unknown as GeoJsonFeature;
    const units = dissolveByTuple([f]);
    expect(units).toHaveLength(1);
    expect(units[0].members).toHaveLength(2);
  });
});

describe("normalizeUnit", () => {
  it("produces a MultiPolygon geometry_polygon, the dispersed flag, verify_locally, and source_paids provenance", () => {
    const units = dissolveByTuple([
      feat({ Mang_Name: "BLM", Mang_Type: "FED", Unit_Nm: "Kingman Field Office", Des_Tp: "PUB", Pub_Access: "OA", GAP_Sts: 3, Source_PAID: "P9" }),
    ]);
    const mp = { type: "MultiPolygon" as const, coordinates: units[0].members };
    const n = normalizeUnit(units[0], "Kingman Field Office", mp);
    expect(n.canonical_name).toBe("Kingman Field Office");
    expect((n.geometry_polygon as { type: string }).type).toBe("MultiPolygon");
    expect(n.dispersed_camping).toBe("likely_allowed");
    expect(n.verify_locally).toBe(true);
    expect(n.mvum_corridor).toBeNull();
    expect(n.land_manager).toBe("BLM");
    expect(n.source_paids).toEqual(["P9"]);
    expect(n.overlander_tags).toContain("dispersed_camping_likely");
  });
});
