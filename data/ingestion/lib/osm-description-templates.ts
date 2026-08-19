/**
 * Templated descriptions for OSM categories whose rows carry structured tags
 * but no prose. Same spirit as `amenitiesToLabels` in
 * `web/src/lib/trip-browse/card-stats.ts`: every clause is backed by a real tag,
 * an absent tag produces nothing, and we never emit a category-canned
 * placeholder. Unlike that translator these produce a sentence, not chips.
 *
 * Covers toilet / water / dump_station. Populations and tag rates were measured
 * fresh against TEST before this was written
 * (`data/scripts/measure-template-categories.ts`).
 *
 * ── THRESHOLD ────────────────────────────────────────────────────────────
 * A template fires only when the row carries **at least one CONSUMABLE tag** —
 * a tag this module can turn into a user-facing fact. Rationale:
 *
 *  - The category label ("Toilet", "Water", "Dump Station") is already shown
 *    next to the place. A description that only restates it adds no
 *    information while implying the record is richer than it is. So a bare row
 *    returns `null` and simply has no description.
 *  - Provenance/bookkeeping tags (`check_date`, `source`, `fixme`, `level`,
 *    `layer`, `ref:*`, `addr:*` …) are deliberately NOT consumable: a row
 *    carrying only those is functionally bare.
 *  - One consumable tag is enough, because a single fact is already
 *    decision-relevant ("Free.", "Permit required.", "Non-potable."). Requiring
 *    two would discard genuinely useful single-fact rows.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────────
 * `drinking_water=no` always wins the water lead clause, even against
 * `amenity=drinking_water`. Telling someone a non-potable well is "drinking
 * water" is the one error here with real-world consequences.
 */

export type OsmTags = Record<string, string>;

/** Categories this module can template. */
export const TEMPLATED_CATEGORIES = ["toilet", "water", "dump_station"] as const;
export type TemplatedCategory = (typeof TEMPLATED_CATEGORIES)[number];

export function isTemplatedCategory(c: string | null | undefined): c is TemplatedCategory {
  return c === "toilet" || c === "water" || c === "dump_station";
}

/**
 * Tags each category's template can actually consume. The category-defining tag
 * is excluded (it carries no information beyond the category itself), as is
 * `sanitary_dump_station=yes`, which merely restates `amenity`.
 */
const CONSUMABLE: Record<TemplatedCategory, readonly string[]> = {
  toilet: [
    "toilets:disposal", "access", "fee", "wheelchair", "changing_table",
    "toilets:handwashing", "portable", "drinking_water", "unisex", "male",
    "female", "operator", "opening_hours", "supervised",
  ],
  water: [
    "drinking_water", "fee", "charge", "access", "bottle", "fountain", "pump",
    "wheelchair", "operator", "indoor", "covered", "seasonal", "man_made",
  ],
  dump_station: [
    "fee", "charge", "access", "water_point", "sanitary_dump_station:round_drain",
    "sanitary_dump_station:pump-out", "operator", "payment:cash",
    "payment:debit_cards", "payment:credit_cards",
  ],
};

/** True when the row carries at least one tag the template can use. */
export function hasConsumableTag(category: TemplatedCategory, tags: OsmTags): boolean {
  return CONSUMABLE[category].some((k) => {
    const v = tags[k];
    if (v === undefined) return false;
    // `man_made` only counts for water when it is the well/tap variant, since
    // that is the only case the lead clause reads it for. It is otherwise the
    // defining tag and carries nothing extra.
    if (k === "man_made") return false;
    return v.trim().length > 0;
  });
}

/**
 * A built clause list plus whether its LEAD is generic. A generic lead merely
 * names the category ("Toilets", "Water", "RV dump station"); a specialized one
 * carries a fact of its own ("Flush toilets", "Non-potable water"). The
 * distinction decides whether a single-clause result is worth emitting.
 */
type Built = { clauses: string[]; leadIsGeneric: boolean };

