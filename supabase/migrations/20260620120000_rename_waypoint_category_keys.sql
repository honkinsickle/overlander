-- Rename waypoint Category data keys in trip payload jsonb:
--   "mountain" -> "scenic", "neutral" -> "interest"
--
-- Pairs with the code-side rename (branch data/category-key-rename). The
-- `Waypoint.category` value is persisted inside `payload jsonb` at
-- days[].waypoints[].category, in BOTH:
--   * reference_trips  — canonical seeds (e.g. la-to-deadhorse)
--   * trips            — user trips, which copy the reference payload verbatim
--                        at fork time, so they hold their own category copies.
--
-- Operates on the canonical jsonb text form `"category": "mountain"` (space
-- after the colon) — confirmed empirically on the test project; both columns
-- are jsonb, so Postgres always serializes to this canonical form.
--
-- Idempotent + guarded: the WHERE clause skips rows with no occurrences, and
-- re-running after a successful apply is a no-op (no "mountain"/"neutral"
-- category values remain to match). The scoped pattern only touches the
-- `category` field — prose containing the words "mountain"/"neutral" in
-- title/description/notes is untouched.

UPDATE reference_trips
SET payload = replace(
                replace(payload::text, '"category": "mountain"', '"category": "scenic"'),
                '"category": "neutral"', '"category": "interest"'
              )::jsonb
WHERE payload::text LIKE '%"category": "mountain"%'
   OR payload::text LIKE '%"category": "neutral"%';

UPDATE trips
SET payload = replace(
                replace(payload::text, '"category": "mountain"', '"category": "scenic"'),
                '"category": "neutral"', '"category": "interest"'
              )::jsonb
WHERE payload::text LIKE '%"category": "mountain"%'
   OR payload::text LIKE '%"category": "neutral"%';
