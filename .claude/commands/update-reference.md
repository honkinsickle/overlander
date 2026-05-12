---
description: Propose a structured edit to the Alaska reference doc (does not auto-apply)
argument-hint: plain description of the change
---

Proposed change: **$ARGUMENTS**

Workflow:

1. Locate the affected section(s) in `planning/reference/alaska-v3.md`
2. Show a before/after diff (use fenced markdown blocks labeled `BEFORE` and `AFTER` for clarity)
3. Identify downstream effects:
   - Does this shift a Fixed_Date_Event in section 03? Re-check the whole anchor chain in section 04.
   - Does it change a fuel calculation in section 05?
   - Does it invalidate a permit lead time in section 08?
   - Does it affect a border crossing window (e.g. Top of the World Hwy seasonal hours)?
   - Does it conflict with a photography priority in section 06?
   - **Does it touch §03 `Permit Ref` or §08 `Name`?** Both columns must stay in lockstep — the §03 value is a literal lookup into §08's `Name` column. Renaming a permit in §08 requires updating every §03 row that references it. See `master-prompt-v1.1.md` §G for the full schema.
   - **Does it add a new fixed event without a `Permit Ref`?** Every §03 row must have one — `—` for events with no permit, otherwise the exact §08 `Name` (comma-separated for multiple).
4. **Stop and wait for explicit confirmation before applying.** Do not write changes to `planning/reference/alaska-v3.md` until I confirm with "apply", "yes", or similar.

On confirmation:
- Apply the edit
- Bump the version in the doc header (e.g. v3 → v3.1)
- Update the "Last Updated" date in the footer to today's date
- Recommend re-running `/validate` to catch any new inconsistencies the change introduced
