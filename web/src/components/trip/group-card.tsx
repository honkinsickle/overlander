import { ArrowRight, ChevronRight } from "lucide-react";
import {
  type Category,
  categoryIcon,
  categoryStyle,
} from "@/components/primitives/detail-card";

const VARIANT_CATEGORY: Record<"overnight" | "fuel", Category> = {
  overnight: "camping",
  fuel: "fuel",
};

/**
 * Group card (Paper N3X-0 / N2L-0). Used for clusters like "Tumalo Creek Area"
 * (overnight) or "Bend Fuel Stops". Header label → photo with overlay → list of
 * items (icon + name + meta + tip + chevron) → Browse button.
 */
export type GroupItem = {
  id: string;
  category: Category;
  title: string;
  meta: string;
  tip: string;
};

export type GroupCardProps = {
  variant: "overnight" | "fuel";
  groupTitle: string;
  groupSubtitle: string;
  heroImage: string;
  items: GroupItem[];
  browseLabel: string;
};

const VARIANT_LABEL: Record<GroupCardProps["variant"], string> = {
  overnight: "⛺ OVERNIGHT",
  fuel: "⛽ FUEL STOPS",
};

export function GroupCard({
  variant,
  groupTitle,
  groupSubtitle,
  heroImage,
  items,
  browseLabel,
}: GroupCardProps) {
  const variantCat = categoryStyle[VARIANT_CATEGORY[variant]];
  return (
    <div
      className="flex flex-col w-[410px] rounded-[4px] overflow-clip border border-border-subtle"
      style={{ backgroundColor: "#161819BF" }}
    >
      <div
        className="uppercase"
        style={{
          fontFamily: "var(--ff-mono)",
          fontSize: 13,
          lineHeight: "18px",
          letterSpacing: "0.14em",
          color: "var(--text-muted)",
          paddingInline: 15,
          paddingTop: 12,
          paddingBottom: 8,
        }}
      >
        {VARIANT_LABEL[variant]}
      </div>

      <div
        className="relative shrink-0 bg-cover bg-center"
        style={{ height: 150, backgroundImage: `url(${heroImage})` }}
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(17,18,20,0) 45%, rgba(17,18,20,0.85) 100%)",
          }}
        />
        <div
          className="absolute"
          style={{ bottom: 12, left: 14, display: "flex", flexDirection: "column", gap: 2 }}
        >
          <span
            style={{
              fontSize: 18,
              lineHeight: "22px",
              fontFamily: "var(--ff-sans)",
              fontWeight: 700,
              color: "#ECEAE4",
            }}
          >
            {groupTitle}
          </span>
          <span
            className="uppercase"
            style={{
              fontSize: 9,
              lineHeight: "12px",
              fontFamily: "var(--ff-mono)",
              letterSpacing: "2px",
              color: "rgba(255,255,255,0.7)",
            }}
          >
            {groupSubtitle}
          </span>
        </div>
      </div>

      <div className="flex flex-col">
        {items.map((item) => (
          <GroupRow key={item.id} item={item} />
        ))}
        <div
          style={{
            paddingTop: 14,
            paddingBottom: 14,
            paddingInline: 10,
          }}
        >
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 rounded-sm"
            style={{
              height: 36,
              backgroundColor: variantCat.bg,
              border: `1px solid ${variantCat.accent}`,
            }}
          >
            <span
              style={{
                fontSize: 14,
                lineHeight: "18px",
                fontFamily: "var(--ff-sans)",
                color: "#FFFFFF",
              }}
            >
              {browseLabel}
            </span>
            <ArrowRight
              className="w-3 h-3"
              color="#FFFFFF"
              strokeWidth={1.75}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupRow({ item }: { item: GroupItem }) {
  const cat = categoryStyle[item.category];
  const Icon = categoryIcon[item.category];

  return (
    <div
      className="flex items-start gap-3 border-b border-border-subtle"
      style={{ paddingTop: 14, paddingBottom: 14, paddingLeft: 10, paddingRight: 16 }}
    >
      <div
        className="flex items-center justify-center rounded-full shrink-0"
        style={{
          width: 44,
          height: 44,
          backgroundColor: cat.bg,
          border: `1px solid ${cat.accent}`,
        }}
      >
        <Icon className="w-5 h-5" style={{ color: cat.accent }} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <span
          style={{
            fontSize: 16,
            lineHeight: "20px",
            fontFamily: "var(--ff-sans)",
            fontWeight: 700,
            color: cat.accent,
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            fontSize: 14,
            lineHeight: "18px",
            fontFamily: "var(--ff-sans)",
            color: "#CFCFCF",
          }}
        >
          {item.meta}
        </span>
        <span
          style={{
            marginTop: 2,
            fontSize: 13,
            lineHeight: "18px",
            fontFamily: "var(--ff-mono)",
            color: "var(--amber)",
          }}
        >
          ↳ {item.tip}
        </span>
      </div>
      <button
        type="button"
        aria-label={`${item.title} details`}
        className="flex items-center justify-center rounded-sm shrink-0"
        style={{
          width: 28,
          height: 28,
          border: "1px solid rgba(167,204,253,0.12)",
        }}
      >
        <ChevronRight
          className="w-3.5 h-3.5"
          style={{ color: "#6DA7D4" }}
          strokeWidth={1.75}
        />
      </button>
    </div>
  );
}
