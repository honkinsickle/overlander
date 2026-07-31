# Trip creation — the client surfaces

**Point-in-time: 2026-07-26.** First deliberate trace of the USER-FACING half of
trip creation: the forms, what they collect, what the code renders while a trip
is being made, and what it does when creation degrades.

> ## ⚠️ SUPERSEDED IN PART — 2026-07-27 (the wizard swap, #159–#163)
>
> **This file traced the world one day before it inverted.** The trace itself was
> accurate; five PRs then changed the exact facts it centres on. The structural
> analysis (form intake, step model, degradation behaviour, the anon-branch
> finding) still holds. **These specific claims do not:**
>
> | Claim as written | Actual, 2026-07-27 |
> |---|---|
> | Expedition writes to `reference_trips` (§ intro, § write target, § "no way to find it") | Writes an **owned `public.trips` row** — `owner_id` from the session, `state: "active"`, `reference_id: null` (#160). It **is** editable and findable. |
> | Legacy has **3 UI entry points** | **Zero.** #161 moved the root CTA; #162 repointed the `/trips` empty state and draft cards. No `<Link href="/plan">` remains in `web/src` `[grep]`. |
> | Expedition is **unlinked** | It is the **only** linked creation path. |
> | Expedition persists **TEST project only** | Runs on **PROD** (#163). The TEST-only rail was removed from the trip write and **narrowed to the corpus call**. |
> | Expedition **not live in production** | `ENABLE_PLANNER_WIZARD` **is set in Vercel Production** and `/plan/expedition` returns 307 → sign-in there. Generation still fails with `missing_key` — `ANTHROPIC_API_KEY` is unset. |
>
> **SUPERSEDED AGAIN 2026-07-28 — the legacy wizard is DELETED, not merely
> unreachable.** The paragraph that stood here said `/plan` "remains a live route
> handler that mints a draft on GET … deleting the route is 4b, a separate, gated
> step." 4b landed as **#166** and 4c as **#167**: `app/plan/route.ts` and
> `app/plan/[id]/**` are gone, `/plan` **404s**, and the trips-domain residue
> (`createUserWizardTrip`, `writeWizardSlice`, `UserTripSummary.wizardStep`,
> `Trip.wizard`) is unwound. **The expedition wizard is the only creation path in
> the codebase.** The prefetch guard discussed below therefore guards nothing;
> read that section as history.
>
> `ANTHROPIC_API_KEY` **is** now set in Vercel Production and a PROD generation
> has succeeded end to end, so the `missing_key` blocker in the table above is
> also discharged.
>
> Two things the deletion did **not** settle, both live: `state = 'draft'` is
> still creatable by three paths that have nothing to do with the wizard
> (`duplicateTrip`, `setTripState`, the column default) — see `BACKLOG.md`
> §"Draft trips after the wizard swap"; and `lib/plan/types.ts` survives with one
> consumer using 4 of its 17 exports.
>
> **The "naive expectation is inverted" observation below has itself inverted.**
> It is now the ordinary arrangement: the LLM wizard is the fronted path and the
> legacy wizard is the vestigial one. Corrected in place in the table; the
> original sentence is left so the reversal is legible.

## Why this is its own file

[`generation-pipeline.md`](generation-pipeline.md) traces the **server** half of
one creation surface — form intake → `preComputeFacts` → `generateAndAudit` →
`bakeGeneratedDays` → `itineraryToTrip` → persist. This file is the **client**
half, and it is scoped wider than that pipeline on purpose: there are **two**
creation surfaces in this repo, and **the one that is live in production never
touches the generation pipeline at all**. It builds days through
`buildRouteAwareDays` / `buildDaySuggestions`, a completely disjoint code path.

Folding that into a file titled *"how a trip is WRITTEN"* — whose every section
is about the LLM path — would put a non-generation pipeline inside a
generation doc. So: separate file, cross-linked. Specifically **not** duplicated
here:

- The generation stages, the LLM boundary, field provenance, and what persists —
  [`generation-pipeline.md`](generation-pipeline.md).
- How a stored trip is served — [`trip-resolution.md`](trip-resolution.md).
- How tiles and details render — [`place-render-model.md`](place-render-model.md).

## Why this doc states its evidence

Same rule as [`trip-resolution.md`](trip-resolution.md): every claim states how
it was verified — `[read source]`, `[grep]`, `[observed in browser]`. Claims not
verified this session are marked `[UNVERIFIED]` and stay that way.

**This trace was conducted without ever submitting the form.** Submitting
generates a trip: it calls an LLM, calls Google, and writes to `reference_trips`.
Therefore **every statement below about in-flight state, error surfaces, and the
post-creation landing is derived from static code analysis**, not observation.
No duration is estimated anywhere in this document, because duration is not
knowable from source. The browser was used only to read the form's static DOM.

---

## 0. Headline — no degradation signal reaches any component

`generateExpeditionTripAction` returns a discriminated union `[read source:
expedition-actions.ts]`:

```ts
export type GenerateResult =
  | { ok: true; tripId: string; days: number; note?: string }
  | { ok: false; error: string };
```

The success arm carries **two** fields beyond `tripId`: a `days` count and an
optional `note`. The `note` is the pipeline's only degradation signal — it is set
when `generateAndAudit` returns a non-empty `unresolved`, i.e. the structural
violations that survived `REGEN_BUDGET` regeneration attempts `[read source:
generate.ts, where `unresolved: outcome.structural.length > 0 ? outcome.structural : null`]`:

> "Generated, but some anchors couldn't be fully reconciled — review the plan."

**Nothing reads it.** `ExpeditionWizard.submit` is the sole consumer of this
action `[grep: `generateExpeditionTripAction` has exactly three hits repo-wide —
the definition, the import, and the one call site]`, and it destructures only
`ok`, `error`, and `tripId` `[read source]`:

```ts
const res = await generateExpeditionTripAction(form);
if (!res.ok) { setServerError(res.error); return; }
router.push(`/trip/${res.tripId}`);
```

So `note` and `days` are computed, returned across the server-action boundary,
and **discarded on arrival**. There is no component in the repo that renders
either.

This compounds with a second fact: **there is no toast, snackbar, banner, or
alert system anywhere in this codebase.** No such library is in `web/package.json`;
`components/ui/` contains exactly four primitives (`button`, `checkbox`,
`drawer`, `popover`); the root `RootLayout` mounts only `SwRegister`, `children`,
and `modal` — no provider of any kind `[read source; grep for
`toast|sonner|snackbar|Toaster|useToast` across `web/src` returns only fixture
text and comments; grep for `<Toaster|<Toast|<Snackbar|<Banner|<Alert` JSX
returns zero]`. So even if a future author wanted to surface `note`, there is no
host component to hang it on.

**Consequence.** Per [`generation-pipeline.md`](generation-pipeline.md) §6, a
generated trip can persist with structural violations, and a missing
`GOOGLE_PLACES_API_KEY` silently drops every tier-2 name while the action still
returns `ok: true`. Neither reaches the user:

- The **no-key** case does not even set `note` — `note` keys off `unresolved`
  (structural audit), not off tier-2 resolution status. So the single most
  degrading failure mode is signalled by *nothing at all*, not merely by an
  unread field `[read source: expedition-actions.ts, resolve.ts]`.
- The **structural-violation** case sets `note`, which is then dropped.

**Is a degraded trip distinguishable in the persisted payload?** Partly, and not
by anything the creation flow reads. `SILENT_FLAG_KINDS` in `to-trip.ts` filters
`dropped-poi`, `dropped-overnight`, and `distance-snapped` out of `notes`, and
the `AuditReport` is not persisted at all — so a dropped key stop leaves no trace
in the stored payload `[generation-pipeline.md §5, §6; not re-verified this
session]`. A *critical* structural flag does reach `notes`, which the trip-view
surface renders. But that is the read path, after the redirect — **no component
in the creation flow reads any degradation-bearing field** `[read source: the
creation flow's full component tree, enumerated in §5]`.

---

## 1. How many ways can a trip be created

**Two surfaces, not three.** The handoff's third candidate — the anon `TRIPS`
path — is not a separate surface; it is the **anonymous branch of the legacy
wizard's finalize action** (§1.3).

| | **Legacy 5-step wizard** | **Expedition wizard** |
|---|---|---|
| Entry route | `/plan` (route handler) → `/plan/[id]/<step>` | `/plan/expedition` |
| Feature gate | **none** | `ENABLE_PLANNER_WIZARD`, else `notFound()` |
| Linked from the UI *(as of 2026-07-26)* | **yes, 3 entry points** | **no — zero links** |
| **Linked from the UI (2026-07-27, #161+#162)** | **no — zero links** | **yes — the only linked path** |
| Day-building pipeline | `buildRouteAwareDays` → `buildDaySuggestions` | `preComputeFacts` → `generateAndAudit` → `bakeGeneratedDays` |
| Calls an LLM | no | yes |
| Write target *(as of 2026-07-26)* | authed: `public.trips` UPDATE · anon: in-memory `TRIPS` | `reference_trips` (TEST project only) |
| **Write target (2026-07-27, #160+#163)** | unchanged | **owned `public.trips` row** — `owner_id` from session, `state:"active"`, `reference_id:null`; runs on PROD |
| Live in production | **yes** (route live; unlinked) | **flag ON in Production**; renders, but generation fails `missing_key` |

The naive expectation is inverted: **the newer, LLM-backed expedition wizard is
the gated, unlinked one; the legacy 5-step wizard is unflagged and fronted by the
site's primary call to action.**

### 1.1 The legacy 5-step wizard — LIVE, and it is the product's front door

Step order is declared once, as `PLAN_STEPS` in `lib/plan/types.ts`:
`going → vehicle → interests → stops → loader` `[read source]`. Display numbering
is not 1–5 — `STEP_DISPLAY_NUMBER` maps them to 2–6 against
`TOTAL_DISPLAY_STEPS = 8` `[read source]`.

**It is behind no feature flag.** `ENABLE_PLANNER_WIZARD` is read in exactly one
function, `isExpeditionWizardEnabled`, which has exactly two consumers — the
expedition page and the expedition action `[grep]`. Grepping every legacy step
page for a gate returns only `if (!state) notFound()`, an id-existence check
`[grep across `app/plan/[id]/`]`.

Nor is it gated at the edge. Next.js 16 renamed `middleware.ts` to `proxy.ts`,
and this repo **does** have one — `web/src/proxy.ts`, which the build reports as
`ƒ Proxy (Middleware)`. Its matcher runs on every page navigation, but its entire
body is `return updateSupabaseSession(request)` — a Supabase session refresh. It
performs no routing, no authorization, and no feature gating `[read source:
web/src/proxy.ts]`. *(Called out explicitly because the obvious grep — for
`middleware.ts` — finds only the Supabase helper under `lib/supabase/` and
wrongly suggests there is no edge hook at all.)*

**Three UI entry points** `[grep for `href="/plan"`]` — **all three removed
2026-07-27; see the superseded block at the top. Zero remain.**

1. ~~`EntryScene` — the `"Create a Trip"` CTA, rendered by `Home` at the site
   root.~~ **Repointed to `/plan/expedition` (#161.)**
2. ~~`app/trips/layout.tsx` — the `"Plan a new trip"` empty-state link.~~
   **Repointed to `/plan/expedition` (#162.)**
3. ~~`components/trips/trip-card.tsx` — draft cards deep-link back *into* the
   wizard mid-flow at `/plan/<id>/<wizardStep>`.~~ **Now open `/trips/<id>`
   (#162.)** The `wizardStep` field that fed this is dead but not yet deleted.

Both `/plan` links set `prefetch={false}`, paired with a prefetch guard in the
route handler: `GET` returns a bare 204 when
`next-router-prefetch === "1"`, because Next auto-prefetching a visible
`<Link href="/plan">` would mint a draft and clobber the in-flight wizard cookie
`[read source: app/plan/route.ts]`.

`/plan` itself is a **route handler, not a page** — it renders nothing. It mints
a trip and redirects. It must be a handler because the anonymous path writes
`Set-Cookie`, which an RSC cannot do `[read source]`.

### 1.2 The expedition wizard — gated and unreachable from the UI

`/plan/expedition` calls `notFound()` unless `isExpeditionWizardEnabled()`
`[read source: app/plan/expedition/page.tsx]`. The action re-checks the same gate
and additionally refuses unless the Supabase project ref resolves to the label
`"TEST"` `[read source; covered in generation-pipeline.md §Stage 0]`.

**Nothing in the app links to it.** A grep for `plan/expedition` across `web/src`
returns only the page's own imports — no `href`, no `router.push` `[grep]`. It is
reachable only by typing the URL with the flag on.

The flag is set in exactly one in-repo file, `web/.env.development.local`
(`ENABLE_PLANNER_WIZARD=true`), which Next loads only in development; it is
absent from `.env.local`, `.env.test.local`, and `.env.local.example`
`[grep]`. **The existing assertion that "prod never sets it" is stronger than the
evidence supports**: no `vercel.json` exists in the repo and dashboard
environment variables are not in source, so production's actual value is
`[UNVERIFIED]`. What *is* verified is that nothing in the repo sets it outside
development.

### 1.3 The anon `TRIPS` path — a branch, not a surface

`finalizeTripAction` in `lib/plan/actions.ts` is the legacy wizard's single
finalize entry point, and it branches on `isUserTripId(draftId)` `[read source]`:

- **Authed (UUID)** — does *not* call `createTrip`. It updates the existing row:
  `supabase.from("trips").update({ title, state: "active", payload })`, then
  `revalidatePath("/trips")`.
- **Anonymous** — mints `trip-<8char>` and calls `trips.createTrip(trip)`, whose
  entire body is `TRIPS[trip.id] = trip; return trip;` `[read source:
  trips/repository.ts]`. `TRIPS` is the `globalThis`-pinned in-memory fixtures
  map — ephemeral, never persisted to Supabase
  `[trip-resolution.md; re-confirmed by grep: `createTrip` has exactly two hits
  repo-wide, the definition and this one call]`.

**Correction to the recorded fragment.** The `TRIPS` module is the anon-trip
store as described, but the *draft* stage is no longer in-memory: `/plan`'s anon
path writes drafts to a **cookie** (`__plan_drafts`, base64 JSON, `MAX_DRAFTS = 5`,
30-day maxAge) via `writeDraftsToResponse` in `lib/plan/cookie-store.ts`, whose
own header says it "Replaces the legacy in-memory `DRAFTS` map" `[read source]`.
Only the *finalized* `trip-<8char>` is in-memory. This matters in production:
drafts survive lambda hops, finalized anon trips do not.

### 1.4 Dead code found in passing

`buildDaySuggestions` is called from exactly one place — `buildRouteAwareDays` in
`lib/plan/actions.ts` `[grep: 4 hits, being the definition, an import, a comment,
and one call]`. The expedition action imports a disjoint set and never references
it `[read source]`. So the fragment holds: **the legacy wizard is its only
caller**, and retiring the legacy path would orphan `day-suggestions.ts`.

`MAX_SEGMENT_SUGGESTIONS = 30` is confirmed, module-private in
`day-suggestions.ts` `[grep: 2 hits — the declaration and the one use]`. It caps
**only** the flat `all` list, after a photo-bearing-first sort, and is applied
in-memory *after* the upstream fetch completes — it does not cap `byCategory` and
does not reduce fetching. It is per-day-segment, not per-trip `[read source]`.

---

## 2. The expedition wizard form — every input

`ExpeditionWizard` is a client component holding all state in `useState`. **There
is no `<form>` element and no HTML form submission** — the submit control is
`<button type="button">` whose `onClick` calls the server action with a plain JS
object `[read source; observed in browser — static DOM only: the accessibility
tree contains `main` → `region`s → a bare `button`, no form]`.

| Field | Control | Type | Default | Required | Validation |
|---|---|---|---|---|---|
| `destinations[]` | `LocationAutocomplete` rows | 2–8 ordered | 2 empty rows | yes | ≥2; every row non-empty; **every row must carry `coords`** |
| `.datePin` | segmented toggle | `"fixed" \| "flexible"` | `flexible` | — | — |
| `.date` | **native `<input type="date">`** | ISO date | `null` | only if `fixed` | "A FIXED destination needs a date." |
| `.dwell` | `Stepper` | number 0–30 | `0` | no | clamped by control |
| `.note` | text input | string \| null | `null` | no | — |
| `startDate` / `endDate` | `DateRangeInput` (custom) | ISO `yyyy-MM-dd` | `""` | yes | both set; `start <= end` |
| `objective` | text input | string | `""` | no | — |
| `budget` | `<select>` | `budget\|mid\|premium` | `mid` | — | — |
| `returnRouting` | `<select>` | `shortest\|scenic\|same\|loop` | `shortest` | — | — |
| `maxDailyDriveMi` | range slider | 100–700 step 25 | `350` | — | must be `> 0` |
| `bufferDays` | `Stepper` | number 0–30 | `0` | no | — |
| `avoid[]` | chips | rock-crawl, tolls, ferries, rushed legs | `[]` | no | — |
| `vehicleId` | `<select>` | fixture id | first vehicle | yes | "Pick a vehicle." |
| `rig.build[]` | chips | 8 options | from vehicle | no | — |
| `rig.fuelRangeMi` | `Stepper` | 50–1000 step 10 | from vehicle | — | — |
| `rig.capability` | `<select>` | `mild\|moderate\|avoid-hardcore` | from vehicle | — | — |
| `rig.groupSize` / `rig.skill` | free text | string | from vehicle | — | — |
| `rig.preferences[]` | chips | 5 options | from vehicle | no | — |

All validation is `validateExpeditionForm`, a pure function returning the **first**
failure message or `null` `[read source: expedition.ts]`. It runs on every render
to drive `isValid` (which disables the submit button) and again inside the server
action `[read source]`. **Since #178 it also enforces the planning region — §2a.**

### 2a. The planning-region constraint (added #178, 2026-07-31)

Trip creation is restricted to **CA, NV, UT, AZ, WA, OR**. Three facts about
*where* the constraint lives, because each was a deliberate choice:

**One constant, one module.** `web/src/lib/plan/planning-region.ts` exports
`PLANNING_REGION_CODES` and a display string. Widening the region is a one-line
diff there and nothing else hardcodes a state code `[grep, 2026-07-31]`.

**Region codes, not a bounding box.** The check reads Mapbox's
`context.region.region_code` — already present in the geocoding response this
component parses. A box over the six states would contain **Idaho entirely**,
western Montana, western Wyoming, and a strip of Baja/Sonora. (It would *not*
meaningfully contain Colorado or New Mexico: UT/AZ's eastern border **is**
CO/NM's western border, the Four Corners meridian at −109.045°.) Resolving
coords → state properly would need polygon data and a point-in-polygon
dependency in `web/`, which it does not have.

**Two enforcement points, one implementation.**

1. **The autocomplete filters before render** — an out-of-region suggestion is
   dropped in `location-autocomplete.tsx` and never becomes an option, so it
   cannot be picked. The filter is **strict**: a suggestion Mapbox did not tag
   with a `region_code` is dropped too, because it cannot be *proved* in region.
2. **`validateExpeditionForm` is the backstop**, and
   `generateExpeditionTripAction` calls it server-side before any spend. Its
   guards run **flag → sign-in → `validateExpeditionForm`**; there is no separate
   region guard in the action `[read source, 2026-07-31]`. Putting the check in
   the shared validator rather than duplicating it in the action was deliberate —
   one implementation covers the client gate and the server backstop.

**The region stops here and does not reach the pipeline.** `region` is carried on
`ExpeditionDestination` purely so it can be checked; `expeditionToGenerationInput`
does not copy it onto `Anchor` (§3). It exists to be *checked* before generation,
not to be planned with.

**Failure mode to know about: it is silent.** A dropped suggestion produces no
error and no log — an out-of-region search and a geocoder returning untagged
features look identical (an empty dropdown). The wizard's destination hint states
the six states so a user is not left guessing, but if places start vanishing
unexpectedly, an **absent `region_code`** is the first thing to check.
Availability was measured at **26/26 features across six live forward queries
`[measured 2026-07-31]`** — six well-known US city names, which is a sample, not
a rate over the whole `country=us,ca&types=place` space.

### The destination autocomplete

`LocationAutocomplete` is backed by the **Mapbox Geocoding v6 forward endpoint**,
debounced 250 ms, using `NEXT_PUBLIC_MAPBOX_TOKEN`, with a fresh `AbortController`
per keystroke `[read source]`. The query is hardcoded:

```
?q=<text>&country=us,ca&types=place&limit=5
```

It resolves to `{ label, coords: [lng, lat] }`, where `label` is the place name
plus a region code (`"Santa Rosa, CA"`) and `coords` come straight from the
Mapbox feature geometry.

**Two consequences worth recording:**

1. **The wizard structurally cannot plan a trip outside the US and Canada.**
   `country=us,ca` bounds the suggestions, and validation *requires* every
   destination to carry `coords`, which are obtainable only by picking a
   suggestion. There is no freeform escape hatch `[read source]`.
2. `types=place` restricts results to populated places — no addresses,
   neighborhoods, POIs, or admin regions `[read source, per the in-file comment]`.

The component also emits hidden `<name>Lng` / `<name>Lat` inputs. **These are
vestigial on the expedition path** — that wizard reads the `onSelect` callback
into React state and never submits an HTML form. ~~The hidden inputs exist for the
legacy `GoingForm`, which the component's own docstring says "ignores this and
reads the hidden fields".~~ **CORRECTED 2026-07-31: `GoingForm` no longer exists
— #166 deleted the legacy 5-step wizard, so the inputs now have ZERO consumers**
`[grep across `web/src`, `web/scripts`, `data/`, `supabase/` for the form-data
keys and for `FormData`/`formData.get`, both specifier forms, 2026-07-31]`. They
are **orphaned DOM, not vestigial-but-used**; the component's docstring was
corrected in #178 and the inputs deliberately left in place as unrelated cleanup.
Removal is backlogged — `docs/BACKLOG.md` §"Orphans created by PR 4b". Do not
build on them.

### The date picker

`DateRangeInput` renders **two buttons** (Start / End) that both open one
shared `react-day-picker` two-month calendar in a popover `[read source; observed
in browser — static DOM only: both are `button type="button"`, not date inputs]`.

**Why custom rather than native** is not documented in source. The observable
reason is that it is a *range* control: one popover edits both endpoints with a
shared `DateRange`, which two native `<input type="date">` fields cannot express
`[read source — inference from the component's structure, not a recorded
rationale]`.

It writes two hidden inputs, `tripStart` and `tripEnd`, as ISO `yyyy-MM-dd`
`[observed in browser — static DOM only]`. **As with the autocomplete, the
expedition wizard does not read them** — it takes the `onChange(start, end)`
callback into `startDate` / `endDate` state. The hidden inputs serve the legacy
form `[read source]`.

**Correction to the recorded fragment.** "Date fields are hidden inputs driven by
a custom picker, not native date inputs" is **half wrong**. The custom picker and
the hidden inputs are real, but (a) the hidden inputs are dead on this path, and
(b) the expedition wizard **does** contain a native `<input type="date">` — the
per-destination FIXED date, rendered conditionally on `d.datePin === "fixed"`
`[read source: expedition-wizard.tsx]`. It is absent from the default DOM only
because `datePin` defaults to `"flexible"` `[observed in browser — static DOM
only]`.

### The vehicle selector

**Confirmed: an in-memory fixture, not a table.** `lib/vehicles/repository.ts`
holds a `globalThis`-pinned store seeded with three vehicles — a 2004 Lexus
GX 470, a 2019 Toyota Tacoma TRD Off-Road, and a 2022 Rivian R1T. There is no
Supabase read anywhere in the module `[read source]`. `listVehicles` sorts by
year descending, so the default selection (`vehicles[0]`) is the **2022 Rivian
R1T** `[read source; observed in browser — static DOM only: the select's selected
option is `veh-rivian-r1t`]`.

**What a vehicle actually contributes downstream** is narrower than it appears
`[read source: expedition.ts `expeditionToGenerationInput`]`:

- `vehicleTitle(v)` — the string `"2022 Rivian R1T"` — becomes `rig.vehicle`.
- `v.rig` **pre-populates** the rig controls, which the user may then override.
  What reaches the pipeline is the *edited* `form.rig`, not the vehicle's.
- `vehicleId` is **never sent**. It exists only to drive the `<select>`, look up
  the rig, and satisfy validation.
- `Vehicle.capabilities` (`["OFF-ROAD", "ELECTRIC", "AWD"]`) is **never sent** —
  its own docstring says "DISPLAY only", and its sole consumer is the legacy
  `vehicle-card.tsx` `[read source; grep for `.capabilities`]`.

The garage is in-memory, so the section hint **"Saved on the vehicle — reused
across trips."** overstates durability: `lib/vehicles/types.ts` notes in its own
comment that "saved" persists only until server restart `[read source]`.

---

## 3. What reaches the pipeline

`expeditionToGenerationInput` is pure and total — it maps every collected field
into `GenerationInput` `[read source]`. ~~Nothing is dropped in the mapping
*except* `vehicleId` (§2).~~ **CORRECTED 2026-07-31 (#178): TWO fields are now
dropped — `vehicleId` (§2) and `ExpeditionDestination.region` (§2a).** The
mapper builds each `Anchor` field by field (`place`, `role`, `datePin`, `date`,
`dwell`, `note`, and conditionally `coords`) and does not copy `region`
`[read source, 2026-07-31]`. That omission is **deliberate and load-bearing** —
see §2a. But "reaches the pipeline" and "influences generation" are
different questions:

| Field | Reaches `GenerationInput` | How it is consumed |
|---|---|---|
| `destinations[].place` / `coords` | `anchors[].place` / `.coords` | **mechanical** — coords used verbatim, geocode only as fallback |
| `destinations[].datePin` / `.date` | `anchors[].datePin` / `.date` | prompt only |
| `destinations[].dwell` / `.note` | `anchors[].dwell` / `.note` | prompt only |
| `maxDailyDriveMi` | `params.maxDailyDriveMi` | **mechanical** — the only `TripParams` field the engine reads: `maxDistanceM: params.maxDailyDriveMi * METERS_PER_MILE` into `segmentByPace` |
| `startDate` / `endDate` | `params.*` | prompt only (day-span instruction) |
| `budget`, `bufferDays`, `avoid`, `returnRouting` | `params.*` | **prompt only** |
| `rig.*` (7 fields) | `rig` | **prompt only** |
| `objective` | `objective` | **prompt only**, explicitly labelled tone context |

`buildFactsMessage` `JSON.stringify`s `params` and `rig` wholesale into the user
turn, so every field does reach the model `[read source: master-prompt.ts]`.

**The distinction that matters:** apart from anchor coords and
`maxDailyDriveMi`, **no form field is enforced by code.** `budget`, `avoid`,
`returnRouting`, `bufferDays`, and the entire rig profile are advisory text in a
prompt. `objective` is explicitly fenced — the prompt instructs the model to use
it "as tone/priority context, NOT as a fact source" `[read source]`.

So the honest answer to "which fields are collected and discarded" is: **none is
discarded, but only two are binding.** A user who sets `avoid: ["ferries"]` has
expressed a preference the model may honour; nothing verifies that it did.
`[UNVERIFIED: whether the audit checks any `params` constraint other than
mileage — the audit's rule set was not traced this session.]`

---

## 4. In-flight rendering logic — static analysis only

### The expedition wizard

**One state variable drives it:** `pending`, from
`const [pending, startTransition] = useTransition()` `[read source]`. It gates
exactly two things — the button's `disabled`, and a ternary on the button's
children:

```tsx
{pending ? (<><Loader2 className="animate-spin" /> Generating your expedition…</>)
         : ("Generate the expedition")}
```

That is the **entire** in-flight surface. Specifically:

- **No progress indicator** beyond an indeterminate spinning icon.
- **No step counter.** The action performs at least five distinct stages; the UI
  distinguishes none of them.
- **A single static label**, not a sequence.
- **No `aria-live` region and no `aria-busy`** — the label swap is not announced
  `[read source]`.
- The rest of the form stays mounted, enabled, and editable while pending. Only
  the submit button is disabled `[read source]`.

**Correction to the recorded fragment.** "An in-flight state renders as
`Rendering…`" is **wrong**. The string `Rendering` does not occur anywhere in
`web/src` `[grep: zero hits]`. The in-flight label is **"Generating your
expedition…"**. The submit-control fragment *is* correct: it reads **"Generate
the expedition"** `[read source; observed in browser — static DOM only]`.

### Timeout, abort, and retry

**There is exactly one timeout in the entire generation call chain, and it is not
on the LLM.** A grep for `maxDuration|AbortController|AbortSignal|signal:|timeout|setTimeout`
across `expedition-actions.ts`, `facts.ts`, `generate.ts`, `bake.ts`, and
`resolve.ts` returns a single hit: `AbortSignal.timeout(8000)` on the Google
Places fetch in `resolve.ts` `[grep]`.

Therefore, **from source**:

- **No timeout on the Anthropic call.** `client.messages.stream(...)` is invoked
  with no `signal` and no deadline `[read source: generate.ts]`.
- **No timeout on `preComputeFacts`** (routing, geocoding, corpus RPCs).
- **No timeout on the Supabase upsert.**
- **No `export const maxDuration`** on the action or any route in `web/src`
  `[grep — the `maxDurationS` hits in `plan/actions.ts` and `segment-by-pace.ts`
  are an unrelated homonym meaning driving hours per day]`.
- **No error retry anywhere.** `REGEN_BUDGET = 2` is a *quality* loop — it
  re-prompts the model when the audit finds structural violations — not an error
  retry `[read source: generate.ts]`.

The client's only retry affordance is the submit button itself: on failure
`pending` returns to `false` and `isValid` is unchanged, so the button re-enables
and a second click re-runs the whole generation. There is no distinct "Try again"
control and no preserved partial result `[read source]`.

### Navigating away mid-generation

What is verifiable from source: **there is no client-side cancellation wiring at
all.** No `AbortController` is created in `submit`, none is passed to the action,
and there is no unmount cleanup — `startTransition` is fire-and-forget from the
component's perspective `[read source]`.

The `tripId` is minted *inside* the action (`expedition-${Date.now().toString(36)}`)
and returned only after the upsert. So if the action runs to completion after the
client is gone, the trip persists to `reference_trips` and **the user has no way
to learn its id** — it appears in no listing (§6).

> **Superseded 2026-07-27 (#160).** The id is no longer minted in the action —
> `public.trips.id` is `uuid default gen_random_uuid()` and the DB value is
> authoritative (`payload.id` is a `""` placeholder). The orphan case is now
> **benign**: a trip completed after the client disconnects is an owned row with
> the user's `owner_id`, so it **does** appear in `listUserTrips` and the user
> simply finds it on `/trips`. This was one of the concrete harms the swap fixed.

Whether the Next.js runtime actually aborts an in-flight server action when the
client disconnects is platform behaviour, not repo behaviour, and was not
determined `[UNVERIFIED]`.

### The legacy wizard's loader — a different design

Worth contrasting, since this is the one users actually reach. `LoaderPanel`
renders **fake staged progress** `[read source]`:

- `SUB_STEPS` is a hardcoded three-item array — "Analyzing your route",
  "Cross-referencing 38M+ trips", "Matching results to your preferences" —
  advanced by a `setInterval` at `STEP_DURATION_MS = 3000`. It reflects
  wall-clock only; it is **not** wired to the finalize pipeline's real stages.
- **Ordering is animation-first, work-second.** The interval runs to completion
  and sets `animationDone`; a *separate* effect then fires `finalize()`. So the
  real work does not begin until the animation ends, and total time is
  animation + work rather than the larger of the two. The two-effect split is
  deliberate — an in-file comment records that kicking finalize from inside the
  state updater raced Next's router update.
- Hardcoded copy: **"~10 SECONDS · DO NOT CLOSE THIS WINDOW"**.
- **No timeout, no watchdog, no polling.** `buildDaySuggestions` accepts an
  optional `signal?: AbortSignal`, but `actions.ts` calls it without one — the
  cancellation hook exists and is unused `[read source]`.
- It **does** have a real retry affordance: an `ErrorState` with the copy
  "Something went wrong finalizing your trip." and a **"Try again"** button that
  re-invokes `finalize` without replaying the animation `[read source]`.

So the two surfaces have opposite failure ergonomics: the legacy flow shows
invented progress and a real retry button; the expedition flow shows honest
(if minimal) state and reuses the submit button.

---

## 5. Degradation and failure — component parity

### What the creation flow's tree actually contains

Enumerated by reading every file under `app/plan/**` (8 files) and
`components/plan/**` (21 files) `[read source]`. The complete set of feedback
surfaces:

| Surface | Where | Renders on |
|---|---|---|
| Inline error paragraph | `ExpeditionWizard` | `serverError ?? validationError` |
| Inline `<p role="alert">` | `GoingForm`, `InterestsForm`, `VehicleForm` | per-form validation string |
| `ErrorState` + "Try again" | `LoaderPanel` | finalize failure |
| Native `alert()` | `VehicleForm` | "Add-vehicle flow ships in a later phase." |

**No toast, banner, or alert component appears anywhere in the creation flow**,
because none exists in the repo (§0). `PlanningCard`, `PlanningLayout`,
`PlanningTopbar`, and `WizardBackdrop` have no banner or alert slot `[read source]`.

`OffCacheBanner` is the only banner-shaped component in the repo. It is **not in
the creation flow — and it is rendered nowhere at all**: the identifier appears
only in its own definition and two doc-comments, and `map-column.tsx` (which its
hook's docstring claims drives it) does not import it `[grep]`. It is dead code,
and it concerns offline tile coverage, not persistence. *(Out of scope — recorded
because the search for banner components surfaced it.)*

### Hard failure

The action returns `{ ok: false, error: string }` for every hard abort — gate
refusal, non-TEST project, validation, `ItineraryGenerationError` (formatted as
`Generation failed (${err.code}): ${err.message}`), persist failure, and any
other throw `[read source]`.

The client sets `serverError` and renders one paragraph, styled with
`text-input-error` on a tinted background, in place of the validation message
`[read source]`. So: **error text, not a blank state and not a silent no-op.**
The raw error string — including the `err.code` and the underlying message — is
surfaced verbatim to the user. There is no error classification, no user-facing
rewording, and no distinction between "your input was bad" and "the LLM API is
down" beyond whatever the message happens to say.

### Soft degradation

Covered in §0. In short: `note` is the only signal, it covers only the structural
case, and nothing reads it.

---

## 6. The post-creation path

### Redirect target

`router.push(`/trip/${res.tripId}`)` `[read source]`.

Both routes that can serve that URL mount the **same canonical slideup** —
`SlideupShell` + `TripSlideupBody` — so the surface is the slideup either way.
`app/trip/[id]/page.tsx` does this deliberately: its docstring records that
intercepting routes catch only soft navigations, so the direct route was made to
mount the canonical surface itself rather than a separate full-page composition
`[read source]`. *(Whether the intercept at `app/@modal/(.)trip/[id]` actually
fires for a push from `/plan/expedition` was not determined — confirming it would
require submitting the form `[UNVERIFIED]`.)*

### Is the trip immediately editable? No.

The gate is `isUserTrip(trip.id)`, a **UUID regex** `[read source:
is-user-trip.ts]`. Both routes compute `canEdit = !isReference && isUserTrip(trip.id)`
`[read source]`.

A generated trip's id is `expedition-${Date.now().toString(36)}` — a slug, **not
a UUID** `[read source: expedition-actions.ts]`. Therefore `isUserTrip` returns
`false` and **`canEdit` is `false`**. The user lands on their freshly generated
trip and cannot edit it. Every `canEdit`-gated surface — the living-plan editor,
the NL-edit box, drag, the kebab — is invisible `[read source:
trip-slideup-body.tsx]`.

The same is true of anon legacy trips: `WizardFinalizeSlideup` passes
`canEdit={isUserTrip(trip.id)}`, and `trip-<8char>` is likewise not a UUID
`[read source]`. **Only the authed legacy path produces an editable trip**,
because only it writes a UUID row to `public.trips`.

### Does it appear in any listing? No. — **REVERSED 2026-07-27 (#160): yes, it does.**

> A generated trip is now an owned `public.trips` row with `owner_id` set and
> `state: "active"`, so `listUserTrips` returns it and it renders on `/trips` as
> an ordinary active trip card. `canEdit` is also true now — the id is a real
> UUID, so `isUserTrip` passes. Verified end-to-end on TEST
> (`ea1f51f7-5e58-47cf-b430-b02d868988cc`). **The analysis below describes the
> pre-#160 world; it is retained because it is the reasoning that justified the
> change.**

`listUserTrips` queries `.from("trips")` — the UUID table `[read source:
list-user-trips.ts]`. A generated expedition trip is written to
**`reference_trips`**, so that query cannot return it. The fallback
`listAnonTrips` filters `id.startsWith("trip-")`, which `expedition-*` does not
match `[read source]`.

**So a generated expedition trip appears in no listing on any surface.** The
redirect URL is the only route back to it. Combined with the navigate-away case
(§4), a trip can be created that the user can never reach again.

### Ephemerality messaging for anon trips — there is none

Anon legacy trips live in the `globalThis`-pinned `TRIPS` map and are lost on
server restart (§1.3). **No user-facing copy anywhere communicates this.**

Every hit for `temporar|unsaved|not saved|will be lost|sign in to save|ephemeral|
in-memory|restart` across `web/src` is a **developer comment**, never rendered
`[grep]`. The rendered strings that touch the concept say the opposite:

- `ExpeditionWizard`: **"Saved on the vehicle — reused across trips."** — the
  garage is in-memory.
- `GoingForm`: the checkbox label **"Save as home address"**.
- `trip-card.tsx` renders a `"Draft"` chip, which conveys "in progress", not
  "will disappear".

The nearest thing to a persistence disclaimer is the expedition wizard's footer,
**"Runs the grounded planner + audit. Persists to the TEST project only."** — but
that describes a database target on a dev-gated route, not ephemerality
`[read source; observed in browser — static DOM only]`.

**Where this was searched**, so the absence is evidenced rather than inferred:
all 8 files under `app/plan/**`; all 21 files in `components/plan/**`;
`app/layout.tsx`; `app/trips/layout.tsx`; `components/chrome/*`; and the
post-finalize surfaces `slideup-shell.tsx` and `trip-slideup-body.tsx`
`[read source + grep]`.

---

## Related

- [`generation-pipeline.md`](generation-pipeline.md) — the server half of the
  expedition path: stages, the LLM boundary, what persists, failure modes.
- [`trip-resolution.md`](trip-resolution.md) — how a stored trip is served, and
  the `TRIPS` store's role.
- [`place-render-model.md`](place-render-model.md) — how the resulting tiles
  render.
- [`itinerary-model.md`](itinerary-model.md) — the shape of a generated trip.
