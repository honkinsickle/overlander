"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";

/**
 * Location input with Mapbox geocoding autocomplete. Debounces queries
 * to the Mapbox Geocoding v6 forward endpoint, shows a dropdown of
 * suggestions, and lets the user pick. On pick, fills the visible
 * input with the formatted address and emits hidden `${name}Lat` and
 * `${name}Lng` fields with coordinates from Mapbox — so the wizard's
 * finalize action can skip a geocode call and resolve to the exact
 * place the user picked, not whatever Mapbox guesses on submit.
 *
 * Token: NEXT_PUBLIC_MAPBOX_TOKEN (already exposed for map rendering).
 *
 * Falls back to plain freeform behavior if the user types but doesn't
 * pick a suggestion — finalize will geocode the label as before.
 */

type Suggestion = {
  /** What gets written into the visible input on pick, and what
   *  finalize persists as the location's label. For city-type
   *  features this is just the place name (e.g. "Santa Rosa") — the
   *  state/country context is shown separately in the dropdown but
   *  excluded from the label so trip titles stay readable. */
  label: string;
  /** Primary label shown in each listbox row (Mapbox's `name`). */
  primary: string;
  /** Place context shown as the dim secondary label in each listbox
   *  row (Mapbox's `place_formatted` — typically "<State>, <Country>"
   *  for city features). */
  secondary: string;
  /** `[lng, lat]`. */
  coords: [number, number];
};

export function LocationAutocomplete({
  name,
  placeholder,
  defaultValue,
  defaultLat,
  defaultLng,
  required,
}: {
  name: string;
  placeholder: string;
  defaultValue?: string;
  defaultLat?: number;
  defaultLng?: number;
  required?: boolean;
}) {
  const [text, setText] = useState(defaultValue ?? "");
  const [coords, setCoords] = useState<[number, number] | null>(
    defaultLat != null && defaultLng != null
      ? [defaultLng, defaultLat]
      : null,
  );
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  // Currently-highlighted suggestion index for keyboard navigation.
  // -1 = nothing highlighted (clean state on fresh fetch). Wraps on
  // top / bottom.
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Set to true right after a pick — suppresses the next text-change
  // effect so we don't immediately query for the just-picked label.
  const skipNextFetch = useRef(false);

  // Debounced geocoding fetch.
  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        // USA + Canada only, populated places (cities / towns / villages).
        // `types=place` excludes street addresses, neighborhoods, POIs,
        // and admin regions so the dropdown stays trip-relevant.
        const url =
          `https://api.mapbox.com/search/geocode/v6/forward` +
          `?q=${encodeURIComponent(trimmed)}` +
          `&country=us,ca` +
          `&types=place` +
          `&limit=5` +
          `&access_token=${token}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as MapboxGeocodingResponse;
        const next: Suggestion[] = (json.features ?? [])
          .map((f) => {
            const c = f.geometry?.coordinates;
            const primary = f.properties?.name ?? "";
            const secondary = f.properties?.place_formatted ?? "";
            // Pull a short region abbreviation (state for US, province
            // for Canada, etc.) to disambiguate at a glance — "Santa
            // Rosa, CA" beats just "Santa Rosa". Falls back to the
            // place name alone when context is missing.
            const region = f.properties?.context?.region;
            const regionCode = region?.region_code ?? region?.name ?? "";
            if (!c || c.length < 2 || !primary) return null;
            return {
              label: regionCode ? `${primary}, ${regionCode}` : primary,
              primary,
              secondary,
              coords: [c[0], c[1]] as [number, number],
            };
          })
          .filter((s): s is Suggestion => s !== null);
        setSuggestions(next);
        setOpen(next.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.warn("[autocomplete] geocoding failed", err);
      }
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [text]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  function pick(s: Suggestion) {
    skipNextFetch.current = true;
    setText(s.label);
    setCoords(s.coords);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setText(e.target.value);
    setActiveIndex(-1);
    // Clear stale coords when the user edits the text — otherwise
    // hidden fields would still hold the previous selection.
    if (coords) setCoords(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && suggestions.length > 0) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      if (suggestions.length === 0) return;
      setActiveIndex((i) => (i + 1) % suggestions.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setActiveIndex((i) =>
        i <= 0 ? suggestions.length - 1 : i - 1,
      );
      return;
    }
    if (e.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        pick(suggestions[activeIndex]);
      }
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  // Keep the highlighted row visible when navigating with arrows.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const item = listRef.current.querySelectorAll("li")[activeIndex];
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const listId = useId();
  const optionIdFor = (i: number) => `${listId}-opt-${i}`;

  return (
    <div ref={containerRef} className="relative">
      <MapPin
        aria-hidden
        className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted"
      />
      <input
        name={name}
        type="text"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={
          open && activeIndex >= 0 ? optionIdFor(activeIndex) : undefined
        }
        role="combobox"
        className="form-field w-full pl-10!"
      />
      <input
        type="hidden"
        name={`${name}Lng`}
        value={coords?.[0] ?? ""}
      />
      <input
        type="hidden"
        name={`${name}Lat`}
        value={coords?.[1] ?? ""}
      />
      {open && suggestions.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-bg-base border border-border-subtle rounded shadow-lg max-h-72 overflow-y-auto"
        >
          {suggestions.map((s, i) => {
            const isActive = i === activeIndex;
            return (
              <li key={`${s.primary}-${i}`} id={optionIdFor(i)}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  onMouseEnter={() => setActiveIndex(i)}
                  role="option"
                  aria-selected={isActive}
                  className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 ${
                    isActive
                      ? "bg-text-primary/10"
                      : "hover:bg-text-primary/10"
                  }`}
                >
                  <span className="text-sm text-text-primary">{s.primary}</span>
                  {s.secondary && (
                    <span className="text-xs text-text-muted">
                      {s.secondary}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type MapboxGeocodingResponse = {
  features?: {
    geometry?: { coordinates?: number[] };
    properties?: {
      name?: string;
      place_formatted?: string;
      context?: {
        region?: { name?: string; region_code?: string };
      };
    };
  }[];
};
