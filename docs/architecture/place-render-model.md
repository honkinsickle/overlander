# Place Render Model — what a place record carries, and what each surface shows

Durable structural reference for the **place tile → rendered UI** path. Written
to support a comparison between the two surfaces that render the same place
record. **Part 1 (the day-detail card) is complete. Part 2 (the detail slideup)
is deliberately empty** — it is a separate research pass, and the split is the
point: two models measured at once produce a muddle instead of a comparison.

Trip shapes are NOT restated here — see
[`itinerary-model.md` §7](itinerary-model.md) (§7 is the single home for trip
shapes; it is not restated here).

Evidence convention per [`trip-resolution.md`](trip-resolution.md): every claim
states how it was verified — `[read source]`, `[grep]`, `[queried TEST]`,
`[queried PROD]`, `[called endpoint]`. Unsettleable claims are marked
**UNVERIFIED** rather than reasoned to a conclusion.

Paths are relative to `web/` unless noted.

---

## 0. Instruments and DB provenance

Restated rather than assumed, per session discipline. Both connections were
configured by pointing `tsx --env-file=` at a specific env file; the scripts
asserted the project ref before querying and were **read-only selects**.

| Sample | Shape | Where | Connection used |
|---|---|---|---|
| `expedition-ms28y793` (15d, LA→Moab) | generated | TEST `reference_trips` | `--env-file=.env.development.local` → ref `znldzjdatkogdktymtvi`, `SUPABASE_SERVICE_ROLE_KEY` |
| `05b346df-…` (66d fork) | reference-derived | TEST `public.trips` | same as above (service role; RLS bypassed for read) |
| `24f14ecc-a209-45e7-a414-16ecc816bab0` (2d, Tok AK→Dawson YT) | **fork-baked against a real corpus** | **PROD** `public.trips` | `--env-file=.env.local` → ref `nqzeywzcowujzyegxbsr`, `SUPABASE_SERVICE_ROLE_KEY`, **read-only** |

**The screenshot trip was found, on PROD.** Two rows share the title
"Tok, AK to Dawson, YT"; `24f14ecc…` is the match — all 8 named cards from the
screenshot resolve in its pool (Klondike River, Gold Rush Campground, Pan of
Gold, Dawson Lodge, Downtown, Gold Village, Riverwest, Sourdough Joe), while the
other row (`81865432…`) has an **empty pool** (0 tiles) and is not it.
`[queried PROD]` The title is **stored**, not derived — it is present both as the
`trips.title` column and as `payload.startLocation`/`endLocation`. `[queried PROD]`

Not covered, deliberately: the fixture-degraded shape (`la-to-portland`). Its
day payload carries no `corridorCities` and no `segmentSuggestions`
(`itinerary-model.md` §7), so it renders the two-node fallback and contributes no
representative tiles. **No reason found to think its TILE shape differs** — the
same `placePool` normalization and the same card component run; it simply has
fewer/no tiles to feed them. `[read source: components/trip/day-detail-corridor-column.tsx]`

---

# PART 1 — THE DAY-DETAIL CARD (centre column)

## 1. The stored tile

### 1.1 The type, quoted

Tiles in `Day.segmentSuggestions` and `Day.suggestions` are `BrowsePlace`
`[read source: lib/trip-browse/places.ts:33-93]`:

```ts
export type BrowsePlace = {
  id: string;
  coords: [number, number];
  category?: SlideCategoryKey;      // 9 buckets; optional
  photoUrl?: string;                // optional — many sources have none
  photoAlt: string;                 // REQUIRED
  title: string;
  pills: { label: string; status?: boolean }[];
  stats: { label: string; value: string }[];
  mention: { primary: string; secondary: string };
  description: string;
  pullquote: { text: string; name: string; meta: string };
  placeInfo: {
    address: string;
    phone?: { display: string; href: string };
    website?: { display: string; href: string };
  };
  cta: string;
  rating?: number;                  // "never fabricated" per the doc comment
  reviewCount?: number;
  priceTier?: 1 | 2 | 3 | 4;
  source?: "live" | "master_place";
  placeId?: string;                 // Google place_id — the hydrate key
  curated?: boolean;                // LLM key stop
  keyStopNote?: string;             // becomes the card's status line
  milesFromStart?: number;
  mvumCorridor?: boolean | null;
  attribution?: Record<string, string> | null;
  overlanderTags?: string[] | null;
};
```

`Day.waypoints` is a **different type**, `Waypoint`
`[read source: lib/trips/types.ts:289-350+]` — notably `slug`, `subtitle`,
`tip`, `stats`, `tags`, `reliability`, `routeOffsetMi`, `simulator`,
`factualNote`, `logistics`, and **`community: { rating, reviewCount, tips?,
lastVerified? }`** (rating is *nested*, not top-level), with `photoUrl?` and
`coords?` both optional and **no `photoAlt`, no `placeId`**.

### 1.2 Real stored records (fetched, not constructed)

**Generated** — `expedition-ms28y793`, day-13 tile, every field as stored
`[queried TEST]`:

```json
{
  "id": "google:ChIJVfkzzzjZR4cRED_Jagrg_-M",
  "cta": "", "pills": [{ "label": "live-resolved" }], "stats": [],
  "title": "Delicate Arch",
  "coords": [-109.49931240000001, 38.7436297],
  "curated": true,
  "mention": { "primary": "", "secondary": "" },
  "placeId": "ChIJVfkzzzjZR4cRED_Jagrg_-M",
  "photoAlt": "Delicate Arch",
  "placeInfo": { "address": "" },
  "pullquote": { "meta": "", "name": "", "text": "" },
  "description": "",
  "keyStopNote": "view — 3-mi round-trip; go late afternoon for the iconic glow, carry water",
  "milesFromStart": 19
}
```
Note what is **absent**: `category`, `rating`, `reviewCount`, `photoUrl`,
`source`. Note what is **present but empty**: `cta`, `description`, `mention`,
`placeInfo.address`, `pullquote`, `stats`.

