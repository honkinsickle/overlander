---
description: End-of-day doc pass — update the doc set to match this session
---

Walk the doc set in CLAUDE.md's END-OF-DAY DOC PASS section and update what
this session actually changed.

- STATE.md and LOG.md every time.
- decisions/, architecture/, DATA_INVENTORY.md only if this session touched
  what they describe.
- Verifiable only: if a claim isn't backed by a commit, PR, or file in the
  repo, don't write it. Say what you dropped and why.
- LOG.md is append-only — today's entry may gain bullets; prior dates are
  never edited.
- If the working tree is dirty on a feature branch, use a git worktree and do
  not disturb it.

Show me the diff. Do not commit or push without my say-so.
