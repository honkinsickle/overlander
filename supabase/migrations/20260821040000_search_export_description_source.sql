-- ============================================================================
-- description_source on master_place_search_export — real, queryable
-- provenance signal: 'source' | 'template' | 'llm' | null.
--
-- Combined eligibility + provenance + review pass, 2026-08-21. Investigated
-- before adding: master_place_search_export is NOT what the frontend
-- queries live for browse/map search — that's Typesense (web/src/lib/
-- search.ts's SearchClient), synced FROM this view by
-- data/search/sync-typesense.ts on a separate, manually-triggered run. This
-- view IS read directly by web/src/lib/trip-browse/hydrate.ts, but only for
-- a narrow id/lng/lat/photo_url projection — description_source is not
-- consumed there today. So this migration makes the signal available and
-- correct at the Postgres layer (the literal ask), but reaching an actual
-- map filter toggle additionally requires adding description_source to
-- sync-typesense.ts's SCHEMA/transformRow and re-running search:sync — not
-- done here, flagged in the report as remaining plumbing, not UI.
--
-- Precedence matches this table's own documented read path
-- (20260821000000_master_place_generated_content.sql: "show
-- master_place.description when present; fall back to this table only when
-- null. Never both."):
--   'source'   — mp.description is non-null and non-empty (real,
--                source-derived content; wins regardless of whether a
--                template/llm row ALSO exists as an unused fallback — see
--                the "dual" rows found in the prior pass, docs/measurements/
--                2026-08-21-three-part-cleanup.md Part 2)
--   'llm'      — no source description, but an llm-generated row exists
--   'template' — no source description, but a template-generated row exists
--   null       — no description of any kind
--
-- ADDITIVE — same LEFT JOIN LATERAL shape as the existing photo_url lateral
-- (20260810180400), so row count and every existing column are unchanged.
-- description_source appended last so CREATE OR REPLACE VIEW stays legal.
-- ============================================================================

set search_path = public;

create or replace view public.master_place_search_export as
select
  mp.id,
  mp.canonical_name,
  mp.alternative_names,
  mp.primary_category,
  mp.secondary_categories,
  mp.overlander_tags,
  mp.description,
  ST_X(mp.geometry)::double precision as lng,
  ST_Y(mp.geometry)::double precision as lat,
  mp.prominence_score,
  mp.source_count,
  mp.amenities,
  mp.updated_at,
  photo.photo_url,
  case
    when mp.description is not null and mp.description <> '' then 'source'
    when desc_gc.has_llm then 'llm'
    when desc_gc.has_template then 'template'
    else null
  end as description_source
from public.master_place mp
left join lateral (
  select sr.normalized_payload->'photo'->>'url' as photo_url
  from public.source_record sr
  where sr.master_place_id = mp.id
    and sr.source_id in ('nps', 'ridb')
    and sr.normalized_payload->'photo'->>'url' is not null
  -- Prefer NPS over RIDB when a master_place carries both.
  order by case sr.source_id when 'nps' then 0 when 'ridb' then 1 else 2 end
  limit 1
) photo on true
left join lateral (
  select
    bool_or(gc.generation_method = 'llm') as has_llm,
    bool_or(gc.generation_method = 'template') as has_template
  from public.master_place_generated_content gc
  where gc.master_place_id = mp.id
    and gc.field_name = 'description'
) desc_gc on true
where mp.is_searchable
  and mp.source_count > 0
  and st_intersects(mp.geometry, public.six_state_footprint());

comment on view public.master_place_search_export is
  'Phase 2 Typesense sync source. Projects master_place with geometry split into lng/lat doubles + photo_url (corpus photo from nps/ridb via LEFT JOIN LATERAL, NPS preferred) + description_source (''source''|''template''|''llm''|null, derived from master_place.description presence and master_place_generated_content). Filters: is_searchable, source_count > 0, st_intersects(geometry, six_state_footprint()).';
