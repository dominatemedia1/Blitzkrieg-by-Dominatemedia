# Blitzkrieg Deep-QC Remediation Plan

> **For agentic workers:** implement task-by-task; each task ends with a verifiable check. Steps use `- [ ]`.

**Goal:** Make the local-download feature actually work, make the library genuinely fast on After Effects, and fix every real defect the 24-agent deep QC surfaced — correct on BOTH Windows and Mac.

**Architecture:** Vanilla-JS CEP panel (js/*.js, embedded Chromium) + ExtendScript host (jsx/hostscript.jsx, ES3, runs synchronously on the AE thread) + Supabase Storage (private bucket "blitzkrieg", project kwrmdxptrrvlqxdcasho). No build step.

**Source of findings:** 24-agent adversarial QC (run wf_dccc18c3-3e5), grounded in code + live production data.

## Implementation status (2026-06-25)
**Code fixes — DONE + adversarially verified (run wf_9cf7b5b4-af2: 0 blocker/0 high/0 medium, the `atob` decode proven byte-correct over 2000+ buffers):**
- [x] Task 1 — `atob` blocker (local mirror writes real files via `cep.fs` + proven ES3 decoder; `atob` eradicated)
- [x] Task 2 — `complete` gated on a verified non-empty `.aep` (with transient-error fallback)
- [x] Task 3 — local import failure falls back to cloud
- [x] Task 4 — hover preview frames capped at 12 (was all ~72)
- [x] Task 5 — generation downscales `comp.png` + frames to 600px (backfill no longer decays)
- [x] Task 8 — `@supports` `aspect-ratio` fallback (old-Chromium thumbnail collapse)
- [x] Task 9 — `blitzLocalListAep` skips `._` forks + 0-byte files
- [x] Task 10 — one-time user note when updates are perma-deferred (no AE bridge)
- [x] Task 7 — manifest version gate (CACHE-3); CACHE-1/2 mitigated by once-per-session guard + owner `--fix-names`
- [ ] Task 6 — Pre-comps timeout: graceful degradation already present; real fix is owner splitting the category (below)

**Owner-run ops — NOT done (require storage/data access, see TIER 3).**

## Global Constraints (copy verbatim into every task)
- jsx is ES3: `var` only, no `let/const/arrow/template-literals/Array.find/includes/Object.assign`, no `atob/btoa`. An ES5+ leak crashes AE silently.
- Panel js may use ES5+. NO `Promise.prototype.finally` (CEP 8/9). `<img>` decodes by content, not extension.
- NO em-dashes / curly quotes in user-facing strings (toasts/.textContent/.title). Comments OK.
- Every path/file/URL change MUST be correct on Windows (C:\, backslashes, file:///C:/) AND Mac (spaces/%/non-ASCII, /Users).
- Never weaken type safety. Never auto-commit (owner commits). Never overwrite/delete production storage without explicit owner OK.

---

## Production reality (measured 2026-06-25)
- 378 templates, 7340 objects, 69 GB. Visible categories total ~30 GB; **Pre-comps alone = 2,192 objects / 24.8 GB**.
- Hidden vanity/test categories (Dominate Media 33 GB, Shaz, John Ventura, Usama Ahmad) = ~34 GB (49% of bucket), dead weight.
- comp.png 158 MB (avg 430 KB), preview frames 2.25 GB (5170 @ 446 KB) — **all still full-res; the backfill was NEVER run.**
- error_logs(21d): garbage-name cache wipe x633, "cannot resolve extension root" x51, Pre-comps DB timeout, stash watchdog 90s, telemetry 401.

---

## TIER 1 — Blockers / make the core features work (code; implement now)

### Task 1: Fix the `atob` blocker so the local mirror writes real files (LOCAL-1 / JSX-1, BLOCKER)
**Files:** `jsx/hostscript.jsx` (blitzLocalWriteBinary ~3602), `js/local-sync.js` (_writeBlob ~102-145)
**Problem:** `blitzLocalWriteBinary` calls `atob()` which does not exist in ES3 → swallowed throw → 0-byte file → returns `{ok:true}`. 71% of all mirrored files (small comp.png/frames/footage/metadata/.aep) are written empty.
**Fix:** Decode base64 WITHOUT atob. Preferred: in `js/local-sync.js _writeBlob`, write via CEP's native filesystem `cep.fs.writeFile(path, b64, cep.encoding.Base64)` (the exact pattern `main.js` writeBlobToFile already uses) for ALL sizes — no JSX round-trip, native decode, correct on both platforms. Fallback if cep.fs absent: route to the existing proven chunked `appendToTextFile` + `decodeBase64FileToBinary` path (drop the broken `<=CHUNK` atob branch). Also fix `blitzLocalWriteBinary` itself to delegate to the real decoder (defense for any other caller).
- [ ] Verify a synced template's comp.png + .aep are non-zero on disk (size assertion).

### Task 2: Verify writes before marking a template `complete` (LOCAL-2, HIGH)
**File:** `js/local-sync.js` (syncTemplate ~401), `jsx/hostscript.jsx` (blitzLocalExists -> add size)
**Fix:** `blitzLocalExists` returns `{exists, size}`; mark `complete:true` only when the .aep (and comp.png) on disk are non-empty. Add size check to verifyTemplateIntegrity.

### Task 3: Local import failure falls back to cloud (LOCAL-3, HIGH)
**File:** `js/main.js` (_doImportLocalAep ~3702)
**Fix:** On a failed local .aep import, call `_doCloudImport(storagePath, ...)` instead of only toasting. (Task 2 already prevents 0-byte .aep from being chosen, but this is the safety net.)

### Task 4: Cap hover preview-frame loading (RENDER-1, HIGH — the Memory-limit toasts)
**Files:** `js/main.js` (startPreviewAnimation ~1927, mouseenter ~2566), `js/cloud-library.js` (signPreviewFrames ~671)
**Problem:** Hovering one card signs + downloads + decodes ALL ~72 full-res frames (avg 11.7 MB, worst 108-123 MB) → memory pressure + jank.
**Fix:** Sample to <= 12 evenly-spaced frames for the hover animation; only sign/download those. Serve from local mirror when synced. (Backfill will also shrink the frames — Tier 3.)

---

## TIER 2 — Optimization + correctness (code)

### Task 5: Downscale comp.png on generation/stash so thumbnails are born small (EFF-1 / COLD-2, HIGH)
**Files:** generation/stash path in `js/main.js` + `jsx/hostscript.jsx`
**Fix:** Before upload, downscale the generated comp.png to ~600px (canvas/`cep` or a small resize) so the backfill never decays. Without this, any backfill re-bloats over time.

### Task 6: Pre-comps category listing timeout (PD-2, BLOCKER-data)
**File:** `js/cloud-library.js` (listAllPaginated ~689, per-attempt timeouts)
**Problem:** Listing the 2,192-object Pre-comps folder times out server-side ("connection to the database timed out").
**Fix (code):** smaller page size + longer/adaptive timeout + resilient partial handling so a slow category degrades gracefully instead of failing the load. **Owner-op alternative:** split Pre-comps into sub-categories (it is 25 GB / 99 templates — also a storage-hygiene win).

### Task 7: Manifest cache wipe + version-gate (CACHE-1/CACHE-2/CACHE-3)
**File:** `js/cloud-library.js`
**Fix:** Stop the tier-2 manifest path from wiping the cache it just wrote; version-gate fetchManifest; make the once-per-session garbage wipe a no-op when the same bad names persist.

### Task 8: CEP-version-safe rendering (RENDER-3/RENDER-5)
**Files:** `CSS/style.css`, `js/main.js`
**Fix:** Add a padding-bottom 56.25% fallback for the 16:9 thumbnail box (CSS `aspect-ratio` is Chrome 88+; may be a no-op on AE's older Chromium); add an IntersectionObserver lazy-load (native `loading="lazy"` is a no-op pre-Chrome 76). Version-agnostic — safe on old and new AE.

### Task 9: Route local-mirror writes through normalizeFsPath + skip ._ forks (MACFS-1/JSX-2/MACFS-2)
**Files:** `js/local-sync.js`, `jsx/hostscript.jsx`
**Fix:** Build mirror paths via the project's normalizeFsPath/buildPath helpers; blitzLocalListAep must skip `._` AppleDouble files as import targets.

### Task 10: Updater no-bridge user guidance (WC-1 / PD-5)
**File:** `js/main.js`
**Fix:** When `_consecutiveBridgeDefers` exceeds threshold, surface a one-time note: "Open the panel inside After Effects to receive updates" (the no-bridge case cannot self-update; the window.location fallback only fixes the empty-path subset).

---

## TIER 3 — Owner-run storage/data ops (NOT code; owner executes)
- **Run the backfill** `scripts/blitz-storage-optimize.mjs --previews --fix-names --apply` (COLD-1/PD-1) — downscales 2.4 GB of images, fixes the 4 garbage names. THE headline speed win; reaches all installs with no app update. (After Task 5, new thumbnails stay small.)
- **PD-3:** 10 structurally-broken templates (8 missing .aep) — owner decides delete vs re-stash. List provided.
- **PD-7:** 34 GB of hidden vanity/test categories — owner decides cleanup.
- **PD-8:** telemetry token 401 — owner re-auths so error/usage signal resumes.
- **Delivery:** the broken installed updater can't deliver code fixes; users reinstall the .zxp once (then Task 10 + the window.location fix make future updates work).

---

## Verification gates
- All js/*.js `node --check`; jsx parses; no em-dash in user-facing strings.
- Local mirror: synced template produces non-zero comp.png + .aep on disk; file:// thumbnail renders; import-from-local works; cross-platform path math reviewed for Windows + Mac.
- Adversarial re-verification workflow on the implemented fixes before "done".
