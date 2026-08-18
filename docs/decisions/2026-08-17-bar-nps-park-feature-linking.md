# 2026-08-17 — Matcher bars `nps:park_feature` from linking (forces `new_master_place`)

[PR #234](https://github.com/honkinsickle/overlander/pull/234) (`534e74c`),
**merged to `main`**. Closes the park_feature-linking corruption found while
scoping the six-state NPS materialize.

## Context

The six-state NPS ingest (5,283 `source_record`, `[queried TEST 2026-08-17]`)
made **`park_feature`** the largest category by far — **4,235 rows**, ~80% of
all NPS `/places`. NPS `/places` is an **editorial CMS, not a POI catalog**:
every record is a content card with `bodyText` + `images`, so a picnic area and
a fossil label share one schema, and no field cleanly separates a physical site
from interpretive content (the two best candidate signals — `isMapPinHidden`
and title patterns — disagree on ~250 of 900 sampled rows `[queried TEST
2026-08-17]`; a 50-row read showed roughly half are real destinations). So
`park_feature` carries thousands of interpretive stops, wayside signs, audio-tour
panels, and fossil labels alongside the real pullouts and historic buildings.

A pre-guard dry run measured the damage: **all 103 `park_feature` auto-links came
through `fed_exact`** `[measured 2026-08-17]` — zero via `name_dominant` or the
blended fallback. **`fed_exact` (`matchOne` Step 1) is category-blind and
name-blind within 10 m:** it links an NPS record to any federal (ridb-seeded)
master_place within 10 m by coordinate alone, ignoring the name entirely. That is
how **11 fossil-specimen labels collapsed onto the one "Quarry Exhibit Hall"
master_place**, and — because NPS is `field_precedence` **priority 1** on
`canonical_name` — precedence then renamed the hall to a dinosaur species. This is
a whole *class* of corruption: any editorial card sitting within 10 m of a real
federal place would absorb into it and overwrite its name.

## Decision

A new module const and a single guard at the **top of `matchOne`, before Step 1
`fed_exact`** (`data/entity-resolution/matcher.ts`):

```
LINKING_BARRED = new Set(["nps:park_feature"])   // keyed `${source_id}:${inferred_category}`
```

A barred `source_record` **skips the entire waterfall and becomes its own
`new_master_place`.** It is scoped to exactly the one source+category pair; the
other six NPS categories and every other source are untouched.

### Why force `new_master_place`, not just bar `auto_link`

Barring only `auto_link` is insufficient. A within-10 m `park_feature` with
`name_sim ≈ 0` would fall through to Step 5 `blended_residual` and land as
`manual_review` — queue growth, not corpus. Forcing `new_master_place` at the top
**also bars `amenity_rollup` and `manual_review`** in one stroke: a barred record
can never link to an *existing* master_place, so it can never win precedence over
an existing name, and it never queues. `park_feature` is not an `AMENITY_TYPE`
today, but the force-new form closes that path regardless.

### Why a source+category pair, not a fix to `fed_exact`

`fed_exact` is category-blind by design and that is usually **correct** — it is
the NPS↔RIDB campground bridge (a bookable campground within 10 m of its
recreation.gov twin *should* auto-link at confidence 1.0). Disabling or
name-gating `fed_exact` globally would alter ER for every source and break the
campground bridge — the wrong blast radius. The defect is not `fed_exact`; it is
that **one category's data is editorial content that should never participate in
coordinate matching at all.** So the fix is scoped to the data, not the
mechanism. The general "`fed_exact` is category-blind and name-blind" observation
is recorded in `BACKLOG.md` as a separate, open matcher question.

## Consequences

- **Dry run (7 NPS categories, 5,200 rows):** `park_feature` went **103
  auto_link → 0**, 908 manual_review → 0, all **4,182 → new_master_place**
  `[measured 2026-08-17]`. The five clustering master_places that the `>3-new-SRs`
  flag caught (Quarry Exhibit Hall ×11, Lands End Lookout VC ×9, Arches VC ×8,
  Rosie the Riveter ×8, Foothills VC ×5) all dropped to ≤1.
- **Live materialize confirmed zero linkage `[queried TEST 2026-08-17]`,
  measured not asserted:** among master_places holding an `nps:park_feature`
  source, **max `source_count` = 1**, **0** have `source_count > 1`, **max 1
  park_feature SR per MP**, and **4,225 distinct MPs == 4,225 rows** — every
  `park_feature` is its own place, linked to nothing.
- **Renames dropped correctly.** The pre-guard dry run predicted **216**
  canonical renames; guarded it predicted **121**; **103 actually landed**
  `[queried TEST 2026-08-17, measured against the actual 272 shared target MPs]`,
  and **zero originate from `park_feature`**. The remaining 103 are the six clean
  categories' real NPS naming authority (RIDB casing fixes, `Rv Park → RV Park`,
  campground specificity).
- **The dry-run report's `primary_category` prediction is a proxy artifact —
  0 landed, correctly.** The report compares NPS `inferred_category` to the MP's
  `primary_category`, but `recompute_master_place` resolves `primary_category`
  from `normalized_payload.primary_category`, which the **NPS ingester never
  populates**. Confirmed at write time: **0** master_places carry
  `attribution.primary_category == 'nps'` `[queried TEST 2026-08-17]`. So NPS
  cannot recategorize an existing MP; the report's "56 category changes" was
  never going to land. This will mislead again — see `BACKLOG.md`.
- **A separate, non-matcher defect handled the 9 `park`-category renames.** The
  9 `nps:park` boundary rows (`"Alcatraz Island" → "NPS park boundary: alca"`,
  etc.) were a *different* mechanism — the ingester skipped `/parks`, so park rows
  got a synthetic name — and the guard deliberately leaves `nps:park` alone (a
  boundary *should* link to and name its park). Fixed by wiring `/parks`
  ([#235](https://github.com/honkinsickle/overlander/pull/235)); after that, all 9
  are no-ops (the real NPS `fullName` matches the RIDB MP name). See STATE.md.
- **Tests + verification.** Four cases in `matcher.test.ts`: `nps:park_feature`
  + federal candidate within 10 m → new (not fed_exact); `nps:campground` + same
  → still fed_exact (no over-reach); `nps:park_feature` + close non-federal → new
  (not manual_review); `ridb:park_feature` + federal → still fed_exact (other
  sources unaffected). Integrity checked by **neutering** the guard (park_feature
  tests go red) and by **over-reaching** the set to `ridb:park_feature` (the
  negative test goes red). Full data suite 369/3.
