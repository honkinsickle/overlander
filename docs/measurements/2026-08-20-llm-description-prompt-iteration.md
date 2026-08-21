# LLM description prompt iteration — A/B, 2026-08-20

Controlled prompt-only A/B against the exact same 27 rows as
`docs/measurements/2026-08-20-llm-description-generation-pilot.md` — same
place IDs, same order, same model (`claude-sonnet-4-5`), source facts
re-fetched fresh from TEST (read-only, no writes occurred between runs so
data is identical). Only the system prompt changed. No DB writes, no bulk
run, no PROD.

## 1. What the old prompt got wrong

Original system prompt (`data/scripts/eval-llm-descriptions.ts`, unchanged,
not edited by this task):

> "If a fact is not provided, do NOT invent it. Do not claim specific
> hours, prices, phone numbers, current status, or amenities unless they
> appear in the provided facts... Prefer concrete geography (nearest known
> town, notable nearby landform) over generic filler."

Two concrete gaps, read directly from the 4 severe examples:

1. **The "do not invent" list enumerated hours/prices/phone/amenities —
   never geography, history, or scale.** Every severe fabrication was
   exactly the uncovered category: acreage, elevation ranges, exact dates,
   headcounts, named sub-regions. The rule didn't cover the failure mode it
   needed to.
2. **"Prefer concrete geography... over generic filler" directly rewards
   the failure.** For a recognizable name ("Coconino National Forest"),
   the highest-quality-sounding way to satisfy that instruction is to
   recall real geography from training data — the model wasn't
   disobeying the prompt, it was following it in the one direction the
   prompt didn't guard against.

Neither gap is about hedging language (the model did hedge in other
sentences of the same descriptions) — it's that the model didn't treat
"recalling a true fact about a place I recognize" as the kind of invention
the rule was warning against. It needed to be told explicitly that
recognizing the name doesn't license using anything about it beyond the
supplied fields.

## 2. New prompt

Full text, for the record (`data/scripts/eval-llm-descriptions-sample-2026-08-20b.ts`):

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

Design choices, mapped to the task's requirements: explicit "even if you
recognize the name" clause (requirement 1); a specific-number ban
enumerating the exact categories that were fabricated, not a vague "don't
invent" (requirement 2); an explicit brevity-when-thin instruction with a
worked contrast ("short accurate... beats... padded", requirement 3/4).
Kept to 3 short sections (grounding / length / style), same structure and
similar total length as the original — not expanded into a longer
meta-instruction stack.

The user-turn prompt (place facts) is **byte-identical in construction**
to the prior pilot — same `buildPrompt` fields, same source data. Only the
system prompt changed, which is what makes this a controlled comparison.

## 3. Re-run — actual cost

27/27 succeeded, 0 errors, 19.7s elapsed. **Tokens: 11,812 input / 1,145
output. Cost at the same confirmed $3/$15-per-million rate: $0.0526** (vs.
$0.0641 for the original prompt — cheaper overall despite a longer system
prompt, because output length dropped sharply: 2,713 → 1,145 output tokens,
a **~58% reduction**, driven by the brevity-when-thin instruction actually
firing on the thin-data rows). Input tokens rose (7,798 → 11,812) because
the new system prompt itself is longer and is resent on every call (no
prompt caching used in this small a sample). Output:
`.context/measurements/place_description_samples_2026-08-20b.jsonl`.

## 4. Fabrication rate — before vs. after

Same eye-check method as the prior pilot, same 4-tier classification
(clean / minor-generic / moderate / severe), read against the same source
facts each row was given.

| | prior prompt | **new prompt** |
|---|--:|--:|
| clean | 12/27 (44%) | **25/27 (93%)** |
| minor (brand/category-generic, not location-specific) | 4/27 (15%) | **1/27 (4%)** |
| moderate (one added specific entity, unhedged) | 7/27 (26%) | **1/27 (4%)** |
| severe (multiple invented quantitative/historical facts) | 4/27 (15%) | **0/27 (0%)** |
| **any-fabrication (moderate + severe)** | **11/27 (41%)** | **1/27 (4%)** |
| **severe only** | **4/27 (15%)** | **0/27 (0%)** |

