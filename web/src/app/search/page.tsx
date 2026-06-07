"use client";

/**
 * Phase 2 search slice — standalone host for <PlaceSearch>.
 *
 * This page is the development surface for the self-contained
 * <PlaceSearch> component (which is designed to drop into the
 * Add-Waypoints panel later, unchanged). The HOST owns the input and the
 * facet chips; <PlaceSearch> owns the debounce, Typesense match, hydrate
 * call, and results grid.
 *
 * Standalone-only concerns that live here (not in the component):
 *   - the <input> + query state
 *   - the category chip row
 *   - a stubbed proximity center (Joshua Tree — the spec's reference point)
 *   - onAdd → console.log (the panel will wire this to the day)
 */

import { useState } from "react";
import { PlaceSearch } from "@/components/trip/place-search";
import type { SlideCategoryKey } from "@/lib/trip-browse/places";

// Stub proximity center — Joshua Tree, the spec's reference point. The
// panel will pass the real trip/day center instead.
const STUB_CENTER: [number, number] = [-116.313, 34.135];

// Only the slide pills the federated corpus actually facets on
// (SLIDE_TO_PRIMARY_CATEGORY). oddity/overnight have no primary_category
// mapping yet, so they'd be no-op filters — leave them out of the host.
const FACET_CHIPS: SlideCategoryKey[] = ["camping", "scenic", "food", "fuel"];

export default function SearchPage(): React.ReactElement {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<SlideCategoryKey | null>(
    null,
  );

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
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
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
          <p style={{ marginTop: 8, fontSize: 14, color: "var(--text-muted)" }}>
            Typesense match → hydrate → shared location cards. Standalone host
            for the panel-bound <code>&lt;PlaceSearch&gt;</code> component.
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
          placeholder='Try "Van Lake", "campground", or "national park"…'
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
          role="group"
          aria-label="Category filter"
          style={{
            marginTop: 12,
            marginBottom: 24,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <Chip
            label="All"
            active={categoryFilter === null}
            onClick={() => setCategoryFilter(null)}
          />
          {FACET_CHIPS.map((key) => (
            <Chip
              key={key}
              label={key}
              active={categoryFilter === key}
              onClick={() =>
                setCategoryFilter((cur) => (cur === key ? null : key))
              }
            />
          ))}
        </div>

        <PlaceSearch
          query={query}
          center={STUB_CENTER}
          categoryFilter={categoryFilter}
          onAdd={(id) => console.log("onAdd", id)}
        />
      </div>
    </main>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        fontFamily: "var(--ff-display)",
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "capitalize",
        padding: "6px 14px",
        borderRadius: 999,
        cursor: "pointer",
        color: active ? "var(--bg-base)" : "var(--text-muted)",
        background: active ? "var(--amber)" : "transparent",
        border: `1px solid ${active ? "var(--amber)" : "var(--input-border)"}`,
      }}
    >
      {label}
    </button>
  );
}
