-- merge_master_place() v3 — fixes n-way absorbed↔absorbed self-ref bug
-- found on TEST at group 89 (Fort Churchill 4-way).
--
-- The v2 self-ref cleanup (step 3a) handled edges between an absorbed row
-- and the canonical (either direction) but NOT edges between two absorbed
-- rows. When (child=A, parent=B) exists with both A and B absorbed, the
-- child UPDATE sets A→canonical, then the parent UPDATE sets B→canonical,
-- producing (canonical, canonical) — a self-ref that violates the CHECK
-- constraint `place_relationships_no_self_ref_chk`. Postgres rolled back
-- the whole transaction — safety worked; the merge just couldn't complete.
--
-- v3 changes only step 3a: it now also deletes absorbed↔absorbed edges
-- (both endpoints in the absorbed set) before the UPDATEs run. Behavior
-- unchanged for 2-way merges (no other absorbed to be the other endpoint)
-- and for n-way merges where absorbed rows aren't linked to each other in
-- place_relationships.

set search_path = public;

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
  if p_canonical_mp_id is null then raise exception 'p_canonical_mp_id required'; end if;
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

  select exists(select 1 from master_place where id = p_canonical_mp_id) into v_canonical_exists;
  if not v_canonical_exists then
    raise exception 'canonical master_place % not found', p_canonical_mp_id;
  end if;
  select count(*) into v_absorbed_count from master_place where id = any(p_absorbed_mp_ids);
  if v_absorbed_count <> array_length(p_absorbed_mp_ids, 1) then
    raise exception 'not all absorbed master_places exist (expected %, found %)',
      array_length(p_absorbed_mp_ids, 1), v_absorbed_count;
  end if;

  select jsonb_object_agg(id::text, to_jsonb(mp) - 'geometry' - 'geometry_polygon')
    into v_before
    from master_place mp
    where mp.id = p_canonical_mp_id or mp.id = any(p_absorbed_mp_ids);
  v_before := v_before || jsonb_build_object(
    'source_records',
    coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id', id::text, 'source_id', source_id, 'external_id', external_id,
        'name', name, 'master_place_id', master_place_id::text, 'is_active', is_active))
      from source_record
      where master_place_id = p_canonical_mp_id or master_place_id = any(p_absorbed_mp_ids)),
      '[]'::jsonb));

  update source_record
     set master_place_id = p_canonical_mp_id, updated_at = now()
   where master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('source_records_repointed', v_count);

  -- place_match dedup — v2 logic
  delete from place_match pm_a
   where pm_a.master_place_id = any(p_absorbed_mp_ids)
     and (
       exists (select 1 from place_match pm_c
                where pm_c.source_record_id = pm_a.source_record_id
                  and pm_c.master_place_id = p_canonical_mp_id)
       or exists (select 1 from place_match pm_b
                   where pm_b.master_place_id = any(p_absorbed_mp_ids)
                     and pm_b.master_place_id < pm_a.master_place_id
                     and pm_b.source_record_id = pm_a.source_record_id)
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_matches_deduped', v_count);
  update place_match set master_place_id = p_canonical_mp_id
   where master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_matches_repointed', v_count);

  -- 3a. self-ref cleanup — v3: also delete absorbed↔absorbed edges,
  --     which would collapse to (canonical, canonical) after both column
  --     UPDATEs and violate the no_self_ref CHECK. See group 89
  --     (Fort Churchill 4-way): edges 0e8e7c64→e727a4b3 and
  --     7c3cc7e2→e727a4b3 were both absorbed-to-absorbed once canonical
  --     was picked from a different member than v2 assumed.
  delete from place_relationships
   where (child_master_place_id = any(p_absorbed_mp_ids) and parent_master_place_id = p_canonical_mp_id)
      or (parent_master_place_id = any(p_absorbed_mp_ids) and child_master_place_id = p_canonical_mp_id)
      or (child_master_place_id = any(p_absorbed_mp_ids) and parent_master_place_id = any(p_absorbed_mp_ids)); -- v3
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_self_refs_dropped', v_count);

  -- 3b. child-column dedup (v2 logic unchanged)
  delete from place_relationships pr_a
   where pr_a.child_master_place_id = any(p_absorbed_mp_ids)
     and (
       exists (select 1 from place_relationships pr_c
                where pr_c.child_master_place_id = p_canonical_mp_id
                  and pr_c.parent_master_place_id = pr_a.parent_master_place_id
                  and pr_c.relationship_type = pr_a.relationship_type)
       or exists (select 1 from place_relationships pr_b
                   where pr_b.child_master_place_id = any(p_absorbed_mp_ids)
                     and pr_b.child_master_place_id < pr_a.child_master_place_id
                     and pr_b.parent_master_place_id = pr_a.parent_master_place_id
                     and pr_b.relationship_type = pr_a.relationship_type)
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_child_dedup', v_count);

  -- 3c. parent-column dedup (v2 logic unchanged)
  delete from place_relationships pr_a
   where pr_a.parent_master_place_id = any(p_absorbed_mp_ids)
     and (
       exists (select 1 from place_relationships pr_c
                where pr_c.parent_master_place_id = p_canonical_mp_id
                  and pr_c.child_master_place_id = pr_a.child_master_place_id
                  and pr_c.relationship_type = pr_a.relationship_type)
       or exists (select 1 from place_relationships pr_b
                   where pr_b.parent_master_place_id = any(p_absorbed_mp_ids)
                     and pr_b.parent_master_place_id < pr_a.parent_master_place_id
                     and pr_b.child_master_place_id = pr_a.child_master_place_id
                     and pr_b.relationship_type = pr_a.relationship_type)
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_parent_dedup', v_count);

  update place_relationships set child_master_place_id = p_canonical_mp_id
   where child_master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_child_repointed', v_count);

  update place_relationships set parent_master_place_id = p_canonical_mp_id
   where parent_master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_parent_repointed', v_count);

  -- master_place_generated_content — v2 dedup logic
  delete from master_place_generated_content gc_a
   where gc_a.master_place_id = any(p_absorbed_mp_ids)
     and (
       exists (select 1 from master_place_generated_content gc_c
                where gc_c.master_place_id = p_canonical_mp_id
                  and gc_c.field_name = gc_a.field_name)
       or exists (select 1 from master_place_generated_content gc_b
                   where gc_b.master_place_id = any(p_absorbed_mp_ids)
                     and gc_b.master_place_id < gc_a.master_place_id
                     and gc_b.field_name = gc_a.field_name)
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('generated_content_deduped', v_count);
  update master_place_generated_content set master_place_id = p_canonical_mp_id
   where master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('generated_content_repointed', v_count);

  -- master_place_photo_candidate — v2 dedup logic
  delete from master_place_photo_candidate pc_a
   where pc_a.master_place_id = any(p_absorbed_mp_ids)
     and (
       exists (select 1 from master_place_photo_candidate pc_c
                where pc_c.master_place_id = p_canonical_mp_id
                  and pc_c.image_url = pc_a.image_url)
       or exists (select 1 from master_place_photo_candidate pc_b
                   where pc_b.master_place_id = any(p_absorbed_mp_ids)
                     and pc_b.master_place_id < pc_a.master_place_id
                     and pc_b.image_url = pc_a.image_url)
     );
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('photo_candidates_deduped', v_count);
  update master_place_photo_candidate set master_place_id = p_canonical_mp_id
   where master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('photo_candidates_repointed', v_count);

  update master_place
     set is_searchable = false, source_count = 0, updated_at = now()
   where id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('absorbed_soft_retired', v_count);

  perform recompute_master_place(p_canonical_mp_id);

  select jsonb_object_agg(id::text, to_jsonb(mp) - 'geometry' - 'geometry_polygon')
    into v_after
    from master_place mp
    where mp.id = p_canonical_mp_id or mp.id = any(p_absorbed_mp_ids);
  v_after := v_after || jsonb_build_object(
    'source_records',
    coalesce(
      (select jsonb_agg(jsonb_build_object(
        'id', id::text, 'source_id', source_id, 'external_id', external_id,
        'name', name, 'master_place_id', master_place_id::text, 'is_active', is_active))
      from source_record
      where master_place_id = p_canonical_mp_id or master_place_id = any(p_absorbed_mp_ids)),
      '[]'::jsonb));

  insert into merge_audit_log (
    executed_by, canonical_mp_id, absorbed_mp_ids,
    target_env, group_id, before_snapshot, after_snapshot, moves, notes
  ) values (
    p_executed_by, p_canonical_mp_id, p_absorbed_mp_ids,
    p_target_env, p_group_id, v_before, v_after, v_moves, p_notes
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'audit_id', v_audit_id, 'canonical_mp_id', p_canonical_mp_id,
    'absorbed_mp_ids', to_jsonb(p_absorbed_mp_ids), 'moves', v_moves,
    'target_env', p_target_env);
end;
$$;

comment on function public.merge_master_place is
  'v3 (2026-09-03): additionally deletes absorbed↔absorbed place_relationships '
  'edges to prevent self-ref CHECK violations after both column UPDATEs. '
  'See docs/investigations/2026-09-03-merge-executor-full-run.md.';

grant execute on function public.merge_master_place(uuid, uuid[], text, text, integer, text)
  to service_role;
