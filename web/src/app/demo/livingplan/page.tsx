import Link from "next/link";

/**
 * TEMP dev launcher for living-plan verification (feat/living-plan-editing).
 * The canonical slideup mounts only on SOFT-NAV to /trip/[id] (root
 * @modal/(.)trip intercept), and /trips lists only user trips — reference
 * rows like the living-plan TEST copy have no card. This page provides the
 * in-shell Link. Delete or keep gated at branch review.
 *
 * Gated on EITHER surface flag: the harness is a reachability affordance for a
 * slideup that exercises both the manual Edit toggle (LIVING_PLAN_ON) and the NL
 * composer (NL_EDIT_ON). Gating on only one would hide the launcher during dev of
 * the other. It costs nothing to reach the slideup; the surfaces inside are each
 * independently flag-gated.
 */
export default function LivingPlanDemoPage() {
  const livingPlanOn = process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT === "1";
  const nlEditOn = process.env.NEXT_PUBLIC_NL_EDIT === "1";
  if (!livingPlanOn && !nlEditOn) {
    return <div style={{ padding: 40 }}>living-plan flags are off.</div>;
  }
  return (
    <div style={{ padding: 40, display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontFamily: "var(--ff-display)" }}>Living-plan dev launcher</h1>
      <Link
        href="/trip/dawson-cassiar-livingplan-test"
        style={{ color: "var(--amber)", textDecoration: "underline" }}
      >
        Open the TEST copy in the slideup →
      </Link>
    </div>
  );
}
