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

    // Runtime (non-persisted) control state for the full-library background mirror.
    // Persisted flags live in state.fullSync; this holds the in-flight loop handles,
    // rate/ETA accounting, and the live progress callback. Reset on every startFullSync.
    var _fsRun = null;
    var _fsSeq = 0; // monotonic run id — lets a superseded run's workers detect they are stale
    var MAX_SYNC_FAILS = 3; // consecutive transient sync failures before a template is given up (marked broken) so full-sync converges
    var SYNC_RETRY_COOLDOWN_MS = 30 * 60 * 1000; // after giving up on a TRANSIENT failure, auto-retry once this cooldown passes (a network blip self-heals; genuinely-broken sources are not retried)

    /** Promise that resolves after ms (CEP has setTimeout). */
    function _delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // ── internal helpers ──────────────────────────────────────────

    /** Call an ExtendScript function and return a Promise of the parsed JSON result. */
    function _callExtendScript(expr) {
        return new Promise(function (resolve, reject) {
            if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== 'function') {
                reject(new Error('CEP bridge unavailable'));
                return;
            }
            // The evalScript callback can silently never fire (host wedged on a
            // native dialog / crash). Without a bound this hangs syncTemplate's
            // dir-create / .aep-verify forever, which — like the download hang —
            // wedges the whole full-sync loop. Time-bound it so the caller's
            // reject path runs (verify already fails open; dir-create rejects ->
            // template marked retryable).
            // 120s: generous enough that the base64-decode WRITE fallback (used only
            // when native cep.fs.writeFile is unavailable and it decodes a whole large
            // .aep in one host round-trip) does not falsely time out, while still
            // bounding a genuinely wedged host so the sync loop can never hang forever.
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                reject(new Error('ExtendScript call timed out'));
            }, 120000);
            window.__adobe_cep__.evalScript(expr, function (result) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
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
        var state;
        try {
            state = JSON.parse(localStorage.getItem(STATE_KEY) || 'null') || { templates: {} };
        } catch (e) {
            return { templates: {} };
        }
        // One-time repair: earlier builds wrote thumbnail-render failures into the
        // SYNC state via markBroken(), so ~20 fully-mirrored templates wore a false
        // "Needs re-stash" chip even though every byte was on disk. Clear those
        // legacy flags exactly once. A thumbnail failure is now tracked in a separate
        // cosmetic key (blitzkrieg_thumb_failed) and never touches sync state.
        if (!state.migratedThumbBroken) {
            state = _migrateLegacyBrokenFlags(state);
        }
        return state;
    }

    /**
     * Clear legacy thumbnail-render broken flags. Only touches entries that are (a)
     * marked broken, (b) carry NO brokenKind (the old markBroken never set one), AND
     * (c) whose reason names a thumbnail render failure. A thumbnail render failure is
     * ALWAYS cosmetic — it never indicates a sync problem — so we clear it regardless
     * of the complete flag (the old thumbnail-gen path fired markBroken WITHOUT setting
     * the full-mirror complete flag, so most such entries are complete:false and a
     * complete-only gate would leave them falsely "Needs re-stash"). The thumbnail
     * reason string ("thumbnail render failed" / "unrenderable source") cannot collide
     * with the import-relink footage reason ("N source file(s) missing"), so genuine
     * footage breaks are preserved untouched. Returns the (mutated) state, persists once.
     */
    function _migrateLegacyBrokenFlags(state) {
        try {
            var tpls = state.templates || {};
            var keys = Object.keys(tpls);
            for (var i = 0; i < keys.length; i++) {
                var t = tpls[keys[i]];
                if (!t || !t.broken || t.brokenKind) continue;
                var reason = String(t.broken).toLowerCase();
                var isThumbReason = reason.indexOf('thumbnail render failed') !== -1
                    || reason.indexOf('unrenderable source') !== -1;
                if (isThumbReason) {
                    delete t.broken;
                    delete t.brokenTs;
                }
            }
            state.migratedThumbBroken = true;
            localStorage.setItem(STATE_KEY, JSON.stringify(state));
        } catch (e) {
            state.migratedThumbBroken = true; // never loop on a corrupt entry
        }
        return state;
    }

    /**
     * Shared classifier for a single template's sync-state entry. The ONE place that
     * decides what a stored entry means, so the badge, the dashboard list, and the
     * summary counts can never drift apart. Pure — takes the entry and a precomputed
     * stale flag (content changed in cloud since mirror).
     *   status ∈ 'complete' | 'broken' | 'failed' | 'empty' | 'pending'
     *   advisory ∈ '' | 'restash'  (a complete mirror that still references missing
     *             footage — it imports fine from its downloaded .aep meanwhile)
     */
    function _classifyEntry(t, stale) {
        if (!t) return { status: 'pending', advisory: '' };
        var kind = t.brokenKind || '';
        if (t.complete && !stale) {
            // A complete mirror dominates every non-source break. A genuine source
            // (missing-footage) break earns a muted advisory, and even then the comp
            // still imports from its .aep so it stays counted complete. Legacy footage
            // breaks carry no brokenKind (kind === ''); by the time this runs, the load
            // migration has already stripped legacy THUMBNAIL breaks, so a remaining
            // kindless break on a complete mirror is a real footage break → advise too.
            if (t.broken && (kind === 'source' || kind === '')) return { status: 'complete', advisory: 'restash' };
            return { status: 'complete', advisory: '' };
        }
        if (t.broken) {
            if (kind === 'empty') return { status: 'empty', advisory: '' };      // terminal: no content in cloud
            if (kind === 'transient') return { status: 'failed', advisory: '' }; // retryable network give-up
            return { status: 'broken', advisory: '' };                           // 'source' or legacy undefined
        }
        return { status: 'pending', advisory: '' };
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

    /** Write a blob to a local file path.
     *  PRIMARY: CEP's native filesystem (cep.fs.writeFile in Base64 mode) —
     *  decodes in native code, no host-thread round-trip, the exact mechanism
     *  main.js's writeBlobToFile verified works.
     *  FALLBACK: chunked base64 append to a .b64 temp, then a pure-ES3 decode
     *  via decodeBase64FileToBinary (proven, used for all sizes here).
     *  We NEVER decode base64 inside ExtendScript via atob — atob does not
     *  exist in ES3 and silently produced 0-byte files for 71% of assets. */
    function _writeBlob(filePath, blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('FileReader failed')); };
            reader.onload = function () {
                var b64 = reader.result;
                var comma = b64.indexOf(',');
                if (comma >= 0) b64 = b64.substring(comma + 1);
                if (!b64 || b64.length === 0) { reject(new Error('Empty base64 from blob')); return; }

                // PRIMARY: CEP native filesystem (fast, correct on Win + Mac).
                try {
                    if (typeof cep !== 'undefined' && cep.fs && typeof cep.fs.writeFile === 'function' &&
                        cep.encoding && typeof cep.encoding.Base64 !== 'undefined') {
                        var res = cep.fs.writeFile(filePath, b64, cep.encoding.Base64);
                        if (res && res.err === 0) { resolve(); return; }
                        // else fall through to the ExtendScript decoder
                    }
                } catch (e) { /* fall through to fallback */ }

                // FALLBACK: chunked .b64 append + ES3 binary decode (all sizes).
                var safe = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                var safeTmpB64 = safe + '.b64';
                var CHUNK = 500000; // 500KB per evalScript call — well under limits
                var idx = 0;
                function writeChunk() {
                    if (idx >= b64.length) {
                        _callExtendScript('decodeBase64FileToBinary("' + safeTmpB64 + '","' + safe + '")').then(function (r) {
                            if (typeof r === 'string' && r.indexOf('ERROR') === 0) reject(new Error(r));
                            else resolve();
                        }).catch(reject);
                        return;
                    }
                    var chunk = b64.substring(idx, idx + CHUNK);
                    if (!/^[A-Za-z0-9+/=]*$/.test(chunk)) { reject(new Error('Invalid base64 data detected')); return; }
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
         * Open the library folder (or any path) in Finder/Explorer so the user can
         * SEE where synced files land. Resolves regardless of outcome.
         * @param {string} path
         * @returns {Promise<Object>}
         */
        revealInFinder: function (path) {
            if (!path) return Promise.resolve({ error: 'no path' });
            var safe = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return _callExtendScript('blitzRevealInFinder("' + safe + '")');
        },

        /**
         * Free/total bytes + writability for the volume holding `path`. Fails soft:
         * resolves with {error} or zeros so callers never block on it.
         * @param {string} path
         * @returns {Promise<{freeBytes:number, totalBytes:number, writable:boolean}>}
         */
        getDiskFree: function (path) {
            if (!path) return Promise.resolve({ error: 'no path' });
            var safe = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return _callExtendScript('blitzGetDiskFree("' + safe + '")');
        },

        /**
         * Verify the configured library ROOT still exists on disk. Detects the
         * "I moved / unplugged the library" case so the UI can prompt a re-pick
         * instead of silently re-downloading everything into a vanished path.
         * @returns {Promise<{configured:boolean, exists:boolean, path:string}>}
         */
        checkLibraryRoot: function () {
            var lib = _getLibraryPath();
            if (!lib) return Promise.resolve({ configured: false, exists: false, path: '' });
            var safe = lib.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return _callExtendScript('blitzLocalExists("' + safe + '")').then(function (r) {
                return { configured: true, exists: !!(r && r.exists), path: lib };
            }, function () {
                return { configured: true, exists: false, path: lib };
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
         * THUMBNAIL variant of getLocalDirsIfComplete. Returns the local dir when the
         * template has its comp.png on disk — either from a FULL mirror (complete=.aep
         * present) OR from a thumbnail-only mirror (thumbComplete=comp.png present). Used
         * by the render path to serve file://comp.png for auto-seeded thumbnail caches.
         * NOTE: the IMPORT path must keep using getLocalDir(s)IfComplete (which requires
         * the .aep) — a thumbnail-only dir has no project file to import.
         * @param {Array<{storagePath:string, contentVersion?:string}>} items
         * @returns {Object} map of storagePath -> absolute local dir ('' if no local comp.png)
         */
        getLocalThumbDirs: function (items) {
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
                if (!tpl || (!tpl.complete && !tpl.thumbComplete)) { out[it.storagePath] = ''; continue; }
                // Match getLocalDirsIfComplete: reject only on a KNOWN version mismatch.
                if (it.contentVersion && tpl.contentVersion && tpl.contentVersion !== it.contentVersion) {
                    out[it.storagePath] = '';
                    continue;
                }
                out[it.storagePath] = lib + '/' + it.storagePath;
            }
            return out;
        },

        /**
         * Download ONLY a template's comp.png (+ metadata.json best-effort) to the local
         * mirror — the lightweight half of Animation-Composer parity. Sets a separate
         * `thumbComplete` flag so the render path serves file://comp.png without implying
         * the full .aep bundle is present. ~420KB/template vs the whole folder.
         * @param {string} storagePath
         * @param {string} [contentVersion]
         * @returns {Promise<{thumbComplete:boolean, fileCount:number}>}
         */
        syncThumbnail: function (storagePath, contentVersion) {
            if (!storagePath) return Promise.reject(new Error('storagePath required'));
            if (!window.cloudLibrary || !window.cloudLibrary.mirrorThumbnail) {
                return Promise.reject(new Error('cloudLibrary.mirrorThumbnail unavailable'));
            }
            var libPath = _getLibraryPath();
            if (!libPath) return Promise.reject(new Error('Library path not configured'));

            return _ensureLibraryRoot().then(function () {
                return _ensureDirs(libPath, storagePath);
            }).then(function () {
                return window.cloudLibrary.mirrorThumbnail(storagePath);
            }).then(function (mirrored) {
                var files = (mirrored && mirrored.files) || [];
                var writes = [];
                var wroteCompPng = false;
                for (var i = 0; i < files.length; i++) {
                    var rel = files[i].relativePath;
                    if (!rel) continue;
                    if (rel === 'comp.png') wroteCompPng = true;
                    writes.push(_writeBlob(libPath + '/' + storagePath + '/' + rel, files[i].blob));
                }
                if (!wroteCompPng) {
                    // No comp.png to cache — leave thumbComplete unset so we do not
                    // point the render path at a file:// that does not exist.
                    return { thumbComplete: false, fileCount: 0 };
                }
                return Promise.all(writes).then(function () {
                    var state = _loadState();
                    if (!state.templates) state.templates = {};
                    var existing = state.templates[storagePath] || {};
                    existing.thumbTs = Date.now();
                    existing.thumbComplete = true;
                    // Preserve any full-mirror flag; only stamp the thumbnail fields.
                    if (typeof existing.complete === 'undefined') existing.complete = false;
                    if (!existing.contentVersion) existing.contentVersion = contentVersion || '';
                    state.templates[storagePath] = existing;
                    _saveState(state);
                    return { thumbComplete: true, fileCount: files.length };
                });
            });
        },

        /**
         * Download a single template to the local mirror.
         * Uses cloudLibrary.mirrorTemplate() to download all files,
         * then writes everything to the local mirror folder.
         * @param {string} storagePath
         * @param {string} [contentVersion] — opaque content fingerprint stored
         *        alongside the mirror so a later sync can detect cloud changes.
         * @param {function} [onFileDone] — called with (bytes) as each bundle file
         *        finishes downloading, so the sync UI credits progress in-flight
         *        (honest MB/s / ETA) instead of only when a whole template lands.
         * @returns {Promise<{localAepPath:string, fileCount:number}>}
         */
        syncTemplate: function (storagePath, contentVersion, onFileDone) {
            if (!storagePath) return Promise.reject(new Error('storagePath required'));
            if (!window.cloudLibrary || !window.cloudLibrary.mirrorTemplate) {
                return Promise.reject(new Error('cloudLibrary unavailable'));
            }

            var libPath = _getLibraryPath();
            if (!libPath) return Promise.reject(new Error('Library path not configured'));

            return _ensureLibraryRoot().then(function () {
                return _ensureDirs(libPath, storagePath);
            }).then(function () {
                return window.cloudLibrary.mirrorTemplate(storagePath, onFileDone);
            }).then(function (mirrored) {
                var files = mirrored.files || [];
                var mirroredBytes = mirrored.sizeBytes || 0;
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
                        // LOCAL-2: verify the .aep actually landed on disk and is
                        // non-empty before marking the template complete. A missing
                        // or 0-byte .aep must never be served as a local fast-path
                        // import (which would hard-fail in AE with no cloud retry).
                        var verify = localAepPath
                            ? _callExtendScript('blitzLocalExists("' + localAepPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")').then(
                                function (st) { return !!(st && st.exists && st.size > 0); },
                                function () {
                                    // The verify CALL errored transiently (CEP/EvalScript).
                                    // The writes already succeeded, so do NOT discard the
                                    // sync; fall back to trusting the .aep presence (the
                                    // pre-gate behavior). The size gate is best-effort.
                                    return !!localAepPath;
                                })
                            : Promise.resolve(false);
                        return verify.then(function (aepOk) {
                            var state = _loadState();
                            if (!state.templates) state.templates = {};
                            // Merge into any existing entry so a prior thumbComplete/
                            // thumbTs (set by syncThumbnail) is preserved, not clobbered.
                            var _prevEntry = state.templates[storagePath] || {};
                            _prevEntry.ts = Date.now();
                            _prevEntry.files = files.length;
                            _prevEntry.bytes = mirroredBytes;
                            _prevEntry.complete = aepOk;
                            _prevEntry.contentVersion = contentVersion || '';
                            // A template that DID download and write an .aep is not broken,
                            // even if a prior run flagged it — clear the stale flag and
                            // the transient-failure counter so it starts fresh next time.
                            if (aepOk) { _prevEntry.failCount = 0; if (_prevEntry.broken) { delete _prevEntry.broken; delete _prevEntry.brokenTs; delete _prevEntry.brokenKind; } }
                            state.templates[storagePath] = _prevEntry;
                            _saveState(state);
                            return {
                                localAepPath: aepOk ? localAepPath : '',
                                fileCount: files.length
                            };
                        });
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
            var synced = 0;      // full template mirror (67GB "Sync All")
            var thumbSynced = 0; // thumbnail cached locally (the automatic default)
            for (var i = 0; i < keys.length; i++) {
                var t = templates[keys[i]];
                // Same classifier as the badge + dashboard so the three never drift.
                if (_classifyEntry(t, false).status === 'complete') synced++;
                if (t.complete || t.thumbComplete) thumbSynced++;
            }
            return {
                libraryPath: state.libraryPath || '',
                synced: synced,
                thumbSynced: thumbSynced,
                tracked: keys.length,
                lastFullSync: state.lastFullSync || 0
            };
        },

        // ── Full-library background mirror (67GB) ─────────────────────────
        // A persistent, pausable, resumable queue that downloads every template's
        // full bundle to the local mirror. Survives panel reload: on next load
        // main.js re-invokes startFullSync with the same target list and the loop
        // resumes from whatever is not yet `complete`. Progress is reported per
        // completed template PLUS a running ETA so the UI never looks frozen.

        /**
         * Classify a sync error. A template whose cloud folder has no downloadable
         * bundle (no .aep / missing footage that will never resolve) is BROKEN
         * (needs re-stash, not retry). Everything else is a transient FAILURE.
         */
        _classifySyncError: function (err) {
            var msg = (err && err.message ? err.message : String(err || '')).toLowerCase();
            // TERMINAL EMPTY: the folder has no importable .aep at all — nothing will
            // ever download, so it leaves the syncable universe (not counted broken,
            // not retried, not pending).
            if (msg.indexOf('empty template folder') !== -1
                || msg.indexOf('no files found') !== -1
                || msg.indexOf('no .aep') !== -1) {
                return 'empty';
            }
            // SOURCE PROBLEM: an .aep is expected but could not be pulled (or the
            // object is genuinely missing) — a real re-stash.
            if (msg.indexOf('source problem') !== -1
                || msg.indexOf('could not be downloaded') !== -1
                || msg.indexOf('object not found') !== -1
                || msg.indexOf('not found') !== -1) {
                return 'broken';
            }
            // Everything else (timeouts, transient network) is a retryable failure.
            return 'failed';
        },

        /**
         * Begin (or resume) the full-library mirror.
         * @param {string[]} storagePaths — every template path to ensure mirrored
         * @param {Object} versionMap — storagePath -> content version (re-pull on change)
         * @param {function} onTick — called with getFullSyncStatus() shape on each change
         * @returns {Promise<Object>} resolves with the final status when drained/paused
         */
        startFullSync: function (storagePaths, versionMap, onTick) {
            if (!storagePaths || !storagePaths.length) {
                return Promise.resolve({ active: false, done: 0, total: 0 });
            }
            if (!_getLibraryPath()) {
                return Promise.reject(new Error('Library path not configured'));
            }
            // Already running — just adopt the newest tick callback + targets and return.
            if (_fsRun && _fsRun.running) {
                if (onTick) _fsRun.tick = onTick;
                return _fsRun.promise;
            }

            var self = this;
            var state = _loadState();
            var fs = state.fullSync || {};
            fs.active = true;
            fs.paused = false;
            fs.cancelled = false;
            if (!fs.startedAt) fs.startedAt = Date.now();
            if (!fs.failures) fs.failures = {};
            state.fullSync = fs;
            _saveState(state);

            var myRun = {
                id: ++_fsSeq,
                running: true,
                tick: onTick || null,
                t0: Date.now(),
                doneThisRun: 0,
                bytesThisRun: 0,
                samples: [],   // rolling {t, b} points for a smoothed recent MB/s
                current: '',
                targets: storagePaths.slice(),
                versionMap: versionMap || {},
                promise: null
            };
            _fsRun = myRun;

            // Size-aware template concurrency. mirrorTemplate buffers a whole
            // template's files in memory before writing, so we cannot naively run N
            // templates at once (two large ones would blow the heap). We run a small
            // pool (CONCURRENCY) governed by an in-flight BYTE BUDGET: a worker only
            // picks up the next template if its estimated size still fits the budget,
            // UNLESS nothing is in flight (so a single oversized template always makes
            // progress, alone, exactly like the old serial behavior).
            //
            // CRITICAL memory-safety rule: a template's size is only known AFTER it
            // has synced once (persisted `bytes`, line ~552). On the FIRST full sync
            // that persisted size is absent, and we must NOT guess a small size and
            // pack two together, because two large templates (the library has a
            // multi-GB one) would then buffer concurrently and OOM the CEP heap.
            // FIX: pre-size the queue from the storage LISTING (cheap LIST calls, no
            // downloads) into `_sizeMap` so the first sync knows real sizes and can
            // pack small templates up to CONCURRENCY while a large one still runs
            // alone. Until a template is sized, it falls back to UNKNOWN = run alone
            // (serial-safe), so the sizing pass can never cause an OOM — it only ever
            // RELAXES serialization once a real (bounded) size is known.
            var _inflightBytes = 0;
            var BYTE_BUDGET = 700 * 1024 * 1024;      // ~700MB of concurrent template buffers
            var UNKNOWN_EST_BYTES = BYTE_BUDGET;       // unknown size -> run alone (memory-safe)
            var _sizeMap = {};                         // storagePath -> real bytes (from pre-sizing)

            function _estBytesFor(sp) {
                var st = _loadState();
                var t = st.templates && st.templates[sp];
                if (t && t.bytes) return t.bytes;      // persisted after a prior sync
                if (_sizeMap[sp] > 0) return _sizeMap[sp]; // learned this run via pre-sizing
                return UNKNOWN_EST_BYTES;              // not yet known -> run alone
            }

            // Credit bytes AS EACH FILE LANDS (not per whole template) so the rate
            // and ETA reflect live throughput. Keeps a trailing sample window so the
            // displayed MB/s is a recent-average, not a since-start average that a
            // single slow template would drag toward zero (the "12 KB/s" bug).
            function _creditBytes(bytes) {
                if (!bytes || _fsRun !== myRun) return;
                myRun.bytesThisRun += bytes;
                var now = Date.now();
                myRun.samples.push({ t: now, b: myRun.bytesThisRun });
                // Keep ~30s of samples (cap length so memory stays bounded).
                var cutoff = now - 30000;
                while (myRun.samples.length > 2 && myRun.samples[0].t < cutoff) {
                    myRun.samples.shift();
                }
                if (myRun.samples.length > 240) myRun.samples.shift();
            }

            function _emit() {
                if (_fsRun && _fsRun.tick) {
                    try { _fsRun.tick(self.getFullSyncStatus()); } catch (e) { /* UI callback must never break the loop */ }
                }
            }

            // Recompute pending from persisted state for THIS run's target set.
            function _pendingFor(run) {
                var st = _loadState();
                var tpls = st.templates || {};
                var out = [];
                for (var i = 0; i < run.targets.length; i++) {
                    var sp = run.targets[i];
                    if (!sp) continue;
                    var t = tpls[sp];
                    if (t && t.broken) {
                        // A genuinely-broken source (missing footage / unrenderable)
                        // stays skipped until re-stashed. A TRANSIENT give-up (repeated
                        // download failures / timeouts) is retried once a cooldown has
                        // passed, so a temporary network problem self-heals instead of
                        // permanently sidelining a healthy template.
                        var _transient = t.brokenKind === 'transient';
                        var _cooled = t.brokenTs && (Date.now() - t.brokenTs) > SYNC_RETRY_COOLDOWN_MS;
                        if (!(_transient && _cooled)) continue;
                    }
                    var wantV = run.versionMap[sp];
                    var stale = wantV && t && t.complete && t.contentVersion !== wantV;
                    if (!t || !t.complete || stale) out.push(sp);
                }
                return out;
            }

            var queue = _pendingFor(myRun);
            var qi = 0;

            // Background pre-sizing: learn each pending template's real byte size via
            // cheap LIST calls (no downloads) so the byte-budget can pack small
            // templates concurrently on the FIRST sync instead of running serially.
            // Runs in parallel with the download workers and fills _sizeMap as it
            // goes; a template not yet sized just stays serial-safe (UNKNOWN budget).
            // Bounded concurrency so it does not steal request slots from downloads.
            (function _presize() {
                if (!window.cloudLibrary || typeof window.cloudLibrary.getTemplateSize !== 'function') return;
                var si = 0;
                var SIZE_CONC = 4;
                function _sizeWorker() {
                    // Stop sizing when superseded OR when the run is cancelled/stopped
                    // (do not keep issuing LIST calls after the user hits Stop).
                    if (_fsRun !== myRun || _isDead()) return;
                    if (si >= queue.length) return;
                    var sp = queue[si++];
                    // Skip if already known (persisted from a prior sync).
                    var st = _loadState();
                    var t = st.templates && st.templates[sp];
                    if (t && t.bytes) { return _sizeWorker(); }
                    window.cloudLibrary.getTemplateSize(sp).then(function (res) {
                        // Only trust a size when the WHOLE template is accounted for
                        // (res.trustworthy). An untrusted/partial size stays UNKNOWN =
                        // run-alone, so pre-sizing can only ever relax serialization
                        // for provably-bounded templates, never risk an OOM.
                        if (res && res.trustworthy && res.total > 0) _sizeMap[sp] = res.total;
                        _sizeWorker();
                    }, function () { _sizeWorker(); });
                }
                for (var k = 0; k < SIZE_CONC; k++) _sizeWorker();
            })();

            // A run is DEAD (must fully stop, resolving its promise) when it has been
            // superseded by a newer run, when the persisted sync was cancelled, or when
            // the persisted sync is no longer active. NOTE: pause is NOT death — a paused
            // run keeps its single loop alive and idles, so resume never has to spawn a
            // second loop (which previously raced the first and corrupted files).
            function _isDead() {
                if (_fsRun !== myRun) return true; // superseded
                var st = _loadState();
                return !st.fullSync || st.fullSync.cancelled || !st.fullSync.active;
            }
            function _isPaused() {
                var st = _loadState();
                return !!(st.fullSync && st.fullSync.paused);
            }

            function worker() {
                function step() {
                    if (_isDead()) return Promise.resolve();
                    if (_isPaused()) {
                        // Idle in place (do not take a new item, do not end the loop).
                        myRun.current = '';
                        _emit();
                        return _delay(600).then(step);
                    }
                    if (qi >= queue.length) return Promise.resolve(); // drained
                    // Byte-budget admission: if taking the next template would push the
                    // in-flight buffer estimate over budget AND something is already
                    // running, wait and retry rather than pulling it now. When nothing
                    // is in flight we always take it (a single giant runs alone).
                    var peekEst = _estBytesFor(queue[qi]);
                    if (_inflightBytes > 0 && (_inflightBytes + peekEst) > BYTE_BUDGET) {
                        return _delay(400).then(step);
                    }
                    var sp = queue[qi++];
                    var est = peekEst;
                    _inflightBytes += est;
                    myRun.current = sp;
                    _emit();
                    return api.syncTemplate(sp, myRun.versionMap[sp] || '', _creditBytes).then(function (r) {
                        _inflightBytes -= est; if (_inflightBytes < 0) _inflightBytes = 0;
                        myRun.doneThisRun++;
                        // Bytes were already credited per-file via _creditBytes during
                        // the download (do NOT add te.bytes here or it double-counts).
                        _emit();
                        return step();
                    }, function (err) {
                        _inflightBytes -= est; if (_inflightBytes < 0) _inflightBytes = 0;
                        var kind = self._classifySyncError(err);
                        var st3 = _loadState();
                        if (!st3.templates) st3.templates = {};
                        var entry = st3.templates[sp] || {};
                        // Retry-cap: a transient 'failed' (e.g. a per-file download
                        // timeout on a large asset) is retryable, but without a cap a
                        // genuinely too-slow template re-downloads from scratch every
                        // run and full-sync never reaches "done". After MAX_SYNC_FAILS
                        // consecutive failures, promote to broken so _pendingFor skips
                        // it and the run converges; a "Regenerate/retry" clears it.
                        if (kind === 'empty') {
                            // TERMINAL empty: no importable .aep exists in the cloud
                            // folder. Never retried, never counted as a re-stash — it
                            // simply leaves the syncable universe so the run can finish.
                            entry.broken = (err && err.message) ? err.message : 'empty template';
                            entry.brokenKind = 'empty';
                            entry.brokenTs = Date.now();
                            entry.failCount = 0;
                            st3.templates[sp] = entry;
                        } else if (kind === 'broken') {
                            // Unrenderable source (missing .aep object / missing footage):
                            // permanent until re-stashed. Not retried by _pendingFor.
                            entry.broken = (err && err.message) ? err.message : 'unavailable';
                            entry.brokenKind = 'source';
                            entry.brokenTs = Date.now();
                            entry.failCount = 0;
                            st3.templates[sp] = entry;
                        } else {
                            entry.failCount = (entry.failCount || 0) + 1;
                            if (entry.failCount >= MAX_SYNC_FAILS) {
                                // Transient give-up: converges this run but _pendingFor
                                // retries it automatically after SYNC_RETRY_COOLDOWN_MS.
                                entry.broken = 'gave up after ' + entry.failCount + ' failed attempts: ' + (err && err.message ? err.message : 'download failed');
                                entry.brokenKind = 'transient';
                                entry.brokenTs = Date.now();
                            }
                            st3.templates[sp] = entry;
                        }
                        if (!st3.fullSync) st3.fullSync = {};
                        if (!st3.fullSync.failures) st3.fullSync.failures = {};
                        st3.fullSync.failures[sp] = kind + ': ' + (err && err.message ? err.message : err);
                        _saveState(st3);
                        myRun.doneThisRun++;
                        console.warn('[local-sync] full-sync ' + kind + ' for ' + sp + ': ' + (err && err.message || err));
                        return step();
                    });
                }
                return step();
            }

            // Up to 3 templates at once, but the per-worker BYTE BUDGET gate (in step)
            // keeps total in-flight buffers bounded so small templates pack together
            // while a large one runs alone. This is the speed win over the old serial
            // (CONCURRENCY 1) path without risking the OOM that naive concurrency would.
            // downloadStorageFiles still uses 6 concurrent requests per template (the
            // CEP per-host cap); 3 templates leaves enough slots for interactive
            // thumbnail signing + imports to stay responsive.
            var CONCURRENCY = 3;
            var workers = [];
            for (var w = 0; w < Math.min(CONCURRENCY, queue.length || 1); w++) workers.push(worker());

            myRun.promise = Promise.all(workers).then(function () {
                // Only the CURRENT run may mutate shared runtime/persisted completion
                // state — a stale run resolving late must never clobber a live one.
                if (_fsRun === myRun) { myRun.running = false; myRun.current = ''; }
                var st = _loadState();
                if (!st.fullSync) st.fullSync = {};
                var remaining = _pendingFor(myRun).length;
                if (_fsRun === myRun && !st.fullSync.paused && !st.fullSync.cancelled && remaining === 0) {
                    st.fullSync.active = false;
                    st.fullSync.completedAt = Date.now();
                    st.lastFullSync = Date.now();
                    _saveState(st);
                }
                _emit();
                return self.getFullSyncStatus();
            });
            _emit();
            return myRun.promise;
        },

        pauseFullSync: function () {
            var state = _loadState();
            if (!state.fullSync) state.fullSync = {};
            state.fullSync.paused = true;
            _saveState(state);
            // Do NOT tear down _fsRun. The single loop stays alive and idles on the
            // persisted `paused` flag, so Resume never has to spawn a second loop
            // (which previously raced the first and could corrupt a mirrored bundle).
            return this.getFullSyncStatus();
        },

        resumeFullSync: function () {
            var state = _loadState();
            if (!state.fullSync) state.fullSync = {};
            state.fullSync.paused = false;
            state.fullSync.cancelled = false;
            state.fullSync.active = true;
            _saveState(state);
            return this.getFullSyncStatus();
        },

        cancelFullSync: function () {
            var state = _loadState();
            if (!state.fullSync) state.fullSync = {};
            state.fullSync.active = false;
            state.fullSync.cancelled = true;
            state.fullSync.paused = false;
            _saveState(state);
            // Do NOT force _fsRun.running=false. An in-flight template download cannot
            // be aborted (no cancellation token), and forcing running=false here would
            // let a fresh startFullSync (e.g. an immediate Download-all click) bypass the
            // re-entrancy guard and spawn a SECOND worker that writes the same file
            // concurrently with the still-draining one — corrupting the bundle. Instead
            // the worker sees _isDead() (cancelled) at its next step and stops; the
            // completion handler then sets running=false only after Promise.all drains,
            // so there is never a window where two runs write the same path.
            return this.getFullSyncStatus();
        },

        /**
         * Live status of the full-library mirror: counts, ETA, throughput.
         * done/total are computed from persisted state so they are correct even
         * after a reload (before startFullSync re-arms the runtime).
         */
        getFullSyncStatus: function (allPaths, versionMap) {
            var state = _loadState();
            var fs = state.fullSync || {};
            var tpls = state.templates || {};
            // The universe of templates: explicit arg, else the last run's targets,
            // else everything currently tracked in state.
            var targets = allPaths && allPaths.length ? allPaths
                : (_fsRun && _fsRun.targets && _fsRun.targets.length ? _fsRun.targets : Object.keys(tpls));
            var total = targets.length;
            var complete = 0, broken = 0, pending = 0, failed = 0, empty = 0, restash = 0;
            for (var i = 0; i < targets.length; i++) {
                var t = tpls[targets[i]];
                // VERSION-AWARE: a mirror whose cloud content changed since download is
                // NOT counted complete (matches getLocalDirsIfComplete / the sidebar
                // badge). Reject only on a KNOWN mismatch. Without a versionMap this
                // degrades to the legacy "any complete mirror" count.
                var wantVer = versionMap ? versionMap[targets[i]] : null;
                var stale = !!(t && t.complete && wantVer && t.contentVersion && t.contentVersion !== wantVer);
                var c = _classifyEntry(t, stale);
                if (c.status === 'complete') { complete++; if (c.advisory === 'restash') restash++; }
                else if (c.status === 'empty') empty++;   // terminal: genuinely no content in cloud
                else if (c.status === 'failed') failed++; // retryable transient give-up
                else if (c.status === 'broken') broken++; // genuine re-stash needed
                else { // pending
                    if (fs.failures && fs.failures[targets[i]]) failed++;
                    else pending++;
                }
            }
            // Syncable universe excludes terminally-empty folders (no .aep will ever
            // download) so "done" can reach 100% of what CAN sync. Everything that
            // remains not-yet-complete after removing empties is real work.
            var syncable = total - empty;
            var done = complete >= syncable;
            // "running" = the loop is actively downloading (alive AND not paused).
            var running = !!(_fsRun && _fsRun.running) && !fs.paused;
            var etaMs = 0, bytesPerSec = 0, doneThisRun = 0;
            if (_fsRun) {
                doneThisRun = _fsRun.doneThisRun;
                var now = Date.now();
                var elapsed = now - _fsRun.t0;
                // Rolling throughput from the trailing sample window: rate over the
                // span of recent per-file completions. This credits the in-flight
                // template and reflects CURRENT speed, not a since-start average a
                // single slow item drags down. Fall back to cumulative if too few
                // samples yet.
                var samples = _fsRun.samples || [];
                if (samples.length >= 2) {
                    var first = samples[0];
                    var last = samples[samples.length - 1];
                    var span = last.t - first.t;
                    if (span > 0) bytesPerSec = Math.round((last.b - first.b) / (span / 1000));
                } else if (elapsed > 0 && _fsRun.bytesThisRun > 0) {
                    bytesPerSec = Math.round(_fsRun.bytesThisRun / (elapsed / 1000));
                }
                // ETA: prefer a byte-based estimate (remaining templates * avg bytes
                // per completed template, divided by the live rate). Fall back to the
                // per-item wall-clock average when we lack a byte rate.
                if (doneThisRun > 0 && bytesPerSec > 0) {
                    var avgBytes = _fsRun.bytesThisRun / doneThisRun;
                    etaMs = Math.round((avgBytes * pending) / bytesPerSec * 1000);
                } else if (doneThisRun > 0 && elapsed > 0) {
                    etaMs = Math.round((elapsed / doneThisRun) * pending);
                }
            }
            return {
                active: !!fs.active,
                paused: !!fs.paused,
                cancelled: !!fs.cancelled,
                running: running,
                total: total,
                syncable: syncable,
                done: done,
                complete: complete,
                broken: broken,
                failed: failed,
                empty: empty,
                unsyncable: empty,
                needsRestash: restash,
                pending: pending < 0 ? 0 : pending,
                current: _fsRun ? _fsRun.current : '',
                etaMs: etaMs,
                bytesPerSec: bytesPerSec,
                sessionBytes: _fsRun ? _fsRun.bytesThisRun : 0,
                startedAt: fs.startedAt || 0,
                completedAt: fs.completedAt || 0
            };
        },

        /**
         * Per-template status list for the Sync & Analytics view.
         * @param {Array} comps — comp objects (need .storagePath, .name, .category)
         * @returns {Array<{storagePath,name,category,status,bytes,reason}>}
         *          status ∈ 'complete' | 'syncing' | 'broken' | 'failed' | 'pending'
         */
        getTemplateStatuses: function (comps) {
            var state = _loadState();
            var tpls = state.templates || {};
            var fs = state.fullSync || {};
            var current = _fsRun ? _fsRun.current : '';
            var out = [];
            for (var i = 0; i < comps.length; i++) {
                var sp = comps[i].storagePath;
                if (!sp) continue;
                var t = tpls[sp];
                // Single source of truth: the shared classifier decides complete /
                // broken / failed / empty / pending exactly as the badge and summary
                // counts do, so no two surfaces can ever disagree.
                var c = _classifyEntry(t, false);
                var status = c.status;
                var advisory = c.advisory;
                var reason = '';
                if (status === 'broken' || status === 'failed' || status === 'empty') {
                    reason = t && t.broken ? t.broken : '';
                } else if (status === 'pending') {
                    // Not yet mirrored: distinguish the item currently downloading and
                    // any run-level give-up that has not been written to a broken flag.
                    if (sp === current) status = 'syncing';
                    else if (fs.failures && fs.failures[sp]) { status = 'failed'; reason = fs.failures[sp]; }
                }
                out.push({
                    storagePath: sp,
                    name: comps[i].name || sp,
                    category: comps[i].category || '',
                    status: status,
                    advisory: advisory, // 'restash' = complete but footage missing (muted note, not red)
                    bytes: t && t.bytes ? t.bytes : 0,
                    thumb: !!(t && (t.complete || t.thumbComplete)),
                    reason: reason,
                    brokenKind: t && t.brokenKind ? t.brokenKind : ''
                });
            }
            return out;
        },

        /**
         * Mark a template broken (e.g. import-time relink failure surfaced missing
         * footage). The kind drives classification everywhere:
         *   'source'    — genuine re-stash needed (missing .aep / footage). DEFAULT.
         *   'transient' — retryable network give-up (shows "Retry", not "Re-stash").
         *   'empty'     — terminal: the cloud folder has no downloadable content.
         * NEVER call this for a thumbnail-render failure — that is cosmetic and tracked
         * separately (main.js _markThumbFailed); it must not touch sync state.
         */
        markBroken: function (storagePath, reason, kind) {
            if (!storagePath) return;
            var state = _loadState();
            if (!state.templates) state.templates = {};
            var t = state.templates[storagePath] || {};
            t.broken = reason || 'needs re-stash';
            t.brokenKind = kind || 'source';
            t.brokenTs = Date.now();
            state.templates[storagePath] = t;
            _saveState(state);
        },

        /** Clear a broken flag (after a re-stash) so the template syncs again. */
        clearBroken: function (storagePath) {
            var state = _loadState();
            if (state.templates && state.templates[storagePath]) {
                delete state.templates[storagePath].broken;
                delete state.templates[storagePath].brokenTs;
                _saveState(state);
            }
        },

        /**
         * Clear every TRANSIENT give-up (network timeouts that exhausted retries) so an
         * explicit user Resume/Sync retries them NOW instead of waiting out the 30-min
         * cooldown. Genuine source/footage-missing breaks (brokenKind !== 'transient')
         * are left intact — those really do need a re-stash. Returns the count cleared.
         */
        retryTransient: function () {
            var state = _loadState();
            var tpls = state.templates || {};
            var cleared = 0;
            var keys = Object.keys(tpls);
            for (var i = 0; i < keys.length; i++) {
                var t = tpls[keys[i]];
                if (t && t.broken && t.brokenKind === 'transient') {
                    delete t.broken;
                    delete t.brokenTs;
                    delete t.brokenKind;
                    t.failCount = 0;
                    cleared++;
                }
            }
            // Also drop the run-level transient failure records so _pendingFor requeues.
            if (state.fullSync && state.fullSync.failures) state.fullSync.failures = {};
            if (cleared || (state.fullSync && state.fullSync.failures)) _saveState(state);
            return cleared;
        },

        /**
         * Clear EVERY retryable broken flag (transient give-ups + source/undefined
         * re-stash markers) so an explicit user Sync/Resume re-attempts them all now.
         * TERMINAL 'empty' folders are left intact — no .aep will ever exist, retrying
         * only churns. Wire this ONLY to an explicit user Sync/Resume click, never to
         * an automatic tick. Returns the count cleared.
         */
        retryBroken: function () {
            var state = _loadState();
            var tpls = state.templates || {};
            var cleared = 0;
            var keys = Object.keys(tpls);
            for (var i = 0; i < keys.length; i++) {
                var t = tpls[keys[i]];
                if (t && t.broken && t.brokenKind !== 'empty') {
                    delete t.broken;
                    delete t.brokenTs;
                    delete t.brokenKind;
                    t.failCount = 0;
                    cleared++;
                }
            }
            if (state.fullSync && state.fullSync.failures) state.fullSync.failures = {};
            if (cleared || (state.fullSync && state.fullSync.failures)) _saveState(state);
            return cleared;
        },

        /**
         * Resolve the local mirror directory for a storagePath (library root +
         * "/Category/Folder"). Returns '' if no library path is configured. Used by
         * the import flow to write a freshly-downloaded bundle straight into the
         * PERSISTENT mirror instead of a temp dir that later gets deleted (deleting
         * a temp bundle broke by-path footage references and popped AE's native
         * "missing files" modal seconds after import).
         */
        getTemplateMirrorDir: function (storagePath) {
            return _localPath(storagePath);
        },

        /** Ensure the mirror directory tree exists for a storagePath; resolves the dir. */
        ensureTemplateMirrorDir: function (storagePath) {
            var libPath = _getLibraryPath();
            if (!libPath) return Promise.reject(new Error('Library path not configured'));
            return _ensureLibraryRoot().then(function () {
                return _ensureDirs(libPath, storagePath);
            }).then(function () {
                return _localPath(storagePath);
            });
        },

        /**
         * After an import bundle (AEP + footage) has been written into the local
         * mirror dir, mark the template complete so the NEXT import takes the instant
         * local fast-path and the synced counter reflects it. Verifies the .aep landed
         * non-empty first. Merges into any existing entry so a prior thumbComplete is
         * preserved. Resolves true if marked complete.
         */
        markTemplateComplete: function (storagePath, aepFsPath, contentVersion) {
            if (!storagePath || !aepFsPath) return Promise.resolve(false);
            function _mark() {
                var state = _loadState();
                if (!state.templates) state.templates = {};
                var prev = state.templates[storagePath] || {};
                prev.ts = Date.now();
                prev.complete = true;
                prev.contentVersion = contentVersion || '';
                state.templates[storagePath] = prev;
                _saveState(state);
                return true;
            }
            var safe = aepFsPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return _callExtendScript('blitzLocalExists("' + safe + '")').then(function (st) {
                var ok = !!(st && st.exists && st.size > 0);
                if (!ok) return false;
                return _mark();
            }, function () {
                // Verify CALL errored transiently; the write already succeeded, so
                // trust the .aep presence and mark complete (best-effort size gate).
                return _mark();
            });
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
