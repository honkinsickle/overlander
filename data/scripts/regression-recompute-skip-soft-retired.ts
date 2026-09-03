#!/usr/bin/env node
// Targeted regression test for v5 recompute_master_place() skip-soft-retired fix.
//
// Uses supabase-js only — no direct DB connection needed. Writes PostGIS
// values via EWKT strings (PostgREST accepts them for geometry columns).
//
// Constructs a controlled scenario on TEST:
//   1. Seed a "canonical" mp with a polygon + one active source_record.
//   2. Seed a "soft-retired" mp: point inside canonical's polygon,
//      is_searchable=false, source_count=0, NO active source_records.
//   3. Seed a "normal-other" mp: point inside canonical's polygon, one
//      active source_record. Positive control.
//   4. Call recompute_master_place(canonical).
//   5. Assert positive control (normal → canonical) exists; assert
//      soft-retired is NOT linked.
//   6. Call recompute_master_place(soft-retired). Assert no edges appear.
//   7. Clean up.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
function readEnv(p: string) {
  const out: Record<string, string> = {}
  for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
const env = readEnv(join(__dirname, '../.env'))
if (env.SUPABASE_URL !== 'https://znldzjdatkogdktymtvi.supabase.co') {
  console.error('SAFETY: not TEST'); process.exit(1)
}
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const canonicalId = randomUUID()
const softRetiredId = randomUUID()
const normalOtherId = randomUUID()
const canonicalSrId = randomUUID()
const normalSrId = randomUUID()

// Off-grid coordinates so no accidental real-corpus containment collision.
// (89.0, 179.0) is in the Arctic; no PADUS/state_parks polygons there.
const LNG = 179.0
const LAT = 89.0
const POINT_EWKT = `SRID=4326;POINT(${LNG} ${LAT})`
const POLY_EWKT = `SRID=4326;MULTIPOLYGON(((${LNG - 0.01} ${LAT - 0.01}, ${LNG + 0.01} ${LAT - 0.01}, ${LNG + 0.01} ${LAT + 0.01}, ${LNG - 0.01} ${LAT + 0.01}, ${LNG - 0.01} ${LAT - 0.01})))`

let cleanupNeeded = true
async function cleanup() {
  if (!cleanupNeeded) return
  console.log('\ncleanup ...')
  await supa.from('place_relationships').delete().in('child_master_place_id', [canonicalId, softRetiredId, normalOtherId])
  await supa.from('place_relationships').delete().in('parent_master_place_id', [canonicalId, softRetiredId, normalOtherId])
  await supa.from('source_record').delete().in('id', [canonicalSrId, normalSrId])
  await supa.from('master_place').delete().in('id', [canonicalId, softRetiredId, normalOtherId])
  cleanupNeeded = false
}
process.on('SIGINT', async () => { await cleanup(); process.exit(1) })

async function assertOk<T>(label: string, resp: { data: T; error: any }): Promise<T> {
  if (resp.error) { console.error(`${label} failed:`, resp.error); await cleanup(); process.exit(1) }
  return resp.data
}

try {
  console.log(`fixtures: canonical=${canonicalId.slice(0, 8)}  soft=${softRetiredId.slice(0, 8)}  normal=${normalOtherId.slice(0, 8)}`)

  await assertOk('insert canonical mp', await supa.from('master_place').insert({
    id: canonicalId, canonical_name: 'REGRESSION-canonical', primary_category: 'state_park',
    geometry: POINT_EWKT, geometry_polygon: POLY_EWKT,
    source_count: 1, is_searchable: true, prominence_score: 0,
  }))
  await assertOk('insert soft-retired mp', await supa.from('master_place').insert({
    id: softRetiredId, canonical_name: 'REGRESSION-soft-retired', primary_category: 'state_park',
    geometry: POINT_EWKT, geometry_polygon: null,
    source_count: 0, is_searchable: false, prominence_score: 0,
  }))
  await assertOk('insert normal mp', await supa.from('master_place').insert({
    id: normalOtherId, canonical_name: 'REGRESSION-normal-other', primary_category: 'campground',
    geometry: POINT_EWKT, geometry_polygon: null,
    source_count: 1, is_searchable: true, prominence_score: 0,
  }))

  // canonical SR carries geometry_polygon in normalized_payload so Step 5
  // resolves it and Step 7's role-(b) polygon guard sees geometry_polygon
  // still set after recompute (otherwise Step 5's clear-branch would null it).
  await assertOk('insert canonical SR', await supa.from('source_record').insert({
    id: canonicalSrId, source_id: 'nps', external_id: `REG-can-${canonicalSrId}`,
    name: 'REGRESSION canonical SR', master_place_id: canonicalId,
    geometry: POINT_EWKT, is_active: true,
    normalized_payload: {
      geometry_polygon: {
        type: 'MultiPolygon',
        coordinates: [[[[LNG - 0.01, LAT - 0.01], [LNG + 0.01, LAT - 0.01], [LNG + 0.01, LAT + 0.01], [LNG - 0.01, LAT + 0.01], [LNG - 0.01, LAT - 0.01]]]],
      },
    },
    raw_payload: {},
  }))
  await assertOk('insert normal SR', await supa.from('source_record').insert({
    id: normalSrId, source_id: 'nps', external_id: `REG-norm-${normalSrId}`,
    name: 'REGRESSION normal SR', master_place_id: normalOtherId,
    geometry: POINT_EWKT, is_active: true, normalized_payload: {}, raw_payload: {},
  }))

  console.log('\ncalling recompute_master_place(canonical) ...')
  const { error: recErr } = await supa.rpc('recompute_master_place', { p_master_place_id: canonicalId })
  if (recErr) { console.error('recompute failed:', recErr); await cleanup(); process.exit(1) }

  const { data: edges1, error: e1 } = await supa
    .from('place_relationships')
    .select('child_master_place_id, parent_master_place_id, relationship_type')
    .in('child_master_place_id', [canonicalId, softRetiredId, normalOtherId])
  if (e1) { console.error('read edges failed:', e1); await cleanup(); process.exit(1) }
  const { data: edges2 } = await supa
    .from('place_relationships')
    .select('child_master_place_id, parent_master_place_id, relationship_type')
    .in('parent_master_place_id', [canonicalId, softRetiredId, normalOtherId])
  const all = [...(edges1 ?? []), ...(edges2 ?? [])]
  const seen = new Set<string>()
  const edges = all.filter((e) => {
    const k = `${e.child_master_place_id}|${e.parent_master_place_id}|${e.relationship_type}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  console.log(`  edges: ${edges.length}`)
  for (const e of edges) {
    const label = (id: string) =>
      id === canonicalId ? 'CAN' :
      id === softRetiredId ? 'SR' :
      id === normalOtherId ? 'NORM' : `OTHER(${id.slice(0, 8)})`
    console.log(`    ${label(e.child_master_place_id)} → ${label(e.parent_master_place_id)}  (${e.relationship_type})`)
  }

  let failures = 0
  const hasNormal = edges.some((e) => e.child_master_place_id === normalOtherId && e.parent_master_place_id === canonicalId)
  const hasSoftRetired = edges.some((e) => e.child_master_place_id === softRetiredId || e.parent_master_place_id === softRetiredId)
  if (hasNormal) console.log('  ✓ POSITIVE control: normal-other IS linked as child of canonical')
  else { console.log('  ✗ POSITIVE control FAILED'); failures += 1 }
  if (!hasSoftRetired) console.log('  ✓ v5 FILTER: soft-retired NOT linked')
  else { console.log('  ✗ v5 FILTER FAILED: soft-retired is linked'); failures += 1 }

  console.log('\ncalling recompute_master_place(soft-retired) ...')
  const { error: recErr2 } = await supa.rpc('recompute_master_place', { p_master_place_id: softRetiredId })
  if (recErr2) { console.error('recompute soft-retired failed:', recErr2); await cleanup(); process.exit(1) }
  const { data: srEdges1 } = await supa.from('place_relationships').select('*').eq('child_master_place_id', softRetiredId)
  const { data: srEdges2 } = await supa.from('place_relationships').select('*').eq('parent_master_place_id', softRetiredId)
  const srEdges = [...(srEdges1 ?? []), ...(srEdges2 ?? [])]
  if (srEdges.length === 0) console.log('  ✓ v5 SELF-GUARD: recompute on soft-retired inserts no edges')
  else { console.log(`  ✗ v5 SELF-GUARD FAILED: ${srEdges.length} edges inserted`); failures += 1 }

  await cleanup()
  if (failures === 0) { console.log('\n✓ regression PASSED (3/3 assertions)'); process.exit(0) }
  console.log(`\n✗ regression FAILED (${failures} assertion failure(s))`); process.exit(1)
} catch (e) {
  console.error(e); await cleanup(); process.exit(1)
}
