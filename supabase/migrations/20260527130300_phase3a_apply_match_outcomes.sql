-- ============================================================================
-- Phase 3a: apply_match_outcomes() — transactional application layer
--
-- Takes a JSONB array of MatchOutcome objects (the shape emitted by
-- matcher.ts matchAll) and applies all mutations in a single Postgres
-- transaction (the default for plpgsql functions).
--
-- promote.ts calls this RPC. The Supabase JS client doesn't natively
-- expose multi-statement transactions, so we push the transactionality
-- down to the DB.
--
-- Outcome handling per docs/phase-3a-build-spec.md §6.1:
--
--   new_master_place
--     INSERT master_place (id=target, canonical_name=seed_name,
--       primary_category=seed_category, geometry=seed_geometry)
--     UPDATE source_record SET master_place_id = target
--     INSERT place_match (self-referential, confidence=1.0,
--       match_method='deterministic', status='confirmed')
--     Queue target for recompute_master_place.
--
--   auto_link
--     UPDATE source_record SET master_place_id = target
--     INSERT place_match (score components from outcome.score, or all
--       1.0 if score is null e.g. fed_exact), match_method = outcome.method
--       ('fed_exact' | 'name_dominant' | 'deterministic'), status='confirmed'
--     Queue target for recompute.
--
--   amenity_rollup
--     UPDATE source_record SET master_place_id = target
--     INSERT place_match (distance computed from actual geometries,
--       name_sim=0, cat_compat=1.0, confidence=1.0,
--       match_method='amenity_rollup', status='confirmed')
--     Queue target for recompute.
--
--   manual_review
--     INSERT place_match (status='pending', resolved_by=null,
--       match_method='deterministic') — source_record stays unlinked
--     NO recompute (master_place's data didn't change).
--
-- After all mutations, deduplicate the recompute queue and call
-- recompute_master_place(id) for each. Per-outcome errors are caught
-- and returned in the errors array rather than rolling back the whole
-- transaction — a single bad row shouldn't block 200 good ones.
--
-- Note on match_method for manual_review: close_nameless and blended-
-- fallback manual_reviews both go in with 'deterministic'. The audit-cli
-- (Phase 3b) can distinguish via the score signature
-- (close_nameless has name_sim<0.85, cat_compat≥0.8, dist≤100m) if
-- needed. Adding a separate method tag for close_nameless is a
-- non-functional follow-up.
-- ============================================================================

set search_path = public;

