#!/usr/bin/env node
// Reverse a merge by reading its merge_audit_log row and undoing the
// changes. Verifies that the affected mps + source_records are still in
// their "after" state before touching anything (so reversing twice is a
// no-op / hard error rather than a silent double-undo).
//
// Strategy:
//   1. Fetch audit row (before_snapshot, after_snapshot, absorbed_mp_ids,
//      canonical_mp_id).
//   2. Preflight: assert every mp currently matches its after_snapshot
//      for (is_searchable, source_count). If not, abort — someone or
//      something has modified the row since the merge.
//   3. For each source_record that was in before_snapshot with
//      master_place_id ≠ canonical (i.e. was absorbed), UPDATE
//      source_record.master_place_id back to its before-snapshot value.
//   4. UPDATE master_place SET is_searchable, source_count back to
//      before-snapshot values for canonical AND each absorbed mp.
//   5. Insert a marker row into merge_audit_log with a `notes` field
//      referencing the reversed audit_id and moves = {reversed_from:
//      <id>}. (We keep it in the same log for auditability.)
//
// Scope: reverses source_record repointing, mp soft-retire, AND
// place_match repointing (mirrors source_record since place_match is
// (source_record_id, master_place_id) pairs). Does NOT undo
// place_relationships / generated_content / photo_candidate repointing
// — those tables' before-state isn't in the audit snapshot. Sufficient
// for the reversal exercise: prevents the next matcher run from
// re-merging via a place_match still pointing at canonical (which would
// silently undo the reversal). place_relationships etc. remain drifted;
// a full production reversal would need snapshots of those tables too.
// Log this scope explicitly.

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
const auditArg = args.find((a) => a.startsWith('--audit-id='))
const confirm = args.includes('--confirm')
const targetArg = args.find((a) => a.startsWith('--target='))
const target = targetArg ? targetArg.split('=')[1] : 'test'

if (!auditArg) {
  console.error('usage: reverse-merge.ts --audit-id=<uuid> [--target=test|prod] [--confirm]')
  process.exit(1)
}
const auditId = auditArg.split('=')[1]

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
  console.error(`missing SUPABASE creds in ${envPath}`)
  process.exit(1)
}
const expected = target === 'test'
  ? 'https://znldzjdatkogdktymtvi.supabase.co'
  : 'https://nqzeywzcowujzyegxbsr.supabase.co'
if (url !== expected) {
  console.error(`ENV MISMATCH ${envPath}: ${url} ≠ ${expected}`)
  process.exit(1)
}

const supa = createClient(url, key, { auth: { persistSession: false } })

console.log(`target: ${target}`)
console.log(`audit_id: ${auditId}`)
console.log(`mode: ${confirm ? 'EXECUTE (reverse)' : 'preview (read-only)'}`)
console.log()

const { data: audit, error: audErr } = await supa
  .from('merge_audit_log')
  .select('*')
  .eq('id', auditId)
  .maybeSingle()
if (audErr || !audit) {
  console.error('audit row not found:', audErr)
  process.exit(1)
}

const canonicalId: string = audit.canonical_mp_id
const absorbedIds: string[] = audit.absorbed_mp_ids
const before = audit.before_snapshot as Record<string, any>
const after = audit.after_snapshot as Record<string, any>

console.log(`canonical: ${canonicalId}`)
console.log(`absorbed: ${absorbedIds.join(', ')}`)
console.log(`moves at merge time:`, audit.moves)
console.log()

// Preflight: read current state of all involved mps, assert it matches after.
const allMpIds = [canonicalId, ...absorbedIds]
const { data: currentMps, error: mpErr } = await supa
  .from('master_place')
  .select('id, is_searchable, source_count, canonical_name')
  .in('id', allMpIds)
if (mpErr || !currentMps) {
  console.error('read current mps failed:', mpErr)
  process.exit(1)
}

let driftDetected = false
for (const mp of currentMps) {
  const expectedAfter = after[mp.id]
  if (!expectedAfter) {
    console.error(`drift: mp ${mp.id} not in after_snapshot`)
    driftDetected = true
    continue
  }
  const drift: string[] = []
  if (mp.is_searchable !== expectedAfter.is_searchable) drift.push(`is_searchable ${expectedAfter.is_searchable}→${mp.is_searchable}`)
  if (mp.source_count !== expectedAfter.source_count) drift.push(`source_count ${expectedAfter.source_count}→${mp.source_count}`)
  const status = drift.length === 0 ? 'MATCHES after' : `DRIFT: ${drift.join(', ')}`
  console.log(`  ${mp.id.slice(0, 8)} (${mp.canonical_name?.slice(0, 40)}): ${status}`)
  if (drift.length > 0) driftDetected = true
}
if (driftDetected) {
  console.error('\nSTATE HAS DRIFTED since merge. Refusing to reverse.')
  process.exit(1)
}
console.log('  all mp states match after_snapshot ✓')
console.log()

