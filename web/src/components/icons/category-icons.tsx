import * as React from "react";

// Stroke-based category icons. Paths extracted from Paper artboard 1PZ8-0
// (page "Browse Slide In"). Each icon is 24×24 viewBox, stroke-only, 1.75
// stroke width — sized via the parent badge (typically 22×22 inside a
// 44×44 circular badge). Color is driven by `stroke` (default
// `currentColor` so it inherits from the badge's text color).

type IconProps = Omit<React.SVGProps<SVGSVGElement>, "viewBox" | "fill"> & {
  size?: number;
};

function base({ size = 22, stroke = "currentColor", strokeWidth = 1.75, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    xmlns: "http://www.w3.org/2000/svg",
    ...props,
  };
}

export function TentIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 20 L12 4 L21 20 Z" />
      <path d="M10 20 L12 14 L14 20" />
    </svg>
  );
}

export function BuildingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="7" height="18" />
      <rect x="14" y="8" width="7" height="13" />
      <line x1="6" y1="7" x2="7" y2="7" />
      <line x1="6" y1="11" x2="7" y2="11" />
      <line x1="6" y1="15" x2="7" y2="15" />
      <line x1="17" y1="12" x2="18" y2="12" />
      <line x1="17" y1="16" x2="18" y2="16" />
    </svg>
  );
}

export function MountainPeakIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <polygon points="3 20 9 9 13 15 16 11 21 20" />
      <circle cx="17" cy="6" r="1.5" />
    </svg>
  );
}

export function CoffeeCupIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M17 8h1a3 3 0 0 1 0 6h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
      <line x1="6" y1="2" x2="6" y2="5" />
      <line x1="10" y1="2" x2="10" y2="5" />
      <line x1="14" y1="2" x2="14" y2="5" />
    </svg>
  );
}

export function FuelPumpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="3" width="10" height="18" rx="1" />
      <line x1="6" y1="7" x2="12" y2="7" />
      <path d="M14 9 h4 v9 a2 2 0 0 1 -2 2 a2 2 0 0 1 -2 -2 V9z" />
      <path d="M16 4 v3" />
    </svg>
  );
}

export function BedIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 5v15" />
      <path d="M2 9 H20 a2 2 0 0 1 2 2 v9" />
      <path d="M2 16 H22" />
      <rect x="4.5" y="10.5" width="5" height="3.5" rx="0.5" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export type CategoryIconName =
  | "camping"
  | "urban"
  | "scenic"
  | "food"
  | "fuel"
  | "hotel"
  | "oddity";

const ICON_BY_NAME: Record<
  CategoryIconName,
  React.ComponentType<IconProps>
> = {
  camping: TentIcon,
  urban: BuildingsIcon,
  scenic: MountainPeakIcon,
  food: CoffeeCupIcon,
  fuel: FuelPumpIcon,
  hotel: BedIcon,
  oddity: EyeIcon,
};

export function CategoryIcon({
  category,
  ...props
}: IconProps & { category: CategoryIconName }) {
  const Component = ICON_BY_NAME[category];
  return <Component {...props} />;
}
