/**
 * Apply Adam-signed-off triage decisions for arizona_state_parks
 * (PR #350 follow-up).
 *
 * Both are LINKs against a target OTHER than the matcher's original
 * proposal — the matcher's picks were the closest-by-coordinates in
 * each case, but a better-named target exists in the corpus per the
 * triage report:
 *
 *   1. arizona_state_parks:colorado-river ("Colorado River State
 *      Historic Park")
 *        matcher's pick:      7bf97c6b… (Yuma Quartermaster Depot SHP,
 *                             PADUS-only, public_land) — WRONG
 *        correct target:      48785379-779d-47ad-9088-539377ba6ebc
 *                             ("Colorado River State Historic Park",
 *                             NPS-anchored, park_feature, exact-name)
 *
 *   2. arizona_state_parks:fool-hollow ("Fool Hollow Lake Recreation
 *      Area")
 *        matcher's pick:      44f648c1… (Fool Hollow West Launch
 *                             Boating Site, RIDB sub-facility) — WRONG
 *        correct target:      478b95d7-24cd-421c-97b1-c99c0439a9a2
 *                             ("Fool Hollow Lake Recreation Area
 *                             Campground", campground, source_count 3,
 *                             `alternative_names` contains the exact
 *                             park name)
 *
 * For each: UPDATE the pending place_match row to point at the correct
 * master_place, set status='confirmed', match_method='manual_review',
 * add a rationale to notes; UPDATE source_record.master_place_id;
 * RPC recompute_master_place on the target.
 *
 * TEST only. Dry-run by default; pass --apply to write.
 *
 * Run:
 *   npx tsx --env-file=.env scripts/az-state-parks-triage-apply.mjs [--apply]
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const RESOLVER = 'adam:az-triage-2026-09-02';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const decisions = [
  {
    label: 'Colorado River State Historic Park',
    external_id: 'arizona_state_parks:colorado-river',
    target_mp_id: '48785379-779d-47ad-9088-539377ba6ebc',
    target_name: 'Colorado River State Historic Park',
    reject_mp_id: '7bf97c6b-a517-4fcb-a5da-7934b795a490',
    reject_name: 'Yuma Quartermaster Depot State Historic Park',
    notes:
      'Manual triage: matcher proposed Yuma Quartermaster Depot SHP (PADUS-only, public_land) as closest by distance, but the exact-name-match Colorado River SHP (NPS-anchored, park_feature) is the correct target. Same physical park unit — the AZ visitor page opens by explaining the current park sits on the historical Quartermaster Depot grounds. The two candidates describe the same site under different names and should be merged in a future dedup pass (BACKLOG).',
  },
  {
    label: 'Fool Hollow Lake Recreation Area',
    external_id: 'arizona_state_parks:fool-hollow',
    target_mp_id: '478b95d7-24cd-421c-97b1-c99c0439a9a2',
    target_name: 'Fool Hollow Lake Recreation Area Campground',
    reject_mp_id: '44f648c1-c4d9-4e8b-ac04-3fa877404671',
    reject_name: 'Fool Hollow West Launch Boating Site',
    notes:
      "Manual triage: matcher proposed a boat-launch sub-facility (Fool Hollow West Launch Boating Site, RIDB) as closest by distance and name; correct target is the park-unit mp whose alternative_names already contains \"Fool Hollow Lake Recreation Area\" exactly and whose USFS contributor's canonical_name is \"Fool Hollow Lake Recreation Area\" (currently canonical_name \"…Campground\", source_count 3: RIDB + OSM + USFS).",
  },
];

async function findPendingPlaceMatch(externalId) {
  const sr = await sb
    .from('source_record')
    .select('id, external_id, name, master_place_id')
    .eq('source_id', 'arizona_state_parks')
    .eq('external_id', externalId)
    .maybeSingle();
  if (sr.error || !sr.data) throw new Error(`source_record not found for ${externalId}: ${sr.error?.message}`);
  const pm = await sb
    .from('place_match')
    .select('id, source_record_id, master_place_id, status, match_method')
    .eq('source_record_id', sr.data.id)
    .in('status', ['pending', 'manual_review'])
    .maybeSingle();
  if (pm.error) throw new Error(`place_match lookup failed for ${externalId}: ${pm.error.message}`);
  return { sr: sr.data, pm: pm.data };
}

async function applyOne(d) {
  console.log('\n---', d.label, '---');
  const { sr, pm } = await findPendingPlaceMatch(d.external_id);
  if (!pm) {
    console.log('  no pending/manual_review place_match — already resolved? sr.master_place_id:', sr.master_place_id);
    return { skipped: true };
  }
  console.log('  source_record.id:', sr.id);
  console.log('  pending place_match.id:', pm.id, 'currently → mp:', pm.master_place_id, `(${d.reject_name})`);
  console.log('  target mp:', d.target_mp_id, `(${d.target_name})`);
  console.log('  apply?', APPLY);

  if (!APPLY) return { would_apply: true };

  const nowIso = new Date().toISOString();

  // 1. Overwrite the pending place_match with the corrected target + confirm.
  const upd = await sb
    .from('place_match')
    .update({
      master_place_id: d.target_mp_id,
      status: 'confirmed',
      match_method: 'manual_review',
      resolved_by: RESOLVER,
      resolved_at: nowIso,
      notes: d.notes,
    })
    .eq('id', pm.id);
  if (upd.error) throw new Error(`place_match update failed: ${upd.error.message}`);

  // 2. Set source_record.master_place_id to the corrected target.
  const srUpd = await sb
    .from('source_record')
    .update({ master_place_id: d.target_mp_id })
    .eq('id', sr.id);
  if (srUpd.error) throw new Error(`source_record update failed: ${srUpd.error.message}`);

  // 3. Recompute the target master_place so AZ fields flow through.
  const rc = await sb.rpc('recompute_master_place', { p_master_place_id: d.target_mp_id });
  if (rc.error) throw new Error(`recompute_master_place(target) failed: ${rc.error.message}`);

  console.log('  ✓ linked + recomputed');
  return { applied: true };
}

async function main() {
  console.log('project:', process.env.SUPABASE_URL);
  console.log('mode:', APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to write)');
  for (const d of decisions) {
    try {
      await applyOne(d);
    } catch (err) {
      console.error('  ✗ FAILED:', err.message);
      process.exit(1);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
