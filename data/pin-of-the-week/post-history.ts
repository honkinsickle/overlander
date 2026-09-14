/**
 * Pin of the Day — post history (read/write helpers).
 *
 * Backed by pin_of_the_day_post. One row per APPROVED post, recorded by the
 * skill only after the operator approves a generated post (never at generate
 * time). Metadata only — the composited image lives on disk in the committed
 * archive at data/pin-of-the-week/posts/<date>-<slug>/ (archive_dir points at
 * it). Nothing in the corpus reads this table.
 *
 * The public "Pin of the Day" name is skill/doc-only; the code and other tables
 * stay "pin of week" by design (see docs/decisions/2026-09-11-pin-of-the-day-skill.md).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PhotoSource = "corpus" | "override:url" | "override:file";
const PHOTO_SOURCES: readonly PhotoSource[] = ["corpus", "override:url", "override:file"];

/** Everything needed to record a post (before its DB id / created_at exist). */
export interface PostInput {
  masterPlaceId: string | null;
  canonicalName: string;
  captionText: string;
  templateNumber: number;
  photoSource: PhotoSource;
  photoRef: string | null;
  archiveDir: string;
  status?: string; // default 'created'
}

/** A stored post row (snake_case, as returned by PostgREST). */
export interface StoredPost {
  id: number;
  master_place_id: string | null;
  canonical_name: string;
  caption_text: string;
  template_number: number;
  photo_source: string;
  photo_ref: string | null;
  archive_dir: string;
  status: string;
  created_at: string;
}

const COLUMNS =
  "id,master_place_id,canonical_name,caption_text,template_number,photo_source,photo_ref,archive_dir,status,created_at";

/** The subset of a generator place.json this module reads. */
export interface PlaceArtifact {
  id: string | null;
  canonical_name: string;
  photo_source: PhotoSource;
  photo_url: string | null;
}

/** The subset of a generator caption.json this module reads. */
export interface CaptionArtifact {
  templateNumber: number;
  text: string;
}

/** Validate a post input. Throws before any DB call (guard-first). */
export function validatePostInput(input: PostInput): void {
  if (!input.canonicalName) throw new Error("canonicalName is required");
  if (!input.captionText) throw new Error("captionText is required");
  if (!Number.isInteger(input.templateNumber) || input.templateNumber < 1 || input.templateNumber > 12) {
    throw new Error("templateNumber must be an integer 1-12");
  }
  if (!PHOTO_SOURCES.includes(input.photoSource)) {
    throw new Error(`photoSource must be one of ${PHOTO_SOURCES.join(", ")}`);
  }
  if (!input.archiveDir) throw new Error("archiveDir is required");
}

/** Map generator artifacts (place.json + caption.json) to post fields. */
export function postFieldsFromArtifacts(
  place: PlaceArtifact,
  caption: CaptionArtifact,
): Omit<PostInput, "archiveDir" | "status"> {
  return {
    masterPlaceId: place.id,
    canonicalName: place.canonical_name,
    captionText: caption.text,
    templateNumber: caption.templateNumber,
    photoSource: place.photo_source,
    // The real source URL for corpus / override:url; the manual-override:// marker
    // for a file override (no original filename is persisted anywhere).
    photoRef: place.photo_url ?? null,
  };
}

/** Compose the archive folder name: <date>-<slug>. */
export function archiveDirName(date: string, slug: string): string {
  return `${date}-${slug}`;
}

/** The self-contained on-disk manifest for a recorded post (mirrors the DB row). */
export function buildManifest(input: PostInput, createdAt: string, id: number): Record<string, unknown> {
  return {
    id,
    master_place_id: input.masterPlaceId,
    canonical_name: input.canonicalName,
    caption_text: input.captionText,
    template_number: input.templateNumber,
    photo_source: input.photoSource,
    photo_ref: input.photoRef,
    archive_dir: input.archiveDir,
    status: input.status ?? "created",
    created_at: createdAt,
  };
}

/** Insert a post row; returns the new id and its created_at. Guards first. */
export async function recordPost(
  db: SupabaseClient,
  input: PostInput,
): Promise<{ id: number; created_at: string }> {
  validatePostInput(input);
  const row = {
    master_place_id: input.masterPlaceId,
    canonical_name: input.canonicalName,
    caption_text: input.captionText,
    template_number: input.templateNumber,
    photo_source: input.photoSource,
    photo_ref: input.photoRef,
    archive_dir: input.archiveDir,
    status: input.status ?? "created",
  };
  const r = await db.from("pin_of_the_day_post").insert(row).select("id,created_at").limit(1);
  if (r.error || !r.data?.[0]) throw new Error(`recordPost failed: ${JSON.stringify(r.error ?? r)}`);
  const inserted = r.data[0] as { id: number; created_at: string };
  return { id: inserted.id, created_at: inserted.created_at };
}

/** List posts, newest first. Empty if the table is absent (migration not applied). */
export async function listPosts(db: SupabaseClient, limit = 50): Promise<StoredPost[]> {
  const r = await db
    .from("pin_of_the_day_post")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (r.error) {
    if (r.error.code === "42P01") return []; // undefined_table: migration not applied yet
    throw new Error(`listPosts failed: ${JSON.stringify(r.error)}`);
  }
  return (r.data ?? []) as StoredPost[];
}

/** Fetch one post by id, or null. Tolerates the table not existing yet. */
export async function getPost(db: SupabaseClient, id: number): Promise<StoredPost | null> {
  const r = await db.from("pin_of_the_day_post").select(COLUMNS).eq("id", id).limit(1);
  if (r.error) {
    if (r.error.code === "42P01") return null;
    throw new Error(`getPost failed: ${JSON.stringify(r.error)}`);
  }
  return ((r.data?.[0] as StoredPost | undefined) ?? null);
}
