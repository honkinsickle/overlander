# 2026-09-11 — "Pin of the Day" interactive skill (design record)

> **BUILT 2026-09-11** (same day, later session). Migration + `post-history.ts`
> helper + `potw:posts` CLI + `.claude/skills/pin-of-the-day/SKILL.md` +
> vitest tests, TEST-only. Applied + table-verified on TEST
> `znldzjdatkogdktymtvi`; end-to-end run passed (Point Bonita Lighthouse:
> select → generate --render → record → list → reuse → commit), then TEST
> restored to baseline. Two deviations from the column list below, both flagged
> and agreed during the build:
>
> - **Added `archive_dir` column** (not in the original list) — `--reuse` needs
>   to locate the archived image from a DB row; reconstructing it from date+slug
>   is fragile, so the archive path is stored.
> - **`photo_ref` for `override:file` is the `manual-override://<mime>` marker,
>   not a filename.** The original filename is never persisted anywhere (the
>   override table stores base64 bytes), so `photo_ref = place.json.photo_url`
>   verbatim — the real URL for corpus/override:url, the marker for a file
>   override. No filename is invented.
>
> **Follow-up fix (separate PR — see note below — found by dogfooding the skill
> on Cape Blanco State Park):** `potw:select --commit` evaluated eligibility from corpus data alone
> and never consulted the photo override, so it **refused to mark used any place
> eligible only via an override** — i.e. every no-corpus-photo place, the primary
> reason overrides exist. Only `generate` applied the override. Fixed by
> extracting the override-apply-and-re-evaluate logic into a shared
> `applyPhotoOverride()` (in `photo-override.ts`) that BOTH `generate` and
> `select`'s manual path call, so they cannot drift again. Verified: the same
> `select --place-id --commit` that failed twice on Cape Blanco now returns
> `committed: true`.
>
> **Merge note:** the build (`potw:posts` + skill + migration) squash-merged as
> **PR #424** (`main` `37985a0`), but the squash raced and captured only the first
> commit — the build — so this fix did **not** land with it and reaches `main` via
> a **separate follow-up PR** (branch `fix-potw-select-override`). Until that
> merges, `main` carries the override-commit bug.
>
> The design below is the original agreed record, preserved.

## Context

The Pin of the Week pipeline (`data/pin-of-the-week/`, TEST-only) is complete on
`main`: `potw:select` (ranked or manual), `potw:override-photo`, `potw:generate`
(8 caption templates + a branded 1080×1350 image composited from the **real**
corpus/override photo — no AI by default). Adam wants an interactive wrapper: a
Claude Code skill he invokes to make one post at a time, choosing the campsite
himself.

## Decisions (settled with Adam)

1. **Name = "Pin of the Day"** for the skill and all user-facing text. The
   internal code/table names stay "pin of week" — renaming them (npm scripts,
   the `pin_of_week_caption_history` table) is a pointless migration for a
   cosmetic change. Only the skill + docs say "Pin of the Day".
2. **Interactive to start.** Adam is at the keyboard; the skill asks him which
   campsite. (A scheduled/unattended auto-draft is a *later* option — it would
   drop the "ask which" step and auto-pick.)
3. **Adam names the campsite; the skill confirms the match.** Not "Claude
   proposes a shortlist" — he supplies the location, the skill looks it up and
   confirms the single match (or lists several / reports none).
4. **Photo: corpus by default, his own optional.** Default is the real
   `photo_url`; he can drop in his own file/url, which sets a persistent
   override. **No Gemini** in the default flow (`generate --render`).
5. **On approve → mark it used.** Stamp `featured_at` (`select --place-id … --commit`)
   so it won't recur. Done only on approval, never silently.
6. **Keep a reusable post history** so past posts can be browsed and re-used.

## Flow

`/pin-of-the-day` (interactive):
1. Ask which campsite.
2. Adam names it → `potw:select --search "<name>" --json` → confirm the single
   match. Multiple → list them; none / ineligible → report + stop.
3. Show its photo inline (fetch `photo_url`).
4. Keep it, or Adam supplies his own → `potw:override-photo --file/--url …
   --source … --license …`.
5. `potw:generate --id <uuid> --render` (real photo, no AI) → show image + caption.
6. Adam approves.
7. Mark used: `potw:select --place-id <uuid> --commit`.
8. Save to post history (see below).

## Post history — chosen design

- **New table `pin_of_the_day_post`** — metadata only: `id`, `master_place_id`,
  `canonical_name`, `caption_text`, `template_number`, `photo_source`
  (`corpus` | `override:url` | `override:file`), `photo_ref`, `created_at`,
  `status`. Queryable so posts can be listed.
- **Composited image saved to a committed archive** on disk:
  `data/pin-of-the-week/posts/<date>-<slug>/image.png` (+ a manifest).
- **New CLI `potw:posts`** — `--list` (browse) and `--reuse <id>` (re-open /
  regenerate a past post).
- **Not** stuffing 2 MB images into the DB — metadata in the DB (queryable),
  image on disk. Posts are reproducible anyway (place + template + photo bytes
  all persist).

## Build plan (next session)

1. `pin_of_the_day_post` migration + record/list/reuse code (`potw:posts`) +
   tests → apply to TEST (`npm run -w data db:push-verify -- --test`) → verify
   the table by a **direct query** (the v1 verifier can't check DDL).
2. `SKILL.md` at `.claude/skills/pin-of-the-day/` orchestrating the existing
   CLIs (interactive prompts; show images via `Read`).
3. Test end-to-end on TEST with a real campsite; confirm mark-used + post saved.
4. Branch → push → PR against `main` (Adam merges).

## Constraints carried from the pipeline

- **TEST-only**, guarded by `assertTestProject()`. Never PROD.
- Applying migrations needs the workspace-linked Supabase CLI; a fresh workspace
  must `supabase link --project-ref znldzjdatkogdktymtvi` interactively.
- `GEMINI_API_KEY` is only needed for the optional `--treat`; the default image
  path needs no key.
