import type { Category } from "@/components/primitives/detail-card";
import type { Day, Trip, Waypoint } from "./types";

/**
 * Backfill the detail-panel fields on a Waypoint deterministically from
 * its existing shape + day context. Lets `alaska.ts` author the skinny
 * 8-field shape and have the rich detail panel render real, varied
 * (but plausibly-invented) metadata across all 82 days.
 *
 * Already-set fields on the input waypoint are preserved — manual
 * overrides for hero waypoints (Dalton, Tok, etc.) take priority.
 */

// These maps are keyed by the full canonical `Category`. The `hotel` entries
// exist only to satisfy the exhaustive `Record<Category>` — `hotel` is a
// browse-chip-only category; no `Waypoint.category` is ever `hotel`, so these
// `hotel` values are never reached by `enrichWaypoint`.
const TAGS_BY_CATEGORY: Record<Category, string[][]> = {
  scenic: [
    ["National Park", "Scenic Vista", "Hiking"],
    ["Wilderness", "Photography", "Day Hike"],
    ["Backcountry", "Alpine", "Lookout"],
  ],
  attraction: [
    ["Landmark", "Family-friendly", "Quick Stop"],
    ["Historic", "Photo Op", "Walkable"],
    ["Cultural", "Visitor Center", "Self-guided"],
  ],
  food: [
    ["Local Eats", "Sit-down", "Cash OK"],
    ["Quick Bite", "Coffee", "Vegetarian"],
    ["Roadside", "Breakfast", "Cash Only"],
  ],
  fuel: [
    ["Diesel", "24 hr", "Card-at-pump"],
    ["Gas", "Convenience", "Restrooms"],
    ["Last fuel", "Diesel", "Snacks"],
  ],
  camping: [
    ["Dispersed", "Pit toilets", "Free"],
    ["Established", "Reservable", "Showers"],
    ["BLM", "First-come", "Tent + RV"],
  ],
  oddity: [
    ["Roadside", "Quirky", "Quick Stop"],
    ["Photo Op", "Free", "Self-guided"],
    ["Hidden Gem", "Off Route", "Worth It"],
  ],
  urban: [
    ["Walkable", "Cafés", "Shops"],
    ["Downtown", "Galleries", "Pedestrian"],
    ["Local", "Eats", "Lodging"],
  ],
  interest: [
    ["Quick Stop", "Restrooms", "Walk-around"],
    ["Pull-off", "Photo Op", "Free"],
  ],
  hotel: [
    ["Lodging", "Front desk", "Parking"],
    ["Pet-friendly", "Wifi", "Breakfast"],
  ],
};

const FACTUAL_LABEL_BY_CATEGORY: Record<Category, string> = {
  scenic: "Geology Notes",
  attraction: "History",
  food: "House Notes",
  fuel: "Station Notes",
  camping: "Site Notes",
  oddity: "Backstory",
  urban: "Neighborhood",
  interest: "Local Notes",
  hotel: "Property Notes",
};

