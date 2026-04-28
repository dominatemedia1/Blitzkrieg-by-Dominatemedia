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
            // Cap queue at 50 entries to prevent localStorage bloat
            if (queue.length > 50) queue = queue.slice(-50);
            localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        } catch (e) {}
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
                render_events: renderEvents.slice(),
                template_details: templatesUsed.slice(),
                session_start: sessionStartTime ? new Date(sessionStartTime).toISOString() : null,
                session_end: new Date().toISOString()
            }
        };
    }

    // ---- Sync ----

    function sendPayload(payload, callback) {
        var token = getAuthToken();
        if (!token) {
            var queue = loadQueue();
            queue.push(payload);
            saveQueue(queue);
            if (callback) callback(false);
            return;
        }

        var xhr = new XMLHttpRequest();
        var timedOut = false;
        var timer = setTimeout(function () {
            timedOut = true;
            xhr.abort();
            var queue = loadQueue();
            queue.push(payload);
            saveQueue(queue);
            if (callback) callback(false);
        }, 10000);

        xhr.open('POST', SYNC_ENDPOINT, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || timedOut) return;
            clearTimeout(timer);
            if (xhr.status >= 200 && xhr.status < 300) {
                if (callback) callback(true);
            } else {
                _log('Telemetry sync failed: HTTP ' + xhr.status, 'warn');
                var queue = loadQueue();
                queue.push(payload);
                saveQueue(queue);
                if (callback) callback(false);
            }
        };

        try {
            xhr.send(JSON.stringify(payload));
        } catch (e) {
            clearTimeout(timer);
            var queue = loadQueue();
            queue.push(payload);
            saveQueue(queue);
            if (callback) callback(false);
        }
    }

    function flushQueue(callback) {
        var queue = loadQueue();
        if (queue.length === 0) { if (callback) callback(); return; }

        var token = getAuthToken();
        if (!token) { if (callback) callback(); return; }

        // Keep queue in localStorage until all sends finish — only replace with remaining
        var remaining = [];
        var index = 0;

        function sendNext() {
            if (index >= queue.length) {
                // All done — save only failed items (or clear if all succeeded)
                if (remaining.length > 0) {
                    saveQueue(remaining);
                } else {
                    clearQueue();
                }
                if (callback) callback();
                return;
            }
            var payload = queue[index++];
            var xhr = new XMLHttpRequest();
            var timedOut = false;
            var timer = setTimeout(function () {
                timedOut = true;
                xhr.abort();
                remaining.push(payload);
                sendNext();
            }, 10000);

            xhr.open('POST', SYNC_ENDPOINT, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4 || timedOut) return;
                clearTimeout(timer);
                if (xhr.status < 200 || xhr.status >= 300) {
                    remaining.push(payload);
                }
                sendNext();
            };
            try {
                xhr.send(JSON.stringify(payload));
            } catch (e) {
                clearTimeout(timer);
                remaining.push(payload);
                sendNext();
            }
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
