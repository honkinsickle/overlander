import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

/**
 * Parser for `planning/reference/alaska-v3.md` (v3.4+).
 *
 * The reference doc is the source of truth for itinerary content
 * (dates, day labels, fixed events, permits). Coords, hero images,
 * waypoint prose, and overnight selections live in alaska.ts as a
 * sidecar — see `lib/trips/alaska.ts` for the merge.
 *
 * Schema is documented in `planning/prompts/master-prompt-v1.1.md`
 * §F (Permits & Border Crossings) and §G (Permit Ref linkage).
 */

export type ParsedDay = {
  /** 1-based day number from §04. */
  day: number;
  /** ISO YYYY-MM-DD. The doc omits years; we resolve against the trip year. */
  date: string;
  /** Raw segment string (e.g. "Whitefish → Banff, AB"). */
  segment: string;
  /** Free-form notes column (e.g. "⚓ FIXED — Blankenship Bridge dispersed camp"). */
  notes: string;
  /** True when the row's notes contain ⚓ — the markdown's flag for a
   *  fixed-event day. */
  isFixedEvent: boolean;
};

export type FixedEvent = {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Raw location string from §03. */
  location: string;
  /** Notes column. */
  notes: string;
  /** Booking column (free-form prose). */
  booking: string;
  /** Literal §08 `Name` values this event depends on. Empty when permit_ref = "—". */
  permitRefs: string[];
};

export type Permit = {
  /** Literal `Name` cell from §08. Used by §03's `Permit Ref` column. */
  name: string;
  whatItsFor: string;
  howToObtain: string;
  leadTime: string;
  status: string;
  notes: string;
};

export type ParsedAlaskaDoc = {
  version: string;
  days: ParsedDay[];
  fixedEvents: FixedEvent[];
  permits: Permit[];
};

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseShortDate(raw: string, year: number): string | null {
  const m = raw.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  const day = parseInt(m[2], 10);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Walk up from cwd to find planning/reference/alaska-v3.md — works in
 *  the main repo (cwd=web) and Claude worktrees (cwd=<wt>/web). */
function resolveReferenceFile(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "planning", "reference", "alaska-v3.md");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `planning/reference/alaska-v3.md not found above cwd=${process.cwd()}`,
  );
}

/** Slice from a `## NN ` heading to the next `## ` heading. */
function sliceSection(raw: string, headingPrefix: string): string {
  const start = raw.indexOf(headingPrefix);
  if (start < 0) return "";
  const rest = raw.slice(start);
  // Skip our own heading then look for the next `\n## ` boundary.
  const nextHeading = rest.slice(headingPrefix.length).search(/\n## /);
  return nextHeading > 0
    ? rest.slice(0, nextHeading + headingPrefix.length)
    : rest;
}

/** Parse a markdown table inside `section`. Returns rows as cell-arrays.
 *  Skips header row and the `---` separator. */
function parseTableRows(section: string): string[][] {
  const rows: string[][] = [];
  let sawHeader = false;
  for (const line of section.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) continue;
    if (cells.every((c) => /^-+$/.test(c.replace(/[: ]/g, "")))) continue; // separator
    if (!sawHeader) {
      sawHeader = true; // first non-separator row is the header
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

function parseVersion(raw: string): string {
  const m = raw.match(/\| v(\d+(?:\.\d+)*)\b/);
  return m ? `v${m[1]}` : "v?";
}

function parseDays(raw: string, year: number): ParsedDay[] {
  const section = sliceSection(raw, "## 04 FULL ITINERARY");
  const out: ParsedDay[] = [];
  for (const cells of parseTableRows(section)) {
    if (cells.length < 4) continue;
    const day = parseInt(cells[0], 10);
    if (Number.isNaN(day)) continue;
    const date = parseShortDate(cells[1], year);
    if (!date) continue;
    out.push({
      day,
      date,
      segment: cells[2],
      notes: cells[3],
      isFixedEvent: cells[3].includes("⚓"),
    });
  }
  return out;
}

function parseFixedEvents(raw: string, year: number): FixedEvent[] {
  const section = sliceSection(raw, "## 03 FIXED DATE EVENTS");
  const out: FixedEvent[] = [];
  for (const cells of parseTableRows(section)) {
    if (cells.length < 5) continue; // v3.4+ schema requires Permit Ref col
    const date = parseShortDate(cells[0], year);
    if (!date) continue;
    const permitRefRaw = cells[4];
    const permitRefs =
      permitRefRaw === "—" || permitRefRaw === "-" || permitRefRaw === ""
        ? []
        : permitRefRaw.split(",").map((s) => s.trim()).filter(Boolean);
    out.push({
      date,
      location: cells[1],
      notes: cells[2],
      booking: cells[3],
      permitRefs,
    });
  }
  return out;
}

function parsePermits(raw: string): Permit[] {
  const section = sliceSection(raw, "## 08 PERMITS & BORDER CROSSINGS");
  // §08 has TWO subtables; we only want the first (Permits & Reservations).
  // Slice from `### Permits & Reservations` to `### Border Crossings`.
  const permitsStart = section.indexOf("### Permits & Reservations");
  if (permitsStart < 0) return [];
  const permitsSection = section.slice(permitsStart);
  const bordersStart = permitsSection.indexOf("### Border Crossings");
  const permitsTable =
    bordersStart > 0 ? permitsSection.slice(0, bordersStart) : permitsSection;
  const out: Permit[] = [];
  for (const cells of parseTableRows(permitsTable)) {
    if (cells.length < 6) continue;
    out.push({
      name: cells[0],
      whatItsFor: cells[1],
      howToObtain: cells[2],
      leadTime: cells[3],
      status: cells[4],
      notes: cells[5],
    });
  }
  return out;
}

let cached: { mtime: number; doc: ParsedAlaskaDoc } | null = null;

/** Parse the whole reference doc. Cached against file mtime so dev edits
 *  are picked up on the next request without restarting the server. */
export async function loadAlaskaDoc(year = 2026): Promise<ParsedAlaskaDoc> {
  const filePath = resolveReferenceFile();
  const stat = await fs.stat(filePath);
  if (cached && cached.mtime === stat.mtimeMs) return cached.doc;
  const raw = await fs.readFile(filePath, "utf8");
  const doc: ParsedAlaskaDoc = {
    version: parseVersion(raw),
    days: parseDays(raw, year),
    fixedEvents: parseFixedEvents(raw, year),
    permits: parsePermits(raw),
  };
  cached = { mtime: stat.mtimeMs, doc };
  return doc;
}

/** Helper used by the merge: ISO date → fixed event (or null). */
export function findFixedEventByDate(
  doc: ParsedAlaskaDoc,
  isoDate: string,
): FixedEvent | null {
  return doc.fixedEvents.find((e) => e.date === isoDate) ?? null;
}

/** Helper used by the merge: §03 row → list of {permit, status} pairs.
 *  Drops permit_refs that don't resolve in §08 (logged for /validate). */
export function resolvePermitStatuses(
  doc: ParsedAlaskaDoc,
  event: FixedEvent,
): { name: string; status: string }[] {
  const out: { name: string; status: string }[] = [];
  for (const ref of event.permitRefs) {
    const permit = doc.permits.find((p) => p.name === ref);
    if (!permit) {
      // Schema guarantee broken — surface to /validate. Don't throw.
      // eslint-disable-next-line no-console
      console.warn(
        `[alaska-md] §03 permit_ref "${ref}" not found in §08 (date ${event.date})`,
      );
      continue;
    }
    out.push({ name: permit.name, status: permit.status });
  }
  return out;
}
