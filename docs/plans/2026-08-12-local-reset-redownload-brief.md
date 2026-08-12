# IMPLEMENTATION BRIEF — Local reset + force redownload + import-hang fix
Worktree: `/Users/thenorwegianoilfund/Coding/_wt/Blitzkrieg-by-Dominatemedia/local-reset-redownload-260812`
All five recon reports cross-checked against source. Every claim below was re-read at the cited line unless marked UNVERIFIED.

---

## 0. The one-paragraph framing

The editor's import hangs because the mirror-import branch is the only import path in the panel with **no wall-clock ceiling and no terminal state**, and it runs through **three raw Supabase `download()` awaits that have no timeout**, in a file that already contains the fix for exactly this hazard and applies it only to footage. On top of that, `js/local-sync.js` emits nothing to any log surface, so when it fails the editor truthfully reports "no error". The requested buttons are the right product answer, but shipping them on the existing primitives would silently free zero bytes: `blitzLocalRemoveDir` is not recursive despite its docstring, and its only caller ignores the error. So the build is three things in one PR: fix the hang, wire the diagnostics, then add the buttons on top of a delete primitive that actually deletes.

---

## 1. ROOT CAUSE RANKING — import hangs with no error

### R1. `_doMirrorImport` has no timeout, no `hideSpinner`, and its download stage is unbounded — CONFIDENCE: HIGH (mechanism), MEDIUM-HIGH (that this is the editor's actual hang)

Evidence:
- `js/main.js:4945` `_doMirrorImport` calls `showSpinner()` at `:4946` and `setStashInProgress(true,'import')` at `:4947`. There is no `setTimeout` anywhere in the function body (`:4945-4984`) and no `hideSpinner()` call. It delegates the hide entirely to `_doImportLocalAep` on success (`:4979`) or `_doCloudImport` on rejection (`:4982`). If the chain never settles, neither runs.
- Its chain calls `window.cloudLibrary.downloadTemplate(storagePath)` at `js/main.js:4953`.
- `js/cloud-library.js:1918` `var fastResult = await sb.storage.from(BUCKET).download(fastPath);` — raw, no timeout, no AbortController.
- `js/cloud-library.js:1972` `var downloadResult = await sb.storage.from(BUCKET).download(chosenAepPath);` — same.
- `js/cloud-library.js:1842` (`getTemplateDependencies`, reached via the extras fetch) — same. UNVERIFIED at exact line 1842; I verified 1918 and 1972 directly.
- The file already documents this exact failure at `js/cloud-library.js:1740-1750` and fixes it with `_downloadWithTimeout` at `js/cloud-library.js:1751-1770` (90s, real AbortController, `Promise.race`). That wrapper is used only by `downloadStorageFiles` at `js/cloud-library.js:1780` (footage). **The template's own .aep is the one file every import must have, and it is the one file with no bound.**
- Contrast: `_doImportLocalAep` (`js/main.js:4892`) and `_doCloudImport` (`js/main.js:4991`) both arm `IMPORT_EVAL_TIMEOUT_MS = 180000` (`js/main.js:4890`). `_doMirrorImport` is the only branch with nothing.

Why the editor lands here: `importComp` routes to `_doMirrorImport` at `js/main.js:5119` whenever the mirror is a miss OR stale — which is precisely the state left behind by his earlier sync/download errors.

Fix: wrap 1918/1972/1842 in the existing `_downloadWithTimeout`, and give `_doMirrorImport` a `_settled` flag plus a 10-minute ceiling (matching the import watchdog budget at `js/main.js:418`) whose expiry calls `hideSpinner()` + `setStashInProgress(false)` + an actionable toast + `_doCloudImport` fallback.

Honesty: I cannot prove this is what his machine hit, because nothing on this path logs. That is why section 5 is not optional.

### R2. `safeEvalScript` promise wrappers in main.js have no timeout, so a wedged AE host hangs forever — CONFIDENCE: HIGH (mechanism), MEDIUM (that it fired here)

`getTempDir` (`js/main.js:9627`), `writeBlobToFile` (`js/main.js:9676`, both the `cep.fs` and chunked branches), `readFileAsBlobAsync` (`js/main.js:9838`), `fileExistsAsync` (`js/main.js:9884`), `ensureFolderAsync` (`js/main.js:9906`) all wrap `safeEvalScript` in a bare `new Promise` with no timer. `safeEvalScript` (`js/main.js:95`) only guards a missing bridge and a synchronous throw. If AE is showing a native modal (very plausible after his earlier import errors — the missing-footage dialog is exactly that), the evalScript callback never fires and the promise never settles.

