/**
 * Unit tests for the shared ESRI REST query helper. `fetch` is mocked — no
 * network. Covers query construction (envelope GET + polygon POST), CW-ring
 * forcing + ESRI polygon shape, exceededTransferLimit + short-page pagination,
 * and retry recovery.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  envelopeFilter,
  esriPolygonFromGeoJson,
  fetchEsriFeatures,
  ringIsClockwise,
  type EsriSpatialFilter,
} from "./esri.ts";

type FC = {
  type: "FeatureCollection";
  features: unknown[];
  exceededTransferLimit?: boolean;
};

function fc(n: number, exceeded?: boolean): FC {
  return {
    type: "FeatureCollection",
    exceededTransferLimit: exceeded,
    features: Array.from({ length: n }, (_, i) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[i, i]]] },
      properties: { i },
    })),
  };
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}
function fail(status: number) {
  return { ok: false, status, json: async () => ({}), text: async () => "boom" };
}

const BBOX: [number, number, number, number] = [-115.4, 50.5, -114.5, 51.2];
const ENV: EsriSpatialFilter = envelopeFilter(BBOX);
const OPTS = { where: "TYPE IN ('PP')", label: "test_src", userAgent: "ua/1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── pure helpers ─────────────────────────────────────────────────────

describe("ringIsClockwise", () => {
  // A unit square. CCW (GeoJSON default) vs CW.
  const ccw = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]; // counter-clockwise
  const cw = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]; // clockwise

  it("detects clockwise vs counter-clockwise rings", () => {
    expect(ringIsClockwise(cw)).toBe(true);
    expect(ringIsClockwise(ccw)).toBe(false);
  });
});

describe("esriPolygonFromGeoJson — CW forcing + ESRI shape", () => {
  const ccwRing = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]; // CCW exterior

  it("forces the exterior ring clockwise (ESRI reads CCW as a hole)", () => {
    const poly = esriPolygonFromGeoJson({ type: "Polygon", coordinates: [ccwRing] });
    expect(ringIsClockwise(poly.rings[0])).toBe(true);
    // Same vertex set, just reversed winding.
    expect(poly.rings[0]).toEqual([...ccwRing].reverse());
  });

  it("produces the correct ESRI polygon JSON shape (rings + spatialReference)", () => {
    const poly = esriPolygonFromGeoJson({ type: "Polygon", coordinates: [ccwRing] });
    expect(poly.spatialReference).toEqual({ wkid: 4326 });
    expect(Array.isArray(poly.rings)).toBe(true);
    expect(poly.rings).toHaveLength(1);
  });

  it("leaves an already-clockwise exterior ring unchanged", () => {
    const cwRing = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    const poly = esriPolygonFromGeoJson({ type: "Polygon", coordinates: [cwRing] });
    expect(poly.rings[0]).toEqual(cwRing);
  });

  it("orients interior rings counter-clockwise (holes)", () => {
    const exteriorCcw = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    const holeCw = [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]; // CW hole → must flip to CCW
    const poly = esriPolygonFromGeoJson({ type: "Polygon", coordinates: [exteriorCcw, holeCw] });
    expect(ringIsClockwise(poly.rings[0])).toBe(true); // exterior CW
    expect(ringIsClockwise(poly.rings[1])).toBe(false); // hole CCW
  });

  it("throws on a non-Polygon geometry", () => {
    expect(() => esriPolygonFromGeoJson({ type: "MultiPolygon", coordinates: [] })).toThrow(/Polygon/);
  });
});

// ── envelope GET path (existing behavior preserved) ──────────────────

describe("fetchEsriFeatures — envelope query construction (GET)", () => {
  it("builds the ESRI envelope query with outSR=4326 + f=geojson", async () => {
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        calls.push(url);
        return ok(fc(1)); // short page, no exceeded flag → terminates
      }),
    );

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", ENV, OPTS);
    expect(feats).toHaveLength(1);
    expect(calls).toHaveLength(1);

    const p = calls[0].searchParams;
    expect(calls[0].pathname.endsWith("/FeatureServer/0/query")).toBe(true);
    expect(p.get("where")).toBe("TYPE IN ('PP')");
    expect(p.get("geometry")).toBe("-115.4,50.5,-114.5,51.2");
    expect(p.get("geometryType")).toBe("esriGeometryEnvelope");
    expect(p.get("inSR")).toBe("4326");
    expect(p.get("outSR")).toBe("4326");
    expect(p.get("f")).toBe("geojson");
    expect(p.get("outFields")).toBe("*");
    expect(p.get("resultOffset")).toBe("0");
    expect(p.get("resultRecordCount")).toBe("1000");
  });
});

// ── polygon POST path (new corridor-clip behavior) ───────────────────

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
        seenUrl = url;
        seenInit = init;
        return ok(fc(1));
      }),
    );

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", filter, OPTS);
    expect(feats).toHaveLength(1);
    expect(String(seenUrl)).toBe("https://x/FeatureServer/0/query"); // no query string
    expect(seenInit?.method).toBe("POST");
    expect((seenInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = new URLSearchParams(seenInit?.body as string);
    expect(body.get("geometryType")).toBe("esriGeometryPolygon");
    expect(body.get("spatialRel")).toBe("esriSpatialRelIntersects");
    expect(body.get("inSR")).toBe("4326");
    expect(JSON.parse(body.get("geometry")!)).toEqual({
      rings: [cwRing],
      spatialReference: { wkid: 4326 },
    });
  });
});

describe("fetchEsriFeatures — pagination", () => {
  it("follows exceededTransferLimit across pages, then stops on a short page", async () => {
    const offsets: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (url: URL) => {
        offsets.push(url.searchParams.get("resultOffset")!);
        return ok(fc(2, true)); // more remain
      })
      .mockImplementationOnce(async (url: URL) => {
        offsets.push(url.searchParams.get("resultOffset")!);
        return ok(fc(1)); // final short page
      });
    vi.stubGlobal("fetch", fetchMock);

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", ENV, OPTS);
    expect(feats).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(offsets).toEqual(["0", "2"]); // second page offset = features so far
  });

  it("stops on a short page when pageSize is reached then under-filled", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => ok(fc(2))) // full page (== pageSize 2)
      .mockImplementationOnce(async () => ok(fc(1))); // short page
    vi.stubGlobal("fetch", fetchMock);

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", ENV, {
      ...OPTS,
      pageSize: 2,
    });
    expect(feats).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchEsriFeatures — retry", () => {
  it("retries a transient HTTP failure and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => fail(503))
      .mockImplementationOnce(async () => ok(fc(1)));
    vi.stubGlobal("fetch", fetchMock);

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", ENV, OPTS);
    expect(feats).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
