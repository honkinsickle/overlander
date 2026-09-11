---
name: pin-of-the-day
description: Make one Instagram "Pin of the Day" post interactively — pick a campsite, confirm it, choose its photo, generate a branded image + caption, approve, mark it used, and save it to the reusable post history. Invoke when the user types /pin-of-the-day or asks to make a Pin of the Day / Pin of the Week post.
---

# Pin of the Day

Interactive wrapper around the Pin of the Week pipeline (`data/pin-of-the-week/`).
You drive it one post at a time: the user names a campsite, you confirm it, they
pick the photo, you generate the branded post, and on their approval you mark the
place used and archive the post. Design record:
`docs/decisions/2026-09-11-pin-of-the-day-skill.md`.

## Non-negotiables

- **TEST-only.** Every CLI here is guarded by `assertTestProject()` and reads
  `data/.env` (TEST `znldzjdatkogdktymtvi`). Never point it at PROD.
- **Interactive.** Ask, wait, confirm. Never auto-pick a campsite, never approve
  on the user's behalf. The two writes — `--commit` (mark used) and `--record`
  (save post) — happen ONLY after the user explicitly approves in step 6.
- **No AI/API key** in the default path. `generate --render` composites the real
  photo; `--treat` (Gemini) is not part of this flow.
- Run every command from the repo root as `npm run -w data potw:<cmd> -- <flags>`.

## Flow

Work through these in order. One question at a time; wait for the answer.

### 1. Ask which campsite
> "Which campsite should today's Pin feature?"

### 2. Look it up and confirm the match
Run the search (quote the name):

```
npm run -w data potw:select -- --search "<name>" --json
```

- **Exactly one match** → show the user the name, category, state, and
  eligibility, and confirm it's the right place before continuing. Capture its
  `id` and `photo_url` from the JSON.
- **Several matches** → the CLI prints a shortlist (id · name · category ·
  eligible/INELIGIBLE). Show it and ask which id they want, then re-run with
  `--place-id <uuid> --json` to select that one.
- **No match, or the chosen place is INELIGIBLE** → report exactly why
  (the CLI prints the rejection reasons) and STOP. Do not force it.

### 3. Show its photo
`Read` cannot open a URL, so download the corpus photo to a scratch file, then
show it:

```
curl -sL "<photo_url>" -o .context/potd-preview.jpg
```

Then `Read .context/potd-preview.jpg` so the user sees it inline. (`.context/`
is gitignored — this is scratch.)

### 4. Keep this photo, or use their own
> "Use this photo, or supply your own?"

If they supply their own, set a persistent override (provenance is required):

```
# from a local file
npm run -w data potw:override-photo -- --place-id <uuid> --file <path> --source "<where it came from>" --license "<license>"
# from a URL
npm run -w data potw:override-photo -- --place-id <uuid> --url <url> --source "..." --license "..."
```

For a `--file` override you can `Read <path>` directly to preview it; for a
`--url` override, download it as in step 3 first.

### 5. Generate the post
```
npm run -w data potw:generate -- --id <uuid> --render
```

This writes to `pin-of-the-week/output/<slug>/` (relative to `data/`). Capture
the exact output dir from the `artifacts → …` line. Then show the result:

- `Read data/pin-of-the-week/output/<slug>/image.png` (the branded 1080×1350 post)
- show the caption text the command printed (also in `.../caption.txt`)

### 6. Get approval
> "Approve this post?"

Only on an explicit yes do you run steps 7–8. If they want a different caption,
re-run step 5 with `--caption-template <1-8>`; if they want a different photo,
go back to step 4.

### 7. Mark it used
Stamp `featured_at` so the place never recurs:

```
npm run -w data potw:select -- --place-id <uuid> --commit
```

### 8. Save to the post history
Record the approved post — inserts the DB row and copies the image + a manifest
into the committed archive `data/pin-of-the-week/posts/<date>-<slug>/`:

```
npm run -w data potw:posts -- --record --from pin-of-the-week/output/<slug>
```

Report the post number and archive path it prints. The archive under
`data/pin-of-the-week/posts/` is meant to be committed to git (unlike the
scratch `output/` dir) — tell the user it's ready to commit if they want to keep
it.

## Browsing / reusing past posts

Not part of the make-a-post flow — for when the user asks to see or reuse
history:

```
npm run -w data potw:posts -- --list            # recorded posts, newest first
npm run -w data potw:posts -- --reuse <id>       # show a past post's metadata + archive paths
```

`--reuse <id>` prints the archive paths; `Read` the archived `image.png` to
re-display the post. It never re-renders or writes.
