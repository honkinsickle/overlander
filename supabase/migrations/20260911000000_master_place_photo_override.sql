-- ============================================================================
-- master_place_photo_override — manual, per-place photo override for the Pin of
-- the Week generator. Lets an operator swap in a chosen photo for a place; the
-- generator reads it in place of the corpus-resolved photo and falls back to the
-- corpus photo when no override exists.
--
-- WHY A NEW TABLE (same reasoning as master_place_photo_candidate,
-- 20260901000600):
--   - master_place is written only via recompute_master_place() and its columns
--     are precedence-resolved source-of-truth. A hand-picked override is neither,
--     so it must not be a column on master_place.
--   - One override per place → PK = master_place_id (upsert-on-conflict).
--   - Unlike photo_candidate (staged, deliberately NEVER read by a live path),
--     this table IS read — but ONLY by the Pin of the Week generator, NOT by the
--     corpus read paths (recompute_master_place / pois_along_corridor /
--     master_place_search_export / field_precedence). The corpus boundary is
--     unchanged; this is a tool-scoped override.
--
-- PROVENANCE is required, matching the photo-backfill pilot's discipline:
--   source + license are NOT NULL (free text); attribution optional.
--
-- The image is EITHER a URL (image_url — e.g. --url) OR inline base64 bytes
-- (image_data + mime_type — e.g. a local --file that has no URL). Storing bytes
-- inline keeps a local-file override self-contained and durable without standing
-- up a Storage bucket. If overrides ever become large/numerous, moving --file
-- uploads to Supabase Storage (URL-only) is the scale-up path — flagged, not
-- done here.
-- ============================================================================

set search_path = public;

create table if not exists public.master_place_photo_override (
  master_place_id uuid primary key references public.master_place(id) on delete cascade,
  image_url text,
  image_data text,          -- base64-encoded bytes (for local-file overrides)
  mime_type text,           -- e.g. 'image/jpeg' (required when image_data is set)
  source text not null,     -- provenance: where the photo came from (free text)
  license text not null,    -- license (free text), same discipline as the photo pilot
  attribution text,         -- optional ready-to-display credit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- exactly one of image_url / image_data must be set
  constraint photo_override_one_source check ((image_url is not null) <> (image_data is not null)),
  -- inline bytes require a mime type
  constraint photo_override_mime check (image_data is null or mime_type is not null)
);

comment on table public.master_place_photo_override is
  'Manual per-place photo override for the Pin of the Week generator (one row per place). Read by the generator in place of the corpus-resolved photo; NOT read by recompute_master_place or the corpus read paths. Provenance (source/license) required. Image is a URL (image_url) or inline base64 bytes (image_data + mime_type).';

alter table public.master_place_photo_override enable row level security;
-- No policies: service-role only, matching master_place / master_place_photo_candidate.
