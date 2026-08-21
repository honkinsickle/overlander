# "Unnamed ev charging" deactivation — 2026-08-20

TEST only (`znldzjdatkogdktymtvi`). No PROD (`nqzeywzcowujzyegxbsr`) changes
of any kind. Same pattern as the picnic_area deactivation
(`docs/measurements/2026-08-20-unnamed-picnic-area-deactivation.md`) and
Phase 0 peak/spring. New script:
`data/scripts/deactivate-unnamed-ev-charging.ts`.

## 1. Investigate — the actual placeholder pattern (checked, not assumed)

Pulled the full `canonical_name` distribution for all 3,634 `ev_charging`
master_place rows (0 null, 0 empty-string). 388 distinct values. Finding:

**A single literal placeholder string exists** — `"Unnamed ev charging"`,
931 occurrences (25.6% of the category) — matching picnic_area's
single-exact-string shape.

**Everything else in the category is a real name, not a placeholder**,
even where generic-sounding. The distribution is dominated by charging
network/brand names: `"Tesla Supercharger"` (776), `"ChargePoint"` (606),
`"Blink"` (217), `"Electrify America"` (163), `"EVgo"` (106), `"Volta"`
(81), down through operator names, venue-specific strings (`"West Covina
Supercharger"`, `"Sacramento County Yard Level-2 EV Charger"`), and
long-tail unique names. Checked every value down to frequency 1 for
placeholder-shaped candidates beyond the one confirmed string: two rows
read `"Unknown"` — noticed, but left out of scope (not the confirmed exact
literal, and negligible at n=2). No other placeholder convention (generic
codes, numeric-only ids, etc.) was found.

**This is a materially different situation from picnic_area**, and worth
stating plainly rather than forcing a clean parallel: picnic_area's
placeholder covers ~75% of its in-scope rows; ev_charging's covers only
~26% of its category. The NONE-bucket characterization's oft-quoted
"ev_charging 86% placeholder" figure is real but **scoped to the NONE
bucket specifically** (748 of 867 NONE-bucket ev_charging rows), not to the
category as a whole — confirmed here by an exact re-match against that
doc's own numbers (867 / 748 / 119, all reproduced identically in this
pass). Stating this precisely because conflating "86% of NONE-bucket rows"
with "86% of the category" would overstate this task's scope by roughly
3x.

## 2. Count — placeholder rows, NONE-bucket and corpus-wide

Bucketed fresh against current TEST state:

| | n | in-scope | NONE | WEAK | STRONG |
|---|--:|--:|--:|--:|--:|
| Placeholder ("Unnamed ev charging") | 931 | 931 | 748 | 6 | 177 |
| Real-named (everything else) | 2,703 | 2,703 | 119 | 4 | 2,580 |
| **Total ev_charging** | **3,634** | 3,634 | 867 | 10 | 2,757 |

867 in-scope NONE-bucket total exactly matches the characterization doc's
figure — no corpus drift on this category since that pass.

## 3. What's being left alone

**2,703 real-named rows** (any bucket) — untouched entirely; not a
placeholder, out of scope by the task's own definition.

**183 placeholder-named rows excluded despite matching the literal
string** — 177 STRONG-bucket + 6 WEAK-bucket. These carry the placeholder
display name but have real signal from another attached source (website,
description, or meaningful tags), matching the same exclusion the
picnic_area pass applied. Deactivating these would destroy real corpus
signal purely because the display name is a stub.

**Target set: 748** — placeholder-named AND NONE-bucket, the intersection
matching both "no real name" and "no other real signal."

## 4. Deactivate

Same three-step mechanism as `deactivate-unnamed-picnic-area.ts` /
`deactivate-peak-spring.ts` — `source_record.is_active = false` on every
active source attached to a target master_place, `recompute_master_place()`
on each, dangling `pending` `place_match` cleanup. Applied to TEST:

```
deactivated 748 source_records
recompute done. ok=748 failed=0
cleared 0 dangling pending place_match rows
```

0 recompute failures. 0 dangling `place_match` rows (same shape as
picnic_area — single-active-source rows, not multi-sourced-with-pending-
siblings).

## 5/6. Verify — before/after and generation exclusion

| | Before | After |
|---|--:|--:|
| source_count = 0 (of the 931 placeholder set) | 0 | 748 |
| source_count > 0 | 931 | 183 (exactly the 177 STRONG + 6 WEAK excluded) |
| is_searchable = false | 0 | 0 (untouched, matches the established pattern) |

**Search/browse exclusion:** 0 of the 748 now-zeroed rows appear in
`master_place_search_export`.

**Generation exclusion:** spot-checked 5 of the newly-deactivated rows
directly against the live `pois_along_corridor` RPC (tight 5km-buffer route
built around each row's own coordinates, filtered to `ev_charging`):
**0 of 5 appeared.**

## Confirmed scope

- **TEST only.** No `--confirm`/PROD path in this script.
- **No code changes beyond the one new script.** No `eligibility.ts`
  changes, no migration.
- 177 STRONG + 6 WEAK placeholder-named rows left active — real signal
  preserved.
- 2,703 real-named rows (any bucket) left entirely untouched — not a
  placeholder, out of scope.
- 2 rows reading `"Unknown"` noted but deliberately not treated as a
  confirmed placeholder — out of scope, negligible population.
