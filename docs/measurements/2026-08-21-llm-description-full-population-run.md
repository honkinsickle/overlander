# LLM description generation — full-population run, 2026-08-21

First real write of LLM-generated content into the corpus. Generation-method
`'llm'` rows written to `master_place_generated_content` on **TEST**
(`znldzjdatkogdktymtvi`) only — **no PROD writes, no PROD schema changes, no
PROD reads.** Runs directly on branch `puebla` (a Conductor workspace off
`origin/main` = `d6c55ac`, which already carries #244's template/eligibility/
provenance work). Committed locally, not pushed.

Every number below was computed in this session against TEST. Nothing is
transcribed from a prior report. Estimates are labelled as estimates.

Scripts (all new this session):
- `data/scripts/measure-llm-target-population-2026-08-21.ts` — read-only
  target-population + overlap re-measurement (tasks 1–2).
- `data/scripts/generate-llm-descriptions-2026-08-21.ts` — the run itself
  (tasks 3–5, 8).
- `data/scripts/spotcheck-llm-descriptions-2026-08-21.ts` — read-only
  fabrication sampler (tasks 6–7, 9).

Run/log artifacts (gitignored `.context/`, not committed):
- `.context/measurements/llm-target-population-2026-08-21.json` — the 7,433 run set.
- `.context/measurements/llm-description-run-2026-08-21.jsonl` — one line per
  generated row (prompt + output + tokens), the spot-check source.

---

## Task 1 — target population: 7,433 (drift from 7,154, explained)

Re-ran the 2026-08-20 pilot's exact bucketing logic (STRONG/WEAK via the shared
`lib/eligibility.ts` signals + the USFS-directions fold, `has_real_description`
excluded, `has_template_description` **not** folded in — i.e. bucketed as the
pilot did before #244 changed the shared lib), atlas_oddities excluded.

**Target population now = 7,433** (7,333 STRONG + 100 WEAK), vs the pilot's
**7,154**. Drift **+279 (+3.9%)**.

`[queried TEST 2026-08-21T19:02Z]`

| metric | pilot (2026-08-20) | now (2026-08-21) |
|---|--:|--:|
| in-scope MPs (searchable + geo + ≥1 active SR) | 38,950 | 32,734 |
| — STRONG | 21,659 | 22,107 |
| — WEAK | 104 | 100 |
| — NONE | 17,187 | 10,527 |
| STRONG already carrying a real description (excluded) | 12,981 | 13,142 |
| active `source_record` scanned | 86,735 | 78,983 |
| target incl. atlas_oddities | 8,782 | 9,065 |
| atlas_oddities within target | 1,628 | 1,632 |
| **target excl. atlas_oddities (the run set)** | **7,154** | **7,433** |

