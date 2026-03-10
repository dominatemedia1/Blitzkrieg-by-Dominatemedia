# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

<!-- AUTO-MANAGED: project-description -->
## Overview

**Blitzkrieg by Dominate Media** — Adobe CEP (Common Extensibility Platform) panel that runs inside After Effects. Provides a cloud-backed template library where users browse, import, stash, and manage After Effects compositions (.aep files) stored in Supabase Storage.

Key features:
- Cloud template library backed by Supabase Storage (bucket: `blitzkrieg`)
- Auth-gated access with login, access-denied, and offline states
- In-panel template grid with search, sort, category filters, bulk actions
- Stash/generate workflow: exports comps from AE and uploads to cloud
- Submissions workflow: users submit templates for review; admins approve/reject via Review Queue
- ExtendScript host integration via `jsx/hostscript.jsx` (runs in AE engine)

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Architecture

```
index.html               # CEP panel entry point (body.cep-panel); auth screens + modal shells
CSS/
  style.css              # All styles — dark-mode-only design system with CSS custom properties
CSXS/
  manifest.xml           # CEP extension manifest (extension ID, AE version targets)
docs/                    # Project documentation
img/                     # Logo and static images
js/
  main.js                # Main app logic: state, grid rendering, drag-drop, sort, debug log
  auth.js                # Authentication flow (login, denied, offline screens)
  cloud-library.js       # Supabase Storage CRUD: list, upload, download, delete, rename, move
  supabase-config.js     # Supabase client init → window.blitzkriegSupabase
  supabase.min.js        # Supabase JS SDK (vendored)
  CSInterface.js         # Adobe CEP JS bridge (vendored)
  analytics.js           # Analytics
jsx/
  hostscript.jsx         # ExtendScript — runs in After Effects host process; includes JSON polyfill (always replaces native JSON), AE version detection, and macOS path utilities
README.md
```

Data flow:
1. `supabase-config.js` initializes `window.blitzkriegSupabase`
2. `auth.js` verifies credentials; shows app or auth screen
3. `cloud-library.js` exposes `window.cloudLibrary` for all storage ops
4. `main.js` drives UI: loads templates via `cloudLibrary.listTemplates()`, renders grid
5. User actions call `cloudLibrary.*` then `csInterface.evalScript()` via `safeEvalScript()`
6. ExtendScript in `hostscript.jsx` executes inside After Effects

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Code Conventions

