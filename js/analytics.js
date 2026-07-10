// js/analytics.js
// Usage event tracking for Blitzkrieg plugin.
//
// Durability model (mirrors js/telemetry.js): every insert that fails for any
// reason (no client, network error, non-2xx, auth expiry) is persisted to a
// localStorage queue and retried on the next session start and on a periodic
// timer. Without this, the old fire-and-forget inserts silently dropped on any
// transient failure and every metric undercounted. session_end is sent via a
// SYNCHRONOUS XHR because CEP reaps in-flight async requests during
// beforeunload, which previously broke every session-duration metric.
(function () {
    'use strict';

    var sb = window.blitzkriegSupabase;
    var TABLE = 'blitzkrieg_usage_events';
    var ERROR_TABLE = 'blitzkrieg_error_logs';
    var SUPABASE_URL = 'https://kwrmdxptrrvlqxdcasho.supabase.co';
    var SUPABASE_ANON_KEY = 'sb_publishable_wMNJ93D7lys_gVC6HZ3oDQ_sUiabT4E';
    var AUTH_STORAGE_KEY = 'sb-kwrmdxptrrvlqxdcasho-auth-token';
    var QUEUE_KEY = 'blitzkrieg_analytics_queue';
    var MAX_QUEUE = 100;
    var FLUSH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

    var viewedComps = {}; // Deduplication map: uniqueId -> true (per session)
    var _cachedGeo = null; // Cache geolocation to avoid redundant API calls
    var _flushTimer = null;

    function getTeamMemberId() {
        if (window.blitzkriegAuth && window.blitzkriegAuth.getTeamMember()) {
            return window.blitzkriegAuth.getTeamMember().id;
        }
        return null;
    }

    function getUserId() {
        if (window.blitzkriegAuth && window.blitzkriegAuth.getUser()) {
            return window.blitzkriegAuth.getUser().id;
        }
        return null;
    }

    // Synchronous read of the cached access token from localStorage (same key
    // the Supabase SDK writes). Needed for the sync-XHR session_end path.
    function getAuthToken() {
        try {
            var raw = localStorage.getItem(AUTH_STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                return parsed.access_token || null;
            }
        } catch (e) {}
        return null;
    }

    // ---- Durable queue ----

    function _loadQueue() {
        try {
            var raw = localStorage.getItem(QUEUE_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) { return []; }
    }

    function _saveQueue(q) {
        try {
            if (q.length > MAX_QUEUE) q = q.slice(-MAX_QUEUE);
            localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
        } catch (e) {}
    }

    // Persist a failed insert so a later flush can retry it. Entry shape:
    // { t: tableName, r: row }.
    function _queue(table, row) {
        var q = _loadQueue();
        q.push({ t: table, r: row });
        _saveQueue(q);
    }

    // Re-entry guard: two concurrent flushes (timer firing mid-flush) would
    // each re-insert the same rows and race the final save, double-shipping
    // every queued event.
    var _flushing = false;
    function _flushQueue() {
        if (_flushing || !sb) return;
        var q = _loadQueue();
        if (q.length === 0) return;
        _flushing = true;

        var remaining = [];
        var index = 0;

        function sendNext() {
            if (index >= q.length) {
                if (remaining.length > 0) {
                    _saveQueue(remaining);
                } else {
                    try { localStorage.removeItem(QUEUE_KEY); } catch (e) {}
                }
                _flushing = false;
                return;
            }
            var item = q[index++];
            if (!item || !item.t || !item.r) { sendNext(); return; }
            try {
                sb.from(item.t).insert(item.r).then(function (res) {
                    if (res && res.error) remaining.push(item);
                    sendNext();
                }, function () {
                    remaining.push(item);
                    sendNext();
                });
            } catch (e) {
                remaining.push(item);
                sendNext();
            }
        }
        sendNext();
    }

    // Attempt an async insert; on ANY failure, persist to the durable queue so
    // it retries later instead of being silently lost.
    function _insert(table, row) {
        if (!sb) { _queue(table, row); return; }
        try {
            sb.from(table).insert(row).then(function (res) {
                if (res && res.error) {
                    console.warn('Blitzkrieg analytics insert error:', res.error.message);
                    _queue(table, row);
                }
            }, function (err) {
                console.warn('Blitzkrieg analytics insert failed:', err);
                _queue(table, row);
            });
        } catch (e) {
            _queue(table, row);
        }
    }

    /**
     * Track a usage event. Durable: queues on failure, never blocks the UI.
     */
    function track(eventType, data) {
        var userId = getUserId();
        if (!userId) return;

        var row = {
            user_id: userId,
            team_member_id: getTeamMemberId(),
            event_type: eventType,
            template_name: data.templateName || null,
            template_category: data.templateCategory || null,
            template_storage_path: data.storagePath || null,
            search_query: data.searchQuery || null,
            metadata: data.metadata || {},
        };

        _insert(TABLE, row);
    }

    function fetchGeoData(callback) {
        if (_cachedGeo) { callback(_cachedGeo); return; }
        try {
            var xhr = new XMLHttpRequest();
            var timedOut = false;
            var timer = setTimeout(function() {
                timedOut = true;
                xhr.abort();
                callback({});
            }, 3000);
            xhr.open('GET', 'https://ipapi.co/json/', true);
            xhr.onreadystatechange = function() {
                if (xhr.readyState !== 4 || timedOut) return;
                clearTimeout(timer);
                if (xhr.status === 200) {
                    try {
                        var r = JSON.parse(xhr.responseText);
                        _cachedGeo = {
                            ip: r.ip || '',
                            city: r.city || '',
                            region: r.region || '',
                            country: r.country_name || '',
                            country_code: r.country_code || '',
                            lat: r.latitude || null,
                            lng: r.longitude || null,
                            timezone: r.timezone || ''
                        };
                        callback(_cachedGeo);
                    } catch(e) { callback({}); }
                } else {
                    callback({});
                }
            };
            xhr.send();
        } catch(e) { callback({}); }
    }

    // ---- Error Reporting ----

    var _errorCount = 0;
    var MAX_ERRORS_PER_SESSION = 50;
    var _errorDedup = {}; // message -> last reported timestamp

    /**
     * Durable insert into blitzkrieg_error_logs.
     * Throttled: max 50/session, dedup same message within 10s.
     */
    function reportError(message, level, context) {
        var userId = getUserId();
        if (!userId) return;
        if (_errorCount >= MAX_ERRORS_PER_SESSION) return;

        level = (level === 'warn' || level === 'error') ? level : 'error';
        message = String(message || '').substring(0, 2000);

        // Dedup: skip if same message reported within 10s
        var now = Date.now();
        var dedupKey = level + ':' + message;
        if (_errorDedup[dedupKey] && (now - _errorDedup[dedupKey]) < 10000) return;
        _errorDedup[dedupKey] = now;
        _errorCount++;

        var stack = '';
        if (context && context.stack) {
            stack = String(context.stack).substring(0, 4000);
            delete context.stack;
        }

        var row = {
            user_id: userId,
            team_member_id: getTeamMemberId(),
            error_level: level,
            message: message,
            stack: stack || null,
            context: context || {},
            url: window.location.href || null
        };

        _insert(ERROR_TABLE, row);
    }

    // ---- Access Change Tracking ----

    function trackAccessChange(targetMemberId, eventType, memberName) {
        track(eventType, {
            metadata: {
                target_member_id: targetMemberId,
                target_member_name: memberName || null
            }
        });
    }

    // ---- Public API ----

    function trackImport(name, category, storagePath) {
        track('template_import', {
            templateName: name,
            templateCategory: category,
            storagePath: storagePath,
        });
    }

    function trackView(name, category, storagePath, uniqueId) {
        // Deduplicate: only track first hover per template per session
        if (uniqueId && viewedComps[uniqueId]) return;
        if (uniqueId) viewedComps[uniqueId] = true;

        track('template_view', {
            templateName: name,
            templateCategory: category,
            storagePath: storagePath,
        });
    }

    function trackFavorite(name, category, storagePath) {
        track('template_favorite', {
            templateName: name,
            templateCategory: category,
            storagePath: storagePath,
        });
    }

    function trackSearch(query) {
        if (!query || query.trim().length === 0) return;
        track('search', { searchQuery: query.trim() });
    }

    // Dedup consecutive browses of the SAME category so re-clicking an already
    // active category (or a re-render firing the handler) does not inflate the
    // category_browse count. Only a genuine change in active category counts.
    var _lastBrowsedCategory = null;
    function trackCategoryBrowse(category) {
        if (category === _lastBrowsedCategory) return;
        _lastBrowsedCategory = category;
        track('category_browse', { templateCategory: category });
    }

    function trackSessionStart() {
        viewedComps = {};
        // Flush anything stranded from a previous session before we start adding
        // new events this session.
        _flushQueue();
        if (_flushTimer) clearInterval(_flushTimer);
        _flushTimer = setInterval(_flushQueue, FLUSH_INTERVAL_MS);
        fetchGeoData(function(geo) {
            track('session_start', { metadata: geo });
        });
    }

    // session_end MUST be synchronous: CEP kills in-flight async requests during
    // beforeunload, so an async insert here never lands and session durations
    // could never be computed. Mirrors telemetry.endSession's sync-XHR close.
    function trackSessionEnd() {
        if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }

        var userId = getUserId();
        if (!userId) return;

        var row = {
            user_id: userId,
            team_member_id: getTeamMemberId(),
            event_type: 'session_end',
            template_name: null,
            template_category: null,
            template_storage_path: null,
            search_query: null,
            metadata: {}
        };

        var token = getAuthToken();
        if (!token) { _queue(TABLE, row); return; }

        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', SUPABASE_URL + '/rest/v1/' + TABLE, false); // synchronous
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.setRequestHeader('Prefer', 'return=minimal');
            xhr.send(JSON.stringify(row));
            if (xhr.status < 200 || xhr.status >= 300) {
                _queue(TABLE, row); // next session's flush will retry
            }
        } catch (e) {
            _queue(TABLE, row);
        }
    }

    // ---- Bulk ops, stash, generate ----

    function trackBulkOp(action, count, targetIds) {
        // action: 'bulk_delete' | 'bulk_move' | 'bulk_tag'
        if (action !== 'bulk_delete' && action !== 'bulk_move' && action !== 'bulk_tag') return;
        track(action, {
            metadata: {
                count: typeof count === 'number' ? count : 0,
                target_ids: Array.isArray(targetIds) ? targetIds.slice(0, 200) : []
            }
        });
    }

    function trackStash(compName, category, storagePath, sizeBytes) {
        track('stash_created', {
            templateName: compName,
            templateCategory: category,
            storagePath: storagePath,
            metadata: { size_bytes: typeof sizeBytes === 'number' ? sizeBytes : null }
        });
    }

    function trackGenerate(templateName, success, durationMs, errorMsg) {
        track('generate_run', {
            templateName: templateName,
            metadata: {
                success: success === true,
                duration_ms: typeof durationMs === 'number' ? durationMs : null,
                error: errorMsg ? String(errorMsg).substring(0, 500) : null
            }
        });
    }

    // Crash-detection breadcrumbs for the submit/stash flow. trackSubmitStart is
    // persisted BEFORE the synchronous AE export; a hard AE crash during collect/reduce
    // kills the panel's JS context, so NO error can be logged and NO submit_end fires.
    // A submit_start whose trace_id has no matching submit_end is therefore a detectable
    // crash (the "AE just crashes when I submit" report), diagnosable per panel_version.
    function trackSubmitStart(traceId, category, footprintBytes, footageMissing) {
        track('submit_start', {
            templateCategory: category,
            metadata: {
                trace_id: traceId || null,
                panel_version: (typeof window !== 'undefined' && window.BLITZKRIEG_LOCAL_VERSION) || null,
                est_footage_bytes: typeof footprintBytes === 'number' ? footprintBytes : null,
                footage_missing: typeof footageMissing === 'number' ? footageMissing : null
            }
        });
    }

    // outcome: 'success' | 'failed' | 'blocked_oversize'
    function trackSubmitEnd(traceId, category, outcome, detail) {
        track('submit_end', {
            templateCategory: category,
            metadata: {
                trace_id: traceId || null,
                panel_version: (typeof window !== 'undefined' && window.BLITZKRIEG_LOCAL_VERSION) || null,
                outcome: outcome || 'unknown',
                detail: detail ? String(detail).substring(0, 300) : null
            }
        });
    }

    // Expose globally
    window.blitzkriegAnalytics = {
        trackImport: trackImport,
        trackView: trackView,
        trackFavorite: trackFavorite,
        trackSearch: trackSearch,
        trackCategoryBrowse: trackCategoryBrowse,
        trackSessionStart: trackSessionStart,
        trackSessionEnd: trackSessionEnd,
        reportError: reportError,
        trackAccessChange: trackAccessChange,
        trackBulkOp: trackBulkOp,
        trackStash: trackStash,
        trackGenerate: trackGenerate,
        trackSubmitStart: trackSubmitStart,
        trackSubmitEnd: trackSubmitEnd,
    };
})();
