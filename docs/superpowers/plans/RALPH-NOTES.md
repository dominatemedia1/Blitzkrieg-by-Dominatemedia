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
| 15 - cache wipe on bad name | DONE | `node --test test/cache-wipe.test.js` |
| 16 - panel-thread polish | DONE | `node --test test/grid-paging.test.js` |

## Dependencies deferred to out-of-scope tasks

- **Task 13 opt-in persistence** uses localStorage only. The file backstop is Task 12
  (out of scope), so an AE quit that clears localStorage resets the opt-in to OFF.
  That fails safe: the mirror stops rather than starting unasked.
- Task 13 found three auto-start sites, not one: `js/main.js:915` and `:1010` start the
  mirror merely on opening the Sync view. Both are now opt-in gated. The explicit
  "Download all" and "Resume" buttons set the opt-in; "Cancel" clears it.

## Measured results

- **First paint with a warm meta cache: 2521ms -> 2.3ms.** `_ensureMetaRehydrated`
  awaited `Promise.all([meta, signedUrl])`. The meta half short-circuits on a valid
  localStorage cache, but the signed-URL half does not, so a user whose meta cache was
  warm and whose signed-URL cache was empty still sat through the full 2.5s host
  round-trip. Signed URLs only matter for thumbnails, which fill in after paint.
- **Recursive size listing: peak 20 concurrent lists -> peak 3** for a template with
  20 subfolders.
- **Failing-category ladder: ~108s -> ~46.5s** (dropped the 60s third attempt), and a
  timed-out attempt now aborts instead of staying live on the pool.

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
- **CRLF regression, caught and fixed before merge.** `js/cloud-library.js` is a CRLF
  file. Scripted edits rewrote it as LF, which turned a surgical change into a 6085-line
  whole-file diff. Restored to CRLF; the diff is now only the intended hunks. Any future
  scripted edit to that file must write bytes with CRLF preserved.
- **TDD ordering slip, recorded honestly:** the RPC memoization in Task 9 was written
  before its test. The test was added immediately after and did fail against the racy
  implementation, which is how the race was found.

## Out of scope, do not start in this loop

Tasks 2, 3, 6, 7, 8, 11, 12. No Supabase migration, no RLS change.

## Second audit pass, findings 4-6 (2026-07-25)

Surfaces the first pass never read: `jsx/hostscript.jsx`, `js/auth.js`,
`js/telemetry.js`, plus the three log patterns left unexplained.

**Not a defect, closed:** `Telemetry sync failed: HTTP 0`. `xhr.status === 0` is the
offline/CORS case; `js/telemetry.js:278` warns and falls through to `_queueAndDone`,
so the payload is queued and flushed later. Working as designed, just noisy.

**Not a defect, closed:** mirroring `preview/frame_N.png` to disk. It looked like dead
weight, but `_applyLocalAssetCache` (js/main.js:2567) does consume those files for
offline hover. A stale comment above it claimed the opposite; corrected.

**Finding 4 (fixed): fabricated preview paths on a short mirror.** The offline-hover
block invents `frame_0..frame_(previewFrameCount-1)` file:// URLs from metadata, with
no per-frame fallback, gated only on `complete` (which promises the .aep and nothing
else). Two log patterns prove those frames are routinely absent: `preview mismatch for
X: metadata says 31, storage has N` (7 users) and `mirror: skipped unrecoverable file
X/preview/frame_N`. Added `localSync.getWholeMirrorDirs`, which additionally requires
`!partial`, and pointed the hover/alt-thumbnail block at it. The primary comp.png path
still uses the looser gate, so a partial mirror keeps its disk thumbnail.

**Finding 5 (fixed): the preview list ladder re-ran on every hover.** Only success was
cached, so a folder whose listing kept failing paid the full 15s + 30s ladder on every
single hover, against the storage that was already the reason it was slow. Added a 60s
negative cache, wired into all five existing invalidation sites.

**Finding 6 (fixed): concurrent hovers stacked ladders.** The card-level
`signingInProgress` guard reset itself after 15s, shorter than the ladder's own 45s
worst case, so hover 2 started a second run while hover 1 was still going. Added an
in-flight promise map in `cloud-library.js` (covers every caller, not just the grid)
and raised the card guard to 60s.

Suite: 40 tests, 0 failing. `js/cloud-library.js` CRLF preserved (3155).

## Eval pass, findings 7-9 (2026-07-25)

**Finding 7 (fixed): leaked 15s timers on every load.** `Promise.race([work, timeout])`
settles when the work wins, but the losing timer keeps running to its full deadline.
`_listWithTimeout` and `_downloadWithTimeout` clear theirs; `_listFoldersViaRpc` and
`_fetchThumbnailStatus` did not. That is ~24 categories + 1 status call = ~25 live 15s
wakeups per library load, accumulating because the panel reloads on every focus event.
Both now clear on the success AND rejection paths (`Promise.prototype.finally` stays
banned for CEP 8/9). This is also why the test suite sat for 15s: 15.5s to 2.6s.

**Finding 8 (fixed): mirror file downloads had zero retries.** Live logs for the 7 days
to 2026-07-25 show `mirror: skipped unrecoverable file .../11.aep (Failed to fetch)` and
several `(Footage)/*.mp4` skips. All the "Failed to fetch" entries come from one user
inside one bad half hour, so they are transient network drops, not dead objects. A skip
was permanent: the template still completed on its .aep and nothing went back for the
rest. A skipped .aep IS the reported "project files are missing". Added one retry with a
400ms backoff on the skip path only; the strict throw-on-any-failure contract that
comp.png and dependency callers rely on is untouched.

**Finding 9 (test harness): the fake blob had no `.text()`.** Every metadata download
"succeeded" and then yielded zero comps, so the cold-path benchmark was silently
measuring a fully degraded load. Fixed; the cold path builds 384 comps in 247ms.

**Not a defect, closed:** the `Failed to fetch` cluster (30 events). One user,
2026-07-20 14:33 to 14:55, across root list, category list, getTeamFavorites and
getTemplateSubmitters at once. That is their connection dropping, not a code path.

### New: `test/perf.bench.js`, wired into CI as a BLOCKING step

Budgets on the paths an editor actually waits on, against a 384-template fake library
at 12ms/op. A regression that only shows up as slowness now fails the build.

| Path | Measured | Budget |
|---|---|---|
| cold slow path, no cache, no RPC | 247ms | 12000ms |
| timers left live after that load | 0 | 0 |
| warm cache first paint, hung host bridge | 2ms | 250ms |
| worst-case ladder per category | 45000ms | 45000ms |
| 80 hovers on a failing preview folder | 0ms / 2 lists | 500ms |
| healthy 3-file mirror | 15ms | 200ms |

Suite: 46 tests, 0 failing, 2.6s. CI GATE: PASS. `js/cloud-library.js` CRLF preserved.
