import Link from "next/link";

/**
 * TEMP dev launcher for living-plan verification (feat/living-plan-editing).
 * The canonical slideup mounts only on SOFT-NAV to /trip/[id] (root
 * @modal/(.)trip intercept), and /trips lists only user trips — reference
 * rows like the living-plan TEST copy have no card. This page provides the
 * in-shell Link. Dev-only by the same flag as the affordance; delete or
 * keep gated at branch review.
 */
export default function LivingPlanDemoPage() {
  if (process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT !== "1") {
    return <div style={{ padding: 40 }}>living-plan flag is off.</div>;
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
