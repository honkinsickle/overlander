/**
 * photoUrlOf() — the client-side photo resolver used by the backfill's
 * dry-run preview.
 *
 * WHAT THIS DOES AND DOES NOT GUARD. photoUrlOf() is NOT the writer. The
 * write is done set-based in SQL by backfill_master_place_photo_url()
 * (supabase/migrations/20260821070000). This function exists so the
 * `--dry-run` preview reports the same rows the RPC will touch, so the thing
 * worth testing is that its coalesce chain and its emptiness rules match the
 * SQL's:
 *
 *   coalesce(
 *     nullif(btrim(normalized_payload->'photo'->>'url'), ''),
 *     nullif(btrim(raw_payload->'props'->>'PHOTO_LINK'), ''),
 *     nullif(btrim(raw_payload->'props'->>'Imagelink'), '')
 *   )
 *
 * so: same order, whitespace-only treated as absent, and the result trimmed.
 * A drift between the two shows up as a dry-run that previews a different row
 * set than the apply writes — silent, and exactly the kind of thing nobody
 * notices until a count doesn't reconcile.
 *
 * Follows the backfill-nps-photo.test.ts pattern: import the pure function
 * from the script (whose main() is entrypoint-guarded, so importing it does
 * not run a backfill), no DB, no network.
 */
import { describe, expect, it } from "vitest";

import { photoUrlOf, type SrRow } from "./backfill-master-place-enrichment.ts";

/** Build a source_record row with only the fields photoUrlOf reads. */
function row(over: Partial<SrRow>): SrRow {
  return {
    master_place_id: "00000000-0000-0000-0000-000000000001",
    source_id: "nps",
    external_id: "x",
    source_quality_score: 0.9,
    normalized_payload: null,
    raw_payload: null,
    ...over,
  };
}

const npsPhoto = (url: unknown) => ({ photo: { url, altText: null, credit: null } });

describe("photoUrlOf", () => {
  it("reads normalized_payload.photo.url (the nps/ridb path)", () => {
    expect(
      photoUrlOf(row({ normalized_payload: npsPhoto("https://nps.gov/a.jpg") })),
    ).toBe("https://nps.gov/a.jpg");
  });

  it("reads raw_payload.props.PHOTO_LINK (the blm path)", () => {
    expect(
      photoUrlOf(
        row({ source_id: "blm", raw_payload: { props: { PHOTO_LINK: "https://flickr/b.jpg" } } }),
      ),
    ).toBe("https://flickr/b.jpg");
  });

  it("reads raw_payload.props.Imagelink (the state_parks path)", () => {
    expect(
      photoUrlOf(
        row({
          source_id: "state_parks",
          raw_payload: { props: { Imagelink: "https://parks.wa.gov/c.jpg" } },
        }),
      ),
    ).toBe("https://parks.wa.gov/c.jpg");
  });

  it("returns null when the row carries no photo field at all", () => {
    expect(photoUrlOf(row({}))).toBeNull();
    expect(photoUrlOf(row({ normalized_payload: {}, raw_payload: {} }))).toBeNull();
    expect(photoUrlOf(row({ raw_payload: { props: {} } }))).toBeNull();
  });

  it("returns null for an explicitly null photo object — the common nps/ridb case", () => {
    expect(photoUrlOf(row({ normalized_payload: { photo: null } }))).toBeNull();
    expect(photoUrlOf(row({ normalized_payload: npsPhoto(null) }))).toBeNull();
  });

  // The SQL wraps every branch in nullif(btrim(...), ''), so a whitespace-only
  // value is ABSENT, not a photo. Without this, the preview would count a row
  // the RPC leaves NULL.
  it("treats an empty or whitespace-only value as absent, matching nullif(btrim(...), '')", () => {
    expect(photoUrlOf(row({ normalized_payload: npsPhoto("") }))).toBeNull();
    expect(photoUrlOf(row({ normalized_payload: npsPhoto("   \n\t ") }))).toBeNull();
    expect(photoUrlOf(row({ raw_payload: { props: { PHOTO_LINK: "  " } } }))).toBeNull();
    expect(photoUrlOf(row({ raw_payload: { props: { Imagelink: "" } } }))).toBeNull();
  });

  it("trims the value it returns, matching btrim()", () => {
    expect(photoUrlOf(row({ normalized_payload: npsPhoto("  https://nps.gov/a.jpg\n") }))).toBe(
      "https://nps.gov/a.jpg",
    );
  });

  // Order matters: the SQL coalesce puts normalized photo first, then
  // PHOTO_LINK, then Imagelink. A row carrying more than one must resolve the
  // same way in both.
  it("prefers normalized photo.url over PHOTO_LINK over Imagelink", () => {
    const all = row({
      normalized_payload: npsPhoto("https://norm/1.jpg"),
      raw_payload: { props: { PHOTO_LINK: "https://blm/2.jpg", Imagelink: "https://sp/3.jpg" } },
    });
    expect(photoUrlOf(all)).toBe("https://norm/1.jpg");

    const noNorm = row({
      raw_payload: { props: { PHOTO_LINK: "https://blm/2.jpg", Imagelink: "https://sp/3.jpg" } },
    });
    expect(photoUrlOf(noNorm)).toBe("https://blm/2.jpg");
  });

  // An empty earlier branch must fall through, not short-circuit to null —
  // coalesce(nullif('',''), x) is x, not NULL.
  it("falls through an empty earlier branch to a later non-empty one", () => {
    expect(
      photoUrlOf(
        row({
          normalized_payload: npsPhoto("  "),
          raw_payload: { props: { PHOTO_LINK: "https://blm/2.jpg" } },
        }),
      ),
    ).toBe("https://blm/2.jpg");
    expect(
      photoUrlOf(row({ raw_payload: { props: { PHOTO_LINK: "", Imagelink: "https://sp/3.jpg" } } })),
    ).toBe("https://sp/3.jpg");
  });

  // ->>'url' yields SQL NULL for a non-string JSON value, so a number or an
  // object must not leak through as a url.
  it("ignores non-string values, matching ->>'url' on a non-text node", () => {
    expect(photoUrlOf(row({ normalized_payload: npsPhoto(42) }))).toBeNull();
    expect(photoUrlOf(row({ normalized_payload: npsPhoto({ href: "x" }) }))).toBeNull();
    expect(photoUrlOf(row({ raw_payload: { props: { PHOTO_LINK: 7 } } }))).toBeNull();
  });

  it("does not confuse the blm sibling fields with the photo url", () => {
    // PHOTO_THUMB / PHOTO_TEXT sit alongside PHOTO_LINK on the same 102 blm
    // rows; neither is what the column stores.
    expect(
      photoUrlOf(
        row({
          source_id: "blm",
          raw_payload: {
            props: { PHOTO_THUMB: "https://flickr/t.jpg", PHOTO_TEXT: "A caption" },
          },
        }),
      ),
    ).toBeNull();
  });
});
