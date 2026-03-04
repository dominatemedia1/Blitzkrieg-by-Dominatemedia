// js/analytics.js
// Fire-and-forget usage event tracking for Blitzkrieg plugin
(function () {
    'use strict';

    var sb = window.blitzkriegSupabase;
    var TABLE = 'blitzkrieg_usage_events';
    var viewedComps = {}; // Deduplication map: uniqueId -> true (per session)

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
        viewedComps = {}; // Reset deduplication map on new session
        track('session_start', {});
    }

    function trackSessionEnd() {
        track('session_end', {});
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
    };
})();
