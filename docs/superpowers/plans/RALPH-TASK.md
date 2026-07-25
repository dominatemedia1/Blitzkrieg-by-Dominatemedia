# Ralph Loop Task Brief

## Workspace

Work in the git worktree:

```
/Users/thenorwegianoilfund/Coding/_wt/Blitzkrieg-by-Dominatemedia/blitz-perf-missing-files-260724
```

Branch: `feat/blitz-perf-missing-files-260724`

- Absolute paths only. Never touch the main checkout at `~/Coding/Blitzkrieg-by-Dominatemedia`.
- Never run `git stash`, `git checkout`, `git reset`, or `rebase`.
- Do not merge to main, do not open a PR, do not delete branches.

## Scope

Execute `docs/superpowers/plans/2026-07-24-blitzkrieg-perf-and-missing-files.md` task by task, in this order, and ONLY these tasks:

1. Task 1 (test harness)
2. Task 13 (stop the 68GB auto-resume)
3. Task 4 (bundle completeness contract)
4. Task 5 (partial bundle never marks mirror complete)
5. Task 9 (list ladder discipline)
6. Task 14 (kill the pre-sizing list storm)
7. Task 15 (buildCompsFromMetadata cache wipe)
8. Task 16 (panel-thread polish)

## Strictly out of scope

Do NOT start these. Do NOT apply any Supabase migration. Do NOT call `apply_migration`. Do NOT modify any RLS policy.

- Task 2 (Windows updater, needs a Windows machine to verify)
- Task 3 (RLS consolidation, production, needs human review of the truth table)
- Task 6 (streaming download, needs a real 1.7GB transfer timed in AE)
- Task 7 (partial-template UI, needs a logged-in AE screenshot)
- Task 8 (root RPC, needs a migration)
- Task 11 (manifest publish, needs a migration)
- Task 12 (local-sync file backstop, pairs with Task 13 opt-in persistence)

If an in-scope task appears to depend on one of these, stop and record the dependency in `docs/superpowers/plans/RALPH-NOTES.md` rather than doing the out-of-scope work.

For Task 13 specifically: `getFullSyncOptIn` / `setFullSyncOptIn` may use localStorage only for now. The file backstop is Task 12 and is out of scope. Note that in RALPH-NOTES.md.

## Global constraints

Follow the plan's Global Constraints section exactly:

- No build step, no bundler, no ES modules. Every js file stays an IIFE.
- No `Promise.prototype.finally()`. Use the two-argument `.then(onOk, onErr)`.
- ES3 only in `jsx/hostscript.jsx`: no const, no let, no arrow functions, no atob.
- `var` only in `js/main.js`.
- No em dashes, no en dashes, no decorative arrows in any user-facing string. The CI gate blocks them.
- No save toasts.
- CSS custom properties only, never a hardcoded colour or spacing value.
- Use `window._blitzLog(msg, level)` in cloud-library.js and local-sync.js, `debugLog(msg, level)` in main.js.

## TDD is mandatory

For every task:

1. Write the failing test FIRST.
2. Run it. Confirm it actually fails, and that it fails for the stated reason.
3. Write the minimal implementation.
4. Run it. Confirm it passes.

Never write implementation before a failing test exists. Never weaken or delete a test to make it pass. Never add `as any`, `@ts-nocheck`, or loosen any config to silence an error.

## Commits

Commit after each task using the exact commit message given in that task's final step. Commits auto-push via the post-commit hook. Do not squash, do not amend earlier commits.

## Each iteration

1. Re-read the plan file.
2. Run `git log --oneline origin/main..HEAD` to see which tasks are already committed.
3. Continue from the first task not yet done.
4. Update `docs/superpowers/plans/RALPH-NOTES.md` with one line per task: task number, status, and the test command that proves it.

## Before finishing

- Run `node --test test/` from the worktree root. Every test must pass.
- Run `git diff origin/main...HEAD --stat` and confirm nothing outside the eight in-scope tasks was modified.
