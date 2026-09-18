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
- **NEVER PUBLISH WITHOUT A SECOND, EXPLICIT CONFIRMATION — except via the
  autonomous command, below.** Step 6's approval authorizes generating and
  archiving the post — it does NOT authorize posting it. In the step 9 Instagram
  flow you may drive the browser all the way up to a loaded image + filled
  caption, then you STOP and ask. Clicking Share/Post requires a fresh yes in
  answer to that question. Publishing is irreversible and public; no amount of
  prior approval, momentum, or automation carries past this gate.

  **The ONE exception, authorized by Adam 2026-09-15:** `post <category>`
  (§Autonomous posting). There, **the queued sheet row IS the approval** — he
  chose the photo, wrote the caption, set the art and put the row in the queue,
  so the sign-off happened at his desk rather than at publish time. The gate did
  not disappear; it moved earlier.

  **This exception is narrow and does not generalize.** It covers a row the
  operator queued in `<category> posts` and nothing else. The database flow
  (steps 1–8), any post built from a place you selected, any post whose caption
  or photo did not come from a queued row — all still require the step 9c stop.
  If you are ever unsure whether a post is covered, it is not: STOP and ask.
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

### 9. Post it to Instagram — the API first, a browser only as fallback, and NEVER without a final yes

**9-API. The API is the primary path** `[live 2026-09-17, account
yotrippin.app]`. No browser, no incognito session, no crop screen — and it
publishes a story as readily as a post, which the browser route never did
dependably.

```
# prove the credential and the staging url — publishes NOTHING
npm run -w data potw:publish -- --dir <the post dir> --dry-run
# the post
npm run -w data potw:publish -- --dir <the post dir>
# the story, when the build made one
npm run -w data potw:publish -- --dir <the post dir> --story
```

What it does, so that its failures are readable: re-encodes the PNG as JPEG
(Instagram accepts nothing else), stages it in the public `ig-publish` bucket on
TEST — Instagram **fetches** the image, there is no upload endpoint — creates a
media container, publishes it, then deletes the staged file. A container without
the publish call puts nothing on the account, which is what makes `--dry-run` a
real test of the credential rather than a no-op.

- ⚠️ **`--dir` must be ABSOLUTE.** The npm script runs with its working
  directory inside `data/`, so a repo-relative path resolves to
  `data/data/pin-of-the-week/…` and the command reports `image.png not found`
  `[measured 2026-09-17]`. The build already prints the absolute dir on each
  post's `✓` line — use that string verbatim and this cannot happen.
- **It prompts before publishing.** `--yes` skips the prompt; that is what
  §Autonomous posting uses. With no terminal and no `--yes` it refuses rather
  than assuming consent.
- **Post and story are two separate calls.** Post first, then story. A story
  carries no caption, and `--story` sends `story.png` — never `story-web.png`,
  whose 1080x2340 padding exists only to survive the browser composer.
- Needs `IG_ACCESS_TOKEN` in `data/.env`. These tokens last about 60 days, so
  an expiry is a real failure mode, not a theoretical one.
- **It does not touch the sheet.** Ticking the row stays a separate, later step,
  for the standing reason: confirmation first, write-back second.
- ⚠️ **Whether an API publish cross-posts to Facebook is UNVERIFIED.** The
  browser composer had a toggle, defaulted ON, and Adam's standing decision
  (2026-09-15) is Instagram only; there is no such toggle in the API call, and
  the account-level setting lives in Accounts Center. Check Facebook after the
  first real API post and record what you find — do not assume either way.

**Only when the API is unavailable or refuses** — no token, expired token, an
Instagram-side rejection — fall back to the browser route below. Say which
happened; never switch paths silently.

**9a. Check browser availability (fallback route only).** Look at the tools
actually available to you this session for anything that can navigate, click,
type into, and screenshot a live browser — Claude in Chrome, a browser MCP, or a raw CDP connection to a
Chrome started with `--remote-debugging-port`. Don't assume: if you cannot name
the tool you'd call to navigate a page, it isn't available.

The upload in 9b needs one specific capability — **setting a file on an
`<input type="file">` directly** (CDP `DOM.setFileInputFiles` or your tool's
equivalent). Navigation-and-clicking alone is not enough; see 9b item 2.

- **Not available** → say so plainly and stop the skill here, naming whichever
  dir this run actually produced:
  - **Database flow:**
    > "Browser automation isn't available in this session, so I can't post it
    > for you. The post is ready at `data/pin-of-the-week/posts/<date>-<slug>/`
    > — `image.png` to upload and `caption.txt` to paste. Post it manually
    > when you're ready."
  - **Sheet flow:**
    > "Browser automation isn't available in this session, so I can't post it
    > for you. The post is ready at
    > `data/pin-of-the-week/output/sheet/<category>/<slug>/` — `image.png` to
    > upload and `caption.txt` to paste. Post it manually when you're ready."

  That is a clean, successful end to the skill. The post is already built and
  saved; do NOT treat a missing browser as a failure.
  **~~Do not substitute the Instagram API~~ — CORRECTED 2026-09-17.** That
  instruction predates the API working; the API is now the primary path (§9-API)
  and a browser is the fallback, not the other way round. This "post it by hand"
  ending applies only when the API has ALSO failed or has no token. Still do not
  improvise some third route.
