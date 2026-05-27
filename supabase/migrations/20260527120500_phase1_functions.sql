-- Phase 1: shared SQL functions
-- - upsert_source_record() — idempotent insert/update on (source_id, external_id)
-- - field_precedence table — declarative source-priority lookup for resolve_field()
-- - resolve_field(), recompute_master_place(), compute_prominence() are intentionally NOT
--   added here. They are week-3 work in the Phase 1 plan and depend on the field_precedence
--   seed values, which Adam is extracting from the card data matrix.
--
-- Note: set_updated_at() already exists from 20260513000000_init_identity.sql. Not redefined here.

set search_path = public;

-- Idempotent upsert for source_record.
-- Called by every ingestion source. Conflict target is (source_id, external_id).
create or replace function public.upsert_source_record(
  p_source_id text,
  p_external_id text,
  p_name text,
  p_inferred_category text,
  p_geometry geometry,
  p_raw_payload jsonb,
  p_normalized_payload jsonb,
  p_source_quality_score float default 0.5
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.source_record (
    source_id, external_id, name, inferred_category, geometry,
    raw_payload, normalized_payload, source_quality_score, fetch_timestamp
  )
  values (
    p_source_id, p_external_id, p_name, p_inferred_category, p_geometry,
    p_raw_payload, p_normalized_payload, p_source_quality_score, now()
  )
  on conflict (source_id, external_id) do update set
    name = excluded.name,
    inferred_category = excluded.inferred_category,
    geometry = excluded.geometry,
    raw_payload = excluded.raw_payload,
    normalized_payload = excluded.normalized_payload,
    source_quality_score = excluded.source_quality_score,
    fetch_timestamp = now(),
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- field_precedence: declarative table of source priority per field name.
-- Lower priority value wins. SEED VALUES INTENTIONALLY OMITTED — Adam is extracting them
-- from the card data matrix. Until seeded, resolve_field() (added later) returns null for
-- every field and recompute_master_place() is a no-op.
create table if not exists public.field_precedence (
  field_name text not null,
  source_id  text not null,
  priority   integer not null,
  primary key (field_name, source_id)
);

alter table public.field_precedence enable row level security;
