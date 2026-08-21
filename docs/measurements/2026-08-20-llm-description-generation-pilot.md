# LLM description-generation pilot — 2026-08-20

Investigation, design, and a small controlled generation sample (27 rows,
real API spend, capped as authorized). No schema migrations applied, no
bulk API calls, no writes to `master_place`/`source_record` beyond the
authorized sample. All queries read-only against TEST
(`znldzjdatkogdktymtvi`). No PROD touched.

## 1. USFS `directions` fix — corrected bucket counts

Added a `has_real_directions` signal (USFS `normalized_payload.directions`,
same `DESCRIPTION_MIN_LENGTH = 40` threshold used everywhere else) in a new
one-off script, `data/scripts/measure-usfs-directions-fix-2026-08-20.ts`.
**`lib/eligibility.ts` and `measure-corpus-gap-scan-2026-08-20.ts` were not
touched** — confirmed first, by direct query, that `directions` is
populated by **usfs only** (0 rows on osm/padus/ridb/nps/atlas_oddities/
blm/google_resolved/google), so this fix is structurally incapable of
changing any other source's bucketing even though it was kept in a separate
script rather than folded into the shared module.

Run 2026-08-20T18:51:08.761Z, 86,393 active `source_record` rows queried,
5,183 USFS-linked master_places (identical count to the original gap scan —
confirms consistent scoping):

| | STRONG | WEAK | NONE |
|---|--:|--:|--:|
| Original (description only) | 3,533 (68.17%) | 0 (0.00%) | 1,650 (31.83%) |
| **Corrected** (description OR directions) | **3,695 (71.29%)** | 0 (0.00%) | **1,488 (28.71%)** |

**162 rows (3.13% of USFS-linked MPs) flipped from NONE to STRONG solely
because of a real `directions` field** — confirming the gap-scan spot-check
finding (Puffer Lake/Big Flat, `usfs:site:211081010602`) was not an
isolated case.

## 2. Target population — precise count

Computed in `data/scripts/measure-llm-target-population-2026-08-20.ts`, run
2026-08-20T18:53:46.715Z (158,742 `master_place` rows queried unfiltered,
86,735 active `source_record` rows queried — corpus grew slightly between
runs this session, consistent with a live TEST environment; every run in
this doc states its own timestamp rather than assuming a fixed snapshot).

In-scope MPs (searchable + geometry + ≥1 active source_record): **38,950**.
Bucket distribution (post-USFS-directions-fix, corpus-wide):

| bucket | n | % |
|---|--:|--:|
| STRONG | 21,659 | 55.61% |
| WEAK | 104 | 0.27% |
| NONE | 17,187 | 44.13% |

Of the 21,659 STRONG rows, **12,981 already carry a real description**
(`has_real_description` true) — nothing to generate there.

**Target population — STRONG or WEAK, no existing real description:
TOTAL = 8,782.** Breakdown: 8,678 from STRONG (strong via
website/wikipedia/meaningful-OSM-tags/the USFS-directions fix, but no
description text yet), 104 from WEAK (phone/hours signal only). Written to
`.context/measurements/llm-target-population-2026-08-20.json` (not
committed — gitignored `.context/`).

By state: WA 1,604 · OR 1,405 · CA 3,241 · NV 619 · UT 788 · AZ 1,125.

By source composition (top): osm 6,534 · atlas_oddities 1,621 (+ small
atlas_oddities multi-source combos, 1,628 total, see §3) · nps 192 ·
usfs 128 · blm+osm 117 · osm+usfs 111 · ridb 54 · osm+ridb 15.

## 3. atlas_oddities — recommendation, not a decision

