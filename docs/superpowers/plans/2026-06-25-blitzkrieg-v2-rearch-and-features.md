# Blitzkrieg v2 — Crash Fix, Fast Local Import, Editor Workspace, Direct Publish, Security

> **For agentic workers:** REQUIRED SUB-SKILL — use superpowers:subagent-driven-development (fresh subagent per task + two-stage review). Steps use `- [ ]`. The owner has NO After Effects installed and cannot test; verification rigor is entirely on us — every task ends with an evidence-based, non-AE-runnable check (syntax, grep, unit-on-pure-helpers, DB query, or a documented manual-AE step the owner forwards to an editor).

**Goal:** Make the panel never crash, make import fast via a full local mirror, give each editor a "My Work" + favorites workspace, let editors publish comps without an approval gate (with an admin "Recently Added" monitor), and close real security holes — without leaving the CEP/vanilla-JS architecture.

**Architecture:** CEP panel, vanilla-JS IIFE modules (NO build step), ExtendScript ES3 host (`jsx/hostscript.jsx`), Supabase backend (project `kwrmdxptrrvlqxdcasho`, bucket `blitzkrieg`, shared with Insight Flow). Confirmed by research: CEP is correct (UXP does not exist for AE yet); codebase is sound, not a rewrite; identity/auth already real.

## Global Constraints (every task inherits these)
- **AE 2020+ must work → CEP 8/9 floor → Chromium 57/61.** Panel JS may use ES2017 (async/await OK) but NOT: `Promise.prototype.finally` (Chrome 63), `content-visibility` (85), native `loading="lazy"` (76), CSS `aspect-ratio` as the only mechanism (88 — keep the `@supports` fallback). `IntersectionObserver` (51) IS available. `jsx` stays strict ES3 (`var`, no `let/const/arrow/template-literals/Array.find/includes/atob/btoa/fetch/Promise`).
- **No build step.** Vanilla IIFE modules; `index.html` references `js/*.js` directly. New files follow the IIFE + `'use strict'` + `window.X` export pattern.
- **NO em-dashes / curly quotes in user-facing strings** (toasts, `.textContent`, `.title`, button labels). Comments OK.
- **No new file > ~800 lines.** When splitting `main.js`, extracted modules stay focused.
- **Supabase migrations run on the SHARED project** — single-migration-writer rule (only one worktree applies at a time); anything touching `team_members` / shared RPCs must be reviewed for Insight Flow impact, never blind-applied. Default-deny RLS; `WITH CHECK` on every insert/update policy; never key a table to a client-supplied `user_id` (default to `auth.uid()`).
- **Never weaken type/security to silence an error.** Keep `escapeForExtendScript` + `escapeHTML` + `validateName` on every user-input path. Server is authoritative for admin checks (client `isAdmin()` is UX only).
- **Never overwrite/delete production storage** without explicit owner OK (per-op).
- **Verification without AE:** `node --check` all js; jsx parses; the new CI gate (Phase 0) must pass; DB claims verified by live query; any behavior only testable in AE is written as a precise manual-check the owner hands to an editor.

## Owner decisions locked (2026-06-25)
AE floor = 2020-or-older (ES3-safe). Build = no-build + safety gates. Local import = download ENTIRE library. Favorites = per-editor + a shared team set. My Work = templates the editor uploaded, labelled by `team_members.full_name`. Approval gate = removed (auto-approve, Option B) + admin "Recently Added" monitor.

---

## PHASE 0 — Foundations (safety net first, because the owner can't test)

### Task 0.1: Commit the verified QC-remediation fixes as the stable base
The atob/local-mirror/hover/EFF-1/CSS/updater fixes (prior plan `2026-06-25-blitzkrieg-deep-qc-remediation.md`) are applied + adversarially verified but uncommitted. Commit them so v2 builds on a clean base.
- [ ] `node --check` all js; jsx parses; commit on `feat/thumb-perf-cachefix-260624` (owner authorizes the commit).

