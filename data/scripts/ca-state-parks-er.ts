/**
 * Two-phase entity resolution for `state_parks_web` (CA).
 *
 * Reconstructs the step that produced CA's TEST linkage on 2026-09-01 but was
 * never committed — commit `379c213` changed only `matcher.ts` and docs, so
 * unlike OR/NV/AZ/UT there was no `ca-state-parks-er.ts`.
 *
 * `--verify` on TEST 2026-09-02: 181 recorded / 181 re-derived / 181 agree,
 * 0 disagree, 0 missing, 0 extra — phase 1 reproduces the recorded set exactly.
 * It did NOT on the first attempt: plain first-match-wins containment
 * disagreed on 3 records sitting inside two overlapping park polygons, which is
 * what motivated the name disambiguation in `lib/spatial-prelink.ts`.
 *
 * Run (TEST):
 *   npx tsx --env-file=.env scripts/ca-state-parks-er.ts --verify
 *   npx tsx --env-file=.env scripts/ca-state-parks-er.ts --dry-run
 */

import { runStateParksEr } from "./lib/state-parks-er.ts";
import { logger } from "../ingestion/lib/logger.ts";

runStateParksEr({
  sourceId: "state_parks_web",
  gisPrefix: "state_parks:CA:%",
  resolvedBy: "auto:state_parks_web_er",
  label: "ca-er",
}).catch((e: unknown) => {
  logger.error({ err: e }, "ca-er: fatal");
  process.exit(1);
});