const FACTUAL_TEMPLATES: Record<Category, string[]> = {
  scenic: [
    "Glacial geology dating to the last ice age — moraines, kettle ponds, and erratic boulders define the landscape. Public-land status protects the visible terrain from new development.",
    "Volcanic origin from successive flow events. The exposed rock is mostly basalt with intrusions of rhyolite where the cooling was slower. Most accessible features are on a designated trail.",
    "Carved by retreating ice ~10,000 years ago. The U-shaped valley and polished bedrock are signatures of glacial action. Local interpretive signage covers the formation timeline.",
  ],
  attraction: [
    "Listed on the National Register of Historic Places. Visitor center has rotating exhibits + a short orientation film; the main grounds are self-guided with interpretive panels.",
    "Originally a 19th-century private holding, transferred to public stewardship in the 1970s. The site sees moderate visitation in summer, light otherwise.",
    "Designated a state landmark in the early 20th century. Hours are seasonal — winter access is limited to the parking lot and outer trails.",
  ],
  food: [
    "Family-run since the 1980s. Menu rotates with what's local — check the chalkboard. Cash-friendly but cards accepted with a small fee.",
    "Counter-order spot with limited indoor seating. Bigger groups should grab takeout and find a table outside or down by the water.",
    "Long-running roadhouse. The dining room is small but the porch holds a crowd. Reservations not taken; arrive early on weekends.",
  ],
  fuel: [
    "Card-at-pump 24 hours; the convenience store keeps daytime hours. Diesel is on the back row of pumps — RV access is straightforward.",
    "One of the few stops in the area open year-round. Worth topping off here even if you're not running low — the next station is a stretch.",
    "Independent station with hand-pumped diesel as backup. Prices are high but reliable; the owners are usually around to chat.",
  ],
  camping: [
    "First-come, first-served. Sites are well-spaced with natural buffers. Bring water — the spigot only runs in peak season.",
    "Reservable through the federal portal up to 6 months out. Sites accommodate both tents and RVs up to 35 ft. Quiet hours strictly enforced.",
    "Dispersed area on public land — find your own pull-off. No services. Pack out everything; fire restrictions vary by season.",
  ],
  oddity: [
    "Built by a local enthusiast over a span of decades. Materials are mostly salvaged. The site is unstaffed — donations encouraged via the box.",
    "A roadside curiosity that predates the modern highway. Maintained on and off by local volunteers; expect rough edges and questionable signage.",
    "Started as a private collection, opened to the public in the 1990s. Free to visit; the gift shop keeps irregular hours.",
  ],
  urban: [
    "Walkable downtown core with a mix of independent shops, cafés, and small galleries. Most spots are within a 5-block radius of the main intersection.",
    "Recently revitalized historic district. Streets are pedestrian-friendly; parking is metered on weekdays and free on Sundays.",
    "Lively neighborhood that anchors the wider area. Best explored on foot — the side streets hold most of the character.",
  ],
  interest: [
    "Marked pull-off with picnic tables and basic information panels. No services beyond a vault toilet.",
    "Open year-round. Maintained by the local highway department; expect minimal facilities but reliable access.",
  ],
  hotel: [
    "Roadside property with straightforward check-in. Rooms are basic but clean; parking is free and RV-friendly.",
    "Independently run lodging open year-round. Front desk keeps daytime hours; after-hours arrivals should call ahead.",
  ],
};

const AMENITIES_BY_CATEGORY: Record<Category, string[][]> = {
  scenic: [
    ["Hiking trails", "Visitor center", "Restrooms"],
    ["Backcountry permits", "Photo overlooks", "Picnic area"],
    ["Trailhead parking", "Pit toilets", "Bear-safe storage"],
  ],
  attraction: [
    ["Visitor center", "Gift shop", "Restrooms"],
    ["Guided tours", "Picnic area", "Wheelchair accessible"],
    ["Self-guided", "Free parking", "Restrooms"],
  ],
  food: [
    ["Dine in", "Takeout", "Outdoor seating"],
    ["Vegetarian options", "Coffee", "Wifi"],
    ["Counter service", "Beer & wine", "Cash discount"],
  ],
  fuel: [
    ["Diesel", "Restrooms", "Convenience store"],
    ["Card-at-pump", "Air & water", "Coffee"],
    ["Propane", "ATM", "Truck parking"],
  ],
  camping: [
    ["Pit toilets", "Picnic tables", "Fire rings"],
    ["Showers", "Potable water", "Reservable"],
    ["Tent + RV", "Bear box", "Pet-friendly"],
  ],
  oddity: [
    ["Free entry", "Photo op", "Restrooms"],
    ["Self-guided", "Gift shop", "Picnic table"],
    ["Donation-based", "Pet-friendly", "Quick stop"],
  ],
  urban: [
    ["Walkable", "Restrooms", "Cafés"],
    ["Public parking", "Galleries", "Restaurants"],
    ["Wifi", "ATM", "Lodging"],
  ],
  interest: [
    ["Restrooms", "Picnic table", "Free parking"],
  ],
  hotel: [
    ["Free parking", "Wifi", "Pet-friendly"],
    ["Breakfast", "Laundry", "Restrooms"],
  ],
};

