-- Merge tooling: `merge_master_place(canonical, absorbed[])` plus
-- `merge_audit_log` for durable per-merge audit.
--
-- CONTEXT. Built for the SAME-bucket duplicate merge queue documented in
-- docs/investigations/2026-09-03-merge-preview-v2-nway.md (PR #374). The
-- dry-run preview tool identifies 123 merge groups from 135 duplicate pairs.
-- This migration is the write side: one server-side transaction per group,
-- audit row committed with the same transaction so the merge and its
-- reversal record are atomic.
--
-- SAFETY POSTURE.
--   - Everything runs inside a single stored-function transaction:
--     any failure rolls back the whole group cleanly (no partial merges).
--   - Absorbed master_places are NEVER hard-deleted. They keep their row
--     (is_searchable=false, source_count=0 after recompute) so downstream
--     references cannot dangle and manual rollback stays possible.
--   - Audit row is INSERTed inside the same transaction. Loss of the
--     merge_audit_log row implies the whole merge rolled back — the invariant
--     is enforced at the DB, not by the caller.
--
-- FK TOPOLOGY (re-enumerated 2026-09-03 for this migration):
--   source_record.master_place_id           -> ON DELETE SET NULL
--   place_match.master_place_id             -> ON DELETE CASCADE
--     UNIQUE (source_record_id, master_place_id)
--   place_relationships.child_master_place_id  -> ON DELETE CASCADE
--   place_relationships.parent_master_place_id -> ON DELETE CASCADE
--     PRIMARY KEY (child, parent, relationship_type)
--     CHECK (child <> parent)
--   master_place_generated_content.master_place_id -> ON DELETE CASCADE
--     UNIQUE (master_place_id, field_name)
--   master_place_photo_candidate.master_place_id   -> ON DELETE CASCADE
--     UNIQUE (master_place_id, image_url)
--
-- Every one of these is repointed or resolved on conflict below. The
-- absorbed row is never deleted, so ON DELETE CASCADE never fires — the
-- merge relies on manual repointing rather than cascade behavior.

set search_path = public;

-- ── Audit table ──────────────────────────────────────────────────────────

create table if not exists public.merge_audit_log (
  id uuid primary key default gen_random_uuid(),
  executed_at timestamptz not null default now(),
  executed_by text not null,        -- caller-provided (script name / operator)
  canonical_mp_id uuid not null,    -- winning master_place
  absorbed_mp_ids uuid[] not null,  -- losing master_places
  target_env text not null,         -- 'test' or 'prod' (caller-provided)
  group_id integer,                 -- from dry-run tool's grouping (nullable for ad-hoc merges)
  before_snapshot jsonb not null,   -- canonical + absorbed rows before
  after_snapshot jsonb not null,    -- canonical + absorbed rows after
  moves jsonb not null,             -- counts of what got repointed
  notes text,
  constraint merge_audit_log_target_env_chk check (target_env in ('test', 'prod'))
);

create index if not exists merge_audit_log_executed_at_idx
  on public.merge_audit_log (executed_at desc);

create index if not exists merge_audit_log_canonical_idx
  on public.merge_audit_log (canonical_mp_id);

comment on table public.merge_audit_log is
  'One row per merge_master_place() invocation. Written inside the merge''s '
  'transaction so a rollback drops the audit and the merge together. '
  'before/after snapshots and per-table move counts are sufficient to '
  'manually reverse a merge (recreate absorbed rows, repoint SRs back).';

-- ── Merge function ───────────────────────────────────────────────────────

create or replace function public.merge_master_place(
  p_canonical_mp_id uuid,
  p_absorbed_mp_ids uuid[],
  p_executed_by text,
  p_target_env text,
  p_group_id integer default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_moves jsonb := '{}'::jsonb;
  v_audit_id uuid;
  v_count integer;
  v_canonical_exists boolean;
  v_absorbed_count integer;
begin
  -- Preconditions
  if p_canonical_mp_id is null then
    raise exception 'p_canonical_mp_id required';
  end if;
  if p_absorbed_mp_ids is null or array_length(p_absorbed_mp_ids, 1) is null then
    raise exception 'p_absorbed_mp_ids required and non-empty';
  end if;
  if p_canonical_mp_id = any(p_absorbed_mp_ids) then
    raise exception 'canonical mp_id cannot be in absorbed list';
  end if;
  if p_target_env not in ('test', 'prod') then
    raise exception 'target_env must be test or prod, got %', p_target_env;
  end if;
  if p_executed_by is null or length(p_executed_by) = 0 then
    raise exception 'p_executed_by required';
  end if;

  -- Assert all master_places exist (canonical + absorbed)
  select exists(select 1 from master_place where id = p_canonical_mp_id) into v_canonical_exists;
  if not v_canonical_exists then
    raise exception 'canonical master_place % not found', p_canonical_mp_id;
  end if;
  select count(*) into v_absorbed_count from master_place where id = any(p_absorbed_mp_ids);
  if v_absorbed_count <> array_length(p_absorbed_mp_ids, 1) then
    raise exception 'not all absorbed master_places exist (expected %, found %)',
      array_length(p_absorbed_mp_ids, 1), v_absorbed_count;
  end if;

  -- Snapshot before (exclude PostGIS geometry from JSON — it doesn't cast cleanly).
  select jsonb_object_agg(id::text, to_jsonb(mp) - 'geometry' - 'geometry_polygon')
    into v_before
    from master_place mp
    where mp.id = p_canonical_mp_id or mp.id = any(p_absorbed_mp_ids);
  -- Also snapshot source_records currently pointing at each side
  v_before := v_before || jsonb_build_object(
    'source_records',
    coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id', id::text,
        'source_id', source_id,
        'external_id', external_id,
        'name', name,
        'master_place_id', master_place_id::text,
        'is_active', is_active
      ))
      from source_record
      where master_place_id = p_canonical_mp_id
         or master_place_id = any(p_absorbed_mp_ids)),
      '[]'::jsonb
    )
  );

  -- 1. source_record: repoint absorbed → canonical (SET NULL FK, no cascade risk)
  update source_record
     set master_place_id = p_canonical_mp_id,
         updated_at = now()
   where master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('source_records_repointed', v_count);

  -- 2. place_match: repoint where no unique conflict, delete conflicts
  --    UNIQUE (source_record_id, master_place_id) → the canonical mp may
  --    already have a place_match for the same source_record. Keep the
  --    canonical-side row; delete the absorbed-side row.
  delete from place_match pm_absorbed
   where pm_absorbed.master_place_id = any(p_absorbed_mp_ids)
     and exists (
       select 1 from place_match pm_canonical
        where pm_canonical.source_record_id = pm_absorbed.source_record_id
          and pm_canonical.master_place_id = p_canonical_mp_id
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_matches_deduped', v_count);

  update place_match
     set master_place_id = p_canonical_mp_id
   where master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_matches_repointed', v_count);

  -- 3. place_relationships: rewrite both direction columns.
  --    Guards: (a) don't create self-refs (child == parent after rewrite);
  --            (b) don't violate the composite PK (dedupe on collision).

  -- 3a. Delete edges that would collapse to a self-reference: absorbed is child,
  --     canonical is parent (or vice versa). These are the "already linked to
  --     each other" cases documented in PR #372.
  delete from place_relationships
   where (child_master_place_id = any(p_absorbed_mp_ids) and parent_master_place_id = p_canonical_mp_id)
      or (parent_master_place_id = any(p_absorbed_mp_ids) and child_master_place_id = p_canonical_mp_id);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_self_refs_dropped', v_count);

  -- 3b. Dedupe: delete absorbed-side edges that would collide with an existing
  --     canonical-side edge under the same relationship_type.
  delete from place_relationships pr_absorbed
   where pr_absorbed.child_master_place_id = any(p_absorbed_mp_ids)
     and exists (
       select 1 from place_relationships pr_canonical
        where pr_canonical.child_master_place_id = p_canonical_mp_id
          and pr_canonical.parent_master_place_id = pr_absorbed.parent_master_place_id
          and pr_canonical.relationship_type = pr_absorbed.relationship_type
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_child_dedup', v_count);

  delete from place_relationships pr_absorbed
   where pr_absorbed.parent_master_place_id = any(p_absorbed_mp_ids)
     and exists (
       select 1 from place_relationships pr_canonical
        where pr_canonical.parent_master_place_id = p_canonical_mp_id
          and pr_canonical.child_master_place_id = pr_absorbed.child_master_place_id
          and pr_canonical.relationship_type = pr_absorbed.relationship_type
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_parent_dedup', v_count);

  -- 3c. Repoint remaining edges
  update place_relationships
     set child_master_place_id = p_canonical_mp_id
   where child_master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_child_repointed', v_count);

  update place_relationships
     set parent_master_place_id = p_canonical_mp_id
   where parent_master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_parent_repointed', v_count);

  -- 4. master_place_generated_content: UNIQUE (master_place_id, field_name).
  --    Delete absorbed rows that collide with an existing canonical row (canonical wins).
  delete from master_place_generated_content gc_absorbed
   where gc_absorbed.master_place_id = any(p_absorbed_mp_ids)
     and exists (
       select 1 from master_place_generated_content gc_canonical
        where gc_canonical.master_place_id = p_canonical_mp_id
          and gc_canonical.field_name = gc_absorbed.field_name
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('generated_content_deduped', v_count);

  update master_place_generated_content
     set master_place_id = p_canonical_mp_id
   where master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('generated_content_repointed', v_count);

  -- 5. master_place_photo_candidate: UNIQUE (master_place_id, image_url).
  delete from master_place_photo_candidate pc_absorbed
   where pc_absorbed.master_place_id = any(p_absorbed_mp_ids)
     and exists (
       select 1 from master_place_photo_candidate pc_canonical
        where pc_canonical.master_place_id = p_canonical_mp_id
          and pc_canonical.image_url = pc_absorbed.image_url
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('photo_candidates_deduped', v_count);

  update master_place_photo_candidate
     set master_place_id = p_canonical_mp_id
   where master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('photo_candidates_repointed', v_count);

  -- 6. Soft-retire absorbed master_places. Never hard-delete — keeps the
  --    row present for downstream reference-safety and manual rollback.
  --    is_searchable=false drops them out of master_place_search_export
  --    even though source_count would normally already do so via recompute.
  update master_place
     set is_searchable = false,
         source_count = 0,
         updated_at = now()
   where id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('absorbed_soft_retired', v_count);

  -- 7. Recompute canonical to re-derive fields via field_precedence from
  --    the now-larger source_record population.
  perform recompute_master_place(p_canonical_mp_id);

  -- Snapshot after (same shape as before)
  select jsonb_object_agg(id::text, to_jsonb(mp) - 'geometry' - 'geometry_polygon')
    into v_after
    from master_place mp
    where mp.id = p_canonical_mp_id or mp.id = any(p_absorbed_mp_ids);
  v_after := v_after || jsonb_build_object(
    'source_records',
    coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id', id::text,
        'source_id', source_id,
        'external_id', external_id,
        'name', name,
        'master_place_id', master_place_id::text,
        'is_active', is_active
      ))
      from source_record
      where master_place_id = p_canonical_mp_id
         or master_place_id = any(p_absorbed_mp_ids)),
      '[]'::jsonb
    )
  );

  -- Insert audit row
  insert into merge_audit_log (
    executed_by, canonical_mp_id, absorbed_mp_ids,
    target_env, group_id, before_snapshot, after_snapshot, moves, notes
  ) values (
    p_executed_by, p_canonical_mp_id, p_absorbed_mp_ids,
    p_target_env, p_group_id, v_before, v_after, v_moves, p_notes
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'audit_id', v_audit_id,
    'canonical_mp_id', p_canonical_mp_id,
    'absorbed_mp_ids', to_jsonb(p_absorbed_mp_ids),
    'moves', v_moves,
    'target_env', p_target_env
  );
end;
$$;

comment on function public.merge_master_place is
  'Atomically merge one or more absorbed master_places into one canonical. '
  'Repoints all FKs (source_record, place_match, place_relationships, '
  'master_place_generated_content, master_place_photo_candidate), handles '
  'unique-constraint conflicts by keeping canonical''s row, soft-retires '
  'absorbed rows (never hard-delete), runs recompute_master_place, and '
  'writes an audit row — all in one transaction. See '
  'docs/investigations/2026-09-03-merge-executor.md.';

grant execute on function public.merge_master_place(uuid, uuid[], text, text, integer, text)
  to service_role;

alter table public.merge_audit_log enable row level security;

-- Only service_role reads/writes this. No end-user access; audit rows are
-- operational metadata, not user data.
create policy merge_audit_log_service_all on public.merge_audit_log
  as permissive for all
  to service_role
  using (true) with check (true);