- **Module pattern**: All JS files use IIFE `(function() { 'use strict'; ... })()` — no ES modules
- **No build step**: Vanilla JS, no bundler or transpiler; runs directly in CEP Chromium runtime
- **CEP bridge safety**: Always use `safeEvalScript()` (not `csInterface.evalScript()` directly) — checks `window.__adobe_cep__` before calling
- **Async**: `async/await` used in `cloud-library.js`; `var` (not `let`/`const`) used throughout `main.js`
- **CSS**: All styles in `CSS/style.css` (folder is uppercase `CSS/` on disk; `index.html` references `./css/style.css` lowercase — macOS case-insensitive resolves this); use CSS custom properties from `:root` — never hardcode colors or spacing
- **Naming**: kebab-case for CSS classes and IDs; camelCase for JS variables and functions
- **Logging**: Use `window._blitzLog(msg, level)` in `cloud-library.js`; use `debugLog(msg, level)` in `main.js`. Valid levels: `info`, `warn`, `error`, `success`
- **Cache invalidation**: Call `invalidateCache()` after every mutation in `cloud-library.js`
- **localStorage keys**: `blitzkrieg_meta_cache`, `blitzkrieg_sort_order`, `blitzkrieg_grid_size`, `ae_asset_stash_path`
- **Performance utilities**: `debounce(func, wait)` and `throttle(func, limit)` defined in `main.js`; search input uses `debouncedRenderComps` (150ms delay)
- **Input escaping**: Use `escapeForExtendScript(str)` before embedding strings in `evalScript` calls; use `escapeHTML(str)` before injecting into DOM innerHTML — never skip these
- **Name validation**: Use `validateName(name)` for user-provided category/comp names; mirrors ExtendScript `isValidName()` — rejects path separators, `..`, leading/trailing dots and spaces
- **Persistent settings**: Use `loadPersistentSettings(cb)` / `savePersistentSettings(settings, cb)` for library path; file-based via `loadBlitzkriegSettings()` hostscript with `ae_asset_stash_path` localStorage fallback
- **Grid size classes**: Apply `grid-compact`, `grid-normal`, or `grid-large` to `#stash-grid`; persisted to `blitzkrieg_grid_size` localStorage key; never hardcode grid layout inline
- **Sort order values**: Valid values are `name-asc`, `name-desc`, `date-desc`, `date-asc`, `duration-desc`, `duration-asc`; default is `name-asc`; persisted to `blitzkrieg_sort_order`
- **Modal structure**: All modals in `index.html` use `.modal-overlay > .modal-box` with action buttons following `.button-primary` / `.button-secondary` / `.button-danger` classes; modal shells start `display:none` and are toggled by JS
- **Auth screen structure**: Auth screens (login, denied, offline) use `.auth-screen > .auth-container` with `.auth-logo`, `.auth-title`, `.auth-subtitle`; start `display:none`; z-index 3000 places them above all other UI
- **ExtendScript path encoding**: Use `normalizeFsPath(path)` for macOS paths — encodes ONLY space→`%20`, `#`→`%23`, `?`→`%3F`; do NOT use `encodeURIComponent` (breaks non-ASCII chars in ExtendScript); Windows drive-letter paths are returned unchanged
- **ExtendScript path helpers**: Use `buildPath(parent, child)` (extracts `fsName` from Folder/File objects + normalizes), `folderFromPath(fsPath)` and `fileFromPath(fsPath)` (each tries normalized path then falls back to raw path)
- **ExtendScript safe decode**: Use `safeDecodeURI(str)` instead of bare `decodeURI()` — catches URIError when folder names contain literal `%` (e.g., "50%OFF")

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: patterns -->
## Detected Patterns

