/** A single day's resolved weather. Same shape whether it came from a
 *  near-term forecast or a climatology fallback. `source` lets the UI
 *  label them differently ("Forecast" vs "Avg"). */
export type WeatherSnapshot = {
  /** ISO timestamp of when this was fetched. */
  fetchedAt: string;
  /** "forecast" = real OpenMeteo forecast (≤16 days out).
   *  "average" = past-year same-date from the Archive API as a climatology proxy. */
  source: "forecast" | "average";
  /** Daily values. Always a single day — keyed for trip-day rendering. */
  daily: {
    date: string;
    highF: number;
    lowF: number;
    /** Human-readable WMO-code summary (e.g. "Clear", "Light rain"). */
    sky: string;
    /** Max precip probability for the day (0–100). Only set when source = "forecast". */
    precipChance?: number;
    /** Max wind speed in knots (forecast only). */
    windKt?: number;
    /** Dominant wind direction in degrees (forecast only). */
    windDir?: number;
  };
};
