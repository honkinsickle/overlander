---
name: pin-of-the-day
description: Make one Instagram "Pin of the Day" post interactively — pick a campsite, confirm it, choose its photo, generate a branded image + caption, approve, mark it used, and save it to the reusable post history. Invoke when the user types /pin-of-the-day or asks to make a Pin of the Day / Pin of the Week post.
---

# Pin of the Day

Interactive wrapper around the Pin of the Week pipeline (`data/pin-of-the-week/`).
You drive it one post at a time: the user names a campsite, you confirm it, they
pick the photo, you generate the branded post, and on their approval you mark the
place used and archive the post. If browser automation is available you can then
stage it on Instagram — but publishing always needs a second, explicit yes
(step 9). Design record:
`docs/decisions/2026-09-11-pin-of-the-day-skill.md`.

## Non-negotiables

- **TEST-only, for the database CLIs.** `potw:select`, `potw:generate`,
  `potw:posts`, and `potw:override-photo` are each guarded by
  `assertTestProject()` and read `data/.env` (TEST `znldzjdatkogdktymtvi`).
  Never point them at PROD. `potw:sheet` (the Sheet flow below) touches no
  database at all — nothing to guard, nothing to point at PROD.
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

### 9. Post it to Instagram — ONLY with browser automation, and NEVER without a final yes

This step is **optional and conditional**. It runs only if browser automation is
available in the current session.

**9a. Check availability first.** Look at the tools actually available to you
this session for anything that can navigate, click, type into, and screenshot a
live browser — Claude in Chrome, a browser MCP, or a raw CDP connection to a
Chrome started with `--remote-debugging-port`. Don't assume: if you cannot name
the tool you'd call to navigate a page, it isn't available.

The upload in 9b needs one specific capability — **setting a file on an
`<input type="file">` directly** (CDP `DOM.setFileInputFiles` or your tool's
equivalent). Navigation-and-clicking alone is not enough; see 9b item 2.

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

**9b. Set the post up.** Work from the directory holding the approved
`image.png` + `caption.txt` (absolute path when the browser needs one):

- **Database flow (steps 1–8):** the archive dir printed in step 8,
  `data/pin-of-the-week/posts/<date>-<slug>/` — the archived copies, not the
  scratch `output/` dir.
- **Sheet flow:** there is no step-8 archive step — stage directly from the
  dir the build printed, `data/pin-of-the-week/output/sheet/<category>/<slug>/`.

1. Navigate to Instagram (`https://www.instagram.com/`) and start a new post.
   **Create is a two-step control:** click **Create** / **+**, then **Post** in
   the submenu that opens. Instagram web only allows this on a logged-in session
   — if it lands on a login wall, or if clicking Create pops a re-auth login
   modal (this happens when a login was started but 2FA never completed), stop
   and tell the user to sign in themselves. Never type credentials, never enter a
   2FA code, and never ask for either.
   **Confirm which account is signed in before staging anything** — the sidebar
   shows it. A Pin of the Day staged on the wrong account is the wrong post on
   the wrong audience.
2. Upload `image.png` — **attach it directly to the file input; do NOT click
   "Select from computer."** That button opens a native OS file dialog which
   browser automation cannot drive. The create dialog also contains a hidden
   `<input type="file">` (`display: none`) that CAN be targeted directly:

   ```
   selector: [role="dialog"] input[type="file"]
   then:     CDP DOM.setFileInputFiles  (or your tool's set-file-on-input action)
   ```

   Instagram advances to the Crop screen on its own once the file is attached —
   no native dialog ever opens. `[verified live 2026-09-14, twice]`
   If your tooling genuinely cannot set a file on an input, say so and ask the
   user to pick the file in the native dialog themselves, then carry on once it's
   loaded. That is the fallback, not the primary path.
3. **Set the crop to "Original" — do not accept whatever the crop screen opens
   with.** The posts are composited at 1080×1350 (4:5) and any other ratio slices
   the brand frame: a 1:1 crop cuts the yoTrippin! header off the top and the
   title block off the bottom. Open the **Select crop** control and choose
   **Original** (options are Original / 1:1 / 4:5 / 16:9).
   **The crop screen does NOT reliably open at the source ratio.** One live run
   opened square at 1:1; a second run in the same session opened already at 4:5
   `[both measured 2026-09-14]`. Whether that's a cold-session default versus a
   persisted last-used ratio is **unconfirmed** — which is exactly why you set it
   explicitly every time instead of eyeballing it. Then advance through the
   remaining screens (**Next**, then **Next** again) without applying filters or
   edits.
