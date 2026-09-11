/**
 * Pin of the Week — manual photo override (read/write helpers).
 *
 * Backed by the master_place_photo_override table (one row per place). An
 * override supplies either a URL or inline base64 bytes plus required
 * provenance (source + license). The generator reads it in place of the
 * corpus-resolved photo; nothing else in the corpus reads this table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PhotoOverride {
  master_place_id: string;
  image_url: string | null;
  image_data: string | null; // base64
  mime_type: string | null;
  source: string;
  license: string;
  attribution: string | null;
  updated_at: string;
}

const OVERRIDE_COLUMNS =
  "master_place_id,image_url,image_data,mime_type,source,license,attribution,updated_at";

/** Fetch the override for a place, or null if none. Tolerates the table not existing yet. */
export async function fetchPhotoOverride(
  db: SupabaseClient,
  masterPlaceId: string,
): Promise<PhotoOverride | null> {
  const r = await db
    .from("master_place_photo_override")
    .select(OVERRIDE_COLUMNS)
    .eq("master_place_id", masterPlaceId)
    .limit(1);
  if (r.error) {
    // 42P01 = undefined_table: migration not applied yet → behave as "no override".
    if (r.error.code === "42P01") return null;
    throw new Error(`fetch photo override failed: ${JSON.stringify(r.error)}`);
  }
  return ((r.data?.[0] as PhotoOverride | undefined) ?? null);
}

export interface SetPhotoOverrideInput {
  masterPlaceId: string;
  imageUrl?: string | null;
  imageData?: string | null; // base64
  mimeType?: string | null;
  source: string;
  license: string;
  attribution?: string | null;
}

/** Upsert an override (one row per place). Bumps updated_at. */
export async function setPhotoOverride(db: SupabaseClient, input: SetPhotoOverrideInput): Promise<void> {
  const hasUrl = input.imageUrl != null && input.imageUrl !== "";
  const hasData = input.imageData != null && input.imageData !== "";
  if (hasUrl === hasData) throw new Error("provide exactly one of imageUrl / imageData");
  if (!input.source || !input.license) throw new Error("source and license are required");

  const row = {
    master_place_id: input.masterPlaceId,
    image_url: hasUrl ? input.imageUrl : null,
    image_data: hasData ? input.imageData : null,
    mime_type: hasData ? (input.mimeType ?? null) : null,
    source: input.source,
    license: input.license,
    attribution: input.attribution ?? null,
    updated_at: new Date().toISOString(),
  };
  const r = await db.from("master_place_photo_override").upsert(row, { onConflict: "master_place_id" });
  if (r.error) throw new Error(`set photo override failed: ${JSON.stringify(r.error)}`);
}

/** Delete the override for a place. Returns true if a row was removed. */
export async function clearPhotoOverride(db: SupabaseClient, masterPlaceId: string): Promise<boolean> {
  const r = await db
    .from("master_place_photo_override")
    .delete()
    .eq("master_place_id", masterPlaceId)
    .select("master_place_id");
  if (r.error) throw new Error(`clear photo override failed: ${JSON.stringify(r.error)}`);
  return (r.data?.length ?? 0) > 0;
}
