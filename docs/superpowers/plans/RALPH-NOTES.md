# Ralph Loop Notes

Branch: `feat/blitz-perf-missing-files-260724`
Plan: `docs/superpowers/plans/2026-07-24-blitzkrieg-perf-and-missing-files.md`

## Status

| Task | Status | Proof |
|------|--------|-------|
| 1 - test harness | DONE | `node --test test/harness.test.js` |
| 13 - stop 68GB auto-resume | DONE | `node --test test/full-sync-optin.test.js` |
| 4 - bundle completeness | DONE | `node --test test/bundle-completeness.test.js` |
| 5 - partial never marks complete | DONE | `node --test test/bundle-completeness.test.js` |
| 9 - list ladder discipline | DONE (partial, see below) | `node --test test/list-ladder.test.js` |
| 14 - pre-sizing list storm | DONE (partial, see below) | `node --test test/presize-storm.test.js` |
| 15 - cache wipe on bad name | TODO | |
| 16 - panel-thread polish | TODO | |

## Dependencies deferred to out-of-scope tasks

- **Task 13 opt-in persistence** uses localStorage only. The file backstop is Task 12
  (out of scope), so an AE quit that clears localStorage resets the opt-in to OFF.
  That fails safe: the mirror stops rather than starting unasked.
- Task 13 found three auto-start sites, not one: `js/main.js:915` and `:1010` start the
  mirror merely on opening the Sync view. Both are now opt-in gated. The explicit
  "Download all" and "Resume" buttons set the opt-in; "Cancel" clears it.

## Task 9: one step deliberately NOT done

Plan Task 9 Step 6 raises `LIST_CAT_CONCURRENCY` from 2 to 6. **Skipped on purpose.**
That step is only safe once Task 3 (the storage.objects RLS consolidation) has landed,
and Task 3 is out of scope for this loop. Raising concurrency against the CURRENT
backend, where a prefix list takes 11.5s under RLS, would put more concurrent slow
queries on the same pool and make the timeouts worse, not better.

Do this immediately after Task 3 merges, and re-measure.

## Task 14: one step deferred

Plan Task 14 Step 1 ("read sizes from metadata instead of listing") needs each
template's byte total persisted into the shared manifest at publish time. That is the
manifest publish path, which is Task 11, out of scope for this loop. Steps 2 to 4 are
done, which removes the storm itself:

- `getTemplateSize` recursion is now bounded at 3 (was uncapped `Promise.all`; a test
  measured peak 20 concurrent lists for a template with 20 subfolders).
- Pre-sizing workers cut from 4 to 2, and they now yield entirely while a user action
  is in flight.
- Circuit breaker: the pass stops after 5 consecutive failures instead of churning the
  queue at full speed against a failing backend.
- Errors are logged instead of silently swallowed.

Do Step 1 with Task 11, then the pre-sizing pass can be deleted outright.

## Findings from execution, not in the original plan

- **The plan's Task 5 used `contentCurrent`.** The real field in `js/local-sync.js` is
  `complete`. Implemented against the real schema: `markTemplatePartial` sets
  `complete: false` plus `partial: true` and `missing: []`, so every existing read path
  (serve-from-mirror at :155, pending-for at :721, staleness at :930) already treats a
  partial mirror as needing a re-fetch. No new read paths were needed.
- **The RPC memoization had a concurrency race.** Checking `_rpcFolderListDown` before
  any worker sets it meant a down RPC was still probed once per worker. Fixed by sharing
  the first probe promise (`_rpcFolderListProbe`). Caught by the test, which measured 2
  probes at `LIST_CAT_CONCURRENCY = 2`.
- **`downloadStorageFiles` already had a `skipFailures` + `skipped` mode.** Task 4's
  `downloadStorageFilesSettled` delegates to it rather than adding a second worker pool.
- **TDD ordering slip, recorded honestly:** the RPC memoization in Task 9 was written
  before its test. The test was added immediately after and did fail against the racy
  implementation, which is how the race was found.

## Out of scope, do not start in this loop

Tasks 2, 3, 6, 7, 8, 11, 12. No Supabase migration, no RLS change.