## 5. The 4 previously-severe rows, side by side

**Coconino National Forest Recreation** (AZ, WEAK, source=ridb; prompt
supplied only a phone number + `federal_land`/`usfs` tags):

- Old: *"This national forest encompasses roughly 1.8 million acres of
  central Arizona high country, stretching from the Red Rock terrain near
  Sedona north through pine forests to the San Francisco Peaks above
  Flagstaff. Visitors find dispersed camping opportunities, established
  campgrounds, and trail access across dramatically varied terrain, from
  low-desert canyonlands around 3,000 feet to alpine zones approaching
  12,000 feet on the state's highest summit. The forest manages multiple
  recreation areas and wilderness zones spanning several distinct
  ecological communities, making it a popular destination for overlanders
  seeking high-elevation camps during Arizona's summer heat."*
- New: *"Coconino National Forest Recreation is a federally managed
  recreation area in Arizona administered by the U.S. Forest Service.
  Contact information is available at 1111111111."*

**Marin Islands National Wildlife Refuge** (CA, WEAK, source=ridb; prompt
supplied only a phone number + `federal_land` tag):

- Old: *"This federal refuge protects two small rocky islands in San
  Pablo Bay near San Rafael, serving as a critical nesting site for
  seabirds including western gulls and Caspian terns. The islands
  themselves are closed to public access to protect nesting colonies, but
  the refuge can be observed from shore or by boat at a respectful
  distance. Managed by the U.S. Fish and Wildlife Service, the site is
  part of the larger San Francisco Bay National Wildlife Refuge Complex
  and offers viewing opportunities from nearby public shorelines along the
  Marin County coast."*
- New: *"Marin Islands National Wildlife Refuge is a federal recreation
  area in California managed as a national wildlife refuge. Contact
  information is available at 707-769-4200 for visitor inquiries."*

**Japanese American Exclusion Memorial Audio Tour - Stop 13** (WA, STRONG,
source=nps; prompt supplied only an NPS URL slug):

- Old: *"This is the thirteenth stop on a self-guided audio tour at the
  Bainbridge Island Japanese American Exclusion Memorial, part of Minidoka
  National Historic Site in Washington. The memorial commemorates the
  March 30, 1942 forced removal of 227 Japanese American residents from
  Bainbridge Island—the first mass exclusion under Executive Order 9066.
  Visitors at this stop can access interpretive content via the NPS
  website that explains specific aspects of the exclusion story,
  contributing to a walking experience that traces the path these
  families took from their community to the ferry dock."*
- New: *"This is the thirteenth stop on an audio tour at a National Park
  Service site in Washington related to Japanese American exclusion
  history."*

**Dixie National Forest** (UT, WEAK, source=ridb; prompt supplied only a
phone number + `federal_land`/`usfs` tags):

- Old: *"Dixie National Forest spans nearly two million acres across
  southern Utah, encompassing diverse terrain from red rock canyons to
  high-elevation pine forests and alpine meadows. Managed by the U.S.
  Forest Service, this recreation area offers dispersed camping
  opportunities, scenic byways, and access to numerous trails threading
  through areas like Cedar Breaks, Boulder Mountain, and the Aquarius
  Plateau. The forest stretches across five physiographic provinces,
  making it one of the most geologically varied public lands in the
  state, with elevations ranging from roughly 2,800 to over 11,000
  feet."*
- New: *"Dixie National Forest is a federal recreation area in Utah
  managed by the U.S. Forest Service. The forest offers opportunities for
  outdoor recreation across its lands in the state."*

All 4 dropped every invented number, named sub-area, date, and headcount.
None of the new versions state anything the prompt didn't supply.

## 6. Residual issues — not papered over

