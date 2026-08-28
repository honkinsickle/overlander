/**
 * READ-ONLY sample of AO description text on TEST — characterizes which
 * markdown patterns actually appear in the corpus before we design a
 * converter. Prints:
 *   - count of descriptions matching each pattern (inline link, bold,
 *     italic, list marker, headers, code, blockquote)
 *   - a few real examples per pattern
 *   - the raw text of a random ~5 descriptions for eyeballing
 * TEST only. No writes.
 */

import { getDb } from "../ingestion/lib/db.ts";

if (process.env.SUPABASE_URL !== "https://znldzjdatkogdktymtvi.supabase.co") {
  console.error("Refusing to run — not TEST.");
  process.exit(1);
}
const db = getDb();

type Row = { external_id: string; normalized_payload: { description?: string | null } };

async function main() {
  const rows: Row[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const r = await db
      .from("source_record")
      .select("external_id, normalized_payload")
      .eq("source_id", "atlas_oddities")
      .not("normalized_payload->>description", "is", null)
      .range(from, from + PAGE - 1);
    if (r.error || !r.data) {
      console.error(r.error);
      process.exit(1);
    }
    for (const row of r.data) rows.push(row as unknown as Row);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Loaded ${rows.length} AO source_records with a description.`);

  const patterns: Record<string, RegExp> = {
    inline_link: /\[[^\]]+\]\([^)]+\)/,
    bold: /\*\*[^*\n]+\*\*/,
    italic_star: /(^|[^*])\*[^*\s][^*\n]*[^*\s]\*(?!\*)/,
    italic_underscore: /(^|[\s(])_[^_\n]+_(?=[\s.,!?)])/,
    heading: /(^|\n)#{1,6}\s/,
    unordered_list: /(^|\n)[-*+] /,
    ordered_list: /(^|\n)\d+\. /,
    blockquote: /(^|\n)> /,
    inline_code: /`[^`\n]+`/,
    fenced_code: /```/,
    horizontal_rule: /(^|\n)([-*_]){3,}(\n|$)/,
    image: /!\[[^\]]*\]\([^)]+\)/,
    autolink: /<https?:\/\/[^>]+>/,
    strikethrough: /~~[^~\n]+~~/,
    footnote_ref: /\[\^[^\]]+\]/,
    html_tag: /<\/?[a-zA-Z][^>]*>/,
    escaped: /\\[*_[\]()~`>#!]/,
    real_newline: /\n/,
    double_newline: /\n\s*\n/,
  };

  const counts: Record<string, number> = {};
  const examples: Record<string, { extId: string; snippet: string }[]> = {};
  for (const key of Object.keys(patterns)) {
    counts[key] = 0;
    examples[key] = [];
  }

  for (const row of rows) {
    const d = row.normalized_payload.description ?? "";
    for (const [key, re] of Object.entries(patterns)) {
      const m = d.match(re);
      if (m) {
        counts[key]++;
        if (examples[key].length < 3) {
          const start = Math.max(0, (m.index ?? 0) - 30);
          const end = Math.min(d.length, (m.index ?? 0) + m[0].length + 30);
          examples[key].push({
            extId: row.external_id,
            snippet: d.slice(start, end).replace(/\n/g, "\\n"),
          });
        }
      }
    }
  }

  console.log("\nPattern counts (of", rows.length, "descriptions):");
  for (const [key, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(20)} ${n.toString().padStart(6)}`);
  }

  console.log("\nExample snippets per pattern (up to 3 each):");
  for (const [key, list] of Object.entries(examples)) {
    if (list.length === 0) continue;
    console.log(`\n[${key}]`);
    for (const ex of list) {
      console.log(`  ${ex.extId}`);
      console.log(`    …${ex.snippet}…`);
    }
  }

  console.log("\nFive full descriptions (random) — for eyeballing:");
  const picks = new Set<number>();
  while (picks.size < 5 && picks.size < rows.length) {
    picks.add(Math.floor((picks.size * 173 + 7) % rows.length));
  }
  for (const idx of picks) {
    const row = rows[idx];
    console.log(`\n--- ${row.external_id} ---`);
    console.log(row.normalized_payload.description);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