`js/local-sync.js:48` already solved this with a 120s bound inside `_callExtendScript`. Two copies of the same bridge, one hardened, one not.

Fix: port a timeout into the five main.js wrappers. Use generous per-op bounds (60s for exists/mkdir, 300s for a single file write) so a legitimately slow large write is not killed.

### R3. Poisoned mirror state makes the fast path import a bad .aep forever — CONFIDENCE: HIGH (verified), but this is a FAIL loop, not the hang

- `js/local-sync.js:1393-1396`: `markTemplateComplete`'s rejection handler calls `_mark()` anyway, setting `complete: true` when verification could not run at all. Comment says "trust the .aep presence". That writes a lie into state.
- `js/local-sync.js:373-374`: `checkLocal` calls `blitzLocalExists` on `template.aep` and checks only `aepR.exists`, ignoring the `size` the host returns (`jsx/hostscript.jsx:4301` returns `{exists:true, size:f.length}`). A 0-byte `template.aep` therefore passes.
- Result: `js/main.js:5102` fast-path guard is satisfied, AE import fails, `js/main.js:4922` falls back to `_doCloudImport`, and nothing clears `complete` or calls `markBroken`. Every future import repeats the full cycle. Permanently slow, and it re-enters the unbounded download code each time.

### R4. No footage size cap on the import path — CONFIDENCE: MEDIUM

`MIRROR_MAX_FOOTAGE_BYTES = 300MB` (`js/cloud-library.js:1750`) is applied only inside `mirrorTemplate` (recon: `js/cloud-library.js:2031`). `downloadTemplate` calls `collectAllFiles(storagePath, { _timeoutMs: 45000 })` at `js/cloud-library.js:1931` with no cap. The cap's own comment at `js/cloud-library.js:1745-1749` says an uncapped multi-GB file "buffered whole in the CEP Chromium heap, hangs the download so the template never converges". The import path still does exactly that, then hands the blob to `reader.readAsDataURL` (`js/main.js:9733`, no timeout) which on a multi-GB blob may fire neither `onload` nor `onerror`.

### R5. Background full sync contends with the import on a single-threaded host — CONFIDENCE: MEDIUM

`js/main.js:1800-1806` auto-resumes `_startFullLibrarySync()` after every `loadLibrary` when pending > 0. `startFullSync` runs 3 concurrent template workers plus a 4-worker pre-sizing pass. ExtendScript is single-threaded, so an interactive import's evalScript calls queue behind sync writes. Consistent with "errors while importing, syncing and downloading" then a hang.

### R6. No re-entrancy guard on Import; the spinner does not block clicks — AGGRAVATOR, CONFIDENCE: HIGH

`handleStashGridClick` dispatches `importComp` at `js/main.js:3463` with no in-flight check; `importComp` (`js/main.js:5075`) checks only the CEP bridge. The 2s cooldown at `js/main.js:3482` covers double-click only. `#loading-spinner` is a 32px fixed div with no backdrop (`CSS/style.css:1621-1633`), so the grid stays clickable. Re-clicking launches a second full pipeline. And `setStashInProgress` (`js/main.js:425-443`) uses ONE module-scope `_stashWatchdogTimer` (`js/main.js:417`) that it unconditionally clears at `:427-430`, so the second import cancels the first's watchdog and whichever finishes first clears the flag for both. The watchdog callback (`js/main.js:435-441`) also never calls `hideSpinner()`.

### R7. Shared `.b64` temp filename collision — CONFIDENCE: MEDIUM-LOW (real, but narrower than recon implied)

`js/main.js:9697` `escapeForExtendScript(filePath + '.b64')` and `js/local-sync.js:235` `var safeTmpB64 = safe + '.b64';` — same derived path. `appendToTextFile` opens `'w'` on first chunk, `'a'` after (`jsx/hostscript.jsx:3194`), so two writers interleave into one file and `decodeBase64FileToBinary` (`jsx/hostscript.jsx:3217`) strips non-base64 chars and writes a corrupt-but-nonzero .aep reported as success. **Downgraded** because both writers try `cep.fs.writeFile` first (`js/main.js:9690`, `js/local-sync.js:228`) and only fall through to the chunked path when cep.fs is unavailable or errors. Real on machines where cep.fs is degraded, not universal.

