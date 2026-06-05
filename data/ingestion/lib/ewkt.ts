/**
 * EWKT geometry serializers for client-side batched upserts.
 *
 * Batched writes go through PostgREST `.upsert(rows)`, which builds the INSERT
 * via `json_populate_recordset` — that path runs each value through the column
 * type's input function. PostGIS `geometry` input accepts EWKT
 * ("SRID=4326;POINT(...)") directly, so we serialize geometry to EWKT here
 * instead of relying on a per-row RPC. Pure + unit-tested.
 */

const SRID = 4326;

/** Format a coordinate pair as "lng lat" with no exponential notation. */
function coordPair(c: readonly number[]): string {
  return `${c[0]} ${c[1]}`;
}

/** [lng, lat] → EWKT "SRID=4326;POINT(lng lat)". */
export function pointEwkt(point: readonly [number, number]): string {
  return `SRID=${SRID};POINT(${coordPair(point)})`;
}

/**
 * MultiLineString coordinates (array of lines, each an array of [lng,lat]) →
 * EWKT "SRID=4326;MULTILINESTRING((lng lat,...),(...))". Throws on empty input
 * (an empty geometry is never a valid mvum route).
 */
export function multiLineStringEwkt(lines: ReadonlyArray<ReadonlyArray<readonly number[]>>): string {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("multiLineStringEwkt: empty MultiLineString");
  }
  const body = lines
    .map((line) => {
      if (!Array.isArray(line) || line.length === 0) {
        throw new Error("multiLineStringEwkt: empty line in MultiLineString");
      }
      return `(${line.map(coordPair).join(",")})`;
    })
    .join(",");
  return `SRID=${SRID};MULTILINESTRING(${body})`;
}
