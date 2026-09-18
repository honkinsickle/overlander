import { describe, it, expect } from "vitest";
import { parseBuiltDir, queueIsEmpty } from "./auto-post.ts";

// The real shapes, copied from live runs on 2026-09-17 — the parser exists to
// read these exact lines, so the fixtures are the actual output rather than an
// idealised version of it.
const WITH_STORY =
  "\n✓ Trees of Mystery → oddities template 2 + story → /Users/adamwagner/conductor/workspaces/overlander/chisinau/data/pin-of-the-week/output/sheet/oddities/trees-of-mystery\n\n1 built → /Users/adamwagner/conductor/workspaces/overlander/chisinau/data/pin-of-the-week/output/sheet/oddities/review.html\n";

const WITHOUT_STORY =
  "✓ Boulder Basin → campground template 1 (no story) → /repo/data/pin-of-the-week/output/sheet/campground/boulder-basin\n\n1 built → /repo/data/pin-of-the-week/output/sheet/campground/review.html\n";

const EMPTY_QUEUE = 'nothing to build — every row in "scenic posts" is already posted\n';

describe("parseBuiltDir", () => {
  it("takes the post dir off the ✓ line, not the review.html line below it", () => {
    expect(parseBuiltDir(WITH_STORY)).toBe(
      "/Users/adamwagner/conductor/workspaces/overlander/chisinau/data/pin-of-the-week/output/sheet/oddities/trees-of-mystery",
    );
  });

  it("works when no story was rendered", () => {
    expect(parseBuiltDir(WITHOUT_STORY)).toBe(
      "/repo/data/pin-of-the-week/output/sheet/campground/boulder-basin",
    );
  });

  it("returns null on an empty queue rather than inventing a path", () => {
    expect(parseBuiltDir(EMPTY_QUEUE)).toBeNull();
  });

  it("returns null when the last field is not an absolute path", () => {
    // Guards the failure that matters: a changed output format must read as
    // "could not find the dir", never as a relative path that later resolves
    // somewhere unintended.
    expect(parseBuiltDir("✓ Somewhere → scenic template 1 → output/sheet/scenic/somewhere\n")).toBeNull();
  });
});

describe("queueIsEmpty", () => {
  it("recognises the empty-queue message", () => {
    expect(queueIsEmpty(EMPTY_QUEUE)).toBe(true);
  });

  it("does not mistake a successful build for an empty queue", () => {
    expect(queueIsEmpty(WITH_STORY)).toBe(false);
  });
});