const DATA_SOURCES_BY_CATEGORY: Record<Category, string[][]> = {
  scenic: [
    ["NPS.gov", "AllTrails", "OSM"],
    ["USGS", "AllTrails", "OSM"],
    ["BLM.gov", "Gaia GPS", "OSM"],
  ],
  attraction: [
    ["NRHP", "TripAdvisor", "OSM"],
    ["State Parks", "Atlas Obscura", "OSM"],
    ["Local tourism", "OSM", "Wikipedia"],
  ],
  food: [
    ["Yelp", "Google", "OSM"],
    ["Eater", "Google", "Instagram"],
    ["Roadfood", "Google", "OSM"],
  ],
  fuel: [
    ["GasBuddy", "OSM", "iOverlander"],
    ["Trucker Path", "OSM", "Google"],
  ],
  camping: [
    ["Recreation.gov", "Campendium", "OSM"],
    ["FreeCampsites", "iOverlander", "OSM"],
    ["BLM.gov", "The Dyrt", "OSM"],
  ],
  oddity: [
    ["Atlas Obscura", "Roadside America", "OSM"],
    ["Atlas Obscura", "OSM", "Wikipedia"],
  ],
  urban: [
    ["TripAdvisor", "Google", "OSM"],
    ["Local tourism", "OSM", "Wikipedia"],
  ],
  interest: [
    ["OSM", "Google", "Wikipedia"],
  ],
  hotel: [
    ["Booking.com", "Google", "OSM"],
  ],
};

const TIPS_BY_CATEGORY: Record<Category, string[][]> = {
  scenic: [
    [
      "Best light is the first two hours after sunrise — golden side-lighting on the peaks.",
      "Trail conditions change quickly; check the visitor center board before committing.",
    ],
    [
      "Carry layers — temperature drops 10–15°F at the overlook compared to the trailhead.",
      "Cell coverage drops out past the parking lot. Download maps offline.",
    ],
  ],
  attraction: [
    [
      "Arrive in the first hour of opening to beat the tour buses.",
      "The interpretive film is worth 15 minutes — context matters here.",
    ],
    [
      "Photography is allowed but no flash inside the main building.",
      "Plan ~90 minutes for a thorough visit; less if you skip the exhibits.",
    ],
  ],
  food: [
    [
      "Specials change daily — ask, don't rely on the menu posted online.",
      "Save room — the dessert is the move.",
    ],
    [
      "Lunch rush is 12:00–1:30. Aim for 11:30 or 1:45.",
      "Cash gets a small discount; card adds a couple percent.",
    ],
  ],
  fuel: [
    [
      "Diesel pumps are around back — don't queue with the gas-only crowd.",
      "Coffee is surprisingly good. Restrooms are clean.",
    ],
    [
      "Top off here — next reliable diesel is 200+ miles north.",
      "ATM inside; cash discount on fuel some days.",
    ],
  ],
  camping: [
    [
      "Sites along the back loop are quieter and tend to have better tree cover.",
      "Pack out everything, including grey water — the area is fragile.",
    ],
    [
      "Reserve early in summer — fills up Memorial Day through Labor Day.",
      "Bear box at every site; use it religiously.",
    ],
  ],
  oddity: [
    [
      "Worth the detour even if you're skeptical.",
      "Bring small bills for the donation box — they're not set up for cards.",
    ],
  ],
  urban: [
    [
      "Park on the edge and walk in — the center is cramped.",
      "Sundays are quieter; weekday afternoons hum.",
    ],
  ],
  interest: [
    [
      "Quick stretch break — 10 minutes is plenty.",
    ],
  ],
  hotel: [
    [
      "Call ahead for after-hours check-in.",
      "Ask for a room off the road for a quieter night.",
    ],
  ],
};

const HOURS_BY_CATEGORY: Record<Category, string[]> = {
  scenic: ["Daily · sunrise to sunset", "24 hours · self-access"],
  attraction: ["Daily · 9am – 5pm", "Wed–Sun · 10am – 6pm"],
  food: ["Daily · 7am – 9pm", "Tue–Sun · 11am – 8pm"],
  fuel: ["24 hours · card-at-pump", "Daily · 6am – 11pm"],
  camping: ["Open year-round", "May – Oct · season"],
  oddity: ["Daily · daylight only", "Sat–Sun · 10am – 4pm"],
  urban: ["Varies by venue"],
  interest: ["Open year-round"],
  hotel: ["Front desk · 24 hours", "Check-in 3pm · check-out 11am"],
};

const ENTRY_BY_CATEGORY: Record<Category, string[]> = {
  scenic: ["$30 / vehicle · 7-day pass", "$15 / person", "Free"],
  attraction: ["$12 / adult", "$8 / vehicle", "Free entry · donations"],
  food: ["Cash + card · ~$15–25 entrée"],
  fuel: ["Pump price · varies"],
  camping: ["$25 / night", "Free · 14-day stay limit", "$15 / night"],
  oddity: ["Free · donation box"],
  urban: ["Free to enter"],
  interest: ["Free"],
  hotel: ["$90–140 / night", "Varies by season"],
};