/** Render a `charge` value: "$20 fee" when purely numeric, else passthrough. */
function chargeClause(charge: string): string {
  const c = charge.trim();
  return /^\d+(\.\d+)?$/.test(c) ? `$${c} fee` : `fee (${c})`;
}

/** Fee/charge clause shared by all three categories. */
function feeClauses(tags: OsmTags): string[] {
  const out: string[] = [];
  const fee = tags.fee;
  const charge = tags.charge;
  if (charge && charge.trim()) out.push(chargeClause(charge));
  else if (fee === "no") out.push("free");
  else if (fee === "yes") out.push("fee required");
  return out;
}

/** Access clause shared by all three categories. */
function accessClause(access: string | undefined): string | undefined {
  switch (access) {
    case "yes": return "public access";
    case "permissive": return "public access (permissive)";
    case "customers": return "customers only";
    case "permit": return "permit required";
    case "private": return "private";
    case "passengers": return "passengers only";
    case "no": return "no public access";
    default: return undefined;
  }
}

function wheelchairClause(v: string | undefined): string | undefined {
  switch (v) {
    case "yes": return "wheelchair accessible";
    case "limited": return "limited wheelchair access";
    case "no": return "not wheelchair accessible";
    default: return undefined;
  }
}

function operatorClause(v: string | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t.length > 0 ? `operated by ${t}` : undefined;
}

// ── toilet ────────────────────────────────────────────────────────────────

function toiletClauses(tags: OsmTags): Built {
  const out: string[] = [];

  // Lead: the disposal type is the single most decision-relevant fact
  // (flush vs pit latrine). Falls back to the plain noun when untagged.
  let leadIsGeneric = false;
  switch (tags["toilets:disposal"]) {
    case "flush": out.push("Flush toilets"); break;
    case "pitlatrine": out.push("Pit latrine"); break;
    case "chemical": out.push("Chemical toilets"); break;
    case "bucket": out.push("Bucket toilet"); break;
    default:
      if (tags.portable === "yes") out.push("Portable toilet");
      else { out.push("Toilets"); leadIsGeneric = true; }
  }

  if (tags.unisex === "yes") out.push("unisex");
  else if (tags.male === "yes" && tags.female === "yes") out.push("men's and women's");
  else if (tags.male === "yes") out.push("men's only");
  else if (tags.female === "yes") out.push("women's only");

  const wc = wheelchairClause(tags.wheelchair);
  if (wc) out.push(wc);

  if (tags.changing_table === "yes") out.push("changing table");
  if (tags["toilets:handwashing"] === "yes") out.push("handwashing");
  else if (tags["toilets:handwashing"] === "no") out.push("no handwashing");
  if (tags.drinking_water === "yes") out.push("drinking water");
  if (tags.supervised === "yes") out.push("supervised");

  out.push(...feeClauses(tags));
  const ac = accessClause(tags.access);
  if (ac) out.push(ac);
  const op = operatorClause(tags.operator);
  if (op) out.push(op);
  if (tags.opening_hours?.trim()) out.push(`hours ${tags.opening_hours.trim()}`);

  return { clauses: out, leadIsGeneric };
}

// ── water ─────────────────────────────────────────────────────────────────

