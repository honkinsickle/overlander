# 2026-09-17 — Publish Pin of the Day through the Instagram API (decision record)

> **BUILT the same day.** `data/pin-of-the-week/publish-instagram.ts` (library) +
> `publish.ts` (CLI) + 14 vitest tests + the `potw:publish` npm script +
> `IG_ACCESS_TOKEN` in `data/.env.example`, and `.claude/skills/pin-of-the-day/SKILL.md`
> §9 rewritten so the API is the primary path and the browser is the fallback.
> No existing module changed; no new dependency. Verified end to end with
> `--dry-run` against the live account — **no real post has gone out through the
> API yet**, because every category queue was empty.

## The problem

Building a post was automated; **publishing it was not.** Every post and story
through 2026-09-16/17 was hand-driven in a browser: Create → Post, attach the
file to a hidden `<input type="file">`, set the crop to Original, paste the
caption, turn the Facebook toggle off, click Share. Stories were worse — story
creation appeared **only** in the Instagram bundle served to a fresh incognito
mobile sign-in, for reasons never established, and `SKILL.md` had no story step
at all.

## The question that turned out not to matter

The standing handoff said the API route was gated on one thing: **is the
Instagram account connected to a Facebook Page?** The browser composer's
cross-post target read "Fresno Smooth · Friends", which looks like a personal
profile, and the Graph API route needs a Page.

It needs no Page. The app is configured as **"Instagram API with Instagram
login"** (`graph.instagram.com`), which authenticates the Instagram account
directly. The Page question was answered by reading one dashboard screenshot.
Recorded because a whole planned investigation was unnecessary, and because the
*other* flavour ("API setup with Facebook login") is the one that would have
needed it.

## Decisions

**1. The API is the primary publish path; the browser is the fallback.**
Not a dual path chosen per run. The browser route stays documented because a
missing or expired token is a real failure mode, but it is explicitly secondary
and switching to it must be said out loud. §9a's old instruction — *"do NOT try
to substitute some other automation (curl, the Instagram API, a script)"* — is
marked corrected in place rather than deleted, because that line was right when
written and the reason it changed is worth keeping.

**2. Renders are staged in a public bucket on TEST, and deleted immediately.**
Instagram **fetches** the image; there is no upload endpoint, so the file must be
publicly reachable for the length of the call. `ig-publish` on TEST
(`znldzjdatkogdktymtvi`), JPEG-only mime allowlist, 10MB cap.

- **TEST, not PROD** — an object exists for one call, so a project wipe costs
  nothing, and staging into PROD would put a render in the wrong project for no
  benefit. `publish.ts` calls `assertTestProject()` to enforce it.
- **Deleted in a `finally`**, so a FAILED publish cannot leave a public url of a
  half-published render behind. A removal failure is reported as `cleanupError`
  and never masks a successful publish — a leftover JPEG is a smaller problem
  than a post that reads as failed.

**3. `--dry-run` builds a container and stops.** Publishing is two calls
(container, then publish) and a container alone puts nothing on the account and
expires in 24h. So the dry run exercises the token, the permission, the staging
url AND Instagram's own fetch of the image, one call short of going live. This is
the check to run after any credential change.

**4. The API path uses `story.png`, never `story-web.png`.** The 1080x2340
padding shipped in #457/#459 exists only because Instagram's **browser** composer
sizes the image to the window and bakes that shape in. The API takes the 9:16
render as-is, so the padded variant is the one file this path must avoid. A
feature from two PRs earlier became fallback-only the day the API landed.

**5. Post and story are two separate invocations.** Stories carry no caption, so
the CLI does not read one for `--story`. A story failure does not undo the post
and does not block the sheet write-back: the post is out, so the row is posted.

**6. JPEG re-encoding reuses `@napi-rs/canvas`.** Already a dependency of the
compositor, so no new package. Quality 90, dimensions preserved exactly —
resizing is what cost the logo and place name their edges in the browser flow.

