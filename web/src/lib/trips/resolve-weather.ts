import type { Trip } from "./types";
import { fetchWeatherForDay } from "@/lib/weather/openmeteo";

const WEATHER_CONCURRENCY = 6;

/** Bounded concurrency over `items`. Mirrors the pool() helpers in
 *  resolve-overnights / resolve-suggestions. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/** For each day with coords + a date, fetch a `WeatherSnapshot`. Days
 *  within OpenMeteo's 16-day forecast window get a real forecast; days
 *  beyond get last-year same-date climatology as a "Avg" fallback so
 *  the briefing card always has something to show.
 *
 *  Server-side. Cost is paid once per server start (cached with the
 *  trip via `getAlaskaTrip`'s `parsed.version` key). */
export async function resolveWeather(trip: Trip): Promise<Trip> {
  const days = await pool(trip.days, WEATHER_CONCURRENCY, async (day) => {
    if (!day.coords || !day.date || day.forecast) return day;
    const [lng, lat] = day.coords;
    const snapshot = await fetchWeatherForDay(lat, lng, day.date);
    if (!snapshot) return day;
    return { ...day, forecast: snapshot };
  });
  return { ...trip, days };
}
