#!/usr/bin/env node
// One-shot: for two audits that were reversed with the old script
// (before place_match sync was added), unwind place_match to match
// the current source_record.master_place_id state.
//
// For each SR in the audit's before_snapshot whose current
// master_place_id differs from the canonical, ensure place_match reflects
// current SR state — repoint canonical-side place_match rows to the
// SR's current master_place_id, or delete them if a duplicate already
// exists at destination.

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
const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const REVERSED_AUDIT_IDS = [
  'ecd51935-0995-443e-a3dc-57ce3f2e15ba', // 2-way Alamo Lake
  '6301d7de-3744-4775-9f55-9857539f0bfc', // 4-way Fort Churchill
]
const confirm = process.argv.includes('--confirm')

for (const auditId of REVERSED_AUDIT_IDS) {
  console.log(`\n===== audit ${auditId} =====`)
  const { data: audit } = await supa.from('merge_audit_log').select('*').eq('id', auditId).maybeSingle()
  if (!audit) { console.log('NOT FOUND'); continue }
  const canonicalId = audit.canonical_mp_id
  const beforeSrs = audit.before_snapshot?.source_records ?? []
  console.log(`canonical: ${canonicalId}`)
  console.log(`before SRs: ${beforeSrs.length}`)

  // Read current SR state
  const srIds = beforeSrs.map((sr: any) => sr.id)
  const { data: currentSrs } = await supa.from('source_record').select('id, master_place_id').in('id', srIds)
  const currentById = new Map(currentSrs?.map((sr: any) => [sr.id, sr]) ?? [])

  for (const beforeSr of beforeSrs) {
    const now = currentById.get(beforeSr.id)
    if (!now) { console.log(`  SR ${beforeSr.id.slice(0, 8)} MISSING now`); continue }
    if (now.master_place_id === canonicalId) {
      console.log(`  SR ${beforeSr.id.slice(0, 8)} still at canonical — reversal never repointed it (or was for a non-repointed row)`)
      continue
    }
    // SR is currently at pre-merge mp. Check place_match rows for this SR at canonical.
    const { data: pmAtCanonical } = await supa
      .from('place_match')
      .select('id')
      .eq('source_record_id', beforeSr.id)
      .eq('master_place_id', canonicalId)
    if (!pmAtCanonical || pmAtCanonical.length === 0) {
      console.log(`  SR ${beforeSr.id.slice(0, 8)} → ${now.master_place_id.slice(0, 8)}: no place_match at canonical to clean up`)
      continue
    }
    // Check destination.
    const { data: pmAtDest } = await supa
      .from('place_match')
      .select('id')
      .eq('source_record_id', beforeSr.id)
      .eq('master_place_id', now.master_place_id)
    if (pmAtDest && pmAtDest.length > 0) {
      console.log(`  SR ${beforeSr.id.slice(0, 8)}: destination place_match already exists; would DELETE ${pmAtCanonical.length} canonical-side row(s)`)
      if (confirm) {
        for (const row of pmAtCanonical) {
          const { error } = await supa.from('place_match').delete().eq('id', row.id)
          if (error) { console.error(error); process.exit(1) }
        }
        console.log(`    deleted ${pmAtCanonical.length}`)
      }
    } else {
      console.log(`  SR ${beforeSr.id.slice(0, 8)}: would REPOINT ${pmAtCanonical.length} place_match row(s) canonical → ${now.master_place_id.slice(0, 8)}`)
      if (confirm) {
        for (const row of pmAtCanonical) {
          const { error } = await supa.from('place_match').update({ master_place_id: now.master_place_id }).eq('id', row.id)
          if (error) { console.error(error); process.exit(1) }
        }
        console.log(`    repointed ${pmAtCanonical.length}`)
      }
    }
  }
}

if (!confirm) console.log('\nPreview only. Re-run with --confirm.')
