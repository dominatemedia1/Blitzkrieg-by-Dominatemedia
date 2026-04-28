// js/analytics.js
// Fire-and-forget usage event tracking for Blitzkrieg plugin
(function () {
    'use strict';

    var sb = window.blitzkriegSupabase;
    var TABLE = 'blitzkrieg_usage_events';
    var viewedComps = {}; // Deduplication map: uniqueId -> true (per session)
    var _cachedGeo = null; // Cache geolocation to avoid redundant API calls

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

    /**
     * Fire-and-forget insert into blitzkrieg_usage_events.
     * Never blocks the UI; errors are console-logged only.
     */
    function track(eventType, data) {
        var userId = getUserId();
        if (!userId || !sb) return;

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

        sb.from(TABLE).insert(row).then(function (res) {
            if (res.error) {
                console.warn('Blitzkrieg analytics insert error:', res.error.message);
            }
        }).catch(function (err) {
            console.warn('Blitzkrieg analytics error:', err);
        });
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
     * Fire-and-forget insert into blitzkrieg_error_logs.
     * Throttled: max 50/session, dedup same message within 10s.
     */
    function reportError(message, level, context) {
        var userId = getUserId();
        if (!userId || !sb) return;
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

        sb.from('blitzkrieg_error_logs').insert(row).then(function(res) {
            if (res.error) console.warn('Blitzkrieg error report failed:', res.error.message);
        }).catch(function() {});
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

    function trackCategoryBrowse(category) {
        track('category_browse', { templateCategory: category });
    }

    function trackSessionStart() {
        viewedComps = {};
        fetchGeoData(function(geo) {
            track('session_start', { metadata: geo });
        });
    }

    function trackSessionEnd() {
        track('session_end', {});
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
    };
})();
