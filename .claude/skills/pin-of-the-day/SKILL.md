---
name: pin-of-the-day
description: Make one Instagram "Pin of the Day" post interactively — pick a campsite, confirm it, choose its photo, generate a branded image + caption, approve, mark it used, and save it to the reusable post history. Invoke when the user types /pin-of-the-day or asks to make a Pin of the Day / Pin of the Week post.
---

# Pin of the Day

Interactive wrapper around the Pin of the Week pipeline (`data/pin-of-the-week/`).
You drive it one post at a time: the user names a campsite, you confirm it, they
pick the photo, you generate the branded post, and on their approval you mark the
place used and archive the post. If Claude in Chrome is available you can then
stage it on Instagram — but publishing always needs a second, explicit yes
(step 9). Design record:
`docs/decisions/2026-09-11-pin-of-the-day-skill.md`.

## Non-negotiables

- **TEST-only.** Every CLI here is guarded by `assertTestProject()` and reads
  `data/.env` (TEST `znldzjdatkogdktymtvi`). Never point it at PROD.
- **Interactive.** Ask, wait, confirm. Never auto-pick a campsite, never approve
  on the user's behalf. The two writes — `--commit` (mark used) and `--record`
  (save post) — happen ONLY after the user explicitly approves in step 6.
- **NEVER PUBLISH WITHOUT A SECOND, EXPLICIT CONFIRMATION.** Step 6's approval
  authorizes generating and archiving the post — it does NOT authorize posting
  it. In the step 9 Instagram flow you may drive the browser all the way up to a
  loaded image + filled caption, then you STOP and ask. Clicking Share/Post
  requires a fresh yes in answer to that question. Publishing is irreversible and
  public; no amount of prior approval, momentum, or automation carries past this
  gate.
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
- **No match** → report and STOP.
- **INELIGIBLE** → report exactly why (the CLI prints the rejection reasons).
  **If the ONLY rejection is `no resolved photo`, it's recoverable** — the place
  becomes eligible once a photo override supplies one, so go to step 4's override
  branch (ask for a file/URL + source + license), then continue. If there are
  ANY other rejections (description, verification signal, publishable state),
  STOP — an override won't fix those. Never force a genuinely ineligible place.

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
re-run step 5 with `--caption-template <1-12>`; if they want a different photo,
go back to step 4.

### 7. Mark it used
Stamp `featured_at` so the place never recurs:

```
npm run -w data potw:select -- --place-id <uuid> --commit
```

This works for override-rescued places too — `select` applies the photo override
and re-evaluates before the eligibility gate, exactly as `generate` does.

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

### 9. Post it to Instagram — ONLY with Claude in Chrome, and NEVER without a final yes

This step is **optional and conditional**. It runs only if browser automation
(Claude in Chrome) is available in the current session.

**9a. Check availability first.** Look at the tools actually available to you
this session for a Chrome/browser-control family (Claude in Chrome — navigate,
click, type, screenshot the live browser). Don't assume: if you cannot name the
tool you'd call to navigate a page, it isn't available.

- **Not available** → say so plainly and stop the skill here:
  > "Browser automation isn't available in this session, so I can't post it for
  > you. The post is ready at `data/pin-of-the-week/posts/<date>-<slug>/` —
  > `image.png` to upload and `caption.txt` to paste. Post it manually when
  > you're ready."

  That is a clean, successful end to the skill. Steps 1–8 already did the real
  work; do NOT treat a missing browser as a failure, and do NOT try to substitute
  some other automation (curl, the Instagram API, a script) — manual posting is
  the fallback.
- **Available** → ask before driving anything:
  > "Want me to open Instagram and set the post up? I'll stop for your OK before
  > anything gets published."

  No → stop here, same as above. Yes → continue.

**9b. Set the post up.** Work from the archive dir printed in step 8
(`data/pin-of-the-week/posts/<date>-<slug>/`, absolute path when the browser
needs one) — the archived copies, not the scratch `output/` dir:

1. Navigate to Instagram (`https://www.instagram.com/`) and start a new post
   (the **Create** / **+** control). Instagram web only allows this on a
   logged-in session — if it lands on a login wall, stop and tell the user to
   sign in themselves. Never type credentials, and never ask for them.
2. Upload `image.png` from the archive dir. The upload control opens the OS file
   picker, which browser automation generally CANNOT drive — if you can't set the
   file programmatically, say so and ask the user to pick the file in the dialog
   themselves, then carry on once it's loaded. Advance through Instagram's crop
   and edit screens without changing anything: the image is already composited at
   1080×1350 and needs no cropping or filters.
3. Paste the caption. Read `caption.txt` from the archive dir and put its text,
   verbatim, into the caption field. Don't rewrite, trim, re-wrap, or "improve"
   it — it's the text the user approved in step 6.
4. Screenshot the composed post so the user can see exactly what's staged.

**9c. STOP. Ask before publishing.** This is a hard gate, not a formality:

> "Image and caption are in place, nothing is published yet. Share this post?"

- **Wait for an explicit yes.** Silence, "looks good", or a question is not a yes
  — ask again. Do not click Share/Post because the flow seems finished, because
  the user approved in step 6, or because you're mid-automation.
- **Yes** → click Share/Post, confirm it published, and report the result.
- **No / wants changes** → do NOT publish, and do NOT edit the caption or image
  in the browser. Leave the draft alone, say what you're doing, and go back
  through the existing flow: a different caption is step 5 re-run with
  `--caption-template <1-12>`; a different photo is step 4. The post is remade
  properly and re-approved, not patched in Instagram.

## Browsing / reusing past posts

Not part of the make-a-post flow — for when the user asks to see or reuse
history:

```
npm run -w data potw:posts -- --list            # recorded posts, newest first
npm run -w data potw:posts -- --reuse <id>       # show a past post's metadata + archive paths
```

`--reuse <id>` prints the archive paths; `Read` the archived `image.png` to
re-display the post. It never re-renders or writes.