---

## 2. "Delete local library" — exact design

### Principle
Never delete the library root itself. Delete its **children**. That reclaims every byte, keeps the configured path valid so the editor does not have to re-pick a folder, and means the containment check never needs `allowExact = true` — which is the single flag that turns a containment guard into a permission to wipe a tree.

### New host function (jsx/hostscript.jsx, ES3, place next to `blitzLocalRemoveDir` at :4310)

`blitzLocalWipeLibrary(rawRootPath)` returning JSON `{ok, removed, remaining, rootExists, notFound}`.

Order of operations, all mandatory:
1. `isValidPath(rawRootPath)` (`jsx/hostscript.jsx:309`) — reject on false.
2. **Structural refusals, before any containment logic.** Reject empty string, `'/'`, `'~'`, any path with fewer than 3 path segments, the value of `blitzGetHomeDir()` (`jsx/hostscript.jsx:4321`), and `Folder.myDocuments.fsName` / Desktop. `blitzLocalRemoveDir` has none of these today and `_localPath` (`js/local-sync.js:171-175`) is bare `lib + '/' + storagePath` which happily yields `/Category/Name` when lib is empty.
3. `var root = folderFromPath(rawRootPath)` (`jsx/hostscript.jsx:598`). If `!root.exists`, return `{ok:true, removed:0, notFound:true}` — **do not** collapse this into plain `ok:true`. `folderFromPath` normalize-then-fallback (`:598-609`) means a non-resolving path yields a non-existent Folder, and `blitzLocalRemoveDir` today returns `{ok:true}` for that case, making a failed wipe indistinguishable from a successful one.
4. `var entries = root.getFiles()`; null-tolerant (macOS returns null on a malformed URI — see the comment at `jsx/hostscript.jsx:3897`).
5. Per entry: compute `entries[i].fsName`, require `_isPathInsideRoot(entryPath, root.fsName, false)` (`jsx/hostscript.jsx:3988`, already case-folds APFS/NTFS and trims trailing slashes at `:3977`). Skip anything that fails. Then `removeFolderRecursive(entries[i])` for Folders (`jsx/hostscript.jsx:3896` — the real recursive primitive, used by 7 other call sites) or `.remove()` for Files.
6. Re-stat: `var after = root.getFiles(); remaining = after ? after.length : 0;`. **Return `remaining`, and gate the UI on `remaining === 0`.** `removeFolderRecursive` swallows every per-entry failure (`:3904-3907`) and returns undefined, so a partial delete is invisible without this.

Do NOT pass an already-normalized path in. `normalizeFsPath` (`jsx/hostscript.jsx:370-390`) is deliberately non-idempotent and `buildPath` (`:404`) already normalizes its output; double-encoding produces a non-existent target and the silent false-success above.

### What gets removed from disk
Everything under `state.libraryPath` (the mirror root the user picked, default `<home>/Blitzkrieg Library`). Nothing else. Not `Folder.userData/Blitzkrieg/settings.json`, not `auth-session.json` (that would log him out), not the cloud bucket, not the shared manifest `_blitzkrieg_manifest_v2.json`.

### What gets cleared in localStorage
Via a new `localSync.resetAllLocal()` (local-sync.js is the ONLY legal writer of its key — `grep blitzkrieg_local_sync` hits `js/local-sync.js:13` and nothing else):

- `blitzkrieg_local_sync` — **rewrite, do not `removeItem`.** Write `{ libraryPath: <preserved>, templates: {}, fullSync: {}, lastFullSync: 0 }`. Removing the key loses `libraryPath` and forces the editor to re-pick his folder.
- `blitzkrieg_thumb_blacklist`, `blitzkrieg_thumb_failed`, `blitzkrieg_preview_zero` (`js/main.js:2320-2375`)
- `blitzkrieg_version_cache` (`js/main.js:9101`), `blitzkrieg_update_failed` (`js/main.js:8866`)
- Call `window.cloudLibrary.clearLocalCache()` (defined `js/cloud-library.js:729`, exported `:2945`) for the metadata cache + the three in-memory URL maps + the persisted signed URLs + the meta-cache file. **Never `invalidateCache()`** (`js/cloud-library.js:714`) — it calls `invalidateManifest()`, which nukes the SHARED cloud manifest for every editor in the agency.

Leave `ae_asset_stash_path` (`js/main.js:1028-1067`) alone — it is the legacy library-path cache and clearing it also costs him the path. Leave `blitzkrieg_favorites` / `blitzkrieg_recent` / sort / grid alone; they are preferences, not mirror state.

