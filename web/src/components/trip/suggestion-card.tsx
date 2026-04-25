import { ArrowRight, ChevronRight, Plus } from "lucide-react";
import {
  type Category,
  categoryIcon,
  categoryStyle,
} from "@/components/primitives/detail-card";

/**
 * Suggestion card for the trip page Suggested section (Paper N7F-0 / N6Q-0).
 * `featured` swaps a 240h hero w/ EDITOR'S PICK chip for the standard 130h.
 */
export type SuggestionCardProps = {
  category: Category;
  title: string;
  hours?: string;
  description: string;
  heroImage: string;
  browseLabel: string;
  featured?: boolean;
};

export function SuggestionCard({
  category,
  title,
  hours,
  description,
  heroImage,
  browseLabel,
  featured = false,
}: SuggestionCardProps) {
  const cat = categoryStyle[category];
  const Icon = categoryIcon[category];

  return (
    <div
      className="flex flex-col w-[410px] rounded-[4px] overflow-clip border border-border-subtle"
      style={{ backgroundColor: "#161819BF" }}
    >
      <div
        className="relative shrink-0 bg-cover bg-center"
        style={{
          height: featured ? 240 : 130,
          backgroundImage: `url(${heroImage})`,
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(17,18,20,0.4) 0%, rgba(17,18,20,0) 50%, rgba(17,18,20,0.6) 100%)",
          }}
        />
        {featured && (
          <div
            className="absolute top-2 right-3 flex items-center gap-1.5 h-7 rounded-full"
            style={{
              paddingTop: 5,
              paddingBottom: 5,
              paddingLeft: 8,
              paddingRight: 10,
              backgroundColor: "#D59B13",
              border: "1px solid rgba(232,201,142,0.35)",
              backdropFilter: "blur(6px)",
            }}
          >
            <span style={{ fontSize: 14, color: "var(--amber-light)" }}>
              🌋
            </span>
            <span
              className="uppercase"
              style={{
                fontSize: 13,
                lineHeight: "12px",
                fontFamily: "var(--ff-display)",
                fontWeight: 600,
                letterSpacing: "0.07em",
                color: "#FFFFFF",
              }}
            >
              Editor's Pick
            </span>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2.5" style={{ padding: 12 }}>
        <div
          className="flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 44,
            height: 44,
            backgroundColor: cat.bg,
            border: `0.5px solid ${cat.accent}`,
            boxShadow: "0 2px 3px rgba(0,0,0,0.25)",
          }}
        >
          <Icon
            className="w-5 h-5"
            style={{ color: cat.accent }}
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 2 }}>
          <span
            className="truncate"
            style={{
              fontSize: 17,
              lineHeight: "22px",
              fontFamily: "var(--ff-sans)",
              fontWeight: 700,
              letterSpacing: "0.01em",
              color: cat.accent,
            }}
          >
            {title}
          </span>
          {hours && (
            <span
              style={{
                fontSize: 13,
                lineHeight: "16px",
                fontFamily: "var(--ff-sans)",
                color: "#9FB66A",
              }}
            >
              {hours}
            </span>
          )}
          <p
            style={{
              marginTop: 4,
              fontSize: 14,
              lineHeight: "20px",
              fontFamily: "var(--ff-sans)",
              color: "#CFCFCF",
            }}
          >
            {description}
          </p>
        </div>
        <button
          type="button"
          aria-label={`${title} details`}
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

      <div
        className="flex items-center"
        style={{ gap: 8, paddingInline: 10, paddingBlock: 12 }}
      >
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-sm"
          style={{
            height: 36,
            backgroundColor: cat.bg,
            border: `1px solid ${cat.accent}`,
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
        <button
          type="button"
          className="flex items-center justify-center gap-1.5 rounded-sm"
          style={{
            width: 130,
            height: 36,
            backgroundColor: "rgba(232,201,142,0.10)",
            border: "1px solid rgba(232,201,142,0.4)",
          }}
        >
          <Plus
            className="w-3 h-3"
            color="var(--amber-light)"
            strokeWidth={1.75}
          />
          <span
            style={{
              fontSize: 14,
              lineHeight: "18px",
              fontFamily: "var(--ff-sans)",
              color: "var(--amber-light)",
            }}
          >
            Add to Trip
          </span>
        </button>
      </div>
    </div>
  );
}
