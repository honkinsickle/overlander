/**
 * The corridor gazetteer = the bundled GeoNames-derived base (`cities-na.json`,
 * ~8.8k rows, built by scripts/build-cities-na.ts) PLUS a curated northern
 * supplement (`cities-na-north.json`) sourced from GeoYukon / DataBC-BCGNIS /
 * CGNDB, which the GeoNames base under-covers (the whole of Yukon is 1 base row).
 *
 * WHY A SEPARATE FILE, NOT AN APPEND: a `build-cities-na` regen overwrites the
 * base file and would wipe appended rows. Keeping the supplement separate and
 * merging at load survives a regen, keeps provenance visible, and is reversible.
 *
 * Merge rule: base ∪ supplement, deduped by (normalized-name, admin) with the
 * BASE row winning a collision — the base carries a GeoNames-derived tier/pop we
 * don't want a hand-curated row to clobber. The supplement only ADDS places the
 * base is missing.
 *
 * These northern communities are small (pop < 10k) and surface via derive.ts's
 * adaptive gap-fill (the >maxGapMi branch, which is floor-relaxed), NOT the
 * pop-floor top-N pass. See docs/findings/2026-07-21-subfloor-gapfill-only.md
 * for the known limitation that follows from that.
 */
import type { GazetteerCity } from "@/lib/corridor/derive";
import base from "./cities-na.json";
import north from "./cities-na-north.json";

const norm = (s: string) => s.toLowerCase().replace(/,\s*[^,]+$/, "").trim();
const key = (c: { name: string; admin: string }) => `${norm(c.name)}|${c.admin}`;

const seen = new Set((base as GazetteerCity[]).map(key));
const merged: GazetteerCity[] = [...(base as GazetteerCity[])];
for (const c of north as GazetteerCity[]) {
  if (seen.has(key(c))) continue; // base wins a collision
  seen.add(key(c));
  merged.push(c);
}

export default merged;
