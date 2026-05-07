# Local Library Sync — Design Spec

**Date:** 2026-05-05
**Branch:** (not yet created)
**Status:** design-approved

## Problem

Importing a cloud template requires downloading the AEP + footage from Supabase every time. 30-120s per import. Templates with footage show missing files in AE because AEP stores absolute paths and the downloaded `(Footage)/` folder structure doesn't match what AE expects post-download.

## Solution

Maintain a local mirror of the cloud library at `~/Blitzkrieg Library/`. The mirror is a 1:1 copy of the Supabase `blitzkrieg` bucket structure. Imports read from local disk. The mirror syncs incrementally in the background.

Grid loading is unchanged — manifest cache + signed URLs still serve the browsing experience instantly.

## Architecture

```
js/local-sync.js          # NEW — local mirror management
js/cloud-library.js       # +mirrorTemplate(), +getTemplateFileList(), +verifyTemplateIntegrity()
js/main.js                # importComp fast path, sync UI, background trigger, prune on sync
jsx/hostscript.jsx        # no changes
index.html                # + sync badge, + sync settings
CSS/style.css             # + sync badge styles
```

### New Module: `js/local-sync.js`

IIFE pattern matching existing codebase conventions. Exposed as `window.localSync`.

```
window.localSync = {
  // Config
  getLibraryPath(),
  setLibraryPath(path),

  // Status
  checkLocal(storagePath)    → {exists, complete, age, fileCount}
  getSyncState()             → {total, synced, pending, inProgress}

  // Sync
  syncTemplate(storagePath),
  syncAll(),
  syncCategory(categoryName),

  // Import
  getLocalAepPath(storagePath) → path to template.aep on disk

  // Cleanup
  pruneOrphans(manifestPaths),
  pruneDisabled(manifestFolders),
}
```

### Sync State (localStorage key: `blitzkrieg_local_sync`)

```json
{
  "libraryPath": "~/Blitzkrieg Library",
  "templates": {
    "Category/CompName_1234567890": {
      "ts": 1714939200000,
      "files": 12,
      "complete": true
    }
  },
  "lastFullSync": 1714939200000
}
```

### Changes to `cloud-library.js`

**`mirrorTemplate(storagePath, localBasePath)`**
- Lists all files via `collectAllFiles(storagePath)`
- Creates local folder structure: `localBasePath/storagePath/`
- Downloads every file to local mirror with concurrency=6
- Preserves folder structure (`preview/`, `(Footage)/`)
- Returns `{localAepPath, fileCount, sizeBytes}`

**`getTemplateFileList(storagePath)`**
- Lightweight list, no download. For sync state verification.

**`verifyTemplateIntegrity(storagePath)`**
- Checks required files exist: at least one `.aep`, `metadata.json`, thumbnail
- Returns `{complete, missing: [...], warnings: [...]}`
- Used by diagnostics and on forceReload

### Changes to `main.js`

**`importComp()` fast path:**
```
importComp(aepPath, uniqueId, storagePath):
  if storagePath and window.localSync:
    local = localSync.checkLocal(storagePath)
    if local.exists and local.complete:
      // Call existing ExtendScript importComp with local AEP path.
      // Skips download + write phases entirely — 2-5s total.
      → setStashInProgress(true, 'import')
      → safeEvalScript('importComp("' + escapeForExtendScript(localAepPath) + '","' + safeDisplayName + '")')
      → on success: addToRecent, trackImport, trackTemplateImport
      return
    → showToast('Syncing to library...')
    → localSync.syncTemplate(storagePath)
    → then call ExtendScript importComp with local path (same as above)
    return
  // legacy cloud download path (unchanged, kept as fallback)
```

Note: ExtendScript `importComp()` in hostscript.jsx is unchanged — it already accepts any file path. The fast path just feeds it a persistent local path instead of a temp download path.

**Background sync trigger** — after grid render completes:
```
setTimeout(() => localSync.syncAll(), 2000)
```

