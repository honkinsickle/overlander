# 2026-08-27 — Atlas Obscura descriptions: strip markdown to plain text

## Context

The `about` field in the manually-supplied Atlas Obscura per-state datasets
(landed on TEST by PR #309 for OR/CA/LA and PR #311 for WA/AZ/UT/NV) is
markdown-flavoured. Measured against the 2,858 TEST descriptions via
`data/scripts/atlas-oddities-markdown-sample.ts`:

| pattern                | count |
|------------------------|------:|
| inline_link            | 1,424 |
| italic_underscore      |   527 |
| bold                   |    14 |
| blockquote             |     2 |
| unordered_list         |     1 |
| horizontal_rule        |     1 |
| image                  |     1 |

Not observed: heading, ordered_list, asterisk-italic, inline/fenced code,
autolink, strikethrough, footnote ref, HTML tag, escaped char.

The web client renders tile descriptions as JSX text nodes
(`{description}` — never `dangerouslySetInnerHTML`, no markdown library
installed), so an inline link like `[Portland](https://…)` rendered as
that literal string on the card. PR #312's density-cascade measurement
flagged this as the one remaining product-shape concern; Adam signed off
on landing a converter as the fix.

## Decision

**Strip AO descriptions to plain text.** The converter lives at
`data/ingestion/sources/atlas-oddities-markdown.ts` — a pure function
with 22 unit tests. No dependency added: the observed markdown surface
is small and stable, so a regex chain is precise, readable, and testable
without pulling in `remark`/`micromark`. Idempotent: running twice
matches running once.

Applied to TEST via `data/scripts/atlas-oddities-apply-markdown-convert.ts`
— updates `source_record.normalized_payload.description` on the ~1,701
rows that carried markdown syntax, then calls `recompute_master_place`
per unique linked mp_id so `master_place.description` reflects the
converted text.

Live-verified via the multi-corridor
`data/scripts/atlas-oddities-manual-verify.ts` — same 5 corridors PR
#311 used — and via `data/scripts/atlas-oddities-prod-verify.ts` post-
promotion. Zero markdown leaks in either.

## Consequences

- AO descriptions render as clean prose on browse tiles, matching the
  rendering path every other source uses.
- Links to Atlas Obscura's own pages (which the inline links pointed
  at) are dropped from the description text. This is deliberate: even
  if the client rendered markdown, we would not want browse tiles
  linking off-site to atlas obscura's marketing surfaces during a trip
  browse. The `ao_url` field on
  `source_record.normalized_payload.ao_url` still holds the canonical
  AO permalink if a link is ever desired.
- **Adjacent, not caused by this work:** NPS and RIDB descriptions
  currently ship with literal HTML fragments (`<p>`, `<em>`, `<br>`)
  that also render as text via the same JSX-text-node path — so
  users see literal `<p>` tags on browse tiles for those sources
  today. Same class of issue, different corpus. Not fixed here; a
  broader "how to render corpus descriptions" question is filed under
  BACKLOG as a follow-up (would need either an HTML stripper on
  NPS/RIDB or a proper markdown/HTML renderer on the card, both
  larger scope than this decision).
- **Idempotence + safety:** the converter's guard for snake_case
  tokens (word-boundary requirement on `_underscore_ italic_`) means
  it won't eat identifier-shaped fragments if AO ever adds one. The
  regex is documented at
  `data/ingestion/sources/atlas-oddities-markdown.ts`.
- **Future AO dumps** need the converter re-run (via the `--allow-prod`
  path if the update reaches PROD). The apply script is idempotent so
  running it on TEST + PROD as a routine step after any AO refresh is
  safe.

## Reversal

If markdown-in-text needs to come back (unlikely given the JSX-text-node
rendering context), the converter can be reverted and the descriptions
re-populated from the source CSVs via PR #309/#311's manual content
ingest script.
