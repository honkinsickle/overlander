/**
 * Unit tests for the shared ESRI REST query helper. `fetch` is mocked — no
 * network. Covers query construction (envelope GET + polygon POST), CW-ring
 * forcing + ESRI polygon shape, objectIdField resolution (top-level + fields[]
 * + fallback), and OID KEYSET pagination (where <oid> > lastMax, no
 * resultOffset) including retry recovery.
 *
 * fetchEsriFeatures issues ONE metadata request ({serviceUrl}?f=json) to
 * resolve the OID field, then paginates by keyset. The mocks route by URL:
 * non-/query GET → layer metadata; /query → feature pages.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  envelopeFilter,
  esriPolygonFromGeoJson,
  fetchEsriFeatures,
  ringIsClockwise,
  type EsriSpatialFilter,
} from "./esri.ts";

/** A GeoJSON feature carrying an OID property (drives keyset cursoring). */
function feat(oid: number, oidField = "OBJECTID") {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[oid, oid]]] },
    properties: { [oidField]: oid },
  };
}
function fc(oids: number[], exceeded?: boolean, oidField = "OBJECTID") {
  return {
    type: "FeatureCollection",
    exceededTransferLimit: exceeded,
    features: oids.map((o) => feat(o, oidField)),
  };
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}
function fail(status: number) {
  return { ok: false, status, json: async () => ({}), text: async () => "boom" };
}
/** Layer metadata — exposes the OID field via the modern top-level property. */
function metaOk(objectIdField = "OBJECTID") {
  return ok({ objectIdField });
}
function isQuery(url: unknown): boolean {
  return String(url).includes("/query");
}

const BBOX: [number, number, number, number] = [-115.4, 50.5, -114.5, 51.2];
const ENV: EsriSpatialFilter = envelopeFilter(BBOX);
const OPTS = { where: "TYPE IN ('PP')", label: "test_src", userAgent: "ua/1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── pure helpers ─────────────────────────────────────────────────────

describe("ringIsClockwise", () => {
  const ccw = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const cw = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
  it("detects clockwise vs counter-clockwise rings", () => {
    expect(ringIsClockwise(cw)).toBe(true);
    expect(ringIsClockwise(ccw)).toBe(false);
  });
});

describe("esriPolygonFromGeoJson — CW forcing + ESRI shape", () => {
  const ccwRing = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  it("forces the exterior ring clockwise (ESRI reads CCW as a hole)", () => {
    const poly = esriPolygonFromGeoJson({ type: "Polygon", coordinates: [ccwRing] });
    expect(ringIsClockwise(poly.rings[0])).toBe(true);
    expect(poly.rings[0]).toEqual([...ccwRing].reverse());
  });
  it("produces the correct ESRI polygon JSON shape", () => {
    const poly = esriPolygonFromGeoJson({ type: "Polygon", coordinates: [ccwRing] });
    expect(poly.spatialReference).toEqual({ wkid: 4326 });
    expect(poly.rings).toHaveLength(1);
  });
  it("leaves an already-clockwise exterior ring unchanged", () => {
    const cwRing = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    expect(esriPolygonFromGeoJson({ type: "Polygon", coordinates: [cwRing] }).rings[0]).toEqual(cwRing);
  });
  it("orients interior rings counter-clockwise (holes)", () => {
    const ext = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    const hole = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]];
    const poly = esriPolygonFromGeoJson({ type: "Polygon", coordinates: [ext, hole] });
    expect(ringIsClockwise(poly.rings[0])).toBe(true);
    expect(ringIsClockwise(poly.rings[1])).toBe(false);
  });
  it("throws on a non-Polygon geometry", () => {
    expect(() => esriPolygonFromGeoJson({ type: "MultiPolygon", coordinates: [] })).toThrow(/Polygon/);
  });
});

// ── envelope GET path + OID resolution ───────────────────────────────