### In-flight sync
Blocking sequence, in this order:
1. Set a module-level `_localResetInProgress = true` and make `_startFullLibrarySync` (`js/main.js:7151`) return early while it is set. Otherwise the auto-resume at `js/main.js:1800-1806` re-arms the sync into a folder you are deleting.
2. `window.localSync.cancelFullSync()` (`js/local-sync.js:1103`).
3. **Await the drain.** `cancelFullSync` deliberately does NOT set `_fsRun.running = false` (comment `js/local-sync.js:1110-1117`); workers only notice at their next `_isDead()` check and `running` flips false when `Promise.all` resolves. Poll `window.localSync.getFullSyncStatus().running` (computed at `js/local-sync.js:1159`) every 500ms with a 60s ceiling. If it does not go idle, abort the wipe and tell the user to relaunch the panel — deleting under live writers is how you get half-written bundles.
4. Wipe disk, then reset state, then clear caches.
5. `_localResetInProgress = false`, `_updateSyncNavCount()`, `_updateSyncBadge()`, `renderSyncDashboard()`.

### Confirm modal copy
New static shell in the modal block at `index.html:79-260`, immediately after `#delete-confirm-modal` (which ends at `index.html:89`). Copy the exact three-part wiring of `#delete-confirm-modal`: module-scope lookups near `js/main.js:257`, listeners near `js/main.js:1579`, prompt/execute pair toggling `style.display` between `'flex'` and `'none'`. There is no shared openModal helper and no Esc/overlay close anywhere — do not invent one.

```html
<div id="local-reset-modal" class="modal-overlay" style="display: none;">
    <div class="modal-box">
        <h3>Delete the local copy?</h3>
        <p>This deletes everything Blitzkrieg has downloaded to <strong id="local-reset-path"></strong> on this computer. Nothing in the cloud library is touched, and no template is lost. Imports go straight to the cloud until you download again.</p>
        <div class="modal-buttons">
            <button id="cancel-local-reset-btn" class="button-secondary">Cancel</button>
            <button id="confirm-local-reset-btn" class="button-danger">Delete local copy</button>
        </div>
    </div>
</div>
```

`#local-reset-path` set with `textContent` (safe, no `escapeHTML` needed). Keep the `.modal-buttons` wrapper — it is what normalizes the button heights (`CSS/style.css:1379-1387`). Danger button goes right, Cancel left, matching every existing modal.

House-rule check on the copy: no em dashes, no "ensure/leverage/robust", operator voice, states the blast radius plainly and says what does NOT happen (cloud untouched) because that is the fear.

---

## 3. "Force redownload" — exact design

### Why a naive implementation silently does nothing

`_pendingFor` (`js/local-sync.js:894-917`, verified verbatim) has four skip gates:
- A. `t.broken` with `brokenKind` `'source'` / `'empty'` / legacy-undefined → skipped forever.
- B. `t.broken` with `brokenKind === 'transient'` → skipped until 30 min past `brokenTs` (`SYNC_RETRY_COOLDOWN_MS`, `js/local-sync.js:21`); also skipped if `brokenTs` is missing.
- C. `t.complete === true` and not stale → skipped. **The main gate.**
- D. Staleness requires both sides non-empty (`wantV && t.contentVersion !== wantV`), and `js/main.js:7160` builds `versionMap[sp] = allComps[i].contentVersion || ''`, so a comp with no computed contentVersion can never be stale.

Plus `failCount` (`js/local-sync.js:1029`): leaving it at 3 means one more failure instantly re-brokens the template.

**The clean reset is `delete state.templates[sp]`.** `!t` short-circuits to push at `js/local-sync.js:914`, satisfying all four gates at once, with no chance of a stale `brokenKind` or `failCount` surviving.

### Two runtime traps that defeat a correct state reset

1. **Re-entrancy guard**, `js/local-sync.js:806-811` (verified): if `_fsRun && _fsRun.running`, `startFullSync` adopts the new tick callback and returns the existing promise WITHOUT recomputing the queue. Your flags are ignored.
2. **Queue is snapshotted once** at `js/local-sync.js:919` (`var queue = _pendingFor(myRun);`) and workers walk it by index. Templates flipped back to pending mid-run are never picked up.