**Reference-derived** — fork `05b346df…`, a `day.suggestions` entry
`[queried TEST]`:

```json
{
  "id": "node/3972206999",
  "cta": "Add to day",
  "pills": [{ "label": "Casual" }, { "label": "Local Favorite" }],
  "stats": [],
  "title": "Cantones Restaurant",
  "coords": [-118.0804249, 52.8758258],
  "mention": { "primary": "Sourced from", "secondary": "OpenStreetMap" },
  "photoAlt": "Cantones Restaurant",
  "photoUrl": "https://upload.wikimedia.org/wikipedia/commons/4/4e/Jasper_Connaught_Drive_East.jpg",
  "placeInfo": { "address": "" },
  "pullquote": { "meta": "", "name": "", "text": "" },
  "description": "Cantones Restaurant — food · OpenStreetMap."
}
```
No `placeId`, no `rating`, no `category`. An OSM-derived id (`node/…`).

**Fork-baked (PROD)** — `24f14ecc…`, the screenshot's rating-less card, every
field as stored `[queried PROD]`:

```json
{
  "id": "mp:2df023e2-e005-4686-8a4b-2f36f3803db7",
  "cta": "Add to day",
  "pills": [{ "label": "Campground" }],
  "stats": [],
  "title": "Klondike River",
  "coords": [-139.115311, 64.053505],
  "source": "master_place",
  "mention": { "primary": "Federated", "secondary": "" },
  "category": "camping",
  "photoAlt": "Klondike River",
  "placeInfo": { "address": "" },
  "pullquote": { "meta": "", "name": "", "text": "" },
  "attribution": {},
  "description": "Klondike River — Campground.",
  "mvumCorridor": null,
  "overlanderTags": []
}
```
**There is no `placeId` field on this record at all**, and `mention.secondary` is
`""`. Contrast a rating-bearing neighbour from the same trip: *Gold Rush
Campground* carries `placeId: "ChIJEznHbcnjSFERGJPBdcOXkLk"` and
`mention: { primary: "Federated from", secondary: "google" }`. `[queried PROD]`

---

## 2. The three pool sources

`placePool(day)` unions the three and **normalizes** them into one card-facing
shape, `CorridorPlace` — it does not branch per source downstream
`[read source: components/trip/day-detail-corridor-column.tsx:1067+]`:

| Field on `CorridorPlace` | from `segmentSuggestions` | from `day.suggestions` | from `waypoints` |
|---|---|---|---|
| `id` / `title` / `coords` | ✔ | ✔ | ✔ |
| `category` | `p.category ?? "interest"` (`overnight`→`camping`) | same | `wp.category` (already a `Category`) |
| `photoUrl` | ✔ | ✔ | ✔ |
| `photoAlt` | `p.photoAlt` | `p.photoAlt` | **shimmed to `wp.title`** |
| `rating` / `reviewCount` | top-level | top-level | **`wp.community?.rating` / `.reviewCount`** |
| **`placeId`** | ✔ | **NOT MAPPED** | **NOT MAPPED** |
| `curated` / `curatedMovable` / `milesFromStart` / `keyStopNote` | ✔ (`curatedMovable: true`) | ✗ | ✗ |
| `removable` | ✗ | ✗ | `true` |

**Consequence, and it is load-bearing:** `placeId` reaches the card **only** from
`segmentSuggestions`. Tiles from `day.suggestions` and from `waypoints` can never
be enriched at runtime (§4), regardless of what the underlying record holds.

**Which source dominates, measured per sample:**

| Sample | `segmentSuggestions` | `day.suggestions` | `waypoints` |
|---|---:|---:|---:|
| `expedition-ms28y793` (generated, 15d) | **48** | 0 | 0 |
| fork `05b346df…` (reference-derived, 66d) | 0 | 43 | **92** |
| `24f14ecc…` (fork-baked, PROD, 2d) | **63** | 0 | 0 |
`[queried TEST]` `[queried PROD]`

The two TEST instruments therefore exercise **disjoint** pool sources — the
generated trip is 100% `segmentSuggestions`, the fork is 100%
`suggestions ∪ waypoints`. A conclusion drawn from one does not transfer.

---

## 3. What the card reads and displays

The leaf is **`CategoryListCard`** — confirmed, not assumed: `DayDetailCorridor`
renders it from all three spine positions (`CityNode` cluster + featured,
`KeyStopNode`, `MileTick`) `[read source: components/trip/day-detail-corridor.tsx]`.

### 3.1 What it accepts

The card's own prop type picks **five** fields off the place
`[read source: components/trip/category-list-card.tsx:29-56]`:

```ts
place: Pick<BrowsePlace, "title" | "photoUrl" | "photoAlt" | "rating" | "reviewCount">;
category: BrowseCardCategory;
status?: string;          // status line
verified?: boolean;       // DEFAULT true — see §5
onOpen?; onRemove?; curatedMenu?; editMode?; gripHandleProps?;
```

Everything else on the stored record — `description`, `pills`, `stats`,
`mention`, `placeInfo`, `pullquote`, `attribution`, `overlanderTags`,
`mvumCorridor`, `priceTier`, `milesFromStart`, `coords`, `source`, `curated` —
is **not passed to the card at all** on this surface. `milesFromStart` is
consumed one level up (spine position/gutter mileage), and `curated` decides
featuring vs pool collapse, but neither reaches `CategoryListCard`.
`[read source: components/trip/day-detail-corridor.tsx]`

