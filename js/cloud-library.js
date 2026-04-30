// js/cloud-library.js
// Cloud-based template library using Supabase Storage
(function () {
    'use strict';

    // Promise.allSettled polyfill — ES2020 and NOT present on CEP 8/9
    // (AE 2018-2019 ships Chromium 57/61). Without this, bulk delete/move
    // would throw "TypeError: Promise.allSettled is not a function" on
    // older AE versions. The rest of this file uses allSettled for the
    // parallel bulk-op paths.
    if (typeof Promise.allSettled !== 'function') {
        Promise.allSettled = function(promises) {
            return Promise.all(promises.map(function(p) {
                return Promise.resolve(p).then(
                    function(v) { return { status: 'fulfilled', value: v }; },
                    function(r) { return { status: 'rejected', reason: r }; }
                );
            }));
        };
    }

    var sb = window.blitzkriegSupabase;
    var BUCKET = 'blitzkrieg';

    // Signed URL expiry: 4 hours (long enough for a workday session)
    var SIGNED_URL_EXPIRY = 14400;

    // Internal logging helper (falls back to console if debugLog not available)
    function _log(msg, level) {
        level = level || 'info';
        if (typeof window._blitzLog === 'function') {
            window._blitzLog('[cloud] ' + msg, level);
        } else if (level === 'error') {
            console.error('[cloud-library] ' + msg);
        } else if (level === 'warn') {
            console.warn('[cloud-library] ' + msg);
        } else {
            console.log('[cloud-library] ' + msg);
        }

        // Auto-report errors and warnings to server
        if ((level === 'error' || level === 'warn') && window.blitzkriegAnalytics && window.blitzkriegAnalytics.reportError) {
            window.blitzkriegAnalytics.reportError('[cloud] ' + msg, level, { source: 'cloud-library' });
        }
    }

    // In-memory signed URL cache — avoids re-signing on every loadLibrary call.
    // Cache TTL is set to (signed URL expiry - 10 minute safety margin) so we
    // never serve a near-expired URL but also don't waste round-trips re-signing
    // every 30 minutes when the URLs are still valid for hours. Saves ~248 batch
    // sign calls per session for an active user.
    var _signedUrlCache = null;
    var _signedUrlCacheTime = 0;
    var SIGNED_URL_CACHE_TTL = (SIGNED_URL_EXPIRY - 600) * 1000; // 4h - 10min in ms

    // localStorage cache for template metadata (persists across restarts)
    var META_CACHE_KEY = 'blitzkrieg_meta_cache';

    // Cloud-side manifest file — a single JSON at bucket root containing the
    // metadata for every template. One download instead of 248+. Rebuilt on any
    // mutation (debounced). Subsequent cold loads (new users, cache-cleared
    // users) go from ~5s → <500ms.
    var MANIFEST_KEY = '_blitzkrieg_manifest.json';
    // 5 min TTL — was 30 min, but submissions approved by admins or templates
    // added outside the panel (Supabase dashboard, scripts) don't always trigger
    // invalidateManifest(), so users could see a stale list for up to 30 min.
    // Shorter TTL bounds drift without giving up the cold-load speedup.
    // Stale manifests are still served (stale-while-revalidate) — the TTL only
    // controls whether the caller treats the manifest as "fresh enough to skip
    // background refresh" vs "use this immediately + refresh in the background".
    var MANIFEST_TTL_MS = 5 * 60 * 1000;

    // Per-attempt list timeout — adaptive. 8s was too aggressive for slow
    // networks (regional editors on high-latency links saw EVERY category
    // time out at exactly 8000ms, manifest never refreshed, new uploads
    // invisible). The Supabase server-side timeout is ~30s; we want to
    // sit under that on the first try and grow on retries to forgive a
    // single transient backend slowdown.
    //   attempt 1 → 15s, attempt 2 → 30s, attempt 3 → 60s
    // Worst case 3-attempt cost is 15+1+30+2+60 = 108s per failing category
    // BUT a healthy category resolves in 1-2s so this only matters when the
    // backend is genuinely failing for that prefix.
    var LIST_TIMEOUT_BY_ATTEMPT = [15000, 30000, 60000];
    var LIST_TIMEOUT_MS = LIST_TIMEOUT_BY_ATTEMPT[0]; // legacy alias for diagnostics

    // Diagnostic state — populated by listTemplates() at each tier exit so
    // getDiagnostics() can report what actually happened on the last load.
    var _lastLoad = { ts: 0, source: null, durationMs: 0, count: 0, partial: false, failedCategories: [] };

    function _listWithTimeout(folder, opts, timeoutMs) {
        timeoutMs = timeoutMs || LIST_TIMEOUT_MS;
        var listPromise = sb.storage.from(BUCKET).list(folder, opts || {});
        var timeoutPromise = new Promise(function (_, reject) {
            setTimeout(function () {
                reject(new Error('List timed out after ' + timeoutMs + 'ms'));
            }, timeoutMs);
        });
        return Promise.race([listPromise, timeoutPromise]);
    }

    // CEP 8/9 fallback for `new CustomEvent(name, {detail})` — old Chromium
    // missing the constructor. Single helper instead of try/catch duplicated
    // at every dispatch site.
    function _dispatchCustom(name, detail) {
        try {
            window.dispatchEvent(new CustomEvent(name, { detail: detail }));
        } catch (e) {
            try {
                var ev = document.createEvent('CustomEvent');
                ev.initCustomEvent(name, false, false, detail || {});
                window.dispatchEvent(ev);
            } catch (e2) {}
        }
    }

    // Returns {manifest, age, stale} — caller decides what to do with stale
    // manifests. Stale-while-revalidate: cold load can render the stale
    // manifest immediately and kick off a background refresh, instead of
    // falling through to the 5-30s slow path.
    async function fetchManifest() {
        try {
            var res = await sb.storage.from(BUCKET).download(MANIFEST_KEY);
            if (res.error || !res.data) return null;
            var text = await res.data.text();
            var manifest = JSON.parse(text);
            if (!manifest || !Array.isArray(manifest.folders)) return null;
            var age = Date.now() - (manifest.ts || 0);
            manifest._age = age;
            manifest._stale = age > MANIFEST_TTL_MS;
            if (manifest._stale) {
                _log('fetchManifest: STALE-WHILE-REVALIDATE (age ' + Math.round(age / 1000) + 's > TTL ' + Math.round(MANIFEST_TTL_MS / 1000) + 's)', 'info');
            } else {
                _log('fetchManifest: loaded ' + manifest.folders.length + ' entries (age ' + Math.round(age / 1000) + 's)', 'success');
            }
            return manifest;
        } catch (e) {
            _log('fetchManifest error: ' + (e && e.message || e), 'warn');
            return null;
        }
    }

    function uploadManifest(metadataResults, archives) {
        // Fire-and-forget — don't block the caller. Failures are logged.
        try {
            // CRITICAL: filter out null-metadata entries before persisting. A
            // transient 503/timeout on a single metadata.json must NOT poison
            // the cloud manifest with a null entry — every editor that fetches
            // the poisoned manifest would render fewer templates than reality.
            // The next slow path picks up the missing entries fresh.
            var cleanResults = (metadataResults || []).filter(function(mr) {
                return mr && mr.metadata !== null && mr.metadata !== undefined;
            });
            var droppedNulls = (metadataResults || []).length - cleanResults.length;
            if (droppedNulls > 0) {
                _log('uploadManifest: dropped ' + droppedNulls + ' null-metadata entries from manifest', 'warn');
            }
            var manifest = {
                version: 1,
                ts: Date.now(),
                folders: cleanResults,
                archives: archives || []
            };
            var blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
            sb.storage.from(BUCKET).upload(MANIFEST_KEY, blob, {
                contentType: 'application/json',
                upsert: true
            }).then(function (res) {
                if (res.error) {
                    _log('uploadManifest: ' + res.error.message, 'warn');
                } else {
                    _log('uploadManifest: published ' + cleanResults.length + ' entries', 'success');
                }
            }).catch(function (err) {
                _log('uploadManifest exception: ' + (err && err.message || err), 'warn');
            });
        } catch (e) {
            _log('uploadManifest build failed: ' + (e && e.message || e), 'warn');
        }
    }

    // Notify main.js when a background refresh found a different template SET
    // than what's currently rendered. Compares the set of "category/folder"
    // paths instead of just counts — two libraries with the same total but
    // different members (one removed, one added) used to silently bypass this
    // and leave the user looking at a stale grid.
    function _pathSet(folders) {
        var out = {};
        if (!folders || !folders.length) return out;
        for (var i = 0; i < folders.length; i++) {
            var f = folders[i];
            if (!f) continue;
            out[f.categoryName + '/' + f.folderName] = 1;
        }
        return out;
    }
    function _setsDiffer(a, b) {
        var ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return true;
        for (var i = 0; i < ka.length; i++) { if (!b[ka[i]]) return true; }
        return false;
    }
    function _maybeNotifyChange(staleFolders, freshFolders) {
        // Backwards-compatible: callers may still pass plain numbers (legacy)
        // but the new contract is two folder arrays so we can compare sets.
        var oldCount, newCount, changed;
        if (typeof staleFolders === 'number' && typeof freshFolders === 'number') {
            oldCount = staleFolders; newCount = freshFolders;
            changed = oldCount !== newCount;
        } else {
            oldCount = (staleFolders || []).length;
            newCount = (freshFolders || []).length;
            changed = _setsDiffer(_pathSet(staleFolders), _pathSet(freshFolders));
        }
        if (!changed) return;
        _log('library changed: ' + oldCount + ' -> ' + newCount + ' (set differs), notifying UI', 'info');
        _dispatchCustom('blitzkrieg-library-changed', { oldCount: oldCount, newCount: newCount });
    }

    // Debounced manifest invalidation — rapid successive mutations (bulk delete,
    // bulk move) only trigger one delete+rebuild cycle.
    var _manifestInvalidateTimer = null;
    function invalidateManifest() {
        if (_manifestInvalidateTimer) clearTimeout(_manifestInvalidateTimer);
        _manifestInvalidateTimer = setTimeout(function () {
            _manifestInvalidateTimer = null;
            sb.storage.from(BUCKET).remove([MANIFEST_KEY]).then(function (r) {
                if (!r.error) _log('manifest invalidated', 'info');
            }).catch(function () {});
        }, 1500);
    }

    /**
     * Get cached metadata from localStorage (persists across sessions).
     * Returns {folders: [{categoryName, folderName, metadata}], ts: number} or null
     */
    function getCachedMetadata() {
        try {
            var raw = localStorage.getItem(META_CACHE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    /**
     * Save metadata to localStorage. opts.partialUntilTs marks the cache as
     * "good enough until this timestamp" so the next listTemplates() avoids
     * re-running the slow path for ~60s after a partial fetch (see #3 in the
     * fix-wave plan — stops the user from being punished with a 160s reload
     * every time Shaz times out).
     *
     * No length-equality short-circuit. The previous heuristic could silently
     * skip a real change (e.g. one template renamed in place — same payload
     * length, different content). Always write; the 5-15ms blocking cost is
     * negligible vs the user-visible bug of stale grid state.
     */
    function setCachedMetadata(metadataResults, opts) {
        opts = opts || {};
        var payload;
        try {
            var obj = { ts: Date.now(), folders: metadataResults };
            if (opts.partialUntilTs) obj.partialUntilTs = opts.partialUntilTs;
            if (opts.failedCategories) obj.failedCategories = opts.failedCategories;
            payload = JSON.stringify(obj);
        } catch (sErr) {
            _log('setCachedMetadata: stringify failed: ' + (sErr && sErr.message || sErr), 'warn');
            return;
        }
        try {
            localStorage.setItem(META_CACHE_KEY, payload);
        } catch (e) {
            _log('setCachedMetadata: localStorage write failed: ' + (e && e.message || e), 'warn');
        }
    }

    /**
     * Merge stale cache folders with a fresh fetch where some categories
     * failed. For each failed category, keep the stale entries (if any).
     * For each success category, take ONLY fresh entries (drops deletes).
     * Also keeps any stale entries whose category isn't represented at all
     * in fresh (defensive — shouldn't happen but cheap to guard).
     */
    function _mergePartialFolders(staleFolders, freshFolders, failedCategoryNames) {
        if (!Array.isArray(failedCategoryNames) || failedCategoryNames.length === 0) {
            return freshFolders || [];
        }
        var failedSet = {};
        for (var i = 0; i < failedCategoryNames.length; i++) failedSet[failedCategoryNames[i]] = 1;

        // Collect successful categories from fresh: any category that has at
        // least one entry AND isn't in failedSet.
        var successCats = {};
        var freshByCat = {};
        var fresh = freshFolders || [];
        for (var fi = 0; fi < fresh.length; fi++) {
            var ff = fresh[fi];
            if (!ff || !ff.categoryName) continue;
            if (!freshByCat[ff.categoryName]) freshByCat[ff.categoryName] = [];
            freshByCat[ff.categoryName].push(ff);
            if (!failedSet[ff.categoryName]) successCats[ff.categoryName] = 1;
        }

        var merged = [];
        // Take fresh entries for success categories.
        Object.keys(successCats).forEach(function (cat) {
            var arr = freshByCat[cat];
            for (var i = 0; i < arr.length; i++) merged.push(arr[i]);
        });
        // Take stale entries for failed categories.
        var stale = staleFolders || [];
        for (var si = 0; si < stale.length; si++) {
            var sf = stale[si];
            if (!sf || !sf.categoryName) continue;
            if (failedSet[sf.categoryName]) merged.push(sf);
        }
        return merged;
    }

    /**
     * Invalidate the metadata cache (local AND cloud manifest).
     * Called after every mutation so the next listTemplates() sees fresh data.
     */
    function invalidateCache() {
        try { localStorage.removeItem(META_CACHE_KEY); } catch (e) {}
        _signedUrlCache = null;
        _signedUrlCacheTime = 0;
        invalidateManifest();
    }

    /**
     * Surgical signed-URL cache invalidation for single-template mutations
     * (rename, single delete, single move). Avoids re-signing all 290+ URLs
     * just because one template changed.
     */
    function invalidateCacheForPath(storagePath) {
        if (_signedUrlCache && storagePath && _signedUrlCache[storagePath]) {
            delete _signedUrlCache[storagePath];
        }
        // Local cache + cloud manifest still need to be rebuilt — the changed
        // template's metadata.json may have changed, and the manifest needs
        // to reflect rename/delete events.
        try { localStorage.removeItem(META_CACHE_KEY); } catch (e) {}
        invalidateManifest();
    }

    /**
     * Sign thumbnail URLs and build comp objects from metadata results.
     * Only signs thumbnail URLs initially (fast). Preview frames are signed lazily on hover.
     */
    async function buildCompsFromMetadata(metadataResults) {
        // Sign ONLY thumbnail URLs (2 per template: comp.png + thumbnail.png)
        // Preview frame URLs are signed lazily on hover via signPreviewFrames()

        var validEntries = metadataResults.filter(function(mr) { return mr.metadata !== null && mr.metadata !== undefined; });
        _log('buildCompsFromMetadata: ' + validEntries.length + ' entries with metadata (of ' + metadataResults.length + ' total)', 'info');

        var signedUrlMap;
        var now = Date.now();

        // Use cached signed URLs if still fresh (avoids re-signing on every focus).
        // Templates added since the cache was built are NOT in the cached map,
        // so sign just the missing ones and merge — otherwise newly added
        // templates would render with empty thumbnail URLs after a background
        // refresh until the next 4h cache rotation.
        if (_signedUrlCache && (now - _signedUrlCacheTime < SIGNED_URL_CACHE_TTL)) {
            signedUrlMap = _signedUrlCache;
            var missingPaths = [];
            var missingIndex = {};
            for (var mi = 0; mi < validEntries.length; mi++) {
                var mEntry = validEntries[mi];
                var mKey = mEntry.categoryName + '/' + mEntry.folderName;
                if (signedUrlMap[mKey]) continue;
                var mCompPath = mKey + '/comp.png';
                var mThumbPath = mKey + '/thumbnail.png';
                missingPaths.push(mCompPath);
                missingPaths.push(mThumbPath);
                missingIndex[mCompPath] = { categoryName: mEntry.categoryName, folderName: mEntry.folderName, type: 'thumb_comp' };
                missingIndex[mThumbPath] = { categoryName: mEntry.categoryName, folderName: mEntry.folderName, type: 'thumb_new' };
            }
            if (missingPaths.length > 0) {
                _log('buildCompsFromMetadata: signing ' + missingPaths.length + ' new thumbnails missing from cache', 'info');
                var BATCH_M = 100;
                for (var bm = 0; bm < missingPaths.length; bm += BATCH_M) {
                    var batchM = missingPaths.slice(bm, bm + BATCH_M);
                    var resM = await sb.storage.from(BUCKET).createSignedUrls(batchM, SIGNED_URL_EXPIRY);
                    if (resM.data) {
                        resM.data.forEach(function(item) {
                            if (item.error || !item.signedUrl) return;
                            var info = missingIndex[item.path];
                            if (!info) return;
                            var key = info.categoryName + '/' + info.folderName;
                            if (!signedUrlMap[key]) signedUrlMap[key] = {};
                            if (info.type === 'thumb_comp') signedUrlMap[key].thumbCompUrl = item.signedUrl;
                            else if (info.type === 'thumb_new') signedUrlMap[key].thumbNewUrl = item.signedUrl;
                        });
                    }
                }
                _signedUrlCache = signedUrlMap;
            }
        } else {
            var pathsToSign = [];
            var pathIndexMap = {};

            metadataResults.forEach(function (mr) {
                if (!mr.metadata) return;
                var basePath = mr.categoryName + '/' + mr.folderName;

                var compPngPath = basePath + '/comp.png';
                pathsToSign.push(compPngPath);
                pathIndexMap[compPngPath] = { categoryName: mr.categoryName, folderName: mr.folderName, type: 'thumb_comp' };

                var thumbPngPath = basePath + '/thumbnail.png';
                pathsToSign.push(thumbPngPath);
                pathIndexMap[thumbPngPath] = { categoryName: mr.categoryName, folderName: mr.folderName, type: 'thumb_new' };
            });

            signedUrlMap = {};
            // Batch sign in chunks of 100 to avoid request size limits
            var SIGN_BATCH = 100;
            for (var b = 0; b < pathsToSign.length; b += SIGN_BATCH) {
                var batch = pathsToSign.slice(b, b + SIGN_BATCH);
                var signResult = await sb.storage.from(BUCKET).createSignedUrls(batch, SIGNED_URL_EXPIRY);
                if (signResult.data) {
                    signResult.data.forEach(function (item) {
                        if (item.error || !item.signedUrl) return;
                        var info = pathIndexMap[item.path];
                        if (!info) return;
                        var key = info.categoryName + '/' + info.folderName;
                        if (!signedUrlMap[key]) signedUrlMap[key] = {};
                        if (info.type === 'thumb_comp') {
                            signedUrlMap[key].thumbCompUrl = item.signedUrl;
                        } else if (info.type === 'thumb_new') {
                            signedUrlMap[key].thumbNewUrl = item.signedUrl;
                        }
                    });
                }
            }

            // Cache for reuse
            _signedUrlCache = signedUrlMap;
            _signedUrlCacheTime = now;
            _log('buildCompsFromMetadata: signed ' + pathsToSign.length + ' thumbnail URLs in ' + (Date.now() - now) + 'ms', 'info');
        }

        // Build comp objects
        var allComps = [];
        metadataResults.forEach(function (mr) {
            if (!mr.metadata) return;
            var meta = mr.metadata;

            // Guard against missing required fields — metadata.json could be corrupt/partial
            var displayName = meta.displayName || meta.name || mr.folderName || 'Untitled';
            if (typeof displayName !== 'string') displayName = String(displayName);

            var parts = mr.folderName.split('_');
            var uniqueId = parts.length > 1 ? parts[parts.length - 1] : mr.folderName;
            var storagePath = mr.categoryName + '/' + mr.folderName;
            var urls = signedUrlMap[storagePath] || {};

            var thumbUrl = urls.thumbCompUrl || urls.thumbNewUrl || '';
            var thumbUrlAlt = urls.thumbNewUrl || '';
            if (thumbUrl === urls.thumbCompUrl && urls.thumbNewUrl) {
                thumbUrlAlt = urls.thumbNewUrl;
            } else if (thumbUrl === urls.thumbNewUrl && urls.thumbCompUrl) {
                thumbUrlAlt = urls.thumbCompUrl;
            }

            var previewFrameCount = 0;
            if (typeof meta.previewFrames === 'number') previewFrameCount = meta.previewFrames;
            if (meta.cloudPreviewFrameCount) previewFrameCount = Math.max(previewFrameCount, meta.cloudPreviewFrameCount);

            // A template's thumbnail is "verified" if we have evidence it was generated:
            // either via cloud generation (cloudThumbnailGenerated flag or cloudPreviewFrameCount)
            // or via stash upload (previewFrameCount > 0 means thumbnail was included)
            var thumbnailVerified = !!(meta.cloudThumbnailGenerated || previewFrameCount > 0);

            allComps.push({
                name: displayName,
                category: mr.categoryName,
                uniqueId: uniqueId,
                folderName: mr.folderName,
                thumbUrl: thumbUrl,
                thumbUrlAlt: thumbUrlAlt,
                duration: meta.duration || 0,
                width: meta.width || 0,
                height: meta.height || 0,
                frameRate: meta.frameRate || 0,
                previewFrames: null,  // Signed lazily on hover
                previewFrameCount: previewFrameCount,
                thumbnailVerified: thumbnailVerified,
                storagePath: storagePath,
            });
        });

        return allComps;
    }

    /**
     * Sign preview frame URLs on demand (called on hover).
     * Returns array of signed URLs for preview/frame_N.png.
     */
    async function signPreviewFrames(storagePath, frameCount) {
        if (!frameCount || frameCount <= 0) return [];
        var paths = [];
        for (var i = 0; i < frameCount; i++) {
            paths.push(storagePath + '/preview/frame_' + i + '.png');
        }
        // Batch sign in chunks of 100
        var signed = [];
        var BATCH = 100;
        for (var b = 0; b < paths.length; b += BATCH) {
            var batch = paths.slice(b, b + BATCH);
            var result = await sb.storage.from(BUCKET).createSignedUrls(batch, SIGNED_URL_EXPIRY);
            if (result.data) {
                result.data.forEach(function(item) {
                    if (!item.error && item.signedUrl) signed.push(item.signedUrl);
                });
            }
        }
        return signed;
    }

    /**
     * Paginated list helper — Supabase storage may cap results well below the
     * requested limit (commonly 100 per page). This fetches all pages using offset.
     * Falls back to single-page if offset isn't supported (detects duplicate results).
     */
    async function listAllPaginated(folder, opts) {
        var PAGE = 1000; // Supabase supports up to 1000 — reduces API round-trips
        var allItems = [];
        var offset = 0;
        var seenNames = {};
        var maxPages = 50; // Safety limit
        var page = 0;
        var label = folder === '' ? 'root' : '"' + folder + '"';
        var pageTimeout = (opts && opts._timeoutMs) || undefined;
        while (page < maxPages) {
            var res = await _listWithTimeout(folder, {
                limit: PAGE,
                offset: offset,
                sortBy: opts && opts.sortBy ? opts.sortBy : { column: 'name', order: 'asc' },
            }, pageTimeout);
            if (res.error) {
                _log('List FAILED for ' + label + ': ' + res.error.message + ' (status: ' + (res.status || 'unknown') + ')', 'error');
                throw new Error('List failed for ' + label + ': ' + res.error.message);
            }
            var items = res.data || [];
            if (items.length === 0) break;

            // Detect if offset is being ignored (duplicate results)
            var hasDuplicates = false;
            if (page > 0 && items.length > 0) {
                var firstKey = items[0].name;
                if (seenNames[firstKey]) { hasDuplicates = true; }
            }
            if (hasDuplicates) {
                _log('Offset not supported, stopping pagination for ' + label + ' at ' + allItems.length + ' items', 'warn');
                break;
            }

            items.forEach(function(it) { seenNames[it.name] = true; });
            allItems = allItems.concat(items);

            if (items.length < PAGE) break; // last page
            offset += PAGE;
            page++;
        }
        _log('Listed ' + label + ': ' + allItems.length + ' items (' + (page + 1) + ' pages)');
        return allItems;
    }

    /**
     * Full metadata fetch — downloads all metadata.json files from storage.
     * Returns array of {categoryName, folderName, metadata} objects.
     * Uses paginated listing to ensure ALL templates are returned.
     */
    async function fetchAllMetadata() {
        var t0 = Date.now();

        // Step 1: List all top-level folders (categories) — paginated
        _log('fetchAllMetadata: listing root...', 'info');
        var allRootItems = await listAllPaginated('', { sortBy: { column: 'name', order: 'asc' } });
        _log('fetchAllMetadata: root has ' + allRootItems.length + ' items (folders + files)', 'info');

        // Log all root item names for debugging
        if (allRootItems.length > 0) {
            var rootNames = allRootItems.map(function(it) {
                return it.name + (it.id === null ? '/' : '');
            });
            _log('fetchAllMetadata: root contents: [' + rootNames.join(', ') + ']', 'info');
        } else {
            _log('fetchAllMetadata: bucket root is EMPTY — no categories found', 'warn');
        }

        var categories = allRootItems.filter(function (item) {
            return item.id === null && item.name !== 'pending' && item.name !== '.emptyFolderPlaceholder' && item.name !== MANIFEST_KEY;
        });
        _log('fetchAllMetadata: ' + categories.length + ' categories found: [' + categories.map(function(c) { return c.name; }).join(', ') + ']', 'info');

        // Detect RAR/ZIP archives at root level. Use indexOf-based suffix check
        // because String.prototype.endsWith is ES6 — CEP 8/9 (AE 2018-2019) does
        // not have it, and the rest of this codebase deliberately avoids ES6 strings.
        function _endsWith(str, suffix) {
            return str.length >= suffix.length && str.indexOf(suffix, str.length - suffix.length) !== -1;
        }
        var archives = allRootItems.filter(function (item) {
            if (item.id === null) return false;
            var n = (item.name || '').toLowerCase();
            return _endsWith(n, '.rar') || _endsWith(n, '.zip') || _endsWith(n, '.7z');
        });
        listTemplates._archives = archives.map(function (a) {
            return { name: a.name, size: a.metadata && a.metadata.size ? a.metadata.size : 0 };
        });

        if (categories.length === 0) {
            _log('fetchAllMetadata: no categories → returning empty (took ' + (Date.now() - t0) + 'ms)', 'warn');
            return [];
        }

        // Steps 2+3: STREAMING category-list + metadata download. Categories
        // are listed in parallel; as each category list resolves, its folder
        // entries are pushed onto a shared queue that a fixed worker pool
        // (CONCURRENCY=50) is already draining. A single 90-second Shaz
        // retry no longer blocks Dominate Media's 115 metadata downloads
        // from starting — the slow-path total time becomes
        //   max(slowest category list, total metadata time / CONCURRENCY)
        // instead of (slowest category list) + (total metadata / CONCURRENCY).
        _log('fetchAllMetadata: listing ' + categories.length + ' category folders in parallel (streaming metadata)...', 'info');

        async function listCategoryWithRetry(catName, maxAttempts) {
            maxAttempts = maxAttempts || 3;
            var attempts = 0;
            var lastErr;
            while (attempts < maxAttempts) {
                var attemptIdx = attempts;
                attempts++;
                var attemptTimeout = LIST_TIMEOUT_BY_ATTEMPT[attemptIdx] || LIST_TIMEOUT_BY_ATTEMPT[LIST_TIMEOUT_BY_ATTEMPT.length - 1];
                try {
                    return await listAllPaginated(catName, { _timeoutMs: attemptTimeout });
                } catch (err) {
                    lastErr = err;
                    _log('listCategory "' + catName + '" attempt ' + attempts + '/' + maxAttempts + ' (timeout ' + attemptTimeout + 'ms) failed: ' + (err && err.message || err), 'warn');
                    if (attempts < maxAttempts) {
                        // Jittered backoff: 1.5s, 3s + ±400ms. Slow networks
                        // can recover within a couple of seconds; longer waits
                        // just stretch the user's perceived load time.
                        var backoff = 1500 * attempts + Math.floor(Math.random() * 400);
                        await new Promise(function(r) { setTimeout(r, backoff); });
                    }
                }
            }
            throw lastErr;
        }

        var allFolderEntries = []; // grows as each category list resolves
        var metadataResults = [];  // 1:1 with allFolderEntries by push order
        var queueIdx = 0;          // next entry the worker pool should claim
        var listingDone = false;
        var failedCategoryNames = [];

        function downloadOne(idx) {
            var entry = allFolderEntries[idx];
            if (!entry) return Promise.resolve();
            var metaPath = entry.categoryName + '/' + entry.folderName + '/metadata.json';
            return sb.storage.from(BUCKET).download(metaPath).then(function (res) {
                if (res.error) {
                    _log('fetchAllMetadata: download failed for ' + metaPath + ': ' + (res.error.message || 'unknown'), 'warn');
                    metadataResults[idx] = { categoryName: entry.categoryName, folderName: entry.folderName, metadata: null };
                    return;
                }
                return res.data.text().then(function (text) {
                    try {
                        metadataResults[idx] = { categoryName: entry.categoryName, folderName: entry.folderName, metadata: JSON.parse(text) };
                    } catch (parseErr) {
                        _log('fetchAllMetadata: metadata.json parse failed for ' + metaPath + ': ' + parseErr.message, 'warn');
                        metadataResults[idx] = { categoryName: entry.categoryName, folderName: entry.folderName, metadata: null };
                    }
                });
            }).catch(function (err) {
                _log('fetchAllMetadata: unexpected error for ' + metaPath + ': ' + (err && err.message || err), 'warn');
                metadataResults[idx] = { categoryName: entry.categoryName, folderName: entry.folderName, metadata: null };
            });
        }

        async function worker() {
            while (true) {
                if (queueIdx < allFolderEntries.length) {
                    var myIdx = queueIdx++;
                    await downloadOne(myIdx);
                } else if (listingDone) {
                    return;
                } else {
                    // Wait briefly for more entries — categories still listing.
                    await new Promise(function(r) { setTimeout(r, 50); });
                }
            }
        }

        var CONCURRENCY = 50;
        var workers = [];
        for (var w = 0; w < CONCURRENCY; w++) workers.push(worker());

        // Producer: list categories with capped parallelism. Listing all 4-10
        // categories simultaneously hammered the Supabase storage backend
        // and caused EVERY list call to time out at exactly 8s on slow
        // (high-latency) networks — manifest never refreshed and new
        // uploads stayed invisible. Cap at 2 in-flight at a time so a slow
        // network has bandwidth headroom for each list to actually finish.
        var LIST_CAT_CONCURRENCY = 2;
        var catQueue = categories.slice();
        async function listCatWorker() {
            while (catQueue.length > 0) {
                var cat = catQueue.shift();
                if (!cat) break;
                try {
                    var items = await listCategoryWithRetry(cat.name);
                    var compFolders = items.filter(function (item) { return item.id === null; });
                    _log('fetchAllMetadata: "' + cat.name + '" → ' + compFolders.length + ' comp folders (streaming)', 'info');
                    for (var fi = 0; fi < compFolders.length; fi++) {
                        allFolderEntries.push({ categoryName: cat.name, folderName: compFolders[fi].name });
                    }
                } catch (err) {
                    _log('fetchAllMetadata: listing category "' + cat.name + '" FAILED after retries: ' + (err && err.message || err), 'error');
                    failedCategoryNames.push(cat.name);
                }
            }
        }
        var listPromises = [];
        for (var lcw = 0; lcw < LIST_CAT_CONCURRENCY; lcw++) listPromises.push(listCatWorker());
        await Promise.all(listPromises);
        listingDone = true;
        await Promise.all(workers);

        _log('fetchAllMetadata: ' + allFolderEntries.length + ' total comp folders downloaded', 'info');

        if (allFolderEntries.length === 0) {
            _log('fetchAllMetadata: no comp folders → returning empty (took ' + (Date.now() - t0) + 'ms)', 'warn');
            var emptyOut = [];
            if (failedCategoryNames.length > 0) emptyOut._failedCategories = failedCategoryNames;
            return emptyOut;
        }

        // Retry pass for transient failures. A single 503 / network blip
        // during the first sweep used to permanently null that template
        // (and worse, poison the published manifest). Retry once with
        // lower concurrency before giving up.
        var nullIdxs = [];
        for (var ni = 0; ni < metadataResults.length; ni++) {
            if (!metadataResults[ni] || metadataResults[ni].metadata == null) nullIdxs.push(ni);
        }
        if (nullIdxs.length > 0) {
            _log('fetchAllMetadata: retrying ' + nullIdxs.length + ' failed metadata downloads...', 'info');
            var RETRY_CONCURRENCY = Math.min(10, nullIdxs.length);
            var retryQueue = nullIdxs.slice();
            async function retryWorker() {
                while (retryQueue.length > 0) {
                    var idx = retryQueue.shift();
                    if (idx === undefined) break;
                    await new Promise(function(r) { setTimeout(r, 200); });
                    await downloadOne(idx);
                }
            }
            var retryWorkers = [];
            for (var rw = 0; rw < RETRY_CONCURRENCY; rw++) retryWorkers.push(retryWorker());
            await Promise.all(retryWorkers);
            var stillNull = 0;
            for (var sni = 0; sni < nullIdxs.length; sni++) {
                if (!metadataResults[nullIdxs[sni]] || metadataResults[nullIdxs[sni]].metadata == null) stillNull++;
            }
            _log('fetchAllMetadata: retry recovered ' + (nullIdxs.length - stillNull) + '/' + nullIdxs.length + ' failed entries', 'info');
        }

        var withMeta = metadataResults.filter(function(r) { return r && r.metadata !== null; }).length;
        var partial = withMeta < metadataResults.length;
        _log('fetchAllMetadata: done — ' + withMeta + '/' + metadataResults.length + ' have metadata (took ' + (Date.now() - t0) + 'ms)', withMeta > 0 ? 'success' : 'warn');

        // Surface partial loads as a discrete telemetry event so we can see in
        // analytics how often the library is undercounting. A category-list
        // failure is FAR worse than a single metadata.json failure — it drops
        // every template in that category from the published manifest.
        var hasCategoryFailures = failedCategoryNames.length > 0;
        if ((partial || hasCategoryFailures) && window.blitzkriegAnalytics && window.blitzkriegAnalytics.trackAccessChange) {
            try {
                window.blitzkriegAnalytics.trackAccessChange(null, 'library_partial_load', null);
            } catch (te) {}
        }

        // Attach the failed-category list to the result so the caller can
        // refuse to overwrite the cache + manifest with a POISONED snapshot
        // (publishing a missing-Shaz manifest would silently undercount every
        // other editor for the manifest's lifetime).
        if (hasCategoryFailures) {
            metadataResults._failedCategories = failedCategoryNames;
            _log('fetchAllMetadata: ' + failedCategoryNames.length + ' categories FAILED to list: [' + failedCategoryNames.join(', ') + ']. Caller MUST merge with stale cache or skip writes.', 'error');
            _dispatchCustom('blitzkrieg-library-partial', {
                failedCategories: failedCategoryNames.slice(),
                withMeta: withMeta,
                total: metadataResults.length
            });
        }

        return metadataResults;
    }

    /**
     * List all templates. Three-tier fast path:
     *   1. localStorage cache (instant, no network)
     *   2. Cloud manifest file (one download, 500ms cold load)
     *   3. Full fetchAllMetadata (worker-pool parallel download, 2-3s cold load)
     *
     * Tiers 1+2 populate tier 3 for the next load, so a new user or a
     * cache-cleared user downloads the manifest and is instantly fast.
     */
    async function listTemplates() {
        var t0 = Date.now();

        // ----- Tier 1: localStorage cache -----
        var cache = getCachedMetadata();

        if (cache && cache.folders && cache.folders.length > 0) {
            // FAST PATH: Use cached metadata, only sign fresh URLs (1 API call)
            var ageMs = Date.now() - (cache.ts || 0);
            var partialUntilFresh = cache.partialUntilTs && Date.now() < cache.partialUntilTs;
            _log('listTemplates: FAST PATH — using cached metadata (' + cache.folders.length + ' entries, age: ' + Math.round(ageMs / 1000) + 's' + (partialUntilFresh ? ', partial-grace ' + Math.round((cache.partialUntilTs - Date.now()) / 1000) + 's' : '') + ')', 'info');
            var comps = await buildCompsFromMetadata(cache.folders);
            _log('listTemplates: FAST PATH complete — ' + comps.length + ' comps in ' + (Date.now() - t0) + 'ms', 'success');
            _lastLoad = { ts: Date.now(), source: 'cache', durationMs: Date.now() - t0, count: comps.length, partial: !!partialUntilFresh, failedCategories: (cache.failedCategories || []).slice() };

            // TTL-gated background refresh — the previous version refreshed every
            // single fast-path call (i.e. on every focus event after cooldown), which
            // burned ~248 metadata downloads on every alt-tab back into AE. Skip the
            // refresh entirely when the cache is younger than 60 seconds. Lowered
            // from 10 minutes so users see new templates from other admins quickly
            // without having to reload the panel.
            var BACKGROUND_REFRESH_TTL = 60 * 1000;
            var staleFolders = cache.folders;

            // If the local cache contains null-metadata entries (poisoned by a
            // prior transient failure), force a refresh regardless of TTL —
            // those entries are invisible to the user and we want to retry
            // them ASAP rather than waiting up to 60s.
            var hasNulls = false;
            for (var nci = 0; nci < cache.folders.length; nci++) {
                if (!cache.folders[nci] || cache.folders[nci].metadata == null) { hasNulls = true; break; }
            }
            if (hasNulls) {
                _log('listTemplates: cache has null-metadata entries — forcing immediate refresh', 'warn');
            }

            // Skip background refresh while the partial-grace window is still
            // in effect — a category-list timeout already happened recently
            // and we don't want to repeat the slow path every 60s while the
            // upstream is down. Grace expires after 60s by default.
            if ((ageMs >= BACKGROUND_REFRESH_TTL || hasNulls) && !partialUntilFresh) {
                // Prefer the cloud manifest for the refresh too — it's still 1 req
                // vs hundreds. Fall through to fetchAllMetadata if manifest is missing.
                fetchManifest().then(function (manifest) {
                    if (manifest && manifest.folders && !manifest._stale && !hasNulls) {
                        setCachedMetadata(manifest.folders);
                        if (manifest.archives) listTemplates._archives = manifest.archives;
                        _log('listTemplates: background manifest refresh done (' + manifest.folders.length + ' entries)', 'info');
                        _maybeNotifyChange(staleFolders, manifest.folders);
                        return null;
                    }
                    // Either no manifest, manifest is stale, or our local cache
                    // had nulls — re-fetch metadata directly to get the latest.
                    return fetchAllMetadata().then(function (freshMeta) {
                        if (freshMeta && freshMeta._failedCategories && freshMeta._failedCategories.length > 0) {
                            // PARTIAL fetch: merge fresh non-failed with stale failed
                            // entries, write back with a 60s partial-grace marker so
                            // the next reload doesn't slow-path again immediately.
                            var merged = _mergePartialFolders(staleFolders, freshMeta, freshMeta._failedCategories);
                            setCachedMetadata(merged, {
                                partialUntilTs: Date.now() + 60 * 1000,
                                failedCategories: freshMeta._failedCategories.slice()
                            });
                            _log('listTemplates: background refresh PARTIAL — merged ' + merged.length + ' entries (failed cats: [' + freshMeta._failedCategories.join(', ') + ']). Manifest left untouched.', 'warn');
                            _maybeNotifyChange(staleFolders, merged);
                            return;
                        }
                        setCachedMetadata(freshMeta);
                        uploadManifest(freshMeta, listTemplates._archives || []);
                        _log('listTemplates: background full refresh done (' + freshMeta.length + ' entries)', 'info');
                        _maybeNotifyChange(staleFolders, freshMeta);
                    });
                }).catch(function (err) {
                    _log('listTemplates: background refresh failed: ' + (err && err.message || err), 'warn');
                });
            } else {
                _log('listTemplates: skipped background refresh (' + (partialUntilFresh ? 'in partial-grace window' : 'cache age ' + Math.round(ageMs / 1000) + 's < TTL') + ')', 'info');
            }

            // Also set archives from cache (may be slightly stale — fine for UI)
            if (!listTemplates._archives) listTemplates._archives = [];

            return comps;
        }

        // ----- Tier 2: Cloud manifest file (stale-while-revalidate) -----
        // Try to download a single manifest.json instead of 248+ individual
        // metadata.json files. Brings cold-load time from ~5s to <500ms even
        // when manifest is hours stale (we serve it immediately and refresh
        // in the background).
        var manifest = await fetchManifest();
        if (manifest && manifest.folders && manifest.folders.length > 0) {
            var label = manifest._stale ? 'MANIFEST PATH (stale-while-revalidate)' : 'MANIFEST PATH';
            _log('listTemplates: ' + label + ' — ' + manifest.folders.length + ' entries in ' + (Date.now() - t0) + 'ms', 'success');
            setCachedMetadata(manifest.folders);
            if (manifest.archives) listTemplates._archives = manifest.archives;
            var mComps = await buildCompsFromMetadata(manifest.folders);
            _log('listTemplates: ' + label + ' complete — ' + mComps.length + ' comps in ' + (Date.now() - t0) + 'ms', 'success');
            _lastLoad = { ts: Date.now(), source: manifest._stale ? 'manifest-stale' : 'manifest', durationMs: Date.now() - t0, count: mComps.length, partial: false, failedCategories: [] };

            // If manifest was stale, kick off a background refresh so the
            // NEXT load (and other editors fetching this manifest) get fresh
            // data. Refuse to overwrite on partial fetch.
            if (manifest._stale) {
                fetchAllMetadata().then(function (freshMeta) {
                    if (freshMeta && freshMeta._failedCategories && freshMeta._failedCategories.length > 0) {
                        _log('listTemplates: stale-manifest background refresh PARTIAL — leaving manifest untouched. Failed: [' + freshMeta._failedCategories.join(', ') + ']', 'warn');
                        return;
                    }
                    setCachedMetadata(freshMeta);
                    uploadManifest(freshMeta, listTemplates._archives || []);
                    _log('listTemplates: stale-manifest background refresh done (' + freshMeta.length + ' entries)', 'info');
                    _maybeNotifyChange(manifest.folders, freshMeta);
                }).catch(function (err) {
                    _log('listTemplates: stale-manifest background refresh failed: ' + (err && err.message || err), 'warn');
                });
            }

            return mComps;
        }

        // ----- Tier 3: Full fetchAllMetadata (slow path, worker-pool parallel) -----
        _log('listTemplates: SLOW PATH — no cache, no manifest, full fetch...', 'info');
        var metadataResults = await fetchAllMetadata();

        if (metadataResults && metadataResults._failedCategories && metadataResults._failedCategories.length > 0) {
            // Slow-path partial: there's no stale to merge with (we got here
            // because no cache existed). Write the partial result with a 60s
            // grace marker — the user no longer pays the slow-path cost on
            // every reload while Shaz is timing out. Manifest left untouched
            // to avoid poisoning other editors.
            var cleanResults = (metadataResults || []).filter(function(r) {
                return r && r.metadata !== null && r.metadata !== undefined;
            });
            setCachedMetadata(cleanResults, {
                partialUntilTs: Date.now() + 60 * 1000,
                failedCategories: metadataResults._failedCategories.slice()
            });
            _log('listTemplates: SLOW PATH partial — wrote ' + cleanResults.length + ' entries with 60s grace. Manifest left untouched. Failed: [' + metadataResults._failedCategories.join(', ') + ']', 'warn');
        } else {
            setCachedMetadata(metadataResults);
            uploadManifest(metadataResults, listTemplates._archives || []);
        }

        // Sign URLs and build comps
        var comps2 = await buildCompsFromMetadata(metadataResults);
        _log('listTemplates: SLOW PATH complete — ' + comps2.length + ' comps in ' + (Date.now() - t0) + 'ms', comps2.length > 0 ? 'success' : 'warn');
        var slowFailed = (metadataResults && metadataResults._failedCategories) ? metadataResults._failedCategories.slice() : [];
        _lastLoad = { ts: Date.now(), source: 'slow-path', durationMs: Date.now() - t0, count: comps2.length, partial: slowFailed.length > 0, failedCategories: slowFailed };
        return comps2;
    }

    /**
     * Snapshot of internal state for diagnostics. Pure read — no network.
     */
    function getDiagnostics() {
        var cache = getCachedMetadata();
        var sigCache = _signedUrlCache;
        var manifestCacheState = (typeof _manifestCache !== 'undefined' && _manifestCache) ? {
            ts: _manifestCache.ts || 0,
            ageMs: _manifestCache.ts ? Date.now() - _manifestCache.ts : null,
            folderCount: (_manifestCache.folders && _manifestCache.folders.length) || 0
        } : null;
        return {
            version: (typeof window !== 'undefined' && window.BLITZKRIEG_LOCAL_VERSION) || null,
            now: Date.now(),
            lastLoad: {
                ts: _lastLoad.ts,
                ageMs: _lastLoad.ts ? Date.now() - _lastLoad.ts : null,
                source: _lastLoad.source,
                durationMs: _lastLoad.durationMs,
                count: _lastLoad.count,
                partial: _lastLoad.partial,
                failedCategories: _lastLoad.failedCategories
            },
            metaCache: cache ? {
                folderCount: (cache.folders && cache.folders.length) || 0,
                ts: cache.ts || 0,
                ageMs: cache.ts ? Date.now() - cache.ts : null,
                partialUntilTs: cache.partialUntilTs || null,
                partialGraceRemainingMs: cache.partialUntilTs ? (cache.partialUntilTs - Date.now()) : null,
                failedCategories: (cache.failedCategories || []).slice(),
                nullMetadataCount: (cache.folders || []).filter(function(f) { return !f || f.metadata == null; }).length
            } : null,
            manifestMemCache: manifestCacheState,
            signedUrlCache: sigCache ? {
                ageMs: Date.now() - _signedUrlCacheTime,
                ttlMs: SIGNED_URL_CACHE_TTL,
                pathCount: Object.keys(sigCache).length
            } : null,
            archives: (listTemplates._archives || []).length,
            constants: {
                LIST_TIMEOUT_MS: LIST_TIMEOUT_MS,
                LIST_TIMEOUT_BY_ATTEMPT: LIST_TIMEOUT_BY_ATTEMPT.slice(),
                MANIFEST_TTL_MS: MANIFEST_TTL_MS,
                SIGNED_URL_EXPIRY: SIGNED_URL_EXPIRY,
                SIGNED_URL_CACHE_TTL: SIGNED_URL_CACHE_TTL
            }
        };
    }

    // Download a template's .aep file to a temp location for import
    async function downloadTemplate(storagePath) {
        // Fast path: try template.aep directly (standard upload name)
        var fastPath = storagePath + '/template.aep';
        var fastResult = await sb.storage.from(BUCKET).download(fastPath);
        if (!fastResult.error && fastResult.data) {
            return { blob: fastResult.data, fileName: 'template.aep' };
        }

        // Fallback: list files and find any .aep
        var filesResult = await sb.storage.from(BUCKET).list(storagePath, { limit: 100 });
        if (filesResult.error) {
            throw new Error('Failed to list template files: ' + filesResult.error.message);
        }

        // Plain loop instead of Array.prototype.find — ES6, not on CEP 8/9.
        var aepFile = null;
        var _files = filesResult.data || [];
        for (var _fi = 0; _fi < _files.length; _fi++) {
            var _f = _files[_fi];
            if (!_f || !_f.name) continue;
            var _ln = _f.name.toLowerCase();
            if (_ln.length >= 4 && _ln.indexOf('.aep', _ln.length - 4) !== -1) {
                aepFile = _f;
                break;
            }
        }

        if (!aepFile) {
            throw new Error('No .aep file found in template folder');
        }

        var aepPath = storagePath + '/' + aepFile.name;
        var downloadResult = await sb.storage.from(BUCKET).download(aepPath);

        if (downloadResult.error) {
            throw new Error('Failed to download template: ' + downloadResult.error.message);
        }

        return {
            blob: downloadResult.data,
            fileName: aepFile.name,
        };
    }

    // Upload a template bundle (aep + thumbnail + preview frames + metadata) to the bucket
    async function uploadTemplate(categoryName, compFolderName, files) {
        var basePath = categoryName + '/' + compFolderName;
        var uploads = [];

        if (files.aep) {
            uploads.push(
                sb.storage.from(BUCKET)
                    .upload(basePath + '/template.aep', files.aep, {
                        contentType: 'application/octet-stream',
                        upsert: true,
                    })
                    .then(function (res) {
                        if (res.error) throw new Error('Failed to upload .aep: ' + res.error.message);
                    })
            );
        }

        if (files.thumbnail) {
            // Upload as comp.png (consistent with stash naming) for thumbnails
            uploads.push(
                sb.storage.from(BUCKET)
                    .upload(basePath + '/comp.png', files.thumbnail, {
                        contentType: 'image/png',
                        upsert: true,
                    })
                    .then(function (res) {
                        if (res.error) throw new Error('Failed to upload thumbnail: ' + res.error.message);
                    })
            );
        }

        // Upload preview frames if provided
        if (files.previewFrames && files.previewFrames.length > 0) {
            files.previewFrames.forEach(function(frameBlob, idx) {
                uploads.push(
                    sb.storage.from(BUCKET)
                        .upload(basePath + '/preview/frame_' + idx + '.png', frameBlob, {
                            contentType: 'image/png',
                            upsert: true,
                        })
                        .then(function (res) {
                            if (res.error) throw new Error('Failed to upload preview frame ' + idx + ': ' + res.error.message);
                        })
                );
            });
        }

        if (files.metadata) {
            var metaBlob = new Blob([JSON.stringify(files.metadata)], { type: 'application/json' });
            uploads.push(
                sb.storage.from(BUCKET)
                    .upload(basePath + '/metadata.json', metaBlob, {
                        contentType: 'application/json',
                        upsert: true,
                    })
                    .then(function (res) {
                        if (res.error) throw new Error('Failed to upload metadata: ' + res.error.message);
                    })
            );
        }

        await Promise.all(uploads);
        invalidateCache();
        return basePath;
    }

    /**
     * Recursively collect ALL file paths under a storage folder (handles nested subfolders like preview/).
     * Subfolders are recursed in PARALLEL (Promise.all) instead of sequential await,
     * which is the dominant cost when processing categories with many comp folders.
     */
    async function collectAllFiles(folderPath) {
        var result = await sb.storage.from(BUCKET).list(folderPath, { limit: 1000 });
        if (result.error) return [];
        var items = result.data || [];
        var filePaths = [];
        var subfolderPromises = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].id === null) {
                // Subfolder — kick off parallel recursion
                subfolderPromises.push(collectAllFiles(folderPath + '/' + items[i].name));
            } else {
                filePaths.push(folderPath + '/' + items[i].name);
            }
        }
        if (subfolderPromises.length > 0) {
            var nested = await Promise.all(subfolderPromises);
            for (var ni = 0; ni < nested.length; ni++) {
                filePaths = filePaths.concat(nested[ni]);
            }
        }
        return filePaths;
    }

    // Delete a template from the bucket (admin-only, RLS enforced)
    // Now recursively deletes all files including nested preview/ subfolders
    async function deleteTemplate(storagePath) {
        var filePaths = await collectAllFiles(storagePath);

        if (filePaths.length > 0) {
            // Batch delete in chunks of 100
            for (var b = 0; b < filePaths.length; b += 100) {
                var batch = filePaths.slice(b, b + 100);
                var removeResult = await sb.storage.from(BUCKET).remove(batch);
                if (removeResult.error) {
                    throw new Error('Failed to delete template: ' + removeResult.error.message);
                }
            }
        }
        invalidateCacheForPath(storagePath);
    }

    // Rename a template (re-upload metadata with new displayName)
    async function renameTemplate(storagePath, newName) {
        var metadataPath = storagePath + '/metadata.json';
        var metaDownload = await sb.storage.from(BUCKET).download(metadataPath);
        if (metaDownload.error) {
            throw new Error('Failed to read metadata: ' + metaDownload.error.message);
        }

        var metaText = await metaDownload.data.text();
        var metadata;
        try {
            metadata = JSON.parse(metaText);
        } catch (parseErr) {
            // Corrupt metadata.json — start fresh rather than failing the rename outright
            _log('renameTemplate: metadata parse failed for ' + metadataPath + ', recreating: ' + parseErr.message, 'warn');
            metadata = {};
        }
        metadata.displayName = newName;

        var metaBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
        var uploadResult = await sb.storage.from(BUCKET)
            .upload(metadataPath, metaBlob, {
                contentType: 'application/json',
                upsert: true,
            });
        if (uploadResult.error) {
            throw new Error('Failed to update metadata: ' + uploadResult.error.message);
        }
        invalidateCacheForPath(storagePath);
    }

    // Rename a category (handles nested subfolders like preview/).
    // Parallelized with a concurrency limit — the previous serial loop took
    // ~30 minutes for a category with 248 comps (~18,000 file moves × ~100ms).
    // A concurrency of 10 brings it down to ~3 minutes without overwhelming the
    // Supabase storage API.
    async function renameCategory(oldCategoryName, newCategoryName) {
        var allFiles = await collectAllFiles(oldCategoryName);
        var CONCURRENCY = 10;
        var idx = 0;
        var failures = [];

        async function worker() {
            while (idx < allFiles.length) {
                var myIdx = idx++;
                var oldPath = allFiles[myIdx];
                var newPath = newCategoryName + oldPath.substring(oldCategoryName.length);
                try {
                    var moveResult = await sb.storage.from(BUCKET).move(oldPath, newPath);
                    if (moveResult.error) failures.push({ path: oldPath, error: moveResult.error.message });
                } catch (mvErr) {
                    failures.push({ path: oldPath, error: (mvErr && mvErr.message) || String(mvErr) });
                }
            }
        }

        var workers = [];
        for (var w = 0; w < CONCURRENCY; w++) workers.push(worker());
        await Promise.all(workers);

        if (failures.length > 0) {
            _log('renameCategory: ' + failures.length + '/' + allFiles.length + ' moves failed — first: ' + failures[0].path + ': ' + failures[0].error, 'warn');
            throw new Error('Failed to move ' + failures[0].path + ': ' + failures[0].error);
        }
        invalidateCache();
    }

    // Delete an entire category (now recursively handles nested subfolders)
    async function deleteCategory(categoryName) {
        var allFiles = await collectAllFiles(categoryName);

        if (allFiles.length > 0) {
            // Batch delete in chunks of 100
            for (var b = 0; b < allFiles.length; b += 100) {
                var batch = allFiles.slice(b, b + 100);
                var removeResult = await sb.storage.from(BUCKET).remove(batch);
                if (removeResult.error) {
                    throw new Error('Failed to delete files: ' + removeResult.error.message);
                }
            }
        }
        invalidateCache();
    }

    // Move ALL templates from one category to another (for transfer-before-delete flow).
    // Parallelized with concurrency 10 like renameCategory.
    async function moveAllTemplates(fromCategory, toCategory) {
        var allFiles = await collectAllFiles(fromCategory);
        var CONCURRENCY = 10;
        var idx = 0;
        var failures = [];

        async function worker() {
            while (idx < allFiles.length) {
                var myIdx = idx++;
                var oldPath = allFiles[myIdx];
                var newPath = toCategory + oldPath.substring(fromCategory.length);
                try {
                    var moveResult = await sb.storage.from(BUCKET).move(oldPath, newPath);
                    if (moveResult.error) failures.push({ path: oldPath, error: moveResult.error.message });
                } catch (mvErr) {
                    failures.push({ path: oldPath, error: (mvErr && mvErr.message) || String(mvErr) });
                }
            }
        }

        var workers = [];
        for (var w = 0; w < CONCURRENCY; w++) workers.push(worker());
        await Promise.all(workers);

        if (failures.length > 0) {
            _log('moveAllTemplates: ' + failures.length + '/' + allFiles.length + ' moves failed — first: ' + failures[0].path + ': ' + failures[0].error, 'warn');
            throw new Error('Failed to move ' + failures[0].path + ': ' + failures[0].error);
        }
        invalidateCache();
    }

    // Worker-pool runner for bulk template ops. Caps in-flight Supabase
    // requests at CONCURRENCY=10. The previous version did
    // `Promise.allSettled(N)` which exploded into 100+ simultaneous calls,
    // each of which did its own recursive `collectAllFiles` listing —
    // 1000+ concurrent storage requests for a 100-template bulk delete.
    // Triggers rate limits and timeout cascades.
    async function _bulkRun(items, perItemFn, opName) {
        var CONCURRENCY = 10;
        var idx = 0;
        var failures = [];

        async function worker() {
            while (idx < items.length) {
                var myIdx = idx++;
                try {
                    await perItemFn(items[myIdx]);
                } catch (err) {
                    failures.push({ item: items[myIdx], error: (err && err.message) || String(err) });
                }
            }
        }

        var workers = [];
        for (var w = 0; w < CONCURRENCY; w++) workers.push(worker());
        await Promise.all(workers);

        if (failures.length > 0) {
            var msg = failures.length + '/' + items.length + ' template(s) failed to ' + opName;
            _log(opName + 'Templates: ' + msg + ' — first failure: ' + failures[0].item + ': ' + failures[0].error, 'warn');
            throw new Error(msg);
        }
    }

    async function deleteTemplates(storagePaths) {
        await _bulkRun(storagePaths, function (p) { return deleteTemplate(p); }, 'delete');
    }

    async function moveTemplates(storagePaths, toCategory) {
        await _bulkRun(storagePaths, function (p) { return moveTemplate(p, toCategory); }, 'move');
    }

    // Move a single template from one category to another (handles nested subfolders)
    async function moveTemplate(oldStoragePath, newCategoryName) {
        var folderName = oldStoragePath.split('/').pop();
        var newBasePath = newCategoryName + '/' + folderName;

        var allFiles = await collectAllFiles(oldStoragePath);
        for (var i = 0; i < allFiles.length; i++) {
            var oldPath = allFiles[i];
            var newPath = newBasePath + oldPath.substring(oldStoragePath.length);
            var moveResult = await sb.storage.from(BUCKET).move(oldPath, newPath);
            if (moveResult.error) {
                throw new Error('Failed to move ' + oldPath + ': ' + moveResult.error.message);
            }
        }
        // Both old and new paths changed — invalidate both keys.
        invalidateCacheForPath(oldStoragePath);
        invalidateCacheForPath(newBasePath);

        return newBasePath;
    }

    function getArchives() {
        return listTemplates._archives || [];
    }

    async function getArchiveDownloadUrl(fileName) {
        var result = await sb.storage.from(BUCKET).createSignedUrl(fileName, 3600);
        if (result.error) {
            throw new Error('Failed to create download link: ' + result.error.message);
        }
        return result.data.signedUrl || result.data.signedURL;
    }

    /**
     * Sign arbitrary storage paths and return a map of path → signedUrl.
     * Used by submissions UI to get thumbnails for pending items.
     */
    async function signPaths(paths) {
        if (!paths || paths.length === 0) return {};
        var result = {};
        var BATCH = 100;
        for (var b = 0; b < paths.length; b += BATCH) {
            var batch = paths.slice(b, b + BATCH);
            var signResult = await sb.storage.from(BUCKET).createSignedUrls(batch, SIGNED_URL_EXPIRY);
            if (signResult.data) {
                signResult.data.forEach(function(item) {
                    if (!item.error && item.signedUrl) {
                        result[item.path] = item.signedUrl;
                    }
                });
            }
        }
        return result;
    }

    // Hard reload — wipes LOCAL caches and bypasses the cloud manifest by
    // calling fetchAllMetadata directly. The cloud manifest is intentionally
    // left in place: uploadManifest uses upsert, so a clean fetch atomically
    // replaces it. Deleting the shared manifest before knowing whether the
    // slow path will succeed would self-DoS during a chronic Supabase
    // outage — every editor whose local cache TTL expires would fall to
    // slow path with no fallback, and if their slow paths also partial,
    // the manifest stays gone forever.
    async function forceReload() {
        _log('forceReload: capturing stale, clearing caches, slow-path fetch (bypass manifest)', 'info');
        // Capture the stale folders BEFORE wiping localStorage so a partial
        // fetch can merge against them (otherwise forceReload during a
        // chronic Supabase outage drops failed-category templates entirely).
        var preExisting = getCachedMetadata();
        var stale = preExisting && preExisting.folders ? preExisting.folders : [];
        _signedUrlCache = null;
        _signedUrlCacheTime = 0;
        try { localStorage.removeItem(META_CACHE_KEY); } catch (e) {}

        var fresh = await fetchAllMetadata();
        if (!listTemplates._archives) listTemplates._archives = [];
        if (!fresh._failedCategories || fresh._failedCategories.length === 0) {
            setCachedMetadata(fresh);
            uploadManifest(fresh, listTemplates._archives);
            return await buildCompsFromMetadata(fresh);
        }
        // Partial: merge fresh non-failed with stale failed entries, write
        // back with 60s grace marker so the user can keep working.
        var merged = _mergePartialFolders(stale, fresh, fresh._failedCategories);
        setCachedMetadata(merged, {
            partialUntilTs: Date.now() + 60 * 1000,
            failedCategories: fresh._failedCategories.slice()
        });
        _log('forceReload: PARTIAL — merged ' + merged.length + ' entries (failed: [' + fresh._failedCategories.join(', ') + ']). Manifest left untouched.', 'warn');
        return await buildCompsFromMetadata(merged);
    }

    // Expose globally
    window.cloudLibrary = {
        listTemplates: listTemplates,
        downloadTemplate: downloadTemplate,
        uploadTemplate: uploadTemplate,
        deleteTemplate: deleteTemplate,
        deleteTemplates: deleteTemplates,
        renameTemplate: renameTemplate,
        renameCategory: renameCategory,
        deleteCategory: deleteCategory,
        moveTemplate: moveTemplate,
        moveTemplates: moveTemplates,
        moveAllTemplates: moveAllTemplates,
        getArchives: getArchives,
        getArchiveDownloadUrl: getArchiveDownloadUrl,
        invalidateCache: invalidateCache,
        invalidateCacheForPath: invalidateCacheForPath,
        forceReload: forceReload,
        signPreviewFrames: signPreviewFrames,
        signPaths: signPaths,
        getDiagnostics: getDiagnostics,
    };
})();