So force-redownload MUST sequence: `cancelFullSync()` → poll to idle → mutate state → `_startFullLibrarySync()`. Same drain helper as the delete flow.

### API additions (js/local-sync.js, on the `api` object at :264, exposed at :1518)

- `awaitIdle(timeoutMs)` → Promise. Polls `_fsRun.running`. Shared by both flows.
- `resetTemplate(storagePath)` → Promise `{removed, remaining}`. Fixed recursive host delete + `delete state.templates[sp]` + drop `fullSync.failures[sp]`. **Only deletes the state entry if the host reported `remaining === 0`** — the opposite of today's `pruneTemplate` (`js/local-sync.js:1478-1487`), whose `.then()` takes no argument and unconditionally drops the entry, so a failed delete de-registers the template and orphans the bytes permanently and invisibly (`pruneOrphans` at `:1493` iterates `state.templates`, so it can never find them again).
- `resetAllLocal(opts)` → Promise. Cancel + drain + wipe disk children + rewrite state preserving `libraryPath` + clear `fullSync.failures` / `lastFullSync` / `completedAt`.

Also fix `clearBroken` (`js/local-sync.js:1282-1289`) while in here: it deletes only `broken` and `brokenTs`, leaving `brokenKind` (still surfaced at `:1254`) and `failCount` at 3. `retryTransient` (`:1305-1308`) and `retryBroken` (`:1333-1336`) get this right. Latent today (uncalled from main.js) but it is a two-line correctness fix in a function the new flows may reach.

### Global vs per-template — ship both

**Global**, in `.sync-dash-actions` (`js/main.js:7312-7317`), ids `sd-`-prefixed so they inherit the 13px / 6px-14px sizing at `CSS/style.css:4623` with zero new CSS:

```
sd-delete-local     class="button-secondary"  "Delete local copy"
sd-force-redownload class="button-danger"     "Delete and redownload everything"
```

`sd-force-redownload` = `resetAllLocal()` then `_startFullLibrarySync()`. That is the glitch button the user described: wipe local, force the cloud pull. `sd-delete-local` = `resetAllLocal()` and stop; imports then fall back to cloud on their own (see section 4).

Visibility toggles go in the `show(id, on)` block at `js/main.js:7257-7261`:
```
show('sd-delete-local', hasPath && !s.running);
show('sd-force-redownload', hasPath && !s.running);
```
Hidden while a run is live so nobody can fire a wipe against active writers.

**Per-template** — yes, ship it. It is the surgical fix for one bad template and it exercises the same primitive under a smaller blast radius. Add a "Redownload" button to each `.sd-row` in the list built at `js/main.js:7336-7368`, wired by delegation on `#sd-list` after the `stashGrid.innerHTML = html;` at `js/main.js:7371` (the whole page re-renders on every filter click at `:7374-7380`, so listeners bound anywhere else are lost). Handler: `resetTemplate(sp)` → `_startFullLibrarySync()`. No modal for the single-template case; one template redownloading is not a destructive act worth a dialog.

### Progress surfacing
Reuse the existing plumbing verbatim. `_startFullLibrarySync` (`js/main.js:7151-7183`) already wires the per-file tick to `_updateSyncNavCount` + `_updateSyncBadge` + `_syncDashTick`, and `renderSyncDashboard` arms a 1500ms interval at `js/main.js:7417-7420`. Nothing there needs changing.

The one gap is the wipe phase itself, which is a single host round-trip with no progress. During it, write into `#sd-eta` (`js/main.js:7310`) directly: "Deleting the local copy..." then "Deleted N folders. Starting download." Use the inline status pattern, not a toast — `js/main.js:806` records the house rule for the sidebar path flow explicitly.

---

## 4. "Use cloud instead" fallback

The mechanism already exists and is nearly correct. Five fixes make it trustworthy:

1. **The wipe IS the fallback.** After `resetAllLocal()`, `state.templates` is empty, so `checkLocal` returns `complete:false` for everything (`js/local-sync.js:364`), the fast-path guard at `js/main.js:5102` fails, and every import goes to `_doMirrorImport` → fresh cloud pull. That is the user's "if it does not work locally it will just force it to use the cloud", delivered exactly.

2. **Size-gate the fast path.** `js/local-sync.js:373-374` ignores `aepR.size`. Change to `if (aepR && aepR.exists && aepR.size > 0)`. `blitzLocalListAep` already skips 0-byte and `._` files (`jsx/hostscript.jsx:4418`); `checkLocal`'s direct `template.aep` probe does not. A 0-byte .aep currently takes the fast path.

