# Slide-up chrome that isn't category-bearing uses neutral tokens

**Date:** 2026-09-01
**Status:** Accepted
**Scope:** `web/src/components/trip/map-detail-overlay.tsx`

## Context

PR #328 fixed the slide-up's title colour and added the category icon badge,
making both read from the place's own category. It deliberately left four
other elements in the same file alone, because they carried the *same*
literal — `#A6C9F9`, the `--cat-scenic-title` value, plus its
`rgba(166,201,249,…)` alpha variants — and it was not obvious whether they
were meant to be category-driven too.

They were not. The literal was scenic-blue everywhere because the panel had
been built from a single scenic-place mock, not because those elements
encode a category. A `food` place's slide-up rendered a coral title above
blue tag pills, a blue section label and a blue CTA border — the blue was
leftover mock chrome, and once the title went category-driven it read as an
inconsistency rather than a theme.

The four elements are the tag pills, the "IF YOU STOP HERE" simulator
section label, the "ADD TO DAY N" CTA, and the Website value in the
logistics row. (Two of these were misnamed as "reliability box" and "route
box" in the backlog entry that tracked them; neither of those elements ever
contained scenic blue.)

## Decision

**Only the title and the icon badge are category-driven. Everything else in
the slide-up is neutral, from the Type ramp (§1.1) and the alpha overlays
(§1.3).** Applied as:

| Element | Was | Now |
|---|---|---|
| Tag pill text | `#A6C9F9` | `var(--type-300)` |
| Tag pill fill | `rgba(166,201,249,0.12)` | `var(--border-subtle)` |
| Tag pill border | `rgba(166,201,249,0.32)` | `var(--border-strong)` |
| "IF YOU STOP HERE" label | `#A6C9F9` | `var(--type-300)` |
| "ADD TO DAY N" fill | `#24354F` | `var(--bg-card)` |
| "ADD TO DAY N" border | `#A6C9F9` | `var(--border-strong)` |
| Website value | `#A6C9F9` | `var(--text-muted)` |

`--type-300` rather than `--text-muted` for the two text roles: both are
small (11px pill, 14px tracked label) and `--text-muted` (`#888888`) reads
too dim at those sizes against `--bg-panel`. The Website value keeps
`--text-muted` because it sits beside sibling logistics values of the same
weight.

The CTA's `backgroundColor: "#24354F"` was **not** one of the four named
sites — it contains no `A6C9F9` — but it is the scenic `cta-bg` value on the
same element as a named border. Neutralising only the border would have left
a blue-filled button, so it was included.

## Consequences

- **The "ADD TO DAY N" CTA is now visually secondary.** The DIRECTIONS
  button above it uses `var(--button-primary)` / `var(--button-primary-border)`
  and stays saturated blue, so the panel now has one primary action and one
  secondary. This is a hierarchy change, not just a recolour. It reads
  correctly — Directions is the more common action — but it was a
  consequence of the neutral rule, not an independently argued choice.
  If Add-to-day should be co-primary, the fix is to point it at
  `--button-primary` / `--button-primary-border` rather than reintroduce a
  literal.
- **"IF YOU STOP HERE" is now the only section label in the file that is not
  amber.** The shared `Section` component renders its labels
  `var(--amber-dark)`, and this label has byte-identical typography to it
  (`--ff-display`, 14px, `letterSpacing: 0.14em`, uppercase) while being
  hand-rolled inside the simulator card. Neutral follows this decision's
  rule; `var(--amber-dark)` would follow the file's own convention. The
  rule won because DESIGN.md §6 scopes amber to "text/data/active accent"
  and this is a static heading. Worth revisiting if the simulator card is
  ever folded into `Section`.
- **The Website value no longer signals affordance.** It was blue, which
  read as a link — but `LogisticsCell` renders it in a plain `<span>`, so it
  was never clickable. Neutral is now honest about that. If it should become
  a real link, DESIGN.md §1.4 has `--link` / `--link-hover` for it.
- Category identity in the slide-up now rests entirely on two elements. That
  is less redundant than before, and a place whose category is wrong is
  correspondingly less obvious at a glance.