### 3.2 What it displays, enumerated from source

`[read source: components/trip/category-list-card.tsx:78-244]`

| Rendered element | Source | Behaviour when the input is absent |
|---|---|---|
| Hero, 130×80 | `place.photoUrl` as `backgroundImage` | **Category-coloured block** — `backgroundColor: var(--cat-{category}-badge-bg)` is *always* set; the photo is layered on top only when present (`:113-116`). Never a broken image, never a placeholder graphic. |
| Category icon badge, 36×36 | `category` prop | Always renders (`CategoryIconV2`), over the hero |
| Dark top scrim | — | Always |
| Title `<h3>` | `place.title` | tinted `var(--cat-{category}-title)`; `line-clamp-1` |
| **"yoTrippin Verified"** | `verified` prop | **Always renders here — see §5** |
| ★ + rating | `place.rating` | Star *and* number omitted entirely when `rating === undefined` (`:272`) |
| ( review count ) | `place.reviewCount` | **Nested inside the rating branch** — a tile with a `reviewCount` but no `rating` shows neither (`:281`) |
| Green dot + status line | `status` prop (fed from `keyStopNote`) | Row replaced by an empty `<span/>`; layout holds (`:193-195`) |
| "Details →" | — | Always; `onClick` → `onOpen` |
| ✕ remove | `onRemove && !curatedMenu` | Omitted |
| ⋮ kebab | `curatedMenu` | Omitted |
| Drag grip lane, 47px | `editMode` | Omitted |

**This settles the Klondike River question.** That card shows no rating and no
review count because the stored record has neither and cannot be enriched (no
`placeId`, §6). Its image slot is **not** a photo and not a placeholder image —
it is the flat `--cat-camping-badge-bg` block with the camping (tent) icon badge,
which is exactly the documented no-photo path. `[read source: category-list-card.tsx:106-143]`
`[queried PROD: the record has no photoUrl and no placeId]`

### 3.3 Stored vs runtime, per displayed field

| Displayed | Can come from the stored tile | Can come from runtime enrichment |
|---|---|---|
| title, photoAlt | yes | no |
| category (icon + title colour) | yes | **yes** (`rich.category`) |
| photo | yes | **yes** (`rich.photoUrl`) |
| rating, reviewCount | yes | **yes** |
| status line | yes (`keyStopNote`) | no |
| "yoTrippin Verified" | **neither — it is a component default** (§5) | — |

Measured split per sample `[queried TEST]` `[queried PROD]`:

- **Generated** (48 tiles): **0** stored ratings, **0** stored photos, 44/48 with
  `placeId`, `category` absent on 44/48. Almost everything the card shows beyond
  the title is therefore *runtime*.
- **Fork / reference-derived**: `day.suggestions` 43/43 have a stored `photoUrl`,
  **0** have a rating, **0** have a category, **0** have `placeId`. `waypoints`
  **92/92** have `community.rating` *and* `reviewCount` (stored fixture values),
  11/92 have a photo, 0 have `placeId`. Everything the card shows is *stored*;
  nothing can enrich.
- **Fork-baked (PROD)**: 63 tiles, **0** stored ratings, **0** stored photos,
  60/63 with `placeId`, categories all populated. Ratings/photos in the
  screenshot are therefore all runtime.

---

## 4. The enrichment path, and the capability/use gap

### 4.1 The path

