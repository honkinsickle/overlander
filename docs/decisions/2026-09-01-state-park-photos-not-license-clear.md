# State-park agency photos are not a license-clear source (all six states) — do not integrate

**Date:** 2026-09-01 · **Status:** Accepted (report-only; no build) ·
**Scope:** CA, AZ, NV, UT, WA, OR state-parks agency photos.

## Context

The MacKerricher investigation (PR #343) found the CA State Parks ArcGIS layers
we ingest carry no image field. Adam asked to source state-park photos from each
state's own official site for all six test-group states, **confirming
licensing/terms per state rather than assuming the standing "official agency /
park-service media is license-clear" rule holds uniformly.**

Scoped enumerate-before-measure (grounded field enumeration + live-value samples,
then six parallel per-state licensing-research passes with cited terms). Full
record: `docs/measurements/2026-09-01-state-park-photo-sourcing-scope.md`.

Two things were measured:

1. **Only Washington** exposes a usable image URL via the ArcGIS data we ingest
   (`Imagelink` → real `parks.wa.gov` JPGs). AZ's `PHOTO` is internal codes with
   `hasAttachments:false`; NV's `photo` is an empty placeholder; UT's `weblink1`
   is a park webpage; CA and OR have no image field (`hasAttachments:false`). No
   layer carries any caption/credit/license field.
2. **Every state's agency terms block reuse** for a product like this — verified
   from official pages, quoted in the measurements doc: CA (personal/
   non-commercial, no deep-link/scrape, no cropping), AZ (not public domain, all
   rights reserved), NV (educational/scientific only; third-party works), UT
   (SmugMug third-party, no grant), WA ("All rights reserved," no grant, some
   contributed third-party works), OR (mandatory "courtesy OPRD" credit, "may be
   subject to copyright," web-only).

## Decision

**Do not integrate state-park agency photos for any of the six states.** None is
unblocked with clear terms, so — per the task's rule to report blocked rather
than scrape — no ingestion/normalizer mapping was built, including for WA even
though its image URLs are directly available.

The standing "official agency/park media is license-clear" assumption is
**revised: it does not hold for these six western state-parks agencies** — and it
fails hardest exactly where usable data exists (WA). Treat state-agency media as
license-*unknown* until a specific agency's terms are read and grant reuse.

## Consequences

- **No code/data/schema change.** The `state_parks` normalizer is unchanged; the
  render laterals still exclude `state_parks`/`blm` (so nothing new displays).
- **WA `photo_url` residue flagged:** ~59–70 `parks.wa.gov` URLs already sit in
  `master_place.photo_url` from the prior backfill, with no confirmed reuse
  grant. Not rendered (latent), but should not be wired to display; Adam may
  want them cleared. Filed in BACKLOG; not deleted here.
- **If photos are still wanted:** the only path per state is a direct written
  licensing request to the agency. WA (already exposes URLs) and OR (grants use
  with a mandatory credit line) are the nearest to workable, contingent on an
  affirmative grant this research did not find. CA/AZ/NV are hard "no" without a
  negotiated agreement.
- Reinforces the existing boundary that wiring photos into rendering /
  `field_precedence` is a product decision reserved for Adam
  (`20260821070000` header) — that boundary now also carries a licensing gate.