/** Stable hash → number in [0, max). Lets us seed enrichment per-slug
 *  so the same waypoint gets the same enrichment across renders. */
function hash(s: string, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h % max;
}

function pick<T>(arr: T[], slug: string, salt = ""): T {
  return arr[hash(slug + salt, arr.length)];
}

/** "8:43pm" + minutes → "9:08 PM" (clamps to 24h, rolls over noon).
 *  Output is always uppercase with a space, matching the canonical
 *  Paper copy format. */
function addMinutesToTimeString(time: string, minutes: number): string {
  const m = time.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return time;
  let hr = parseInt(m[1], 10) % 12;
  const min = parseInt(m[2], 10);
  const isPm = m[3].toLowerCase() === "pm";
  if (isPm) hr += 12;
  let total = hr * 60 + min + minutes;
  total = ((total % 1440) + 1440) % 1440;
  const newHr24 = Math.floor(total / 60);
  const newMin = total % 60;
  const newIsPm = newHr24 >= 12;
  let newHr12 = newHr24 % 12;
  if (newHr12 === 0) newHr12 = 12;
  return `${newHr12}:${String(newMin).padStart(2, "0")} ${newIsPm ? "PM" : "AM"}`;
}

/** Normalize a time string to display format ("8:15am" → "8:15 AM"). */
function formatTimeDisplay(time: string): string {
  return addMinutesToTimeString(time, 0);
}

/** Parse "+22 mi" → 22, "~1 hr" → 60 (mins), "~30 min" → 30, "11:20am" → "11:20am".
 *  Order matters: check `min` and `hr` BEFORE `mi`, since "min" contains "mi". */
function parseStat(value: string): { kind: "miles" | "minutes" | "time" | "other"; n: number; raw: string } {
  const min = value.match(/([\d.]+)\s*min/i);
  if (min) return { kind: "minutes", n: parseInt(min[1], 10), raw: value };
  const hr = value.match(/([\d.]+)\s*hr?\b/i);
  if (hr) return { kind: "minutes", n: Math.round(parseFloat(hr[1]) * 60), raw: value };
  const mi = value.match(/([\d.]+)\s*mi\b/i);
  if (mi) return { kind: "miles", n: parseFloat(mi[1]), raw: value };
  if (/^\d{1,2}:\d{2}(am|pm)$/i.test(value)) return { kind: "time", n: 0, raw: value };
  return { kind: "other", n: 0, raw: value };
}

function statValue(wp: Waypoint, label: string): string | null {
  const s = wp.stats.find(
    (x) => x.label.toUpperCase() === label.toUpperCase(),
  );
  return s ? s.value : null;
}

