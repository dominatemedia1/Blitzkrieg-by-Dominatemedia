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
    var MANIFEST_TTL_MS = 5 * 60 * 1000;

    async function fetchManifest() {
        try {
            var res = await sb.storage.from(BUCKET).download(MANIFEST_KEY);
            if (res.error || !res.data) return null;
            var text = await res.data.text();
            var manifest = JSON.parse(text);
            if (!manifest || !Array.isArray(manifest.folders)) return null;
            var age = Date.now() - (manifest.ts || 0);
            if (age > MANIFEST_TTL_MS) {
                _log('fetchManifest: stale (age ' + Math.round(age / 1000) + 's > TTL)', 'info');
                return null;
            }
            _log('fetchManifest: loaded ' + manifest.folders.length + ' entries (age ' + Math.round(age / 1000) + 's)', 'success');
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
                    _log('uploadManifest: published ' + metadataResults.length + ' entries', 'success');
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
        try {
            window.dispatchEvent(new CustomEvent('blitzkrieg-library-changed', {
                detail: { oldCount: oldCount, newCount: newCount }
            }));
        } catch (e) {
            // CEP 8/9 fallback — CustomEvent constructor missing in old Chromium
            try {
                var ev = document.createEvent('CustomEvent');
                ev.initCustomEvent('blitzkrieg-library-changed', false, false, { oldCount: oldCount, newCount: newCount });
                window.dispatchEvent(ev);
            } catch (e2) {}
        }
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
     * Save metadata to localStorage
     */
    // Track the last-written payload hash so identical repeat writes are skipped.
    // localStorage.setItem on a ~200KB JSON blob blocks the main thread for 5-20ms
    // and used to fire every focus event after the background-refresh landed with
    // unchanged data.
    var _lastMetaWriteLen = -1;
    function setCachedMetadata(metadataResults) {
        var payload;
        try {
            payload = JSON.stringify({
                ts: Date.now(),
                folders: metadataResults,
            });
        } catch (sErr) {
            _log('setCachedMetadata: stringify failed: ' + (sErr && sErr.message || sErr), 'warn');
            return;
        }
        // Cheap heuristic: skip the write if the length exactly matches the
        // previous payload (almost always implies identical content for our
        // use case where metadata.json rarely changes between loads).
        if (payload.length === _lastMetaWriteLen) {
            try {
                var existing = localStorage.getItem(META_CACHE_KEY);
                if (existing && existing.length === payload.length) {
                    return; // very likely identical; skip the expensive write
                }
            } catch (gErr) {}
        }
        try {
            localStorage.setItem(META_CACHE_KEY, payload);
            // Only update the cached length AFTER a successful write — otherwise
            // a quota-exceeded failure would mark the cache as "in sync" with a
            // payload that was never persisted.
            _lastMetaWriteLen = payload.length;
        } catch (e) {
            _log('setCachedMetadata: localStorage write failed: ' + (e && e.message || e), 'warn');
        }
    }

    /**
     * Invalidate the metadata cache (local AND cloud manifest).
     * Called after every mutation so the next listTemplates() sees fresh data.
     */
    function invalidateCache() {
        try { localStorage.removeItem(META_CACHE_KEY); } catch (e) {}
        _lastMetaWriteLen = -1;
        _signedUrlCache = null;
        _signedUrlCacheTime = 0;
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
        while (page < maxPages) {
            var res = await sb.storage.from(BUCKET).list(folder, {
                limit: PAGE,
                offset: offset,
                sortBy: opts && opts.sortBy ? opts.sortBy : { column: 'name', order: 'asc' },
            });
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

        // Step 2: List ALL category comp folders in parallel — paginated
        _log('fetchAllMetadata: listing ' + categories.length + ' category folders in parallel...', 'info');
        var categoryResults = await Promise.all(
            categories.map(function (cat) {
                return listAllPaginated(cat.name).then(function (items) {
                    return { category: cat.name, data: items };
                }).catch(function (err) {
                    _log('fetchAllMetadata: listing category "' + cat.name + '" FAILED: ' + err.message, 'error');
                    return { category: cat.name, data: [], error: err };
                });
            })
        );

        var allFolderEntries = [];
        categoryResults.forEach(function (catResult) {
            if (catResult.error || !catResult.data) return;
            var compFolders = catResult.data.filter(function (item) { return item.id === null; });
            _log('fetchAllMetadata: "' + catResult.category + '" → ' + compFolders.length + ' comp folders', 'info');
            compFolders.forEach(function (folder) {
                allFolderEntries.push({ categoryName: catResult.category, folderName: folder.name });
            });
        });

        _log('fetchAllMetadata: ' + allFolderEntries.length + ' total comp folders, downloading metadata...', 'info');

        if (allFolderEntries.length === 0) {
            _log('fetchAllMetadata: no comp folders → returning empty (took ' + (Date.now() - t0) + 'ms)', 'warn');
            return [];
        }

        // Step 3: Download all metadata.json files using a concurrency-limited
        // worker pool. The previous version ran SEQUENTIAL WAVES of 50-parallel
        // requests, so 248 templates = 5 waves = ~5 seconds (every wave waited
        // for its slowest request before starting the next). A worker pool keeps
        // 50 requests in flight continuously, so the total time drops from
        // ~5×slowest to ~total/50 ≈ 1.5-2 seconds for the same 248 templates.
        var CONCURRENCY = 50;
        var metadataResults = new Array(allFolderEntries.length);
        var nextIdx = 0;

        function downloadOne(idx) {
            var entry = allFolderEntries[idx];
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
            while (nextIdx < allFolderEntries.length) {
                var myIdx = nextIdx++;
                await downloadOne(myIdx);
            }
        }

        var workers = [];
        for (var w = 0; w < CONCURRENCY; w++) workers.push(worker());
        await Promise.all(workers);

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
        // analytics how often the library is undercounting.
        if (partial && window.blitzkriegAnalytics && window.blitzkriegAnalytics.trackAccessChange) {
            try {
                window.blitzkriegAnalytics.trackAccessChange(null, 'library_partial_load', null);
            } catch (te) {}
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
            _log('listTemplates: FAST PATH — using cached metadata (' + cache.folders.length + ' entries, age: ' + Math.round(ageMs / 1000) + 's)', 'info');
            var comps = await buildCompsFromMetadata(cache.folders);
            _log('listTemplates: FAST PATH complete — ' + comps.length + ' comps in ' + (Date.now() - t0) + 'ms', 'success');

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

            if (ageMs >= BACKGROUND_REFRESH_TTL || hasNulls) {
                // Prefer the cloud manifest for the refresh too — it's still 1 req
                // vs hundreds. Fall through to fetchAllMetadata if manifest is missing.
                fetchManifest().then(function (manifest) {
                    if (manifest && manifest.folders && !hasNulls) {
                        setCachedMetadata(manifest.folders);
                        if (manifest.archives) listTemplates._archives = manifest.archives;
                        _log('listTemplates: background manifest refresh done (' + manifest.folders.length + ' entries)', 'info');
                        _maybeNotifyChange(staleFolders, manifest.folders);
                        return null;
                    }
                    // Either no manifest, or our local cache had nulls and we want
                    // to re-download metadata directly to fix them.
                    return fetchAllMetadata().then(function (freshMeta) {
                        setCachedMetadata(freshMeta);
                        uploadManifest(freshMeta, listTemplates._archives || []);
                        _log('listTemplates: background full refresh done (' + freshMeta.length + ' entries)', 'info');
                        _maybeNotifyChange(staleFolders, freshMeta);
                    });
                }).catch(function (err) {
                    _log('listTemplates: background refresh failed: ' + (err && err.message || err), 'warn');
                });
            } else {
                _log('listTemplates: skipped background refresh (cache age ' + Math.round(ageMs / 1000) + 's < TTL)', 'info');
            }

            // Also set archives from cache (may be slightly stale — fine for UI)
            if (!listTemplates._archives) listTemplates._archives = [];

            return comps;
        }

        // ----- Tier 2: Cloud manifest file -----
        // Try to download a single manifest.json instead of 248+ individual
        // metadata.json files. Brings cold-load time from ~5s to <500ms.
        var manifest = await fetchManifest();
        if (manifest && manifest.folders && manifest.folders.length > 0) {
            _log('listTemplates: MANIFEST PATH — ' + manifest.folders.length + ' entries in ' + (Date.now() - t0) + 'ms', 'success');
            setCachedMetadata(manifest.folders);
            if (manifest.archives) listTemplates._archives = manifest.archives;
            var mComps = await buildCompsFromMetadata(manifest.folders);
            _log('listTemplates: MANIFEST PATH complete — ' + mComps.length + ' comps in ' + (Date.now() - t0) + 'ms', 'success');
            return mComps;
        }

        // ----- Tier 3: Full fetchAllMetadata (slow path, worker-pool parallel) -----
        _log('listTemplates: SLOW PATH — no cache, no manifest, full fetch...', 'info');
        var metadataResults = await fetchAllMetadata();

        // Save to localStorage for next session
        setCachedMetadata(metadataResults);

        // Publish cloud manifest so the NEXT cold load (this user after cache clear,
        // or any other user) can skip the slow path entirely.
        uploadManifest(metadataResults, listTemplates._archives || []);

        // Sign URLs and build comps
        var comps2 = await buildCompsFromMetadata(metadataResults);
        _log('listTemplates: SLOW PATH complete — ' + comps2.length + ' comps in ' + (Date.now() - t0) + 'ms', comps2.length > 0 ? 'success' : 'warn');
        return comps2;
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
        invalidateCache();
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
        invalidateCache();
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

    // Delete multiple templates at once (for bulk operations).
    // Run deletions in PARALLEL with Promise.allSettled so a mid-batch failure
    // doesn't leave the user with a confusing partial state — we report which
    // succeeded and which failed instead of aborting on the first error.
    async function deleteTemplates(storagePaths) {
        var results = await Promise.allSettled(storagePaths.map(function(p) { return deleteTemplate(p); }));
        var failures = [];
        for (var i = 0; i < results.length; i++) {
            if (results[i].status === 'rejected') {
                failures.push({ path: storagePaths[i], error: (results[i].reason && results[i].reason.message) || String(results[i].reason) });
            }
        }
        if (failures.length > 0) {
            var msg = failures.length + '/' + storagePaths.length + ' template(s) failed to delete';
            _log('deleteTemplates: ' + msg + ' — first failure: ' + failures[0].path + ': ' + failures[0].error, 'warn');
            throw new Error(msg);
        }
    }

    // Move multiple templates to a new category (for bulk operations).
    // Parallel + Promise.allSettled so partial failures are reported instead of
    // aborting on the first failure (which would leave the user with a half-moved
    // batch and no clear recovery path).
    async function moveTemplates(storagePaths, toCategory) {
        var results = await Promise.allSettled(storagePaths.map(function(p) { return moveTemplate(p, toCategory); }));
        var failures = [];
        for (var i = 0; i < results.length; i++) {
            if (results[i].status === 'rejected') {
                failures.push({ path: storagePaths[i], error: (results[i].reason && results[i].reason.message) || String(results[i].reason) });
            }
        }
        if (failures.length > 0) {
            var msg = failures.length + '/' + storagePaths.length + ' template(s) failed to move';
            _log('moveTemplates: ' + msg + ' — first failure: ' + failures[0].path + ': ' + failures[0].error, 'warn');
            throw new Error(msg);
        }
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
        invalidateCache();

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

    // Hard reload — wipes EVERY cache layer (in-memory signed URL cache,
    // localStorage metadata cache, cloud manifest) and runs a fresh slow path.
    // Used by the "Reload library" admin button when the grid is undercounting
    // and the user wants to force a clean fetch.
    async function forceReload() {
        _log('forceReload: clearing all caches + slow-path fetch', 'info');
        _signedUrlCache = null;
        _signedUrlCacheTime = 0;
        _lastMetaWriteLen = -1;
        try { localStorage.removeItem(META_CACHE_KEY); } catch (e) {}
        // Delete the cloud manifest so this and other editors get a fresh one
        try { await sb.storage.from(BUCKET).remove([MANIFEST_KEY]); } catch (e) {}
        return await listTemplates();
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
        forceReload: forceReload,
        signPreviewFrames: signPreviewFrames,
        signPaths: signPaths,
    };
})();
