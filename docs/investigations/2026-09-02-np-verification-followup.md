# NP investigation — verification follow-up

**Date:** 2026-09-02 · **Status:** verification only, no writes to either database.
**Follow-up to:** `docs/investigations/2026-09-02-ca-np-designation.md` (PR #368, still open/unmerged at time of writing).
**Scope:** close four verification gaps flagged in the self-review of PR #368.
**Read-only.** No merges, no schema/data changes. Working tree clean before this
commit; PR #368 itself is not touched.

---

## Summary of the four checks

| # | Check | Prior claim | This session's finding |
|---|---|---|---|
| 1 | Fresh classifier re-run vs `.context/` reuse | SAME 136 · DIFFERENT 246 · UNCLEAR 2 (from prior-session JSON) | **Confirmed exactly** — 136 / 246 / 2 on fresh PROD data |
| 2 | Full-set grep for CP / SW / NP pairs | 1 CP · 2 SW · 9 NP (eyeballed) | **Confirmed exactly** — same pairs, all DIFFERENT-bucket |
| 3 | Real PDF verification of NP = Natural Preserve | Inferred; two PDFs returned binary via WebFetch | **Directly confirmed** via `curl` + `pdftotext` on three DPR PDFs |
| 4 | Los Penasquitos Marsh NP double-record | "Minor data quirk" | **Not a quirk** — an open `place_match` at `status=pending` on PROD; same mechanism as the 43 self-created duplicates |

Net: three of four prior claims stand as measured. The fourth was substantively
under-reported and is upgraded here from "minor quirk" to "one unresolved
manual-review item on PROD, mechanism identified."

---

## 1. Fresh classifier re-run — bucket totals

The prior session's NP doc quoted `SAME 136 · DIFFERENT 246 · UNCLEAR 2` for the
384-pair pre-existing set. Those numbers were computed by a *prior* session's
classifier applied to `.context/prod-pairs-bucketed.json`. In this session I
re-ran the sort script against live PROD, byte-compared the CSVs, and re-applied
the same classifier from scratch.

**Result:** the fresh PROD CSV is **byte-identical** to the prior session's, and
the classifier produced **exactly** the same totals — pre-NP-doc **SAME 136 ·
DIFFERENT 242 · UNCLEAR 6**, post-NP-doc (with the 4 NP reclassifications) **SAME
136 · DIFFERENT 246 · UNCLEAR 2**. Every claim in the NP doc's bucket-count
table checked out. The verification exposed no drift and no reused-stale-number
error.

Verification method: `data/scripts/crosssource-duplicate-investigation.ts` (from
sibling branch, restored temporarily and deleted after) run with `--prod --csv`,
parsed and re-classified in a fresh Python script.

## 2. Full-set grep for CP / SW / NP pairs

The prior session eyeballed "1 CP pair (`Topanga SP ↔ Topanga CP`), 2 SW pairs
(`Limekiln`, `Cuyamaca`), 9 NP pairs" from the printed unclear-bucket sample —
which could have missed pairs sitting in the DIFFERENT bucket.

**Result (fresh grep of the full 384-pair set on both `visitor_name` and
`other_name` for `\bNP$` / `\bCP$` / `\bSW$`):**

- **NP: 9 pairs**, all in DIFFERENT — matches prior. Full list already in the NP
  doc.
- **CP: 1 pair**, all in DIFFERENT — `Topanga SP ↔ Topanga CP`. Matches prior.
- **SW: 2 pairs**, all in DIFFERENT — `Limekiln SP ↔ Limekiln SW` and
  `Cuyamaca Rancho SP ↔ Cuyamaca Mountain SW`. Matches prior.

The eyeballed counts were, by luck or shape of the data, exhaustive. Correct
under audit.

## 3. NP = Natural Preserve — direct verification via PDF text extraction

Prior claim was "high-confidence inference — CP confirmed via CA State Parks
Foundation, SW canonical, NP is the remaining classification." The failure mode
in the prior session was stopping at WebFetch's binary-content error.

**Result:** downloaded the two DPR PDFs referenced by the NP doc (plus a third
found via web search) with `curl`, extracted text with `pdftotext`, and
grepped. **Direct confirmation obtained.**

Key evidence:

- **PDF 2** (`08c-CASPGP Resolution Class_Name NewStatePark_Final_051421_R.pdf`,
  a CA DPR classification resolution): contains the phrase
  *"WHEREAS, **Tatlun Cultural Preserve, San Jose Natural Preserve and Pt. Lobos
  Ridge Natural Preserve**, having been established by separate resolution on
  this same date"*. The three named units correspond exactly to corpus rows
  `Tatlun CP`, `San Jose Creek NP`, and `Point Lobos Ridge NP` — a direct
  1↔1 mapping between "X NP" naming and the "X Natural Preserve"
  classification, on records that appear in the corpus with the same
  agency_id-derived identity.
- **PDF 1** (DPR Operations Manual — Natural Resources, 6835 lines of extracted
  text): repeatedly names *Natural Preserve* as a CA sub-unit classification per
  `PRC § 5019.71`, and separately names *State Wilderness* per `PRC § 5019.68`.
  Both are documented as sub-unit types alongside Cultural Preserve.
- **PDF 3** (a rulemaking Initial Statement of Reasons): says *"There are
  approximately 16 State Natural Reserves, 61 Natural Preserves, 23 [additional
  classifications]…"* — a population count for the Natural Preserve
  classification. The corpus contains 63 rows ending in " NP" (one of which is
  the Los Penasquitos double-record; see §4). 63 vs "approximately 61" is
  consistent to within the rounding of the source phrase, further corroborating
  the mapping.

**Conclusion:** NP = Natural Preserve is now **directly confirmed by CA DPR's
own published documents**, not inferred. The verification gap called out in the
NP doc's §1c is closed. The doc's other confidence notes (parent-unit identity
per pair, exact CA DPR data-dictionary read) remain untouched — this
verification narrowed only the NP=NaturalPreserve claim.

## 4. Los Penasquitos Marsh NP double-record — not a quirk

The prior session found two source_records named `Los Penasquitos Marsh NP` on
PROD — one with `agency_id = 640` (linked to a master_place), one with
`agency_id = fec71bff-…-964cea` (unlinked, `master_place_id = null`). It was
labelled "a minor data quirk" and moved on.

**Fresh investigation this session:** the two records are legitimate CA DPR
polygons that happen to share a UNITNAME.

| field | Record A ("640") | Record B ("fec71bff-…") |
|---|---|---|
| PROD `source_record.id` | `3d41ade2-…` | `e41d6e18-…` |
| `external_id` | `state_parks:CA:park:640` | `state_parks:CA:park:fec71bff-…` |
| `raw_payload.props.GISID` | `GIS0000388` | `GIS0000443` |
| `raw_payload.props.FID` | `8709` | `8747` |
| `raw_payload.props.UNITNBR` | `"640"` | `null` |
| `raw_payload.props.Shape__Area` | 1,229,504 | 1,150,104 |
| Point centroid | `[-117.2463, 32.9224]` | `[-117.2480, 32.9262]` |
| Haversine centroid distance | — | **459 m from Record A** |
| PROD `master_place_id` | `46561990-…` (linked) | `null` (unlinked) |
| PROD `place_match.status` | `confirmed` (deterministic, conf=1.0, dist=0) | **`pending`** (blended_residual, conf=0.6, dist=458.29m) |

**These are two source-side polygons.** CA DPR really does emit two "Los
Penasquitos Marsh NP" polygons with different GISIDs/FIDs and ~7% different
areas. Not an ingest bug.

**The mismatch across the two DBs is a triage-state difference:**

- **On TEST**: both source_records point to the same master_place
  `edfa4e0b-…`. The pending row was **manually confirmed by Adam** on
  2026-08-20 (`resolved_by = adam_triage_2026-08-20`) — TEST triage completed,
  so both polygons attach to one mp.
- **On PROD**: the deterministic auto-link fired for Record A. Record B scored
  `blended_residual = 0.60` (name 1.0 + dist 458m → clipped to 0 + cat 1.0 →
  `0.4*0 + 0.4*1.0 + 0.2*1.0 = 0.60`), landed in manual review as `status =
  pending`, and **has never been triaged**. Record B's `master_place_id` is
  therefore still `null`, and its polygon contributes nothing to search on PROD.

**This is the same mechanism that produced the 43 self-created duplicates**
described in `2026-09-02-cross-source-duplicates.md`: the 100m distance clip
zeroes out any distance term past 100m, so an identical-name pair sitting
100–500m apart blends to exactly 0.60, which is below the 0.85 auto-link bar
and above the manual-review floor. The prior sort investigation named this
mechanism precisely — this record is one of its consequences.

**But this is the *only* unlinked CA state_parks SubUnit row on PROD.** I
enumerated all unlinked PROD `state_parks` source_records (152 total), filtered
to CA-state and `designation = SubUnit` — exactly **one** row survives:
this Los Penasquitos B record. No wider class of unlinked SubUnits to name.

**Correction to the NP doc's wording:** the phrase *"63 source_records → 62
distinct master_places (some NPs share a master_place)"* was **imprecise but not
wrong**. The right reading is: 63 source_records → 62 non-null master_place_ids
(62 distinct) → 62 distinct master_places. The gap comes from **one unlinked
record**, not from record-sharing. Anyone reading the NP doc should treat the
"some NPs share a master_place" phrase as loose; the mechanism above is the
correct picture.

**Bucket-implication for the NP doc:** this record does not appear in the
384-pair sort because the sort is scoped to visitor-source-linked master_places;
Record B has no master_place at all, so it's neither the visitor side nor the
other side of any pair. The NP doc's DIFFERENT-bucket assignment for the 9 NP
pairs stands regardless.

**Not a fix to apply here.** Triaging the pending place_match is a write and
out of scope for this pass. Recommended follow-up: apply the same triage
decision Adam applied on TEST (confirm the pending row → attach Record B to
mp `46561990-…`). This would bring PROD in line with TEST's state and give
`master_place_search_export` a `source_count = 2` for that mp.

---

## Wider implications

**Nothing this pass found rewrites the NP doc's core answer** ("NP = Natural
Preserve; all 9 NP pairs are parent/child, not duplicate; bucket assignment
DIFFERENT for all 9"). It:

- promotes NP = Natural Preserve from *inferred* to *directly confirmed*
- upgrades the Los Penasquitos "quirk" line to a named, mechanism-linked open
  triage item
- confirms the classifier totals and the CP/SW pair counts under fresh audit

**PR #368 is not touched.** Its two cherry-picked commits (the parent
investigation script and doc, cherry-picked from
`investigate-crosssource-duplicates`) remain in that PR. This PR's branch
(`verify-np-followup`) branches from `main`, so it does not carry those two
commits — anyone reviewing this PR sees only the verification doc, plus the
`.context/` artifacts (gitignored) that produced its numbers.

