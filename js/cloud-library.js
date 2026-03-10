// js/cloud-library.js
// Cloud-based template library using Supabase Storage
(function () {
    'use strict';

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
    }

    // In-memory signed URL cache — avoids re-signing on every loadLibrary call
    var _signedUrlCache = null;
    var _signedUrlCacheTime = 0;
    var SIGNED_URL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

    // localStorage cache for template metadata (persists across restarts)
    var META_CACHE_KEY = 'blitzkrieg_meta_cache';

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
    function setCachedMetadata(metadataResults) {
        try {
            localStorage.setItem(META_CACHE_KEY, JSON.stringify({
                ts: Date.now(),
                folders: metadataResults,
            }));
        } catch (e) {
            // localStorage full — ignore
        }
    }

    /**
     * Invalidate the metadata cache
     */
    function invalidateCache() {
        try { localStorage.removeItem(META_CACHE_KEY); } catch (e) {}
        _signedUrlCache = null;
        _signedUrlCacheTime = 0;
    }

    /**
     * Sign thumbnail URLs and build comp objects from metadata results.
     * Only signs thumbnail URLs initially (fast). Preview frames are signed lazily on hover.
     */
    async function buildCompsFromMetadata(metadataResults) {
        // Sign ONLY thumbnail URLs (2 per template: comp.png + thumbnail.png)
        // Preview frame URLs are signed lazily on hover via signPreviewFrames()

        var validEntries = metadataResults.filter(function(mr) { return mr.metadata !== null; });
        _log('buildCompsFromMetadata: ' + validEntries.length + ' entries with metadata (of ' + metadataResults.length + ' total)', 'info');

        var signedUrlMap;
        var now = Date.now();

        // Use cached signed URLs if still fresh (avoids re-signing on every focus)
        if (_signedUrlCache && (now - _signedUrlCacheTime < SIGNED_URL_CACHE_TTL)) {
            signedUrlMap = _signedUrlCache;
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
            if (typeof mr.metadata.previewFrames === 'number') previewFrameCount = mr.metadata.previewFrames;
            if (mr.metadata.cloudPreviewFrameCount) previewFrameCount = Math.max(previewFrameCount, mr.metadata.cloudPreviewFrameCount);

            allComps.push({
                name: mr.metadata.displayName || mr.folderName,
                category: mr.categoryName,
                uniqueId: uniqueId,
                folderName: mr.folderName,
                thumbUrl: thumbUrl,
                thumbUrlAlt: thumbUrlAlt,
                duration: mr.metadata.duration || 0,
                width: mr.metadata.width || 0,
                height: mr.metadata.height || 0,
                frameRate: mr.metadata.frameRate || 0,
                previewFrames: null,  // Signed lazily on hover
                previewFrameCount: previewFrameCount,
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
            return item.id === null && item.name !== 'pending' && item.name !== '.emptyFolderPlaceholder';
        });
        _log('fetchAllMetadata: ' + categories.length + ' categories found: [' + categories.map(function(c) { return c.name; }).join(', ') + ']', 'info');

        // Detect RAR/ZIP archives at root level
        var archives = allRootItems.filter(function (item) {
            if (item.id === null) return false;
            var n = (item.name || '').toLowerCase();
            return n.endsWith('.rar') || n.endsWith('.zip') || n.endsWith('.7z');
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

        // Step 3: Download all metadata.json files in parallel (batched to avoid overwhelming)
        var METADATA_BATCH = 50;
        var metadataResults = [];
        for (var mb = 0; mb < allFolderEntries.length; mb += METADATA_BATCH) {
            var batch = allFolderEntries.slice(mb, mb + METADATA_BATCH);
            var batchResults = await Promise.all(
                batch.map(function (entry) {
                    var metaPath = entry.categoryName + '/' + entry.folderName + '/metadata.json';
                    return sb.storage.from(BUCKET).download(metaPath).then(function (res) {
                        if (res.error) return { categoryName: entry.categoryName, folderName: entry.folderName, metadata: null };
                        return res.data.text().then(function (text) {
                            return { categoryName: entry.categoryName, folderName: entry.folderName, metadata: JSON.parse(text) };
                        });
                    }).catch(function () {
                        return { categoryName: entry.categoryName, folderName: entry.folderName, metadata: null };
                    });
                })
            );
            metadataResults = metadataResults.concat(batchResults);
        }

        var withMeta = metadataResults.filter(function(r) { return r.metadata !== null; }).length;
        _log('fetchAllMetadata: done — ' + withMeta + '/' + metadataResults.length + ' have metadata (took ' + (Date.now() - t0) + 'ms)', withMeta > 0 ? 'success' : 'warn');

        return metadataResults;
    }

    /**
     * List all templates. Uses localStorage cache for instant loads.
     * First load: full fetch (slow). Subsequent loads: cached metadata + fresh signed URLs (fast).
     */
    async function listTemplates() {
        var t0 = Date.now();

        // Check localStorage cache first
        var cache = getCachedMetadata();

        if (cache && cache.folders && cache.folders.length > 0) {
            // FAST PATH: Use cached metadata, only sign fresh URLs (1 API call)
            _log('listTemplates: FAST PATH — using cached metadata (' + cache.folders.length + ' entries, age: ' + Math.round((Date.now() - cache.ts) / 1000) + 's)', 'info');
            var comps = await buildCompsFromMetadata(cache.folders);
            _log('listTemplates: FAST PATH complete — ' + comps.length + ' comps in ' + (Date.now() - t0) + 'ms', 'success');

            // Background refresh metadata (pick up new/deleted/renamed templates)
            fetchAllMetadata().then(function (freshMeta) {
                setCachedMetadata(freshMeta);
                _log('listTemplates: background refresh done (' + freshMeta.length + ' entries)', 'info');
            }).catch(function (err) {
                _log('listTemplates: background refresh failed: ' + err.message, 'warn');
            });

            // Also set archives from cache (may be slightly stale — fine for UI)
            if (!listTemplates._archives) listTemplates._archives = [];

            return comps;
        }

        // SLOW PATH: Full fetch (first time or cache cleared)
        _log('listTemplates: SLOW PATH — no cache, full fetch...', 'info');
        var metadataResults = await fetchAllMetadata();

        // Save to localStorage for next time
        setCachedMetadata(metadataResults);

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

        var aepFile = (filesResult.data || []).find(function (f) {
            return f.name && f.name.toLowerCase().endsWith('.aep');
        });

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
     */
    async function collectAllFiles(folderPath) {
        var result = await sb.storage.from(BUCKET).list(folderPath, { limit: 1000 });
        if (result.error) return [];
        var items = result.data || [];
        var filePaths = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].id === null) {
                // It's a subfolder — recurse into it
                var subFiles = await collectAllFiles(folderPath + '/' + items[i].name);
                filePaths = filePaths.concat(subFiles);
            } else {
                filePaths.push(folderPath + '/' + items[i].name);
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
        var metadata = JSON.parse(metaText);
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

    // Rename a category (now handles nested subfolders like preview/)
    async function renameCategory(oldCategoryName, newCategoryName) {
        var allFiles = await collectAllFiles(oldCategoryName);

        for (var i = 0; i < allFiles.length; i++) {
            var oldPath = allFiles[i];
            var newPath = newCategoryName + oldPath.substring(oldCategoryName.length);
            var moveResult = await sb.storage.from(BUCKET).move(oldPath, newPath);
            if (moveResult.error) {
                throw new Error('Failed to move ' + oldPath + ': ' + moveResult.error.message);
            }
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

    // Move ALL templates from one category to another (for transfer-before-delete flow)
    async function moveAllTemplates(fromCategory, toCategory) {
        var allFiles = await collectAllFiles(fromCategory);

        for (var i = 0; i < allFiles.length; i++) {
            var oldPath = allFiles[i];
            var newPath = toCategory + oldPath.substring(fromCategory.length);
            var moveResult = await sb.storage.from(BUCKET).move(oldPath, newPath);
            if (moveResult.error) {
                throw new Error('Failed to move ' + oldPath + ': ' + moveResult.error.message);
            }
        }
        invalidateCache();
    }

    // Delete multiple templates at once (for bulk operations)
    async function deleteTemplates(storagePaths) {
        for (var i = 0; i < storagePaths.length; i++) {
            await deleteTemplate(storagePaths[i]);
        }
    }

    // Move multiple templates to a new category (for bulk operations)
    async function moveTemplates(storagePaths, toCategory) {
        for (var i = 0; i < storagePaths.length; i++) {
            await moveTemplate(storagePaths[i], toCategory);
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
        signPreviewFrames: signPreviewFrames,
        signPaths: signPaths,
    };
})();