function waterClauses(tags: OsmTags): Built {
  const out: string[] = [];

  // Lead. `drinking_water=no` OUTRANKS `amenity=drinking_water` — see the
  // SAFETY note at the top of this file. A lead is "specialized" only when an
  // explicit `drinking_water` tag settled potability; the `amenity`/`man_made`
  // forms merely restate the category tag that created the row.
  let leadIsGeneric = false;
  if (tags.drinking_water === "no") {
    out.push("Non-potable water");
  } else if (tags.drinking_water === "yes") {
    out.push("Drinking water");
  } else if (tags.amenity === "drinking_water") {
    out.push("Drinking water"); leadIsGeneric = true;
  } else if (tags.man_made === "water_well") {
    // A well with no potability tag: state what it is, claim nothing.
    out.push("Water well"); leadIsGeneric = true;
  } else if (tags.man_made === "water_tap") {
    out.push("Water tap"); leadIsGeneric = true;
  } else {
    out.push("Water"); leadIsGeneric = true;
  }

  switch (tags.fountain) {
    case "bubbler": out.push("drinking fountain"); break;
    case "bottle_refill": out.push("bottle refill station"); break;
    case "drinking": out.push("drinking fountain"); break;
  }
  if (tags.bottle === "yes") out.push("bottle filling");
  else if (tags.bottle === "no") out.push("no bottle filling");

  if (tags.pump === "powered") out.push("powered pump");
  else if (tags.pump === "manual") out.push("hand pump");

  if (tags.indoor === "yes") out.push("indoor");
  if (tags.covered === "yes") out.push("covered");
  if (tags.seasonal === "no") out.push("year-round");
  else if (tags.seasonal === "yes") out.push("seasonal");

  const wc = wheelchairClause(tags.wheelchair);
  if (wc) out.push(wc);

  out.push(...feeClauses(tags));
  const ac = accessClause(tags.access);
  if (ac) out.push(ac);
  const op = operatorClause(tags.operator);
  if (op) out.push(op);

  return { clauses: out, leadIsGeneric };
}

// ── dump_station ──────────────────────────────────────────────────────────

function dumpStationClauses(tags: OsmTags): Built {
  // The lead is always the category noun, so it is always generic: a bare dump
  // station must contribute at least one real fact to earn a description.
  const out: string[] = ["RV dump station"];

  if (tags.water_point === "yes") out.push("potable water available");
  else if (tags.water_point === "no") out.push("no water");

  if (tags["sanitary_dump_station:round_drain"] === "yes") out.push("round drain");
  if (tags["sanitary_dump_station:pump-out"] === "yes") out.push("pump-out");
  else if (tags["sanitary_dump_station:pump-out"] === "no") out.push("no pump-out");

  out.push(...feeClauses(tags));
  const ac = accessClause(tags.access);
  if (ac) out.push(ac);

  const pay: string[] = [];
  if (tags["payment:cash"] === "yes") pay.push("cash");
  if (tags["payment:debit_cards"] === "yes") pay.push("debit");
  if (tags["payment:credit_cards"] === "yes") pay.push("credit");
  if (pay.length > 0) out.push(`${pay.join("/")} accepted`);

  const op = operatorClause(tags.operator);
  if (op) out.push(op);

  return { clauses: out, leadIsGeneric: true };
}

/**
 * Build a templated description, or `null` when the row has nothing to say.
 *
 * Returns `null` when:
 *   - the category is not templated, or
 *   - the row carries no consumable tag (a bare row — see THRESHOLD above).
 *
 * Never consults or overwrites an existing description; callers decide that
 * (see `normalizeOsm`, which prefers a real `description`/`note` tag).
 */
export function buildTemplatedDescription(
  category: string | null | undefined,
  tags: OsmTags | undefined,
): string | null {
  if (!isTemplatedCategory(category)) return null;
  const t = tags ?? {};
  if (!hasConsumableTag(category, t)) return null;

  const { clauses, leadIsGeneric } =
    category === "toilet" ? toiletClauses(t)
    : category === "water" ? waterClauses(t)
    : dumpStationClauses(t);

  // A lone GENERIC lead ("Toilets", "Water", "RV dump station") only restates
  // the category, so it is suppressed. A lone SPECIALIZED lead is real content
  // in its own right — "Flush toilets." and "Non-potable water." each carry a
  // fact the category label does not — so it stands alone.
  if (clauses.length < 2 && leadIsGeneric) return null;

  const [lead, ...rest] = clauses;
  return rest.length === 0 ? `${lead}.` : `${lead}, ${rest.join(", ")}.`;
}