- **Two-path library load**: FAST PATH uses `localStorage` metadata cache + fresh signed URLs; SLOW PATH does full Supabase fetch. Background refresh keeps cache warm after fast loads.
- **Lazy signed URLs**: Thumbnails (`comp.png`, `thumbnail.png`) signed at load time; preview frames (`preview/frame_N.png`) signed lazily on hover via `signPreviewFrames()`
- **Signed URL cache**: In-memory `_signedUrlCache` with 30-minute TTL (SIGNED_URL_CACHE_TTL) avoids re-signing on panel focus events; signed URL expiry is 4 hours (SIGNED_URL_EXPIRY=14400)
- **Paginated storage listing**: `listAllPaginated()` fetches up to 1000 items/page (50-page max) with duplicate detection to handle Supabase offset limitations
- **Batch signing**: `createSignedUrls()` called in chunks of 100 to stay within request size limits
- **Batched metadata download**: `fetchAllMetadata()` downloads `metadata.json` files in parallel batches of 50 to avoid overwhelming concurrent requests
- **Sort by uniqueId timestamp**: Date sort orders extract timestamp from trailing `_<timestamp>` suffix of `uniqueId` via `parseInt(uniqueId.split('_').pop())`
- **Recursive file collection**: `collectAllFiles()` recurses into subfolders (handles `preview/` subfolder) before delete/move operations
- **CEP bridge re-check**: `safeEvalScript()` re-checks `window.__adobe_cep__` on every call in case bridge appears after initial load
- **Deferred reload**: `pendingLibraryReload` flag queues a reload when `loadLibrary()` is called while `isLoading` is true
- **Debug log system**: In-panel log (200 entry cap), toggle via Ctrl/Cmd+Shift+D or `window.__blitzkriegToggleDebug()`
- **Stash guard flag**: `stashInProgress = true` during stash/generate operations to suppress focus-triggered `loadLibrary()` calls that would interfere
- **Bulk selection state**: `bulkSelectedIds` (Set of uniqueIds) + `bulkMode` boolean; toggled separately from normal single-item actions
- **Favorites and recents**: `favoriteComps` (array of uniqueIds) and `recentComps` (array of `{uniqueId, timestamp}`, capped at `MAX_RECENT_COMPS=10`) tracked in `main.js`
- **Archive detection**: `fetchAllMetadata()` stores RAR/ZIP/7z files found at bucket root in `listTemplates._archives` for separate UI handling; root items named `pending` and `.emptyFolderPlaceholder` are always excluded from category listing
- **Comp object shape**: `buildCompsFromMetadata()` produces objects with fields: `name`, `category`, `uniqueId`, `folderName`, `thumbUrl`, `thumbUrlAlt`, `duration`, `width`, `height`, `frameRate`, `previewFrames` (always `null` — lazy signed on hover), `previewFrameCount`, `thumbnailVerified`, `storagePath`
- **Thumbnail verification**: `thumbnailVerified` is metadata-based (`cloudThumbnailGenerated` flag or `previewFrameCount > 0`). Do NOT use `thumbUrl` to detect missing thumbnails — Supabase `createSignedUrls` generates signed URLs even for non-existent files
- **Generation metadata**: `updateMetadataAfterGeneration()` sets `cloudThumbnailGenerated: true` + frame count on every successful generation (including thumbnail-only cases)
- **CEP compatibility**: Do NOT use `Promise.prototype.finally()` — unavailable in CEP 8/9 (AE 2018-2019, Chromium 57/61). Use `.then(successFn, errorFn)` pattern instead
- **Two-stage download**: `downloadTemplate()` tries `storagePath/template.aep` directly first; falls back to listing the folder and finding any `.aep` file
- **Cross-platform file URL**: `pathToFileUrl(path)` normalises macOS (`/path`) → `file:///path` and Windows (`C:\path`) → `file:///C:/path` with URL-safe encoding
- **Virtual nav categories**: Sidebar `data-category` values drive view switching — real categories are strings from storage; virtual views use reserved values: `All`, `Favorites`, `Recent`, `__submissions_pending`, `__submissions_approved`, `__submissions_rejected`, `__review_pending`, `__analytics`
- **Admin-only sidebar sections**: `#review-section` and `#analytics-section` have class `nav-section-admin-only` and start `display:none`; shown via `querySelectorAll('.nav-section-admin-only')` when user is admin. `#new-category-inline` is hidden separately (inline `display:none`, no admin class) and shown by `initNewCategoryForm()` for admins
- **ExtendScript JSON polyfill**: `hostscript.jsx` unconditionally replaces `JSON = {}` with a Crockford JSON2 polyfill — never conditional — because AE 2024/2025 on macOS ships a native `JSON.stringify` that drops all keys/values (producing `[{: ,: }]`). A self-test verifies `JSON.stringify({"a":"b"})` contains `"a"` on every load.
- **AE version detection**: `AE_VERSION_INFO` global object set at startup via `app.version`; fields: `majorVersion`, `minorVersion`, `isAE2024` (majorVersion===24), `isAE2025` (majorVersion===25), `isAE2025OrLater` (majorVersion>=25); exposed via `getAEVersionInfo()` returning JSON string
- **robustGetFolders pattern**: `robustGetFolders(parentFolder)` tries 4 strategies for macOS `getFiles()` reliability — function filter, unfiltered + instanceof check, recreate Folder from `fsName`, then URI-encode spaces in path; always returns array (never throws)
- **robustFindAep pattern**: `robustFindAep(compFolder)` tries 4 strategies — glob `"*.aep"`, all files + manual extension check (skips `._` macOS resource forks), recreate from `fsName`, URI-encode spaces; returns first matching `File` or `null`

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: build-commands -->
## Build & Development

No build step required. CEP panels load directly in After Effects.

```bash
# Install the extension for development (symlink to AE extensions folder on macOS)
ln -s "$(pwd)" ~/Library/Application\ Support/Adobe/CEP/extensions/BlitzkriegDominateMedia

# Enable unsigned CEP extensions (run once, requires AE restart)
defaults write com.adobe.CSXS.11 PlayerDebugMode 1

# View CEP panel logs (Chrome DevTools remote debug)
# In AE: Help > Debug Extension... or open chrome://inspect in Chrome
```

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Custom Notes

Add project-specific notes here. This section is never auto-modified.

<!-- END MANUAL -->
