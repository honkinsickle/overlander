# Decision records (ADRs)

Why the project is the way it is. Every decision that closes an option — that
forecloses an alternative future work would otherwise assume is open — gets a
record here, written **before** the code that depends on it (CLAUDE.md
§WRITE DISCIPLINE).

## Convention
- **One file per decision.** Name it `YYYY-MM-DD-slug.md` (date the decision was
  made, kebab-case slug).
- **Append-only. Never rewritten.** The original claim stays exactly as written,
  even after it stops being true. Rewriting history is how a stale line
  (e.g. the old "blocked on rendering") survives unnoticed and misleads a cold
  start.
- **Superseded ≠ deleted.** When a decision is overturned or overtaken:
  1. Add a **staleness flag at the very top** — `> ⚠️ SUPERSEDED YYYY-MM-DD by
     [slug](YYYY-MM-DD-slug.md) — <one line>` (or `PARTIALLY SUPERSEDED` /
     `STALE`).
  2. Add a dated **addendum section at the bottom** with the new reasoning.
  Leave the body between them untouched. A reader sees both the original call
  and why it changed.

## Reading order
The flag at the top of each file tells you whether its body is still load-bearing
before you rely on it. No flag = still current.