3. **Stop writing the lie.** `js/local-sync.js:1393-1396`: the rejection handler of `markTemplateComplete` must `return false`, not `_mark()`. Marking complete when verification could not run is what poisons the entry the fast path later trusts.

4. **Repair instead of re-fail.** `js/main.js:4922-4931`: when a local .aep import fails and a `storagePath` is present, clear `complete` (call the new `resetTemplate`, or at minimum `markBroken(sp, reason, 'transient')`) and route to `_doMirrorImport` to re-pull, falling to `_doCloudImport` only if that also fails. Today it goes straight to `_doCloudImport` and leaves the poisoned entry in place, so every future import repeats the whole cycle.

5. **Time-box the mirror branch** (R1). On ceiling expiry, `hideSpinner()` + `setStashInProgress(false)` + `_doCloudImport(...)` + a toast naming the fallback: "Local download stalled. Importing from the cloud instead." That is the automatic version of the manual button.

---

## 5. Error visibility

### The core defect
`js/local-sync.js` has **zero** calls to `debugLog`, `window._blitzLog`, or `blitzkriegAnalytics`. Its only three error statements are `console.warn` at `js/local-sync.js:723`, `:1044`, `:1453`, which reach only the CEP remote-debug console no editor will ever open. Meanwhile `debugLog` at `js/main.js:535-537` auto-forwards every `error`/`warn` to `blitzkriegAnalytics.reportError` → the durable `blitzkrieg_error_logs` table. So the entire local mirror subsystem is invisible both in-panel and server-side. That is the whole reason for "no error logs".

### Fix, in priority order

1. **Add a module-local `_log()` to js/local-sync.js**, mirroring `js/cloud-library.js:38-56` exactly (same `_blitzLog` forward, same warn/error auto-report). Replace the three `console.warn` calls. This single change is the difference between "no error logs" and a full remote picture.
2. **Surface the state-integrity catches** in local-sync: `:75`, `:84`, `:127`, and especially `:167` (localStorage quota exceeded means the mirror ledger silently stops persisting and every symptom after that is a misdirection).
3. **`js/main.js:5120`** — the bodyless `.catch(function() { _doCloudImport(...); })` on `checkLocal`. Fill it: `debugLog('IMPORT: localSync check failed for ' + storagePath + ' (' + (e && e.message || e) + ') - using cloud', 'warn')`. Highest-value single line in the diff.
4. **`js/main.js:4967-4971`** — the empty rejection handler and empty outer catch around `syncThumbnail`. Log at `warn`.
5. **`js/cloud-library.js:1922`** — `catch (fastErr) { /* fall through to listing */ }`. A 403/RLS denial currently reads identically to "file not at the deterministic path". Log at `warn`.
6. **`js/main.js:1232`** — `window.onerror` forwards only to analytics and never calls `debugLog`, so a hard throw is invisible in the very panel the UI tells the user to open (`index.html:490`). The `unhandledrejection` handler at `:1246` does call it. Make them symmetric.
7. **`js/local-sync.js:380`** — `checkLocal`'s `.catch` converts every failure, including the 120s timeout, into "not present". Log before returning the fallback shape.

### Copy-diagnostics affordance

Extend the existing `#debug-log-copy` handler (`js/main.js:572-576`) rather than adding a new button — fewer surfaces. Prepend a `=== DIAGNOSTICS ===` block to the copied text:

- `window.BLITZKRIEG_LOCAL_VERSION`, AE version info, platform
- `window.localSync.getLibraryPath()`
- `window.localSync.getFullSyncStatus()` (full object)
- `state.fullSync.failures`, capped at the 20 most recent
- byte length of each of the 16 owned localStorage keys (quota pressure is invisible today and silently stops all state persistence)
- queue depths for `blitzkrieg_telemetry_queue` and `blitzkrieg_analytics_queue`

**Also fix the copy false-positive:** `js/main.js:575` fires `showToast('Bug log copied to clipboard.')` unconditionally, while `copyToClipboard` (`js/main.js:1406-1424`) swallows both the `navigator.clipboard` rejection and any `execCommand` failure. The editor can be told he copied a log that never reached the clipboard. Move the toast into the resolved branch.

Deferred, not in this PR: raising `MAX_LOG_ENTRIES` (`js/main.js:491`) or adding a separate non-rotating error ring; adding a `sync_failed` analytics event; surfacing `stack`/`context` in the admin Errors tab (`js/main.js:8552-8560`). All real, none blocking.