4. Paste the caption. Read `caption.txt` from the archive dir and put its text,
   verbatim, into the caption field. Don't rewrite, trim, re-wrap, or "improve"
   it — it's the text the user approved in step 6.
5. **Check the "Share to" toggles on the Share screen before you go near the
   gate.** Instagram cross-posts to a linked Facebook account, and the toggle was
   **ON by default in both live test runs** `[measured 2026-09-14]` — so sharing
   would publish to Facebook as well as Instagram. Read its current state off the
   screen (never assume it's off) and tell the user explicitly what it says as
   part of 9c, naming the Facebook target. If they only want Instagram, turn it
   off before sharing.
6. Screenshot the composed post so the user can see exactly what's staged.

**9c. STOP. Ask before publishing.** This is a hard gate, not a formality. State
the cross-post state in the question itself — it is part of what they're
approving:

> "Image and caption are in place, nothing is published yet. Cross-post to
> Facebook is currently **<on/off, naming the target>**. Share this post?"

- **Wait for an explicit yes.** Silence, "looks good", or a question is not a yes
  — ask again. Do not click Share/Post because the flow seems finished, because
  the user approved in step 6, or because you're mid-automation.
- **Yes** → click Share/Post, confirm it published, and report the result.
  **For a Sheet-built post only:** also write today's date into that row's
  `posted` cell in the sheet. If the browser cannot write it, say which row
  to tick rather than leaving the queue wrong. (A database-flow post from
  steps 1–8 has no sheet row — nothing to write back.)
- **No / wants changes** → do NOT publish, and do NOT edit the caption or image
  in the browser. Leave the draft alone, say what you're doing, and go back
  through the existing flow: a different caption is step 5 re-run with
  `--caption-template <1-12>`; a different photo is step 4. The post is remade
  properly and re-approved, not patched in Instagram.

### Building from the Google Sheet

An alternative to steps 1–8 for batch-building posts from a queue instead of
picking one campsite at a time — nothing is read from or written to the
database, and nothing is marked used:

```
npm run -w data potw:sheet -- --sheet <url> --category <name> [--out <dir>] [--next-only]
```

`--category` names a PAIR of tabs: `<name>` (its `art_url` + numbered caption
templates) and `<name> posts` (its queue: `photo_url` · `place` · `state` ·
`country` · `posted`). The tab name IS the category — there is no category
column and no registry.

- `--next-only` builds just the next row whose `posted` cell is empty. Row
  order is the queue. Without it, every unposted row in the queue is built in
  one run.
- Output per post: `image.png`, `caption.txt`, `meta.json`, landing in
  `data/pin-of-the-week/output/sheet/<category>/<slug>/` (or under `--out <dir>`
  if given), plus one `review.html` index over the whole batch. There is no
  step-8 archive for these — step 9 stages directly from this dir (see 9b).
- Adding a category is three spreadsheet actions and no code: duplicate both
  tabs, set the new `art_url` and captions, add rows.
- A tab name that doesn't exist does NOT error on its own — Google returns
  HTTP 200 with the *first tab's* data for a missing name. The build guards
  this with a probe fetch and reports `no tab named "<x>"` when it catches the
  mismatch. This is a real trap, not a hypothetical: the live sheet has a tab
  named `"campground "` with a trailing space, which triggers exactly this.
- If the probe fetch itself fails, the build prints a warning that the guard
  is OFF. Treat a run that prints that warning with suspicion — a mistyped
  `--category` could be silently building another category's posts.

## Browsing / reusing past posts

Not part of the make-a-post flow — for when the user asks to see or reuse
history:

```
npm run -w data potw:posts -- --list            # recorded posts, newest first
npm run -w data potw:posts -- --reuse <id>       # show a past post's metadata + archive paths
```

`--reuse <id>` prints the archive paths; `Read` the archived `image.png` to
re-display the post. It never re-renders or writes.
