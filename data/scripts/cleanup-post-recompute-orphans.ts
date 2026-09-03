#!/usr/bin/env node
// One-shot cleanup: delete place_relationships rows where either endpoint
// is a soft-retired absorbed mp from merge_audit_log. These were inserted
// by recompute_master_place()'s containment scan during v1-v3 merge runs
// before v4 added the post-recompute cleanup step. See
// docs/investigations/2026-09-03-merge-executor-full-run.md.
//
// Read-only preview: default. Pass --confirm --target=test|prod to execute.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

const args = process.argv.slice(2)
const confirm = args.includes('--confirm')
const targetArg = args.find((a) => a.startsWith('--target='))
const target = targetArg ? targetArg.split('=')[1] : 'test'

if (!['test', 'prod'].includes(target)) {
  console.error('--target must be test or prod')
  process.exit(1)
}

const envPath = target === 'test'
  ? join(__dirname, '../.env')
  : join(__dirname, '../../web/.env.local')
const env = readEnv(envPath)
const url = env.SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error(`missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${envPath}`)
  process.exit(1)
}

const expectedHost = target === 'test'
  ? 'https://znldzjdatkogdktymtvi.supabase.co'
  : 'https://nqzeywzcowujzyegxbsr.supabase.co'
if (url !== expectedHost) {
  console.error(`ENV MISMATCH: ${envPath} URL=${url} does not match expected ${expectedHost}`)
  process.exit(1)
}

console.log(`target: ${target} (${url})`)
console.log(`mode:   ${confirm ? 'EXECUTE (delete)' : 'preview (read-only)'}`)
console.log()

const supa = createClient(url, key, { auth: { persistSession: false } })

// Collect all absorbed mp ids from every audit row.
const { data: auditRows, error: auditErr } = await supa
  .from('merge_audit_log')
  .select('id, absorbed_mp_ids')
if (auditErr || !auditRows) {
  console.error('FAILED to read merge_audit_log:', auditErr)
  process.exit(1)
}
console.log(`audit rows: ${auditRows.length}`)

const absorbedSet = new Set<string>()
for (const r of auditRows) {
  for (const id of (r.absorbed_mp_ids ?? [])) absorbedSet.add(id)
}
const absorbedIds = [...absorbedSet]
console.log(`unique absorbed mp ids across all audits: ${absorbedIds.length}`)

// Find place_relationships rows whose child OR parent is an absorbed mp.
// PostgREST 'in' filter caps around ~2000 items, so chunk if needed.
const CHUNK = 100
const orphanEdges: Array<{ child_master_place_id: string; parent_master_place_id: string; relationship_type: string; computed_at: string | null }> = []

async function fetchChunk(ids: string[], column: 'child_master_place_id' | 'parent_master_place_id') {
  const inList = `(${ids.join(',')})`
  const { data, error } = await supa
    .from('place_relationships')
    .select('child_master_place_id,parent_master_place_id,relationship_type,computed_at')
    .filter(column, 'in', inList)
  if (error) {
    console.error(`fetch failed on ${column}:`, error)
    process.exit(1)
  }
  return data ?? []
}

for (let i = 0; i < absorbedIds.length; i += CHUNK) {
  const chunk = absorbedIds.slice(i, i + CHUNK)
  const child = await fetchChunk(chunk, 'child_master_place_id')
  const parent = await fetchChunk(chunk, 'parent_master_place_id')
  orphanEdges.push(...child, ...parent)
}

// Dedup edges (same row can hit both child+parent lookups if both sides
// happen to be absorbed).
const seen = new Set<string>()
const uniq = orphanEdges.filter((e) => {
  const k = `${e.child_master_place_id}|${e.parent_master_place_id}|${e.relationship_type}`
  if (seen.has(k)) return false
  seen.add(k)
  return true
})

console.log(`orphan place_relationships rows involving absorbed mps: ${uniq.length}`)
if (uniq.length > 0) {
  console.log('sample (first 10):')
  for (const e of uniq.slice(0, 10)) {
    console.log(`  child=${e.child_master_place_id.slice(0, 8)} parent=${e.parent_master_place_id.slice(0, 8)} type=${e.relationship_type} computed_at=${e.computed_at}`)
  }
}

if (!confirm) {
  console.log()
  console.log('Preview only. Re-run with --confirm to delete.')
  process.exit(0)
}

if (uniq.length === 0) {
  console.log('Nothing to delete.')
  process.exit(0)
}

console.log()
console.log(`Deleting ${uniq.length} orphan edges ...`)
let deleted = 0
for (const e of uniq) {
  const { error } = await supa
    .from('place_relationships')
    .delete()
    .eq('child_master_place_id', e.child_master_place_id)
    .eq('parent_master_place_id', e.parent_master_place_id)
    .eq('relationship_type', e.relationship_type)
  if (error) {
    console.error(`DELETE FAILED for ${e.child_master_place_id}/${e.parent_master_place_id}/${e.relationship_type}:`, error)
    process.exit(1)
  }
  deleted += 1
}
console.log(`Deleted ${deleted} rows.`)

// Re-verify.
const recheck: typeof orphanEdges = []
for (let i = 0; i < absorbedIds.length; i += CHUNK) {
  const chunk = absorbedIds.slice(i, i + CHUNK)
  recheck.push(...await fetchChunk(chunk, 'child_master_place_id'))
  recheck.push(...await fetchChunk(chunk, 'parent_master_place_id'))
}
console.log(`post-delete orphan count: ${recheck.length} (expected 0)`)
if (recheck.length !== 0) process.exit(1)
