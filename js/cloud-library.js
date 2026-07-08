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
    // Soft-delete lives here. Deleted templates are MOVED under trash/ (never
    // hard-removed) so an admin can recover them. Excluded from library listing.
    var TRASH_PREFIX = 'trash';
    // Monotonic per-session token appended to every trash folder name. Date.now()
    // alone collides when a bulk delete (CONCURRENCY 10) trashes two templates that
    // share a leaf folder name (e.g. Backgrounds/Intro + Titles/Intro) in the same
    // millisecond: both would land in trash/<ms>_Intro, commingling files and losing
    // one on recover. Incrementing this synchronously (no await between read+bump)
    // guarantees a unique destination per delete.
    var _trashSeq = 0;

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

    // In-memory signed URL cache — avoids re-signing thumbnails/previews as users
    // scroll and hover. Metadata loads never wait for every thumbnail to sign.
    // Cache TTL is set to (signed URL expiry - 10 minute safety margin) so we
    // never serve a near-expired URL but also don't waste round-trips re-signing
    // every 30 minutes when the URLs are still valid for hours.
    var SIGNED_URL_CACHE_TTL = (SIGNED_URL_EXPIRY - 600) * 1000; // 4h - 10min in ms
    var _signedPathUrlCache = {};
    var _previewUrlCache = {};
    var _previewPathCache = {};

    // ── Wave 2B: persist the signed-URL cache across panel reloads ──────────
    // Signed URLs stay valid for hours; without persistence every reload re-signs
    // every thumbnail (the "thumbnails reload every launch" complaint). We mirror
    // the in-memory cache to localStorage (capped + expiry-pruned) and rehydrate
    // on load so a reload within TTL reuses the still-valid URLs.
    var SIGNED_URL_PERSIST_KEY = 'blitzkrieg_signed_urls';
    var SIGNED_URL_PERSIST_MAX = 1500; // cap entries to stay well under quota
    var _persistSignedTimer = null;

    function _rehydrateSignedUrlCache() {
        try {
            var raw = localStorage.getItem(SIGNED_URL_PERSIST_KEY);
            if (!raw) return;
            var obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object') return;
            var now = Date.now();
            var keys = Object.keys(obj);
            for (var i = 0; i < keys.length; i++) {
                var e = obj[keys[i]];
                if (e && e.url && e.ts && (now - e.ts < SIGNED_URL_CACHE_TTL)) {
                    _signedPathUrlCache[keys[i]] = { ts: e.ts, url: e.url };
                }
            }
        } catch (e) { /* corrupt — ignore */ }
    }

    // Build the pruned + capped persist payload (most-recent first, expired dropped).
    // Shared by the debounced localStorage/file write and the synchronous quit-flush.
    function _buildSignedUrlPersistPayload() {
        var now = Date.now();
        var keys = Object.keys(_signedPathUrlCache);
        keys.sort(function (a, b) {
            return (_signedPathUrlCache[b].ts || 0) - (_signedPathUrlCache[a].ts || 0);
        });
        var out = {};
        var kept = 0;
        for (var i = 0; i < keys.length && kept < SIGNED_URL_PERSIST_MAX; i++) {
            var e = _signedPathUrlCache[keys[i]];
            if (e && e.url && e.ts && (now - e.ts < SIGNED_URL_CACHE_TTL)) {
                out[keys[i]] = { ts: e.ts, url: e.url };
                kept++;
            }
        }
        return out;
    }

    function _persistSignedUrlCache() {
        // Debounced: coalesces a burst of signing into one write.
        if (_persistSignedTimer) return;
        _persistSignedTimer = setTimeout(function () {
            _persistSignedTimer = null;
            try {
                var json = JSON.stringify(_buildSignedUrlPersistPayload());
                try { localStorage.setItem(SIGNED_URL_PERSIST_KEY, json); } catch (e) { /* quota */ }
                // Durable file backstop. localStorage is wiped by the same AE quit that
                // dropped the meta cache, so without this the thumbnail re-sign wave
                // fires on every launch. Mirror to the jsx-file store (sibling of the
                // meta cache); the beforeunload flush covers quit-inside-debounce.
                if (window.blitzSignedUrlStore && window.blitzSignedUrlStore.save) {
                    try { window.blitzSignedUrlStore.save(json); } catch (e) {}
                }
            } catch (e) { /* serialize, non-fatal */ }
        }, 500);
    }

    // Flush the signed-URL cache to its file SYNCHRONOUSLY on beforeunload (CEP kills
    // async work on quit; the 500ms debounce above can otherwise drop the write).
    // Mirrors flushMetaCacheSync. Rebuilds the payload fresh so it is always current.
    function flushSignedUrlCacheSync() {
        if (Object.keys(_signedPathUrlCache).length === 0) return;
        if (_persistSignedTimer) { clearTimeout(_persistSignedTimer); _persistSignedTimer = null; }
        try {
            if (window.blitzSignedUrlStore && window.blitzSignedUrlStore.saveSync) {
                window.blitzSignedUrlStore.saveSync(JSON.stringify(_buildSignedUrlPersistPayload()));
            }
        } catch (e) {}
    }

    function _clearPersistedSignedUrls() {
        if (_persistSignedTimer) { clearTimeout(_persistSignedTimer); _persistSignedTimer = null; }
        try { localStorage.removeItem(SIGNED_URL_PERSIST_KEY); } catch (e) {}
        if (window.blitzSignedUrlStore && window.blitzSignedUrlStore.clear) {
            try { window.blitzSignedUrlStore.clear(); } catch (e) {}
        }
    }

    // Cold-launch backstop: if localStorage was wiped across the AE quit, pull the
    // still-valid signed URLs back from the jsx file BEFORE the grid's first paint so
    // buildCompsFromMetadata sets a real thumbUrl and the ~376-thumbnail re-sign wave
    // never fires. Timeout-bounded (2.5s) like the meta rehydrate so a wedged host
    // cannot stall launch; runs concurrently with it (see _ensureMetaRehydrated).
    function _rehydrateSignedUrlCacheFromFile() {
        // localStorage already rehydrated at module load? Then nothing was lost; skip
        // the host round-trip entirely.
        if (Object.keys(_signedPathUrlCache).length > 0) return Promise.resolve();
        if (!window.blitzSignedUrlStore || !window.blitzSignedUrlStore.load) return Promise.resolve();
        var _raceLoad = new Promise(function (resolve) {
            var settled = false;
            var timer = setTimeout(function () { if (!settled) { settled = true; resolve('{}'); } }, 2500);
            window.blitzSignedUrlStore.load().then(function (r) {
                if (!settled) { settled = true; clearTimeout(timer); resolve(r); }
            }, function () {
                if (!settled) { settled = true; clearTimeout(timer); resolve('{}'); }
            });
        });
        return _raceLoad.then(function (raw) {
            if (!raw || raw === '{}') return;
            var obj;
            try { obj = JSON.parse(raw); } catch (e) { return; }
            if (!obj || typeof obj !== 'object') return;
            var now = Date.now();
            var keys = Object.keys(obj);
            var filled = 0;
            for (var i = 0; i < keys.length; i++) {
                var e = obj[keys[i]];
                // Drop expired URLs: a stale signed URL renders a broken image, worse
                // than an empty cache (which just re-signs). Same window as localStorage.
                if (e && e.url && e.ts && (now - e.ts < SIGNED_URL_CACHE_TTL) && !_signedPathUrlCache[keys[i]]) {
                    _signedPathUrlCache[keys[i]] = { ts: e.ts, url: e.url };
                    filled++;
                }
            }
            if (filled > 0) {
                _persistSignedUrlCache(); // promote back into localStorage for the session
                _log('signed-url cache rehydrated from file (' + filled + ' urls), localStorage was empty on launch', 'info');
            }
        });
    }

    _rehydrateSignedUrlCache();

    // localStorage cache for template metadata (persists across restarts)
    var META_CACHE_KEY = 'blitzkrieg_meta_cache';
    // Bump when cache schema changes or naming fixes require fresh data.
    // Stale cache with lower version is rejected — forces slow-path reload.
    // v3: adds storage-truth thumbnail enrichment (hasCompPng / cloudPreviewFrameCount
    // reconciled from storage.objects) so the pre-enrichment local cache, which
    // wrongly flags ~110 comps as missing thumbnails, is discarded once on upgrade.
    var CACHE_VERSION = 3;

    // ── File-backed backstop for the meta cache ────────────────────────────
    // getCachedMetadata has no TTL, so if localStorage survived an AE restart the
    // grid would load instantly. The "all comps reload on every launch" complaint
    // means localStorage is NOT surviving the quit (the auth session hit the same
    // wall — see createPersistentAuthStorage). The signed-URL cache already has a
    // localStorage persist layer, but that is wiped by the same event; the meta
    // cache had no durable copy at all, so it is the load-bearing gap. We mirror
    // the meta cache to a jsx-written file (via window.blitzMetaCacheStore, set up
    // in main.js) and promote it back into localStorage on the next launch. The
    // file is cleared everywhere the localStorage copy is, so an invalidated cache
    // never resurrects from disk.
    var _metaRehydratePromise = null;
    var _persistMetaTimer = null;
    var _pendingMetaPayload = null;  // last payload whose debounced write is still queued

    function _persistMetaCacheToFile(payload) {
        if (!window.blitzMetaCacheStore || !window.blitzMetaCacheStore.save) return;
        // Debounced (250ms) so a burst of cache writes coalesces into one file
        // write, but short enough that the quit-survival window is tiny.
        // flushMetaCacheSync() below covers the remaining case (AE quit before the
        // timer fires).
        _pendingMetaPayload = payload;
        if (_persistMetaTimer) clearTimeout(_persistMetaTimer);
        _persistMetaTimer = setTimeout(function () {
            _persistMetaTimer = null;
            var p = _pendingMetaPayload;
            _pendingMetaPayload = null;
            try { window.blitzMetaCacheStore.save(p); } catch (e) {}
        }, 250);
    }

    // Flush a still-queued debounced write SYNCHRONOUSLY. CEP kills async work on
    // beforeunload (telemetry uses a sync XHR on close for the same reason), so the
    // async jsx save can be dropped if the user quits AE inside the debounce window
    // — exactly the reload-every-launch case this fix targets. saveSync uses cep.fs
    // (synchronous) to guarantee the write lands. No pending payload => no-op.
    function flushMetaCacheSync() {
        if (!_pendingMetaPayload) return;
        var p = _pendingMetaPayload;
        _pendingMetaPayload = null;
        if (_persistMetaTimer) { clearTimeout(_persistMetaTimer); _persistMetaTimer = null; }
        try {
            if (window.blitzMetaCacheStore && window.blitzMetaCacheStore.saveSync) {
                window.blitzMetaCacheStore.saveSync(p);
            }
        } catch (e) {}
    }

    function _clearMetaCacheFile() {
        _pendingMetaPayload = null;
        if (_persistMetaTimer) { clearTimeout(_persistMetaTimer); _persistMetaTimer = null; }
        try {
            if (window.blitzMetaCacheStore && window.blitzMetaCacheStore.clear) {
                window.blitzMetaCacheStore.clear();
            }
        } catch (e) {}
    }

    function _rehydrateMetaCacheFromFile() {
        // If localStorage already holds a valid current-version cache, the file
        // isn't needed — leave the fast path alone.
        try {
            var existing = localStorage.getItem(META_CACHE_KEY);
            if (existing) {
                var p = JSON.parse(existing);
                if (p && p._v === CACHE_VERSION && p.folders && p.folders.length > 0) {
                    return Promise.resolve();
                }
            }
        } catch (e) { /* fall through to file */ }
        if (!window.blitzMetaCacheStore || !window.blitzMetaCacheStore.load) return Promise.resolve();
        // Bound the host round-trip. load() -> safeEvalScript('loadBlitzkriegMetaCache()')
        // only calls back when AE's ExtendScript engine is free; at cold launch the host
        // can be busy opening a heavy project (the exact case this cache targets), so an
        // unbounded await here would stall the grid's first paint. Race a 2.5s timeout:
        // if the file read is slow, fall through to the normal cloud load (pre-fix
        // behavior) instead of blocking. The background refresh re-warms the cache next.
        var _loadWithTimeout = new Promise(function (resolve) {
            var settled = false;
            var timer = setTimeout(function () { if (!settled) { settled = true; resolve('{}'); } }, 2500);
            window.blitzMetaCacheStore.load().then(function (r) {
                if (!settled) { settled = true; clearTimeout(timer); resolve(r); }
            }, function () {
                if (!settled) { settled = true; clearTimeout(timer); resolve('{}'); }
            });
        });
        return _loadWithTimeout.then(function (raw) {
            if (!raw || raw === '{}') return;
            var parsed;
            try { parsed = JSON.parse(raw); } catch (e) { return; }
            if (!parsed || parsed._v !== CACHE_VERSION || !parsed.folders || !parsed.folders.length) return;
            try {
                localStorage.setItem(META_CACHE_KEY, raw);
                _log('meta cache rehydrated from file (' + parsed.folders.length + ' entries), localStorage was empty on launch', 'info');
            } catch (e) {}
        });
    }

    // Run once, lazily, on the first listTemplates(). Lazy (not at module load)
    // because cloud-library.js loads BEFORE main.js, so window.blitzMetaCacheStore
    // isn't defined yet at module-eval time.
    function _ensureMetaRehydrated() {
        if (!_metaRehydratePromise) {
            // Fire the meta-cache AND signed-URL file rehydrations CONCURRENTLY. Each is
            // individually 2.5s-timeout-bounded, so firing them together keeps the
            // worst-case cold-launch wait at ~2.5s instead of ~5s from chaining two
            // sequential host round-trips (the exact busy-host launch this all targets).
            _metaRehydratePromise = Promise.all([
                _rehydrateMetaCacheFromFile(),
                _rehydrateSignedUrlCacheFromFile()
            ]);
        }
        return _metaRehydratePromise;
    }

    // Cloud-side manifest file — a single JSON at bucket root containing the
    // metadata for every template. One download instead of 248+. Rebuilt on any
    // mutation (debounced). Subsequent cold loads (new users, cache-cleared
    // users) go from ~5s → <500ms.
    var MANIFEST_KEY = '_blitzkrieg_manifest_v2.json';
    // CACHE-3: manifest schema version this client understands. A manifest with a
    // HIGHER version was written by a newer panel build and may have a shape this
    // build cannot read correctly, so we ignore it and rebuild via the slow path.
    // v2: manifest entries now carry storage-truth thumbnail enrichment (hasCompPng /
    // cloudPreviewFrameCount reconciled from storage.objects). A v1 manifest lacks it
    // and would keep every editor showing the false "missing thumbnail" state, so a v1
    // manifest is treated as absent (rejected below) and rebuilt+republished as v2 once.
    var MANIFEST_VERSION = 2;
    // 5 min TTL — was 30 min, but submissions approved by admins or templates
    // added outside the panel (Supabase dashboard, scripts) don't always trigger
    // invalidateManifest(), so users could see a stale list for up to 30 min.
    // Shorter TTL bounds drift without giving up the cold-load speedup.
    // Stale manifests are still served (stale-while-revalidate) — the TTL only
    // controls whether the caller treats the manifest as "fresh enough to skip
    // background refresh" vs "use this immediately + refresh in the background".
    // Full bucket scans are expensive once the library has hundreds of
    // templates. Trust the manifest for an hour; admin mutations publish a
    // fresh manifest immediately, and "Regenerate/Refresh" still forces a scan.
    var MANIFEST_TTL_MS = 60 * 60 * 1000;
    // Rescue old poisoned local caches like the 30-template John/Usama-only
    // cache that happened when category listing timed out. A single manifest
    // download is cheap and prevents editors from seeing a visibly partial grid.
    var CACHE_UNDERCOUNT_RESCUE_THRESHOLD = 200;

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
    // If Supabase times out on one category, do not retry a full bucket scan on
    // every focus/reload. The visible library keeps stale entries for the failed
    // category, and a manual Refresh Library can still retry immediately.
    var PARTIAL_REFRESH_BACKOFF_MS = 15 * 60 * 1000;

    // Diagnostic state — populated by listTemplates() at each tier exit so
    // getDiagnostics() can report what actually happened on the last load.
    var _lastLoad = { ts: 0, source: null, durationMs: 0, count: 0, partial: false, failedCategories: [] };

    // Coalesces concurrent background refreshes (Tier 1 fast-path can fire
    // multiple refreshes within seconds when focus events stack up — alt-tab
    // away and back, panel re-shows, etc.).
    var _bgRefreshInFlight = false;

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

    // Fast child-folder listing via the blitzkrieg_list_folders RPC (index-only
    // scan, ~70ms) instead of Storage list() -> storage.search(), which does a
    // grouped full scan of EVERY nested object under the prefix and times out at
    // the DB level on the largest category (Pre-comps: ~2200 objects / 99
    // folders) even at a 60s client timeout. Returns items shaped like Storage
    // list() folder entries ({name, id:null}) so every caller that filters on
    // `item.id === null` works unchanged. Throws on error (missing function on an
    // older DB, RLS, timeout) so the caller falls back to the Storage list()
    // retry ladder and behaviour degrades gracefully rather than breaking.
    function _listFoldersViaRpc(catName, timeoutMs) {
        timeoutMs = timeoutMs || 15000;
        var rpcPromise = sb.rpc('blitzkrieg_list_folders', { _category: catName });
        var timeoutPromise = new Promise(function (_, reject) {
            setTimeout(function () {
                reject(new Error('RPC folder-list timed out after ' + timeoutMs + 'ms'));
            }, timeoutMs);
        });
        return Promise.race([rpcPromise, timeoutPromise]).then(function (res) {
            if (!res || res.error) {
                throw new Error('blitzkrieg_list_folders("' + catName + '") failed: ' + ((res && res.error && res.error.message) || 'unknown'));
            }
            var rows = res.data || [];
            var out = [];
            for (var i = 0; i < rows.length; i++) {
                var nm = rows[i] && rows[i].name;
                if (nm) out.push({ name: nm, id: null });
            }
            return out;
        });
    }

    // Storage-truth for thumbnail/preview state via the blitzkrieg_thumbnail_status
    // RPC (one index-only aggregate over storage.objects). Returns a map keyed
    // "category/folder" -> {has_png, preview_frame_count}, or null on ANY error so
    // enrichment degrades to today's metadata-only behaviour and never throws. This
    // is how the read path learns that a bulk-imported comp already HAS a comp.png in
    // storage even when its metadata.json (written before the hasCompPng flag) says it
    // does not, so the panel stops offering to regenerate 100+ comps that already
    // exist (the mass regenerate that crashes AE 2026).
    function _fetchThumbnailStatus() {
        var rpcPromise = sb.rpc('blitzkrieg_thumbnail_status');
        var timeoutPromise = new Promise(function (_, reject) {
            setTimeout(function () {
                reject(new Error('blitzkrieg_thumbnail_status timed out'));
            }, 15000);
        });
        return Promise.race([rpcPromise, timeoutPromise]).then(function (res) {
            if (!res || res.error || !res.data) return null;
            var rows = res.data;
            var map = {};
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                if (!r || !r.category || !r.folder) continue;
                map[r.category + '/' + r.folder] = {
                    has_png: !!r.has_png,
                    preview_frame_count: r.preview_frame_count || 0
                };
            }
            return map;
        }).then(null, function () { return null; });
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
            // CACHE-3: a manifest from a newer schema than this client supports is
            // ignored (forward-compat) so we never mis-render an unknown shape; the
            // slow path rebuilds from storage instead.
            if (manifest.version && manifest.version > MANIFEST_VERSION) {
                _log('fetchManifest: manifest version ' + manifest.version + ' > supported ' + MANIFEST_VERSION + '; ignoring, slow path will rebuild', 'warn');
                return null;
            }
            // An OLDER manifest predates a schema/enrichment change (e.g. v1 lacks the
            // storage-truth hasCompPng/cloudPreviewFrameCount fields, so it would keep
            // every editor showing the false "missing thumbnail" state). Treat it as
            // absent so the slow path rebuilds it WITH enrichment and republishes at the
            // current version. Missing version === treated as 1 (pre-versioning).
            if ((manifest.version || 1) < MANIFEST_VERSION) {
                _log('fetchManifest: manifest version ' + (manifest.version || 1) + ' < supported ' + MANIFEST_VERSION + '; ignoring, slow path will rebuild + republish', 'warn');
                return null;
            }
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
            if (cleanResults.length === 0) {
                _log('uploadManifest: refusing to publish empty manifest; keeping last known cloud manifest intact', 'warn');
                return;
            }
            var manifest = {
                version: MANIFEST_VERSION,
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
            var parsed = JSON.parse(raw);
            // Reject cache from older code versions — forces fresh manifest load
            // after naming fixes that would leave stale garbage in the cache.
            if (parsed._v !== CACHE_VERSION) {
                _log('getCachedMetadata: rejecting v' + (parsed._v || 0) + ' cache (current v' + CACHE_VERSION + ') — forcing fresh load', 'info');
                try { localStorage.removeItem(META_CACHE_KEY); } catch (e) {}
                _clearMetaCacheFile();
                return null;
            }
            return parsed;
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
            var obj = { _v: CACHE_VERSION, ts: Date.now(), folders: metadataResults };
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
        // Mirror to the durable file so the next launch survives a localStorage wipe.
        _persistMetaCacheToFile(payload);
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
        _clearMetaCacheFile();
        _signedPathUrlCache = {};
        _previewUrlCache = {};
        _previewPathCache = {};
        _clearPersistedSignedUrls();
        invalidateManifest();
    }

    /**
     * Clear only this panel's local caches. Does not delete the shared cloud
     * manifest, because that manifest is the fast source of truth for all
     * editors and should only be invalidated after real storage mutations.
     */
    function clearLocalCache() {
        try { localStorage.removeItem(META_CACHE_KEY); } catch (e) {}
        _clearMetaCacheFile();
        _signedPathUrlCache = {};
        _previewUrlCache = {};
        _previewPathCache = {};
        _clearPersistedSignedUrls();
    }

    /**
     * Surgical cache invalidation for one template. Keeps unrelated signed URLs
     * warm while still forcing metadata/manifest refresh after mutations.
     */
    function invalidateCacheForPath(storagePath) {
        try { localStorage.removeItem(META_CACHE_KEY); } catch (e) {}
        _clearMetaCacheFile();
        if (storagePath) {
            delete _signedPathUrlCache[storagePath + '/comp.png'];
            delete _signedPathUrlCache[storagePath + '/thumbnail.png'];
            Object.keys(_previewUrlCache).forEach(function(key) {
                if (key.indexOf(storagePath + '|') === 0) delete _previewUrlCache[key];
            });
            Object.keys(_previewPathCache).forEach(function(key) {
                if (key.indexOf(storagePath + '|') === 0) delete _previewPathCache[key];
            });
            _persistSignedUrlCache();   // re-write the persisted copy without the dropped keys
        }
        invalidateManifest();
    }

    function getCachedSignedUrl(path) {
        var cached = _signedPathUrlCache[path];
        if (!cached) return '';
        if (Date.now() - cached.ts >= SIGNED_URL_CACHE_TTL) {
            delete _signedPathUrlCache[path];
            return '';
        }
        return cached.url || '';
    }

    // Guard so a permanently garbage-named template (bad data in storage, not a
    // stale-cache artifact) can clear the cache AT MOST ONCE per session instead
    // of on every single load. Without this, 4 visible templates whose folder
    // names are pure timestamps wiped the metadata cache on every load (633 wipes
    // in 21 days), forcing a full 378-file rescan each time = a major slowdown.
    var _garbageCacheClearedThisSession = false;

    /**
     * Build comp objects from metadata results.
     * Thumbnail and preview URLs are signed lazily by the UI.
     */
    async function buildCompsFromMetadata(metadataResults) {
        var validEntries = metadataResults.filter(function(mr) { return mr.metadata !== null && mr.metadata !== undefined; });
        _log('buildCompsFromMetadata: ' + validEntries.length + ' entries with metadata (of ' + metadataResults.length + ' total)', 'info');

        // Build comp objects
        var allComps = [];
        var staleCacheCount = 0;
        metadataResults.forEach(function (mr) {
            if (!mr.metadata) return;
            var meta = mr.metadata;

            // Derive a clean display name from the folder name first.
            // Only use it if it passes quality checks (no timestamps, not a bare
            // number, no #/@ prefix, at least 3 chars). Falls through to
            // metadata.displayName (also quality-checked) then 'Untitled'.
            var derived = deriveDisplayName(mr.folderName);
            var hasTimestamp = /\d{10,}/.test(derived);
            var isJustNumber = /^\d+$/.test(derived);
            var isHashPrefixed = /^[#@]/.test(derived);
            var isTooShort = derived.length < 3;
            var cleanDerived = (derived && !hasTimestamp && !isJustNumber && !isHashPrefixed && !isTooShort);
            // Sanitize the metadata fallback too — stale cache can have raw numbers
            var metaName = meta.displayName || meta.name || '';
            var metaHasTimestamp = /\d{10,}/.test(metaName);
            var metaIsJustNumber = /^\d+$/.test(metaName.trim());
            var metaIsHashPrefixed = /^[#@]/.test(metaName);
            var metaIsTooShort = metaName.trim().length < 3;
            var cleanMeta = (metaName && !metaHasTimestamp && !metaIsJustNumber && !metaIsHashPrefixed && !metaIsTooShort);
            var displayName = (cleanDerived ? derived : '')
                || (cleanMeta ? metaName : '')
                || deriveDisplayName(mr.folderName) || mr.folderName.replace(/-/g, ' ').trim() || 'Untitled';
            if (typeof displayName !== 'string') displayName = String(displayName);
            // Final safety gate: if ALL sources produced garbage (bare number,
            // #/@ prefix, timestamp, too short), fall back to Untitled.
            // This catches stale-cache entries where every level fails quality checks.
            if (displayName !== 'Untitled') {
                var finalHasTs = /\d{10,}/.test(displayName);
                var finalIsNum = /^\d+$/.test(displayName.trim());
                var finalIsHash = /^[#@]/.test(displayName);
                var finalShort = displayName.trim().length < 3;
                if (finalHasTs || finalIsNum || finalIsHash || finalShort) {
                    displayName = 'Untitled';
                    staleCacheCount++;
                    _log('buildCompsFromMetadata: all sources bad for ' + mr.folderName + ' — using Untitled', 'warn');
                }
            }

            var parts = mr.folderName.split('_');
            var uniqueId = parts.length > 1 ? parts[parts.length - 1] : mr.folderName;
            var storagePath = mr.categoryName + '/' + mr.folderName;
            var thumbPath = storagePath + '/comp.png';
            var thumbPathAlt = storagePath + '/thumbnail.png';
            var cachedPrimaryThumb = getCachedSignedUrl(thumbPath);
            var cachedAltThumb = getCachedSignedUrl(thumbPathAlt);
            var thumbUrl = cachedPrimaryThumb || cachedAltThumb;
            var thumbUrlAlt = cachedPrimaryThumb ? cachedAltThumb : cachedPrimaryThumb;

            var previewFrameCount = 0;
            if (typeof meta.previewFrames === 'number') previewFrameCount = meta.previewFrames;
            if (meta.cloudPreviewFrameCount) previewFrameCount = Math.max(previewFrameCount, meta.cloudPreviewFrameCount);

            // A template's thumbnail is "verified" if we have evidence it exists:
            //  - hasCompPng: a comp.png was uploaded at stash time (written into
            //    metadata.json by the upload path; backfilled for legacy folders)
            //  - cloudThumbnailGenerated: produced via the in-panel generate flow
            //  - previewFrameCount > 0: animated preview frames imply a thumbnail too
            // Bulk-imported templates have a real comp.png but never went through
            // generation, so WITHOUT hasCompPng they were mislabeled "missing
            // thumbnail" — inflating the admin count, spawning phantom Generate
            // buttons, and skipping the local disk cache. Never infer from thumbUrl
            // (createSignedUrls signs even non-existent files).
            var thumbnailVerified = !!(meta.hasCompPng || meta.cloudThumbnailGenerated || previewFrameCount > 0);

            var categories = (mr.metadata && mr.metadata.categories) || [mr.categoryName];

            // Content fingerprint for local-cache staleness (Wave 2B). Folds in the
            // metadata stash/regen timestamp plus the comp's shape (frame count /
            // thumbnail flag / duration / dimensions / frame rate). Sync All compares
            // this against the version stored at sync time to decide whether to re-pull.
            // LIMITATION (data-layer, deferred): an OUT-OF-BAND .aep/footage swap that
            // rewrites the stored files WITHOUT changing metadata.json (e.g. a raw
            // re-upload via the Supabase dashboard that keeps identical duration /
            // dimensions / frame rate / preview count) is NOT detected and needs a
            // manual Refresh. Folding a server etag/size into metadata at stash time
            // would close this; tracked with the storage remediation pass.
            var contentVersion = [
                (meta.updatedAt || meta.created || 0),
                previewFrameCount,
                (meta.cloudThumbnailGenerated ? 1 : 0),
                (meta.duration || 0),
                (meta.width || 0) + 'x' + (meta.height || 0),
                (meta.frameRate || 0)
            ].join('.');

            allComps.push({
                name: displayName,
                category: mr.categoryName,
                categories: categories,
                uniqueId: uniqueId,
                folderName: mr.folderName,
                thumbUrl: thumbUrl,
                thumbUrlAlt: thumbUrlAlt,
                thumbPath: thumbPath,
                thumbPathAlt: thumbPathAlt,
                duration: meta.duration || 0,
                width: meta.width || 0,
                height: meta.height || 0,
                frameRate: meta.frameRate || 0,
                previewFrames: null,  // Signed lazily on hover
                previewFrameCount: previewFrameCount,
                thumbnailVerified: thumbnailVerified,
                // hasAep defaults TRUE when the flag is absent: legacy tiles predate
                // the flag and are overwhelmingly healthy, so a default-false would
                // mislabel ~370 good templates "needs repair". Only an explicit
                // hasAep:false (written by the backfill onto folders that truly have
                // no .aep, or by a future upload path) gates the tile.
                hasAep: (meta.hasAep !== false),
                storagePath: storagePath,
                contentVersion: contentVersion,
            });
        });

        // If stale cache produced garbage names, clear it ONCE so the next load
        // pulls fresh manifest data. Capped per session: if the garbage is
        // permanent (genuinely bad folder names in storage, not a stale-cache
        // artifact), a fresh pull produces the same garbage, so clearing every
        // load just loops a full rescan forever. One clear recovers a real stale
        // cache; the per-session guard prevents the rescan loop.
        if (staleCacheCount > 0 && !_garbageCacheClearedThisSession) {
            _garbageCacheClearedThisSession = true;
            _log('buildCompsFromMetadata: ' + staleCacheCount + ' entries had garbage names - clearing stale cache once this session', 'warn');
            clearLocalCache();
        } else if (staleCacheCount > 0) {
            _log('buildCompsFromMetadata: ' + staleCacheCount + ' entries still have garbage names (permanent bad data); cache NOT re-cleared - fix the source names', 'warn');
        }

        return allComps;
    }

    /**
     * Derive a human-readable display name from a template folder name.
     * Folder names follow the pattern "Descriptive-Name_<uniqueId>" where
     * uniqueId is a 10+ digit timestamp. Strips all timestamp suffixes and
     * converts dashes to spaces. Handles rare double-timestamp edge cases
     * like "1-1768564455228_1768564455228".
     * @param {string} folderName
     * @returns {string}
     */
    function deriveDisplayName(folderName) {
        if (!folderName) return '';
        // Strip ALL _<timestamp> and -<timestamp> patterns (handles double-timestamp edge cases)
        var cleaned = folderName.replace(/[_-]\d{10,}/g, '');
        cleaned = cleaned.replace(/[_-]+$/, '');
        // Strip short numeric disambiguation suffix (_1, _2, _3 etc.)
        cleaned = cleaned.replace(/_\d{1,3}$/, '');
        cleaned = cleaned.replace(/[_-]+$/, '');
        // Convert dashes to spaces
        return cleaned.replace(/-/g, ' ').trim();
    }

    function sortPreviewPaths(paths) {
        return paths.sort(function(a, b) {
            var ma = /frame_(\d+)\.png$/i.exec(a);
            var mb = /frame_(\d+)\.png$/i.exec(b);
            var na = ma ? parseInt(ma[1], 10) : 0;
            var nb = mb ? parseInt(mb[1], 10) : 0;
            return na - nb;
        });
    }

    async function getExistingPreviewFramePaths(storagePath, expectedCount) {
        if (!storagePath) return [];
        var cacheKey = storagePath + '|' + (expectedCount || 0);
        if (_previewPathCache[cacheKey]) return _previewPathCache[cacheKey].slice();

        var previewPrefix = storagePath + '/preview';
        try {
            var items = await listAllPaginated(previewPrefix, { sortBy: { column: 'name', order: 'asc' } });
            var paths = [];
            (items || []).forEach(function(item) {
                if (!item || item.id === null || !item.name) return;
                if (/^frame_\d+\.png$/i.test(item.name)) {
                    paths.push(previewPrefix + '/' + item.name);
                }
            });
            paths = sortPreviewPaths(paths);
            if (expectedCount && paths.length < expectedCount) {
                _log('preview mismatch for ' + storagePath + ': metadata says ' + expectedCount + ', storage has ' + paths.length, 'warn');
            }
            _previewPathCache[cacheKey] = paths.slice();
            return paths;
        } catch (e) {
            _log('preview listing failed for ' + storagePath + ': ' + (e && e.message || e), 'warn');
            return [];
        }
    }

    function _dispatchLibraryPartial(detail) {
        detail = detail || {};
        detail.failedCategories = (detail.failedCategories || []).slice();
        _dispatchCustom('blitzkrieg-library-partial', detail);
    }

    // RENDER-1: cap how many preview frames a single hover loads. Signing +
    // downloading + decoding all ~72 full-res frames pulled 100MB+ into the CEP
    // renderer per hover and tripped the memory limit. 12 evenly-spaced frames
    // keep the motion readable while cutting hover cost ~5-6x.
    var MAX_HOVER_PREVIEW_FRAMES = 12;

    /**
     * Sign preview frame URLs on demand (called on hover).
     * Returns signed URLs for preview frames that actually exist in storage.
     */
    async function signPreviewFrames(storagePath, frameCount) {
        if (!storagePath || !frameCount || frameCount <= 0) return [];
        var cacheKey = storagePath + '|' + frameCount;
        var cached = _previewUrlCache[cacheKey];
        if (cached && (Date.now() - cached.ts < SIGNED_URL_CACHE_TTL)) {
            return cached.urls.slice();
        }

        var paths = await getExistingPreviewFramePaths(storagePath, frameCount);
        if (!paths || paths.length === 0) return [];

        // Sample down to MAX_HOVER_PREVIEW_FRAMES evenly across the sequence so a
        // hover never floods memory with the full frame set.
        if (paths.length > MAX_HOVER_PREVIEW_FRAMES) {
            var sampled = [];
            var step = paths.length / MAX_HOVER_PREVIEW_FRAMES;
            for (var s = 0; s < MAX_HOVER_PREVIEW_FRAMES; s++) {
                sampled.push(paths[Math.floor(s * step)]);
            }
            paths = sampled;
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
        _previewUrlCache[cacheKey] = { ts: Date.now(), urls: signed.slice() };
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
        var maxPages = 1000; // Safety cap: up to 1,000,000 items at PAGE=1000
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
        if (page >= maxPages) {
            _log('Pagination safety cap hit for ' + label + ' at ' + allItems.length + ' items; increase maxPages if this bucket grows beyond 1M objects in one folder.', 'warn');
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

        // Step 1: List all top-level folders (categories) — paginated, with the
        // SAME adaptive-timeout retry (15s/30s/60s) the per-category lists use.
        // Without this the root list was the one unretried list call: a single
        // 15s timeout on a cold load (no cache + no manifest) rejected the whole
        // library with no second attempt. (listCategoryWithRetry is an async
        // function declaration, hoisted to the top of fetchAllMetadata, so it is
        // callable here even though it is defined lower down.)
        _log('fetchAllMetadata: listing root...', 'info');
        var allRootItems = await listCategoryWithRetry('', 3, { column: 'name', order: 'asc' });
        _log('fetchAllMetadata: root has ' + allRootItems.length + ' items (folders + files)', 'info');

        // Log all root item names for debugging
        if (allRootItems.length > 0) {
            var rootNames = allRootItems.map(function(it) {
                return it.name + (it.id === null ? '/' : '');
            });
            var rootPreview = rootNames.slice(0, 40).join(', ');
            if (rootNames.length > 40) rootPreview += ', ... +' + (rootNames.length - 40) + ' more';
            _log('fetchAllMetadata: root contents: [' + rootPreview + ']', 'info');
        } else {
            _log('fetchAllMetadata: bucket root is EMPTY — no categories found', 'warn');
        }

        // Legacy editor-name categories — preserved as backup but excluded from
        // the UI so the panel shows only the 12 animation-type categories.
        var HIDDEN_CATEGORIES = {
            'dominate media': 1, 'john ventura': 1, 'shaz': 1, 'usama ahmad': 1, 'sign': 1
        };
        var categories = allRootItems.filter(function (item) {
            if (item.id !== null) return false;
            if (item.name === 'pending' || item.name === TRASH_PREFIX || item.name === '.emptyFolderPlaceholder' || item.name === MANIFEST_KEY) return false;
            if (HIDDEN_CATEGORIES[item.name.toLowerCase()]) return false;
            return true;
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

        // sortBy is optional — the root list needs name-asc ordering; category
        // lists pass none. Kept as an explicit param (not Object.assign, which is
        // ES6 and absent in CEP 8/9) so both callers share ONE retry ladder.
        async function listCategoryWithRetry(catName, maxAttempts, sortBy) {
            // Real categories (not the root list) get the fast index-only RPC
            // first: it returns just the child folder names in ~70ms and never
            // hits the storage.search() DB timeout that made the largest
            // category (Pre-comps, 99 folders / ~2200 nested objects)
            // permanently unlistable and trapped every cold load in the 3-minute
            // slow path. Root (catName === '') still needs Storage list() because
            // it must also surface files (archives, manifest) and tell folders
            // from files. On any RPC failure we fall through to the Storage
            // list() retry ladder below, so an older DB without the function
            // still works.
            if (catName) {
                try {
                    return await _listFoldersViaRpc(catName);
                } catch (rpcErr) {
                    _log('listCategory "' + catName + '": fast RPC failed (' + (rpcErr && rpcErr.message || rpcErr) + '); falling back to storage.list', 'warn');
                }
            }
            maxAttempts = maxAttempts || 3;
            var attempts = 0;
            var lastErr;
            while (attempts < maxAttempts) {
                var attemptIdx = attempts;
                attempts++;
                var attemptTimeout = LIST_TIMEOUT_BY_ATTEMPT[attemptIdx] || LIST_TIMEOUT_BY_ATTEMPT[LIST_TIMEOUT_BY_ATTEMPT.length - 1];
                try {
                    var listOpts = { _timeoutMs: attemptTimeout };
                    if (sortBy) listOpts.sortBy = sortBy;
                    return await listAllPaginated(catName, listOpts);
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
                    _log('fetchAllMetadata: listing category "' + cat.name + '" failed after retries: ' + (err && err.message || err), 'warn');
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
            if (failedCategoryNames.length > 0) emptyOut._failedCategories = failedCategoryNames.slice();
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
            metadataResults._failedCategories = failedCategoryNames.slice();
            _log('fetchAllMetadata: ' + failedCategoryNames.length + ' categories failed to list: [' + failedCategoryNames.join(', ') + ']. Caller will merge stale cache or skip writes.', 'warn');
        }

        // STORAGE-TRUTH ENRICHMENT. metadata.json is often stale: bulk-imported comps
        // have a real comp.png (and sometimes preview frames) in storage but metadata
        // written before the hasCompPng flag, so thumbnailVerified/previewFrameCount
        // read false and the panel wrongly offers to REGENERATE them (mass import into
        // the live project -> AE 2026 crash). Overlay the REAL per-comp storage state
        // (one indexed RPC) so thumbnailVerified + previewFrameCount reflect reality.
        // Because this mutates metadataResults, the corrected state flows into the comp
        // objects, the localStorage cache, AND the published manifest (all consume this
        // same array). Null result on any error = keep today's metadata-only behaviour.
        try {
            var _statusMap = await _fetchThumbnailStatus();
            if (_statusMap) {
                var _reconciled = 0;
                for (var _ei = 0; _ei < metadataResults.length; _ei++) {
                    var _mr = metadataResults[_ei];
                    if (!_mr || _mr.metadata == null) continue;
                    var _s = _statusMap[_mr.categoryName + '/' + _mr.folderName];
                    if (!_s) continue;
                    if (_s.has_png && !_mr.metadata.hasCompPng) { _mr.metadata.hasCompPng = true; _reconciled++; }
                    var _prevCount = _mr.metadata.cloudPreviewFrameCount || 0;
                    if (_s.preview_frame_count > _prevCount) _mr.metadata.cloudPreviewFrameCount = _s.preview_frame_count;
                }
                _log('fetchAllMetadata: storage-truth enrichment applied (' + _reconciled + ' thumbnails reconciled from storage)', 'success');
            } else {
                _log('fetchAllMetadata: storage-truth enrichment skipped (RPC unavailable) - metadata-only signals', 'info');
            }
        } catch (_enrErr) {
            _log('fetchAllMetadata: storage-truth enrichment error: ' + (_enrErr && _enrErr.message || _enrErr), 'warn');
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

        // Promote the file-backed cache into localStorage if the OS/CEP wiped it
        // across the AE restart. Awaited so Tier 1 sees the rehydrated cache
        // instead of slow-pathing the whole grid on every launch.
        await _ensureMetaRehydrated();

        // ----- Tier 1: localStorage cache -----
        var cache = getCachedMetadata();

        if (cache && cache.folders && cache.folders.length > 0) {
            var cacheLooksPartial =
                (cache.folders.length < CACHE_UNDERCOUNT_RESCUE_THRESHOLD) ||
                (cache.failedCategories && cache.failedCategories.length > 0) ||
                (cache.partialUntilTs && Date.now() < cache.partialUntilTs);
            if (cacheLooksPartial) {
                try {
                    var rescueManifest = await fetchManifest();
                    if (rescueManifest && rescueManifest.folders &&
                        rescueManifest.folders.length > cache.folders.length) {
                        _log('listTemplates: cache rescue — local cache has ' + cache.folders.length +
                             ' entries, manifest has ' + rescueManifest.folders.length + '; using manifest before render', 'warn');
                        setCachedMetadata(rescueManifest.folders);
                        if (rescueManifest.archives) listTemplates._archives = rescueManifest.archives;
                        var rescuedComps = await buildCompsFromMetadata(rescueManifest.folders);
                        _lastLoad = {
                            ts: Date.now(),
                            source: rescueManifest._stale ? 'manifest-rescue-stale' : 'manifest-rescue',
                            durationMs: Date.now() - t0,
                            count: rescuedComps.length,
                            partial: false,
                            failedCategories: []
                        };
                        return rescuedComps;
                    }
                } catch (rescueErr) {
                    _log('listTemplates: cache rescue manifest check failed: ' + (rescueErr && rescueErr.message || rescueErr), 'warn');
                }
            }

            // FAST PATH: Use cached metadata. Media URLs are signed lazily by the UI.
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
            // Also skip if a refresh is already in flight: focus events fire
            // 2-3 times per alt-tab, and without the guard each one kicked
            // off its own fetchManifest + fetchAllMetadata + uploadManifest
            // — last-write-wins on the cache, redundant network.
            if ((ageMs >= BACKGROUND_REFRESH_TTL || hasNulls) && !partialUntilFresh && !_bgRefreshInFlight) {
                _bgRefreshInFlight = true;
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
                            // entries, write back with a partial-grace marker so
                            // the next reload doesn't slow-path again immediately.
                            var merged = _mergePartialFolders(staleFolders, freshMeta, freshMeta._failedCategories);
                            setCachedMetadata(merged, {
                                partialUntilTs: Date.now() + PARTIAL_REFRESH_BACKOFF_MS,
                                failedCategories: freshMeta._failedCategories.slice()
                            });
                            _log('listTemplates: background refresh partial — kept ' + merged.length + ' cached entries, failed cats: [' + freshMeta._failedCategories.join(', ') + ']. Manifest left untouched; retry backed off for ' + Math.round(PARTIAL_REFRESH_BACKOFF_MS / 60000) + 'm.', 'warn');
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
                }).then(function () {
                    _bgRefreshInFlight = false;
                }, function () {
                    _bgRefreshInFlight = false;
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
            // data. Refuse to overwrite on partial fetch. Coalesce with
            // any other in-flight refresh to avoid duplicate slow-path scans.
            if (manifest._stale && !_bgRefreshInFlight) {
                _bgRefreshInFlight = true;
                fetchAllMetadata().then(function (freshMeta) {
                    if (freshMeta && freshMeta._failedCategories && freshMeta._failedCategories.length > 0) {
                        setCachedMetadata(manifest.folders, {
                            partialUntilTs: Date.now() + PARTIAL_REFRESH_BACKOFF_MS,
                            failedCategories: freshMeta._failedCategories.slice()
                        });
                        _log('listTemplates: stale-manifest background refresh partial — kept manifest cache (' + manifest.folders.length + ' entries), failed cats: [' + freshMeta._failedCategories.join(', ') + ']. Manifest left untouched; retry backed off for ' + Math.round(PARTIAL_REFRESH_BACKOFF_MS / 60000) + 'm.', 'warn');
                        return;
                    }
                    setCachedMetadata(freshMeta);
                    uploadManifest(freshMeta, listTemplates._archives || []);
                    _log('listTemplates: stale-manifest background refresh done (' + freshMeta.length + ' entries)', 'info');
                    _maybeNotifyChange(manifest.folders, freshMeta);
                }).catch(function (err) {
                    _log('listTemplates: stale-manifest background refresh failed: ' + (err && err.message || err), 'warn');
                }).then(function () {
                    _bgRefreshInFlight = false;
                }, function () {
                    _bgRefreshInFlight = false;
                });
            }

            return mComps;
        }

        // ----- Tier 3: Full fetchAllMetadata (slow path, worker-pool parallel) -----
        _log('listTemplates: SLOW PATH — no cache, no manifest, full fetch...', 'info');
        var metadataResults = await fetchAllMetadata();

        if (metadataResults && metadataResults._failedCategories && metadataResults._failedCategories.length > 0) {
            // Slow-path partial: there's no stale to merge with (we got here
            // because no cache existed). Write the partial result with a
            // grace marker — the user no longer pays the slow-path cost on
            // every reload while Shaz is timing out. Manifest left untouched
            // to avoid poisoning other editors.
            var cleanResults = (metadataResults || []).filter(function(r) {
                return r && r.metadata !== null && r.metadata !== undefined;
            });
            setCachedMetadata(cleanResults, {
                partialUntilTs: Date.now() + PARTIAL_REFRESH_BACKOFF_MS,
                failedCategories: metadataResults._failedCategories.slice()
            });
            _log('listTemplates: SLOW PATH partial — wrote ' + cleanResults.length + ' entries with ' + Math.round(PARTIAL_REFRESH_BACKOFF_MS / 60000) + 'm grace. Manifest left untouched. Failed: [' + metadataResults._failedCategories.join(', ') + ']', 'warn');
            _dispatchLibraryPartial({
                failedCategories: metadataResults._failedCategories.slice(),
                userVisible: true,
                preservedStale: false,
                context: 'slow-path',
                visibleCount: cleanResults.length,
                freshCount: cleanResults.length
            });
        } else {
            setCachedMetadata(metadataResults);
            uploadManifest(metadataResults, listTemplates._archives || []);
        }

        // Build comp objects; thumbnails/previews are signed lazily by the UI.
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
        var signedUrlCacheAgeMs = null;
        Object.keys(_signedPathUrlCache).forEach(function(key) {
            var entry = _signedPathUrlCache[key];
            if (!entry || !entry.ts) return;
            var age = Date.now() - entry.ts;
            if (signedUrlCacheAgeMs === null || age > signedUrlCacheAgeMs) signedUrlCacheAgeMs = age;
        });
        Object.keys(_previewUrlCache).forEach(function(key) {
            var entry = _previewUrlCache[key];
            if (!entry || !entry.ts) return;
            var age = Date.now() - entry.ts;
            if (signedUrlCacheAgeMs === null || age > signedUrlCacheAgeMs) signedUrlCacheAgeMs = age;
        });
        // The manifest is downloaded fresh from cloud each fetchManifest()
        // call — there is no in-memory cache var, so no field to expose.
        // (A previous draft referenced an undeclared `_manifestCache`; the
        // typeof guard kept it from throwing but it always returned null,
        // making diagnostics misleading. Field removed.)
        return {
            version: (typeof window !== 'undefined' && window.BLITZKRIEG_LOCAL_VERSION) || null,
            now: Date.now(),
            lastLoad: {
                ts: _lastLoad.ts,
                ageMs: _lastLoad.ts ? Date.now() - _lastLoad.ts : null,
                source: _lastLoad.source,
                durationMs: _lastLoad.durationMs,
                count: _lastLoad.count,
                // Reflect actual cache state, not "loaded during grace window"
                // — the latter flips back to false 60s after the partial
                // load, even if the failed-categories list is still set.
                partial: !!cache && Array.isArray(cache.failedCategories) && cache.failedCategories.length > 0,
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
            signedUrlCache: {
                ttlMs: SIGNED_URL_CACHE_TTL,
                pathCount: Object.keys(_signedPathUrlCache).length,
                previewUrlCount: Object.keys(_previewUrlCache).length,
                previewPathCount: Object.keys(_previewPathCache).length,
                ageMs: signedUrlCacheAgeMs
            },
            archives: (listTemplates._archives || []).length,
            constants: {
                LIST_TIMEOUT_MS: LIST_TIMEOUT_MS,
                LIST_TIMEOUT_BY_ATTEMPT: LIST_TIMEOUT_BY_ATTEMPT.slice(),
                MANIFEST_TTL_MS: MANIFEST_TTL_MS,
                PARTIAL_REFRESH_BACKOFF_MS: PARTIAL_REFRESH_BACKOFF_MS,
                SIGNED_URL_EXPIRY: SIGNED_URL_EXPIRY,
                SIGNED_URL_CACHE_TTL: SIGNED_URL_CACHE_TTL
            }
        };
    }

    function pathEndsWith(path, suffix) {
        if (!path || !suffix) return false;
        var lowerPath = String(path).toLowerCase();
        var lowerSuffix = String(suffix).toLowerCase();
        return lowerPath.length >= lowerSuffix.length &&
            lowerPath.indexOf(lowerSuffix, lowerPath.length - lowerSuffix.length) !== -1;
    }

    function isAepPath(path) {
        return pathEndsWith(path, '.aep');
    }

    function shouldDownloadWithTemplate(storagePath, fullPath, chosenAepPath) {
        if (!fullPath || fullPath === chosenAepPath) return false;
        var rel = fullPath.substring(storagePath.length + 1);
        var lower = rel.toLowerCase();
        if (!rel || lower === '.emptyfolderplaceholder' || lower === '.ds_store' || lower.indexOf('/.ds_store') !== -1) return false;
        if (lower === 'metadata.json' || lower === 'comp.png' || lower === 'thumbnail.png' || lower === 'thumbnail.jpg') return false;
        if (lower.indexOf('preview/') === 0) return false;
        if (isAepPath(lower)) return false;
        return true;
    }

    function contentTypeForPath(path) {
        var lower = (path || '').toLowerCase();
        if (pathEndsWith(lower, '.png')) return 'image/png';
        if (pathEndsWith(lower, '.jpg') || pathEndsWith(lower, '.jpeg')) return 'image/jpeg';
        if (pathEndsWith(lower, '.json')) return 'application/json';
        if (pathEndsWith(lower, '.txt')) return 'text/plain';
        if (pathEndsWith(lower, '.mp4')) return 'video/mp4';
        if (pathEndsWith(lower, '.mov')) return 'video/quicktime';
        if (pathEndsWith(lower, '.wav')) return 'audio/wav';
        if (pathEndsWith(lower, '.mp3')) return 'audio/mpeg';
        return 'application/octet-stream';
    }

    // A per-file download MUST be time-bounded. Supabase .download() runs fetch()
    // with NO timeout; a stalled TCP stream (ITP / proxy / half-open socket) makes
    // the await hang FOREVER, which wedges the entire full-sync idle loop: the
    // in-flight byte budget the stuck template holds is never released, so every
    // sync worker parks in the admission-wait loop and the queue deadlocks (the
    // "sync stuck" symptom). Race the download against a timeout that REJECTS so
    // the sync worker's existing fail-and-continue path (classify as retryable,
    // advance the queue) actually fires — a stalled fetch never rejects on its
    // own. Abort the underlying request when possible so the dead socket is
    // released rather than left dangling. 3 min is generous for large footage yet
    // still bounds a true hang; a genuinely slow-but-progressing file that trips
    // it is classified 'failed' (retryable), not 'broken', so it retries next run.
    var DOWNLOAD_TIMEOUT_MS = 180000;
    function _downloadWithTimeout(path) {
        var controller = null;
        try { if (typeof AbortController === 'function') controller = new AbortController(); } catch (e) { controller = null; }
        var opts = controller ? { signal: controller.signal } : undefined;
        var timer = null;
        var timeoutPromise = new Promise(function (_, reject) {
            timer = setTimeout(function () {
                if (controller) { try { controller.abort(); } catch (e) {} }
                reject(new Error('Download timed out after ' + DOWNLOAD_TIMEOUT_MS + 'ms: ' + path));
            }, DOWNLOAD_TIMEOUT_MS);
        });
        var dlPromise = sb.storage.from(BUCKET).download(path, opts).then(function (res) {
            if (timer) { clearTimeout(timer); timer = null; }
            return res;
        }, function (err) {
            if (timer) { clearTimeout(timer); timer = null; }
            throw err;
        });
        return Promise.race([dlPromise, timeoutPromise]);
    }

    async function downloadStorageFiles(paths, basePath, concurrency, onFileDone) {
        var results = new Array(paths.length);
        var next = 0;
        var limit = concurrency || 6;
        async function worker() {
            while (next < paths.length) {
                var idx = next++;
                var path = paths[idx];
                var res = await _downloadWithTimeout(path);
                if (res.error || !res.data) {
                    throw new Error('Failed to download bundle file ' + path + ': ' + (res.error && res.error.message || 'unknown'));
                }
                results[idx] = {
                    path: path,
                    relativePath: path.substring(basePath.length + 1),
                    blob: res.data,
                    contentType: contentTypeForPath(path)
                };
                // Per-file progress so the sync UI can credit bytes AS THEY LAND
                // (not only when the whole template finishes) - the fix for the
                // "12 KB/s" artifact where a long in-flight template starved the
                // rate. Also our live throughput probe. Never let a UI callback
                // break the download loop.
                if (typeof onFileDone === 'function') {
                    try { onFileDone(res.data.size || 0, path); } catch (cbErr) { /* ignore */ }
                }
            }
        }
        var workers = [];
        var workerCount = Math.min(limit, paths.length);
        for (var i = 0; i < workerCount; i++) workers.push(worker());
        await Promise.all(workers);
        return results;
    }

    // Read a template's declared linked-comp/pre-comp dependencies from its
    // metadata.json. Returns an array of sibling storagePaths (possibly empty).
    // Forward-compatible: legacy templates have no `dependencies` key → []. The
    // storage-remediation pass populates this for split Linked_Comp/Pre-comp
    // templates so downloadTemplate can pull their files into the bundle.
    async function getTemplateDependencies(storagePath) {
        try {
            var res = await sb.storage.from(BUCKET).download(storagePath + '/metadata.json');
            if (res.error || !res.data) return [];
            var text = await res.data.text();
            if (!text) return [];
            var meta = JSON.parse(text);
            var deps = meta && meta.dependencies;
            if (!deps || !deps.length) return [];
            var out = [];
            for (var i = 0; i < deps.length; i++) {
                var d = deps[i];
                if (typeof d === 'string' && d) out.push(d);
                else if (d && typeof d.storagePath === 'string' && d.storagePath) out.push(d.storagePath);
            }
            return out;
        } catch (e) {
            return [];
        }
    }

    // Fetch importable files from a template's declared dependencies (linked
    // sub-comps / pre-comps that live in SEPARATE sibling folders the folder-local
    // collection misses). Each fetched file is tagged with a relativePath under
    // (Footage)/_deps/<i>_<folder>/ so the host-side relink pass (which walks
    // (Footage)/ recursively and matches by basename) can re-point references.
    // The leading "<i>_" disambiguates two dependencies that share a trailing
    // folder name (e.g. CatA/Logo + CatB/Logo) so they cannot overwrite each
    // other on disk. Returns [] for legacy templates (no manifest) or on error.
    // Shared by both the cloud-download path (downloadTemplate) and the local
    // mirror path (mirrorTemplate) so dependency relink is durable on both.
    async function fetchDependencyExtras(storagePath) {
        var depExtras = [];
        try {
            var deps = await getTemplateDependencies(storagePath);
            for (var di = 0; di < deps.length; di++) {
                var depPath = deps[di];
                if (!depPath || depPath === storagePath) continue;
                var depFiles = await collectAllFiles(depPath);
                var depWanted = [];
                for (var dfi = 0; dfi < depFiles.length; dfi++) {
                    var drel = depFiles[dfi].substring(depPath.length + 1).toLowerCase();
                    if (drel === 'metadata.json' || drel === 'comp.png' || drel === 'thumbnail.png' || drel === 'thumbnail.jpg') continue;
                    if (drel.indexOf('preview/') === 0) continue;
                    if (drel === '.emptyfolderplaceholder' || drel.indexOf('.ds_store') !== -1) continue;
                    depWanted.push(depFiles[dfi]);
                }
                if (depWanted.length === 0) continue;
                var depFolderName = di + '_' + ((depPath.split('/').pop()) || 'dep');
                var fetched = await downloadStorageFiles(depWanted, depPath, 6);
                for (var fdi = 0; fdi < fetched.length; fdi++) {
                    fetched[fdi].relativePath = '(Footage)/_deps/' + depFolderName + '/' + fetched[fdi].relativePath;
                    depExtras.push(fetched[fdi]);
                }
            }
            if (depExtras.length > 0) {
                _log('fetchDependencyExtras: fetched ' + depExtras.length + ' dependency file(s) from ' + deps.length + ' linked folder(s) for ' + storagePath, 'info');
            }
        } catch (depErr) {
            _log('fetchDependencyExtras: skipped: ' + (depErr && depErr.message || depErr), 'warn');
        }
        return depExtras;
    }

    // Download a template bundle for import/generation. The returned extraFiles
    // preserve collected footage/assets next to the AEP so AE can relink them.
    async function downloadTemplate(storagePath) {
        var allFiles = await collectAllFiles(storagePath);
        var chosenAepPath = null;
        var fastPath = storagePath + '/template.aep';

        for (var af = 0; af < allFiles.length; af++) {
            if (allFiles[af] === fastPath) {
                chosenAepPath = fastPath;
                break;
            }
        }

        if (!chosenAepPath) {
            for (var ap = 0; ap < allFiles.length; ap++) {
                if (isAepPath(allFiles[ap])) {
                    chosenAepPath = allFiles[ap];
                    break;
                }
            }
        }

        if (!chosenAepPath) {
            var filesResult = await sb.storage.from(BUCKET).list(storagePath, { limit: 1000 });
            if (filesResult.error) {
                throw new Error('Failed to list template files: ' + filesResult.error.message);
            }
            var _files = filesResult.data || [];
            for (var _fi = 0; _fi < _files.length; _fi++) {
                var _f = _files[_fi];
                if (!_f || !_f.name || _f.id === null) continue;
                if (isAepPath(_f.name)) {
                    chosenAepPath = storagePath + '/' + _f.name;
                    break;
                }
            }
        }

        if (!chosenAepPath) {
            throw new Error('No .aep file found in template folder');
        }

        var downloadResult = await sb.storage.from(BUCKET).download(chosenAepPath);
        if (downloadResult.error || !downloadResult.data) {
            throw new Error('Failed to download template: ' + (downloadResult.error && downloadResult.error.message || 'unknown'));
        }

        var extraPaths = [];
        for (var ep = 0; ep < allFiles.length; ep++) {
            if (shouldDownloadWithTemplate(storagePath, allFiles[ep], chosenAepPath)) {
                extraPaths.push(allFiles[ep]);
            }
        }

        var extras = [];
        if (extraPaths.length > 0) {
            extras = await downloadStorageFiles(extraPaths, storagePath, 6);
            _log('downloadTemplate: downloaded AEP + ' + extras.length + ' bundle asset(s) for ' + storagePath, 'info');
        }

        // --- Dependency-aware fetch (linked sub-comps / pre-comps) ---
        // Some templates reference linked comps / pre-comps stored in SEPARATE
        // sibling folders; the folder-local collection above misses them, so import
        // lands with missing sources. Pull each declared dependency's importable
        // files into the bundle under (Footage)/_deps/ so the host relink pass can
        // re-point references. Legacy templates without the manifest get [].
        var depExtras = await fetchDependencyExtras(storagePath);

        return {
            blob: downloadResult.data,
            fileName: chosenAepPath.split('/').pop(),
            storagePath: chosenAepPath,
            extraFiles: depExtras.length > 0 ? extras.concat(depExtras) : extras
        };
    }

    // Download ALL files for a template — thumbnails, previews, metadata,
    // footage, and AEP. Unlike downloadTemplate() which only returns the
    // import-essential bundle (AEP + footage), this returns every file in
    // the template folder for a complete local mirror. Used by local-sync.js.
    async function mirrorTemplate(storagePath, onFileDone) {
        var allFiles = await collectAllFiles(storagePath);
        if (allFiles.length === 0) {
            throw new Error('No files found in template folder: ' + storagePath);
        }
        var downloaded = await downloadStorageFiles(allFiles, storagePath, 6, onFileDone);
        var aepPath = '';
        var totalSize = 0;
        for (var i = 0; i < downloaded.length; i++) {
            totalSize += downloaded[i].blob.size;
            if (!aepPath && isAepPath(downloaded[i].path)) {
                aepPath = downloaded[i].path;
            }
        }
        // Mirror declared dependencies too (split linked-comp / pre-comp folders)
        // so a synced template relinks them durably from the persistent local
        // library, matching the cloud-download path. Appended AFTER the template's
        // own files so the template's own .aep keeps priority when the caller picks
        // the import target. Dep files carry a (Footage)/_deps/<i>_<folder>/ relPath
        // that lands them where the host relink walk indexes by basename.
        var depExtras = await fetchDependencyExtras(storagePath);
        for (var de = 0; de < depExtras.length; de++) {
            if (depExtras[de] && depExtras[de].blob) {
                totalSize += depExtras[de].blob.size;
                downloaded.push(depExtras[de]);
            }
        }
        _log('mirrorTemplate: downloaded ' + downloaded.length + ' files (' + (totalSize / 1024 / 1024).toFixed(1) + 'MB) for ' + storagePath, 'info');
        return {
            files: downloaded,
            aepBlob: null,
            fileCount: downloaded.length,
            sizeBytes: totalSize
        };
    }

    // Lightweight THUMBNAIL-ONLY mirror: comp.png (+ metadata.json best-effort).
    // Powers the auto-seeded local thumbnail cache that gives Animation-Composer-style
    // instant, offline thumbnails on launch, WITHOUT downloading the full ~67GB library
    // that mirrorTemplate pulls. Fleet-wide this is ~158MB (378 comp.png). The render
    // path (_applyLocalAssetCache) serves the resulting file://comp.png with zero network.
    async function mirrorThumbnail(storagePath) {
        var compPngPath = storagePath + '/comp.png';
        // comp.png is the one essential file. downloadStorageFiles THROWS if it is
        // genuinely absent — the caller treats that as "nothing to cache" and skips
        // the template (it has no thumbnail to serve locally anyway).
        var downloaded = await downloadStorageFiles([compPngPath], storagePath, 1);
        var files = [];
        var totalSize = 0;
        for (var i = 0; i < downloaded.length; i++) {
            if (downloaded[i] && downloaded[i].blob) {
                files.push(downloaded[i]);
                totalSize += downloaded[i].blob.size;
            }
        }
        // metadata.json is optional for a thumbnail cache — best-effort, never fatal.
        try {
            var metaRes = await sb.storage.from(BUCKET).download(storagePath + '/metadata.json');
            if (!metaRes.error && metaRes.data) {
                files.push({
                    path: storagePath + '/metadata.json',
                    relativePath: 'metadata.json',
                    blob: metaRes.data,
                    contentType: 'application/json'
                });
                totalSize += metaRes.data.size;
            }
        } catch (e) { /* thumbnail cache does not require metadata.json */ }
        return { files: files, fileCount: files.length, sizeBytes: totalSize };
    }

    // Verify a local mirror folder has the essential files needed for import.
    // Checks: at least one .aep exists, plus metadata.json.
    // Called by local-sync.js after sync to confirm integrity.
    // storagePath is "Category/FolderName", checks are done via localSync.
    function verifyTemplateIntegrity(localBasePath, storagePath) {
        var fullPath = localBasePath + '/' + storagePath;
        // Templates are NOT named template.aep — the .aep is named after the comp,
        // so a fixed-name check fails for every real template. metadata.json is the
        // only fixed-name requirement; .aep presence must be verified by scanning
        // the folder for ANY .aep (see local-sync.js verifyTemplateIntegrity, the
        // live path). anyAepRequired signals that contract to callers.
        var checks = [
            { name: 'metadata.json', path: fullPath + '/metadata.json', required: true }
        ];
        return {
            checks: checks,
            anyAepRequired: true,
            fullPath: fullPath
        };
    }

    // Get the list of files in a template folder (lightweight — no download).
    // Returns array of relative paths. Used by local-sync.js for sync planning.
    async function getTemplateFileList(storagePath) {
        var allFiles = await collectAllFiles(storagePath);
        return allFiles.map(function(f) {
            return f.substring(storagePath.length + 1);
        });
    }

    async function uploadBundleFiles(basePath, bundleFiles) {
        if (!bundleFiles || bundleFiles.length === 0) return [];
        var failures = [];
        var idx = 0;
        var CONCURRENCY = 6;
        async function worker() {
            while (idx < bundleFiles.length) {
                var myIdx = idx++;
                var f = bundleFiles[myIdx];
                if (!f || !f.relativePath || !f.blob) continue;
                var uploadPath = basePath + '/' + f.relativePath.replace(/^\/+/, '');
                try {
                    var res = await sb.storage.from(BUCKET).upload(uploadPath, f.blob, {
                        contentType: f.contentType || contentTypeForPath(uploadPath),
                        upsert: true,
                    });
                    if (res.error) failures.push({ path: uploadPath, error: res.error.message });
                } catch (e) {
                    failures.push({ path: uploadPath, error: (e && e.message) || String(e) });
                }
            }
        }
        var workers = [];
        for (var wi = 0; wi < Math.min(CONCURRENCY, bundleFiles.length); wi++) workers.push(worker());
        await Promise.all(workers);
        if (failures.length > 0) {
            throw new Error('Failed to upload bundle asset ' + failures[0].path + ': ' + failures[0].error);
        }
        return bundleFiles;
    }

    async function copyStorageFiles(filesToCopy) {
        if (!filesToCopy || filesToCopy.length === 0) return;
        var idx = 0;
        var failures = [];
        var CONCURRENCY = 6;
        async function worker() {
            while (idx < filesToCopy.length) {
                var myIdx = idx++;
                var entry = filesToCopy[myIdx];
                try {
                    var dlRes = await sb.storage.from(BUCKET).download(entry.src);
                    if (dlRes.error || !dlRes.data) throw new Error('Download failed: ' + (dlRes.error && dlRes.error.message || 'unknown'));
                    var upRes = await sb.storage.from(BUCKET).upload(entry.dest, dlRes.data, {
                        contentType: contentTypeForPath(entry.dest),
                        upsert: true,
                    });
                    if (upRes.error) throw new Error('Upload failed: ' + upRes.error.message);
                } catch (e) {
                    failures.push({ path: entry.src, error: (e && e.message) || String(e) });
                }
            }
        }
        var workers = [];
        for (var wi = 0; wi < Math.min(CONCURRENCY, filesToCopy.length); wi++) workers.push(worker());
        await Promise.all(workers);
        if (failures.length > 0) {
            throw new Error('Failed to copy ' + failures[0].path + ': ' + failures[0].error);
        }
    }

    async function removeStorageFiles(paths) {
        if (!paths || paths.length === 0) return;
        for (var b = 0; b < paths.length; b += 100) {
            var batch = paths.slice(b, b + 100);
            var removeResult = await sb.storage.from(BUCKET).remove(batch);
            if (removeResult.error) {
                throw new Error('Failed to remove files: ' + removeResult.error.message);
            }
        }
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

        if (files.bundleFiles && files.bundleFiles.length > 0) {
            uploads.push(uploadBundleFiles(basePath, files.bundleFiles));
        }

        if (files.metadata) {
            // Record thumbnail + project truth at write time so the reader never has
            // to infer comp.png/.aep existence (which would need a per-folder list).
            files.metadata.hasCompPng = !!files.thumbnail;
            files.metadata.hasAep = !!files.aep; // the .aep upload above is guarded by if (files.aep)
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
        var items = await listAllPaginated(folderPath, { sortBy: { column: 'name', order: 'asc' } });
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

    // Sum a template's total byte size from the storage LISTING (item.metadata.size)
    // WITHOUT downloading anything. Recurses subfolders like collectAllFiles. Used by
    // the full-sync byte-budget so it can pack small templates concurrently on the
    // first sync (where per-template sizes aren't yet persisted) instead of running
    // strictly serial. Cheap: same LIST calls, zero downloads.
    //
    // Returns { total, trustworthy }. MEMORY-SAFETY CRITICAL: if ANY file lacks a
    // positive numeric metadata.size, `trustworthy` is false and the caller MUST
    // fall back to "run alone" — never pack a template whose size we cannot fully
    // account for, or a large .aep with absent size metadata could be mis-sized as
    // tiny, packed with others, and OOM the CEP heap. We only relax serialization
    // when the whole template's byte count is known.
    async function getTemplateSize(storagePath) {
        var items = await listAllPaginated(storagePath, { sortBy: { column: 'name', order: 'asc' } });
        var total = 0;
        var trustworthy = true;
        var subPromises = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].id === null) {
                subPromises.push(getTemplateSize(storagePath + '/' + items[i].name));
            } else if (items[i].metadata && typeof items[i].metadata.size === 'number' && items[i].metadata.size > 0) {
                total += items[i].metadata.size;
            } else {
                trustworthy = false; // a file with no known size -> cannot trust the sum
            }
        }
        if (subPromises.length > 0) {
            var nested = await Promise.all(subPromises);
            for (var n = 0; n < nested.length; n++) {
                total += nested[n].total;
                if (!nested[n].trustworthy) trustworthy = false;
            }
        }
        return { total: total, trustworthy: trustworthy };
    }

    // SOFT-delete a template (admin-only, RLS enforced). Instead of a permanent
    // storage.remove() (which destroyed the .aep + assets with no recovery — a
    // violation of the never-destroy-data rule), MOVE the whole folder into a
    // 'trash/<timestamp>_<folder>/' prefix and drop a _trashmeta.json recording
    // its original path. The library listing excludes 'trash/', so it disappears
    // from the grid, but an admin can recover it via recoverTemplate(). Reuses the
    // same storage.move() primitive as moveTemplate/renameCategory.
    async function deleteTemplate(storagePath) {
        var allFiles = await collectAllFiles(storagePath);
        if (allFiles.length === 0) { invalidateCacheForPath(storagePath); return; }

        var folderName = storagePath.split('/').pop();
        var stamp = Date.now();
        var trashBase = TRASH_PREFIX + '/' + stamp + '_' + (_trashSeq++) + '_' + folderName;

        // Move every file, preserving the folder's internal structure.
        for (var i = 0; i < allFiles.length; i++) {
            var oldPath = allFiles[i];
            var newPath = trashBase + oldPath.substring(storagePath.length);
            var mv = await sb.storage.from(BUCKET).move(oldPath, newPath);
            if (mv.error) {
                throw new Error('Failed to move template to trash: ' + mv.error.message);
            }
        }

        // Recovery manifest so an admin can restore it to its original category.
        try {
            var trashMeta = { originalPath: storagePath, deletedAt: stamp, kind: 'template' };
            var mb = new Blob([JSON.stringify(trashMeta)], { type: 'application/json' });
            await sb.storage.from(BUCKET).upload(trashBase + '/_trashmeta.json', mb, {
                contentType: 'application/json', upsert: true
            });
        } catch (metaErr) {
            // Best-effort: the folder name still carries enough to recover manually.
            _log('deleteTemplate: trashmeta write failed (recoverable via folder name): ' + (metaErr && metaErr.message || metaErr), 'warn');
        }
        invalidateCacheForPath(storagePath);
    }

    // List everything currently in the trash. Reads each folder's _trashmeta.json
    // for its original path + deletion time. Admin-only surface (Recently Deleted).
    async function listTrash() {
        var items;
        try {
            items = await listAllPaginated(TRASH_PREFIX, { sortBy: { column: 'name', order: 'desc' } });
        } catch (e) {
            return []; // no trash/ folder yet
        }
        var out = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].id !== null) continue; // only subfolders are trashed items
            var trashPath = TRASH_PREFIX + '/' + items[i].name;
            var meta = null;
            try {
                var d = await sb.storage.from(BUCKET).download(trashPath + '/_trashmeta.json');
                if (!d.error && d.data) meta = JSON.parse(await d.data.text());
            } catch (metaErr) { /* fall back to folder name */ }
            var origPath = (meta && meta.originalPath) ? meta.originalPath : '';
            var nm = items[i].name;
            // Prefer the recorded original name. Fallback: trash folder is
            // "<stamp>_<seq>_<origFolder>"; drop the two numeric prefixes and keep
            // the rest (the original folder name may itself contain underscores).
            var derivedFolder = nm;
            var parts = nm.split('_');
            if (parts.length > 2 && /^[0-9]+$/.test(parts[0]) && /^[0-9]+$/.test(parts[1])) {
                derivedFolder = parts.slice(2).join('_');
            }
            var displayName = origPath ? origPath.split('/').pop() : derivedFolder;
            out.push({
                trashPath: trashPath,
                folderName: nm,
                originalPath: origPath,
                displayName: displayName,
                category: origPath ? origPath.split('/').slice(0, -1).join('/') : '',
                deletedAt: (meta && meta.deletedAt) ? meta.deletedAt : 0
            });
        }
        return out;
    }

    // Restore a trashed template back to a real category (admin-only). targetPath
    // defaults to the recorded originalPath. Moves every file back and drops the
    // leftover _trashmeta.json marker.
    async function recoverTemplate(trashPath, targetPath) {
        if (!trashPath) throw new Error('trashPath required');
        if (!targetPath) throw new Error('No original path recorded for this item; pick a category to recover into.');
        var allFiles = await collectAllFiles(trashPath);
        for (var i = 0; i < allFiles.length; i++) {
            var oldPath = allFiles[i];
            var rel = oldPath.substring(trashPath.length); // leading '/...'
            if (rel === '/_trashmeta.json') continue;      // don't restore the marker
            var newPath = targetPath + rel;
            var mv = await sb.storage.from(BUCKET).move(oldPath, newPath);
            if (mv.error) {
                throw new Error('Failed to recover template: ' + mv.error.message);
            }
        }
        try { await sb.storage.from(BUCKET).remove([trashPath + '/_trashmeta.json']); } catch (e) { /* marker cleanup best-effort */ }
        invalidateCacheForPath(targetPath);
        invalidateCache();
    }

    // Permanently purge one trashed item (admin-only, explicit "Delete forever").
    // This is the ONLY hard remove() left on templates and is gated behind an
    // explicit admin confirm in the Recently Deleted view.
    async function purgeTrash(trashPath) {
        if (!trashPath || trashPath.indexOf(TRASH_PREFIX + '/') !== 0) {
            throw new Error('purgeTrash refused: path is not under trash/');
        }
        var allFiles = await collectAllFiles(trashPath);
        for (var b = 0; b < allFiles.length; b += 100) {
            var batch = allFiles.slice(b, b + 100);
            var rm = await sb.storage.from(BUCKET).remove(batch);
            if (rm.error) throw new Error('Failed to purge: ' + rm.error.message);
        }
        invalidateCache();
    }

    async function removePreviewFrames(storagePath) {
        var framePaths = await getExistingPreviewFramePaths(storagePath, 0);
        if (!framePaths || framePaths.length === 0) return 0;
        for (var b = 0; b < framePaths.length; b += 100) {
            var batch = framePaths.slice(b, b + 100);
            var removeResult = await sb.storage.from(BUCKET).remove(batch);
            if (removeResult.error) {
                throw new Error('Failed to remove old preview frames: ' + removeResult.error.message);
            }
        }
        _previewUrlCache = {};
        _previewPathCache = {};
        invalidateCache();
        return framePaths.length;
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

    // SOFT-delete an entire category (admin-only). Like deleteTemplate, moves the
    // whole category subtree into trash/ instead of a permanent remove(), so a
    // mis-click on "delete category + all templates" is recoverable. Each template
    // keeps its internal structure under trash/<stamp>_<category>/.
    async function deleteCategory(categoryName) {
        var allFiles = await collectAllFiles(categoryName);
        if (allFiles.length === 0) { invalidateCache(); return; }

        var stamp = Date.now();
        var trashBase = TRASH_PREFIX + '/' + stamp + '_' + (_trashSeq++) + '_' + categoryName;
        for (var i = 0; i < allFiles.length; i++) {
            var oldPath = allFiles[i];
            var newPath = trashBase + oldPath.substring(categoryName.length);
            var mv = await sb.storage.from(BUCKET).move(oldPath, newPath);
            if (mv.error) {
                throw new Error('Failed to move category to trash: ' + mv.error.message);
            }
        }
        try {
            var trashMeta = { originalPath: categoryName, deletedAt: stamp, kind: 'category' };
            var mb = new Blob([JSON.stringify(trashMeta)], { type: 'application/json' });
            await sb.storage.from(BUCKET).upload(trashBase + '/_trashmeta.json', mb, {
                contentType: 'application/json', upsert: true
            });
        } catch (metaErr) {
            _log('deleteCategory: trashmeta write failed: ' + (metaErr && metaErr.message || metaErr), 'warn');
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
        var pathsToSign = [];
        var seen = {};
        paths.forEach(function(path) {
            if (!path || seen[path]) return;
            seen[path] = 1;
            var cached = getCachedSignedUrl(path);
            if (cached) {
                result[path] = cached;
            } else {
                pathsToSign.push(path);
            }
        });
        if (pathsToSign.length === 0) return result;
        var BATCH = 100;
        for (var b = 0; b < pathsToSign.length; b += BATCH) {
            var batch = pathsToSign.slice(b, b + BATCH);
            var signResult = await sb.storage.from(BUCKET).createSignedUrls(batch, SIGNED_URL_EXPIRY);
            if (signResult.data) {
                signResult.data.forEach(function(item) {
                    if (!item.error && item.signedUrl) {
                        result[item.path] = item.signedUrl;
                        _signedPathUrlCache[item.path] = { ts: Date.now(), url: item.signedUrl };
                    }
                });
            }
        }
        _persistSignedUrlCache();   // Wave 2B: mirror freshly-signed URLs to localStorage + durable file
        return result;
    }

    // Hard reload — bypasses the manifest and calls fetchAllMetadata directly.
    // Keep the last local metadata cache in place until fresh data is ready:
    // diagnostics can run mid-scan, and a failed slow scan should not turn a
    // healthy 248-template cache into an empty one.
    async function forceReload() {
        _log('forceReload: capturing stale, clearing media caches, slow-path fetch (bypass manifest)', 'info');
        var preExisting = getCachedMetadata();
        var stale = preExisting && preExisting.folders ? preExisting.folders : [];
        _signedPathUrlCache = {};
        _previewUrlCache = {};
        _previewPathCache = {};
        _clearPersistedSignedUrls();

        var fresh = await fetchAllMetadata();
        if (!listTemplates._archives) listTemplates._archives = [];
        if (!fresh._failedCategories || fresh._failedCategories.length === 0) {
            setCachedMetadata(fresh);
            uploadManifest(fresh, listTemplates._archives);
            return await buildCompsFromMetadata(fresh);
        }
        // Partial: merge fresh non-failed with stale failed entries, then back
        // off repeated full scans so the user can keep working.
        var merged = _mergePartialFolders(stale, fresh, fresh._failedCategories);
        setCachedMetadata(merged, {
            partialUntilTs: Date.now() + PARTIAL_REFRESH_BACKOFF_MS,
            failedCategories: fresh._failedCategories.slice()
        });
        _log('forceReload: partial — kept ' + merged.length + ' entries after failed cats: [' + fresh._failedCategories.join(', ') + ']. Manifest left untouched; retry backed off for ' + Math.round(PARTIAL_REFRESH_BACKOFF_MS / 60000) + 'm.', 'warn');
        _dispatchLibraryPartial({
            failedCategories: fresh._failedCategories.slice(),
            userVisible: false,
            preservedStale: true,
            context: 'force-reload',
            visibleCount: merged.length,
            freshCount: fresh.length
        });
        return await buildCompsFromMetadata(merged);
    }

    // Expose globally
    // ── Team-shared favorites ────────────────────────────────────────
    // Server-backed so every Blitzkrieg team member sees the whole team's
    // favorites (RLS: select = any member, insert/delete = own rows only).
    async function getTeamFavorites() {
        try {
            var res = await sb.from('blitzkrieg_favorites')
                .select('storage_path,user_id,team_member_id,team_members(full_name)');
            if (res.error) { _log('getTeamFavorites: ' + res.error.message, 'warn'); return []; }
            var rows = res.data || [];
            var out = [];
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                out.push({
                    storagePath: r.storage_path,
                    userId: r.user_id,
                    teamMemberId: r.team_member_id,
                    memberName: (r.team_members && r.team_members.full_name) ? r.team_members.full_name : 'Someone'
                });
            }
            return out;
        } catch (e) { _log('getTeamFavorites failed: ' + e.message, 'warn'); return []; }
    }

    async function addFavorite(storagePath, templateName, category, teamMemberId) {
        var row = { storage_path: storagePath, template_name: templateName || null, category: category || null };
        if (teamMemberId) row.team_member_id = teamMemberId;
        var res = await sb.from('blitzkrieg_favorites').insert(row);
        // 23505 = unique violation (already favorited) — treat as success (idempotent).
        if (res.error && res.error.code !== '23505') throw new Error(res.error.message);
        return true;
    }

    async function removeFavorite(storagePath) {
        // RLS scopes the delete to the caller's own row (user_id = auth.uid()).
        var res = await sb.from('blitzkrieg_favorites').delete().eq('storage_path', storagePath);
        if (res.error) throw new Error(res.error.message);
        return true;
    }

    // Approved-template authorship map (storage_path -> submitter name) via a
    // guarded SECURITY DEFINER RPC, so the "submitted by" filter works team-wide
    // without loosening the submissions-table RLS.
    async function getTemplateSubmitters() {
        try {
            var res = await sb.rpc('blitzkrieg_template_submitters');
            if (res.error) { _log('getTemplateSubmitters: ' + res.error.message, 'warn'); return []; }
            var rows = res.data || [];
            var out = [];
            for (var i = 0; i < rows.length; i++) {
                out.push({ storagePath: rows[i].storage_path, submitterName: rows[i].submitter_name, teamMemberId: rows[i].team_member_id });
            }
            return out;
        } catch (e) { _log('getTemplateSubmitters failed: ' + e.message, 'warn'); return []; }
    }

    window.cloudLibrary = {
        listTemplates: listTemplates,
        downloadTemplate: downloadTemplate,
        uploadTemplate: uploadTemplate,
        deleteTemplate: deleteTemplate,
        deleteTemplates: deleteTemplates,
        getTemplateSize: getTemplateSize,
        listTrash: listTrash,
        recoverTemplate: recoverTemplate,
        purgeTrash: purgeTrash,
        renameTemplate: renameTemplate,
        renameCategory: renameCategory,
        deleteCategory: deleteCategory,
        moveTemplate: moveTemplate,
        moveTemplates: moveTemplates,
        moveAllTemplates: moveAllTemplates,
        getArchives: getArchives,
        getArchiveDownloadUrl: getArchiveDownloadUrl,
        invalidateCache: invalidateCache,
        clearLocalCache: clearLocalCache,
        invalidateCacheForPath: invalidateCacheForPath,
        flushMetaCacheSync: flushMetaCacheSync,
        flushSignedUrlCacheSync: flushSignedUrlCacheSync,
        forceReload: forceReload,
        signPreviewFrames: signPreviewFrames,
        removePreviewFrames: removePreviewFrames,
        signPaths: signPaths,
        getDiagnostics: getDiagnostics,
        uploadBundleFiles: uploadBundleFiles,
        collectAllFiles: collectAllFiles,
        copyStorageFiles: copyStorageFiles,
        removeStorageFiles: removeStorageFiles,
        mirrorTemplate: mirrorTemplate,
        mirrorThumbnail: mirrorThumbnail,
        getTeamFavorites: getTeamFavorites,
        addFavorite: addFavorite,
        removeFavorite: removeFavorite,
        getTemplateSubmitters: getTemplateSubmitters,
        getTemplateFileList: getTemplateFileList,
        verifyTemplateIntegrity: verifyTemplateIntegrity,
    };
})();
