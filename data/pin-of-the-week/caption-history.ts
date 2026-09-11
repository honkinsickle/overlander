/**
 * Pin of the Week — caption template history (DB).
 *
 * Backed by pin_of_week_caption_history. Records which template each generate
 * used (auto-selected only) so the generator can rotate templates (LRU) and
 * avoid immediate repeats. Tolerates the table not existing yet (migration not
 * applied) so generate still runs — it just can't rotate/persist.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Recent template numbers, most-recent first. Empty if the table is absent. */
export async function recentTemplateUses(db: SupabaseClient, limit = 8): Promise<number[]> {
  const r = await db
    .from("pin_of_week_caption_history")
    .select("template_number,used_at")
    .order("used_at", { ascending: false })
    .limit(limit);
  if (r.error) {
    if (r.error.code === "42P01") return []; // undefined_table: migration not applied yet
    throw new Error(`recentTemplateUses failed: ${JSON.stringify(r.error)}`);
  }
  return (r.data ?? []).map((row) => (row as { template_number: number }).template_number);
}

/** Log a template use. No-op (with a warning) if the table is absent. */
export async function logTemplateUse(
  db: SupabaseClient,
  templateNumber: number,
  masterPlaceId: string,
): Promise<boolean> {
  const r = await db
    .from("pin_of_week_caption_history")
    .insert({ template_number: templateNumber, master_place_id: masterPlaceId });
  if (r.error) {
    if (r.error.code === "42P01") {
      console.warn("pin_of_week_caption_history missing — template use not logged (apply the migration to enable rotation).");
      return false;
    }
    throw new Error(`logTemplateUse failed: ${JSON.stringify(r.error)}`);
  }
  return true;
}
