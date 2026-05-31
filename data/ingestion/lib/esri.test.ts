/**
 * Unit tests for the shared ESRI REST query helper. `fetch` is mocked — no
 * network. Covers query construction, exceededTransferLimit + short-page
 * pagination, and retry recovery.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchEsriFeatures } from "./esri.ts";

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
const OPTS = { where: "TYPE IN ('PP')", label: "test_src", userAgent: "ua/1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchEsriFeatures — query construction", () => {
  it("builds the ESRI envelope query with outSR=4326 + f=geojson", async () => {
    const calls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        calls.push(url);
        return ok(fc(1)); // short page, no exceeded flag → terminates
      }),
    );

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", BBOX, OPTS);
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

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", BBOX, OPTS);
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

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", BBOX, {
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

    const feats = await fetchEsriFeatures("https://x/FeatureServer/0", BBOX, OPTS);
    expect(feats).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