`POST /api/places/details` — body `{ placeIds: string[] }`, response
`{ details: { [placeId]: PlaceRich } }`; de-duped and **capped at 40 ids**;
15-minute in-process LRU cache (max 1000), per-lambda; ~~a null/empty result is
omitted so the tile "stays essentials"~~ **(changed by #149 — see §4.3)**; the
route's own docstring states **"NOTHING is persisted to the DB"**.
`[read source: app/api/places/details/route.ts:19-93]`

Client side, in the column (not the card): one batched POST per mounted-day
change, filtered to `t.placeId && !t.photoUrl && !hydrated[t.placeId]`
`[read source: day-detail-corridor-column.tsx:313]`. **A tile that already has a
stored `photoUrl` is never hydrated** — so on the fork, the 43 photo-bearing
`day.suggestions` would be skipped even if they had `placeId`s.

The response lands in `const [hydrated, setHydrated] = useState<Record<string,
PlaceRich>>({})` — **component state on `DayDetailCorridorColumn`**, keyed by
`placeId`, accumulated across days for the session, discarded on unmount. Purely
ephemeral: never written back to the trip payload. `[read source: day-detail-corridor-column.tsx:277]`

The merge is explicit and lossy `[read source: day-detail-corridor-column.tsx:728-741]`:

```ts
const rich = t.placeId ? hydrated[t.placeId] : undefined;
return rich ? { ...t,
  rating:      rich.rating ?? t.rating,
  reviewCount: rich.reviewCount ?? t.reviewCount,
  photoUrl:    rich.photoUrl ?? t.photoUrl,
  category:    (rich.category === "overnight" ? "hotel" : rich.category) ?? t.category,
} : t;
```

A second consumer of the same cache: the **day hero** reuses a hydrated tile's
photo (`hydrated[destTile.placeId]?.photoUrl`, `:763`).

### 4.2 The three quantities

**CAPABLE — what the endpoint can return.** `PlaceRich`, six fields
`[read source: lib/discovery/google-places.ts:250-261]`:

```ts
export type PlaceRich = {
  rating?: number; reviewCount?: number; priceTier?: 1|2|3|4;
  photoUrl?: string;   // proxied via /api/places/photo
  hours?: string; category?: SlideCategoryKey;
};
```
backed by this upstream mask `[read source: google-places.ts:267-276]`:
```ts
const DETAILS_FIELD_MASK = [
  "id","displayName","types","rating","userRatingCount",
  "priceLevel","photos","regularOpeningHours.weekdayDescriptions",
].join(",");
```

**REQUESTED — what the card side actually issues.** The client sends **only
`{ placeIds }`**; there is no field mask, no query param, no field selection on
the request. The mask is fixed server-side, so the caller cannot ask for less or
more. `[read source: day-detail-corridor-column.tsx:300-305 + route.ts:55-63]`

Observed response, **one call, three known-good ids** (day-13 of
`expedition-ms28y793`: `ChIJVfkzzzjZR4cRED_Jagrg_-M`,
`ChIJB90tfRDfR4cRzbYjW-1r0mM`, `ChIJUd2D2vPhR4cRDMzv0sgUEw8`)
`[called endpoint: 1 request, 3 ids, localhost dev server]`:

```jsonc
{ "details": {
  "ChIJVfkzzzjZR4cRED_Jagrg_-M": { "category": "scenic", "rating": 4.9, "reviewCount": 6677, "photoUrl": "/api/places/photo?ref=…" },
  "ChIJUd2D2vPhR4cRDMzv0sgUEw8": { "category": "food", "rating": 4.1, "reviewCount": 3330, "priceTier": 2,
                                   "photoUrl": "/api/places/photo?ref=…",
                                   "hours": "Monday: 11:00 AM – 9:00 PM; Tuesday: …" },
  "ChIJB90tfRDfR4cRzbYjW-1r0mM": { "rating": 4.9, "reviewCount": 29, "photoUrl": "/api/places/photo?ref=…" }
}}
```
(Third id returned **no `category`** — Google `types` mapped to no bucket.)

**DISPLAYED — what the card renders of it.** Four: `rating`, `reviewCount`,
`photoUrl`, and `category` (indirectly, as icon + title colour).

**The gap.** `hours` and `priceTier` are fetched and then dropped: `priceTier` is
referenced **nowhere** in the column, the corridor, or the card `[grep]`; `hours`
is used by the column only when building the `trip:openDetail` event payload
(`:654`), never by the card. So the request is **not** deliberately compact — it
is fixed and maximal, and the card displays a subset of what it already has in
memory. Two of six returned fields are unused on this surface.

*(Cross-reference: "on this surface" is load-bearing. `priceTier` **is** consumed
elsewhere — `browsePlaceToWaypoint` → `priceTierToEntry` → `logistics.entry` —
but off the **stored tile**, never grafted from the enrichment. See Part 2 §10;
the two statements are consistent, not contradictory.)*

### 4.3 Current behaviour after #149 — empty vs missing

**Google's not-found shape** `[called endpoint: one live call, 2026-07-26]`. An
**invalid** `place_id` returns **HTTP 400 `INVALID_ARGUMENT`**, so `placeDetails`
takes its `!res.ok` branch and returns **`null`** — *not* `{}`. Failure and
resolved-but-empty therefore remain **DISTINGUISHABLE** inside the route, which
is the empirical fact the #149 design rests on.
**Bound:** this exercised an *invalid* id. A **well-formed-but-retired** id was
**not tested**; it would most likely return 404 — also non-2xx, also the `null`
branch — but that is an **inference, UNVERIFIED**. Only a 200 for a nonexistent
place would break the design, and that is not what was observed.

**The change (#149).** `if (rich && Object.keys(rich).length > 0)` → `if (rich)`
`[read source: app/api/places/details/route.ts]`. A resolved-but-empty `{}` now
**rides through** into `hydrated` via the existing spread merge. Because `{}` is
truthy, both retry guards stop asking: the windowing hydrate
(`!hydrated[t.placeId]`) and the fetch-on-open fallback (`!cached`, Part 2 §8
CORRECTION). `null` is falsy, so genuine failures **still stay out and still
retry**. No client change and no type change — every `PlaceRich` field is
optional, so `{}` is a valid `PlaceRich` and the merge sites fall back with `??`.

**The accepted trade.** A **transient** empty — a place that does have data but
momentarily returned none — is now recorded for the rest of the session, so that
tile stays thin **until reload** rather than recovering on a later pass. Accepted
knowingly: the staleness is **bounded** (`hydrated` is ephemeral React state on
the parent column, persisted nowhere, cleared by a reload), whereas the behaviour
it replaces was an **unbounded** retry for the whole session that still rendered
thin anyway.

**UNMEASURED LEG.** That the retry actually *ceases across mounted-set changes*
rests on **code reading, not observation** `[UNVERIFIED]`. The 424px preview pane
never remounted neighbouring days, so the hydration effect had no opportunity to
re-fire and "zero requests" proved nothing. The code-level argument: `{}` is
truthy, `setHydrated` is a plain spread merge, and both guards test truthiness —
there is no branch where present-but-empty behaves as absent. A taller viewport
settles it in one pass.

### 4.4 `MAX_IDS = 40` does NOT self-heal in place

`parsePlaceIds` dedupes then `.slice(0, MAX_IDS)` with **no error and no signal**
— ids past the 40th are silently dropped `[read source:
app/api/places/details/route.ts:19, 55-63]`.

**The hydration effect re-fires ONLY on mounted-set change, never on `hydrated`
updating.** Its dependency array is `[hydrateKey]`, where
`hydrateKey = hydrateDayIds.join("|")` (the mounted day-id set in view mode, the
selected day in edit mode); `hydrated` is **deliberately excluded**, with an
explicit comment and an `eslint-disable` for `react-hooks/exhaustive-deps`
`[read source: day-detail-corridor-column.tsx:283-291, 340-343]`.

**Consequence.** Truncation does not converge within a stable mounted set: the
dropped ids simply **wait**. They are re-asked only when the mounted set next
changes — at which point the already-hydrated ids drop out of the filter, so the
previously-truncated ones may fit. It converges **as the user scrolls**, not on
its own. On the corpus-dense shape this is reachable in practice: `24f14ecc…`
carries 41 tiles on day-1 alone (Part 1 §0), so a window of ~3 dense days exceeds
40 unhydrated ids in one pass and renders **partially thin until the user
scrolls**. Recorded, not fixed.

---

## 5. "yoTrippin Verified" — the gate never closes

**The render condition** `[read source: category-list-card.tsx:165-169, 248-271]`:

```tsx
<VerifiedMeta show={verified} rating={place.rating} reviewCount={place.reviewCount} />
// inside VerifiedMeta:
if (!show && rating === undefined) return null;
…
{show && <span …>yoTrippin Verified</span>}
```

**The flag's origin — traced, and it is not data.**

- The prop is defaulted in the signature: `verified = true`
  `[read source: category-list-card.tsx:68]`, documented as *"Default true (per
  the board)"* (`:38`).
- **No call site on this surface passes it.** `DayDetailCorridor` renders
  `CategoryListCard` from all three spine positions and passes `place`,
  `category`, `status`, `onOpen`, `onRemove`, `curatedMenu`, `editMode` — never
  `verified`. `[read source: day-detail-corridor.tsx]` `[grep: "verified" across
  components/trip — the only prop pass is `day-detail-overview.tsx:458`
  (`place.verified ?? true`), a different surface]`
- **There is no `verified` field in the data at all** — not on `BrowsePlace`, not
  on `Waypoint`, not on `CorridorPlace`. `[grep: lib/trip-browse/places.ts,
  lib/trips/types.ts, components/trip/day-detail-corridor.tsx]`
- **No code path sets it false.** Stated explicitly because that is the finding:
  there is no bake step, no resolve step, no schema default, no mapper, and no
  LLM output that writes it; there is nothing to set.

**Distribution across real tiles** — the honest form of the answer is that the
question does not have a data answer: for all three samples the count is
**0 true / 0 false / 100% undefined at the data layer** (48, 135, and 63 tiles
respectively), because the field does not exist; and **100% true at render**,
because the prop defaults true and is never overridden. `[queried TEST]`
`[queried PROD]` `[read source]`

**So the conditional is decorative on this surface.** "yoTrippin Verified" is an
unconditional label. It renders identically on:
- a tile with a real Google rating (Gold Rush Campground, enriched at runtime);
- a corpus tile with no rating, no photo and no Google identity at all
  (**Klondike River** — the screenshot's rating-less card);
- a fixture waypoint whose rating is a stored constant (`wp-eggslut`,
  `community.rating: 4.2`, `lastVerified: "Mar 2026"`).

The label asserts provenance; nothing in the code checks any. Recorded here as a
grounding observation, not fixed — this session is read-only.

---

## 6. What the tile encodes about enrichment expectations

Signals present on a stored tile, from the type and from real records:
`placeId` (present/absent), id prefix (`mp:` / `google:` / OSM `node/…`),
`source` (`"live"` / `"master_place"` / absent), `category` (present/absent),
`curated`, `mention.primary`/`.secondary`, `attribution`, `overlanderTags`,
`mvumCorridor`, `milesFromStart`, and whether `rating`/`photoUrl` are already
stored. `[read source: places.ts:33-93]` `[queried TEST]` `[queried PROD]`

**`source: undefined` on a `google:` tile is STRUCTURAL, not a bug.** The id
prefix and the `source` field are written by two different code paths that were
never meant to agree: `resolvedToTile` (`lib/itinerary/bake.ts`) mints
`id: "google:<place_id>"` for a tier-2 live-resolved place and **never sets
`source`**, while `source: "master_place"` is set only by the corpus mapper
(`lib/trip-browse/federated.ts`). Neither path is broken — but it means **`source`
is not a reliable discriminator** for provenance on generated trips; the id prefix
is. `[read source: lib/itinerary/bake.ts, lib/trip-browse/federated.ts]`

**The narrow question: can any combination distinguish a tile that legitimately
has no Google presence from one that should have enriched and failed?**

**Partially — and the split is clean at exactly one boundary.**

- **"No Google presence" IS encoded.** `placeId` is written only when the corpus
  row carries a `google_place_id`:
  `...(row.google_place_id ? { placeId: row.google_place_id } : {})`
  `[read source: lib/trip-browse/federated.ts:203]`. So an **absent `placeId` on
  an `mp:` tile means the federated record has no Google source backing it** —
  such a tile is not expected to enrich, and its thinness is correct, not a
  failure. On the PROD screenshot trip this is 3 of 63 tiles — *Klondike River*
  and *Yukon River* ×2 — all water features, all `mention.secondary: ""`, while
  all 60 tiles that DO carry a `placeId` have `mention.secondary: "google"`.
  The correlation is exact in this sample. `[queried PROD]`
- **"Should have enriched and failed" is NOT encoded.** Among tiles that carry a
  `placeId`, the payload holds nothing that separates a live, resolvable id from
  a stale or invalid one. Both look identical at rest; the difference is only
  observable by calling the endpoint. No heuristic is constructed here, because
  there is no signal to build one from.

Two caveats that bound the first bullet, both important to the queued
diagnostic:

1. The clean `placeId`-absent signal was observed on **`mp:` (corpus) tiles**.
   On the generated trip the 44 `google:` tiles all carry a `placeId` by
   construction (the id *is* the place_id), so the signal cannot distinguish
   anything there. **UNVERIFIED** whether a `google:`-prefixed tile can ever
   exist without a `placeId`.
2. `day.suggestions` and `waypoint` tiles have **no `placeId` in the pool
   mapping regardless of the underlying record** (§2). For those, absent
   `placeId` says nothing about Google presence — it is a property of the
   normalization, not of the place. Any diagnostic that reads "no placeId ⇒ no
   Google presence" must first restrict itself to `segmentSuggestions`.

---

## 7. Open / UNVERIFIED

- Why fork `05b346df…` (TEST) carries **0** `segmentSuggestions` while the PROD
  fork `24f14ecc…` carries 63 was not investigated. Both are forks; the corpus
  each was baked against differs (TEST is the LA-only reseed). **UNVERIFIED.**
- Whether a `google:`-prefixed tile can lack a `placeId`. **UNVERIFIED.**
- The failure *rate* of `placeId` resolution across a trip's tiles is
  deliberately not measured here — that was the queued unresolvable-placeId
  diagnostic, which needed its own session and clean context. **That sweep has
  since run (2026-07-26) and RETRACTED its own premise: 103 of 104 id-bearing
  tiles resolve, and the one "failure" is a real live place with no enrichable
  fields.** Findings — including that the endpoint reports *dead id* and *nothing
  to add* identically — are in `docs/BACKLOG.md` §"Places enrichment: empty vs
  missing is indistinguishable". Do not re-open this as an id-quality problem.
- `24f14ecc…` has `generated` unset yet a dense `segmentSuggestions` pool; it is
  described above as "fork-baked" from its `mp:`/`master_place` tiles, but the
  exact write path was not traced. **UNVERIFIED.**

---

# PART 2 — THE DETAIL SLIDEUP

The surface that opens from a card's "Details →". Identified by entry point, not
by filename: it is **`components/trip/map-detail-overlay.tsx`** (`MapDetailOverlay`),
the component that listens for `trip:openDetail`. **`trip-slideup-body.tsx` is a
different component** — the three-column container from the scroll work — and is
not this surface. `[grep: "trip:openDetail" across src/, 2026-07-26]`

## 8. THE LEAD — where the slideup gets its data

**It renders directly from the dispatched payload. It issues no request of its
own, and there is no store, context, or provider between the two.**

The listener is three lines of state assignment
`[read source: map-detail-overlay.tsx:87-96]`:

```tsx
const [place, setPlace] = useState<DetailPlace | null>(null);
…
const onOpen = (e: Event) => {
  const detail = (e as CustomEvent<{ place: DetailPlace | null }>).detail;
  const next = detail?.place ?? null;
  setPlace(next);
  setSheet(next ? "half" : "closed");
};
window.addEventListener("trip:openDetail", onOpen);
```

**The fast tell confirms it.** Across all 1,052 lines of `map-detail-overlay.tsx`
there is **no `fetch(`, no `await`, no `useSWR`/`useQuery`, no `<Suspense>`, no
`isLoading`, no skeleton and no spinner**. The only three `useEffect`s are the
`trip:openDetail` listener, a `trip:addedSync` listener, and an Escape-key
handler. `[grep: fetch\(|useSWR|useQuery|isLoading|Skeleton|Suspense|await |useEffect\( in map-detail-overlay.tsx, 2026-07-26]`
There is nothing to put a loading state *on* — the data has already arrived by
the time the component renders. It also unmounts entirely when closed
(`if (sheet === "closed") return null;`, `:139`), so each open is a fresh render
of whatever the event carried.

**The event payload, enumerated** (`DetailPlace`,
`[read source: map-detail-overlay.tsx:40-57]`):

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | also the add/remove key |
| `title` | `string` | |
| `photoUrl?` | `string` | |
| `dayNumber?` | `number` | |
| `dayId?` | `string` | |
| `coords?` | `[number, number]` | |
| `description?` | `string` | |
| **`waypoint?`** | `Waypoint` | **the whole rich record — this is what carries every detail section** |
| `dayRelative?` | `boolean` | gates the detour block and Directions mode |

The column dispatches from two branches `[read source: day-detail-corridor-column.tsx:597-675]`:
- **A trip waypoint** (`:601`) — passes the stored `Waypoint` through as-is
  (`waypoint: wp`).
- **A `segmentSuggestion`** (`:659`) — has no `Waypoint`, so one is
  **synthesised at click time**: `browsePlaceToWaypoint(enriched, ctx,
  computeCardStats(enriched, ctx))`, where
  `enriched = { ...sug, rating: rich?.rating ?? sug.rating, reviewCount: …,
  photoUrl: … }` and `rich = hydrated[sug.placeId]` — **the column's own
  enrichment cache from Part 1 §4.1**. Then `hours` is grafted on top:
  `rich?.hours ? { ...wp, logistics: { ...wp.logistics, hours: rich.hours } } : wp`
  (`:653-655`).

So the lead in Part 1 §4.2 is confirmed and completed: **the column hands
enrichment data to the slideup at dispatch time.** `hours` is fetched by the
card path, never rendered by the card, and reaches the user only here.

**Latency implication.** *(Original claim, retained — it is correct **about
`map-detail-overlay.tsx`**, which is what it was scoped to. The scope was drawn
at the wrong boundary; the correction follows immediately below.)* Opening the
detail costs **zero network round-trips** — it is a state write against data
already in memory. On bad connectivity the panel opens at full fidelity as long
as the *column's* hydration landed earlier; it degrades by showing fewer sections
(§10), never by hanging or spinning. The failure mode is silent thinness, not a
stall. Conversely there is no refetch: a detail opened an hour into a session
shows whatever the column cached, bounded by that cache's lifetime (component
state on the parent column, discarded on unmount — Part 1 §4.1).

> ### CORRECTION (2026-07-26) — "zero round-trips" is WRONG as a statement about *opening a detail*
>
> The **overlay** issues no fetch — that part stands `[read source:
> map-detail-overlay.tsx]`. But the boundary was drawn at the component instead
> of at the behaviour: **the fetch lives in the column.** `dispatchPlaceDetail`
> has a fetch-on-open fallback that fires a **single-id POST** to
> `/api/places/details` whenever the tapped tile has a `placeId` that is not in
> `hydrated` `[read source: day-detail-corridor-column.tsx:677-704]`.
>
> **The real cost of opening a detail:**
> - **Zero round-trips** when the tile is already in `hydrated` — the common case
>   once the column's windowed hydration has landed, and (post-#149) also for
>   resolved-but-empty tiles, whose `{}` is truthy and therefore counts as cached.
> - **One round-trip** when it is not — for a tile not yet fetched, or one whose
>   earlier fetch failed.
>
> **It opens BEFORE the fetch resolves, not after.** The order is explicit in
> source: `emit(synth(cached))` runs **synchronously first**, and only then does
> the `if (sug.placeId && !cached)` block fire; the fetch re-emits later via
> `emit(synth(got))`, and only `if (openDetailIdRef.current === sug.id)` — i.e.
> only if the sheet is still open on that same place `[read source:
> day-detail-corridor-column.tsx:677-700]`.
>
> So the user-visible behaviour is **"opens thin, may fill"** — never *"tap does
> nothing until Google answers."* The tap is always responsive. Combined with
> §8's finding that there is **no loading state anywhere**, the consequence is a
> silent **pop-in**: the panel opens with fewer sections and content appears
> later with nothing having indicated it was coming — and if the fetch fails or
> returns nothing, it simply stays thin, indistinguishable from a place that
> never had the data. Those are different bugs from a stall, and milder, but they
> are not "zero round-trips".
>
> Applies only to `segmentSuggestion` tiles: the waypoint branch of
> `dispatchPlaceDetail` emits the full stored waypoint and never fetches
> `[read source: day-detail-corridor-column.tsx:597-618]`.

## 9. What the slideup displays

Every section is read off `place.waypoint` with a fallback to the flat payload
`[read source: map-detail-overlay.tsx:228-250]`:

```tsx
const wp = place.waypoint;
const tags = wp?.tags ?? [];          const reliability = wp?.reliability;
const sim = wp?.simulator;            const factual = wp?.factualNote;
const logistics = wp?.logistics;      const community = wp?.community;
const amenities = wp?.amenities ?? []; const sources = wp?.dataSources ?? [];
const description = wp?.description ?? place.description;
const photoUrl = wp?.photoUrl ?? place.photoUrl;
const dayNumberLabel = place.dayNumber ?? wp?.subtitle?.match(/Day\s+(\d+)/)?.[1];
const routeOffset = wp?.routeOffsetMi;
const bookingStatus = wp?.bookingStatus ?? [];
const directionsCoord = place.waypoint?.coords ?? place.coords;
```

| Rendered | Source field | Gate |
|---|---|---|
| Hero image, 458×150 | `wp.photoUrl ?? place.photoUrl` | else a fallback block (`:255-262`) |
| Title | `place.title` (`:294`) | always |
| Tag pills | `wp.tags` | `tags.length > 0` (`:297`) |
| Reliability score box | `wp.reliability` (`.score`, `.label`, `.sourceCount`) | `reliability` present (`:374`) |
| **ROUTE line** — "Day N · X.X mi on route" | `place.dayNumber` + `wp.routeOffsetMi` (`:444`) | **both** non-null (`:421`) |
| **DIRECTIONS** button | dispatches `trip:openDirections` with `directionsCoord` (`:459`) | always |
| **"IF YOU STOP HERE"** — `Adds Xm`, stop time, entry cost | `wp.simulator.{addsTime,stopTime,entryCost,newEtaPlace,withStopEta}` (`:554-581`) | `sim` present (`:482`) |
| **ADD TO DAY N** CTA | `onToggleAdded`; dims via `isAdded` (`:487-488`, `:660`) | always |
| DESCRIPTION | `wp.description ?? place.description` | `description` (`:690`) |
| LOGISTICS — Hours / Entry / Address / Phone / Website | `wp.logistics.*` | section gated on any one present (`:740-745`), each cell on its own |
| COMMUNITY — rating bar, rating, review count, tips, last-verified | `wp.community.*` (`:802-853`) | `community` present (`:790`) |
| Amenities | `wp.amenities` | `length > 0` (`:870`) |
| DATA SOURCES | `wp.dataSources` | `length > 0` |

The screenshot list was accurate as far as it went; source adds reliability,
tags, amenities, data sources, and booking status.

## 10. Data lineage per field

**The open question — which coordinates feed the route/detour math — is
ANSWERED: the STORED TILE's coords. Routing and Places are INDEPENDENT.**
`[read source: lib/trip-browse/card-stats.ts:106-130]`

```ts
const detourMi = offRouteMi(place.coords, ctx) * ROAD_FACTOR;
const detourMin = Math.round((detourMi / AVG_MPH) * 60);
const addsMin = detourMin * 2;   // real out-and-back only
```

- `place` here is `enriched = { ...sug, rating, reviewCount, photoUrl }` — the
  spread carries `sug.coords`, and **`coords` is never overwritten from the
  enrichment** (`day-detail-corridor-column.tsx:640-645`).
- `ctx.dayCoords` / `ctx.dayStartCoords` come from the **Day** (itinerary
  geometry), not from Places (`:629-638`).
- Structurally decisive: **`PlaceRich` has no coordinate field at all** — its six
  members are `rating`, `reviewCount`, `priceTier`, `photoUrl`, `hours`,
  `category` (Part 1 §4.2). Enrichment *cannot* supply a coordinate.

**Therefore a place that fails to enrich keeps its detour figures unchanged.**
The two lineages are separable; the failure of one does not shift the other.

Grouped by lineage:

| Lineage | Fields |
|---|---|
| **Places enrichment** (via the column's cache, grafted at dispatch) | `community.rating`, `community.reviewCount`, hero `photoUrl`, `logistics.hours` |
| **Route / itinerary math** (stored tile coords × Day coords) | ROUTE line `routeOffsetMi`, `simulator.addsTime`, `subtitle` ("Day N / X mi off") |
| **Stored tile** (`BrowsePlace` fields, unmodified) | `title`, `description`, `logistics.address` / `phone` / `website`, `tags` (`overlanderTags`), `dataSources`, `logistics.entry` + `simulator.entryCost` (from `priceTier`), category |
| **Trip payload** | `dayNumber`, `dayId`, `dayRelative` |
| **Not populated on this path** | `reliability`, `amenities`, `factualNote`, `bookingStatus`, `community.tips`, `community.lastVerified`, `simulator.stopTime` — `browsePlaceToWaypoint` omits them deliberately ("no real source backs them", `card-stats.ts:259-270`). They render only for **stored trip waypoints**, whose fixture records carry them. |

**A wiring gap worth recording.** `browsePlaceToWaypoint` *does* consume
`priceTier` — `priceTierToEntry(place.priceTier)` → `logistics.entry` and
`simulator.entryCost` (`card-stats.ts:216, 244-258`). But `place` is the
`enriched` object, and **`priceTier` is not grafted from `rich`** at
`day-detail-corridor-column.tsx:640-645`, so it is read off the stored tile only.
Part 1 §4.2 found the endpoint *returns* `priceTier` (observed: `2` for Moab
Brewery) and that the card references it nowhere. The consumer exists here; the
two ends are simply not connected. Generated tiles store no `priceTier`
(Part 1 §1.2), so on that shape the Entry row cannot render at all.

## 11. Capability vs request vs display — **not applicable**

Skipped by the terms of the question. The slideup has **no data source distinct
from the column's enrichment** (§8), so there is nothing separate to measure;
the capability was already measured in Part 1 §4.2 and re-asking it here would be
a category error.

## 12. THE COMPARISON

**Do card and slideup share ONE enrichment source?** **Yes — one source, one
cache, one fetch.** Both are served by `hydrated` (component state on
`DayDetailCorridorColumn`, keyed by `place_id`, Part 1 §4.1). The card reads it
in `hydratePlaces`; the slideup receives a projection of it inside the event
payload. There is no second endpoint, no second cache, and no second request.

**So is the difference DEPTH or PRESENTATION?** **Both, and the split is
clean:**

- **Presentation** for the fields the card already has: `rating`, `reviewCount`,
  `photoUrl` are the same values, merely shown larger and with a rating bar.
- **Depth** for the rest: the slideup renders `logistics.hours` — **fetched by
  the card path and displayed nowhere else** — plus address/phone/website, tags,
  data sources, the detour block, and the ROUTE line. The card's five-field
  `Pick<>` (Part 1 §3.1) is the narrower projection of a record that the slideup
  reads much more of.

The accurate summary: **one fetch, two projections of different width** — the
card is the narrow projection, the slideup the wide one.

**Is anything fetched TWICE for the same place across the two surfaces?**
**No.** One `/api/places/details` call per uncached `placeId`, made by the
column; the slideup makes none.

**Can the two copies disagree?** **No — they cannot diverge**, and the reason is
structural rather than incidental:

1. There is only one fetch, so there is no second value to disagree with.
2. The slideup's copy is not a live read — it is a **snapshot taken at click
   time** from the same `hydrated` entry the card rendered from.
3. The entry is written once and never revised: the hydration effect skips ids
   already in `hydrated` (`t.placeId && !t.photoUrl && !hydrated[t.placeId]`,
   Part 1 §4.1), so a given `place_id` is fetched at most once per column
   lifetime.

The only way the two could show different values is if the cache entry changed
between the card's render and the click — which the write-once guard prevents.
**This is therefore a performance-neutral, correctness-safe arrangement, not a
divergence risk.** Recorded explicitly because the opposite finding (two fetches
that *can* diverge — same place, different ratings, nothing flagging it) would
have been a correctness bug; it is not present here.

**One caveat on that guarantee.** It holds *within* a column lifetime. `hydrated`
is component state discarded on unmount (Part 1 §4.1) and the server cache is a
15-minute in-process LRU, so the same place opened in a later session can show a
different rating than it did earlier. That is staleness across sessions, not
disagreement between the two surfaces at one moment.

---

# PART 3 — comparison — *folded into §12*

No separate section: §12 is the comparison. Left as a heading so the document's
three-part structure stays legible.
