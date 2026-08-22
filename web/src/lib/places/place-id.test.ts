/**
 * Canonical place-id normalization.
 *
 * This is the piece the ADR calls out as needing "an explicit normalization
 * step, not just a rename", and the piece most likely to have edge cases —
 * so it is tested exhaustively rather than incidentally.
 *
 * Run: cd web && npx tsx --test src/lib/places/place-id.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizePlaceId,
  googlePlaceId,
  googlePlaceIdOf,
  isUuid,
  masterPlaceId,
  masterPlaceUuid,
  parsePlaceId,
  partitionPlaceIds,
  samePlaceId,
  toCanonicalString,
} from "./place-id";

const UUID = "531b1c71-96f2-4002-bc4e-cc1b6db49dc1";
const UUID2 = "7af6a3d1-3a16-479c-926e-3eee7a2ba65c";
const GID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

// ── the ADR's two named requirements ─────────────────────────────────

test("mp:<uuid> and a bare <uuid> resolve to the SAME canonical id", () => {
  assert.equal(canonicalizePlaceId(`mp:${UUID}`), canonicalizePlaceId(UUID));
  assert.ok(samePlaceId(`mp:${UUID}`, UUID));
  assert.deepEqual(parsePlaceId(`mp:${UUID}`), parsePlaceId(UUID));
});

test("a google_place_id stays DISTINCT from a master_place id", () => {
  assert.ok(!samePlaceId(`gpl/${GID}`, `mp:${UUID}`));
  assert.ok(!samePlaceId(GID, UUID));
  assert.notEqual(canonicalizePlaceId(`gpl/${GID}`), canonicalizePlaceId(`mp:${UUID}`));
});

test("a federated place carrying a placeId keeps its mp: identity — the Google id is an attribute, not the identity", () => {
  // The corridor RPC hands back a master_place that happens to have a google
  // source. Its id must stay mp:, and must not collide with the live Google
  // result for the same physical place.
  const federated = parsePlaceId(`mp:${UUID}`);
  const liveGoogle = parsePlaceId(`gpl/${GID}`);
  assert.equal(federated.kind, "master_place");
  assert.equal(liveGoogle.kind, "live");
  assert.notEqual(toCanonicalString(federated), toCanonicalString(liveGoogle));
});

// ── master_place forms ────────────────────────────────────────────────

test("bare uuid → master_place", () => {
  assert.deepEqual(parsePlaceId(UUID), { kind: "master_place", uuid: UUID });
  assert.equal(canonicalizePlaceId(UUID), `mp:${UUID}`);
});

test("uuid case is normalized to lowercase, and the mp: prefix is case-insensitive", () => {
  // uuid hex is case-insensitive and Postgres emits lowercase, so all four of
  // these are the same row.
  const forms = [UUID, UUID.toUpperCase(), `mp:${UUID.toUpperCase()}`, `MP:${UUID}`];
  const canon = forms.map(canonicalizePlaceId);
  assert.deepEqual(new Set(canon), new Set([`mp:${UUID}`]));
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(canonicalizePlaceId(`  mp:${UUID}  `), `mp:${UUID}`);
  assert.equal(canonicalizePlaceId(`\t${UUID}\n`), `mp:${UUID}`);
});

test("mp: with a non-uuid body is opaque, NOT a master_place", () => {
  // Minting a master_place id that can never resolve would turn a typo into a
  // silent empty result; opaque keeps it distinguishable.
  for (const bad of ["mp:not-a-uuid", "mp:12345", "mp:", `mp:${UUID}-extra`]) {
    assert.equal(parsePlaceId(bad).kind, "opaque", bad);
  }
});

test("a double mp: prefix is opaque, not unwrapped", () => {
  assert.equal(parsePlaceId(`mp:mp:${UUID}`).kind, "opaque");
});

test("masterPlaceId() builds from a uuid and refuses a non-uuid without throwing", () => {
  assert.deepEqual(masterPlaceId(UUID), { kind: "master_place", uuid: UUID });
  assert.deepEqual(masterPlaceId(UUID.toUpperCase()), { kind: "master_place", uuid: UUID });
  assert.equal(masterPlaceId("nope").kind, "opaque");
});

// ── live forms ────────────────────────────────────────────────────────

test("every live adapter prefix parses to its SourceId — and the prefix is NOT the SourceId", () => {
  const cases: Array<[string, string]> = [
    [`gpl/${GID}`, "google"],
    ["fsq/4b0588f0f964a520d1", "foursquare"],
    ["ridb/232447", "rec-gov"],
    ["usfs/44717", "usfs"],
    ["blm/8812", "blm"],
    ["node/358804431", "osm"],
  ];
  for (const [raw, source] of cases) {
    const id = parsePlaceId(raw.trim());
    assert.equal(id.kind, "live", raw);
    if (id.kind === "live") assert.equal(id.source, source, raw);
  }
});

test("live external ids are NEVER case-folded — Google/Foursquare ids are case-sensitive", () => {
  const id = parsePlaceId(`gpl/${GID}`);
  assert.equal(id.kind, "live");
  if (id.kind === "live") assert.equal(id.externalId, GID);
  // Round-trip preserves the exact casing.
  assert.equal(canonicalizePlaceId(`gpl/${GID}`), `gpl/${GID}`);
  // Two ids differing only in case are DIFFERENT places.
  assert.ok(!samePlaceId(`gpl/${GID}`, `gpl/${GID.toLowerCase()}`));
});

test("the live PREFIX is matched case-insensitively even though the body is not", () => {
  assert.equal(canonicalizePlaceId(`GPL/${GID}`), `gpl/${GID}`);
});

test("a live id whose external id contains a COLON still parses as live", () => {
  // Regression. The obvious parser checks `:` before `/`, which reads
  // `fsq/abc:def` as a colon-scheme id with prefix `fsq/abc`, fails the `mp`
  // test, and silently returns opaque — an unresolvable id with no error.
  // Scheme is decided by whichever separator comes FIRST. External ids are
  // opaque third-party tokens; nothing promises they avoid `:`.
  const id = parsePlaceId("fsq/4b0588f0f964a520d1:extra");
  assert.equal(id.kind, "live");
  if (id.kind === "live") {
    assert.equal(id.source, "foursquare");
    assert.equal(id.externalId, "4b0588f0f964a520d1:extra");
  }
  assert.equal(canonicalizePlaceId("fsq/a:b"), "fsq/a:b");
  // …and the converse still holds: a colon BEFORE any slash is the mp scheme.
  assert.equal(parsePlaceId(`mp:${UUID}`).kind, "master_place");
  assert.equal(parsePlaceId("mp:a/b").kind, "opaque");
});

test("only the FIRST slash splits — an external id may contain slashes", () => {
  const id = parsePlaceId("fsq/abc/def/ghi");
  assert.equal(id.kind, "live");
  if (id.kind === "live") assert.equal(id.externalId, "abc/def/ghi");
  assert.equal(canonicalizePlaceId("fsq/abc/def/ghi"), "fsq/abc/def/ghi");
});

test("an unknown prefix, or an empty body, is opaque", () => {
  for (const bad of ["wat/123", "gpl/", "fsq/", "/123", "node/"]) {
    assert.equal(parsePlaceId(bad).kind, "opaque", bad);
  }
});

// ── google_place, only via the explicit constructor ───────────────────

test("a bare Google place id is NOT inferred — it is opaque until constructed explicitly", () => {
  // Guessing "unprefixed non-uuid ⇒ Google" would mis-type every future id
  // scheme. The caller knows what it holds; it must say so.
  assert.equal(parsePlaceId(GID).kind, "opaque");
  assert.equal(googlePlaceId(GID).kind, "google_place");
});

test("googlePlaceId() canonicalises to the SAME string as the live Google form", () => {
  // Deliberate convergence: BrowsePlace.placeId (bare) and BrowsePlace.id
  // (gpl/…) are two spellings of one identity.
  assert.equal(toCanonicalString(googlePlaceId(GID)), `gpl/${GID}`);
  assert.equal(toCanonicalString(googlePlaceId(GID)), canonicalizePlaceId(`gpl/${GID}`));
});

test("googlePlaceId('') is opaque, not an empty google id", () => {
  assert.equal(googlePlaceId("").kind, "opaque");
  assert.equal(googlePlaceId("   ").kind, "opaque");
});

// ── accessors used at the DB / API boundary ───────────────────────────

test("masterPlaceUuid() yields the BARE uuid — never the mp: form — and null otherwise", () => {
  assert.equal(masterPlaceUuid(parsePlaceId(`mp:${UUID}`)), UUID);
  assert.equal(masterPlaceUuid(parsePlaceId(UUID)), UUID);
  assert.equal(masterPlaceUuid(parsePlaceId(`gpl/${GID}`)), null);
  assert.equal(masterPlaceUuid(googlePlaceId(GID)), null);
});

test("googlePlaceIdOf() yields the bare Google id from BOTH spellings, null otherwise", () => {
  assert.equal(googlePlaceIdOf(parsePlaceId(`gpl/${GID}`)), GID);
  assert.equal(googlePlaceIdOf(googlePlaceId(GID)), GID);
  assert.equal(googlePlaceIdOf(parsePlaceId(`mp:${UUID}`)), null);
  // A non-Google live source is not a Google place.
  assert.equal(googlePlaceIdOf(parsePlaceId("fsq/xyz")), null);
});

// ── degenerate input never throws ─────────────────────────────────────

test("empty / whitespace / punctuation input is opaque and preserved verbatim", () => {
  for (const raw of ["", "   ", ":", "/", "::", "//", "mp", "gpl"]) {
    const id = parsePlaceId(raw);
    assert.equal(id.kind, "opaque", JSON.stringify(raw));
    assert.equal(toCanonicalString(id), raw, JSON.stringify(raw));
  }
});

test("a non-mp colon scheme is left alone rather than claimed", () => {
  assert.equal(parsePlaceId("osm:node:123").kind, "opaque");
  assert.equal(canonicalizePlaceId("osm:node:123"), "osm:node:123");
});

// ── idempotence ───────────────────────────────────────────────────────

test("canonicalization is idempotent for every form", () => {
  const inputs = [
    UUID, `mp:${UUID}`, `MP:${UUID.toUpperCase()}`, `gpl/${GID}`, "fsq/abc",
    "ridb/1", "usfs/2", "blm/3", "node/4", "", "garbage", "mp:bad", "wat/1",
  ];
  for (const raw of inputs) {
    const once = canonicalizePlaceId(raw);
    assert.equal(canonicalizePlaceId(once), once, raw);
  }
});

test("isUuid accepts any RFC-4122 shape and rejects near-misses", () => {
  assert.ok(isUuid(UUID));
  assert.ok(isUuid(UUID.toUpperCase()));
  // Version/variant nibbles are deliberately unconstrained — a v1/v7 id is
  // still a valid master_place key.
  assert.ok(isUuid("00000000-0000-1000-8000-000000000000"));
  for (const bad of [
    "", UUID.replace(/-/g, ""), `${UUID}x`, UUID.slice(0, -1),
    "531b1c71_96f2_4002_bc4e_cc1b6db49dc1", "zzzzzzzz-96f2-4002-bc4e-cc1b6db49dc1",
  ]) {
    assert.ok(!isUuid(bad), bad);
  }
});

// ── partitioning, the `ids` scope's dispatcher ────────────────────────

test("partitionPlaceIds splits mixed forms and dedupes across spellings", () => {
  const out = partitionPlaceIds([
    `mp:${UUID}`,
    UUID, // same place, other spelling — must NOT double-count
    UUID.toUpperCase(), // and again
    UUID2,
    `gpl/${GID}`,
    "fsq/abc",
    "garbage",
  ]);
  assert.deepEqual(out.masterPlaceUuids, [UUID, UUID2]);
  assert.deepEqual(out.googlePlaceIds, [GID]);
  assert.equal(out.other.length, 2); // fsq + garbage
  assert.deepEqual(
    out.other.map((o) => o.kind),
    ["live", "opaque"],
  );
});

test("partitionPlaceIds preserves first-seen order and drops nothing", () => {
  const out = partitionPlaceIds([UUID2, UUID]);
  assert.deepEqual(out.masterPlaceUuids, [UUID2, UUID]);
  const empty = partitionPlaceIds([]);
  assert.deepEqual(empty.masterPlaceUuids, []);
  assert.deepEqual(empty.googlePlaceIds, []);
  assert.deepEqual(empty.other, []);
});

test("partitionPlaceIds hands the BARE uuid to the DB layer, not the mp: form", () => {
  // hydratePlacesByIds and every Supabase .in() filter want the bare uuid.
  const out = partitionPlaceIds([`mp:${UUID}`]);
  assert.deepEqual(out.masterPlaceUuids, [UUID]);
  assert.ok(!out.masterPlaceUuids[0].startsWith("mp:"));
});
