# Alaska Overland Planning Project

## Role
You are operating per the v1.1 Overlanding Master Prompt at `prompts/master-prompt-v1.1.md`. Read it fully on session start and follow it as your operating constitution for every output in this directory.

## Source of Truth
`reference/alaska-v3.md` is the authoritative trip data. It contains MASTER PARAMETERS, VEHICLE & GROUP, FIXED DATE EVENTS, the full itinerary, fuel gaps, photography priorities, food, permits, and border crossings. When the master prompt references "the reference doc," this is the file.

## Path Convention
This `CLAUDE.md` lives in `planning/` and assumes `claude` is invoked from the project root (`Full App v1/`). All paths in slash commands and outputs are written relative to the project root:
- `planning/prompts/master-prompt-v1.1.md`
- `planning/reference/alaska-v3.md`
- `planning/outputs/`

## Output Discipline
- All generated artifacts go in `planning/outputs/` with descriptive filenames
- Never modify `planning/reference/` or `planning/prompts/` without explicit instruction (use the `/update-reference` command for proposed edits)
- When a slash command runs, write the file AND present it; don't just print to chat

## Fallback Behavior
v1.1 removed all hardcoded Alaska/GX470 fallbacks. If a value is missing from the reference doc, flag the assumption inline with `[ASSUMPTION: ...]` per the master prompt's ✦ UPDATED fallback rules.

## Conventions
- Distances: miles primary; km parenthetical for Canada segments
- Temperatures: plain `F` (no degree symbol — CSV format rule, applied consistently across all outputs for parity)
- Fixed_Date_Events from reference section 03 are hard anchors; flag with ⚓; never reschedule silently
- Camping field format: type label first (`Dispersed —`, `Campground —`, `Hotel —`), then name/area and notes

## Working Style
- Read the master prompt before producing any output, not just on the first session
- Tables follow Master Prompt Section C columns unless the wider detail format is requested
- Flag any logistical impossibility (e.g. a >350 mi day forced by a fixed anchor) but proceed if the user accepts it
- For CSV mode, enforce Section E strictly — no markdown, no fences, no preamble

## Known Reference Doc Inconsistencies (as of v3)
These will be flagged by `/validate` but are worth knowing upfront:
- Title says 63 days; MASTER PARAMETERS says 66 days; section 04 has 63 populated rows + 19 empty rows numbered 64–82
- Aug 1 Port Angeles fixed event in section 03 falls after the Jul 30 itinerary end in section 04
- Resolve via `/update-reference` and bump to v3.1
