-- ============================================================================
-- reject_place_match_to_new_master_place — reject a pending manual_review row
-- AND promote its source_record to its own new_master_place.
--
-- Motivation: apply_match_outcomes (20260527130300) is INSERT-only and
-- resolve_place_match (20260817120000) only handles the CONFIRM path. There
-- was no path today that says "this manual_review row is wrong — don't merge,
-- give the source_record its own master_place instead." Doing that with plain
-- SQL required: (1) UPDATE the pending row to rejected, (2) INSERT a new
-- master_place seeded from the SR, (3) UPDATE the SR's master_place_id, (4)
-- INSERT a confirmed place_match for the new MP, (5) recompute both MPs.
-- Five statements per row is easy to get wrong; encapsulating here.
--
-- Contract:
--   * requires the row exist and be status='pending'
--   * refuses if the source_record is already linked to some master_place
--     (would silently orphan the existing linkage — caller must handle
--     explicitly)
--   * flips the pending row to status='rejected', resolved_by=<caller tag>
--   * mints a new master_place seeded from the SR (name, inferred_category,
--     geometry), and links the SR to it
--   * inserts a confirmed place_match for the (SR, new_MP) pair, mirroring
--     apply_match_outcomes's new_master_place branch (distance 0, sims 1.0,
--     method 'deterministic', resolved_by=<caller tag>)
--   * recompute_master_place() on BOTH the original target MP (in case the
--     rejected row would have contributed) and the new MP
--
-- Not built: an inverse `unreject_…` mirror of unresolve_place_match. The
-- new_master_place row is a real MP the moment it's created, and undoing
-- would need to delete it — a class of operation neither resolve nor
-- unresolve does. If a reverse is ever needed, build it deliberately.
--
-- Both migration files are TEST-only until deliberately promoted to prod.
-- ============================================================================

set search_path = public;

create or replace function public.reject_place_match_to_new_master_place(
  p_place_match_id uuid,
  p_resolved_by text
)
returns jsonb
language plpgsql
volatile
as $$
declare
  v_sr_id      uuid;
  v_target_mp  uuid;
  v_status     text;
  v_sr_name    text;
  v_sr_cat     text;
  v_sr_geom    geometry;
  v_sr_mp      uuid;
  v_new_mp_id  uuid;
begin
  -- Load and validate the pending row.
  select source_record_id, master_place_id, status
    into v_sr_id, v_target_mp, v_status
  from public.place_match
  where id = p_place_match_id;

  if v_sr_id is null then
    raise exception 'reject_place_match_to_new_master_place: place_match % not found', p_place_match_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'reject_place_match_to_new_master_place: place_match % is % (expected pending)',
      p_place_match_id, v_status;
  end if;

  -- Load the SR and refuse if it's already linked (any linkage — even to
  -- the same target — means someone else acted on this row concurrently).
  select name, inferred_category, geometry, master_place_id
    into v_sr_name, v_sr_cat, v_sr_geom, v_sr_mp
  from public.source_record
  where id = v_sr_id;

  if v_sr_mp is not null then
    raise exception
      'reject_place_match_to_new_master_place: source_record % already linked to master_place % (target was %)',
      v_sr_id, v_sr_mp, v_target_mp;
  end if;

  -- Reject the pending row.
  update public.place_match
     set status = 'rejected',
         resolved_by = p_resolved_by,
         resolved_at = now()
   where id = p_place_match_id;

  -- Mint the new master_place.
  v_new_mp_id := gen_random_uuid();
  insert into public.master_place (id, canonical_name, primary_category, geometry)
    values (v_new_mp_id, v_sr_name, v_sr_cat, v_sr_geom);

  -- Link SR to the new MP.
  update public.source_record
     set master_place_id = v_new_mp_id
   where id = v_sr_id;

  -- Insert the confirmed place_match for (SR, new_MP) — mirrors
  -- apply_match_outcomes's new_master_place branch.
  insert into public.place_match (
    source_record_id, master_place_id,
    distance_meters, name_similarity, category_compatibility, combined_confidence,
    match_method, status, resolved_by, resolved_at
  ) values (
    v_sr_id, v_new_mp_id,
    0, 1.0, 1.0, 1.0,
    'deterministic', 'confirmed', p_resolved_by, now()
  );

  -- Recompute the new MP so it populates fields from the SR via field_precedence.
  perform public.recompute_master_place(v_new_mp_id);

  -- Recompute the original target MP: rejecting a pending row shouldn't
  -- have changed anything (pending doesn't contribute), but be defensive
  -- so the target reflects its real, current, active-SR state.
  perform public.recompute_master_place(v_target_mp);

  return jsonb_build_object(
    'place_match_id',            p_place_match_id,
    'source_record_id',          v_sr_id,
    'rejected_target_master_place_id', v_target_mp,
    'new_master_place_id',       v_new_mp_id
  );
end;
$$;
