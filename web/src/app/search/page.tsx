"use client";

/**
 * Phase 2 search slice — thin query interface (spec §6 Option A).
 *
 * A minimal search page over the indexed JT corpus. Input is debounced
 * (200 ms) and proxies to the browser-safe `search()` helper in
 * `lib/search`, which hits Typesense via the scoped search-only key.
 *
 * Out of scope for this slice (per spec §10):
 *   - autocomplete-as-you-type dropdown
 *   - rich place cards (just text per row for now)
 *   - filtering UI (categories / overlander tags)
 *   - NL/LLM query understanding
 *   - route-aware ranking
 *   - "use my location" (geolocation API)
 *
 * Center is hard-coded to Joshua Tree (the spec's reference point); the
 * dropdown-driven scope selector is the next iteration after the slice
 * merges.
 */

import { useEffect, useRef, useState } from "react";
import { search, type SearchResult } from "@/lib/search";

const JT_CENTER = { lat: 33.92, lng: -115.97 } as const;
const DEBOUNCE_MS = 200;
const LIMIT = 20;

function formatDistanceKm(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function formatCoord(value: number): string {
  return value.toFixed(3);
}

export default function SearchPage(): React.ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setError(null);
      setElapsedMs(null);
      return;
    }
    const timer = setTimeout(() => {
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      const start = performance.now();
      search({ query: q, center: JT_CENTER, limit: LIMIT })
        .then((r) => {
          // Drop responses that arrive after a newer request was issued.
          if (reqId !== reqIdRef.current) return;
          setResults(r);
          setElapsedMs(performance.now() - start);
        })
        .catch((e: unknown) => {
          if (reqId !== reqIdRef.current) return;
          setError(e instanceof Error ? e.message : "search failed");
        })
        .finally(() => {
          if (reqId !== reqIdRef.current) return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        fontFamily: "var(--ff-sans)",
        padding: "48px 24px",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <p
            style={{
              fontFamily: "var(--ff-display)",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--amber)",
              marginBottom: 8,
            }}
          >
            Phase 2 search slice
          </p>
          <h1
            style={{
              fontFamily: "var(--ff-sans)",
              fontWeight: 700,
              fontSize: 28,
              lineHeight: "32px",
              margin: 0,
            }}
          >
            Federated POI search
          </h1>
          <p
            style={{
              marginTop: 8,
              fontSize: 14,
              color: "var(--text-muted)",
            }}
          >
            Indexed corpus: Joshua Tree corridor.{" "}
            <span style={{ fontFamily: "var(--ff-mono)" }}>
              center {formatCoord(JT_CENTER.lat)},{formatCoord(JT_CENTER.lng)}
            </span>
            .
          </p>
        </header>

        <label
          htmlFor="search-input"
          style={{
            display: "block",
            fontFamily: "var(--ff-display)",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            marginBottom: 8,
          }}
        >
          Query
        </label>
        <input
          id="search-input"
          type="search"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Try "campground", "Ryan", or "water"…'
          aria-label="Search query"
          style={{
            width: "100%",
            background: "var(--input-surface)",
            border: "1px solid var(--input-border)",
            borderRadius: 6,
            color: "var(--input-value)",
            fontFamily: "var(--ff-sans)",
            fontSize: 16,
            padding: "12px 14px",
            outline: "none",
          }}
        />

        <div
          style={{
            marginTop: 12,
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--ff-mono)",
            fontSize: 12,
            color: "var(--text-muted)",
            minHeight: 16,
          }}
        >
          <span>
            {query.trim().length === 0
              ? "type to search"
              : loading
                ? "searching…"
                : `${results.length} result${results.length === 1 ? "" : "s"}`}
          </span>
          <span>
            {elapsedMs !== null && !loading && query.trim().length > 0
              ? `${Math.round(elapsedMs)} ms`
              : ""}
          </span>
        </div>

        {error !== null && (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: "10px 14px",
              border: "1px solid var(--input-error)",
              borderRadius: 6,
              color: "var(--input-error)",
              fontFamily: "var(--ff-mono)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <ul
          style={{
            marginTop: 24,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {results.map((r) => (
            <li
              key={r.id}
              style={{
                background: "var(--bg-card)",
                border: "1px solid rgba(255,255,255,0.04)",
                borderRadius: 8,
                padding: "14px 16px",
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                alignItems: "baseline",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 16,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.canonical_name}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontFamily: "var(--ff-mono)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  <span style={{ color: "var(--amber)" }}>{r.primary_category}</span>
                  {" · "}
                  {r.source_count} source{r.source_count === 1 ? "" : "s"}
                </div>
              </div>
              {r.distance_m !== undefined && (
                <div
                  style={{
                    fontFamily: "var(--ff-mono)",
                    fontSize: 12,
                    color: "var(--text-primary)",
                    flexShrink: 0,
                  }}
                  aria-label={`${Math.round(r.distance_m)} metres from center`}
                >
                  {formatDistanceKm(r.distance_m)}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
