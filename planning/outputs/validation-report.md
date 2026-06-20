# Alaska v3.3 — Validation Report

**Source:** `planning/reference/alaska-v3.md` (v3.3, 2026-05-11)
**Against:** `planning/prompts/master-prompt-v1.1.md`
**Generated:** 2026-05-11 (18 days to departure)

**Summary: 6 blockers, 5 warns, 4 notes.**

**Changes since prior run (v3.1 → v3.3):**
- v3.2 added `Status` column to §08 Permits & Reservations (all rows default `Not Yet Booked`).
- v3.3 added `⚠ OVERRUN` flags + one-line justifications on §04 Days 8, 27, 52.
- Three drive-overrun warns cleared. Permit blockers unchanged — none move without booking action.

---

## Blockers

| Issue | Severity | Location | Suggested Fix |
|---|---|---|---|
| Brooks Falls Platform Permit lead time (4–6 months) exceeded. 41 days to Day 24 (Jun 21); recommended booking window opened Dec–Feb. Without it, the floatplane landing at the platform cannot occur. | blocker | §08 Permits "Brooks Falls Platform Permit"; §04 Day 24; §03 Jun 21 | Check Recreation.gov today for cancellations. If unavailable, swap Jun 21 to a non-platform Katmai option (Hallo Bay, Lake Clark, Wolverine Creek) or release the anchor. |
| Homer Air / Katmai Air floatplane lead time (2–3 months) exceeded; 41 days to Jun 21. If unbookable, the Jun 20–21 Homer phase collapses. | blocker | §08 Permits "Homer Air / Katmai Air"; §04 Day 24 | Call both operators today. Fallback: Lake Clark / Crescent Lake bear-viewing flights or release the anchor. |
| Kenai Fjords Northwestern Fjords full-day tour lead time (2–3 months) exceeded; 38 days to Day 21 (Jun 18). Peak-June NW Fjords sells out earliest. | blocker | §08 Permits "Kenai Fjords Boat Tour"; §04 Day 21; §03 Jun 18 | Book today across Kenai Fjords Tours and Major Marine Tours. If NW Fjords full, accept Aialik or Resurrection Bay and document the scope change. |
| Tunnel Mountain Campground (Banff) lead time (3–4 months) exceeded; 22 days to Day 5. Peak-season Banff sites typically fully booked. | blocker | §08 Permits "Tunnel Mountain Campground"; §04 Day 5 | Daily cancellation watch on Parks Canada. Backups: Two Jack Lakeside, Lake Louise overflow, Castle Mountain, or a Canmore motel. |
| Moraine Lake Vehicle Reservation lead time (3–4 months) exceeded; 22 days to Day 5. Walk-ups not allowed in peak season. | blocker | §08 Permits "Moraine Lake Vehicle Reservation"; §04 Day 5; §06 photography priority | Cancellation watch daily. If no reservation, use the Parks Canada shuttle or shift the shoot to Peyto Lake / Bow Lake. |
| Whistlers Campground (Jasper) lead time (3–4 months) exceeded; 24 days to Day 7. | blocker | §08 Permits "Whistlers Campground"; §04 Day 7 | Cancellation watch; backups: Wapiti, Wabasso, Pocahontas, or a Jasper townsite motel. |

---

## Warns