**Why it drifted** (all landed between 2026-08-20 and now, via #242/#243/#244):
- In-scope MPs fell 38,950 → 32,734 and NONE fell 17,187 → 10,527, driven by
  the placeholder-name and template-related deactivations (#243/#244) pulling
  NONE-bucket rows out of the searchable/in-scope set.
- `state_parks` (#242) is a new source in the target's composition
  (`multi:osm+state_parks` 42) — new STRONG-but-undescribed rows.
- Net effect on the STRONG-no-description target: +279.

**Apparatus cross-check** — computing the *live* eligibility (template folded in,
as #244's shared lib now does) reproduces #244's committed corpus figures
exactly: STRONG **32,399** / WEAK **100** / NONE **235**
`[queried TEST 2026-08-21]`, matching `docs/STATE.md`'s post-#244 table to the
row. This confirms the measurement apparatus, not just the number.

Reported and proceeded (drift is minor and fully explained; task 1's gate is
"report the new count and why", not "stop").

## Task 2 — overlap with `master_place_generated_content`: zero

At measurement time the table held **10,292** rows, **all**
`generation_method='template'`, one per distinct MP (`field_name='description'`).
Cross-referencing every target row against that set: **0** target rows (incl. and
excl. atlas_oddities) already had a description generated_content row. Template
generation targeted the NONE bucket; this target is STRONG/WEAK — disjoint,
verified not assumed. `[queried TEST 2026-08-21]`

The run script **re-verifies this at write time**: it skips any MP that already
has a description generated_content row (template *or* llm), and inserts (never
upserts), so the `unique (master_place_id, field_name)` constraint would hard-fail
rather than overwrite a template row. Post-run, template count is **unchanged at
10,292** — zero overwrites. `[queried TEST 2026-08-21]`

## Task 3 — active prompt (validated, quoted)

The validated anti-fabrication prompt from
`docs/measurements/2026-08-20-llm-description-prompt-iteration.md` §2 (measured
4% any-fabrication / 0% severe on 27 rows) is **not** wired into
`data/scripts/eval-llm-descriptions.ts` — that script still carries the *original*
pre-fix prompt and writes JSONL only, never to the DB. The validated prompt lives
only in `eval-llm-descriptions-sample-2026-08-20b.ts`. It was copied **verbatim**
(system prompt **and** `buildPrompt`/`fetchFacts` user-turn construction) into the
new run script, `prompt_version = '2026-08-20b-antifab'`. Active system prompt:

```
You are writing short factual descriptions of places for overland travelers (van/truck-camping road trippers), using ONLY the fields provided below each place — nothing else.

Grounding — this is the most important rule:
- Use ONLY the facts given in the prompt for THIS place. Do not add anything from outside knowledge about it, even if you recognize the name as a real location. You may know its category in general (a national forest, a wildlife refuge, a historic site) but you do NOT know its acreage, elevation, exact history, sub-areas, or any other specific fact unless that exact fact is listed below.
- Never state a specific number (acreage, elevation, distance, headcount, year, percentage) unless that exact number appears in the provided fields. If none is provided, do not estimate or recall one — describe qualitatively ("high elevation", "remote") or leave it out.
- Never name a specific landmark, sub-area, wilderness area, nearby town, or administering unit that is not literally present in the provided fields, even if you believe it is correct.

Length — match it to what's actually provided:
- Rich fields (real tags, contact info, directions, existing description text): up to 2-3 sentences using them.
- Thin fields (little beyond name/category/state): ONE short, general sentence about the category and setting. A short accurate sentence beats a longer one padded with invented detail.

Style:
- Plain, no marketing language, no exclamation marks, no first person.
- When inferring rather than quoting a provided fact, hedge explicitly ("likely", "appears to be").
- Output only the description text — no headings, no quotes.
```

**One faithful-replication caveat:** the validated `fetchFacts`/`buildPrompt`
includes `usfs.directions` in the prompt but **not** `ridb.directions`, even
though `lib/eligibility.ts` counts RIDB directions toward STRONG. Replicated
verbatim to preserve the validated behavior; effect is only that ~64 ridb-touched
target rows get a slightly thinner prompt (safer, not riskier — a real field
withheld cannot increase fabrication).

## Task 4 — model / rate confirmation

Preflight (one 8-token call before the run): request model `claude-sonnet-4-5`,
response model id **`claude-sonnet-4-5-20250929`** — resolves, **no fallback** to
`claude-sonnet-5`. Rate assumed for cost: **$3.00 / M input, $15.00 / M output**
(claude-sonnet-4-5 standard). Across the entire run, **0 rows fell back** to a
non-4-5 model. `model_version` stored on every row = `claude-sonnet-4-5`.

## Task 5 / 6 — run statistics (precise, measured)

Executed in two invocations of the **same script and prompt** against the same run
set: a 20-row live smoke test (to validate the DB-write shape before the full
spend) and the full remaining population. The smoke rows are indistinguishable
from full-run rows (same `prompt_version`, `model_version`) and are counted in the
corpus total.

| | rows | input tok | output tok | cost |
|---|--:|--:|--:|--:|
| smoke test (`--limit 20`) | 20 | 8,420 | 634 | $0.0348 |
| full run (remaining) | 7,413 | 3,127,132 | 252,670 | $13.1714 |
| **combined (corpus total)** | **7,433** | **3,135,552** | **253,304** | **$13.2062** |

- **processed 7,433 · succeeded 7,433 · errored 0 · empty generations 0 ·
  model fallbacks 0.**
- Per-row: **$0.00178/row** (combined). Full-run wall clock **1,673.9 s** (~28
  min) at concurrency 10; the retry/backoff layer (429/5xx/overloaded) was never
  triggered (0 errors).
- Post-run table state `[queried TEST 2026-08-21]`: `generation_method='llm'`
  **7,433**, `'template'` **10,292** (unchanged), total **17,725**;
  `needs_review=true` among llm rows **0**; empty `generated_text` among llm rows
  **0**.
- Every llm row carries `field_name='description'`, `generation_method='llm'`,
  `model_version='claude-sonnet-4-5'`, `prompt_version='2026-08-20b-antifab'`,
  `generated_at`, and a populated `grounded_on_source_record_ids` (the active
  source_record ids the prompt was actually built from).

Cost is within the pilot's ~$17 estimate; no >2× divergence, so the run did not
pause for a cost checkpoint (per the task instruction).

## Task 7 / 9 — fabrication spot-check (60 rows)

Sampled **60** of the 7,433 successful rows (seeded random, seed 20260821,
`spotcheck-llm-descriptions-2026-08-21.ts 60`) and eye-checked prompt vs output
side by side, same 4-tier method as the 2026-08-20 A/B. A heuristic
(numbers-in-output-absent-from-prompt) flagged **0/60** — the exact old failure
mode (invented acreage/elevation/dates) did not appear.

| tier | n / 60 | % |
|---|--:|--:|
| clean | 57 | 95.0% |
| minor (brand/category-generic, unhedged) | 1 | 1.7% |
| moderate (one added specific attribute, unhedged) | 2 | 3.3% |
| **severe** | **0** | **0.0%** |
| **any-fabrication (moderate + severe)** | **2** | **3.3%** |

**3.3% any-fabrication, 0% severe — in line with (slightly better than) the 4%
baseline.** No stop-and-report trigger (task 9). This is a sample rate on n=60,
**not** the true population rate.

### The two moderate cases, source vs generated

**#12 Morro Bay SP Hike/Bike Camp** (CA, STRONG, osm+state_parks)
- Prompt fields: `Name: Morro Bay SP Hike/Bike Camp` · `Category: campground` ·
  `Location: in CA` · `Sources: osm, state_parks` — no other facts.
- Generated: *"Morro Bay State Park offers a hike/bike camp in California,
  typically providing basic sites for travelers arriving on foot or bicycle.
  Located within a **coastal** state park, this campground likely serves as an
  affordable option for non-motorized visitors exploring the area."*
- Fabrication: **"coastal"** — an outside-knowledge geographic attribute of Morro
  Bay, stated unhedged. Nothing in the prompt supplies it. Mild (one adjective, no
  numbers/named sub-areas).

**#40 Camp Muir** (WA, STRONG, osm)
- Prompt fields: `Name: Camp Muir` · `Category: dispersed_camping` ·
  `Location: in WA` · `Hours (raw): {"raw":"24/7"}` · `Amenities: {"toilet":true}`.
- Generated: *"A **high-elevation** dispersed camping area in Washington,
  typically accessible to mountaineers and backcountry travelers. The site appears
  to operate year-round and provides toilet facilities."*
- Fabrication: **"high-elevation" / "accessible to mountaineers"** — inferred from
  recognizing Camp Muir (Mt. Rainier), stated unhedged. The grounded parts (24/7 →
  "year-round", toilet) are correct. Mild; no numbers.

Both are the recognizable-place pattern the A/B identified as the residual risk
(the A/B's own residual was "Uinta Mountains" on Crystall Lake Horseman
Trailhead) — a single added attribute, unhedged, no invented quantitative or
historical detail. **Severe fabrication (paragraphs of invented specifics) did not
recur:** e.g. **#50 Rogue River-Siskiyou National Forest** (WEAK, ridb, only a
junk phone `1111111111` supplied) generated *"a federal recreation area in Oregon
managed by the U.S. Forest Service. The forest likely offers a range of outdoor
recreation opportunities typical of national forests"* — category-level, hedged,
zero invented acreage/elevation, and it correctly dropped the placeholder phone.

**Minor (not counted in any-fabrication):** #2 eVgo → "providing DC fast charging"
(brand-generic, unhedged). **One formatting slip (not fabrication):** #38 Blink
emitted a `# Blink` markdown heading, violating the prompt's "no headings" rule —
the identical style miss the A/B flagged on Electrify America. Cosmetic; content
was clean and hedged.

## Task 8 — description_source / trip-exclusion behavior (verified on a real row)

Did **not** flip `description_source`, eligibility bucketing, or the
trip-generation exclusion logic. Confirmed — not assumed — that the existing #244
plumbing handles `'llm'` rows correctly, reading the migration source and then
verifying on a live row (`master_place_search_export` derives `description_source`;
`pois_along_corridor` excludes only template-only + `needs_review` rows).

Live check, MP `1f2837ab…` (Arroyo Seco Park, CA — a row generated this run), with
a template-only MP as negative control `[queried TEST 2026-08-21]`:

| | in export view | `description_source` | offered by `pois_along_corridor` |
|---|---|---|---|
| llm row (this run) | yes | **`llm`** | **YES** (offered) |
| template-only (control) | yes | `template` | **NO** (excluded) |

So: LLM-described rows are **browsable** and **are offered as trip stops** — they
are excluded only if `needs_review=true` (which is false by default; 0 llm rows
flagged this run). Template-only rows remain browsable but excluded. This matches
task 8's stated expectation ("offered … only if needs_review is set" reads as
"held back only when flagged"). The exclusion logic distinguishes `llm` from
`template` correctly with no change from this session.

**Two scope notes, flagged not fixed (neither asked for by this task):**
1. **The generated text is not yet surfaced to any consumer read path.** No view
   or RPC returns `generated_content.generated_text` as a description —
   `pois_along_corridor` and `master_place_search_export` both return
   `master_place.description` (null for these rows). The content is stored and
   provenance-tagged; wiring a read-path fallback is future frontend/read-path
   work (`docs/STATE.md` OPEN "read path / map filter UI").
2. **Typesense is not re-synced.** `description_source='llm'` is correct in
   Postgres (the export view) but reaches the live Typesense index only on the
   next `search:sync`. The 7,433 rows were already searchable, so browsability is
   unaffected; only the `'llm'` provenance facet is stale in the index until a
   sync runs.

---

## Doc-update flags (task 10)

- **`docs/STATE.md` — YES, updated in this session's commit.** New dated section:
  first LLM-generated content in the corpus (7,433 `generation_method='llm'` rows
  on TEST, branch `puebla`, committed locally, not pushed; PROD unaffected).
- **`docs/BACKLOG.md` — flag: needs an update.** The "LLM description generation at
  corpus scale" open item (previously "prompt fix promising on n=27, no bulk run
  authorized/run") is now **done on TEST** at population scale — should be moved
  from open/parked to done-on-TEST, with the residual 3.3%/n=60 fabrication note
  and the two follow-ups above (read-path wiring, Typesense re-sync) captured.
- **`docs/DATA_INVENTORY.md` — flag: needs an update.** TEST
  `master_place_generated_content` now holds 17,725 rows (10,292 template + 7,433
  llm), up from template-only. If it enumerates this table's contents/counts, they
  are stale.
- **PROD apply** of `master_place_generated_content` (table + these rows) is a
  separate, explicitly-authorized future step — not in scope here.
