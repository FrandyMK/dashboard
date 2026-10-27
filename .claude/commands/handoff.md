---
description: Update CLAUDE.md with what changed this work session
---
Update CLAUDE.md so the next session can pick up exactly where this one left off.

1. Find what changed. Get the commit where CLAUDE.md was last updated with
   `git log -1 --format=%H -- CLAUDE.md`, then look at every commit since then,
   plus `git status` and `git diff` for uncommitted work.
2. Read the changed files where you need to understand them. Base every update
   on the code and git history, never on assumptions.
3. Update CLAUDE.md:
   - Fix any section that no longer matches the code (file roles, endpoints,
     data model, deployment, backups).
   - Remove finished items from "Known issues" and the roadmap; add new loose
     ends you notice.
   - Rewrite "Next step" to reflect where the work stopped.
   - Add a dated entry at the top of "Session log": 2–4 lines on what was done
     and any decisions made, including why.
4. Only edit CLAUDE.md. Do not change any other file.
5. If something is unclear, such as whether a feature is finished, ask me
   rather than guessing.
6. Finish with a short summary of what you changed.