**1,628 of 8,782 target rows (18.54%) carry an atlas_oddities source** —
verified exactly, not estimated. Per the earlier investigation
(`2026-08-20-corpus-gap-scan.md` §5), **0 of 2,866 active atlas_oddities
rows corpus-wide have any description text at all**; their STRONG-bucket
status here comes entirely from `contact.website` presence (present on
59.2% of atlas_oddities rows), not from narrative content. What the adapter
carries per place: `canonical_name`, `address`, `categories_raw`/
`overlander_tags` (short category-word lists like "bell tower;
Firefighters; Belltowers"), and `ao_url` — a link back to the real,
human-written Atlas Obscura article, present on all 2,866 rows and never
fetched (would require re-scraping content this pass wasn't scoped to
fetch, and raises its own licensing question this investigation does not
answer).

**Recommendation: exclude atlas_oddities from this pass's target
population.** Generating an LLM description for these rows from
`canonical_name` + category tags + coordinates alone is closer to
fabrication than summarization — there is a real, existing human-written
description one hop away that we are choosing not to use, not a case of
"no content exists to summarize." **This is not implemented as a decision**
— atlas_oddities rows were excluded from the task-4 sample construction
(below) precisely so no atlas_oddities row entered the pilot without this
being said first, per the task's instruction. Adam's call on whether to
exclude them from any future full-scope run, and separately on whether the
`ao_url` content is fair game to fetch/republish.

**Corrected target population for sampling: 8,782 − 1,628 = 7,154.**

## 4. Sample generation — real API spend, actual cost

### 4a. Pricing confirmed before running

- **`claude-sonnet-4-5` is still an active, non-deprecated model ID** — not
  in the deprecated or retired lists. The generation script (both the
  original `eval-llm-descriptions.ts` and this session's sample copy) tries
  this model first with a fallback to `claude-sonnet-5` only on a 404. Since
  `claude-sonnet-4-5` resolves, **no fallback occurred** — the run actually
  used Sonnet 4.5, not Sonnet 5.
- **Confirmed current rate for `claude-sonnet-4-5`: $3.00 / million input
  tokens, $15.00 / million output tokens** — matches the script's own
  hardcoded comment exactly, and matches an independent live web search
  result. (For contrast, if it had fallen back to `claude-sonnet-5`: $2.00
  input / $10.00 output per million as an **introductory rate through
  2026-08-31** — today is 2026-08-20, so that window is still open, standard
  pricing $3/$15 resumes after — but this rate did not apply to the actual
  run.)

### 4b. Sample construction

25–30 requested; built 27. Drawn from the 7,154-row corrected population
(atlas_oddities excluded), stratified across (state × source-bucket
[osm-only / usfs-involved / other]), genuinely random within strata
(seeded `mulberry32`, reproducible — seed `20260820`), round-robin across
strata so no single stratum dominates. Script:
`data/scripts/eval-llm-descriptions-sample-2026-08-20.ts` — a copy;
`eval-llm-descriptions.ts` was not edited. Output:
`.context/measurements/place_description_samples_2026-08-20.jsonl` (local
file only, gitignored — no DB writes anywhere in this script).

Resulting mix (counted directly from the output file): STRONG 24 / WEAK 3
(WEAK is only 104 rows corpus-wide, so a small count in a 27-row stratified
draw is expected, not a stratification bug); states WA 5 · OR 3 · CA 5 ·
NV 4 · UT 4 · AZ 6 — all 6 represented; source-bucket osm 10 · usfs-involved
9 · other (nps/ridb/blm combos) 8.

### 4c. Actual cost — measured, not estimated

**27 rows, 0 errors, 38.9s elapsed. Tokens: 7,798 input + 2,713 output.
Cost at the confirmed $3/$15 per-million rate: $0.0641.**

That is **$0.00237/row** on this sample — lower than the "~$1/50 rows"
(~$0.02/row) figure cited as the last known rate. The difference is
explained by prompt size: this pilot's prompts are short structured-fact
lists (name/category/state/sources plus whatever grounding facts exist),
not the full-context prompts a different measurement may have used, and
`max_tokens: 400` caps output length. **Extrapolating this per-row average
to the full 7,154-row (non-atlas) target population: 7,154 × $0.00237 ≈
$16.95.** Flagged explicitly as an **estimate**, not a measured number — a
full run's per-row token count would vary with how much grounding data each
row actually carries (rows with USFS directions text or dense OSM tags cost
more per row than a bare `Unnamed picnic area`), and this sample's mix may
not be representative of the full population's mix. If atlas_oddities were
included at the same rate: 8,782 × $0.00237 ≈ $20.81 (also an estimate, and
per §3, not recommended without a separate decision).

## 5. Fabrication spot-check — the main finding of this pass

All 27 prompt/output pairs read side by side (full detail in the JSONL
output file). Classified into four tiers by whether the generated text
added a specific claim (a name, number, date, or entity) that was **not**
present in the prompt's supplied facts, and whether it was hedged
("likely", "appears to be") or stated as flat fact:

| tier | n | definition |
|---|--:|---|
| clean | 12 | no claim beyond supplied facts, or every added claim explicitly hedged |
| minor | 4 | added a generic, brand/category-level fact (e.g. how ChargePoint or Electrify America networks generally work) not location-specific |
| moderate | 7 | added one specific named entity (a forest name, wilderness area, elevation figure) inferred from context but stated unhedged |
| **severe** | **4** | added multiple specific, confident quantitative/historical facts (acreage, elevation ranges, exact dates, named subregions, headcounts) with **no textual basis in the prompt at all**, stated as flat fact |

**11 of 27 (41%) fall in moderate-or-severe** — added at least one
specific, ungrounded factual claim stated without a hedge. **4 of 27 (15%)
are severe** — full paragraphs of specific facts invented from the model's
general knowledge of a real, recognizable place name, with none of it
traceable to the supplied prompt.

**The severe cases are not random — they cluster on WEAK-bucket rows
naming a famous place with almost no supplied grounding.** Two clean
examples:

- **"Coconino National Forest Recreation" (AZ, WEAK, source=ridb).** Prompt
  supplied only a phone number and a `federal_land`/`usfs` tag. Generated
  text states as fact: "roughly 1.8 million acres... Red Rock terrain near
  Sedona... San Francisco Peaks above Flagstaff... 3,000 feet to alpine
  zones approaching 12,000 feet." None of this is in the prompt.
- **"Dixie National Forest" (UT, WEAK, source=ridb).** Same prompt shape
  (phone + tag only). Generated text: "nearly two million acres...
  Cedar Breaks, Boulder Mountain, and the Aquarius Plateau... five
  physiographic provinces... elevations ranging from roughly 2,800 to over
  11,000 feet." Again, none of this is in the prompt.
- **"Japanese American Exclusion Memorial Audio Tour - Stop 13" (WA,
  STRONG, source=nps, prompt supplied only an NPS URL slug).** Generated
  text states as fact: "part of Minidoka National Historic Site... the
  March 30, 1942 forced removal of 227 Japanese American residents from
  Bainbridge Island... the first mass exclusion under Executive Order
  9066." A specific date and a specific headcount, from a URL slug alone.

Spot-checking these against outside knowledge, the specific facts the model
added in these three cases appear to be **true** — these are real,
well-documented places and the model is drawing on real training
knowledge, not hallucinating false content. **That does not make it
grounded.** The system prompt explicitly instructs "If a fact is not
provided, do NOT invent it... unless [hedged]" — and the model violated
that instruction by stating outside-knowledge facts as flat certainty
rather than hedging them or omitting them. A future pass over the real
7,154-row population will include famous places (national forests, NPS
sites, well-known trailheads) at some real rate, and this sample shows the
model reliably reaches for its own general knowledge on exactly those rows
— which is a genuine risk for a "grounded, source-of-truth" description
field, even when the specific facts happen to be accurate this time (there
is no verification step to catch the case where they aren't).

**By contrast, rows the model could not recognize (`Unnamed picnic area`,
`Unnamed dispersed camping`, generic `ChargePoint`/`Volta` stations,
`Halfway House`) were reliably well-hedged** — with nothing to recall, the
model correctly fell back to "appears to be", "likely", "cannot be
confirmed" language, exactly as instructed. The moderate-tier cases (7 of
27) sit in between: USFS trailheads with real `directions` text where the
model added one plausible-but-unsupplied specific (a wilderness area name,
an elevation figure) alongside otherwise well-grounded content — lower
severity because the surrounding paragraph mostly reflects real supplied
facts, but the same underlying pattern.

**This matters more than the raw fabrication count**: it means fabrication
risk in this pipeline correlates with **place recognizability, not with
bucket richness or source count**. A STRONG-bucket row about an anonymous
picnic area is lower-risk than a WEAK-bucket row naming a famous national
forest — the opposite of what "STRONG bucket = more grounding material"
would suggest, because the grounding material in the STRONG case is often a
generic tag (a `contact.website`) that doesn't tempt the model to recall
outside facts, while a recognizable name does.

## 6. Proposed schema (not applied)

Requirements from the task: distinct from any raw-source `description`, so
generated text is never confused with source-of-truth content; carries
provenance (generated flag, model version, generation timestamp, the
source rows it was grounded on); regenerable/purgeable if the model or
approach changes.

**Proposal: a new table, `master_place_generated_content`.** Not a column
on `master_place` — a column there would need `recompute_master_place`
(and its `field_precedence` resolution) to somehow know not to treat it as
a normal precedence-resolved field, which is exactly the "never confused
with source-of-truth content" risk the task calls out. A separate table
makes the boundary structural, not a naming convention.

```sql
create table public.master_place_generated_content (
  id uuid primary key default gen_random_uuid(),
  master_place_id uuid not null references public.master_place(id) on delete cascade,
  field_name text not null,                    -- 'description' today; extensible
  generated_text text not null,
  llm_generated boolean not null default true,  -- explicit per this pass's ask, even though
                                                 -- every row in this table is LLM-generated by
                                                 -- construction — keeps the provenance flag
                                                 -- self-describing if this table is ever read
                                                 -- in a context that doesn't already know that
  model_version text not null,                  -- e.g. 'claude-sonnet-4-5'
  generated_at timestamptz not null default now(),
  grounded_on_source_record_ids uuid[] not null, -- the specific source_record rows the prompt
                                                  -- was built from — lets a future pass detect
                                                  -- when grounding data has changed underneath
                                                  -- a generated row
  prompt_version text,                          -- which system-prompt/template version produced
                                                  -- this, so a prompt-quality fix can identify
                                                  -- what to regenerate

  unique (master_place_id, field_name)
);

create index on public.master_place_generated_content (master_place_id);

alter table public.master_place_generated_content enable row level security;
-- zero policies, same posture as source_record / master_place / place_match —
-- service-role only, consistent with every other curated-corpus table.
```

`unique (master_place_id, field_name)` makes regeneration a delete+insert
or upsert, not an append-only log — matches how the rest of the corpus
treats "current state" (source_record's own idempotent upsert). If an audit
trail across regenerations is ever wanted, that's a separate, explicitly
scoped decision, not assumed here.

**Read path (app layer, not part of this DB proposal — flagged, not
designed):** show `master_place.description` when present; only fall back
to `master_place_generated_content` when it's null. This is exactly the
"never confused with source-of-truth" requirement — the fallback lives in
the application/view layer, not in `field_precedence`, so a real source
description landing later automatically wins without any special-case code
in `recompute_master_place`.

**Caching-rule interaction — the two mechanisms are unrelated, worth
stating explicitly so it isn't assumed otherwise later.** The Google Places
caching restriction investigated earlier this session
(`2026-08-20-google-places-details-compliance-check.md`: place_id
cacheable indefinitely, coordinates 30 days, everything else must be
fetched live) governs content that **originates from the Google Places
API**. LLM-generated descriptions in this proposal are grounded entirely on
this corpus's own data (OSM tags, USFS directions text, RIDB/NPS
normalized_payload fields — confirmed zero Google-sourced content in any of
the 27 sample prompts) and are not Google Places content at all — **that
caching restriction does not apply to this table.** There is no legal or
contractual TTL on this content.

What **does** need an operational (not legal) refresh policy: staleness
against the source rows it was grounded on. `grounded_on_source_record_ids`
exists so a future pass can detect drift — e.g. compare
`source_record.updated_at` for those ids against `generated_at`, or check
whether `master_place.description` has since been populated by a real
source (in which case the generated row is simply unused by the read path,
not wrong, but could be purged as dead weight). `model_version` exists for
the case a better/cheaper model becomes available and a bulk regeneration
is wanted — this pass's finding in §5 (fabrication risk on famous-place
WEAK rows) is exactly the kind of thing that might justify a prompt-version
bump and targeted regeneration rather than a blanket one. None of this is
designed further here — flagged as the surface this table needs to
support, not built.

## Summary

| | |
|---|---|
| USFS bucket fix | +162 rows NONE→STRONG (3,695 STRONG / 28.71% NONE, was 3,533 / 31.83%) |
| Target population | **8,782** (8,678 STRONG + 104 WEAK, no existing description) |
| atlas_oddities in target population | **1,628 (18.54%)** — recommend exclude, Adam's call |
| Corrected target population (sample source) | **7,154** |
| Sample size | 27 (of 20–30 requested) |
| Model actually used | `claude-sonnet-4-5` (confirmed active, $3/$15 per M) |
| Sample cost — **measured** | **$0.0641** (7,798 in / 2,713 out tokens, 0 errors) |
| Extrapolated full-population cost — **estimate, not measured** | ≈ $17 (7,154 rows) / ≈ $21 (8,782 rows incl. atlas_oddities) |
| Fabrication rate — **measured on this sample** | 11/27 (41%) moderate-or-severe; 4/27 (15%) severe |
| Fabrication risk driver | place *recognizability*, not bucket/source richness — famous-name WEAK rows fabricate more than anonymous STRONG rows |
| Schema | proposed, not applied — `master_place_generated_content`, separate table, RLS zero-policy service-role-only, `field_precedence`-independent read fallback |

No enrichment code applied. No DB writes beyond the local JSONL sample
file. Fabrication finding is a design input for whoever scopes the next
pass — likely a prompting fix (explicit "do not use outside knowledge of
this place, even if you recognize the name" instruction) and/or a
per-generation confidence flag, not something this investigation is
proposing to build.
