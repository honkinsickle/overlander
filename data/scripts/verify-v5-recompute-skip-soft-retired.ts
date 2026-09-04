#!/usr/bin/env node
// Verify v5 recompute_master_place() fix: iterate recompute over every
// canonical from PR #383's run, then re-scan place_relationships for
// any edge whose child or parent is a soft-retired absorbed mp.
//
// Expected: 0 orphan edges. (Before v5, this would reproduce the ~40
// orphan-edge pattern.)

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
  console.error('SAFETY: SUPABASE_URL is not TEST')
  process.exit(1)
}
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Collect all audits + absorbed ids.
const { data: audits, error: aErr } = await supa
  .from('merge_audit_log')
  .select('id, canonical_mp_id, absorbed_mp_ids')
if (aErr || !audits) { console.error('failed to read audits:', aErr); process.exit(1) }
console.log(`audit rows: ${audits.length}`)

const absorbedSet = new Set<string>()
const canonicalSet = new Set<string>()
for (const r of audits) {
  canonicalSet.add(r.canonical_mp_id)
  for (const a of r.absorbed_mp_ids ?? []) absorbedSet.add(a)
}
console.log(`unique absorbed mp ids: ${absorbedSet.size}`)
console.log(`unique canonical mp ids: ${canonicalSet.size}`)

// Snapshot: orphan edges = edges where either endpoint is a mp that
// CURRENTLY has 0 active source_records. That's the semantic definition
// of soft-retired (matches v5's filter). Using the audit's absorbed list
// would false-positive on reversals — a reversed absorbed mp has active
// SRs back and legitimately participates in place_relationships.
async function countOrphanEdges(): Promise<{ total: number; sample: any[]; softRetiredIds: string[] }> {
  // Find all mps that currently have 0 active SRs (from the union of
  // canonicals + absorbeds — the universe we care about).
  const universe = [...new Set([...absorbedSet, ...canonicalSet])]
  const CHUNK = 100
  const activeMpIds = new Set<string>()
  for (let i = 0; i < universe.length; i += CHUNK) {
    const chunk = universe.slice(i, i + CHUNK)
    const inList = `(${chunk.join(',')})`
    const { data, error } = await supa
      .from('source_record')
      .select('master_place_id')
      .filter('master_place_id', 'in', inList)
      .eq('is_active', true)
    if (error) { console.error('SR query failed:', error); process.exit(1) }
    for (const r of data ?? []) activeMpIds.add(r.master_place_id)
  }
  const softRetired = universe.filter((id) => !activeMpIds.has(id))

  // Now find place_relationships rows where either endpoint is soft-retired.
  const rows: any[] = []
  for (let i = 0; i < softRetired.length; i += CHUNK) {
    const chunk = softRetired.slice(i, i + CHUNK)
    const inList = `(${chunk.join(',')})`
    const child = await supa.from('place_relationships')
      .select('child_master_place_id,parent_master_place_id,relationship_type,computed_at')
      .filter('child_master_place_id', 'in', inList)
    const parent = await supa.from('place_relationships')
      .select('child_master_place_id,parent_master_place_id,relationship_type,computed_at')
      .filter('parent_master_place_id', 'in', inList)
    if (child.error) { console.error(child.error); process.exit(1) }
    if (parent.error) { console.error(parent.error); process.exit(1) }
    rows.push(...(child.data ?? []), ...(parent.data ?? []))
  }
  const seen = new Set<string>()
  const uniq = rows.filter((e) => {
    const k = `${e.child_master_place_id}|${e.parent_master_place_id}|${e.relationship_type}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return { total: uniq.length, sample: uniq.slice(0, 5), softRetiredIds: softRetired }
}

const before = await countOrphanEdges()
console.log(`\nBEFORE recompute pass: orphan edges = ${before.total} (${before.softRetiredIds.length} soft-retired mps in universe)`)

// Iterate recompute over every canonical.
console.log(`\nRecomputing ${canonicalSet.size} canonicals ...`)
let done = 0
let failed = 0
for (const cid of canonicalSet) {
  const { error } = await supa.rpc('recompute_master_place', { p_master_place_id: cid })
  if (error) { console.error(`  recompute FAILED for ${cid}:`, error); failed += 1 }
  done += 1
  if (done % 20 === 0) console.log(`  ... ${done}/${canonicalSet.size}`)
}
console.log(`  done: ${done - failed} succeeded, ${failed} failed`)

// Also recompute the absorbed mps. If v5 works, these should DELETE
// their own child/parent edges and NOT re-insert (v_self_has_active_sr
// is false).
console.log(`\nRecomputing ${absorbedSet.size} absorbed mps (must not re-insert edges) ...`)
done = 0; failed = 0
for (const aid of absorbedSet) {
  const { error } = await supa.rpc('recompute_master_place', { p_master_place_id: aid })
  if (error) { console.error(`  recompute FAILED for ${aid}:`, error); failed += 1 }
  done += 1
}
console.log(`  done: ${done - failed} succeeded, ${failed} failed`)

const after = await countOrphanEdges()
console.log(`\nAFTER recompute pass: orphan edges = ${after.total}`)
if (after.sample.length > 0) {
  console.log('sample orphan edges (first 5):')
  for (const e of after.sample) {
    console.log(`  child=${e.child_master_place_id.slice(0, 8)} parent=${e.parent_master_place_id.slice(0, 8)} type=${e.relationship_type} computed_at=${e.computed_at}`)
  }
}

if (after.total === 0) {
  console.log('\n✓ v5 fix verified: no orphan edges created by recompute.')
  process.exit(0)
} else {
  console.log('\n✗ v5 fix FAILED: recompute still creates orphan edges.')
  process.exit(1)
}
