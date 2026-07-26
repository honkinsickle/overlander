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
15-minute in-process LRU cache (max 1000), per-lambda; a null/empty result is
omitted so the tile "stays essentials"; the route's own docstring states
**"NOTHING is persisted to the DB"**. `[read source: app/api/places/details/route.ts:19-93]`

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
  deliberately not measured here — that is the queued unresolvable-placeId
  diagnostic, which needs its own session and clean context.
- `24f14ecc…` has `generated` unset yet a dense `segmentSuggestions` pool; it is
  described above as "fork-baked" from its `mp:`/`master_place` tiles, but the
  exact write path was not traced. **UNVERIFIED.**

---

# PART 2 — THE DETAIL SLIDEUP — *reserved*

Deliberately empty. The slideup opens from the card's "Details →", which
dispatches `trip:openDetail` from the column (`day-detail-corridor-column.tsx`);
that dispatch is the boundary of Part 1 and no slideup component was read for
this document. Append the second model here, then add a Part 3 comparison —
the two parts are structured to make that diff mechanical.
