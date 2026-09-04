import { describe, expect, it } from "vitest";
import {
  pickCanonicalGroup,
  resolveGroupMembers,
  scoreMember,
  type MemberForCanonical,
} from "./merge-canonical.ts";

/** The three real Group 83 (Hat Rock, OR) members, by role. */
const OR_VISITOR: MemberForCanonical = {
  id: "d7ebf7be-b17e-4c2d-b3c7-ef7ace4daee0",
  source_ids: ["oregon_state_parks"],
};
const NPS_PARK: MemberForCanonical = {
  id: "0f13a10f-1c9a-4974-bc3a-51ccce029bb2",
  source_ids: ["nps"],
};
/** The rock formation INSIDE the park — must never be merged into it. */
const NPS_ROCK: MemberForCanonical = {
  id: "971799f0-a736-474a-b443-5bc84bb27085",
  source_ids: ["nps"],
};
/** The state_parks GIS row that scoreMember weights at +100. */
const GIS_PARK: MemberForCanonical = {
  id: "efe59e93-f1da-467e-b678-726108440d78",
  source_ids: ["state_parks", "wikipedia"],
};

describe("resolveGroupMembers", () => {
  it("returns every member untouched when no exclusions are given", () => {
    const members = [OR_VISITOR, NPS_PARK, NPS_ROCK];
    for (const excluded of [undefined, []]) {
      const split = resolveGroupMembers(members, excluded);
      expect(split.merging).toEqual(members);
      expect(split.excluded).toEqual([]);
    }
  });

  it("splits a 3-member group into 2 merging + 1 excluded", () => {
    const split = resolveGroupMembers([OR_VISITOR, NPS_PARK, NPS_ROCK], [NPS_ROCK.id]);
    expect(split.merging.map((m) => m.id)).toEqual([OR_VISITOR.id, NPS_PARK.id]);
    expect(split.excluded.map((m) => m.id)).toEqual([NPS_ROCK.id]);
  });

  it("throws when an excluded id is not a member of the group", () => {
    expect(() =>
      resolveGroupMembers([OR_VISITOR, NPS_PARK], ["00000000-0000-0000-0000-000000000000"]),
    ).toThrow(/not members of this group/);
  });

  it("throws rather than producing a no-op merge of fewer than 2 members", () => {
    expect(() => resolveGroupMembers([OR_VISITOR, NPS_ROCK], [NPS_ROCK.id])).toThrow(
      /needs at least 2/,
    );
    expect(() =>
      resolveGroupMembers([OR_VISITOR, NPS_PARK, NPS_ROCK], [NPS_PARK.id, NPS_ROCK.id]),
    ).toThrow(/needs at least 2/);
  });

  it("does not mutate the caller's member array", () => {
    const members = [OR_VISITOR, NPS_PARK, NPS_ROCK];
    resolveGroupMembers(members, [NPS_ROCK.id]);
    expect(members).toHaveLength(3);
  });
});

describe("exclusion changes the canonical pick — the reason the two steps are ordered", () => {
  it("Group 83 as originally grouped is undecidable (3-way tie at score 1)", () => {
    const pick = pickCanonicalGroup([OR_VISITOR, NPS_PARK, NPS_ROCK]);
    expect(pick.canonical).toBeNull();
    expect(pick.reason).toMatch(/tie/);
  });

  it("excluding the rock still ties — the pair alone cannot elect a canonical", () => {
    const split = resolveGroupMembers([OR_VISITOR, NPS_PARK, NPS_ROCK], [NPS_ROCK.id]);
    expect(pickCanonicalGroup(split.merging).canonical).toBeNull();
  });

  it("adding the state_parks row and excluding the rock elects the GIS row outright", () => {
    const split = resolveGroupMembers(
      [OR_VISITOR, NPS_PARK, NPS_ROCK, GIS_PARK],
      [NPS_ROCK.id],
    );
    const pick = pickCanonicalGroup(split.merging);
    expect(pick.canonical?.id).toBe(GIS_PARK.id);
    // 100 (state_parks) + 0 (also visitor-tagged? no) + 10 (no visitor src) + 2 sources
    expect(scoreMember(GIS_PARK)).toBeGreaterThan(scoreMember(OR_VISITOR));
  });

  it("picking before excluding could elect a member that is then held out — guard the order", () => {
    // If the canonical were picked over ALL members first, GIS_PARK wins; if a
    // caller then excluded GIS_PARK, it would be canonical AND excluded. The
    // executor refuses that combination; this documents why the check exists.
    const all = [OR_VISITOR, NPS_PARK, GIS_PARK];
    expect(pickCanonicalGroup(all).canonical?.id).toBe(GIS_PARK.id);
    const split = resolveGroupMembers(all, [GIS_PARK.id]);
    expect(pickCanonicalGroup(split.merging).canonical).toBeNull();
  });
});