**7. The CLI prompts before publishing; `--yes` skips it.** Without a terminal
and without `--yes` it refuses rather than assuming consent. `--yes` is what the
autonomous `post <category>` flow passes, where the queued sheet row is the
approval.

**8. Publishing does not touch the sheet.** Ticking `posted` stays a separate,
later step in the skill, preserving the existing load-bearing order:
confirmation first, write-back second.

## Measured facts behind the above

`[all 2026-09-17; app "yoTrippin - IG" 28134191792930138; account yotrippin.app —
BUSINESS, 8 media at the time]`

- Permissions `instagram_business_basic` + `instagram_business_content_publish`,
  both "Ready for testing" — **development mode, no app review**, which is
  sufficient for publishing to your own account.
- Stories supported via `media_type=STORIES` on the Instagram-login flavour —
  confirmed against Meta's content-publishing documentation, not from memory.
- JPEG only; image must be at a public url at publish time; **100 published posts
  per 24h**.
- A dry run produced container `18116012221925924` with status `FINISHED`,
  after which the bucket listed **0 objects** and `media_count` was still **8**.

## First real use, later the same evening

`[2026-09-17, after this PR merged as #461]` Two pairs published through the API,
both row-3 duplicates of already-posted rows (so both drew template 2 and neither
caption matched its original):

| category | post | story | state |
|---|---|---|---|
| `scenic` "Slappys Post Pile" | `18081969410681213` | `18120202114931826` | **removed from the account** |
| `oddities` "Trees of Mystery" | `17950043556270960` (`/p/DdaMA-XGIGI/`) | `18116267782823475` | live |

`media_count` went 8 → 9 on the first post and **stayed 9** after the second,
consistent with one added and one removed. The bucket listed **0 objects** after
all four publishes, so the staged-object cleanup holds on real runs and not only
in the dry run.

**The scenic pair is gone** — both ids return `does not exist` (code 100,
subcode 33) and the post is absent from `/me/media`. Whether Adam deleted it or
Instagram removed it **cannot be distinguished from the API side**. Its sheet row
still reads `posted`, so the queue is knowingly wrong for that row.

**A grounding stop fired inside the autonomous flow.** The scenic row's place
name was invented — "Slappys Post Pile" over a photo of Devils Postpile — and the
render put it under the **yoTrippin! verified** badge with a caption reading "get
every verified spot". §Autonomous posting says the queued row IS the approval;
the standing grounding rule says every field is real or absent. The publish was
paused and asked about. **The lesson is not "ask twice" — it is that a fabricated
field justifies a stop even in the one flow designed to publish unattended.**

**Two operational gotchas, both measured:**

- **`--dir` must be absolute.** The npm script's cwd is `data/`, so a
  repo-relative path resolves to `data/data/pin-of-the-week/…` and fails with
  `image.png not found`. Recorded in the skill; the build already prints the
  absolute dir.
- **A gviz sheet read is cached.** Two write-backs read as unchanged and were
  correct on a cache-busted re-read seconds later. Never conclude a sheet write
  failed from a single read.

## Still open

- ~~**No real API post has been made.**~~ **Done** — see the section above.
- **Whether an API publish cross-posts to Facebook is UNKNOWN — still, after four
  real publishes.** The browser composer had a toggle that defaulted ON; the API
  call has no such field and the account-level setting lives in Accounts Center.
  Adam's standing decision (2026-09-15) is Instagram only. The check was
  attempted and **failed for a dull reason**: a fresh CDP tab hit a Facebook
  login wall, and typing credentials is off-limits. Trees of Mystery is the clean
  test case — a real place, currently live.
- **Token expiry is unmeasured.** These tokens last ~60 days and are refreshable,
  but the refresh call mints a new token, so it was not run unprompted. No
  refresh automation exists.
- **The app secret may have been overwritten** when the token replaced the value
  in `data/.env`. Not needed for publishing; likely needed for refresh.
- **`data/.env` is per-workspace.** The token lives in this Conductor workspace
  only; a fresh workspace will have no token and `potw:publish` will refuse.
