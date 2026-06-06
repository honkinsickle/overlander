#!/usr/bin/env node
// test-bc-wfs.mjs — read-only probe of the DataBC Rec Sites POLY WFS layer.
// Validates the WFS adapter approach: schema discovery + 3 spatial-filter
// trials + sample-feature axis check. Zero deps, Node 18+ (global fetch).

const BASE =
  "https://openmaps.gov.bc.ca/geo/pub/WHSE_FOREST_TENURE.FTEN_RECREATION_POLY_SVW/ows";
const TYPE = "WHSE_FOREST_TENURE.FTEN_RECREATION_POLY_SVW";
const WKT = "POLYGON((-121 50,-119 50,-119 51,-121 51,-121 50))";
const UA = "overlander-wfs-probe/1.0 (read-only schema validation)";

function hr(title) {
  console.log("\n" + "=".repeat(72) + "\n" + title + "\n" + "=".repeat(72));
}

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json,text/xml,*/*" },
      signal: ctrl.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, ctype: res.headers.get("content-type") || "", body };
  } finally {
    clearTimeout(t);
  }
}

function buildUrl(params) {
  const u = new URL(BASE);
  for (const [k, v] of params) u.searchParams.append(k, v);
  return u.toString();
}

// ── 1. DescribeFeatureType ──────────────────────────────────────────────
async function describe() {
  let columns = []; // { name, type }
  let mode = "";

  // Try JSON schema first.
  const jsonUrl = buildUrl([
    ["service", "WFS"],
    ["version", "2.0.0"],
    ["request", "DescribeFeatureType"],
    ["typeName", TYPE],
    ["typeNames", TYPE],
    ["outputFormat", "application/json"],
  ]);
  const jr = await get(jsonUrl);
  let parsed = false;
  if (jr.ok && /json/i.test(jr.ctype)) {
    try {
      const j = JSON.parse(jr.body);
      const props = j?.featureTypes?.[0]?.properties;
      if (Array.isArray(props) && props.length) {
        columns = props.map((p) => ({
          name: p.name,
          type: p.type || p.localType || "",
        }));
        mode = "JSON (outputFormat=application/json)";
        parsed = true;
      }
    } catch {
      /* fall through to XSD */
    }
  }

  // Fall back to XSD scrape.
  if (!parsed) {
    const xsdUrl = buildUrl([
      ["service", "WFS"],
      ["version", "2.0.0"],
      ["request", "DescribeFeatureType"],
      ["typeName", TYPE],
      ["typeNames", TYPE],
    ]);
    const xr = await get(xsdUrl);
    mode = "XSD scrape (XML)" + (jr.ok ? " [JSON form unusable]" : ` [JSON form HTTP ${jr.status}]`);
    // Match <xsd:element name="X" type="Y" .../> within the complexType seq.
    const re = /<(?:xsd:|xs:)?element\b[^>]*\bname="([^"]+)"[^>]*\btype="([^"]+)"[^>]*>/gi;
    let m;
    while ((m = re.exec(xr.body)) !== null) {
      const name = m[1];
      const type = m[2];
      // Skip the top-level feature element + the substitutionGroup wrapper.
      if (/_Type$|FeatureType$/i.test(type) && /^WHSE|SVW$/i.test(name)) continue;
      columns.push({ name, type });
    }
    // De-dupe (the feature element can appear twice).
    const seen = new Set();
    columns = columns.filter((c) => {
      const k = c.name + "|" + c.type;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const geom = columns.find((c) => /^gml:|gml:.*PropertyType|PropertyType$/i.test(c.type) || /^geometry$/i.test(c.localType || "") || /SurfaceProperty|GeometryProperty|MultiSurface|MultiPolygon|Geometry$/i.test(c.type));
  const geomField = geom ? geom.name : "NOT FOUND";
  const oid = columns.find((c) => /^objectid$/i.test(c.name));
  const oidField = oid ? oid.name : "NOT FOUND";

  hr("1) DescribeFeatureType");
  console.log("source     : " + mode);
  console.log("geomField  : " + geomField + (geom ? `  (type=${geom.type})` : ""));
  console.log("oidField   : " + oidField + (oid ? `  (type=${oid.type})` : ""));
  console.log("columns    : " + columns.length + " total");
  for (const c of columns) console.log(`   - ${c.name}  :: ${c.type}`);

  return { geomField, oidField, columns };
}

// ── 2. GetFeature trials ────────────────────────────────────────────────
function firstCoord(geom) {
  let a = geom?.coordinates;
  while (Array.isArray(a) && Array.isArray(a[0])) a = a[0];
  return Array.isArray(a) ? a : null;
}

async function trial(label, geomField, cqlFilter, srsName) {
  const url = buildUrl([
    ["service", "WFS"],
    ["version", "2.0.0"],
    ["request", "GetFeature"],
    ["typeName", TYPE],
    ["typeNames", TYPE],
    ["outputFormat", "json"],
    ["count", "2"],
    ["sortBy", "OBJECTID"],
    ["srsName", srsName],
    ["cql_filter", cqlFilter],
  ]);

  const r = await get(url);
  let pass = false;
  let count = 0;
  let numberMatched = "?";
  let detail = "";
  let features = null;

  if (!r.ok) {
    detail = `HTTP ${r.status}`;
  } else {
    try {
      const j = JSON.parse(r.body);
      if (j && Array.isArray(j.features)) {
        features = j.features;
        count = j.features.length;
        numberMatched = j.numberMatched ?? j.totalFeatures ?? "?";
        pass = count > 0;
        if (!pass) detail = "0 features";
      } else if (j?.exceptions || j?.exceptionReport) {
        detail = "OWS exception: " + JSON.stringify(j.exceptions || j.exceptionReport).slice(0, 200);
      } else {
        detail = "no features array";
      }
    } catch {
      // Likely an XML ExceptionReport.
      const ex = /<(?:ows:)?ExceptionText>([\s\S]*?)<\/(?:ows:)?ExceptionText>/i.exec(r.body);
      detail = "non-JSON response" + (ex ? `: ${ex[1].trim().slice(0, 200)}` : ` (ctype=${r.ctype})`);
    }
  }

  console.log(
    `\n[${label}] ${pass ? "PASS" : "FAIL"}  features=${count}  numberMatched=${numberMatched}` +
      (detail ? `  (${detail})` : "")
  );
  console.log("   cql_filter: " + cqlFilter);
  console.log("   srsName   : " + srsName);
  return { label, pass, features };
}

async function trials(geomField) {
  hr("2) GetFeature trials (v2.0.0, outputFormat=json, count=2, sortBy=OBJECTID)");
  const out = [];
  out.push(
    await trial(
      "a INTERSECTS SRID=4326;wkt / srs=EPSG:4326 [adapter default]",
      geomField,
      `INTERSECTS(${geomField}, SRID=4326;${WKT})`,
      "EPSG:4326"
    )
  );
  out.push(
    await trial(
      "b BBOX / srs=EPSG:4326 [fallback]",
      geomField,
      `BBOX(${geomField}, -121,50,-119,51,'EPSG:4326')`,
      "EPSG:4326"
    )
  );
  out.push(
    await trial(
      "c INTERSECTS plain wkt / srs=urn CRS84",
      geomField,
      `INTERSECTS(${geomField}, ${WKT})`,
      "urn:ogc:def:crs:OGC:1.3:CRS84"
    )
  );
  return out;
}

// ── 3. Sample feature ───────────────────────────────────────────────────
function sample(trialResults) {
  hr("3) Sample feature (from first PASSing trial)");
  const win = trialResults.find((t) => t.pass && t.features && t.features.length);
  if (!win) {
    console.log("No passing trial — cannot sample a feature.");
    return null;
  }
  const f = win.features[0];
  console.log("winning trial : " + win.label);
  console.log("id            : " + (f.id ?? "(none)"));
  const fc = firstCoord(f.geometry);
  console.log("geometry type : " + (f.geometry?.type ?? "(none)"));
  console.log(
    "first coord   : " +
      (fc ? `[${fc[0]}, ${fc[1]}]` : "(none)") +
      (fc ? `   -> x=${fc[0]} (lon?), y=${fc[1]} (lat?)` : "")
  );
  console.log("properties    :");
  const props = f.properties || {};
  for (const k of Object.keys(props)) console.log(`   ${k} = ${JSON.stringify(props[k])}`);
  return { win, firstCoord: fc };
}

// ── main ────────────────────────────────────────────────────────────────
(async () => {
  console.log("DataBC WFS probe — " + TYPE);
  console.log("base: " + BASE);
  const { geomField, oidField } = await describe();
  if (geomField === "NOT FOUND") {
    console.log("\nABORT: geometry field not discovered; cannot build spatial filters.");
    process.exit(2);
  }
  const tr = await trials(geomField);
  const s = sample(tr);

  // VERDICT
  hr("VERDICT");
  const winning = tr.find((t) => t.pass);
  console.log(
    "winning spatial form : " +
      (winning ? winning.label.split(" ")[0] : "NONE PASSED")
  );
  if (winning) {
    const flip = winning.label.startsWith("a")
      ? "NO — adapter default (a) wins; keep it."
      : `YES — adapter default (a) did not win; flip to form ${winning.label.split(" ")[0]}.`;
    console.log("adapter default flip : " + flip);
  } else {
    console.log("adapter default flip : N/A (no form passed)");
  }
  console.log("geomField            : " + geomField);
  console.log(
    "oidField             : " +
      oidField +
      (oidField === "NOT FOUND"
        ? "  -> FLAG: keyset pagination needs a PK fallback"
        : "")
  );
  if (s && s.win) {
    const props = s.win.features[0].properties || {};
    const keys = Object.keys(props);
    const nameCols = keys.filter((k) => /name|title|label/i.test(k));
    const subtypeCols = keys.filter((k) => /type|subtype|class|categ|use|status|feature/i.test(k));
    console.log("candidate name cols  : " + (nameCols.join(", ") || "(none obvious)"));
    console.log("candidate subtype    : " + (subtypeCols.join(", ") || "(none obvious)"));
    const fc = s.firstCoord;
    const lonlat =
      fc && fc[0] >= -180 && fc[0] <= -100 && fc[1] >= 40 && fc[1] <= 65;
    console.log(
      "coords are lon/lat   : " +
        (fc
          ? lonlat
            ? `YES (x=${fc[0]} in BC lon range, y=${fc[1]} in BC lat range)`
            : `UNCLEAR (first=[${fc[0]}, ${fc[1]}])`
          : "UNKNOWN (no coord)")
    );
  } else {
    console.log("candidate name cols  : N/A (no sample)");
    console.log("candidate subtype    : N/A (no sample)");
    console.log("coords are lon/lat   : N/A (no sample)");
  }
})().catch((e) => {
  console.error("FATAL: " + (e?.stack || e));
  process.exit(1);
});
