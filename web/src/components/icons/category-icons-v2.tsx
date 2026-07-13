import * as React from "react";

// Browse Location Card v2 icons. Paper-aligned: paths and fills copied
// from Paper artboard "Location Card · 354w · category variants (v2)"
// (page "Browse Slide In"). Each icon renders at 22×22 viewBox, multi-
// color fills (flat 2-color iOS-emoji feel), sized to sit centered in
// the 36×36 badge frame.
//
// Drop-shadow filter (0 2px 3px rgba(0,0,0,0.27)) is applied here so
// callers don't need to know — matches the Paper composition.

type IconProps = Omit<React.SVGProps<SVGSVGElement>, "viewBox" | "fill"> & {
  size?: number;
};

const SHADOW = "drop-shadow(0 2px 3px rgba(0,0,0,0.27))";

function svgProps(size: number, rest: Omit<IconProps, "size">) {
  const { style, ...others } = rest;
  return {
    width: size,
    height: size,
    viewBox: "0 0 22 22",
    xmlns: "http://www.w3.org/2000/svg",
    style: { filter: SHADOW, flexShrink: 0, ...style },
    ...others,
  };
}

export function CampingIconV2({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M11 4L3 18h16z" fill="#D4B66E" />
      <path d="M11 9l2.5 9h-5z" fill="#1F1A0A" />
      <path d="M2 18h18v1H2z" fill="#5C3A20" />
      <path d="M10.7 1.5h0.6v3h-0.6z" fill="#1F1A0A" />
      <path d="M11 1l4 1l-4 1.5z" fill="#C24837" />
    </svg>
  );
}

export function UrbanIconV2({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M3 5h6v14H3z" fill="#F2D77A" />
      <path d="M11 9h8v10h-8z" fill="#C99837" />
      <path
        d="M4.5 7.5h1.8v1.8H4.5zM6.5 7.5h1.8v1.8H6.5zM4.5 11h1.8v1.8H4.5zM6.5 11h1.8v1.8H6.5zM12.5 11.5h2v2h-2zM15 11.5h2v2h-2zM12.5 14.5h2v2h-2zM15 14.5h2v2h-2z"
        fill="#1A1408"
      />
      <path d="M5.7 2h0.6v3h-0.6z" fill="#1A1408" />
      <path d="M6 1.5l3 1L6 4z" fill="#C24837" />
    </svg>
  );
}

export function ScenicIconV2({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M13 9l8 10H5z" fill="#5C8474" />
      <path d="M8 5L1 19h14z" fill="#7AA38C" />
      <path d="M8 5l3 6H5z" fill="#E8F2EA" />
      <circle cx="17.5" cy="5" r="2.3" fill="#F5C04F" />
    </svg>
  );
}

export function FoodIconV2({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, rest)}>
      <path
        d="M2 15.5h18v1.5q0 2 -2 2H4q-2 0 -2 -2z"
        fill="#D6905A"
      />
      <path
        d="M2 14.5h18v1q-2 1.5 -4 0q-2 1.5 -4 0q-2 1.5 -4 0q-2 1.5 -4 0z"
        fill="#7DB35D"
      />
      <path d="M2 12.5h18v2H2z" fill="#5C3520" />
      <path
        d="M2 11h18v1.5l-3 0.5l-3 -0.5l-3 0.5l-3 -0.5l-3 0.5l-3 -0.5z"
        fill="#F4C95D"
      />
      <path d="M2 11q0 -7 9 -7q9 0 9 7z" fill="#E5A85A" />
      <ellipse cx="7" cy="8" rx="0.7" ry="0.5" fill="#F5E4B5" />
      <ellipse cx="11" cy="6.5" rx="0.7" ry="0.5" fill="#F5E4B5" />
      <ellipse cx="15" cy="8" rx="0.7" ry="0.5" fill="#F5E4B5" />
    </svg>
  );
}

