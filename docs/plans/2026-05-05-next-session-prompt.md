# Blitzkrieg Mega-Task — Next Session Prompt

## Context

You're working in `~/Coding/Blitzkrieg-by-Dominatemedia/`. This is an Adobe CEP panel that runs inside After Effects. Cloud template library backed by Supabase Storage (bucket: `blitzkrieg`). Supabase project ID: `kwrmdxptrrvlqxdcasho`. Service role key in Supabase Dashboard → Project Settings → API.

Design spec: `docs/plans/2026-05-05-local-library-sync-design.md`

## What We Did This Session

- Audited the local library sync design plan — 14 findings delivered
- Investigated submission review bug — code looks correct, RLS policies fine, likely ExtendScript-level failure
- Enumerated all 218 templates across 4 editor-name categories (Dominate Media: 112, Shaz: 80, John Ventura: 18, Usama Ahmad: 10)
- Extracted all folder names from `storage.objects` (can't download metadata.json contents without service key)
- Deleted the one spam submission from the DB
- Full folder name listing: `/tmp/blitzkrieg-scan/paths.txt`

## Task 1: Deep Scan & Reclassify All 218 Templates

**Goal:** Move templates from editor-name categories to animation-type categories.

### Step 1: Download all metadata.json files

Use the service role key to download every `metadata.json` from private bucket `blitzkrieg`. Each file contains `displayName`, `duration`, `width`, `height`, `frameRate`, `previewFrames`.

```bash
# Generate signed URLs in batches, then download
# Or use supabase-js with service_role key
# Key insight: storage.objects has all paths — query via SQL then download
```

### Step 2: Build classification taxonomy

Based on actual display names (NOT folder names which are often generic), classify into:

Suggested categories (adjust based on actual content):
- **Text Animations** — kinetic typography, title animations, lower thirds
- **Backgrounds** — abstract backgrounds, gradients, particles
- **CTA Animations** — buttons, cards, call-to-action elements
- **Icons & Graphics** — icons, shapes, maps, graphs, tools
- **Transitions** — wipes, slides, reveals, morphs
- **3D Elements** — 3D models, 3D text, depth effects
- **Process/Steps** — step-by-step, flowcharts, numbered sequences
- **Pre-comps** — reusable nested compositions (group by parent type if possible)
- **Client Work** — client-specific comps that can't be genericized (Wylie, Sam Zia, John Ventura AI Tools)

**User's explicit rule:** NO client-based categorization. "I don't think we should categorize anything by client."

### Step 3: Create migration SQL

For each template, you need to:
1. Copy storage objects from `OldCategory/FolderName/` to `NewCategory/FolderName/`
2. Update `_blitzkrieg_manifest_v2.json` to reflect new paths
3. Delete old storage objects after verifying copy
4. Handle the `preview/` subfolder and `(Footage)/` subfolder correctly

The `move` operation in Supabase Storage is server-side copy + delete. Use the REST API with service key:

```
POST /storage/v1/object/move
{ "bucketId": "blitzkrieg", "sourceKey": "old/path", "destinationKey": "new/path" }
```

Write the migration as a Node.js script in `scripts/reclassify-templates.js` that:
1. Reads all current paths from `storage.objects`
2. Maps each to its new category based on classification
3. Moves files in batches
4. Updates the manifest

**CRITICAL:** `getTemplateFileList` and `collectAllFiles` recurse into subfolders. Make sure to move ALL files including `preview/frame_*.png`, `(Footage)/*`, `*.aep`, `comp.png`, `metadata.json`, and any bundle assets.

## Task 2: Fix Submission Review Flow

### Current State
- Code in `js/main.js` `executeAddComp()` (line 2642) and `renderSubmissionsGrid()` (line 4162) looks correct
- RLS policies on `blitzkrieg_template_submissions` are correct
- Edge functions `blitzkrieg-approve-submission` and `blitzkrieg-reject-submission` look correct
- `has_blitzkrieg_access()` RPC works correctly
- `link_blitzkrieg_user_id` RPC works correctly
- Zero pending submissions in DB, zero pending files in storage
- 13 team members have `blitzkrieg_access = true`

### Root Cause Hypothesis
The `stashSelectedCompToTemp` ExtendScript call is likely failing silently. The CEP bridge `evalScript` callback receives a JSON string, but if:
1. AE throws during stash (no comp selected, comp not saved, footage missing)
2. `readTempFiles` can't find the stashed files (path issue between ExtendScript `Folder.fsName` and CEP bridge `listDirAsync`)
3. The error toast is swallowed

### What To Do
1. Add more verbose error logging around `stashSelectedCompToTemp` result
2. Add a `debugLog` call with the raw `result` string before `JSON.parse`
3. Verify `listDirAsync`, `readFileAsBlobAsync`, `fileExistsAsync` are working in the CEP bridge
4. Test with After Effects running — need actual AE instance
5. Check if `getSafeTempFolder()` returns a valid path on both macOS and Windows
6. Consider adding a health-check that tests the full submission pipeline end-to-end

### Quick improvements to make now:
```javascript
// In executeAddComp, after safeEvalScript callback:
debugLog('stashSelectedCompToTemp raw result: ' + result, 'info');
// If parse fails:
try {
    var parsed = JSON.parse(result);
} catch (e) {
    debugLog('Failed to parse stash result: ' + e.message + ' | raw: ' + result, 'error');
    showToast('Submission failed — ExtendScript error. Check debug log.', true);
    setStashInProgress(false);
    hideSpinner();
    return;
}
```

## Task 3: Implement Local Library Sync

Design spec: `docs/plans/2026-05-05-local-library-sync-design.md`

### Implementation order:

1. **Create `js/local-sync.js`** — IIFE pattern, `window.localSync` API
2. **Add `mirrorTemplate()` to `cloud-library.js`** — download all files for a template to local disk
3. **Add `getTemplateFileList()` and `verifyTemplateIntegrity()`** to `cloud-library.js`
4. **Modify `importComp()` in `main.js`** — fast path: check local → if synced use local AEP path
5. **Add sync badge + progress UI** to `index.html`
6. **Add sync styles** to `CSS/style.css`
7. **Add background sync trigger** in `main.js` after grid render
8. **Add prune logic** — delete local templates no longer in manifest

### Key architectural decisions from audit:
- Hostscript.jsx DOES need a change — `importComp` currently expects a temp path. For local sync, it needs to handle persistent paths. Actually, re-read: the design says "no changes" because `importComp` accepts any file path. Verify this.
- Sync state in localStorage key `blitzkrieg_local_sync`
- Library path default: `~/Blitzkrieg Library/`
- CEP file I/O uses `cep.fs.writeFile` with base64 encoding (existing tested path)
- Background sync: `setTimeout(() => localSync.syncAll(), 2000)` after grid render
- Per-template download concurrency: 6
- Full sync concurrency: 3 templates at a time

### Auto-delete on access revoke:
When `checkBlitzkriegAccess()` returns null (user no longer has access), or when auth screen shows "access denied":
1. Call `localSync.getLibraryPath()` to find local mirror
2. Delete the entire local library directory
3. Clear sync state from localStorage
4. This prevents ex-editors from keeping local copies

## Task 4: Update the Design Plan

Apply these fixes to `docs/plans/2026-05-05-local-library-sync-design.md`:
1. Mark hostscript.jsx as "verify no changes needed — importComp may need local path handling"
2. Add auto-delete on access revoke section
3. Add the 14 audit findings (the original plan missed several things)

## Supabase Access

- Project ID: `kwrmdxptrrvlqxdcasho`
- Publishable key: `sb_publishable_wMNJ93D7lys_gVC6HZ3oDQ_sUiabT4E`
- Service role key: Get from Supabase Dashboard → Project Settings → API → `service_role` key
- Bucket: `blitzkrieg` (private)
- Edge functions: `blitzkrieg-approve-submission`, `blitzkrieg-reject-submission`
- RLS helpers: `has_blitzkrieg_access()`, `has_blitzkrieg_admin()`, `link_blitzkrieg_user_id()`

## Files Reference

| File | Purpose |
|------|---------|
| `js/main.js` | Main app logic (7567 lines) |
| `js/auth.js` | Auth flow, `checkBlitzkriegAccess` |
| `js/cloud-library.js` | Storage CRUD, manifest, signed URLs (1721 lines) |
| `js/supabase-config.js` | Supabase client init |
| `jsx/hostscript.jsx` | ExtendScript for AE host (3395 lines) |
| `CSS/style.css` | All styles, CSS custom properties |
| `index.html` | CEP panel entry point |
| `docs/plans/2026-05-05-local-library-sync-design.md` | Design spec |
