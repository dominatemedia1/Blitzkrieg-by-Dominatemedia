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
    var MAX_CONCURRENT_DOWNLOADS = 6;

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

    /** Write a blob to a local file path (base64 encoded). */
    function _writeBlob(filePath, blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                // reader.result is a data: URL — strip the prefix
                var b64 = reader.result;
                var comma = b64.indexOf(',');
                if (comma >= 0) b64 = b64.substring(comma + 1);
                var safe = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                _callExtendScript('blitzLocalWriteBinary("' + safe + '","' + b64 + '")').then(function (r) {
                    if (r && r.error) reject(new Error(r.error));
                    else resolve();
                }).catch(reject);
            };
            reader.onerror = function () { reject(new Error('FileReader failed')); };
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

                // Find the local .aep file — try template.aep first
                var aepPath = local + '/template.aep';
                return _callExtendScript('blitzLocalExists("' + aepPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")').then(function (aepR) {
                    if (!aepR || !aepR.exists) aepPath = ''; // will scan later
                    return {
                        exists: true,
                        complete: !!(tpl && tpl.complete),
                        aepPath: aepPath,
                        fileCount: (tpl && tpl.files) || 0
                    };
                });
            }).catch(function () {
                return { exists: false, complete: false, aepPath: '' };
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
         * Download a single template to the local mirror.
         * Uses cloudLibrary.downloadTemplate() for the AEP + footage,
         * then writes everything to the local mirror folder.
         * @param {string} storagePath
         * @returns {Promise<{localAepPath:string, fileCount:number}>}
         */
        syncTemplate: function (storagePath) {
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
                var writes = [];
                var localAepPath = '';

                for (var i = 0; i < files.length; i++) {
                    var f = files[i];
                    var rel = f.relativePath;
                    if (!rel) continue;
                    var localFilePath = libPath + '/' + storagePath + '/' + rel;

                    // Ensure parent dirs exist for nested files
                    var relParts = rel.split('/');
                    if (relParts.length > 1) {
                        var parentRel = relParts.slice(0, -1).join('/');
                        writes.push(_ensureDirs(libPath, storagePath + '/' + parentRel));
                    }

                    writes.push(_writeBlob(localFilePath, f.blob));

                    // Track the AEP path for the return value
                    if (!localAepPath) {
                        var lower = rel.toLowerCase();
                        if (lower.length >= 4 && lower.indexOf('.aep', lower.length - 4) !== -1) {
                            localAepPath = localFilePath;
                        }
                    }
                }

                return Promise.all(writes).then(function () {
                    var state = _loadState();
                    if (!state.templates) state.templates = {};
                    state.templates[storagePath] = {
                        ts: Date.now(),
                        files: files.length,
                        complete: true
                    };
                    _saveState(state);
                    return {
                        localAepPath: localAepPath,
                        fileCount: files.length
                    };
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
                for (var i = 0; i < comps.length; i++) {
                    var sp = comps[i].storagePath;
                    if (!sp) continue;
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
                    return api.syncTemplate(sp).then(function () {
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
         * Only downloads templates not already cached locally.
         * @param {string[]} storagePaths — "Category/FolderName" entries
         * @param {function} onProgress — called with {done, total, current}
         * @returns {Promise<{synced:number, skipped:number, total:number}>}
         */
        syncAll: function (storagePaths, onProgress) {
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
                    if (!tpl || !tpl.complete) missing.push(sp);
                }

                var synced = 0;
                var CONCURRENCY = 3;
                var idx = 0;

                function worker() {
                    function next() {
                        if (idx >= missing.length) return Promise.resolve();
                        var myIdx = idx++;
                        var sp = missing[myIdx];
                        if (onProgress) onProgress({ done: synced, total: missing.length, current: sp });
                        return api.syncTemplate(sp).then(function () {
                            synced++;
                            return next();
                        }).catch(function (err) {
                            console.warn('[local-sync] syncAll failed for ' + sp + ': ' + (err && err.message || err));
                            synced++;
                            return next();
                        });
                    }
                    return next();
                }

                var workers = [];
                for (var w = 0; w < Math.min(CONCURRENCY, missing.length); w++) workers.push(worker());
                return Promise.all(workers).then(function () {
                    if (onProgress) onProgress({ done: synced, total: missing.length, current: '' });
                    var st = _loadState();
                    st.lastFullSync = Date.now();
                    _saveState(st);
                    return { synced: synced, skipped: storagePaths.length - missing.length, total: storagePaths.length };
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
