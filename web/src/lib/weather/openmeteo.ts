import type { WeatherSnapshot } from "./types";

/** WMO weather-interpretation codes mapped to short human strings.
 *  https://open-meteo.com/en/docs#weathervariables */
const WMO_CODES: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Showers",
  81: "Heavy showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Hail storms",
  99: "Heavy hail storms",
};

const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_BASE = "https://archive-api.open-meteo.com/v1/archive";

/** Days OpenMeteo's forecast endpoint reliably covers. */
const FORECAST_MAX_DAYS = 16;

/** Real-time forecast for a single date. Returns null if the date is
 *  outside the forecast window or the API fails. */
async function fetchForecast(
  lat: number,
  lng: number,
  date: string,
): Promise<WeatherSnapshot | null> {
  const url = new URL(FORECAST_BASE);
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant",
  );
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "kn");
  url.searchParams.set("timezone", "auto");

  try {
    // Cache forecast for 6h on the server. Same coords + same date hits
    // cache; lat/lng/date all participate in the cache key via the URL.
    const res = await fetch(url, { next: { revalidate: 21600 } });
    if (!res.ok) return null;
    const json = await res.json();
    const d = json?.daily;
    if (!d || !Array.isArray(d.time) || d.time.length === 0) return null;
    return {
      fetchedAt: new Date().toISOString(),
      source: "forecast",
      daily: {
        date,
        highF: Math.round(d.temperature_2m_max[0]),
        lowF: Math.round(d.temperature_2m_min[0]),
        sky: WMO_CODES[d.weather_code[0]] ?? "—",
        precipChance: d.precipitation_probability_max?.[0] ?? undefined,
        windKt: d.wind_speed_10m_max?.[0]
          ? Math.round(d.wind_speed_10m_max[0])
          : undefined,
        windDir: d.wind_direction_10m_dominant?.[0] ?? undefined,
      },
    };
  } catch {
    return null;
  }
}

/** Climatology proxy: pull last year's same date from the Archive API.
 *  Single-year sample (not a multi-year average) for simplicity and
 *  speed. Returns null on failure. */
async function fetchClimatology(
  lat: number,
  lng: number,
  date: string,
): Promise<WeatherSnapshot | null> {
  // Use last year's same date — e.g. for 2026-06-11, pull 2025-06-11.
  // The Archive API has a ~5-day lag so this is always available.
  const yearAgo = `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  const url = new URL(ARCHIVE_BASE);
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,weather_code",
  );
  url.searchParams.set("start_date", yearAgo);
  url.searchParams.set("end_date", yearAgo);
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "auto");

  try {
    // Climatology rarely changes — cache for 7 days.
    const res = await fetch(url, { next: { revalidate: 604800 } });
    if (!res.ok) return null;
    const json = await res.json();
    const d = json?.daily;
    if (!d || !Array.isArray(d.time) || d.time.length === 0) return null;
    const hi = d.temperature_2m_max[0];
    const lo = d.temperature_2m_min[0];
    if (hi == null || lo == null) return null;
    return {
      fetchedAt: new Date().toISOString(),
      source: "average",
      daily: {
        date,
        highF: Math.round(hi),
        lowF: Math.round(lo),
        sky: WMO_CODES[d.weather_code[0]] ?? "—",
      },
    };
  } catch {
    return null;
  }
}

/** Try forecast first; fall back to climatology if the date is beyond
 *  the forecast window or the call fails. Returns null only when both
 *  endpoints fail or the coords are unusable. */
export async function fetchWeatherForDay(
  lat: number,
  lng: number,
  date: string,
): Promise<WeatherSnapshot | null> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  const daysOut = Math.ceil(
    (target.getTime() - today.getTime()) / 86_400_000,
  );

  if (daysOut >= 0 && daysOut <= FORECAST_MAX_DAYS) {
    const forecast = await fetchForecast(lat, lng, date);
    if (forecast) return forecast;
  }
  return fetchClimatology(lat, lng, date);
}
