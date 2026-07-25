# Ralph Loop Notes

Branch: `feat/blitz-perf-missing-files-260724`
Plan: `docs/superpowers/plans/2026-07-24-blitzkrieg-perf-and-missing-files.md`

## Status

| Task | Status | Proof |
|------|--------|-------|
| 1 - test harness | DONE | `node --test test/harness.test.js` |
| 13 - stop 68GB auto-resume | DONE | `node --test test/full-sync-optin.test.js` |
| 4 - bundle completeness | TODO | |
| 5 - partial never marks complete | TODO | |
| 9 - list ladder discipline | TODO | |
| 14 - pre-sizing list storm | TODO | |
| 15 - cache wipe on bad name | TODO | |
| 16 - panel-thread polish | TODO | |

## Dependencies deferred to out-of-scope tasks

- **Task 13 opt-in persistence** uses localStorage only. The file backstop is Task 12
  (out of scope), so an AE quit that clears localStorage resets the opt-in to OFF.
  That fails safe: the mirror stops rather than starting unasked.
- Task 13 found three auto-start sites, not one: `js/main.js:915` and `:1010` start the
  mirror merely on opening the Sync view. Both are now opt-in gated. The explicit
  "Download all" and "Resume" buttons set the opt-in; "Cancel" clears it.

## Out of scope, do not start in this loop

Tasks 2, 3, 6, 7, 8, 11, 12. No Supabase migration, no RLS change.
