-- ============================================================================
-- resolve_place_match / unresolve_place_match — in-place pending-row resolution
--
-- Motivation: apply_match_outcomes (20260527130300) is INSERT-only. Its
-- manual_review branch INSERTs a pending place_match and leaves the
-- source_record unlinked. There is no path today that CONFIRMS an existing
-- pending row: re-inserting collides with the
-- unique(source_record_id, master_place_id) constraint, and nothing links the
-- source_record or recomputes the master_place. These two functions add that
-- path (confirm) and its exact inverse (undo), so a rule-driven queue resolver
-- can act on the pending backlog and be fully reversed.
--
-- resolve_place_match(pm_id, resolved_by):
--   * requires the row exist and be status='pending'
--   * refuses if the source_record is already linked to a DIFFERENT
--     master_place (would silently move it — caller must handle explicitly)
--   * links source_record → the row's master_place
--   * sets status='confirmed', resolved_by=<caller tag>, resolved_at=now()
--   * recompute_master_place(target) — the SR now contributes fields/count
--
-- unresolve_place_match(pm_id, prior_sr_master_place_id):
--   * exact inverse: restores source_record.master_place_id to the snapshotted
--     prior value (NULL for a row that was pending), flips status back to
--     'pending', nulls resolved_by/resolved_at, recompute_master_place(target).
--   * recompute is a full recount/re-resolve over is_active SRs, so removing
--     the just-added SR restores canonical_name/primary_category/source_count
--     to their prior values deterministically.
--
-- Both are generic (no rule/tag coupling). The 'rule:recgov-id:<tag>' tagging
-- discipline and the snapshot file live in the caller
-- (data/scripts/resolve-recgov-rule.ts). Neither function deletes rows, so the
-- audit trail is preserved across confirm/undo cycles.
-- ============================================================================

set search_path = public;

create or replace function public.resolve_place_match(
  p_place_match_id uuid,
  p_resolved_by text
)
returns jsonb
language plpgsql
volatile
as $$
declare
  v_sr            uuid;
  v_mp            uuid;
  v_status        text;
  v_sr_current_mp uuid;
begin
  select source_record_id, master_place_id, status
    into v_sr, v_mp, v_status
  from public.place_match
  where id = p_place_match_id;

  if v_sr is null then
    raise exception 'resolve_place_match: place_match % not found', p_place_match_id;
  end if;
  if v_status <> 'pending' then
    raise exception 'resolve_place_match: place_match % is % (expected pending)',
      p_place_match_id, v_status;
  end if;

  select master_place_id into v_sr_current_mp
  from public.source_record where id = v_sr;

  if v_sr_current_mp is not null and v_sr_current_mp <> v_mp then
    raise exception
      'resolve_place_match: source_record % already linked to different master_place % (target %)',
      v_sr, v_sr_current_mp, v_mp;
  end if;

  update public.source_record set master_place_id = v_mp where id = v_sr;

  update public.place_match
     set status = 'confirmed', resolved_by = p_resolved_by, resolved_at = now()
   where id = p_place_match_id;

  perform public.recompute_master_place(v_mp);

  return jsonb_build_object(
    'place_match_id',   p_place_match_id,
    'source_record_id', v_sr,
    'master_place_id',  v_mp,
    'status',           'confirmed'
  );
end;
$$;

create or replace function public.unresolve_place_match(
  p_place_match_id uuid,
  p_prior_sr_master_place_id uuid default null
)
returns jsonb
language plpgsql
volatile
as $$
declare
  v_sr uuid;
  v_mp uuid;
begin
  select source_record_id, master_place_id
    into v_sr, v_mp
  from public.place_match
  where id = p_place_match_id;

  if v_sr is null then
    raise exception 'unresolve_place_match: place_match % not found', p_place_match_id;
  end if;

  update public.source_record
     set master_place_id = p_prior_sr_master_place_id
   where id = v_sr;

  update public.place_match
     set status = 'pending', resolved_by = null, resolved_at = null
   where id = p_place_match_id;

  perform public.recompute_master_place(v_mp);

  return jsonb_build_object(
    'place_match_id',   p_place_match_id,
    'source_record_id', v_sr,
    'master_place_id',  v_mp,
    'status',           'pending'
  );
end;
$$;
