// js/local-sync.js — Local Library Mirror
//
// Maintains a local mirror of the cloud template library at
// ~/Blitzkrieg Library/. Imports read from local disk (2-5s)
// instead of downloading from Supabase every time (30-120s).
//
// Exposed as window.localSync. Follows existing IIFE + 'use strict'
// conventions. Uses ExtendScript for all filesystem operations.

(function () {
    'use strict';

    var STATE_KEY = 'blitzkrieg_local_sync';

    // ── internal helpers ──────────────────────────────────────────

    /** Call an ExtendScript function and return a Promise of the parsed JSON result. */
    function _callExtendScript(expr) {
        return new Promise(function (resolve, reject) {
            if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== 'function') {
                reject(new Error('CEP bridge unavailable'));
                return;
            }
            window.__adobe_cep__.evalScript(expr, function (result) {
                if (!result || result === 'EvalScript error.') {
                    reject(new Error(result || 'ExtendScript call failed'));
                    return;
                }
                try {
                    resolve(JSON.parse(result));
                } catch (e) {
                    resolve(result); // non-JSON response — pass through
                }
            });
        });
    }

    /** Get the user-configured library path, or the default. */
    function _getLibraryPath() {
        try {
            var state = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
            if (state && state.libraryPath) return state.libraryPath;
        } catch (e) { /* corrupt */ }
        return ''; // Empty = not configured yet
    }

    /** Load the full sync state from localStorage. */
    function _loadState() {
        try {
            return JSON.parse(localStorage.getItem(STATE_KEY) || 'null') || { templates: {} };
        } catch (e) {
            return { templates: {} };
        }
    }

    /** Save the sync state to localStorage. */
    function _saveState(state) {
        try {
            localStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch (e) { /* quota exceeded */ }
    }

    /** Convert a storage path like "Category/FolderName" to a local filesystem path. */
    function _localPath(storagePath) {
        var lib = _getLibraryPath();
        if (!lib) return '';
        return lib + '/' + storagePath;
    }

    /** Resolve the library root, creating it if needed. Returns Promise<string>. */
    function _ensureLibraryRoot() {
        var libPath = _getLibraryPath();
        if (!libPath) return Promise.reject(new Error('Library path not configured'));
        return _callExtendScript('blitzLocalMkdir("' + libPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")').then(function (r) {
            if (r && r.error) throw new Error(r.error);
            return libPath;
        });
    }

    /** Create the local directory tree for a storage path. */
    function _ensureDirs(libPath, storagePath) {
        var parts = storagePath.split('/');
        var accum = libPath;
        var promises = [];
        for (var i = 0; i < parts.length; i++) {
            accum += '/' + parts[i];
            var safe = accum.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            promises.push(_callExtendScript('blitzLocalMkdir("' + safe + '")'));
        }
        return Promise.all(promises).then(function (results) {
            var firstError = null;
            for (var j = 0; j < results.length; j++) {
                if (results[j] && results[j].error) firstError = firstError || results[j].error;
            }
            if (firstError) throw new Error(firstError);
        });
    }

    /** Write a blob to a local file path. Uses chunked base64 append for
     *  large files (same pattern as writeBlobToFile in main.js) to avoid
     *  hitting evalScript argument size limits. */
    function _writeBlob(filePath, blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('FileReader failed')); };
            reader.onload = function () {
                var b64 = reader.result;
                var comma = b64.indexOf(',');
                if (comma >= 0) b64 = b64.substring(comma + 1);
                if (!b64 || b64.length === 0) { reject(new Error('Empty base64 from blob')); return; }

                var safe = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                var safeTmpB64 = safe + '.b64';
                var sizeMB = (blob.size / 1024 / 1024).toFixed(1);
                var CHUNK = 500000; // 500KB per evalScript call — well under limits

                if (b64.length <= CHUNK) {
                    // Small file — single call, no temp file needed
                    _callExtendScript('blitzLocalWriteBinary("' + safe + '","' + b64 + '")').then(function (r) {
                        if (r && r.error) reject(new Error(r.error));
                        else resolve();
                    }).catch(reject);
                    return;
                }

                // Large file — chunked append to .b64 temp, then decode to binary
                var idx = 0;
                var totalChunks = Math.ceil(b64.length / CHUNK);
                function writeChunk() {
                    if (idx >= b64.length) {
                        _callExtendScript('decodeBase64FileToBinary("' + safeTmpB64 + '","' + safe + '")').then(function (r) {
                            if (typeof r === 'string' && r.indexOf('ERROR') === 0) reject(new Error(r));
                            else resolve();
                        }).catch(reject);
                        return;
                    }
                    var chunk = b64.substring(idx, idx + CHUNK);
                    var isFirst = idx === 0 ? 'true' : 'false';
                    _callExtendScript('appendToTextFile("' + safeTmpB64 + '","' + chunk + '",' + isFirst + ')').then(function (r) {
                        if (r !== 'ok') { reject(new Error('Chunk write failed: ' + r)); return; }
                        idx += CHUNK;
                        writeChunk();
                    }).catch(reject);
                }
                writeChunk();
            };
            reader.readAsDataURL(blob);
        });
    }

    // ── public API ────────────────────────────────────────────────

    var api = {
        /**
         * Configure the local library path. Creates the directory if missing.
         * @param {string} rawPath — Absolute path like "/Users/petter/Blitzkrieg Library"
         */
        setLibraryPath: function (rawPath) {
            if (!rawPath) return Promise.reject(new Error('Path required'));
            var safe = rawPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return _callExtendScript('blitzLocalMkdir("' + safe + '")').then(function (r) {
                if (r && r.error) throw new Error(r.error);
                var state = _loadState();
                state.libraryPath = rawPath;
                _saveState(state);
                return rawPath;
            });
        },

        /**
         * Get the configured library path.
         * @returns {string} — empty if not yet configured
         */
        getLibraryPath: function () {
            return _getLibraryPath();
        },

        /**
         * Detect the user's home directory via ExtendScript.
         * Used for the default library path suggestion.
         * @returns {Promise<string>}
         */
        getDefaultPath: function () {
            return _callExtendScript('blitzGetHomeDir()').then(function (home) {
                var h = (typeof home === 'string') ? home : '~';
                return h + '/Blitzkrieg Library';
            });
        },

        /**
         * Check whether a template is available locally.
         * @param {string} storagePath — "Category/FolderName"
         * @returns {Promise<{exists:boolean, complete:boolean, aepPath:string, fileCount:number}>}
         */
        checkLocal: function (storagePath) {
            var local = _localPath(storagePath);
            if (!local) return Promise.resolve({ exists: false, complete: false, aepPath: '' });

            var state = _loadState();
            var tpl = state.templates && state.templates[storagePath];

            var safe = local.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return _callExtendScript('blitzLocalExists("' + safe + '")').then(function (r) {
                if (!r || !r.exists) return { exists: false, complete: false, aepPath: '' };

                function _mk(aepPath) {
                    return {
                        exists: true,
                        complete: !!(tpl && tpl.complete),
                        aepPath: aepPath || '',
                        fileCount: (tpl && tpl.files) || 0
                    };
                }

                // Find the local .aep. Real templates are NOT named template.aep
                // (the .aep is named after the comp), so when template.aep is absent
                // fall back to scanning the folder for any .aep. Without this scan the
                // import fast path never resolves an aepPath and a fully-synced
                // template is needlessly re-downloaded on every import.
                var templateAep = local + '/template.aep';
                return _callExtendScript('blitzLocalExists("' + templateAep.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")').then(function (aepR) {
                    if (aepR && aepR.exists) return _mk(templateAep);
                    return _callExtendScript('blitzLocalListAep("' + safe + '")').then(function (listR) {
                        var found = (listR && listR.files && listR.files.length) ? (local + '/' + listR.files[0]) : '';
                        return _mk(found);
                    }, function () { return _mk(''); });
                });
            }).catch(function () {
                return { exists: false, complete: false, aepPath: '' };
            });
        },

        /**
         * Verify a local mirror folder has the essential files for import.
         * Checks: at least one .aep exists, metadata.json exists.
         * @param {string} storagePath — "Category/FolderName"
         * @returns {Promise<{complete:boolean, missing:string[], found:string[]}>}
         */
        verifyTemplateIntegrity: function (storagePath) {
            var local = _localPath(storagePath);
            if (!local) return Promise.resolve({ complete: false, missing: ['path not configured'], found: [] });

            var safe = local.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return _callExtendScript('blitzLocalExists("' + safe + '")').then(function (r) {
                if (!r || !r.exists) return { complete: false, missing: ['folder missing'], found: [] };

                // Check for metadata.json + scan for .aep files
                var checks = [
                    _callExtendScript('blitzLocalExists("' + (safe + '/metadata.json').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")'),
                    _callExtendScript('blitzLocalListAep("' + safe.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")')
                ];
                return Promise.all(checks).then(function (results) {
                    var missing = [];
                    var found = [];
                    var metaExists = results[0] && results[0].exists;
                    var aepFiles = (results[1] && results[1].files) || [];

                    if (!metaExists) missing.push('metadata.json');
                    else found.push('metadata.json');

                    if (aepFiles.length === 0) missing.push('no .aep file');
                    else found.push(aepFiles[0]);

                    return {
                        complete: missing.length === 0,
                        missing: missing,
                        found: found
                    };
                });
            }).catch(function () {
                return { complete: false, missing: ['check failed'], found: [] };
            });
        },

        /**
         * Get the local AEP path for fast import. Scans for any .aep file
         * if template.aep doesn't exist.
         * @param {string} storagePath
         * @returns {Promise<string>} — aep path, or empty if not found
         */
        getLocalAepPath: function (storagePath) {
            return this.checkLocal(storagePath).then(function (info) {
                return info.aepPath || '';
            });
        },

        /**
         * SYNCHRONOUSLY return the local mirror directory for a template IF it is
         * fully synced (complete) and content-current, else ''. Reads only the
         * cached sync state — NO host round-trip — so the render path can decide
         * to serve thumbnails/previews from local disk (file://) without blocking.
         * @param {string} storagePath — "Category/FolderName"
         * @param {string} [contentVersion] — when provided, the stored version
         *        must match (a known mismatch means the disk copy is stale).
         * @returns {string} — absolute local dir, or '' if unsynced/stale
         */
        getLocalDirIfComplete: function (storagePath, contentVersion) {
            var lib = _getLibraryPath();
            if (!lib || !storagePath) return '';
            var state = _loadState();
            var tpl = state.templates && state.templates[storagePath];
            if (!tpl || !tpl.complete) return '';
            // Only reject on a KNOWN mismatch. If either side lacks a version
            // (legacy mirror synced before versioning), serve it — the next
            // Sync All will stamp the version.
            if (contentVersion && tpl.contentVersion && tpl.contentVersion !== contentVersion) return '';
            return lib + '/' + storagePath;
        },

        /**
         * Batch variant of getLocalDirIfComplete: resolve the current local dir for
         * MANY templates in a SINGLE state parse. The per-comp variant parses the whole
         * sync-state blob twice each (getLibraryPath + loadState), so rendering a 112-card
         * grid did ~225 synchronous JSON.parses; this does ONE for the whole batch. The
         * dir-resolution and staleness rules are identical to getLocalDirIfComplete.
         * @param {Array<{storagePath:string, contentVersion?:string}>} items
         * @returns {Object} map of storagePath -> absolute local dir ('' if unsynced/stale)
         */
        getLocalDirsIfComplete: function (items) {
            var out = {};
            if (!items || !items.length) return out;
            var state = _loadState();
            var lib = state && state.libraryPath;
            if (!lib) return out;
            var templates = (state && state.templates) || {};
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (!it || !it.storagePath) continue;
                var tpl = templates[it.storagePath];
                if (!tpl || !tpl.complete) { out[it.storagePath] = ''; continue; }
                // Match getLocalDirIfComplete: reject only on a KNOWN version mismatch.
                if (it.contentVersion && tpl.contentVersion && tpl.contentVersion !== it.contentVersion) {
                    out[it.storagePath] = '';
                    continue;
                }
                out[it.storagePath] = lib + '/' + it.storagePath;
            }
            return out;
        },

        /**
         * Download a single template to the local mirror.
         * Uses cloudLibrary.mirrorTemplate() to download all files,
         * then writes everything to the local mirror folder.
         * @param {string} storagePath
         * @param {string} [contentVersion] — opaque content fingerprint stored
         *        alongside the mirror so a later sync can detect cloud changes.
         * @returns {Promise<{localAepPath:string, fileCount:number}>}
         */
        syncTemplate: function (storagePath, contentVersion) {
            if (!storagePath) return Promise.reject(new Error('storagePath required'));
            if (!window.cloudLibrary || !window.cloudLibrary.mirrorTemplate) {
                return Promise.reject(new Error('cloudLibrary unavailable'));
            }

            var libPath = _getLibraryPath();
            if (!libPath) return Promise.reject(new Error('Library path not configured'));

            return _ensureLibraryRoot().then(function () {
                return _ensureDirs(libPath, storagePath);
            }).then(function () {
                return window.cloudLibrary.mirrorTemplate(storagePath);
            }).then(function (mirrored) {
                var files = mirrored.files || [];
                var localAepPath = '';
                var dirsNeeded = {};

                // First pass: collect all unique parent directories needed
                for (var i = 0; i < files.length; i++) {
                    var rel = files[i].relativePath;
                    if (!rel) continue;
                    var relParts = rel.split('/');
                    if (relParts.length > 1) {
                        dirsNeeded[relParts.slice(0, -1).join('/')] = 1;
                    }
                    if (!localAepPath) {
                        var lower = rel.toLowerCase();
                        if (lower.length >= 4 && lower.indexOf('.aep', lower.length - 4) !== -1) {
                            localAepPath = libPath + '/' + storagePath + '/' + rel;
                        }
                    }
                }

                // Ensure all needed directories exist BEFORE writing files
                var dirKeys = Object.keys(dirsNeeded);
                var dirPromises = [];
                for (var d = 0; d < dirKeys.length; d++) {
                    dirPromises.push(_ensureDirs(libPath, storagePath + '/' + dirKeys[d]));
                }

                return Promise.all(dirPromises).then(function () {
                    // Now write all files — parent dirs are guaranteed to exist
                    var writes = [];
                    for (var i = 0; i < files.length; i++) {
                        var rel2 = files[i].relativePath;
                        if (!rel2) continue;
                        var localFilePath = libPath + '/' + storagePath + '/' + rel2;
                        writes.push(_writeBlob(localFilePath, files[i].blob));
                    }

                    return Promise.all(writes).then(function () {
                        var state = _loadState();
                        if (!state.templates) state.templates = {};
                        state.templates[storagePath] = {
                            ts: Date.now(),
                            files: files.length,
                            complete: !!localAepPath,
                            contentVersion: contentVersion || ''
                        };
                        _saveState(state);
                        return {
                            localAepPath: localAepPath,
                            fileCount: files.length
                        };
                    });
                });
            });
        },

        /**
         * Sync all uncached templates in a category.
         * @param {string} categoryName
         * @param {function} onProgress — called with {done, total, current}
         * @returns {Promise<{synced:number, total:number}>}
         */
        syncCategory: function (categoryName, onProgress) {
            if (!categoryName) return Promise.reject(new Error('categoryName required'));
            if (!window.cloudLibrary || !window.cloudLibrary.listCompsInCategory) {
                return Promise.reject(new Error('cloudLibrary unavailable'));
            }

            return window.cloudLibrary.listCompsInCategory(categoryName).then(function (comps) {
                var state = _loadState();
                var missing = [];
                var verMap = {};
                for (var i = 0; i < comps.length; i++) {
                    var sp = comps[i].storagePath;
                    if (!sp) continue;
                    verMap[sp] = comps[i].contentVersion || '';
                    var tpl = state.templates && state.templates[sp];
                    if (!tpl || !tpl.complete) missing.push(sp);
                }

                var synced = 0;
                var total = missing.length;

                function _next() {
                    if (synced >= total) {
                        if (onProgress) onProgress({ done: synced, total: total, current: '' });
                        return Promise.resolve({ synced: synced, total: total });
                    }
                    var sp = missing[synced];
                    if (onProgress) onProgress({ done: synced, total: total, current: sp });
                    return api.syncTemplate(sp, verMap[sp]).then(function () {
                        synced++;
                        return _next();
                    }).catch(function (err) {
                        // Log but continue — one failure doesn't block the rest
                        console.warn('[local-sync] Failed to sync ' + sp + ': ' + (err && err.message || err));
                        synced++;
                        return _next();
                    });
                }

                return _next();
            });
        },

        /**
         * Get the overall sync state summary.
         * @returns {{total:number, synced:number, pending:number, inProgress:boolean}}
         */
        getSyncState: function () {
            var state = _loadState();
            var templates = state.templates || {};
            var keys = Object.keys(templates);
            var synced = 0;
            for (var i = 0; i < keys.length; i++) {
                if (templates[keys[i]].complete) synced++;
            }
            return {
                libraryPath: state.libraryPath || '',
                synced: synced,
                tracked: keys.length,
                lastFullSync: state.lastFullSync || 0
            };
        },

        /**
         * Sync all templates in a list of storage paths to the local mirror.
         * Downloads templates not already cached locally, AND re-pulls templates
         * whose stored content version differs from the version in versionMap
         * (cloud content changed since the last sync).
         * @param {string[]} storagePaths — "Category/FolderName" entries
         * @param {function} onProgress — called with {done, total, current}
         * @param {Object} [versionMap] — storagePath -> current content version;
         *        a mismatch vs the stored version marks the template for re-sync.
         * @returns {Promise<{synced:number, failed:number, skipped:number, total:number}>}
         */
        syncAll: function (storagePaths, onProgress, versionMap) {
            if (!storagePaths || storagePaths.length === 0) {
                return Promise.resolve({ synced: 0, skipped: 0, total: 0 });
            }
            if (!window.cloudLibrary || !window.cloudLibrary.mirrorTemplate) {
                return Promise.reject(new Error('cloudLibrary unavailable'));
            }
            var libPath = _getLibraryPath();
            if (!libPath) return Promise.reject(new Error('Library path not configured'));

            return _ensureLibraryRoot().then(function () {
                var state = _loadState();
                var missing = [];
                for (var i = 0; i < storagePaths.length; i++) {
                    var sp = storagePaths[i];
                    if (!sp) continue;
                    var tpl = state.templates && state.templates[sp];
                    var wantV = versionMap && versionMap[sp];
                    // Needs sync if never completed, OR a current version is known and
                    // the stored version differs. An EMPTY stored version (template
                    // mirrored via import/syncCategory before versioning, or a legacy
                    // mirror) counts as a mismatch here, so the first Sync All re-pulls
                    // and stamps it — otherwise it would escape staleness forever.
                    var stale = wantV && tpl && tpl.complete && tpl.contentVersion !== wantV;
                    if (!tpl || !tpl.complete || stale) missing.push(sp);
                }

                var processed = 0;
                var failed = 0;
                var CONCURRENCY = 3;
                var idx = 0;

                function worker() {
                    function next() {
                        if (idx >= missing.length) return Promise.resolve();
                        var myIdx = idx++;
                        var sp = missing[myIdx];
                        if (onProgress) onProgress({ done: processed, total: missing.length, current: sp });
                        return api.syncTemplate(sp, versionMap ? versionMap[sp] : '').then(function () {
                            processed++;
                            return next();
                        }).catch(function (err) {
                            console.warn('[local-sync] syncAll failed for ' + sp + ': ' + (err && err.message || err));
                            processed++;
                            failed++;
                            return next();
                        });
                    }
                    return next();
                }

                var workers = [];
                for (var w = 0; w < Math.min(CONCURRENCY, missing.length); w++) workers.push(worker());
                return Promise.all(workers).then(function () {
                    if (onProgress) onProgress({ done: processed, total: missing.length, current: '' });
                    var st = _loadState();
                    st.lastFullSync = Date.now();
                    _saveState(st);
                    return { synced: processed - failed, failed: failed, skipped: storagePaths.length - missing.length, total: storagePaths.length };
                });
            });
        },

        /**
         * Remove a template from the local mirror.
         * @param {string} storagePath
         */
        pruneTemplate: function (storagePath) {
            var local = _localPath(storagePath);
            if (!local) return Promise.resolve();
            var safe = local.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return _callExtendScript('blitzLocalRemoveDir("' + safe + '")').then(function () {
                var state = _loadState();
                if (state.templates) delete state.templates[storagePath];
                _saveState(state);
            });
        },

        /**
         * Remove local templates not referenced in the provided manifest paths.
         * @param {string[]} manifestPaths — list of "Category/FolderName" from the manifest
         */
        pruneOrphans: function (manifestPaths) {
            var pathSet = {};
            for (var i = 0; i < manifestPaths.length; i++) {
                pathSet[manifestPaths[i]] = true;
            }
            var state = _loadState();
            var templates = state.templates || {};
            var toPrune = [];
            var keys = Object.keys(templates);
            for (var j = 0; j < keys.length; j++) {
                if (!pathSet[keys[j]]) toPrune.push(keys[j]);
            }

            var pruned = 0;
            function _next() {
                if (pruned >= toPrune.length) return Promise.resolve(pruned);
                return api.pruneTemplate(toPrune[pruned]).then(function () {
                    pruned++;
                    return _next();
                });
            }
            return _next();
        }
    };

    window.localSync = api;
})();
