-- ============================================================================
-- Phase 3a: pipe manual_review.method through to place_match.match_method
--
-- Previously, all manual_review outcomes stored match_method='deterministic',
-- so the close_nameless rule and blended-residual fallback were
-- indistinguishable in the audit trail. D4 + the 3b audit CLI both want
-- to group pending rows by their cause.
--
-- matcher.ts now emits manual_review with `method: 'close_nameless' |
-- 'blended_residual'`. This migration updates apply_match_outcomes to
-- read that field for the manual_review branch.
--
-- All other branches (new_master_place, auto_link, amenity_rollup) are
-- unchanged from 20260527130300.
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
        -- NEW: read outcome.method (close_nameless | blended_residual) and
        -- store as place_match.match_method. Defaults to 'blended_residual'
        -- if the field is absent for any reason — safe fallback.
        v_method := coalesce(v_outcome ->> 'method', 'blended_residual');
        v_confidence := (v_outcome ->> 'confidence')::float;
        v_distance_m := coalesce((v_score ->> 'distance_meters')::float, 0);
        v_name_sim := coalesce((v_score ->> 'name_similarity')::float, 0);
        v_cat_compat := coalesce((v_score ->> 'category_compatibility')::float, 0);

        insert into public.place_match (
          source_record_id, master_place_id,
          distance_meters, name_similarity, category_compatibility, combined_confidence,
          match_method, status, resolved_by, resolved_at
        ) values (
          v_source_record_id, v_target,
          v_distance_m, v_name_sim, v_cat_compat, v_confidence,
          v_method, 'pending', null, null
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
