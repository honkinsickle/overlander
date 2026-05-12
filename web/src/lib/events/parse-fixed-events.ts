import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

export type FixedEvent = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  location: string;
  notes: string;
  booking: string;
};

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Resolve "May 31" against a year. The reference doc omits years; we
 *  pin to the trip year (2026) so the fixed-events table is stable. */
function parseShortDate(raw: string, year: number): string | null {
  const m = raw.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTH_INDEX[m[1].toLowerCase()];
  if (month === undefined) return null;
  const day = parseInt(m[2], 10);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Climb up from `process.cwd()` looking for `planning/reference/alaska-v3.md`.
 *  Works both in the main repo (cwd is `web/`, file is at `../planning/...`)
 *  and in a Claude worktree (cwd is `<worktree>/web/`, file is at the
 *  project root via `.claude/worktrees/<name>/web/` → climb 4 levels). */
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

/** Read planning/reference/alaska-v3.md, slice §03, parse the markdown
 *  table into FixedEvent[]. */
export async function loadFixedEvents(year = 2026): Promise<FixedEvent[]> {
  const filePath = resolveReferenceFile();
  const raw = await fs.readFile(filePath, "utf8");

  // Slice from "## 03 FIXED DATE EVENTS" to the next "## " heading.
  const start = raw.indexOf("## 03 FIXED DATE EVENTS");
  if (start < 0) return [];
  const rest = raw.slice(start);
  const nextHeading = rest.slice(3).search(/\n## /);
  const section = nextHeading > 0 ? rest.slice(0, nextHeading + 3) : rest;

  // Match rows: | Date | Location | Notes | Booking |
  const events: FixedEvent[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    if (cells[0].toLowerCase() === "date") continue; // header
    if (/^-+$/.test(cells[0])) continue; // separator row
    const date = parseShortDate(cells[0], year);
    if (!date) continue;
    events.push({
      date,
      location: cells[1],
      notes: cells[2],
      booking: cells[3],
    });
  }
  return events;
}

/** Days between today (local midnight) and `date` (ISO YYYY-MM-DD).
 *  Negative = past. */
export function daysUntil(date: string, today = new Date()): number {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target.getTime() - t.getTime()) / 86_400_000);
}

export type Urgency = "red" | "yellow" | "green";

export function urgencyFor(days: number): Urgency {
  if (days < 7) return "red";
  if (days < 30) return "yellow";
  return "green";
}