// Red retro gas pump — SVG rendering of the Paper PNG asset
// (places/01KS115YY3D8QD2CNX334QWKX7.png). Filled shapes only; no
// stroke. Red body + cream display + red hose.
export function FuelIconV2({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M3 5q0 -1.5 1.5 -1.5h6q1.5 0 1.5 1.5v15H3z" fill="#C84A3E" />
      <path d="M3 19.5h9v1.5H3z" fill="#7A2A1F" />
      <rect x="4" y="6" width="7" height="3.5" rx="0.4" fill="#F4DB8E" />
      <rect x="4.5" y="7.5" width="6" height="0.8" fill="#3A1410" />
      <path d="M12 8q3 0 3 3v7q0 1.5 -1.5 1.5q-1.5 0 -1.5 -1.5v-5q0 -1.5 -1.5 -1.5z" fill="#A93A2E" />
      <rect x="13" y="13.5" width="2" height="4" rx="0.3" fill="#5C1F18" />
    </svg>
  );
}

export function HotelIconV2({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, rest)}>
      <rect x="4" y="9" width="5" height="2" fill="#DDDDDD" />
      <rect x="4" y="15" width="14" height="2" rx="0.3" fill="#8B5E34" />
      <rect x="4" y="14" width="6" height="1" rx="0.3" fill="#8B5E34" />
      <rect x="4" y="11" width="6" height="3" fill="#C2D4E5" />
      <rect x="2" y="5" width="2" height="13" rx="0.3" fill="#8B5E34" />
      <rect x="18" y="9" width="2" height="9" rx="0.3" fill="#8B5E34" />
      <rect x="11" y="11" width="7" height="4" rx="0.3" fill="#92BDE3" />
      <rect x="10" y="14" width="1" height="1" rx="0.3" fill="#8B5E34" />
      <rect x="10" y="11" width="1" height="4" fill="#79A7D0" />
    </svg>
  );
}

export function OddityIconV2({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, rest)}>
      <path
        d="M1.5 11q4.5 -6 9.5 -6q5 0 9.5 6q-4.5 6 -9.5 6q-5 0 -9.5 -6z"
        fill="#E8D8F4"
      />
      <circle cx="11" cy="11" r="3.7" fill="#5E3A8E" />
      <circle cx="11" cy="11" r="1.6" fill="#1A1028" />
      <circle cx="9.5" cy="9.7" r="0.9" fill="#FFE4A0" />
    </svg>
  );
}

// attraction + interest are not yet in the Paper artboard — simple 2-color
// stand-ins (gold star / red pin) matching the detail-card lucide intent
// (Star / MapPin). Replace with Paper-sourced art when available.
export function AttractionIconV2({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, rest)}>
      <polygon
        points="11 2 13.2 8 19.5 8.2 14.6 12 16.4 18 11 14.4 5.6 18 7.4 12 2.5 8.2 8.8 8"
        fill="#E6B422"
      />
      <polygon
        points="11 5.2 12.3 8.7 16 9 13.1 11.3 14 15 11 12.9 8 15 8.9 11.3 6 9 9.7 8.7"
        fill="#FFD966"
      />
    </svg>
  );
}

// Generic "point of interest" default — the fallback for any place whose
// Google types the mapper doesn't cover. A clean warm-sand DIAMOND waypoint
// (not the old red MapPin placeholder, not the gold attraction star), so an
// unmapped type reads as an intentional generic stop, never a broken pin.
export function InterestIconV2({ size = 22, ...rest }: IconProps) {
  return (
    <svg {...svgProps(size, rest)}>
      <path d="M11 3l7.6 8-7.6 8-7.6-8z" fill="#CBBE9C" />
      <path d="M11 6.4l4.4 4.6-4.4 4.6-4.4-4.6z" fill="#3A3324" />
      <circle cx="11" cy="11" r="2" fill="#CBBE9C" />
    </svg>
  );
}

export type CategoryIconV2Name =
  | "camping"
  | "urban"
  | "scenic"
  | "food"
  | "fuel"
  | "hotel"
  | "oddity"
  | "attraction"
  | "interest";

const ICON_BY_NAME: Record<
  CategoryIconV2Name,
  React.ComponentType<IconProps>
> = {
  camping: CampingIconV2,
  urban: UrbanIconV2,
  scenic: ScenicIconV2,
  food: FoodIconV2,
  fuel: FuelIconV2,
  hotel: HotelIconV2,
  oddity: OddityIconV2,
  attraction: AttractionIconV2,
  interest: InterestIconV2,
};

export function CategoryIconV2({
  category,
  ...props
}: IconProps & { category: CategoryIconV2Name }) {
  const Component = ICON_BY_NAME[category];
  return <Component {...props} />;
}