### Task 0.2: Zero-dependency blocking CI gate (the no-AE safety net)
**Files:** Create `scripts/ci-check.sh` + `.github/workflows/ci.yml`
**Steps:**
- [ ] `ci-check.sh`: `node --check` every `js/*.js` (exclude vendored `supabase.min.js`, `CSInterface.js`); copy `jsx/*.jsx`→`.js` and `node --check`; grep FAIL on em-dash/curly-quote in user-facing strings (`showToast(`, `.textContent`, `.title =`, `placeholder=`); grep FAIL on ES3 violations in `jsx/` (`atob(`, `btoa(`, `\blet \b`, `=>`, `` ` ``, `.finally(`, `fetch(`, `Promise`); grep FAIL on `js/` ES2018+ that breaks CEP 8 (`.finally(`). Non-zero exit on any hit.
- [ ] `ci.yml`: run `ci-check.sh` on push/PR. It BLOCKS (per the "gates block" rule).
- [ ] Verify: run `bash scripts/ci-check.sh` locally → exits 0 on clean tree; temporarily inject `atob(` into a jsx → exits non-zero.

### Task 0.3: Split `js/main.js` (8,447 lines) along existing sub-app seams
**Files:** Create `js/updater.js`, `js/submissions.js`, `js/analytics-view.js`; Modify `js/main.js`, `index.html`
**Approach:** Extract self-contained sub-apps into IIFE modules exporting via `window.*`, keep shared state accessors in main. Move: the updater (`installUpdate`/version/staging ~7100-7620) → `updater.js`; submissions + review-queue UI (~4600-5320, 5921-5967) → `submissions.js`; analytics dashboard (~5900-6500, `renderAnalytics*`) → `analytics-view.js`. Add `<script>` tags in `index.html` in dependency order BEFORE `main.js`.
- [ ] After each extraction: `node --check`; grep that moved functions are referenced via the new module; `main.js` shrinks below ~6,000 lines. (Do this as 3 separate reviewable commits — one module each.)
- [ ] Note: this is mechanical-but-risky (shared closure refs). Each extraction is its own task with its own review.

---

## PHASE 1 — KEYSTONE: stop the crash (grid virtualization). Highest priority.

**Root cause (grounded):** `renderCompsGrid` (main.js:2264) + `loadMoreComps` (2671, append-only `insertAdjacentHTML beforeend`) never remove cards; `getLazyLoadObserver` (1833) unobserves on first paint and never releases. Scrolling 378 cards pins ~378 full-res decoded bitmaps (~8 MB each) ≈ 1.5-3 GB → renderer OOM → crash. Must be ES3/CEP-8-safe (no `content-visibility`).

### Task 1.1: Windowed/virtualized grid with DOM recycling + image release
**Files:** Modify `js/main.js` (render path 2264-2700), `CSS/style.css` (`#stash-grid`, `.stash-item`)
**Approach (ES5/CEP-8-safe):**
- Keep `allComps`/filtered list in JS. Render only a bounded window: compute columns-per-row from container width / grid-size min cell (140/180/240px), rows visible + 2-3 overscan rows → cap ~40-80 live `.stash-item` nodes regardless of library size.
- Use a top spacer + bottom spacer `<div>` whose heights = (off-window rows) × rowHeight so the scrollbar/scroll height stays correct.
- On scroll (throttled, existing `throttle()` + rAF): recompute the window; for each card leaving the window set `img.src = ''` (releases the decoded bitmap — THE fix) and recycle the node for the incoming card; re-hydrate via the existing IntersectionObserver/`hydrateLazyThumbnail`.
- Preserve: drag-drop, bulk-select, favorites star, preview-hover wiring, and the `data-events-bound`/`data-preview-bound` sentinels (main.js:2542 warns about recycle collisions — re-bind or delegate events on recycle).
- [ ] Unit-test the pure window math (`computeWindow(scrollTop, rowHeight, cols, total, overscan)`) in a jsdom/node harness: returns correct first/last index + spacer heights for top/middle/bottom/empty/one-row.
- [ ] Manual-AE check (owner → editor): open All view (378), scroll top→bottom→top repeatedly; DevTools heap stays bounded (does not climb monotonically); no crash; drag/import/favorite/hover still work.

### Task 1.2: Default landing view = a category, not All (zero-risk crash-exposure cut)
- [ ] Change initial view so the panel does not render all 378 on first paint (e.g. first real category, or an empty "pick a category" state). Verify in code; document the behavior change.

### Task 1.3: Re-verify the hover 12-frame cap is actually wired (research flagged a possible over-claim)
The cap lives in `cloud-library.js signPreviewFrames` (MAX_HOVER_PREVIEW_FRAMES=12). The R1 agent only checked main.js and missed it.
- [ ] Confirm `signPreviewFrames` samples ≤12 and that `startPreviewAnimation` receives the capped array; add a one-line debugLog of the served frame count so it is observable.

---

## PHASE 2 — Security hardening (some exploitable TODAY). Migrations on the shared project — review for Insight Flow impact.

### Task 2.1 (CRITICAL): Stop self-escalation to Blitzkrieg admin
**Finding C1:** `authenticated`/`anon` hold column `UPDATE` on `team_members.blitzkrieg_admin/blitzkrieg_access/role`; `team_members_self_update` RLS has no column restriction → any user runs `update team_members set blitzkrieg_admin=true where user_id=auth.uid()` → full bucket write/delete.
- [ ] Migration: `REVOKE UPDATE (blitzkrieg_admin, blitzkrieg_access, role) ON team_members FROM authenticated, anon;` and tighten `team_members_self_update WITH CHECK` so those columns + `user_id` cannot change (compare to existing row). Force changes through `set_blitzkrieg_access()` (already admin-gated).
- [ ] **Insight Flow review:** confirm IF does not rely on client UPDATE of those columns before applying. Verify post-migration: a non-admin self-UPDATE of `blitzkrieg_admin` is rejected; `set_blitzkrieg_access` still works for admins.

### Task 2.2 (HIGH): Lock the 7 anon-callable analytics RPCs
**Finding H2:** `get_blitzkrieg_summary/user_stats/editor_sessions/top_templates/user_activity/editor_locations/editor_work_patterns` are SECURITY DEFINER, EXECUTE to anon+authenticated, no caller check → anyone with the shipped anon key reads all editors' surveillance-grade data.
- [ ] Migration: add `IF NOT has_blitzkrieg_admin() THEN RAISE EXCEPTION ... END IF;` at the top of each (template: the already-correct `get_blitzkrieg_error_logs`). Verify: anon call → denied; admin call → works.

### Task 2.3 (HIGH): Make OTA integrity fail-closed (interim) — superseded by Phase 7
**Finding H3:** integrity hashes are read from the same attacker-controllable `version.json`; check is skipped when a hash is absent or SubtleCrypto missing.
- [ ] In `updater.js`: fail-closed — if a file has no expected hash or SubtleCrypto is unavailable, ABORT the update (do not write). (Phase 7 replaces OTA entirely; this hardens the interim.)

### Task 2.4 (MEDIUM): Drop the always-true `team_members` SELECT policy (cross-tenant PII)
- [ ] Migration: remove the `auth.uid() IS NOT NULL` SELECT policy; rely on the existing `is_admin_or_team()` policy. Verify a plain editor cannot read other tenants' rows.

### Task 2.5: Harden the new local-sync path-building (M6)
- [ ] In `local-sync.js`: route every ExtendScript path embed through `escapeForExtendScript` (not the local 2-char replace) and `validateName(storagePath segments)` before building/deleting paths. Unit-test the validation rejects `..`/`%2F`/control chars.

---

## PHASE 3 — Remove the approval gate (auto-approve) + "Recently Added" admin monitor

**Current (grounded):** ALL uploads (incl. admins) go to `pending/<uid>/...` + insert `status='pending'`; admin approve = edge fn `blitzkrieg-approve-submission` moves files to live. Direct-publish `uploadTemplate()` is dead code. Only 2 submission rows ever. `metadata.submitterName` is never written (monitor shows "Unknown"). Chosen design = **Option B (auto-approve)** — lowest risk, no storage-RLS loosening, keeps the audit ledger.

### Task 3.1: Auto-publish on upload via the existing approve edge function
**Files:** `js/main.js` (`executeAddComp` ~2965-3182), maybe a thin `blitzkrieg-self-approve` edge fn
- [ ] After the `pending/` upload + submission insert, immediately invoke the move-to-live path so the comp is live in seconds. Reuse `blitzkrieg-approve-submission` if an editor can trigger their own (else add `blitzkrieg-self-approve`: service-role move, gated to `has_blitzkrieg_access()` AND `user_id = auth.uid()` of the submitting row only — never a general bypass). Write `metadata.submitterName = teamMember.full_name` + `status='published'` + `approved_storage_path` at insert.
- [ ] Remove the "Submit for Review" vs "Add Comp" cosmetic split — single "Add Comp" for everyone.
- [ ] Verify (DB): a new upload yields a live `<Category>/<folder>/template.aep` + a `published` row with real submitterName; pending dir emptied. Edge fn auth: an editor cannot self-approve another user's row.

### Task 3.2: "Recently Added" admin monitor (replaces Review Queue)
**Files:** `js/submissions.js` (from Phase 0.3), `index.html` (`#review-section` → "Recently Added")
- [ ] New admin-only view `__recently_added`: query submissions `order(created_at desc) limit N`, reuse `renderSubmissionsGrid` (already created-desc + signs thumbs), show name / category / uploader (join `team_members.full_name`) / timeAgo, plus an admin-only **Remove** button → `cloudLibrary.deleteTemplate(approved_storage_path)` + mark the row `status='removed'` (admin DELETE RLS not needed if we soft-remove). Keep Remove `isAdmin()`-gated in FE AND admin-storage-RLS enforced.
- [ ] Verify (DB + code): non-admin cannot see/remove; admin remove deletes live files + flips the row.

---

## PHASE 4 — "My Work" per-editor view (identity already exists)

**Grounded:** real Supabase Auth, stable `auth.uid()`, `team_members.full_name`, submissions rows carry `user_id`/`team_member_id`. Source of truth for authorship = the submissions ledger (now `published` rows from Phase 3). Existing 376 templates are unattributed → go-forward (My Work fills as editors upload).

### Task 4.1: "My Work" virtual nav view
**Files:** `js/main.js` (taxonomy ~158 + nav), `js/submissions.js`
- [ ] Add `__my_work` virtual category in the sidebar. Query submissions `WHERE user_id = auth.uid() AND status='published'` (RLS already returns own rows), resolve each `approved_storage_path` to a live comp object, render in the grid (reuse the virtualized grid from Phase 1). Label header with the editor's `full_name`.
- [ ] Admin oversight (optional, owner-confirmed self-only for v1): defer admin "view editor X's work" to a follow-up.
- [ ] Verify (DB): the view returns exactly the signed-in editor's published uploads; empty-state copy when none (no fabricated rows).

---

## PHASE 5 — Favorites: per-editor + shared team set (synced)

**Current:** favorites/recents are device-local localStorage (`blitzkrieg_favorites`/`blitzkrieg_recent`), not per-user. Chosen = per-editor synced + a shared team set.

### Task 5.1: Migration — favorites tables (default-deny RLS)
- [ ] `blitzkrieg_favorites`: `id, user_id uuid default auth.uid(), storage_path text, template_name text, created_at`. RLS: select/insert/delete where `user_id = auth.uid()`, `WITH CHECK (user_id = auth.uid())`. `blitzkrieg_team_favorites`: `id, storage_path, template_name, added_by uuid, created_at`; RLS select to `has_blitzkrieg_access()`, insert/delete to `has_blitzkrieg_admin()` (team set curated by admins). Normalize/validate `storage_path` on insert.
- [ ] Verify: a user cannot write another user's favorite (WITH CHECK); non-admin cannot edit team favorites.

### Task 5.2: Favorites client — synced, with localStorage as offline cache + one-time migration
**Files:** `js/main.js` (favorites state 306-308, 3546-3587, toggleFav, Favorites virtual view), maybe `js/favorites.js`
- [ ] Read favorites from the table on load (cache to localStorage for offline/instant paint); `toggleFavorite` writes through to the table; one-time non-destructive import of existing `blitzkrieg_favorites` localStorage into the user's rows. Add a "Team Favorites" sub-view alongside the personal one. Orphan policy: show a "removed" chip with the saved name if the template is gone.
- [ ] Verify: pure favorites-state reducer unit-tested; DB round-trip (toggle → row exists → reload reflects). Offline: localStorage cache paints before network.

---

## PHASE 6 — Fast import via WHOLE-LIBRARY local mirror

**Chosen = download entire library.** Pair with Phase 8 storage trim so the full mirror is ~30 GB, not 65 GB. Mirror `.aep` + footage + `metadata.json` + `comp.png` (grid works offline); SKIP the 2.25 GB `preview/` frames on disk by default (hover still uses cloud signed URLs) — make frames an opt-in.

### Task 6.1: "Download entire library" with progress + resumability + re-sign
**Files:** `js/local-sync.js`, `js/main.js` (settings/UI)
- [ ] A "Download entire library" action that iterates all live templates, mirrors each (reuse the now-correct `syncTemplate`), shows progress (n/total + bytes), is resumable (skip already-complete via the size-gated `complete` flag), and RE-SIGNS expiring URLs mid-run (a multi-GB sync outlives the 4 h signed-URL TTL — `mirrorTemplate` must refresh URLs). Per-card "synced" indicator + a global synced/total badge.
- [ ] Size/eviction: a configurable cap + `pruneOrphans` on load (delete local folders whose cloud template was removed/renamed) — every delete target MUST be validated inside the library root (reject escapes).
- [ ] Import fast-path already prefers the local mirror (Phase prior fixes). Verify the whole-library button warms it so subsequent imports are local.
- [ ] Verify: unit-test the orphan/eviction path-safety (rejects any path outside root); DB/storage count that a full run mirrors N templates; manual-AE: import a synced comp is near-instant + offline.

---

## PHASE 7 — Replace broken auto-update with the CEP-standard installer prompt

**Grounded:** OTA has NEVER succeeded (Windows `Program Files` protected-dir mkdir denied; no-bridge sessions; `moveUpdateFile` is non-atomic copy+delete that can half-brick). Research + telemetry both say: stop trying to self-update in place.

### Task 7.1: "New version available → download → run installer" flow
**Files:** `js/updater.js`
- [ ] Replace the in-place OTA install with: detect newer `version.json`, show a non-blocking banner "New version available", button opens the GitHub release `.zxp` + shows the one-time install steps (Anastasiy ZXP installer; on Windows install to the per-user `%APPDATA%\Adobe\CEP\extensions`, NOT Program Files). Keep version detection + the 3-strike/telemetry. Remove the staging/atomic-swap code path (or gate it off). Bump `version.json` + `BLITZKRIEG_LOCAL_VERSION` so the prompt actually fires.
- [ ] Verify: version-compare unit tests; the banner renders + links the correct asset URL; no in-place write into the extension dir.

---

## PHASE 8 — Owner-run storage ops (scripted so the owner just pastes a key)

### Task 8.1: Run the image backfill (CO-KEYSTONE crash relief, not optional)
- [ ] Owner runs `scripts/blitz-storage-optimize.mjs --previews --fix-names --apply` (downscales the 165 MB of comp.png thumbs + 2.36 GB of full-res preview frames to 600px; backs up originals). **Audit A2 elevates this to a CO-KEYSTONE with virtualization, not deferrable polish:** the 2.36 GB of full-res hover frames decode into Blink's image cache OFF-DOM, so DOM-recycling virtualization (Phase 1) does NOT evict them - only shrinking the source bytes does. Crash fix = virtualization AND backfill together. (Born-small generation already prevents re-bloat. Verified-safe: env-key only, dry-run default, backup-before-overwrite, never touches .aep, never deletes.)

### Task 8.2: Script the Pre-comps split (NOT a hidden-category delete)
**Files:** Create `scripts/blitz-storage-reorg.mjs` (Node ESM, service-role from env, dry-run default, backs up)
- [ ] A one-command tool to move the 2,192-object/24.8 GB `Pre-comps` folder into sub-categories (by a rule the owner picks), fixing the listing timeout + cutting the All-view count. Dry-run default; owner runs `--apply`. Verify against live storage counts after.
- [ ] **SAFETY (audit A8 CRITICAL):** the script must NEVER inherit `HIDDEN_CATEGORIES` as a delete set. The "~34 GB hidden" categories are 98% the company's OWN `Dominate Media` brand folder (34.9 GB, hidden FROM CLIENTS, NOT vanity/test). Only ~637 MB across `Shaz`/`Usama`/`John Ventura`/`sign` is genuinely trimmable, and even that needs per-category explicit owner OK. No deletion path in v1.
- [ ] **NOTE the real heap monster (audit A8):** mp4 video = 66 GB = 85% of the 72.4 GB library; the thumbnail backfill cannot touch it. Whether to transcode/relocate the mp4 bulk (Pre-comps 23.7 GB + Dominate Media 32.5 GB) is a separate owner decision - that, not thumbnails, is what makes those categories slow to list.

---

## Execution order (dependency-aware)
0 (foundations) → **1 (crash — keystone)** + 8.1 (backfill relief, parallel owner-run) → 2 (security) → 3 (auto-publish) → 4 (My Work) → 5 (favorites) → 6 (whole-library) → 7 (updater) → 8.2 (reorg). Each task is its own subagent + two-stage review (subagent-driven-development). Migrations serialized (single writer).

## Verification gates (every phase)
- `bash scripts/ci-check.sh` passes (syntax + ES3-leak + em-dash).
- Pure-logic units (window math, favorites reducer, path-safety) run in node/jsdom without AE.
- Every DB/RLS change verified by live query (denied-for-wrong-role + allowed-for-right-role).
- Anything only testable in AE is written as a precise manual-check the owner forwards to an editor (since the owner has no AE).
- Adversarial subagent review on each task before "done".

---

## Audit Remediation Deltas (16-agent adversarial audit, 2026-06-25)

These supersede/patch the tasks above. Each is a verified finding (first-pass auditor + independent hostile verifier, grounded in code + live DB). Applied items are done in this worktree; the rest bind the executing subagents.

### Already fixed in this worktree (verified)
- **A7 CRITICAL — Mac local-download was dead.** `blitzLocal*` helpers + `appendToTextFile` + `decodeBase64FileToBinary` bypassed `normalizeFsPath`, so the default `~/Blitzkrieg Library` space-path never resolved on macOS and the `complete` gate (re-checked via un-normalized `exists`) never passed → infinite cloud re-download. FIXED: all 8 functions now route through `folderFromPath`/`fileFromPath`/`normalizeFsPath` (Windows drive-letter paths pass through unchanged). This COMPLETES the local-download fix that the prior plan's "Task 9" marked done in error.
- **A1-1 MEDIUM — aspect-ratio fallback only covered `.thumbnail`.** FIXED: the `@supports not (aspect-ratio)` block now also covers `.submission-thumbnail`, `.submission-detail-preview` (+ their placeholder children, absolutely positioned) and `.heatmap-cell` (min-height fallback, since it is a flex-item).
- **A4 + A6 HIGH — CI gate had real holes.** FIXED: removed `supabase-config.js` from the vendored skip (it is authored); replaced the fragile `sed` comment-strip with a proper zero-dep comment/string stripper (`scripts/strip-comments.js`) that kills both the in-string-`//` false-negative and the comment/string false-positive; added the entire ES5-method family + `async`/`await` to the jsx ES3 check; added a banned-modern-API check (`loading=lazy`, `content-visibility`) on raw JS/CSS/HTML; broadened the em-dash triggers (innerHTML/setAttribute/aria-label/alert/confirm) + scan `index.html`; removed the inert `loading="lazy"` at main.js:2203. Gate passes clean and now fails on all the new classes (verified). **Task 0.2 is therefore "harden", not "create".**

### Plan build-blockers to patch BEFORE the relevant phase
- **A5 C-1 CRITICAL (Phase 3/4) — status `CHECK` constraint.** `blitzkrieg_template_submissions_status_check` allows ONLY `pending`/`approved`/`rejected`. The plan's `status='published'`/`'removed'` (Tasks 3.1/3.2) throw on every insert/update and make the Phase 4 `WHERE status='published'` query return zero rows forever. FIX: either add a constraint-altering migration in Phase 3 (before 3.1) to permit `published`/`removed`, OR reuse `approved` as the live state + a separate `removed_at`/soft flag. Pin Phase 4's My-Work query to the SAME vocabulary chosen.
- **A5 H-2 HIGH (Phase 3) — self-approve is mandatory, not "reuse if possible".** Live RLS proves editors have NO self-approve route (submissions UPDATE is admin-only; the approve fn is an admin-gated edge function). The `blitzkrieg-self-approve` edge function is REQUIRED: insert = `pending` + `metadata.submitterName`, then the edge fn does the storage move + status flip atomically, gated to `has_blitzkrieg_access()` AND `user_id = auth.uid()` of the submitting row ONLY. Reuse the existing approve fn's traversal guards (it is genuinely well-built).
- **A5 M-1 / A3 M6 HIGH (Phase 2.5 + 6) — local-sync path-build is a DESTRUCTIVE arbitrary-dir-delete.** `_localPath = lib + '/' + storagePath` has no containment check; `pruneTemplate`/`pruneOrphans` delete via it, and Phase 6 iterates ALL server object names through it. FIX (raise to HIGH): `validateName` every path segment + a hard "resolved path must stay inside the configured library root" check BEFORE any `blitzLocalRemoveDir`/write. (jsx `blitzLocalRemoveDir` now carries a caller-must-validate comment.)
- **A3/A5 MISSED-1 (Phase 2.1) — the C1 REVOKE also strips admin-as-authenticated writes.** Column-level `REVOKE UPDATE` is role-wide: admins are `authenticated` too, so any admin UI doing a direct `.update({blitzkrieg_access})` breaks post-REVOKE. BEFORE 2.1: grep BOTH this repo AND insight-flow-83 for `.update(` touching `blitzkrieg_admin`/`blitzkrieg_access`/`role` on `team_members`; confirm every legitimate writer goes through `set_blitzkrieg_access()` (SECURITY DEFINER). Also broaden the fix to `REVOKE UPDATE, DELETE ON team_members FROM anon, authenticated` (table-level grants exist too) + a BEFORE-UPDATE trigger guard.

### Severity/scope corrections to security phase (Phase 2)
- **A3 H2 — it is 19 ungated analytics RPCs, not 7.** Add the `has_blitzkrieg_admin()` guard to ALL 19 `get_blitzkrieg*` SECURITY DEFINER functions executable by anon/authenticated (only `get_blitzkrieg_error_logs` + `get_blitzkrieg_team_members` are correctly gated today).
- **A3 M4 — upgrade to HIGH:** the always-true `team_members` SELECT leaks 144 editors' **payroll/financial** PII (`wise_email`, `pay_per_video`, `payroll_notes`, `payment_plan_notes`) cross-tenant. Drop the policy AFTER confirming Insight Flow does not rely on it.

### Phase 1 (crash) hard requirements added by audit A2
- Backfill (8.1) is a **co-keystone** (see Task 8.1) — virtualization alone leaves the 2.36 GB off-DOM hover-frame decode heap untouched.
- On recycle, the node MUST: `lazyLoadObserver.unobserve(oldImg)` (IO target-accumulation hazard — IO holds targets even after the node is reused), DETACH `img.onerror` then set a 1×1 data-URI placeholder BEFORE blanking `src` (bare `src=''` triggers `handleThumbError` → a needless re-sign network call), reset `data-src`/`data-thumb-path` for the incoming comp, stop/rebind the preview rAF, and clear the `data-lazy-bound`/`data-preview-bound`/`data-events-bound` sentinels + remove old listeners (or use event delegation). These are the recycle-collision hazards main.js:2516/2546/2616 already warn about.

### Corrected facts (use these, not the stale ledger)
- comp.png total = **165 MB** (not 158); preview frames = **2.36 GB** (not 2.25); **mp4 video = 66 GB = 85% of the 72.4 GB library — the real heap/listing-slowness driver.**
- **7 broken template folders** (not 10): 2 aep-without-comp + 5 comp-without-aep (3 real + 2 `sign/` pseudo-dirs). 147 zero-byte objects are `.emptyFolderPlaceholder` (not broken). 395 distinct template dirs.
- Pre-comps listing timeout is now **adaptive 15s → 30s → 60s** (cloud-library.js:156), already raised above the ~30s server ceiling — the simple "hard 30s fail" story is stale; the split (8.2) still helps the All-view count + UX.
- The optimize script currently EXCLUDES `HIDDEN_CATEGORIES` (incl. the 35 GB Dominate Media folder) from downscaling — so the biggest/slowest category gets zero relief from the only existing tool (reinforces the mp4/reorg decision above).

### Task 0.3 dependency note
`js/updater.js`, `js/submissions.js`, `js/analytics-view.js`, `js/favorites.js` do NOT exist yet — Tasks 2.3/3.2/4/5/7 that reference them have a hard dependency on the Task 0.3 extraction landing first.
