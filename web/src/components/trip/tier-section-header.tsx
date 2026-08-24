import type { CSSProperties } from "react";

/**
 * Section divider for the Verified / Unverified place tiers in a results list.
 *
 * Presentational only — the split logic (where it goes, when to show it) is in
 * `lib/trip-browse/tier-sections.ts`. `style` lets the parent make it span the
 * full row of its own layout: a flex-wrap grid passes `width: "100%"`, a CSS
 * grid passes `gridColumn: "1 / -1"`.
 *
 * Unverified is intentionally de-emphasized (`--text-muted`) vs Verified
 * (`--text-primary`) — the tier is about how much to trust the card, so the
 * lower-trust section reads quieter.
 */
const LABEL: Record<"verified" | "unverified", string> = {
  verified: "Verified",
  unverified: "Unverified",
};

export function TierSectionHeader({
  tier,
  style,
}: {
  tier: "verified" | "unverified";
  style?: CSSProperties;
}) {
  return (
    <div
      role="separator"
      aria-label={`${LABEL[tier]} places`}
      style={{
        display: "flex",
        alignItems: "center",
        paddingTop: 6,
        marginTop: 4,
        borderTop: "1px solid var(--border-subtle)",
        fontFamily: "var(--ff-display)",
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color:
          tier === "verified" ? "var(--text-primary)" : "var(--text-muted)",
        ...style,
      }}
    >
      {LABEL[tier]}
    </div>
  );
}
