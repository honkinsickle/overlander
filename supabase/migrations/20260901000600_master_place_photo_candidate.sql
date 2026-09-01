-- ============================================================================
-- master_place_photo_candidate — staged, license-clear photo candidates from
-- the CA-campground photo-backfill pilot. Structurally separate from
-- source_record and master_place so it is NEVER read by recompute_master_place,
-- pois_along_corridor, master_place_search_export, or field_precedence.
--
-- WHY A NEW TABLE (not columns on master_place, not a source_record upsert):
--   - master_place is written only via recompute_master_place() and its
--     columns are precedence-resolved source-of-truth. A staged, unreviewed
--     candidate is neither, so it must not live there.
--   - The existing photo-backfill pattern (backfill-wikipedia-photo.ts) upserts
--     a `wikipedia` source_record with normalized_payload.photo. The corridor
--     RPC's photo lateral join reads {nps, ridb, wikipedia, atlas_oddities,
--     family_destinations, editorial_food}, so that path AUTO-WIRES the photo
--     onto cards on the next read. The pilot's explicit requirement is the
--     opposite: STORE candidates but do NOT surface them until quality is
--     reviewed. A dedicated table the read path does not touch makes that
--     "staged, not live" boundary structural rather than a convention.
--
-- Wiring a reviewed candidate into rendering is a SEPARATE, later, explicitly
-- authorized step (promote accepted rows into a source_record, or teach the
-- RPC to read this table). This migration does not do that.
--
-- Provenance is captured per candidate: image + source + license + attribution
-- + the source page it came from, plus the match signals (name score, distance,
-- status, reason) so a human can adjudicate manual_review rows without re-running
-- the pipeline. Raw upstream metadata is kept in `raw` for audit.
--
-- TEST ONLY (znldzjdatkogdktymtvi) as of this migration. PROD application is a
-- separate, later, explicitly authorized step.
-- ============================================================================

set search_path = public;

create table public.master_place_photo_candidate (
  id uuid primary key default gen_random_uuid(),
  master_place_id uuid not null references public.master_place(id) on delete cascade,

  -- provenance (task requirement: not just the bare URL)
  source text not null,                 -- 'wikimedia_commons' | 'wikipedia' | 'nps'
  image_url text not null,              -- full-resolution / display image URL
  thumb_url text,                       -- thumbnail URL when the source provides one
  source_page_url text,                 -- Commons File: page / Wikipedia article / NPS page
  license text,                         -- e.g. 'CC BY-SA 2.0', 'CC0', 'Public domain'
  license_url text,
  license_class text,                   -- 'public_domain' | 'attribution' (both acceptable)
  attribution text,                     -- ready-to-display credit string (null for PD)
  title text,                           -- the candidate's own title/caption

  -- match adjudication
  match_status text not null check (match_status in ('accepted', 'manual_review')),
  match_confidence numeric,             -- 0..1 compound confidence
  name_score numeric,                   -- 0..1 name-token overlap place<->candidate
  distance_m numeric,                   -- meters, place geometry <-> candidate location
  match_reason text,                    -- human-readable rationale for the status

  -- snapshot context (so review does not require re-joining master_place)
  place_name text not null,             -- canonical_name at pilot time
  primary_category text,                -- 'campground' for this pilot
  pilot_run text not null,              -- batch label, e.g. 'ca-campground-2026-09-01'

  raw jsonb,                            -- raw upstream candidate metadata for audit
  created_at timestamptz not null default now(),

  -- one stored candidate per (place, image); re-runs upsert rather than duplicate
  unique (master_place_id, image_url)
);

create index on public.master_place_photo_candidate (master_place_id);
create index on public.master_place_photo_candidate (match_status);
create index on public.master_place_photo_candidate (pilot_run);

alter table public.master_place_photo_candidate enable row level security;
-- Zero policies — service-role only, same posture as source_record /
-- master_place / master_place_generated_content. No anon/authenticated grants.

comment on table public.master_place_photo_candidate is
  'Staged license-clear photo candidates (CA-campground backfill pilot). Deliberately NOT read by recompute_master_place / pois_along_corridor / master_place_search_export / field_precedence: candidates are held here for human review, never auto-surfaced on cards. Promotion into a live read path is a separate, explicitly authorized step. match_status: accepted = strong name+geo+license match; manual_review = plausible but ambiguous, needs a human. Provenance (source/license/attribution/source_page_url) is stored per candidate.';