**Prune on sync completion:**
```
syncAll():
  manifest = fetchManifest()
  manifestPaths = extract storagePaths from manifest.folders
  localPaths = scanLocalTemplates()

  // Download missing/stale
  for path in manifestPaths:
    if not local or stale → queue download

  // Prune orphans: local template not in manifest → delete
  for path in localPaths:
    if path not in manifestPaths → deleteLocal(path)

  // Prune disabled/archived
  for folder in manifest.folders:
    if folder.metadata.status in ['disabled', 'archived']:
      deleteLocal(folder.categoryName + '/' + folder.folderName)
```

**New UI elements:**
- Sync badge in sidebar: "Library: 234/248 synced"
- Click badge → force full sync
- Progress bar during sync operations
- Library path setting in existing settings area

### Sync Strategy

**Per-template download:**
1. `collectAllFiles(storagePath)` — file list (cached 5 min)
2. Create local folder: `~/Blitzkrieg Library/Category/CompName/`
3. Download all files in parallel batches of 6
4. Write via cep.fs base64 (existing tested path)
5. Verify file count matches
6. Update sync state

**Full sync:**
1. Fetch manifest → extract all storagePaths
2. Diff against local sync state
3. Queue missing + templates where manifest ts > local ts
4. Process with concurrency=3 templates
5. Update progress after each template
6. After all downloads: run prune

**Incremental sync:**
1. Fetch manifest (`_blitzkrieg_manifest_v2.json`)
2. Compare `manifest.ts` against `lastFullSync` in sync state
3. Only process templates uploaded after last sync timestamp

**Independent from listTemplates background refresh.** The existing background refresh in `cloud-library.js` updates metadata cache + manifest. `syncAll()` downloads actual files to local disk. They don't share state or block each other.

### Performance Targets

| Operation | Before | After |
|-----------|--------|-------|
| Grid load (cold) | 500ms-5s | Unchanged |
| Grid load (warm) | <100ms | Unchanged |
| Import (synced template) | 30-120s | 2-5s |
| Import (unsynced template) | 30-120s | 30-120s first time |
| Full sync (248 templates) | N/A | ~10 min background |
| Background refresh | 2-5s | Unchanged |

### Import Speed Improvement Detail

Current import downloads these over the network every time:
- AEP file (1-500MB)
- Footage files (0-2GB)
- Bundle assets

After sync, import reads from local SSD:
- No network round-trips
- No Supabase storage API calls
- No base64 encoding overhead (cep.fs is the bottleneck on write, but read for import is direct ExtendScript `app.project.importFile()`)
- ExtendScript reads local file directly — no blob conversion needed

### Edge Cases

- **Library path not set**: prompt on first import, fall back to cloud download
- **Disk full**: surface error, stop sync, keep existing local files
- **Permission denied**: surface error for specific path, continue with other templates
- **Template deleted from cloud between syncs**: prune removes local copy on next sync
- **Template status changed to disabled**: prune removes local copy on next sync
- **Incomplete local copy** (sync interrupted): flagged as `complete: false`, re-downloaded on next sync
- **Stash in progress**: sync skips templates being stashed (stashInProgress flag)
- **Multiple AE instances**: each maintains independent local library (acceptable — sync is additive)

### Files Changed

| File | Change Description |
|------|-------------------|
| `js/local-sync.js` | NEW — full local mirror management module |
| `js/cloud-library.js` | +`mirrorTemplate()`, +`getTemplateFileList()`, +`verifyTemplateIntegrity()` |
| `js/main.js` | `importComp()` fast path, sync UI, background trigger, prune logic |
| `index.html` | + sync badge in sidebar, + library path setting |
| `CSS/style.css` | + `.sync-badge`, `.sync-progress`, `.sync-status` styles |
| `js/supabase-config.js` | no changes |
| `jsx/hostscript.jsx` | no changes |
| `js/auth.js` | no changes |

### Not In Scope

- Peer-to-peer sync between editors
- Delta sync (only changed bytes)
- Sync conflict resolution (cloud is always source of truth)
- Local library shared across AE versions (each AE instance is independent)