---

## 6. ORDERED TASK LIST

Phase A and B ship the fix. Phase C ships the buttons. Do not reorder — the buttons stand on the primitive fixed in A3.

### Phase A — make failures visible and bounded (do first, smallest risk, biggest diagnostic payoff)

| # | Change | File:line | Risk |
|---|---|---|---|
| A1 | Add `_log()` to local-sync mirroring cloud-library's; replace the three `console.warn` | `js/local-sync.js:723, 1044, 1453` (helper near `:13`) | Low |
| A2 | Log the swallowed state catches | `js/local-sync.js:75, 84, 127, 167, 380` | Low |
| A3 | Fill the bodyless import catch | `js/main.js:5120` | Low |
| A4 | Log the thumbnail-sync swallows | `js/main.js:4967, 4969, 4971` | Low |
| A5 | Log the .aep fast-path failure | `js/cloud-library.js:1922` | Low |
| A6 | `window.onerror` also calls `debugLog` | `js/main.js:1232-1239` | Low |
| A7 | Diagnostics block in the copy handler + fix the unconditional success toast | `js/main.js:572-576`, `js/main.js:1406-1424` | Low |

### Phase B — kill the hang

| # | Change | File:line | Risk |
|---|---|---|---|
| B1 | Wrap the three raw `download()` awaits in `_downloadWithTimeout` | `js/cloud-library.js:1918, 1972, 1842` (helper at `:1751`) | Low. **Verify 1842 by reading it — I confirmed 1918 and 1972 only.** |
| B2 | Wall-clock ceiling (600000ms) + `_settled` flag on `_doMirrorImport`; expiry hides spinner, clears the flag, toasts, falls to `_doCloudImport` | `js/main.js:4945-4984` | Low |
| B3 | Watchdog also calls `hideSpinner()` | `js/main.js:435-441` | Low |
| B4 | Timeout on the five `safeEvalScript` promise wrappers (60s probes, 300s writes) | `js/main.js:9627, 9676, 9838, 9884, 9906` | **RISKY** — too tight a bound kills a legitimately slow large write. Use generous values, log on expiry, do not silently swallow. |
| B5 | `_importInFlight` guard at the top of `importComp`, cleared in every terminal path; disable the clicked button and add the already-styled `.stash-item.importing` class (`CSS/style.css:2005`, currently dead) | `js/main.js:5075`, `js/main.js:3463` | Low. Must audit every exit path or a stuck flag blocks all imports. |
| B6 | Size-gate `checkLocal`'s `template.aep` probe | `js/local-sync.js:373-374` | Low |
| B7 | `markTemplateComplete` rejection returns false instead of `_mark()` | `js/local-sync.js:1393-1396` | Low. Will cause some previously-"complete" templates to re-download once. Intended. |
| B8 | Local-import failure repairs the entry and routes to `_doMirrorImport` before `_doCloudImport` | `js/main.js:4922-4931` | Medium — new recursion path, cap it at one repair attempt per import |
| B9 | Per-operation watchdog token instead of the shared `_stashWatchdogTimer` | `js/main.js:417, 425-443` | Medium |
| B10 | Unique `.b64` temp names (timestamp + random) in both writers | `js/main.js:9697`, `js/local-sync.js:235` | Low |
| B11 | Apply `MIRROR_MAX_FOOTAGE_BYTES` to `downloadTemplate` | `js/cloud-library.js:1931` (pattern at `:2031`) | Medium — changes what lands in an import bundle. AE substitutes placeholders for skipped footage; confirm that is acceptable for import, not just for mirror. |

### Phase C — the buttons