**One residual fabrication, not zero.** "Crystall Lake Horseman
Trailhead" (UT, STRONG, source=usfs; the real USFS `directions` field
supplied only "From Kamas, Utah, head north on Main Street toward Center
Street. Turn right onto Center Street. In 25.4 miles turn left onto Spring
Canyon/Trial Lake Road. The trailhead is on the left in 0.2 miles.") —
new output: *"This Forest Service trailhead in Utah's **Uinta Mountains**
provides access to equestrian trails, located off Spring Canyon/Trial Lake
Road about 25 miles north of Kamas..."* — "Uinta Mountains" is not in the
supplied directions text. This is the same class of error as before (a
named region added from outside knowledge, stated unhedged), just a single
surviving instance rather than stacked with a second invented forest name
as it was in the prior run (which also said "Uinta-Wasatch-Cache National
Forest" — that specific claim did not recur here). Not classified as
severe — one added region name, not a paragraph of invented specifics — but
it is a genuine instance of the same failure mode the prompt was supposed
to close, and the new prompt did not catch it.

**One new, different problem: a formatting-rule violation.** "Electrify
America" (WA) came back as:

> *"# Electrify America\n\nAn electric vehicle charging station in
> Washington, likely offering DC fast charging for road travelers passing
> through the area."*

The `# Electrify America` line is a markdown heading — the system prompt
explicitly says "no headings." The old prompt's output for this same row
had no heading. This is not a grounding/fabrication problem (the content
itself is properly hedged and adds nothing ungrounded) — it's a
straightforward instruction-following miss on the "no headings" rule,
surfaced by this run and not present in the prior one. Flagged because
task 6 asked not to paper over anything that persisted or newly appeared,
not because it bears on the fabrication question.

## 7. Plain read

**The prompt-level fix worked, and worked by a wide margin, on this
sample.** Severe fabrication went 4/27 (15%) → 0/27 (0%); any-fabrication
went 11/27 (41%) → 1/27 (4%) — computed the same way both times, same
rows, same model, prompt only. Every one of the 4 originally-severe rows
is now fully grounded with nothing beyond the supplied fields. Output
length dropped substantially on thin-data rows, which is the intended
effect of the brevity instruction, not a side effect to correct.

**It did not fully close the gap to zero.** One row (Crystall Lake
Horseman Trailhead) still added an ungrounded specific, and a new,
unrelated formatting slip appeared on a different row. Both are real, on a
27-row sample, and both are reported rather than rounded away. Whether a
~4% residual any-fabrication rate on a controlled sample this size is
acceptable, needs a second prompt-tuning pass, or needs a separate
verification layer (e.g., a cheap second pass that checks each generated
sentence against the literal prompt fields before anything is persisted)
is **an open question this task was not asked to resolve** — the task was
to measure whether prompt-level fixes closed the gap, and the honest answer
is: mostly, not completely, on this sample size. A 27-row sample is also
too small to certify a 0%-vs-4% difference as reliable at any larger scale
— the right read is "the fix clearly worked," not "the fix is proven
sufficient at full-corpus volume."

## Summary

| | |
|---|---|
| Rows | 27 (same IDs as the prior pilot) |
| Model | `claude-sonnet-4-5` (same as prior) |
| Re-run cost — measured | $0.0526 (11,812 in / 1,145 out tokens, 0 errors) |
| Prior run cost — measured (for reference) | $0.0641 (7,798 in / 2,713 out tokens) |
| Any-fabrication rate | 41% (11/27) → **4% (1/27)** |
| Severe-fabrication rate | 15% (4/27) → **0% (0/27)** |
| All 4 prior severe cases | fixed — no invented numbers/names remain |
| Residual issue | 1 row still adds an ungrounded region name (Crystall Lake Horseman Trailhead) |
| New issue surfaced | 1 row violates the "no headings" style rule (Electrify America) |
| Open question, not resolved here | whether a second verification layer is needed before scaling, or a further prompt pass is sufficient |