// Preflight source_records
const srIds: string[] = (before.source_records ?? []).map((sr: any) => sr.id)
const { data: currentSrs, error: srErr } = await supa
  .from('source_record')
  .select('id, master_place_id, source_id')
  .in('id', srIds)
if (srErr || !currentSrs) {
  console.error('read source_records failed:', srErr)
  process.exit(1)
}
const srBeforeById = new Map<string, any>((before.source_records ?? []).map((sr: any) => [sr.id, sr]))

const willRepoint: Array<{ id: string; from: string; to: string }> = []
for (const sr of currentSrs) {
  const bef = srBeforeById.get(sr.id)
  if (!bef) continue
  if (bef.master_place_id !== sr.master_place_id) {
    // Only reverse if the SR moved from `bef` to canonical during the merge.
    // If it's currently at some other mp, that's drift.
    if (sr.master_place_id !== canonicalId) {
      console.error(`drift: source_record ${sr.id} currently at ${sr.master_place_id}, expected canonical ${canonicalId}`)
      process.exit(1)
    }
    willRepoint.push({ id: sr.id, from: sr.master_place_id, to: bef.master_place_id })
  }
}

console.log(`source_records to repoint back: ${willRepoint.length}`)
for (const w of willRepoint.slice(0, 10)) {
  console.log(`  ${w.id.slice(0, 8)}: ${w.from.slice(0, 8)} → ${w.to.slice(0, 8)}`)
}
console.log()

if (!confirm) {
  console.log('Preview only. Re-run with --confirm to execute.')
  process.exit(0)
}

console.log('Executing reversal ...')

// Repoint source_records
for (const w of willRepoint) {
  const { error } = await supa
    .from('source_record')
    .update({ master_place_id: w.to, updated_at: new Date().toISOString() })
    .eq('id', w.id)
  if (error) {
    console.error(`FAILED to repoint ${w.id}:`, error)
    process.exit(1)
  }
}
console.log(`  repointed ${willRepoint.length} source_records`)

// Repoint place_match rows: each SR that we reverted now has a stale
// place_match(source_record_id, master_place_id=canonical). Move those
// rows back to point at the pre-merge master_place_id. If a place_match
// already exists at the destination (source_record_id, before mp), skip.
let pmReverted = 0
let pmSkipped = 0
for (const w of willRepoint) {
  // Look for place_match rows for this SR at canonical.
  const { data: existingAtCanonical, error: peErr } = await supa
    .from('place_match')
    .select('id')
    .eq('source_record_id', w.id)
    .eq('master_place_id', canonicalId)
  if (peErr) { console.error('read place_match failed:', peErr); process.exit(1) }
  if (!existingAtCanonical || existingAtCanonical.length === 0) continue
  // Check if a row already exists at destination.
  const { data: existingAtDest, error: pdErr } = await supa
    .from('place_match')
    .select('id')
    .eq('source_record_id', w.id)
    .eq('master_place_id', w.to)
  if (pdErr) { console.error('read place_match dest failed:', pdErr); process.exit(1) }
  if (existingAtDest && existingAtDest.length > 0) {
    // Destination already has a row; delete the canonical-side one.
    for (const row of existingAtCanonical) {
      const { error } = await supa.from('place_match').delete().eq('id', row.id)
      if (error) { console.error('delete place_match failed:', error); process.exit(1) }
    }
    pmSkipped += existingAtCanonical.length
  } else {
    // Repoint canonical-side rows to destination.
    for (const row of existingAtCanonical) {
      const { error } = await supa
        .from('place_match')
        .update({ master_place_id: w.to })
        .eq('id', row.id)
      if (error) { console.error('update place_match failed:', error); process.exit(1) }
      pmReverted += 1
    }
  }
}
console.log(`  place_match: repointed ${pmReverted}, deleted-duplicates ${pmSkipped}`)

// Restore mp is_searchable + source_count
for (const mp of currentMps) {
  const bef = before[mp.id]
  if (!bef) continue
  const { error } = await supa
    .from('master_place')
    .update({
      is_searchable: bef.is_searchable,
      source_count: bef.source_count,
      updated_at: new Date().toISOString(),
    })
    .eq('id', mp.id)
  if (error) {
    console.error(`FAILED to restore mp ${mp.id}:`, error)
    process.exit(1)
  }
}
console.log(`  restored ${currentMps.length} master_place rows to before-snapshot state`)

// Insert reversal marker in merge_audit_log
const { error: insErr } = await supa
  .from('merge_audit_log')
  .insert({
    executed_by: 'reverse-merge.ts',
    canonical_mp_id: canonicalId,
    absorbed_mp_ids: absorbedIds,
    target_env: target,
    group_id: audit.group_id,
    before_snapshot: after,
    after_snapshot: before,
    moves: { reversed_from: auditId, source_records_repointed: willRepoint.length },
    notes: `REVERSAL of audit ${auditId}. Scope: source_record + master_place only.`,
  })
if (insErr) {
  console.error('WARN: reversal marker insert failed:', insErr)
} else {
  console.log('  reversal marker inserted in merge_audit_log')
}

console.log('\nDone.')