- **Available** → ask before driving anything:
  > "Want me to open Instagram and set the post up? I'll stop for your OK before
  > anything gets published."

  No → stop here, same as above. Yes → continue.

**9b. Set the post up.** Work from the directory holding the approved
`image.png` + `caption.txt` — call it **the post dir** for the rest of this
step (absolute path when the browser needs one):

- **Database flow (steps 1–8):** the post dir is the archive dir printed in
  step 8, `data/pin-of-the-week/posts/<date>-<slug>/` — the archived copies,
  not the scratch `output/` dir.
- **Sheet flow:** there is no step-8 archive step — the post dir is the exact
  dir the build printed on that post's `✓` line (shape:
  `data/pin-of-the-week/output/sheet/<category>/<slug>/`). Do not glob for it;
  stale dirs from earlier runs are still on disk. The post must already have
  passed the Sheet section's "Approve this post?" gate — if it hasn't, go do
  that first.

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
4. Paste the caption. Read `caption.txt` from the post dir (established in
   9b's intro) and put its text, verbatim, into the caption field. Don't
   rewrite, trim, re-wrap, or "improve" it — it's the already-approved
   caption text.
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
  through whichever flow built it. The post is remade properly and re-approved,
  never patched in Instagram.
  - **Database flow:** a different caption is step 5 re-run with
    `--caption-template <1-12>`; a different photo is step 4.
  - **Sheet flow:** there is no caption-template flag and no step 4 — the sheet
    is the input. Edit it, then re-run `potw:sheet` for that category: the
    caption comes from that category's numbered templates (and which one is
    fixed by the row's position), the art from its `post_art_url`, the photo from
    that row's `photo_url`. Re-approve the rebuilt post.

### Building from the Google Sheet

An alternative to steps 1–8 for batch-building posts from a queue instead of
picking one campsite at a time — nothing is read from or written to the
database, and nothing is marked used:

```
npm run -w data potw:sheet -- --sheet <url> --category <name> [--out <dir>] [--next-only]
```

`--category` names a PAIR of tabs: `<name>` (its `post_art_url` + numbered caption
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
  tabs, set the new `post_art_url` and captions, add rows.
- A tab name that doesn't exist does NOT error on its own — Google returns
  HTTP 200 with the *first tab's* data for a missing name. The build guards
  this with a probe fetch and reports `no tab named "<x>"` when it catches the
  mismatch. Two different situations produce that error, and the endpoint
  cannot tell them apart:
  - **The name really doesn't match a tab.** Watch for a stray leading or
    trailing space in the tab name itself (`"campground "` and `campground` are
    different tabs to Google); the CLI trims what *you* pass, so it cannot match
    a tab whose own name carries the space. Rename the tab.
  - **The named tab IS the workbook's first tab.** Its payload is byte-identical
    to what a missing tab returns, so the guard fires on a perfectly correct
    name. The fix is to drag any throwaway tab into position 1 ahead of it, then
    re-run. Don't go hunting for a typo before ruling this one out.
- If the probe fetch itself fails, the build prints a warning that the guard
  is OFF. Treat a run that prints that warning with suspicion — a mistyped
  `--category` could be silently building another category's posts.
- Each built post prints its own absolute dir on its `✓` line. Use that exact
  path — earlier runs leave their own dirs behind, so globbing for the folder
  can land on a stale post from a previous build.

**Approve each post before step 9 — this flow has no other check on the
image.** Steps 5–6 above belong to the database flow; a Sheet build renders
straight from the queue, so nothing has looked at the composite. The overlay art
and the photos come from whatever `post_art_url`/`photo_url` hold, and the pipeline
does not inspect them. Human eyes are the only thing standing between a broken
asset and a public post. So for each post you intend to stage:

1. `Read <post dir>/image.png` — the actual 1080×1350 composite, shown inline.
2. Show the caption from `<post dir>/caption.txt`, verbatim.
3. Ask:
   > "Approve this post?"

Check the image really carries the yoTrippin! branding and the place photo, not
just that a file exists. **No explicit yes → do not go on to step 9 with that
post.** If they want changes, the answer is to edit the sheet (its `post_art_url`,
its caption templates, or that row's `photo_url`) and re-run the build — you do
not patch the output files by hand.

(The batch `review.html` is a convenience for eyeballing a whole run at once; it
does not replace this gate for the post being staged.)

## Autonomous posting — `post <category>`

When Adam says **`post camping`**, **`post scenic`**, or `post <any category>`,
run the whole thing end to end and publish. **Do not stop to confirm.** The
queued sheet row is the approval (see §Non-negotiables) — asking again is asking
him to approve the same thing twice.

Map the word he uses to the tab name: `camping` → the `campground` tab pair.
If the word matches no tab pair, say which categories exist and stop.

**Run these in order. Any failure before step 2 completes means nothing was
published — report it and stop; the row stays queued and will be retried next
time.**

1. **Build it.**
   ```
   npm run -w data potw:sheet -- --sheet <sheet url> --category <name> --next-only
   ```
   This validates everything before writing anything. If it reports problems,
   relay them verbatim — they name the sheet row — and stop.
   **Empty queue** → say the queue is empty and stop. NEVER wrap around and
   republish an old row.

2. **Publish the post through the API** (§9-API), using the dir the build
   printed on that post's `✓` line:
   ```
   npm run -w data potw:publish -- --dir <that dir> --yes
   ```
   Success is the printed `✅ published post — media <id>` line, not the absence
   of an error. Anything else means nothing went out: report it and stop with the
   row still queued.

   **No token, or an expired one** → fall back to the browser route (§9a–§9c),
   which still requires its own final yes. Say plainly that you switched.

3. **Publish the story, if the build made one** — the build's `✓` line says
   `+ story`:
   ```
   npm run -w data potw:publish -- --dir <the same dir> --story --yes
   ```
   A story failure does **not** undo the post and does **not** hold up step 4 —
   the post is out, so the row is posted. Say the story did not go, and carry on.
   `(no story)` in the build means there is nothing to do here.

4. **Only then, write today's date into that row's `posted` cell.**
   **Order is load-bearing:** confirmation first, write-back second. If the
   publish fails, the row must stay unposted so it retries. Writing first would
   silently drop a post from the queue. If the write-back itself fails, say
   plainly which tab and row need ticking by hand — never leave the queue wrong
   and silent.

5. **Report what went out** — show the image, the caption, the category, and the
   sheet row. He approved the row, not the render; this is how he sees what it
   became.

**One row per invocation. Never a batch.** `post camping` means one post.

**This command is the only path that publishes without asking.** Everything in
§Non-negotiables still applies to every other route.

## Scheduled posting — three a day, unattended

`[built 2026-09-17]` The same flow as §Autonomous posting, with no operator in
it. One command does the lot:

```
npm run -w data potw:auto -- --sheet <url> --category <name> [--dry-run]
```

Build the next queued row → publish the post → publish its story → tick the
sheet. `--dry-run` stops after building the container: nothing is published and
the sheet is not touched, which makes it the safe way to check the whole chain.

launchd drives it three times a day in local time — **10:00 campground, 15:00
scenic, 20:00 oddities**. `bin/potd-auto` picks the category from the clock hour,
so one job covers all three slots; `bin/launchd/com.yotrippin.potd.plist` carries
the install steps in its own header.

**What it does that a human used to do, and the reasoning:**

- **It ticks the sheet through the Sheets API** (`sheet-write.ts`, service
  account `potd-sheet-writer@…`). Before this, a tick needed a browser. That
  mattered more than convenience: **an untickled row stays queued, so the next
  run republishes it** — three times a day, on a live account.
- **A republish guard sits in front of the publish call.** Every post is recorded
  to `~/.config/overlander/potd-published.jsonl`, and a row found there is
  REFUSED even if the sheet still shows it unposted. This is the backstop for
  "published but not ticked", the one state that needs a human.
- **`markPosted` refuses a cell that is already filled**, so a double-post
  surfaces instead of being papered over, and it **reads the cell back** rather
  than trusting HTTP 200.
- **An empty queue is success**, not failure. A caught-up queue is normal, and a
  scheduler that errors on it just makes noise three times a day.
- **A missed slot is skipped, not posted late.** launchd fires a missed calendar
  job on wake; by then the hour matches no slot, so it exits. A 10am post is not
  wanted at 4pm.

**⚠️ The queue is the ONLY quality gate.** Nothing in code can tell a real place
from a joke — a run on 2026-09-17 published "Slappys Post Pile" over a photo of
Devils Postpile because that is what the row said. Three posts a day means
**21 rows a week**, and whatever is in them goes out under the
**yoTrippin! verified** badge.

**Prerequisites, each of which fails loudly rather than silently:**

- `IG_ACCESS_TOKEN` in the SCHEDULED clone's `data/.env` — `data/.env` is
  per-workspace, and the schedule points at `~/Code/overlander`, not a Conductor
  workspace.
- The service-account key at `~/.config/overlander/sheets-service-account.json`,
  **and the sheet shared with that account's email as an Editor**. A read
  succeeds without the share — the sheet is publicly readable — so only a write
  proves it.
- The Instagram token lasts ~60 days. When it expires the posts simply stop;
  the log will say so.

## Browsing / reusing past posts

Not part of the make-a-post flow — for when the user asks to see or reuse
history:

```
npm run -w data potw:posts -- --list            # recorded posts, newest first
npm run -w data potw:posts -- --reuse <id>       # show a past post's metadata + archive paths
```

`--reuse <id>` prints the archive paths; `Read` the archived `image.png` to
re-display the post. It never re-renders or writes.