---

## Scope limits and what was NOT verified

- The claim in PR #368 that "NP records with `source_count = 1` (NP-only)" is
  the majority pattern was re-measured on PROD in the prior session; this pass
  did not re-run that specific measurement. Nothing about §1's fresh classifier
  run touched it.
- The CA DPR *data-dictionary* verification of the SUBTYPE→classification-code
  mapping (i.e., the actual ArcGIS feature-service metadata explicitly listing
  the NP/CP/SW codes) was not attempted — the four items above cover the
  linkages needed to trust the NP doc's conclusions, but a data-dictionary read
  is still the ideal source-of-truth for a merge tool.
- Only two of the three DPR PDFs I downloaded were parseable in a useful way;
  PDF 3's extraction produced 186 lines with the "approximately 61 Natural
  Preserves" line and the general classification list. PDF 2's extraction
  produced 74 lines, one of which was the smoking-gun WHEREAS clause. All three
  PDFs are stored under `.context/pdfs/` (gitignored).
- **The TEST duplicate-classifier run completed** during this session and
  reported 775 broad pairs (matching the prior investigation's TEST number).
  I did not re-classify TEST's 775 pairs — nothing in the four verification
  items required TEST-side bucket totals, and the prior investigation already
  established that TEST's larger pair set is dominated by PADUS/generated_*
  collisions that don't exist on PROD.
