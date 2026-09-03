#!/usr/bin/env node
// Hand-check field_precedence outcomes on 5+ merged records.
//
// For each specified canonical mp:
//   1. Read all source_records currently pointing at it.
//   2. Read current master_place row + attribution.
//   3. For every attribution field, cross-check: the source cited in
//      attribution should be the highest-priority (lowest priority number)
//      source in field_precedence among the SRs that carry a non-null
//      value for the source-record equivalent of that field.
//
// Reports MATCH / MISMATCH / UNCHECKABLE (no field_precedence row) per
// (canonical_mp, field). Prints a summary and exits non-zero if any
// MISMATCH is genuine (source-cited wasn't the top eligible one).

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

const CANONICALS = process.argv.slice(2)
if (CANONICALS.length === 0) {
  console.error('usage: verify-field-precedence.ts <canonical_mp_id> [<canonical_mp_id> ...]')
  process.exit(1)
}

// The rich fields live inside source_record.normalized_payload (jsonb),
// not as top-level columns. Only `name` and `geometry`/`geometry_polygon`
// are top-level columns on source_record. For every other attribution
// key, we look for a non-null value inside normalized_payload.
//
// Mapping: attribution field name -> (either 'top:<column>' for a real
// SR column, or 'payload:<jsonb_key>' for normalized_payload).
// null = unmapped / can't check.
const FIELD_TO_SR_PATH: Record<string, string | null> = {
  canonical_name: 'top:name',
  geometry: 'top:geometry',
  geometry_polygon: 'top:geometry_polygon',
  description: 'payload:description',
  contact: 'payload:contact',
  operational_status: 'payload:operational_status',
  website: 'payload:website',
  phone: 'payload:phone',
  hours: 'payload:hours',
  price_level: 'payload:price_level',
  rating: 'payload:rating',
  rating_count: 'payload:rating_count',
  address: 'payload:address',
  categories: 'payload:categories',
  amenities: 'payload:amenities',
  photos: 'payload:photos',
  types: 'payload:types',
}

const { data: fpRows } = await supa.from('field_precedence').select('field_name, source_id, priority')
const fpBy = new Map<string, Map<string, number>>()
for (const r of fpRows ?? []) {
  if (!fpBy.has(r.field_name)) fpBy.set(r.field_name, new Map())
  fpBy.get(r.field_name)!.set(r.source_id, r.priority)
}

let overallMismatch = 0
for (const canonicalId of CANONICALS) {
  console.log(`\n===== canonical ${canonicalId} =====`)
  const { data: mpRows } = await supa
    .from('master_place')
    .select('id, canonical_name, attribution, source_count, is_searchable')
    .eq('id', canonicalId)
  if (!mpRows || mpRows.length === 0) {
    console.log('  NOT FOUND'); continue
  }
  const mp = mpRows[0]
  console.log(`  name=${JSON.stringify(mp.canonical_name)}  source_count=${mp.source_count}  is_searchable=${mp.is_searchable}`)
  const attribution = mp.attribution ?? {}
  console.log(`  attribution fields: ${Object.keys(attribution).length}`)

  const srResp = await supa
    .from('source_record')
    .select('id, source_id, name, is_active, normalized_payload')
    .eq('master_place_id', canonicalId)
  if (srResp.error) {
    console.error('SR QUERY FAILED:', srResp.error); continue
  }
  const srs = srResp.data
  console.log(`  source_records currently attached: ${(srs ?? []).length}`)
  const srsBySource = new Map<string, any[]>()
  for (const sr of srs ?? []) {
    if (!srsBySource.has(sr.source_id)) srsBySource.set(sr.source_id, [])
    srsBySource.get(sr.source_id)!.push(sr)
  }
  console.log(`  source_ids present: ${[...srsBySource.keys()].join(', ')}`)

  let localMismatch = 0
  for (const [fieldName, attrValue] of Object.entries(attribution)) {
    // attribution stores {field: <source_id string>}
    const citedSource = typeof attrValue === 'string' ? attrValue : (attrValue as any)?.source
    if (!citedSource) continue
    const fp = fpBy.get(fieldName)
    if (!fp) {
      console.log(`    ${fieldName}: cited=${citedSource}  → UNCHECKABLE (no field_precedence)`)
      continue
    }
    const srPath = FIELD_TO_SR_PATH[fieldName]
    if (srPath === null || srPath === undefined) {
      console.log(`    ${fieldName}: cited=${citedSource}  → UNCHECKABLE (no SR mapping known)`)
      continue
    }
    const [pathType, pathKey] = srPath.split(':') as ['top' | 'payload', string]
    if (pathType === 'top' && (pathKey === 'geometry' || pathKey === 'geometry_polygon')) {
      console.log(`    ${fieldName}: cited=${citedSource}  → UNCHECKABLE (geometry not selected)`)
      continue
    }
    const hasValue = (sr: any): boolean => {
      let v: any
      if (pathType === 'top') v = sr[pathKey]
      else v = sr.normalized_payload?.[pathKey]
      if (v == null) return false
      if (Array.isArray(v)) return v.length > 0
      if (typeof v === 'object') return Object.keys(v).length > 0
      if (typeof v === 'string') return v.trim().length > 0
      return true
    }
    const eligible: string[] = []
    for (const [src, list] of srsBySource) {
      if (list.some(hasValue)) eligible.push(src)
    }
    if (eligible.length === 0) {
      console.log(`    ${fieldName}: cited=${citedSource}  → UNCHECKABLE (no eligible SR carries value)`)
      continue
    }
    // Sort eligible by field_precedence priority.
    const eligibleWithPri = eligible
      .map((s) => ({ s, p: fp.get(s) ?? Infinity }))
      .sort((a, b) => a.p - b.p)
    const topEligible = eligibleWithPri[0]
    const cited_pri = fp.get(citedSource) ?? null
    const match = citedSource === topEligible.s
    const verdict = match ? 'MATCH' : `MISMATCH (top eligible=${topEligible.s}@${topEligible.p}, cited=${citedSource}@${cited_pri})`
    console.log(`    ${fieldName}: eligible=[${eligibleWithPri.map((e) => `${e.s}@${e.p}`).join(',')}]  cited=${citedSource}  → ${verdict}`)
    if (!match) localMismatch += 1
  }
  console.log(`  local mismatches: ${localMismatch}`)
  overallMismatch += localMismatch
}

console.log(`\nOverall mismatches: ${overallMismatch}`)
process.exit(overallMismatch > 0 ? 1 : 0)