describe("fetchEsriFeatures — envelope query construction (GET) + keyset", () => {
  it("builds the query with orderByFields=<oid> ASC and NO resultOffset", async () => {
    const queryCalls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (!isQuery(url)) return metaOk();
        queryCalls.push(url);
        return ok(fc([1])); // short, not exceeded → terminates
      }),
    );

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", ENV, OPTS);
    expect(feats).toHaveLength(1);
    expect(queryCalls).toHaveLength(1);
    const p = queryCalls[0].searchParams;
    expect(queryCalls[0].pathname.endsWith("/FeatureServer/0/query")).toBe(true);
    expect(p.get("where")).toBe("TYPE IN ('PP')"); // base where on page 1
    expect(p.get("geometryType")).toBe("esriGeometryEnvelope");
    expect(p.get("outSR")).toBe("4326");
    expect(p.get("f")).toBe("geojson");
    expect(p.get("orderByFields")).toBe("OBJECTID ASC");
    expect(p.get("resultRecordCount")).toBe("1000");
    expect(p.get("resultOffset")).toBeNull(); // keyset, not offset
  });

  it("resolves the OID field from fields[] (type esriFieldTypeOID) when no top-level objectIdField", async () => {
    const queryCalls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (!isQuery(url)) {
          return ok({ fields: [{ name: "objectid", type: "esriFieldTypeOID" }, { name: "rte_cn", type: "esriFieldTypeString" }] });
        }
        queryCalls.push(url);
        return ok(fc([1], false, "objectid"));
      }),
    );
    await fetchEsriFeatures("https://x/MapServer/1", ENV, OPTS);
    expect(queryCalls[0].searchParams.get("orderByFields")).toBe("objectid ASC");
  });

  it("falls back to OBJECTID when metadata is unavailable", async () => {
    const queryCalls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (!isQuery(url)) return fail(500);
        queryCalls.push(url);
        return ok(fc([1]));
      }),
    );
    await fetchEsriFeatures("https://x/FeatureServer/0", ENV, OPTS);
    expect(queryCalls[0].searchParams.get("orderByFields")).toBe("OBJECTID ASC");
  });
});

// ── polygon POST path ────────────────────────────────────────────────

describe("fetchEsriFeatures — polygon filter (POST)", () => {
  it("POSTs the polygon as esriGeometryPolygon in a form body", async () => {
    const cwRing = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    const filter: EsriSpatialFilter = {
      kind: "polygon",
      polygon: esriPolygonFromGeoJson({ type: "Polygon", coordinates: [cwRing] }),
    };
    let seenUrl: unknown;
    let seenInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (!isQuery(url)) return metaOk();
        seenUrl = url;
        seenInit = init;
        return ok(fc([1]));
      }),
    );

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", filter, OPTS);
    expect(feats).toHaveLength(1);
    expect(String(seenUrl)).toBe("https://x/FeatureServer/0/query");
    expect(seenInit?.method).toBe("POST");
    const body = new URLSearchParams(seenInit?.body as string);
    expect(body.get("geometryType")).toBe("esriGeometryPolygon");
    expect(body.get("orderByFields")).toBe("OBJECTID ASC");
    expect(JSON.parse(body.get("geometry")!)).toEqual({ rings: [cwRing], spatialReference: { wkid: 4326 } });
  });
});

// ── keyset pagination ────────────────────────────────────────────────

describe("fetchEsriFeatures — keyset pagination", () => {
  it("advances the OID cursor across pages (where <oid> > lastMax) and dedup-safe terminates", async () => {
    const wheres: string[] = [];
    const pages = [ok(fc([1, 2], true)), ok(fc([3]))]; // page1 size-capped (exceeded), page2 final
    let qi = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (!isQuery(url)) return metaOk();
        wheres.push(url.searchParams.get("where")!);
        return pages[qi++];
      }),
    );

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", ENV, OPTS);
    expect(feats).toHaveLength(3);
    expect(qi).toBe(2);
    expect(wheres[0]).toBe("TYPE IN ('PP')"); // page 1: base where
    expect(wheres[1]).toBe("(TYPE IN ('PP')) AND OBJECTID > 2"); // page 2: keyset past max OID
  });

  it("continues past a full page (== pageSize) and stops on a short non-exceeded page", async () => {
    const pages = [ok(fc([1, 2])), ok(fc([3]))]; // full page (==pageSize 2) → more may remain
    let qi = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => (isQuery(url) ? pages[qi++] : metaOk())));

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", ENV, { ...OPTS, pageSize: 2 });
    expect(feats).toHaveLength(3);
    expect(qi).toBe(2);
  });

  it("stops when the cursor cannot advance (no readable OID) instead of looping", async () => {
    // Features without an OID property → cursor can't advance → single page, then stop.
    const noOid = { type: "FeatureCollection", exceededTransferLimit: true, features: [{ type: "Feature", geometry: null, properties: { x: 1 } }] };
    let qi = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => { if (!isQuery(url)) return metaOk(); qi++; return ok(noOid); }));
    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", ENV, OPTS);
    expect(feats).toHaveLength(1);
    expect(qi).toBe(1); // did NOT loop forever
  });
});

describe("fetchEsriFeatures — retry", () => {
  it("retries a transient HTTP failure on a query page and then succeeds", async () => {
    let qcall = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (!isQuery(url)) return metaOk();
        qcall += 1;
        return qcall === 1 ? fail(503) : ok(fc([1]));
      }),
    );
    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", ENV, OPTS);
    expect(feats).toHaveLength(1);
    expect(qcall).toBe(2);
  });
});