| Issue | Severity | Location | Suggested Fix |
|---|---|---|---|
| Aug 1 Port Angeles event remains TBC. §04 Day 65 carries the ⚓, but §03 says "Event TBC" and §08 says "TBC — permits required". 82 days out is enough lead time for most permits, but only if scope is defined this week. | warn | §03 Aug 1 row; §04 Day 65; §08 Permits "Port Angeles Event (Aug 1)" | Confirm event source / nature / permit class today. If the anchor can't be sourced, downgrade Aug 1 from ⚓ Fixed and trim the itinerary back to Day 63 or 64. |
| Victoria → Port Angeles (Day 57, Jul 24) is an international border crossing (Canada → USA via MV Coho Ferry) but is not in §08 Border Crossings — only listed under Permits. | warn | §04 Day 57; §08 Border Crossings table | Add a Border Crossings row: "Black Ball Ferry Terminal, Victoria, BC / Port Angeles, WA \| Canada → USA \| Passport, vehicle registration, NEXUS optional \| Vehicle + foot CBP at Port Angeles; declare food/alcohol/fuel cans; sailing schedule constrains arrival window." |
| Glacier View Car Launch GPS coords and registration unconfirmed for the Jul 3 anchor (Day 36). 53 days out — recoverable but should not slip. | warn | §03 Jul 3; §08 Permits "Glacier View Car Launch"; §04 Day 36 | Contact organizer this week to lock coords, parking, registration, and any spectator fees. |
| Enchantments Wilderness Permit references March lottery — already past. If a hike is intended, the lottery window is closed. | warn | §08 Permits "Enchantments Wilderness Permit" | Confirm whether Enchantments is actually planned (no overnight is mapped in §04). If not on route, remove from §08 to reduce noise. If intended, plan as day-hike or shift to a non-lottery alternative. |
| Days 59–61 (Jul 26–28) Port Angeles and Day 66 (Aug 2) Port Angeles have thin or empty Notes — purpose of the four-day pre-event sit and the one-day post-event buffer not specified. | warn | §04 Days 59–61, 66 | Once Aug 1 event scope is resolved, decide whether those days are pre-event prep, Olympic NP exploration, or buffer/rest. Either populate or compress the Port Angeles block. |

---

## Notes

| Issue | Severity | Location | Suggested Fix |
|---|---|---|---|
| Most §04 rows do not follow the Camping Field Format (`Dispersed —`, `Campground —`, `Hotel —`). Day 2 reads "Overnight dispersed — Wasatch-Cache NF" (close, lowercase); Day 3 reads "Blankenship Bridge dispersed camp" (no type label); most rows omit overnight entirely. New Days 64–66 also lack the format. | note | §04 throughout | If §04 is meant to satisfy the Camping Field Format directly, normalize the Notes column. If §04 is intended as a route skeleton and the Camping format applies only to detailed daily outputs (e.g. `/detail-days`), document that scope distinction in `planning/CLAUDE.md`. |
| Multiple TBCs across §03 / §08 (Aug 1 event, Glacier View coords, Enchantments lottery). Flagged individually above; collectively, all open items should be tracked on a single pre-departure checklist. | note | §03, §08 | Generate a pre-departure punch list summarizing every TBC with owner + deadline. The new §08 `Status` column makes this easier — could be exported directly as the checklist. |
| §05 fuel-gap segments are all within ~400 mi GX470 range; the Fairbanks → Deadhorse 414 mi total is mitigated with a Coldfoot top-up plus 5 gal extra. No unflagged fuel risk found. Days 64–66 are paved PNW corridors with ample fuel. | note | §05 | None needed — fuel section internally consistent. Verify spare fuel cans are road-legal across BC/YT before crossing. |
| §08 Sweetgrass row says "Declare food, alcohol, and fuel cans." CBSA tightened restrictions on raw poultry, dairy, and certain produce in 2024–2025. Worth re-checking the current prohibited list before Day 4. | note | §08 Sweetgrass row | Verify current CBSA prohibited / restricted food list ~1 week before departure and adjust pantry. |

---

## Resolved since prior run (v3.1)

- §08 schema: `Status` column added; all 11 rows default `Not Yet Booked`. ✓
- §04 Day 8 ⚠ OVERRUN flag + justification added. ✓
- §04 Day 27 ⚠ OVERRUN flag + justification added. ✓
- §04 Day 52 ⚠ OVERRUN flag + justification added. ✓

## What's not in this report

- Food (§07) and photography (§06) sections not reviewed beyond the eight checks.
- Distance estimates for drive-overrun checks remain approximate.
- The new §08 `Status` column is not yet wired into any downstream artifact; first booking will require manual update.
