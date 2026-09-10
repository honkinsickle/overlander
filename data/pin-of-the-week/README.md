# Pin of the Week

Instagram content pipeline — **SELECT** a place, **GENERATE** a post
(caption + branded Nano Banana image). Posting is out of scope.

Full design, eligibility rules, measured counts, and flagged deviations:
**`docs/content/pin-of-the-week.md`**.

TEST-only. Guarded to the TEST Supabase ref; the only write is `--commit`.

```bash
# how many candidates are eligible right now, and why the rest aren't
npm run -w data potw:select -- --count

# pick one eligible place (diversity-weighted vs the last N featured picks)
npm run -w data potw:select
npm run -w data potw:select -- --commit        # also stamp featured_at

# generate caption + image prompt/spec (+ image if a Gemini key is set)
npm run -w data potw:generate -- --from-select
npm run -w data potw:generate -- --id <uuid> --llm --render
```

| File | Role |
|---|---|
| `eligibility.ts` | read-only eligibility model + full-corpus scan |
| `select.ts` | SELECT CLI (`--count` / `--commit` / `--recent N` / `--json`) |
| `caption.ts` | caption composer (hook → payoff → CTA); optional Anthropic hook rewrite |
| `style-guide.ts` | brand tokens (from `DESIGN.md`) + photo-treatment brief |
| `image-prompt.ts` | per-place treatment prompt + overlay-text spec |
| `nano-banana.ts` | step 1 — Gemini `gemini-2.5-flash-image` photo treatment (no text; dry-runs without a key) |
| `composite.ts` | step 2 — deterministic caption bar via `@napi-rs/canvas`, real name + `DESIGN.md` fonts + brand wordmark |
| `extract-wordmark.ts` | one-time tool: isolate the white "yoTrippin!" wordmark from the branding banner |
| `fonts/` | bundled OFL fonts (Space Mono, Barlow, Barlow Condensed) for reproducible text |
| `brand/` | `branding-source.png` (bundled source) + `yotrippin-wordmark.png` (extracted, transparent) |
| `generate.ts` | GENERATE CLI — writes `base.png` (treatment) + `image.png` (final) to `output/<slug>/` |

**Two-step image pipeline:** Nano Banana renders the graded hero photo with **no
text**, then the caption bar is composited deterministically with the real place
name from SELECT — so the name is always spelled exactly and the typography is
the real brand fonts (fixes the model-rendered-text garbling from PR #407).

Requires the `featured_at` column:
`supabase/migrations/20260910140000_master_place_featured_at.sql`
(apply to TEST via `npm run -w data db:push-verify -- --test`).
