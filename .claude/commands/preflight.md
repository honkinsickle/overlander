---
description: Run the data-source health check (Overpass, Wikipedia, Mapillary, RIDB, Foursquare, USFS, Mapbox) and report which sources are reachable
allowed-tools: Bash(./bin/preflight)
---

Run `./bin/preflight` and then summarize the result to the user:

- If every source is ✓: one line — "Preflight: all 7 sources healthy."
- If any are ✗: list the failing source(s), the HTTP code, and a one-line hint:
  - `OVERPASS ✗` → "Overpass mirror is down. Try setting `OVERPASS_URL=https://overpass.private.coffee/api/interpreter` in `web/.env.local`."
  - `WIKIPEDIA ✗` → "Wikipedia REST API unreachable. Network issue."
  - `MAPILLARY ✗ (4xx)` → "Mapillary token invalid or rotated. Get a new one at https://www.mapillary.com/dashboard/developers."
  - `RIDB ✗ (401/403)` → "RIDB_API_KEY invalid or rotated. Replace at https://ridb.recreation.gov/."
  - `FOURSQUARE ✗ (401/403)` → "FSQ_API_KEY invalid or rotated. Replace at https://foursquare.com/developers/."
  - `USFS ✗` → "USFS ArcGIS service is down (their problem; rare). Retry later."
  - `BLM ✗` → "BLM ArcGIS service is down (their problem; rare). Retry later."
  - `MAPBOX ✗` → "Mapbox token invalid, rotated, or quota exceeded."

Don't run any other tools. Just `./bin/preflight` and the summary.