create or replace function public.apply_match_outcomes(p_outcomes jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  v_outcome jsonb;
  v_kind text;
  v_source_record_id uuid;
  v_target uuid;
  v_score jsonb;
  v_distance_m float;
  v_name_sim float;
  v_cat_compat float;
  v_confidence float;
  v_method text;
  v_lng float;
  v_lat float;
  v_recompute_queue uuid[] := array[]::uuid[];
  v_mp_id uuid;
  v_auto_linked integer := 0;
  v_amenity_rolled_up integer := 0;
  v_manual_review_queued integer := 0;
  v_new_master_places integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  for v_outcome in select value from jsonb_array_elements(p_outcomes) as t(value) loop
    begin
      v_kind := v_outcome ->> 'kind';
      v_source_record_id := (v_outcome ->> 'source_record_id')::uuid;
      v_target := (v_outcome ->> 'target')::uuid;
      v_score := v_outcome -> 'score';

      if v_kind = 'new_master_place' then
        v_lng := (v_outcome -> 'seed_geometry' ->> 0)::float;
        v_lat := (v_outcome -> 'seed_geometry' ->> 1)::float;

        insert into public.master_place (id, canonical_name, primary_category, geometry)
        values (
          v_target,
          v_outcome ->> 'seed_name',
          v_outcome ->> 'seed_category',
          st_setsrid(st_makepoint(v_lng, v_lat), 4326)
        );

        update public.source_record
           set master_place_id = v_target
         where id = v_source_record_id;

        insert into public.place_match (
          source_record_id, master_place_id,
          distance_meters, name_similarity, category_compatibility, combined_confidence,
          match_method, status, resolved_by, resolved_at
        ) values (
          v_source_record_id, v_target,
          0, 1.0, 1.0, 1.0,
          'deterministic', 'confirmed', 'auto', now()
        );

        v_recompute_queue := array_append(v_recompute_queue, v_target);
        v_new_master_places := v_new_master_places + 1;

      elsif v_kind = 'auto_link' then
        v_method := coalesce(v_outcome ->> 'method', 'deterministic');
        v_confidence := (v_outcome ->> 'confidence')::float;

        -- fed_exact emits score=null (no scoring was needed). Default the
        -- audit columns to 1.0 in that case so the row is well-formed.
        if v_score is null or v_score = 'null'::jsonb then
          v_distance_m := 0;
          v_name_sim := 1.0;
          v_cat_compat := 1.0;
        else
          v_distance_m := coalesce((v_score ->> 'distance_meters')::float, 0);
          v_name_sim := coalesce((v_score ->> 'name_similarity')::float, 0);
          v_cat_compat := coalesce((v_score ->> 'category_compatibility')::float, 0);
        end if;

        update public.source_record
           set master_place_id = v_target
         where id = v_source_record_id;

        insert into public.place_match (
          source_record_id, master_place_id,
          distance_meters, name_similarity, category_compatibility, combined_confidence,
          match_method, status, resolved_by, resolved_at
        ) values (
          v_source_record_id, v_target,
          v_distance_m, v_name_sim, v_cat_compat, v_confidence,
          v_method, 'confirmed', 'auto', now()
        );

        v_recompute_queue := array_append(v_recompute_queue, v_target);
        v_auto_linked := v_auto_linked + 1;

      elsif v_kind = 'amenity_rollup' then
        -- Compute actual distance from source_record to target master_place
        -- for the audit row. Useful for inspecting "did the rollup pick the
        -- right parent?" without re-running matcher.ts.
        select st_distance(sr.geometry::geography, mp.geometry::geography)
          into v_distance_m
        from public.source_record sr, public.master_place mp
        where sr.id = v_source_record_id and mp.id = v_target;

        update public.source_record
           set master_place_id = v_target
         where id = v_source_record_id;

        insert into public.place_match (
          source_record_id, master_place_id,
          distance_meters, name_similarity, category_compatibility, combined_confidence,
          match_method, status, resolved_by, resolved_at
        ) values (
          v_source_record_id, v_target,
          coalesce(v_distance_m, 0), 0, 1.0, 1.0,
          'amenity_rollup', 'confirmed', 'auto', now()
        );

        v_recompute_queue := array_append(v_recompute_queue, v_target);
        v_amenity_rolled_up := v_amenity_rolled_up + 1;

      elsif v_kind = 'manual_review' then
        v_confidence := (v_outcome ->> 'confidence')::float;
        v_distance_m := coalesce((v_score ->> 'distance_meters')::float, 0);
        v_name_sim := coalesce((v_score ->> 'name_similarity')::float, 0);
        v_cat_compat := coalesce((v_score ->> 'category_compatibility')::float, 0);

        -- Do NOT update source_record — it stays unresolved. No recompute.
        insert into public.place_match (
          source_record_id, master_place_id,
          distance_meters, name_similarity, category_compatibility, combined_confidence,
          match_method, status, resolved_by, resolved_at
        ) values (
          v_source_record_id, v_target,
          v_distance_m, v_name_sim, v_cat_compat, v_confidence,
          'deterministic', 'pending', null, null
        );

        v_manual_review_queued := v_manual_review_queued + 1;

      else
        raise exception 'apply_match_outcomes: unknown outcome kind %', v_kind;
      end if;

    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'source_record_id', v_source_record_id,
        'target', v_target,
        'kind', v_kind,
        'phase', 'apply',
        'error', sqlerrm
      );
    end;
  end loop;

  -- Recompute each unique target. Errors here are caught per-MP so one
  -- bad recompute doesn't strand the others.
  for v_mp_id in select distinct unnest(v_recompute_queue) loop
    begin
      perform public.recompute_master_place(v_mp_id);
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'master_place_id', v_mp_id,
        'phase', 'recompute',
        'error', sqlerrm
      );
    end;
  end loop;

  return jsonb_build_object(
    'auto_linked', v_auto_linked,
    'amenity_rolled_up', v_amenity_rolled_up,
    'manual_review_queued', v_manual_review_queued,
    'new_master_places', v_new_master_places,
    'errors', v_errors
  );
end;
$$;
