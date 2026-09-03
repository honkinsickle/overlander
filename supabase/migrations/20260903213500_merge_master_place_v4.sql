-- merge_master_place() v4 — post-recompute cleanup for absorbed-mp edges
-- inserted by recompute_master_place()'s containment scan.
--
-- Found on TEST full-decidable-set run: 40 orphan place_relationships rows
-- with child = absorbed, parent = canonical, computed_at timestamps
-- matching the merge's own execution window. The mechanism:
--
--   1. v3 correctly deletes absorbed↔canonical edges before repointing.
--   2. Step 3d's UPDATEs correctly move all remaining edges off absorbed.
--   3. Step 7 calls recompute_master_place(canonical). Recompute's
--      containment scan finds ALL master_places whose polygon covers
--      canonical's Point (or vice versa) — and absorbed mps are still
--      in master_place (soft-retired, not deleted), still have their
--      geometry columns intact. So recompute re-inserts edges like
--      (child=absorbed, parent=canonical) because absorbed's Point still
--      sits inside canonical's polygon.
--
-- The right fix long-term is that recompute_master_place() should skip
-- soft-retired mps (is_searchable=false, source_count=0). That's a
-- separate change. For now, v4 does a post-recompute cleanup pass that
-- deletes any place_relationships row involving an absorbed mp on either
-- side. This is safe: step 3d already repointed every legitimate edge
-- off absorbed; anything left involving absorbed is post-recompute
-- garbage.

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

  delete from place_relationships
   where (child_master_place_id = any(p_absorbed_mp_ids) and parent_master_place_id = p_canonical_mp_id)
      or (parent_master_place_id = any(p_absorbed_mp_ids) and child_master_place_id = p_canonical_mp_id)
      or (child_master_place_id = any(p_absorbed_mp_ids) and parent_master_place_id = any(p_absorbed_mp_ids));
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_self_refs_dropped', v_count);

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

  -- v4: recompute's containment scan re-inserts place_relationships rows
  -- involving the soft-retired absorbed mps (their geometry is still
  -- intact). Sweep them out. Nothing legitimate should point at absorbed
  -- at this point — step 3d already handled all legitimate edges. Anything
  -- involving absorbed here is post-recompute garbage.
  delete from place_relationships
   where child_master_place_id = any(p_absorbed_mp_ids)
      or parent_master_place_id = any(p_absorbed_mp_ids);
  get diagnostics v_count = row_count;
  v_moves := v_moves || jsonb_build_object('place_relationships_post_recompute_absorbed_cleanup', v_count);

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
  'v4 (2026-09-03): adds post-recompute cleanup for place_relationships '
  'rows involving absorbed mps that recompute_master_place() re-inserts '
  'via its containment scan.';

grant execute on function public.merge_master_place(uuid, uuid[], text, text, integer, text)
  to service_role;
