# Blitzkrieg Import / Cache / Auto-Update Fix - Verification & Handoff Plan

**Goal:** Verify the completed worktree build (Wave A import-relink, Wave B manual caching, Wave C auto-update) resolves the owner's reported bugs, and lay out the remaining (mostly owner-run) gates.

**Status:** Implementation COMPLETE and adversarially audited (3 per-wave reviews + 1 ten-agent full-build correctness audit + 1 ten-agent performance/QC audit + 1 six-agent final pre-commit verification). No blocker/high code defects; all confirmed findings fixed or consciously deferred (below). The pre-commit gate caught one commit-hygiene blocker (worktree scaffolding `.env.local` / `.wt-meta.json` staged) - resolved by adding them to `.gitignore` and unstaging before the commit.

**Branch / worktree:** `feat/import-upload-cache-fix-260624` at `/Users/thenorwegianoilfund/Coding/_wt/Blitzkrieg-by-Dominatemedia/import-upload-cache-fix-260624` (internally consistent at v1.3.13: `main.js`, `CSXS/manifest.xml`, `version.json`).

---

## Root cause of "it doesn't seem updated at all"

The owner was viewing `/Users/thenorwegianoilfund/Coding/Blitzkrieg-by-Dominatemedia/index.html` - the **main checkout**, stranded on branch `feat/local-sync-and-audit-fixes-2026-05-07` (HEAD `24e2fa2`, `index.html` last modified May 7, `BLITZKRIEG_LOCAL_VERSION = 1.3.12`, zero of this build present). The screenshot shows OLD behavior. The fixes live ONLY in the worktree. This is the same stale-main-checkout pattern previously seen on insight-flow-83.

---

## Screenshot symptom verdicts (5-lens audit, all confirmed)

| # | Symptom | Verdict |
|---|---------|---------|
| S1 | "After Effects bridge missing" red banner | expected-not-a-bug (browser has no `__adobe_cep__`; both old and new show it; resolves when loaded inside AE) |
| S2 | "Auto-update to v1.3.13 keeps failing / Reinstall manually" | **fixed-by-this-build** (three independent cures: version gate returns early at local==remote; defer-not-fail for the no-bridge case; `loadFailedRecord` auto-clears the stale 3-strike record on first load) |
| S3 | "54 missing thumbnails, 53 missing previews" toolbar count | deferred-backlog (owner-deferred thumbnail generation; Wave B caches existing thumbnails, does not generate missing ones; count is honest) |
| S4 | Letter-placeholder cards (B/C/D) | deferred-backlog / needs-AE (same missing-thumbnail population; needs AE-side generation) |

---

## Post-audit fixes applied (this session)

- **INT-1 (medium):** import fast-path is now content-version gated (`main.js` ~3790) - a stale local mirror falls through to sync-then-import (which re-pulls) instead of importing an out-of-date `.aep` while the grid shows the fresh thumbnail.
- **F1 (low):** `updateMetadataAfterGeneration` now bumps `metadata.updatedAt` (`main.js` ~8107) so a regenerated thumbnail changes the content fingerprint and a synced mirror re-pulls it on next Sync All.
- **DH-2 (nit):** `_applyLocalAssetCache` skips no-thumbnail (deferred-backlog) templates (`main.js` ~2103) - avoids a doomed `file://` load + cloud re-sign per placeholder card.
- **DH-3 (nit):** `syncAll` JSDoc `@returns` now lists the `failed` field (`local-sync.js`).
- **Em-dash hygiene (owner hard rule):** removed em dashes from 10 user-facing strings - the screenshot's missing-thumbnail label (F2) plus 9 pre-existing toasts/tooltips/progress labels (upload-auth error, approve/withdraw toasts, 2 memory-limit toasts, generation progress, 2 sync-badge tooltips, version-check dot tooltip). Verified ZERO em/en-dashes or curly quotes remain in any user-facing JS string.
- **PERF-1 (performance pass, behavior-preserving):** the cold-load render path re-parsed the entire localStorage sync-state blob ~225 times per library load (and again on every Sync All) - `_applyLocalAssetCache` called `getLocalDirIfComplete` per comp, and each call `JSON.parse`d the whole blob twice (`_getLibraryPath` + `_loadState`). Added a batch resolver `getLocalDirsIfComplete(items)` (`local-sync.js`) that parses state ONCE for the whole grid; `_applyLocalAssetCache` (`main.js`) now calls it once with a fallback to the per-comp path. ~225 parses -> 1, identical dir-resolution logic. Verified behavior-equivalent across all cases by a 6-agent adversarial pass. (Date-sort comparator and import-path tree-walk micro-opts were considered and deliberately skipped - negligible / relink-correctness-sensitive.)

## Deferred / out-of-scope (documented, not fixed)

- **Preview/thumbnail backfill** (S3/S4 root) - owner explicitly deferred AE-side generation of the 54 missing thumbnails to a separate pass.
- **INT-4 / REG-4 (low/nit, PRE-EXISTING):** the single + bulk thumbnail-generation calls use an unlabeled `setStashInProgress(true)` -> 90s "unknown" watchdog (`main.js` ~2895, ~8187); a heavy comp can trip it mid-render. Pre-existing, in the generation flow (not import/cache/update). Recommend labeling these `'generate'` with a longer watchdog in a follow-up.
- **INT-2 (nit):** `cloudLibrary.verifyTemplateIntegrity` is dead (zero callers); the live import/upload integrity is implicit (no-.aep error + `_scanSurviving` BLITZ_MISSING + upload size-cap). Recommend deleting the dead helper in a follow-up.
- **REG-1 (low):** the BLITZ_MISSING import warning now scans all imported comps (not just the main comp), so it can warn about missing footage in an orphan/unused precomp. Kept intentionally - the warning is honest and non-blocking, and surfacing genuinely-incomplete templates is the point of the wave.
- **STG-1 storage remediation:** the dependency backfill (`metadata.json.dependencies` is always `[]` today, so Wave A's dependency-download is dormant) - see `docs/STORAGE_REMEDIATION_STG-1.md`. Review-only; nothing run.

---

## Remaining verification gates (owner-run - cannot be done from here)

A CEP panel runs inside After Effects, not a localhost server, so these are the owner's to run.

- [ ] **Browser smoke (worktree):** open the worktree `index.html` in a browser. Confirm the "Reinstall manually" banner is GONE (S2), the grid renders, and search/sort/filter work. (Validates Wave C + render; import/cache need AE.)
- [ ] **In-AE import -> timeline:** load the worktree extension in AE, import a template that previously imported with missing footage; confirm it lands relinked with no `[BLITZ_MISSING]` warning.
- [ ] **In-AE Sync All:** click Sync All; relaunch; confirm thumbnails serve from disk and a second Sync All reports "already up to date."
- [ ] **In-AE upload:** stash/upload a comp; confirm no freeze and it completes.
- [ ] **In-AE stale re-import:** change a template's cloud content, re-import WITHOUT Sync All; confirm INT-1 fix re-pulls the fresh `.aep` (not the stale mirror).

---

## How to get this in front of the owner (decision required)

The owner is viewing the stale main checkout. Options (per worktree policy, merge/PR need explicit approval):

1. **Test from the worktree** (no merge): open the worktree `index.html` / point AE at the worktree extension. Fastest validation; main checkout stays as-is.
2. **Bring main current:** the main checkout is 1.5 months stale on a May-7 branch; updating it (checkout this branch there, or merge to `main`) makes the path the owner views reflect the work.
3. **Open a PR** for review before any merge.

Recommend (1) to validate, then decide (2)/(3) after the in-AE gates pass.
