// js/telemetry.js
// Telemetry module — tracks editor usage and POSTs to Insight Flow
(function () {
    'use strict';

    var SYNC_ENDPOINT = 'https://kwrmdxptrrvlqxdcasho.supabase.co/functions/v1/blitzkrieg-plugin-sync';
    var SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    var QUEUE_KEY = 'blitzkrieg_telemetry_queue';
    var OPT_OUT_KEY = 'blitzkrieg_telemetry_opt_out';
    var MAX_ACCUMULATOR_SIZE = 200;

    var sessionStartTime = null;
    var templatesUsed = []; // {name, category, storagePath, timestamp}
    var renderEvents = []; // {compName, width, height, duration, layers, frameRate, timestamp, type}
    var syncTimer = null;

    function _log(msg, level) {
        if (window._blitzLog) {
            window._blitzLog(msg, level || 'info');
        }
    }

    // ---- Opt-out ----

    function isOptedOut() {
        try { return localStorage.getItem(OPT_OUT_KEY) === '1'; } catch (e) { return false; }
    }

    function setOptOut(val) {
        try { localStorage.setItem(OPT_OUT_KEY, val ? '1' : '0'); } catch (e) {}
    }

    // ---- Auth helpers ----

    function getAuthToken() {
        // Use Supabase SDK's cached session (synchronous localStorage read internally)
        var sb = window.blitzkriegSupabase;
        if (!sb) return null;
        try {
            // Supabase JS v2 getSession() returns a promise, but the session is
            // also stored synchronously in the client instance. We need the token
            // synchronously for XHR headers. Read from localStorage using the SDK's
            // known storage key format.
            var storageKey = 'sb-kwrmdxptrrvlqxdcasho-auth-token';
            var raw = localStorage.getItem(storageKey);
            if (raw) {
                var parsed = JSON.parse(raw);
                return parsed.access_token || null;
            }
        } catch (e) {}
        return null;
    }

    function getTeamMemberId() {
        if (window.blitzkriegAuth && window.blitzkriegAuth.getTeamMember()) {
            return window.blitzkriegAuth.getTeamMember().id;
        }
        return null;
    }

    // ---- Offline queue ----

    function loadQueue() {
        try {
            var raw = localStorage.getItem(QUEUE_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed;
        } catch (e) { return []; }
    }

    function saveQueue(queue) {
        try {
            // Cap queue at 50 entries to prevent localStorage bloat. The
            // previous version dropped the oldest silently. Log the drop
            // count so we can see in analytics how often this is happening
            // (sustained drops mean either the edge fn is down, the user's
            // network is hostile, or we need a bigger cap).
            if (queue.length > 50) {
                var dropped = queue.length - 50;
                queue = queue.slice(-50);
                _log('queue cap reached, dropped ' + dropped + ' oldest payloads', 'warn');
            }
            localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        } catch (e) {}
    }

    // Force a Supabase session refresh, then re-read the access_token from
    // localStorage. Returns a Promise resolving to the new token (or null).
    // Used after a 401 from the sync endpoint so the next attempt has fresh
    // credentials before queueing.
    //
    // Coalesced: multiple concurrent 401s (e.g. flushQueue running in
    // parallel with sendPayload) share a single in-flight refresh promise
    // for ~5s. Without coalescing, N parallel sends each hit 401 and each
    // call refreshSession(), spawning N parallel refresh round-trips that
    // race against the same refresh-token row — Supabase honours one and
    // rejects the rest as "refresh_token_already_used", which then flips
    // the user to logged-out.
    var _refreshInFlight = null;
    var _refreshInFlightUntil = 0;
    function _refreshTokenAndRead() {
        if (_refreshInFlight && Date.now() < _refreshInFlightUntil) return _refreshInFlight;
        var sb = window.blitzkriegSupabase;
        if (!sb || !sb.auth || !sb.auth.refreshSession) return Promise.resolve(null);
        _refreshInFlightUntil = Date.now() + 5000;
        _refreshInFlight = sb.auth.refreshSession().then(function () {
            return getAuthToken();
        }, function () {
            return null;
        }).then(function (token) {
            // Hold the in-flight promise for the full 5s window so callers
            // arriving slightly after the resolve still coalesce instead of
            // spawning a second refresh.
            return token;
        });
        return _refreshInFlight;
    }

    function clearQueue() {
        try { localStorage.removeItem(QUEUE_KEY); } catch (e) {}
    }

    // ---- Comp metadata via ExtendScript ----

    function getActiveCompInfo(callback) {
        if (typeof window.safeEvalScript !== 'function') {
            callback(null);
            return;
        }
        window.safeEvalScript('getActiveCompInfo()', function (result) {
            if (!result || result === 'null' || result === 'undefined') {
                callback(null);
                return;
            }
            try {
                callback(JSON.parse(result));
            } catch (e) {
                callback(null);
            }
        });
    }

    // ---- Event tracking ----

    function trackTemplateImport(name, category, storagePath, compMeta) {
        if (isOptedOut()) return;
        var entry = {
            name: name || '',
            category: category || '',
            storagePath: storagePath || '',
            timestamp: new Date().toISOString()
        };
        if (compMeta) {
            entry.width = compMeta.width || 0;
            entry.height = compMeta.height || 0;
            entry.duration = compMeta.duration || 0;
            entry.frameRate = compMeta.frameRate || 0;
        }
        templatesUsed.push(entry);
        if (templatesUsed.length > MAX_ACCUMULATOR_SIZE) {
            templatesUsed = templatesUsed.slice(-MAX_ACCUMULATOR_SIZE);
        }
    }

    function trackRenderStart(compInfo) {
        if (isOptedOut()) return;
        var event = {
            type: 'render_start',
            timestamp: new Date().toISOString()
        };
        if (compInfo) {
            event.compName = compInfo.name || '';
            event.width = compInfo.width || 0;
            event.height = compInfo.height || 0;
            event.duration = compInfo.duration || 0;
            event.layers = compInfo.numLayers || 0;
            event.frameRate = compInfo.frameRate || 0;
        }
        renderEvents.push(event);
        if (renderEvents.length > MAX_ACCUMULATOR_SIZE) {
            renderEvents = renderEvents.slice(-MAX_ACCUMULATOR_SIZE);
        }
    }

    function trackRenderComplete(compInfo) {
        if (isOptedOut()) return;
        var event = {
            type: 'render_complete',
            timestamp: new Date().toISOString()
        };
        if (compInfo) {
            event.compName = compInfo.name || '';
            event.width = compInfo.width || 0;
            event.height = compInfo.height || 0;
            event.duration = compInfo.duration || 0;
            event.layers = compInfo.numLayers || 0;
            event.frameRate = compInfo.frameRate || 0;
        }
        renderEvents.push(event);
        if (renderEvents.length > MAX_ACCUMULATOR_SIZE) {
            renderEvents = renderEvents.slice(-MAX_ACCUMULATOR_SIZE);
        }
    }

    // ---- Build payload ----

    function buildPayload() {
        var teamMemberId = getTeamMemberId();
        if (!teamMemberId) return null;

        var durationSeconds = 0;
        if (sessionStartTime) {
            durationSeconds = Math.round((Date.now() - sessionStartTime) / 1000);
        }

        var rendersCompleted = 0;
        for (var i = 0; i < renderEvents.length; i++) {
            if (renderEvents[i].type === 'render_complete') rendersCompleted++;
        }

        // templates_used column is TEXT[] — send simple name strings
        // Rich metadata goes into session_data.template_details (JSONB)
        var templateNames = [];
        for (var j = 0; j < templatesUsed.length; j++) {
            templateNames.push(templatesUsed[j].name || 'unknown');
        }

        return {
            team_member_id: teamMemberId,
            plugin_type: 'blitzkrieg',
            duration_seconds: durationSeconds,
            templates_used: templateNames,
            renders_completed: rendersCompleted,
            session_data: {
                // Which panel build produced this session. Lives in session_data
                // (JSONB) — not a top-level column — so it needs no table migration.
                // Without it there is no remote way to tell if an editor's crash
                // report is from a build that already has a given fix (OTA can lag),
                // so "is the editor even on the fixed version?" was unanswerable.
                panel_version: (typeof window !== 'undefined' && window.BLITZKRIEG_LOCAL_VERSION) || 'unknown',
                render_events: renderEvents.slice(),
                template_details: templatesUsed.slice(),
                session_start: sessionStartTime ? new Date(sessionStartTime).toISOString() : null,
                session_end: new Date().toISOString()
            }
        };
    }

    // ---- Sync ----

    function _sendOnce(payload, token, onResult) {
        // Single XHR attempt. onResult(status) where status is 'ok' (2xx),
        // 'unauthorized' (401), 'error' (any other failure). Caller decides
        // whether to retry on 'unauthorized' or queue on 'error'.
        var xhr = new XMLHttpRequest();
        var timedOut = false;
        var timer = setTimeout(function () {
            timedOut = true;
            try { xhr.abort(); } catch (e) {}
            onResult('error');
        }, 10000);

        xhr.open('POST', SYNC_ENDPOINT, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || timedOut) return;
            clearTimeout(timer);
            if (xhr.status >= 200 && xhr.status < 300) {
                onResult('ok');
            } else if (xhr.status === 401) {
                _log('Telemetry sync HTTP 401 — token may be expired', 'warn');
                onResult('unauthorized');
            } else {
                _log('Telemetry sync failed: HTTP ' + xhr.status, 'warn');
                onResult('error');
            }
        };

        try {
            xhr.send(JSON.stringify(payload));
        } catch (e) {
            clearTimeout(timer);
            onResult('error');
        }
    }

    function sendPayload(payload, callback) {
        var token = getAuthToken();
        if (!token) {
            var q = loadQueue();
            q.push(payload);
            saveQueue(q);
            if (callback) callback(false);
            return;
        }

        function _queueAndDone() {
            var q = loadQueue();
            q.push(payload);
            saveQueue(q);
            if (callback) callback(false);
        }

        _sendOnce(payload, token, function (status) {
            if (status === 'ok') {
                if (callback) callback(true);
                return;
            }
            if (status === 'unauthorized') {
                // Token rotation race — refresh once and retry. After that,
                // queue and let flushQueue try again next sync interval.
                _refreshTokenAndRead().then(function (fresh) {
                    if (!fresh) {
                        _queueAndDone();
                        return;
                    }
                    _sendOnce(payload, fresh, function (status2) {
                        if (status2 === 'ok') {
                            if (callback) callback(true);
                        } else {
                            _queueAndDone();
                        }
                    });
                });
                return;
            }
            _queueAndDone();
        });
    }

    // Re-entry guard for flushQueue. Two parallel flushes (e.g. the
    // periodic timer firing while a forced flush from beforeunload is in
    // flight) would each loadQueue(), each fire N XHRs against the same
    // entries, and the second saveQueue() would race the first — leaving
    // bookkeeping inconsistent and shipping every event 2×.
    var _flushing = false;
    function flushQueue(callback) {
        if (_flushing) { if (callback) callback(); return; }
        var queue = loadQueue();
        if (queue.length === 0) { if (callback) callback(); return; }

        var token = getAuthToken();
        if (!token) { if (callback) callback(); return; }
        _flushing = true;
        var origCallback = callback;
        callback = function () {
            _flushing = false;
            if (origCallback) origCallback();
        };

        // Keep queue in localStorage until all sends finish — only replace with remaining
        var remaining = [];
        var index = 0;
        var refreshAttempted = false;

        function sendNext() {
            if (index >= queue.length) {
                if (remaining.length > 0) {
                    saveQueue(remaining);
                } else {
                    clearQueue();
                }
                if (callback) callback();
                return;
            }
            var payload = queue[index++];
            _sendOnce(payload, token, function (status) {
                if (status === 'ok') {
                    sendNext();
                    return;
                }
                if (status === 'unauthorized' && !refreshAttempted) {
                    // Refresh once for the WHOLE flush — every subsequent
                    // payload uses the same fresh token. Avoids hammering
                    // refreshSession on a 50-item queue with a fully expired
                    // session.
                    refreshAttempted = true;
                    _refreshTokenAndRead().then(function (fresh) {
                        if (fresh) token = fresh;
                        // Retry this payload with new token (or queue if refresh failed).
                        if (fresh) {
                            _sendOnce(payload, fresh, function (status2) {
                                if (status2 !== 'ok') remaining.push(payload);
                                sendNext();
                            });
                        } else {
                            remaining.push(payload);
                            sendNext();
                        }
                    });
                    return;
                }
                remaining.push(payload);
                sendNext();
            });
        }
        sendNext();
    }

    function syncNow(callback) {
        if (isOptedOut()) { if (callback) callback(true); return; }

        var payload = buildPayload();
        if (!payload) { if (callback) callback(false); return; }

        // Flush queued payloads first, then send current — avoids localStorage race
        flushQueue(function () {
            sendPayload(payload, function (ok) {
                if (ok) {
                    templatesUsed = [];
                    renderEvents = [];
                }
                if (callback) callback(ok);
            });
        });
    }

    // ---- Session lifecycle ----

    function startSession() {
        sessionStartTime = Date.now();
        templatesUsed = [];
        renderEvents = [];

        // Flush any offline-queued payloads from previous sessions
        flushQueue();

        // Periodic sync
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(function () {
            syncNow();
        }, SYNC_INTERVAL_MS);
    }

    function endSession() {
        if (syncTimer) {
            clearInterval(syncTimer);
            syncTimer = null;
        }
        if (isOptedOut()) return;

        var payload = buildPayload();
        if (!payload) return;

        var token = getAuthToken();
        // Synchronous XHR on close — CEP kills async requests on beforeunload
        if (token) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', SYNC_ENDPOINT, false); // synchronous
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('Authorization', 'Bearer ' + token);
                xhr.send(JSON.stringify(payload));
            } catch (e) {
                // Queue if sync XHR fails — next session will flush
                var queue = loadQueue();
                queue.push(payload);
                saveQueue(queue);
            }
        } else {
            var queue = loadQueue();
            queue.push(payload);
            saveQueue(queue);
        }
    }

    // ---- Public API ----

    window.blitzkriegTelemetry = {
        startSession: startSession,
        endSession: endSession,
        trackTemplateImport: trackTemplateImport,
        trackRenderStart: trackRenderStart,
        trackRenderComplete: trackRenderComplete,
        getActiveCompInfo: getActiveCompInfo,
        syncNow: syncNow,
        isOptedOut: isOptedOut,
        setOptOut: setOptOut
    };
})();