/** Format minutes → "1h28m" / "45m" / "2h". */
function formatMinutes(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}m`;
}

/** Sunset estimate by month for the latitudes the trip covers. Rough
 *  but plausible — real solar tables aren't worth the dependency. */
function sunsetEstimate(date: string, lat: number): string {
  const month = parseInt(date.slice(5, 7), 10);
  const baseByMonth = [16.83, 17.5, 18.5, 19.83, 20.5, 21.0, 20.83, 20.0, 19.0, 18.0, 17.0, 16.67];
  const base = baseByMonth[month - 1];
  // Latitude adjustment: north of 60° in summer the sun barely sets.
  const latShift = lat > 60 && month >= 5 && month <= 8 ? 1.5 : 0;
  const total = base + latShift;
  const hr24 = Math.floor(total);
  const minutes = Math.round((total - hr24) * 60);
  const hr12 = hr24 % 12 || 12;
  const isPm = hr24 >= 12;
  return `${hr12}:${String(minutes).padStart(2, "0")} ${isPm ? "PM" : "AM"}`;
}

/** Pick the next day's anchor city from its label ("Bend, OR — Boise, ID" → "Boise"). */
function destinationFromDayLabel(label: string): string {
  const parts = label.split("—").map((s) => s.trim());
  const last = parts[parts.length - 1] ?? label;
  return last.split(",")[0].trim();
}

export function enrichWaypoint(
  wp: Waypoint,
  day: Day,
  trip: Trip,
): Waypoint {
  const slug = wp.slug;
  const cat = wp.category;

  const stopMinFromStats = (() => {
    const v = statValue(wp, "STOP TIME");
    if (!v) return null;
    return parseStat(v).n || null;
  })();

  const detourMi = (() => {
    const v = statValue(wp, "DETOUR");
    if (!v) return null;
    return parseStat(v).n || 0;
  })();

  const etaFromStats = statValue(wp, "ETA");

  const stopTimeStr = stopMinFromStats != null
    ? formatMinutes(stopMinFromStats)
    : pick(["~30m", "~45m", "1h", "1h30m"], slug);

  const stopMinForSim = stopMinFromStats ?? 45;
  const detourBufferMin = detourMi != null ? Math.round(detourMi * 1.5) : 0;
  const addsMin = stopMinForSim + detourBufferMin;

  const dayDestination = destinationFromDayLabel(day.label);
  const lat = day.coords?.[1] ?? trip.startCoords?.[1] ?? 45;
  const sunset = sunsetEstimate(day.date, lat);
  const plannedEta = etaFromStats ?? pick(["6:30pm", "7:15pm", "8:00pm", "5:45pm"], slug, "planned");
  const withStopEta = etaFromStats
    ? addMinutesToTimeString(etaFromStats, addsMin)
    : addMinutesToTimeString(plannedEta, addsMin);

  const dayCount = trip.days.length;
  const unaffected = day.dayNumber + 1 <= dayCount
    ? `Day ${day.dayNumber + 1} unaffected`
    : undefined;

  return {
    ...wp,
    photoUrl: wp.photoUrl,
    tags: wp.tags ?? pick(TAGS_BY_CATEGORY[cat], slug, "tags"),
    reliability: wp.reliability ?? {
      score: 75 + hash(slug + "rel", 21),
      label: hash(slug, 100) > 30 ? "Good reliability" : "High reliability",
      sourceCount: 2 + hash(slug + "src", 3),
    },
    routeOffsetMi: wp.routeOffsetMi ?? (detourMi != null ? Math.max(detourMi, 0.1) : (hash(slug + "off", 30) + 1) / 10),
    simulator: wp.simulator ?? {
      stopTime: stopTimeStr,
      entryCost: pick(ENTRY_BY_CATEGORY[cat], slug, "entry"),
      addsTime: formatMinutes(addsMin),
      newEtaPlace: dayDestination,
      plannedEta: formatTimeDisplay(plannedEta),
      withStopEta,
      sunset,
      unaffectedNote: unaffected,
    },
    factualNote: wp.factualNote ?? {
      label: FACTUAL_LABEL_BY_CATEGORY[cat],
      text: pick(FACTUAL_TEMPLATES[cat], slug, "factual"),
    },
    logistics: wp.logistics ?? {
      hours: pick(HOURS_BY_CATEGORY[cat], slug, "hours"),
      entry: pick(ENTRY_BY_CATEGORY[cat], slug, "entry"),
      phone: cat === "fuel" || cat === "interest"
        ? undefined
        : `(${200 + hash(slug + "p1", 700)}) ${100 + hash(slug + "p2", 900)}-${1000 + hash(slug + "p3", 9000)}`,
      website: cat === "interest"
        ? undefined
        : `${slug.replace(/-/g, "")}.com`.slice(0, 28),
    },
    community: wp.community ?? {
      rating: 3.8 + hash(slug + "rating", 12) * 0.1, // 3.8 – 4.9
      reviewCount: 80 + hash(slug + "rev", 2400),
      tips: pick(TIPS_BY_CATEGORY[cat], slug, "tips"),
      lastVerified: pick(
        ["Apr 2026", "Mar 2026", "Feb 2026", "Live", "live"],
        slug,
        "verified",
      ),
    },
    amenities: wp.amenities ?? pick(AMENITIES_BY_CATEGORY[cat], slug, "amen"),
    dataSources: wp.dataSources ?? pick(DATA_SOURCES_BY_CATEGORY[cat], slug, "ds"),
  };
}

export function enrichTrip(trip: Trip): Trip {
  return {
    ...trip,
    days: trip.days.map((day) => ({
      ...day,
      waypoints: day.waypoints.map((wp) => enrichWaypoint(wp, day, trip)),
    })),
  };
}