| # | Change | File:line | Risk |
|---|---|---|---|
| C1 | **New host fn `blitzLocalWipeLibrary(rawRootPath)`** per section 2: isValidPath → structural refusals → `folderFromPath` → per-child `_isPathInsideRoot(..., false)` → `removeFolderRecursive` → re-stat → `{ok, removed, remaining, notFound}` | `jsx/hostscript.jsx`, new fn next to `:4310`; reuses `:3896`, `:3988`, `:3977`, `:309` | **HIGHEST RISK IN THE PR. Recursive delete. A containment bug is unrecoverable data loss on the editor's machine.** ES3 only, no `forEach`, no `Array.isArray`. |
| C2 | Fix `blitzLocalRemoveDir` to call `removeFolderRecursive` and return `{ok, remaining}` | `jsx/hostscript.jsx:4310-4318` | **RISKY** — this function's docstring already claims recursion, so it is a latent trap, but its only caller is dead code (`pruneTemplate` → `pruneOrphans`, no callers outside local-sync.js). Fix it, do not leave two delete primitives with different semantics. |
| C3 | Fix `pruneTemplate` to check the host result before dropping the state entry | `js/local-sync.js:1478-1487` | Low |
| C4 | Fix `clearBroken` to also delete `brokenKind` and zero `failCount` | `js/local-sync.js:1282-1289` | Low |
| C5 | Add `awaitIdle`, `resetTemplate`, `resetAllLocal` to the api object | `js/local-sync.js:264` / exposed `:1518` | Medium |
| C6 | **New file `js/local-reset.js`** holding the UI orchestration (drain → wipe → clear caches → optional resync), exposing `window.localReset`. Loaded between local-sync and main | `index.html:561-562`, same `?v=1.3.21` cache-bust | Low. Keeps main.js (557KB) and local-sync.js (1519 lines) from growing further, per the god-file rule. **Load order matters: after local-sync.js, before main.js.** |
| C7 | `_localResetInProgress` guard so the auto-resume cannot re-arm sync mid-wipe | `js/main.js:7151` (early return) and `js/main.js:1800-1806` | Medium — a stuck flag permanently disables background sync. Clear it in every path including the failure path. |
| C8 | Confirm modal shell | `index.html`, after `:89` | Low |
| C9 | Modal wiring: module-scope lookups, listeners, prompt/execute | `js/main.js:257-260`, `js/main.js:1579-1580` | Low |
| C10 | Two buttons in `.sync-dash-actions` + visibility in the `show()` block | `js/main.js:7312-7317`, `js/main.js:7257-7261`, wiring after `js/main.js:7371` | Low, zero new CSS |
| C11 | Per-template Redownload on `.sd-row`, delegated on `#sd-list` | `js/main.js:7336-7368`, wiring after `:7371` | Low |
| C12 | Resolve the dangling `#sync-force-all` handler (`getElementById` at `js/main.js:791`, handler at `:995-1011`, **no such element in index.html**) — delete it or give it an element | `js/main.js:791, 995-1011` | Low. Leaving dead pre-wired ids around is how the next reader ships a button that never fires. |

### Verification gate before claiming done (live AE, not a code read)
1. Create a library root with a space in the name AND real content. Run the wipe. Confirm from a **separate** `blitzLocalExists` call in a **later turn** that `remaining === 0`. Test a `%`-in-name folder (`50%OFF`) too — `normalizeFsPath` (`jsx/hostscript.jsx:370-390`) is non-idempotent and that is the double-encode trap.
2. Windows drive-letter path — `normalizeFsPath` no-ops entirely when `path.charAt(0) !== '/'`.
3. Force redownload with a live sync running: confirm it drains before wiping and that the queue actually re-pulls (watch `sd-synced` climb from 0).
4. Import a template with the network throttled to a stall: confirm the ceiling fires, the spinner clears, and the cloud fallback runs.
5. Confirm the Bug Log now contains local-sync lines after a forced failure, and that the copied text carries the diagnostics block.

### Two things I could not verify from the repo
- Whether the CEP runtime exposes any directory-capable delete. `js/CSInterface.js` does not declare the `cep.fs` namespace (it is runtime-injected), and the repo uses `cep.fs` only for `writeFile`/`readFile`/`deleteFile` on single files. Treat the evalScript host round-trip as the only delete path — which `js/main.js:9621` already records as the codebase's own verdict. UNVERIFIED.
- What `new Folder('')` resolves to in ExtendScript. `normalizeFsPath` returns a falsy input unchanged (`jsx/hostscript.jsx:371`). The structural refusals in C1 must block this before it is ever exercised. UNVERIFIED.

### Constraint reminders for whoever writes this
No `Promise.finally` anywhere (CEP 8/9). `jsx/hostscript.jsx` is ES3: no `forEach`, no `Array.isArray`, no `JSON` beyond what the file already polyfills, no `atob`/`btoa` (the base64 decoder at `:4242-4293` exists precisely because `atob` silently wrote 0-byte files). No build step, so every new file needs a `<script>` tag with the matching `?v=` cache-bust at `index.html:554-562`, and the OTA update system reads that version. No em dashes in any user-facing string. No save toasts.