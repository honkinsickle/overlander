import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Navigation,
  RotateCcw,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import type { DirectionStep } from "./use-leg-directions";

/** Pick a Lucide icon for a Mapbox maneuver. Maneuver `type` carries
 *  the broad kind (turn / merge / roundabout / depart / arrive…) and
 *  `modifier` carries the direction (left / right / slight left / …).
 *  Uncommon combos fall back to a generic up arrow. */
export function maneuverIcon(step: DirectionStep): LucideIcon {
  const { type, modifier } = step;

  if (type === "depart") return Navigation;
  if (type === "arrive") return Flag;
  if (
    type === "roundabout" ||
    type === "rotary" ||
    type === "roundabout turn" ||
    type === "exit roundabout" ||
    type === "exit rotary"
  ) {
    return RotateCw;
  }
  if (modifier === "uturn") return RotateCcw;

  if (modifier === "left" || modifier === "sharp left") return CornerUpLeft;
  if (modifier === "right" || modifier === "sharp right") return CornerUpRight;
  if (modifier === "slight left") return ArrowUpLeft;
  if (modifier === "slight right") return ArrowUpRight;

  return ArrowUp;
}

/** Distance display: "0.3 mi", "1.4 mi", "0 ft" for very short. */
export function formatStepDistance(meters: number): string {
  const mi = meters / 1609.344;
  if (mi < 0.1) {
    const ft = Math.round(meters * 3.28084);
    return `${ft} ft`;
  }
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/** Total duration display: "1h 25m" or "12m". */
export function formatLegDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
