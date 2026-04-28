// js/main.js
(function () {
    'use strict';

    var csInterface = new CSInterface();
    var BLITZKRIEG_LOCAL_VERSION = '1.2.6';

    // CEP bridge detection — window.__adobe_cep__ is the native bridge to ExtendScript.
    // csInterface.evalScript is always a function (prototype), but it THROWS if __adobe_cep__ is missing.
    var _hasCepBridge = !!(window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === 'function');

    /**
     * Safe evalScript wrapper. Checks the CEP bridge before calling.
     * If bridge is missing, calls callback with error string or rejects.
     */
    function safeEvalScript(script, callback) {
        if (!_hasCepBridge) {
            // Re-check in case bridge appeared after initial load
            _hasCepBridge = !!(window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === 'function');
        }
        if (!_hasCepBridge) {
            if (callback) callback('EvalScript error.');
            return;
        }
        try {
            csInterface.evalScript(script, callback);
        } catch (e) {
            console.error('evalScript threw:', e.message);
            if (callback) callback('EvalScript error.');
        }
    }

    // Expose safeEvalScript for other modules (telemetry.js)
    window.safeEvalScript = safeEvalScript;

    // App / main elements
    var appContainer = document.getElementById('app');
    var pathDisplay = document.getElementById('library-path-display');
    var stashGrid = document.getElementById('stash-grid');
    var searchInput = document.getElementById('search-input');
    var categoryFiltersContainer = document.getElementById('category-filters');
    var loadingSpinner = document.getElementById('loading-spinner');

    // Modals
    var deleteModal = document.getElementById('delete-confirm-modal');
    var compToDeleteName = document.getElementById('comp-to-delete-name');
    var confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    var cancelDeleteBtn = document.getElementById('cancel-delete-btn');

    var addCompModal = document.getElementById('add-comp-modal');
    var existingCategorySelect = document.getElementById('existing-category-select');
    var newCategoryInput = document.getElementById('new-category-input');
    var confirmAddBtn = document.getElementById('confirm-add-btn');
    var cancelAddBtn = document.getElementById('cancel-add-btn');

    var renameModal = document.getElementById('rename-comp-modal');
    var compToRenameCurrentName = document.getElementById('comp-to-rename-current-name');
    var newNameInput = document.getElementById('new-name-input');
    var confirmRenameBtn = document.getElementById('confirm-rename-btn');
    var cancelRenameBtn = document.getElementById('cancel-rename-btn');

    // Category rename modal elements
    var renameCategoryModal = document.getElementById('rename-category-modal');
    var categoryToRenameCurrentName = document.getElementById('category-to-rename-current-name');
    var newCategoryNameInput = document.getElementById('new-category-name-input');
    var confirmRenameCategoryBtn = document.getElementById('confirm-rename-category-btn');
    var cancelRenameCategoryBtn = document.getElementById('cancel-rename-category-btn');

    // Category delete modal elements
    var deleteCategoryModal = document.getElementById('delete-category-modal');
    var categoryToDeleteName = document.getElementById('category-to-delete-name');
    var categoryToDeleteCount = document.getElementById('category-to-delete-count');
    var transferToCategorySelect = document.getElementById('transfer-to-category-select');
    var transferCategoryGroup = document.getElementById('transfer-category-group');
    var confirmDeleteCategoryBtn = document.getElementById('confirm-delete-category-btn');
    var cancelDeleteCategoryBtn = document.getElementById('cancel-delete-category-btn');

    // Move comp modal elements
    var moveCompModal = document.getElementById('move-comp-modal');
    var compToMoveName = document.getElementById('comp-to-move-name');
    var moveToCategorySelect = document.getElementById('move-to-category-select');
    var moveToNewCategoryInput = document.getElementById('move-to-new-category-input');
    var confirmMoveCompBtn = document.getElementById('confirm-move-comp-btn');
    var cancelMoveCompBtn = document.getElementById('cancel-move-comp-btn');

    // Bulk action modal elements
    var bulkMoveModal = document.getElementById('bulk-move-modal');
    var bulkMoveCount = document.getElementById('bulk-move-count');
    var bulkMoveCategorySelect = document.getElementById('bulk-move-category-select');
    var confirmBulkMoveBtn = document.getElementById('confirm-bulk-move-btn');
    var cancelBulkMoveBtn = document.getElementById('cancel-bulk-move-btn');
    var bulkDeleteModal = document.getElementById('bulk-delete-modal');
    var bulkDeleteCount = document.getElementById('bulk-delete-count');
    var confirmBulkDeleteBtn = document.getElementById('confirm-bulk-delete-btn');
    var cancelBulkDeleteBtn = document.getElementById('cancel-bulk-delete-btn');

    var creditBtn = document.getElementById('credit-button');
    var toastElement = document.getElementById('toast-notification');

    // Dropdown menu elements
    var dropdownContainer = document.getElementById('main-dropdown');
    var dropdownToggleBtn = document.getElementById('dropdown-toggle-btn');
    var dropdownMenu = document.getElementById('dropdown-menu');
    var dropdownRefresh = document.getElementById('dropdown-refresh');
    var dropdownSettings = document.getElementById('dropdown-settings');
    // Settings modal elements
    var settingsModal = document.getElementById('settings-modal');
    var settingsBrowseBtn = document.getElementById('settings-browse-btn');
    var settingsLibraryPath = document.getElementById('settings-library-path');
    var settingsCloseBtn = document.getElementById('settings-close-btn');
    var settingsSaveBtn = document.getElementById('settings-save-btn');

    var toastTimeout;
    var allComps = [];
    // Cached unique category list — invalidated on every allComps reassignment
    // via `_invalidateCategoryCache()` which `loadLibrary` calls. Six call-sites
    // used to recompute `Array.from(new Set(allComps.map(c=>c.category))).sort()`
    // on every keystroke / modal open / keyboard shortcut; caching eliminates
    // that O(n) work from the hot path.
    var _cachedCategoryList = null;
    function getUniqueCategories() {
        if (_cachedCategoryList) return _cachedCategoryList;
        var seen = {};
        var out = [];
        for (var cci = 0; cci < allComps.length; cci++) {
            var c = allComps[cci].category;
            if (c && !seen[c]) { seen[c] = 1; out.push(c); }
        }
        out.sort();
        _cachedCategoryList = out;
        return out;
    }
    function _invalidateCategoryCache() { _cachedCategoryList = null; }
    // Per-session view tracking dedupe — see stash-item mouseenter handler.
    var _trackedViewsThisSession = {};
    // Per-submission-id in-flight set — prevents double-click from firing two
    // parallel approve/withdraw/resubmit/reject pipelines against the same row.
    var _submissionInFlight = {};
    var activeCategory = 'All';
    var currentDeleteInfo = null;
    var currentRenameInfo = null;
    var currentCategoryRenameInfo = null;
    var currentCategoryDeleteInfo = null;
    var currentMoveCompInfo = null;
    var isLoading = false; // Prevents race conditions in async operations
    var pendingLibraryReload = false; // Deferred reload when loadLibrary is called while isLoading
    var stashInProgress = false; // Suppresses focus-triggered loads during stash/generate operations
    var bulkSelectedIds = new Set(); // Track selected items for bulk operations
    var bulkMode = false; // Whether bulk selection mode is active

    // Favorites and recent comps
    var favoriteComps = []; // Array of uniqueIds
    var recentComps = []; // Array of {uniqueId, timestamp}
    var MAX_RECENT_COMPS = 10;
    var cachedLibraryPath = null; // In-memory cache for library path

    // Drag and drop state
    var draggedComp = null;
    var dragOverCategory = null;

    // UI State - Sorting and Grid Size
    var currentSortOrder = 'name-asc'; // Default sort
    var currentGridSize = 'normal'; // Default grid size

    // UI Elements for sorting and grid
    var sortSelect = null;
    var gridSizeButtons = null;

    /* --------- Debug Log System --------- */
    var debugLogPanel = document.getElementById('debug-log-panel');
    var debugLogContent = document.getElementById('debug-log-content');
    var debugLogEntries = [];
    var MAX_LOG_ENTRIES = 200;

    /**
     * Logs a message to the in-panel debug log.
     * @param {string} message - Message to log
     * @param {string} level - 'info', 'warn', 'error', 'success'
     */
    var VALID_LOG_LEVELS = { info: 1, warn: 1, error: 1, success: 1 };

    function debugLog(message, level) {
        level = (level && VALID_LOG_LEVELS[level]) ? level : 'info';
        var time = new Date();
        var timeStr = ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2) + ':' + ('0' + time.getSeconds()).slice(-2) + '.' + ('00' + time.getMilliseconds()).slice(-3);
        var entry = { time: timeStr, message: String(message), level: level };
        debugLogEntries.push(entry);
        if (debugLogEntries.length > MAX_LOG_ENTRIES) debugLogEntries.shift();

        // Append to panel — but ONLY when the debug panel is actually visible.
        // Unconditionally appending DOM + setting scrollTop forces a layout recalc
        // per log call, which during batch generation (hundreds of logs/second)
        // becomes the single biggest source of jank. When the panel is hidden the
        // log is still captured in debugLogEntries above, so opening the panel later
        // would re-render from the in-memory buffer.
        if (debugLogContent && debugLogPanel && debugLogPanel.style.display !== 'none') {
            var div = document.createElement('div');
            div.className = 'log-entry';
            div.innerHTML = '<span class="log-time">' + timeStr + '</span><span class="log-' + level + '">' + escapeHTML(String(message)) + '</span>';
            debugLogContent.appendChild(div);
            debugLogContent.scrollTop = debugLogContent.scrollHeight;
        }

        // Also log to console
        if (level === 'error') console.error('Blitzkrieg:', message);
        else if (level === 'warn') console.warn('Blitzkrieg:', message);
        else console.log('Blitzkrieg:', message);

        // Auto-report errors and warnings to server
        if ((level === 'error' || level === 'warn') && window.blitzkriegAnalytics && window.blitzkriegAnalytics.reportError) {
            window.blitzkriegAnalytics.reportError(message, level, { source: 'debugLog' });
        }
    }

    function toggleDebugLog() {
        if (!debugLogPanel) return; // defensive — #debug-log-panel missing from DOM
        if (debugLogPanel.style.display === 'none') {
            debugLogPanel.style.display = 'flex';
            document.body.classList.add('debug-panel-open');
            // Rehydrate panel from the in-memory buffer — debugLog skips DOM work
            // when the panel is hidden for perf, so we need to catch up here.
            if (debugLogContent) {
                var html = '';
                for (var di = 0; di < debugLogEntries.length; di++) {
                    var de = debugLogEntries[di];
                    html += '<div class="log-entry"><span class="log-time">' + de.time + '</span><span class="log-' + de.level + '">' + escapeHTML(String(de.message)) + '</span></div>';
                }
                debugLogContent.innerHTML = html;
                debugLogContent.scrollTop = debugLogContent.scrollHeight;
            }
        } else {
            debugLogPanel.style.display = 'none';
            document.body.classList.remove('debug-panel-open');
        }
    }

    function initDebugLog() {
        var closeBtn = document.getElementById('debug-log-close');
        var clearBtn = document.getElementById('debug-log-clear');
        var copyBtn = document.getElementById('debug-log-copy');

        if (closeBtn) closeBtn.addEventListener('click', toggleDebugLog);
        if (clearBtn) clearBtn.addEventListener('click', function() {
            debugLogEntries = [];
            if (debugLogContent) debugLogContent.innerHTML = '';
        });
        if (copyBtn) copyBtn.addEventListener('click', function() {
            var text = debugLogEntries.map(function(e) { return e.time + ' [' + e.level.toUpperCase() + '] ' + e.message; }).join('\n');
            copyToClipboard(text);
            showToast('Bug log copied to clipboard.');
        });

        // Keyboard shortcut: Ctrl+Shift+D or Cmd+Shift+D to toggle debug log
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                toggleDebugLog();
            }
        });

        // Expose to window for dropdown access
        window.__blitzkriegToggleDebug = toggleDebugLog;
    }

    // Expose debugLog to cloud-library.js
    window._blitzLog = debugLog;

    /* --------- Performance Utilities --------- */

    /**
     * Debounce function - delays execution until after wait milliseconds
     * have elapsed since the last time the debounced function was invoked.
     * @param {function} func - Function to debounce
     * @param {number} wait - Wait time in milliseconds
     * @returns {function} - Debounced function
     */
    function debounce(func, wait) {
        var timeout;
        return function() {
            var context = this;
            var args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(function() {
                func.apply(context, args);
            }, wait);
        };
    }

    /**
     * Throttle function - limits function execution to once per limit milliseconds.
     * @param {function} func - Function to throttle
     * @param {number} limit - Minimum time between executions in milliseconds
     * @returns {function} - Throttled function
     */
    function throttle(func, limit) {
        var lastFunc;
        var lastRan;
        return function() {
            var context = this;
            var args = arguments;
            if (!lastRan) {
                func.apply(context, args);
                lastRan = Date.now();
            } else {
                clearTimeout(lastFunc);
                lastFunc = setTimeout(function() {
                    if ((Date.now() - lastRan) >= limit) {
                        func.apply(context, args);
                        lastRan = Date.now();
                    }
                }, limit - (Date.now() - lastRan));
            }
        };
    }

    // Debounced search function for better performance
    var debouncedRenderComps = debounce(function() {
        renderCompsGrid();
    }, 150);

    /* --------- Sorting Functions --------- */

    /**
     * Sort compositions based on current sort order
     * @param {Array} comps - Array of composition objects
     * @returns {Array} - Sorted array
     */
    function sortComps(comps) {
        var sorted = comps.slice(); // Create a copy

        switch (currentSortOrder) {
            case 'name-asc':
                sorted.sort(function(a, b) { return a.name.localeCompare(b.name); });
                break;
            case 'name-desc':
                sorted.sort(function(a, b) { return b.name.localeCompare(a.name); });
                break;
            case 'date-desc':
                // Use uniqueId which contains timestamp
                sorted.sort(function(a, b) {
                    var timeA = parseInt(a.uniqueId.split('_').pop()) || 0;
                    var timeB = parseInt(b.uniqueId.split('_').pop()) || 0;
                    return timeB - timeA;
                });
                break;
            case 'date-asc':
                sorted.sort(function(a, b) {
                    var timeA = parseInt(a.uniqueId.split('_').pop()) || 0;
                    var timeB = parseInt(b.uniqueId.split('_').pop()) || 0;
                    return timeA - timeB;
                });
                break;
            case 'duration-desc':
                sorted.sort(function(a, b) { return (b.duration || 0) - (a.duration || 0); });
                break;
            case 'duration-asc':
                sorted.sort(function(a, b) { return (a.duration || 0) - (b.duration || 0); });
                break;
            default:
                sorted.sort(function(a, b) { return a.name.localeCompare(b.name); });
        }

        return sorted;
    }

    /**
     * Handle sort order change
     * @param {string} newOrder - New sort order value
     */
    function handleSortChange(newOrder) {
        currentSortOrder = newOrder;
        // Save preference
        try {
            window.localStorage.setItem('blitzkrieg_sort_order', newOrder);
        } catch(e) {}
        renderCompsGrid();
    }

    /**
     * Handle grid size change
     * @param {string} newSize - New grid size (compact, normal, large)
     */
    function handleGridSizeChange(newSize) {
        currentGridSize = newSize;

        // Update grid class
        stashGrid.classList.remove('grid-compact', 'grid-normal', 'grid-large');
        stashGrid.classList.add('grid-' + newSize);

        // Update button states
        var buttons = document.querySelectorAll('.grid-size-btn');
        buttons.forEach(function(btn) {
            btn.classList.remove('active');
            if (btn.dataset.size === newSize) {
                btn.classList.add('active');
            }
        });

        // Save preference
        try {
            window.localStorage.setItem('blitzkrieg_grid_size', newSize);
        } catch(e) {}
    }

    /**
     * Initialize sorting and grid size controls
     */
    function initSortAndGridControls() {
        // Load saved preferences
        try {
            var savedSort = window.localStorage.getItem('blitzkrieg_sort_order');
            if (savedSort) {
                currentSortOrder = savedSort;
            }
            var savedGridSize = window.localStorage.getItem('blitzkrieg_grid_size');
            if (savedGridSize) {
                currentGridSize = savedGridSize;
            }
        } catch(e) {}

        // Initialize sort select
        sortSelect = document.getElementById('sort-select');
        if (sortSelect) {
            sortSelect.value = currentSortOrder;
            sortSelect.addEventListener('change', function() {
                handleSortChange(this.value);
            });
        }

        // Initialize grid size buttons
        var gridButtons = document.querySelectorAll('.grid-size-btn');
        gridButtons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                handleGridSizeChange(this.dataset.size);
            });
        });

        // Apply initial grid size
        handleGridSizeChange(currentGridSize);
    }

    /* --------- Persistent Settings Storage --------- */

    /**
     * Loads settings from file-based storage (more reliable than localStorage).
     * Falls back to localStorage if file load fails.
     * @param {function} callback - Called with settings object
     */
    function loadPersistentSettings(callback) {
        safeEvalScript('loadBlitzkriegSettings()', function(result) {
            try {
                var settings = JSON.parse(result || '{}');
                // Also sync to localStorage as cache
                if (settings.libraryPath) {
                    window.localStorage.setItem('ae_asset_stash_path', settings.libraryPath);
                }
                callback(settings);
            } catch (e) {
                console.warn('Blitzkrieg: Could not parse settings from file, using localStorage fallback');
                // Fallback to localStorage
                var path = window.localStorage.getItem('ae_asset_stash_path');
                callback({ libraryPath: path || null });
            }
        });
    }

    /**
     * Saves settings to file-based storage for persistence across AE restarts.
     * Also saves to localStorage as cache.
     * @param {object} settings - Settings object to save
     * @param {function} callback - Optional callback called with success status
     */
    function savePersistentSettings(settings, callback) {
        // Save to localStorage as cache
        if (settings.libraryPath) {
            window.localStorage.setItem('ae_asset_stash_path', settings.libraryPath);
            cachedLibraryPath = settings.libraryPath;
        }

        // Save to file for persistence
        var safeSettings = escapeForExtendScript(JSON.stringify(settings));
        safeEvalScript('saveBlitzkriegSettings("' + safeSettings + '")', function(result) {
            if (callback) {
                callback(result && result.indexOf('Success') === 0);
            }
        });
    }

    /**
     * Gets the current library path from cache, localStorage, or file.
     * @returns {string|null} - Library path or null
     */
    function getLibraryPath() {
        return cachedLibraryPath || window.localStorage.getItem('ae_asset_stash_path') || null;
    }

    /* --------- Utility / UI helpers --------- */

    /**
     * Safely escapes a string for use in ExtendScript evalScript calls.
     * Prevents injection attacks by properly escaping special characters.
     * @param {string} str - The string to escape
     * @returns {string} - Escaped string safe for ExtendScript
     */
    function escapeForExtendScript(str) {
        if (typeof str !== 'string') {
            str = String(str);
        }
        return str
            .replace(/\\/g, '\\\\')  // Escape backslashes first
            .replace(/"/g, '\\"')    // Escape double quotes
            .replace(/'/g, "\\'")    // Escape single quotes
            .replace(/\n/g, '\\n')   // Escape newlines
            .replace(/\r/g, '\\r')   // Escape carriage returns
            .replace(/\t/g, '\\t')   // Escape tabs
            .replace(/\u2028/g, '\\u2028')  // Escape Unicode line separator
            .replace(/\u2029/g, '\\u2029'); // Escape Unicode paragraph separator
    }

    /**
     * Safely escapes a string for use in HTML attributes.
     * Prevents XSS by encoding special HTML characters.
     * @param {string} str - The string to escape
     * @returns {string} - HTML-safe string
     */
    function escapeHTML(str) {
        if (typeof str !== 'string') {
            str = String(str);
        }
        var htmlEscapes = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return str.replace(/[&<>"']/g, function(char) {
            return htmlEscapes[char];
        });
    }

    /**
     * Validates that a path is a reasonable file system path.
     * @param {string} path - The path to validate
     * @returns {boolean} - True if path appears valid
     */
    function isValidPath(path) {
        if (!path || typeof path !== 'string') return false;
        // Check for null bytes or other dangerous characters
        if (path.indexOf('\0') !== -1) return false;
        // Reasonable length check
        if (path.length > 1000) return false;
        return true;
    }

    /**
     * Validates a user-provided name (category name, comp name).
     * Mirrors ExtendScript isValidName() for consistency.
     * @param {string} name - Name to validate
     * @returns {string|null} - Error message if invalid, null if valid
     */
    function validateName(name) {
        if (!name || typeof name !== 'string') return 'Name is required.';
        if (name.length > 255) return 'Name is too long (max 255 characters).';
        if (name.indexOf('\0') !== -1) return 'Name contains invalid characters.';
        if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) return 'Name cannot contain path separators.';
        if (name.indexOf('..') !== -1) return 'Name cannot contain "..".';
        // Block URL-encoded path separators
        if (/%2[fF]/.test(name) || /%5[cC]/.test(name)) return 'Name contains invalid encoded characters.';
        // Block leading/trailing dots and whitespace
        if (name !== name.trim()) return 'Name cannot have leading or trailing spaces.';
        if (name.charAt(0) === '.' || name.charAt(name.length - 1) === '.') return 'Name cannot start or end with a dot.';
        return null;
    }

    /**
     * Converts a local file system path to a proper file:// URL.
     * Handles cross-platform differences:
     * - macOS paths start with / (e.g., /Users/name/...) → file:///Users/name/...
     * - Windows paths start with drive letter (e.g., C:\...) → file:///C:/...
     * Encodes special characters that are invalid in URLs.
     * @param {string} path - File system path (fsName)
     * @returns {string} - Properly formatted file:// URL
     */
    function pathToFileUrl(path) {
        if (!path) return '';
        // Already a file:// URL — return as-is to avoid double-encoding
        if (path.indexOf('file://') === 0) return path;
        var normalized = path.replace(/\\/g, '/');
        // Detect already-encoded paths (contain %XX sequences like %20, %23)
        // If path has valid percent-encoding, skip re-encoding to prevent %20 → %2520
        var alreadyEncoded = /%[0-9A-Fa-f]{2}/.test(normalized);
        if (!alreadyEncoded) {
            // Encode characters that have special meaning in URLs but can appear in file paths
            normalized = normalized
                .replace(/%/g, '%25')   // Must be first to avoid double-encoding
                .replace(/ /g, '%20')   // Spaces (common in macOS paths like "Application Support")
                .replace(/#/g, '%23')   // Fragment separator
                .replace(/\?/g, '%3F') // Query string separator
                .replace(/"/g, '%22'); // Double quotes
        }
        // On macOS/Linux, paths start with / so file:// + /path = file:///path (correct)
        // On Windows, paths start with C:/ so file:/// + C:/path = file:///C:/path (correct)
        if (normalized.charAt(0) === '/') {
            return 'file://' + normalized;
        }
        return 'file:///' + normalized;
    }

    function showToast(message, isError) {
        if (toastTimeout) clearTimeout(toastTimeout);
        message = message.replace(/^(Success!|Success:|Error:)\s*/, '');
        toastElement.textContent = message;
        toastElement.className = 'show';
        if (isError) {
            toastElement.classList.add('error');
        } else {
            toastElement.classList.add('success');
        }
        toastTimeout = setTimeout(function () {
            toastElement.classList.remove('show');
        }, 4000);
    }

    function showSpinner() { loadingSpinner.style.display = 'block'; }
    function hideSpinner() { loadingSpinner.style.display = 'none'; }

    /* --------- App initialization --------- */
    function masterInit() {
        // Initialize debug log system first
        initDebugLog();
        debugLog('Blitzkrieg panel initializing...', 'info');
        debugLog('Platform: ' + navigator.platform, 'info');

        // CEP bridge diagnostic — critical for generation/import
        _hasCepBridge = !!(window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === 'function');
        debugLog('CEP bridge (window.__adobe_cep__): ' + (_hasCepBridge ? 'AVAILABLE' : 'NOT AVAILABLE'), _hasCepBridge ? 'success' : 'error');
        if (!_hasCepBridge) {
            debugLog('window.__adobe_cep__ = ' + typeof window.__adobe_cep__, 'error');
            debugLog('Import and generation require the CEP bridge. Generation/import will not work.', 'error');
        }

        // Log Supabase auth state for debugging template loading issues
        if (window.blitzkriegSupabase) {
            window.blitzkriegSupabase.auth.getSession().then(function(res) {
                if (res.data && res.data.session) {
                    debugLog('Supabase auth: logged in as ' + res.data.session.user.email, 'success');
                } else {
                    debugLog('Supabase auth: no active session — storage calls may fail', 'warn');
                }
            }).catch(function(err) {
                debugLog('Supabase auth check failed: ' + err.message, 'error');
            });
        }

        // Global error handler — catches uncaught exceptions
        window.onerror = function(msg, url, line, col, err) {
            if (window.blitzkriegAnalytics && window.blitzkriegAnalytics.reportError) {
                window.blitzkriegAnalytics.reportError(
                    String(msg),
                    'error',
                    { source: 'window.onerror', url: url, line: line, col: col, stack: err ? err.stack : '' }
                );
            }
        };

        // Unhandled promise rejection safety net. Without this, any .then() chain
        // missing a .catch (we audited and fixed several, but future regressions
        // are possible) silently disappears. This at least logs them to the debug
        // log + analytics so they're visible instead of invisible.
        window.addEventListener('unhandledrejection', function(e) {
            var reason = e && e.reason;
            var msg = (reason && reason.message) || String(reason);
            try { debugLog('Unhandled promise rejection: ' + msg, 'error'); } catch (logErr) {}
            if (window.blitzkriegAnalytics && window.blitzkriegAnalytics.reportError) {
                window.blitzkriegAnalytics.reportError(
                    msg,
                    'error',
                    { source: 'unhandledrejection', stack: (reason && reason.stack) || '' }
                );
            }
        });

        // Show logged-in user info in sidebar
        var userInfo = document.getElementById('sidebar-user-info');
        var userName = document.getElementById('sidebar-user-name');
        if (userInfo && userName && window.blitzkriegAuth) {
            var tm = window.blitzkriegAuth.getTeamMember();
            var user = window.blitzkriegAuth.getUser();
            if (tm) {
                userName.textContent = tm.full_name || (user ? user.email : '');
                userInfo.style.display = 'block';
            }
        }

        // Bind invite button
        var inviteBtn = document.getElementById('invite-blitzkrieg-btn');
        if (inviteBtn) {
            inviteBtn.addEventListener('click', function() {
                var inviteUrl = 'https://portal.dominatemedia.io/apply/blitzkrieg';
                // Add UTM params with referrer's name
                var tmRef = window.blitzkriegAuth ? window.blitzkriegAuth.getTeamMember() : null;
                if (tmRef && tmRef.full_name) {
                    var refName = tmRef.full_name.trim().toLowerCase().replace(/\s+/g, '-');
                    inviteUrl += '?utm_source=blitzkrieg&utm_medium=referral&utm_campaign=invite-a-friend&utm_content=' + encodeURIComponent(refName);
                }
                try {
                    // The sync try/catch only catches synchronous throws. The
                    // .writeText() promise rejection (permission denied, etc.)
                    // needs its own .catch or it becomes an unhandled rejection.
                    navigator.clipboard.writeText(inviteUrl).then(function() {
                        showToast('Invite link copied to clipboard!');
                    }, function() {
                        showToast('Invite link: ' + inviteUrl);
                    });
                } catch (e) {
                    // Fallback for CEP environments without clipboard API
                    showToast('Invite link: ' + inviteUrl);
                }
            });
        }

        // Show footer for all users, but adjust button text for non-admins
        var isAdmin = window.blitzkriegAuth && window.blitzkriegAuth.isAdmin();
        if (!isAdmin) {
            var addBtnSpan = document.querySelector('#add-comp-btn span');
            if (addBtnSpan) addBtnSpan.textContent = 'Submit Selected Comp';
        }

        // Show/hide admin-only sidebar sections
        var adminSections = document.querySelectorAll('.nav-section-admin-only');
        adminSections.forEach(function(sec) {
            sec.style.display = isAdmin ? '' : 'none';
        });

        // Show admin-only dropdown items
        if (isAdmin) {
            var adminDropdownItems = document.querySelectorAll('.admin-only-item');
            adminDropdownItems.forEach(function(item) { item.style.display = ''; });

            // Inject admin generate toolbar above grid
            var gridContainer = document.querySelector('.grid-container');
            if (gridContainer) {
                var adminBar = document.createElement('div');
                adminBar.id = 'admin-generate-bar';
                adminBar.className = 'admin-generate-bar';
                adminBar.innerHTML =
                    '<div class="admin-bar-content">' +
                        '<span class="admin-bar-label" id="admin-bar-label">Admin: Generate thumbnails + previews for templates</span>' +
                        '<button class="admin-bar-btn" id="admin-generate-missing-btn" title="Generate for templates missing thumbnails">' +
                            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
                            ' Generate Missing' +
                        '</button>' +
                        '<button class="admin-bar-btn admin-bar-btn-secondary" id="admin-generate-all-btn" title="Force regenerate ALL templates">' +
                            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>' +
                            ' Regenerate All' +
                        '</button>' +
                        '<button class="admin-bar-btn admin-bar-btn-secondary" id="admin-clear-cache-btn" title="Clear thumbnail cache and reload">' +
                            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>' +
                            ' Clear Cache' +
                        '</button>' +
                        '<button class="admin-bar-btn admin-bar-btn-select" id="admin-bulk-select-btn" title="Select multiple templates for bulk operations">' +
                            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
                            ' Select Mode' +
                        '</button>' +
                    '</div>' +
                    '<div class="admin-bar-progress" id="admin-bar-progress" style="display:none;">' +
                        '<div class="progress-track"><div class="progress-fill" id="generate-progress-bar"></div></div>' +
                        '<span class="progress-text" id="generate-progress-text">0/0</span>' +
                    '</div>';
                gridContainer.parentNode.insertBefore(adminBar, gridContainer);

                // Button handlers
                document.getElementById('admin-generate-missing-btn').addEventListener('click', function() {
                    document.getElementById('admin-bar-progress').style.display = 'flex';
                    generateAllMissingThumbnails(false);
                });
                document.getElementById('admin-generate-all-btn').addEventListener('click', function() {
                    document.getElementById('admin-bar-progress').style.display = 'flex';
                    generateAllMissingThumbnails(true);
                });
                document.getElementById('admin-clear-cache-btn').addEventListener('click', function() {
                    // Clear thumbnail blacklist
                    thumbBlacklist = {};
                    try { localStorage.removeItem('blitzkrieg_thumb_blacklist'); } catch(e) {}
                    // Clear metadata cache
                    window.cloudLibrary.invalidateCache();
                    showToast('Cache cleared. Reloading...');
                    loadLibrary();
                });
                document.getElementById('admin-bulk-select-btn').addEventListener('click', function() {
                    toggleBulkMode();
                });
            }
        }

        // Show/hide submission sections (visible to all users)
        loadSubmissionCounts();

        creditBtn.addEventListener('click', function (e) {
            e.preventDefault();
            if (csInterface && typeof csInterface.openURLInDefaultBrowser === 'function') {
                csInterface.openURLInDefaultBrowser('https://dominatemedia.io');
            }
        });

        // Initialize dropdown menu
        initDropdownMenu();

        // Initialize sorting and grid size controls
        initSortAndGridControls();

        // Auto-refresh library when panel gains focus (ensures categories stay in sync)
        // Debounced: 5-minute cooldown to avoid hammering Supabase on every AE focus switch
        var _lastFocusLoad = Date.now(); // Prevent immediate re-load after initial load
        var FOCUS_COOLDOWN = 5 * 60 * 1000; // 5 minutes
        window.addEventListener('focus', function() {
            if (stashInProgress) return;
            var now = Date.now();
            if (now - _lastFocusLoad < FOCUS_COOLDOWN) return;
            _lastFocusLoad = now;
            if (isLoading) {
                pendingLibraryReload = true;
            } else {
                loadLibrary();
            }
        });

        // Initialize app directly
        initializeAppLogic();
    }

    /* --------- Utility Functions --------- */
    function copyToClipboard(text) {
        // CEP's Chromium often lacks Clipboard API permissions, so navigator.clipboard.writeText
        // returns a rejected Promise. Always fall back to execCommand on failure.
        var fallback = function() {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {}, fallback);
        } else {
            fallback();
        }
    }

    /* --------- Dropdown Menu Functions --------- */
    function initDropdownMenu() {
        // Toggle dropdown on button click
        if (dropdownToggleBtn) {
            dropdownToggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                dropdownContainer.classList.toggle('open');
            });
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (dropdownContainer && !dropdownContainer.contains(e.target)) {
                dropdownContainer.classList.remove('open');
            }
        });

        // Close dropdown on escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && dropdownContainer) {
                dropdownContainer.classList.remove('open');
            }
        });

        // Refresh Library action — uses forceReload() so a deliberate user
        // click ALWAYS clears every cache layer (in-memory signed URLs,
        // localStorage metadata, cloud manifest) and fetches fresh. This is
        // the recovery path when the grid is undercounting templates.
        if (dropdownRefresh) {
            dropdownRefresh.addEventListener('click', function(e) {
                e.preventDefault();
                dropdownContainer.classList.remove('open');
                if (isLoading) {
                    pendingLibraryReload = true;
                    showToast('Already loading...');
                    return;
                }
                showToast('Reloading library from cloud...');
                isLoading = true;
                showSpinner();
                var t0 = Date.now();
                window.cloudLibrary.forceReload().then(function (comps) {
                    var elapsed = Date.now() - t0;
                    debugLog('forceReload: ' + comps.length + ' templates in ' + elapsed + 'ms', 'success');
                    allComps = comps;
                    _invalidateCategoryCache();
                    if (activeCategory === '__analytics') { renderCategories(); renderAnalyticsDashboard(); }
                    else if (activeCategory.indexOf('__submissions_') === 0) { renderCategories(); renderSubmissionsGrid(activeCategory.replace('__submissions_', '')); }
                    else if (activeCategory === '__review_pending') { renderCategories(); renderSubmissionsGrid('pending_review'); }
                    else { renderUI(); }
                    hideSpinner();
                    isLoading = false;
                    updateAdminBarLabel();
                    showToast('Library reloaded — ' + comps.length + ' templates.');
                }).catch(function (err) {
                    debugLog('forceReload failed: ' + (err && err.message || err), 'error');
                    showToast('Reload failed: ' + (err && err.message || 'unknown'), true);
                    hideSpinner();
                    isLoading = false;
                });
            });
        }

        // Settings action
        // Bug Log action
        var dropdownBuglog = document.getElementById('dropdown-buglog');
        if (dropdownBuglog) {
            dropdownBuglog.addEventListener('click', function(e) {
                e.preventDefault();
                dropdownContainer.classList.remove('open');
                toggleDebugLog();
                // Auto-run diagnostics when opening bug log
                runLibraryDiagnostics();
            });
        }

        // Generate Thumbnails action (admin-only)
        var dropdownGenerateThumbs = document.getElementById('dropdown-generate-thumbs');
        if (dropdownGenerateThumbs) {
            dropdownGenerateThumbs.addEventListener('click', function(e) {
                e.preventDefault();
                dropdownContainer.classList.remove('open');
                generateAllMissingThumbnails();
            });
        }

        // Sign Out action
        var dropdownSignOut = document.getElementById('dropdown-signout');
        if (dropdownSignOut) {
            dropdownSignOut.addEventListener('click', function(e) {
                e.preventDefault();
                dropdownContainer.classList.remove('open');
                if (window.blitzkriegAuth) {
                    window.blitzkriegAuth.signOut();
                }
            });
        }
    }

    /* --------- App initialization & core UI logic (kept original behavior) --------- */
    function initializeAppLogic() {
        debugLog('initializeAppLogic starting...', 'info');

        // Check if ExtendScript functions are available (only in CEP environment)
        // Wrapped in try/catch: CSInterface.evalScript may throw outside of Adobe CEP
        try {
            if (_hasCepBridge) {
                safeEvalScript('typeof getStashedComps', function(typeResult) {
                    debugLog('ExtendScript check: typeof getStashedComps = "' + typeResult + '"', typeResult === 'function' ? 'success' : 'error');
                    if (typeResult !== 'function') {
                        debugLog('CRITICAL: hostscript.jsx not loaded! Check for syntax errors in the ExtendScript file.', 'error');
                        showPlaceholder("Plugin script error. Press Cmd+Shift+D for bug log.");
                        // Auto-open bug log on critical error
                        if (debugLogPanel) {
                            debugLogPanel.style.display = 'flex';
                            document.body.classList.add('debug-panel-open');
                        }
                    }
                });
            }
        } catch (e) {
            debugLog('CEP environment not available (browser mode): ' + e.message, 'info');
        }

        // Load favorites and recent comps from localStorage
        loadFavoritesAndRecent();

        // Load templates from cloud storage
        loadLibrary();

        // removed main Browse button usage (it was removed from UI). Folder selection available in Settings.
        var addBtn = document.getElementById('add-comp-btn');
        addBtn.addEventListener('click', addSelectedComp);

        searchInput.addEventListener('input', debouncedRenderComps);

        // Debounced analytics tracking for search (1.5s debounce to capture intentional queries)
        var debouncedTrackSearch = debounce(function() {
            var q = searchInput.value;
            if (window.blitzkriegAnalytics && q && q.trim().length > 0) {
                window.blitzkriegAnalytics.trackSearch(q);
            }
        }, 1500);
        searchInput.addEventListener('input', debouncedTrackSearch);

        // Note: categoryFiltersContainer is inside sidebarNav, so the sidebarNav
        // click listener (below) already handles category clicks via event delegation
        stashGrid.addEventListener('click', handleStashGridClick);

        // Change event delegation for toggle switches (team management)
        stashGrid.addEventListener('change', function(e) {
            var input = e.target;
            if (!input || input.tagName !== 'INPUT') return;
            var action = input.dataset.analyticsAction;
            if (action === 'toggle-access' || action === 'toggle-admin') {
                handleToggleAccess(input.dataset.memberId, input.dataset.field, input.dataset.memberName, input);
            }
        });

        // Double-click to import
        stashGrid.addEventListener('dblclick', handleStashGridDoubleClick);

        // Add click listeners for sidebar navigation (including "All Templates" and category items)
        var sidebarNav = document.querySelector('.sidebar-nav');
        if (sidebarNav) {
            sidebarNav.addEventListener('click', handleCategoryClick);
        }

        cancelDeleteBtn.addEventListener('click', function () { deleteModal.style.display = 'none'; });
        confirmDeleteBtn.addEventListener('click', executeDelete);

        cancelAddBtn.addEventListener('click', function () { addCompModal.style.display = 'none'; });
        confirmAddBtn.addEventListener('click', executeAddComp);

        cancelRenameBtn.addEventListener('click', function () { renameModal.style.display = 'none'; currentRenameInfo = null; });
        confirmRenameBtn.addEventListener('click', executeRename);

        // Category rename modal handlers
        if (cancelRenameCategoryBtn) cancelRenameCategoryBtn.addEventListener('click', function () { renameCategoryModal.style.display = 'none'; currentCategoryRenameInfo = null; });
        if (confirmRenameCategoryBtn) confirmRenameCategoryBtn.addEventListener('click', executeCategoryRename);

        // Category delete modal handlers
        if (cancelDeleteCategoryBtn) cancelDeleteCategoryBtn.addEventListener('click', function () { deleteCategoryModal.style.display = 'none'; currentCategoryDeleteInfo = null; });
        if (confirmDeleteCategoryBtn) confirmDeleteCategoryBtn.addEventListener('click', executeCategoryDelete);

        // Move comp modal handlers
        if (cancelMoveCompBtn) cancelMoveCompBtn.addEventListener('click', function () { moveCompModal.style.display = 'none'; currentMoveCompInfo = null; });
        if (confirmMoveCompBtn) confirmMoveCompBtn.addEventListener('click', executeMoveComp);

        // Bulk action modal handlers
        if (cancelBulkMoveBtn) cancelBulkMoveBtn.addEventListener('click', function () { bulkMoveModal.style.display = 'none'; });
        if (confirmBulkMoveBtn) confirmBulkMoveBtn.addEventListener('click', executeBulkMove);
        if (cancelBulkDeleteBtn) cancelBulkDeleteBtn.addEventListener('click', function () { bulkDeleteModal.style.display = 'none'; });
        if (confirmBulkDeleteBtn) confirmBulkDeleteBtn.addEventListener('click', executeBulkDelete);

        // Submission detail modal handlers
        var submissionDetailModal = document.getElementById('submission-detail-modal');
        var submissionDetailClose = document.getElementById('submission-detail-close');
        if (submissionDetailClose) {
            submissionDetailClose.addEventListener('click', function() {
                if (submissionDetailModal) submissionDetailModal.style.display = 'none';
            });
        }
        // Click overlay background to close detail modal
        if (submissionDetailModal) {
            submissionDetailModal.addEventListener('click', function(e) {
                if (e.target === submissionDetailModal) submissionDetailModal.style.display = 'none';
            });
        }

        // Initialize keyboard shortcuts
        initKeyboardShortcuts();

        // New category inline form (sidebar)
        initNewCategoryForm();

        hideSpinner();
    }

    /**
     * Initialize the "New Category" inline form in the sidebar.
     * Creates an empty placeholder in Supabase storage to establish the folder.
     */
    function initNewCategoryForm() {
        var container = document.getElementById('new-category-inline');
        var toggleBtn = document.getElementById('new-category-toggle-btn');
        var form = document.getElementById('new-category-form');
        var input = document.getElementById('inline-new-category-input');
        var saveBtn = document.getElementById('inline-new-category-save');
        var cancelBtn = document.getElementById('inline-new-category-cancel');
        if (!container || !toggleBtn || !form || !input || !saveBtn || !cancelBtn) return;

        // Visible to any signed-in user — non-admins can create + rename
        // categories (delete still admin-only). If the user lacks
        // blitzkrieg_access the panel never renders, so getUser() is enough.
        function updateVisibility() {
            var hasAccess = window.blitzkriegAuth && window.blitzkriegAuth.getUser && !!window.blitzkriegAuth.getUser();
            container.style.display = hasAccess ? '' : 'none';
        }
        updateVisibility();
        // Re-check on auth changes
        window.addEventListener('blitzkrieg-auth-ready', updateVisibility);

        toggleBtn.addEventListener('click', function() {
            toggleBtn.style.display = 'none';
            form.style.display = '';
            input.value = '';
            input.focus();
        });

        cancelBtn.addEventListener('click', function() {
            form.style.display = 'none';
            toggleBtn.style.display = '';
        });

        function createCategory() {
            // Double-click guard — prevents a fast second Enter/click from firing
            // two parallel placeholder uploads back-to-back (upsert makes storage
            // idempotent but the analytics trackAccessChange still fires twice).
            if (createCategory._running) return;
            var name = input.value.trim();
            if (!name) {
                showToast('Category name cannot be empty.', true);
                return;
            }
            var nameErr = validateName(name);
            if (nameErr) {
                showToast(nameErr, true);
                return;
            }
            // Check if category already exists — do this BEFORE setting
            // _running so a duplicate name doesn't soft-lock the form.
            var existing = allComps.some(function(c) { return c.category.toLowerCase() === name.toLowerCase(); });
            if (existing) {
                showToast('Category "' + name + '" already exists.', true);
                return;
            }

            var sb = window.blitzkriegSupabase;
            if (!sb) {
                showToast('Not connected to cloud.', true);
                return;
            }

            createCategory._running = true;
            if (saveBtn) saveBtn.disabled = true;
            showToast('Creating category "' + name + '"...');
            // Upload a placeholder file to create the folder in Supabase storage
            var placeholder = new Blob([''], { type: 'text/plain' });
            function _createDone() {
                createCategory._running = false;
                if (saveBtn) saveBtn.disabled = false;
            }
            sb.storage.from('blitzkrieg').upload(name + '/.emptyFolderPlaceholder', placeholder, {
                contentType: 'text/plain',
                upsert: true,
            }).then(function(result) {
                _createDone();
                if (result.error) {
                    showToast('Failed to create category: ' + result.error.message, true);
                    return;
                }
                form.style.display = 'none';
                toggleBtn.style.display = '';
                showToast('Category "' + name + '" created!');
                window.cloudLibrary.invalidateCache();
                loadLibrary();
            }).catch(function(err) {
                // Network failure / RLS rejection — without this catch the user
                // would see "Creating category..." stuck forever with no feedback.
                _createDone();
                showToast('Failed to create category: ' + (err && err.message || err), true);
            });
        }

        saveBtn.addEventListener('click', createCategory);
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); createCategory(); }
            if (e.key === 'Escape') { form.style.display = 'none'; toggleBtn.style.display = ''; }
        });
    }

    function loadLibrary() {
        if (isLoading) {
            pendingLibraryReload = true;
            return;
        }
        isLoading = true;
        pendingLibraryReload = false;
        showSpinner();

        var loadStart = Date.now();
        debugLog('loadLibrary: Loading templates from cloud...', 'info');

        window.cloudLibrary.listTemplates().then(function (comps) {
            var elapsed = Date.now() - loadStart;
            debugLog('loadLibrary: Loaded ' + comps.length + ' templates from cloud in ' + elapsed + 'ms', comps.length > 0 ? 'success' : 'warn');
            allComps = comps;
            _invalidateCategoryCache();
            // Only render template grid if we're on a template view.
            // Do NOT overwrite analytics, submissions, or review views.
            if (activeCategory === '__analytics') {
                renderCategories();
                renderAnalyticsDashboard();
            } else if (activeCategory.indexOf('__submissions_') === 0) {
                renderCategories();
                renderSubmissionsGrid(activeCategory.replace('__submissions_', ''));
            } else if (activeCategory === '__review_pending') {
                renderCategories();
                renderSubmissionsGrid('pending_review');
            } else {
                renderUI();
            }
            hideSpinner();
            isLoading = false;

            // Update admin bar with missing thumbnail count
            updateAdminBarLabel();

            if (pendingLibraryReload) {
                pendingLibraryReload = false;
                loadLibrary();
            }
        }).catch(function (err) {
            var elapsed = Date.now() - loadStart;
            debugLog('loadLibrary: ERROR after ' + elapsed + 'ms - ' + err.message, 'error');
            if (err.stack) debugLog('loadLibrary: stack: ' + err.stack.split('\n').slice(0, 3).join(' | '), 'error');
            showToast('Failed to load templates: ' + err.message, true);
            hideSpinner();
            isLoading = false;
            // Honour any reload that was queued during the failed load — but with a
            // 2-second backoff to prevent an infinite retry storm when the network
            // is persistently down (the previous version hammered Supabase in a
            // tight loop and drowned the user in error toasts).
            if (pendingLibraryReload) {
                pendingLibraryReload = false;
                setTimeout(function() { loadLibrary(); }, 2000);
            }
        });
    }

    /**
     * Runs library diagnostics and logs detailed folder structure info to the debug log.
     */
    function runLibraryDiagnostics() {
        debugLog('Diagnostics: Cloud library mode', 'info');
        debugLog('CEP bridge: ' + (_hasCepBridge ? 'Available' : 'NOT available — import/generate disabled'), _hasCepBridge ? 'success' : 'error');
        debugLog('Templates loaded: ' + allComps.length, 'info');
        var categories = {};
        allComps.forEach(function(c) { categories[c.category] = (categories[c.category] || 0) + 1; });
        Object.keys(categories).sort().forEach(function(cat) { debugLog('  ' + cat + ': ' + categories[cat], 'info'); });
        var libraryPath = getLibraryPath();
        if (!libraryPath) {
            return;
        }
        debugLog('Running diagnostics for: ' + libraryPath, 'info');
        debugLog('Platform: ' + navigator.platform + ' | UserAgent: ' + navigator.userAgent.substring(0, 80), 'info');
        var safePath = escapeForExtendScript(libraryPath);

        // First test: can we even call ExtendScript?
        safeEvalScript('typeof getStashedComps', function(typeResult) {
            debugLog('ExtendScript function check: typeof getStashedComps = "' + typeResult + '"', typeResult === 'function' ? 'success' : 'error');

            if (typeResult !== 'function') {
                debugLog('CRITICAL: hostscript.jsx functions not loaded! ExtendScript may have a syntax error.', 'error');
                // Try to get the actual error
                safeEvalScript('try { eval("getStashedComps"); "ok"; } catch(e) { e.toString(); }', function(errResult) {
                    debugLog('ExtendScript error detail: ' + errResult, 'error');
                });
                return;
            }

            // Run the full diagnostic
            safeEvalScript('debugLibrary("' + safePath + '")', function(result) {
                try {
                    var cleaned = result.replace(/^\ufeff/, '').replace(/\0/g, '').trim();
                    var info = JSON.parse(cleaned);
                    debugLog('Diagnostics result:', 'info');
                    debugLog('  Platform: ' + (info.platform || 'unknown'), 'info');
                    debugLog('  AE Version: ' + (info.aeVersion || 'unknown'), 'info');
                    debugLog('  Library exists: ' + info.exists, info.exists ? 'success' : 'error');
                    debugLog('  Resolved path: ' + (info.resolvedPath || 'N/A'), 'info');
                    debugLog('  Total items in folder: ' + (info.totalItems || 0), 'info');
                    if (info.categories) {
                        debugLog('  Categories found: ' + info.categories.length, info.categories.length > 0 ? 'success' : 'warn');
                        for (var ci = 0; ci < info.categories.length; ci++) {
                            var cat = info.categories[ci];
                            debugLog('    [' + cat.name + '] - ' + cat.compFolders.length + ' comp folders', 'info');
                            for (var cj = 0; cj < cat.compFolders.length; cj++) {
                                var cmp = cat.compFolders[cj];
                                if (!cmp.isTemplate) {
                                    // Non-template folder (assets, presets, plugins, fonts, grouping folders)
                                    debugLog('      ' + cmp.name + ' - non-template folder (skipped) Files:[' + cmp.files.slice(0, 5).join(', ') + (cmp.files.length > 5 ? ', ... +' + (cmp.files.length - 5) + ' more' : '') + ']', 'info');
                                } else {
                                    var status = cmp.hasAep ? 'OK' : 'MISSING .aep!';
                                    debugLog('      ' + cmp.name + ' - AEP:' + cmp.hasAep + ' Meta:' + cmp.hasMetadata + ' Thumb:' + cmp.hasThumbnail + ' Files:[' + cmp.files.join(', ') + '] ' + status, cmp.hasAep ? 'success' : 'error');
                                }
                            }
                        }
                    }
                    if (info.errors && info.errors.length > 0) {
                        for (var ei = 0; ei < info.errors.length; ei++) {
                            debugLog('  ERROR: ' + info.errors[ei], 'error');
                        }
                    }
                } catch (e) {
                    debugLog('Failed to parse diagnostics: ' + e.toString(), 'error');
                    debugLog('Raw diagnostic result: ' + (result ? result.substring(0, 500) : '(null)'), 'error');
                }
            });
        });
    }
    // Expose to window
    window.__blitzkriegDebug = runLibraryDiagnostics;
    window.__blitzkriegToggleDebug = toggleDebugLog;

    function renderUI() { updateNavActiveState(); renderCategories(); renderCompsGrid(); }

    function renderCategories() {
        // Get unique categories from loaded comps (cached)
        var categories = getUniqueCategories();

        // Update the "All Templates" nav item in sidebar
        var allTemplatesItem = document.querySelector('.nav-item[data-category="All"]');
        if (allTemplatesItem) {
            if (activeCategory === 'All') {
                allTemplatesItem.classList.add('active');
            } else {
                allTemplatesItem.classList.remove('active');
            }
            // Update count badge
            var existingCount = allTemplatesItem.querySelector('.nav-count');
            if (existingCount) {
                existingCount.textContent = allComps.length;
            } else if (allComps.length > 0) {
                var countBadge = document.createElement('span');
                countBadge.className = 'nav-count';
                countBadge.textContent = allComps.length;
                allTemplatesItem.appendChild(countBadge);
            }
        }

        // Render categories in the sidebar — rename is open to any signed-in
        // user (non-admins can re-organise), delete stays admin-only.
        // Pre-compute category counts in a single O(n) pass instead of O(categories × allComps)
        // (the previous nested filter was the dominant cost when re-rendering 248 comps).
        var sidebarIsAdmin = window.blitzkriegAuth && window.blitzkriegAuth.isAdmin();
        var sidebarSignedIn = window.blitzkriegAuth && window.blitzkriegAuth.getUser && !!window.blitzkriegAuth.getUser();
        var _categoryCounts = {};
        for (var _cci = 0; _cci < allComps.length; _cci++) {
            var _ccCat = allComps[_cci].category;
            _categoryCounts[_ccCat] = (_categoryCounts[_ccCat] || 0) + 1;
        }
        categoryFiltersContainer.innerHTML = categories.map(function(cat) {
            var safeCat = escapeHTML(cat);
            var count = _categoryCounts[cat] || 0;
            var isActive = cat === activeCategory;
            var renameBtnHtml = sidebarSignedIn ? (
                '<button class="nav-action-btn rename-category-btn" title="Rename category">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>' +
                '</button>'
            ) : '';
            var deleteBtnHtml = sidebarIsAdmin ? (
                '<button class="nav-action-btn delete-category-btn" title="Delete category">' +
                    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
                '</button>'
            ) : '';
            var actionBtns = (renameBtnHtml || deleteBtnHtml) ? (
                '<div class="nav-item-actions">' + renameBtnHtml + deleteBtnHtml + '</div>'
            ) : '';
            return '<div class="nav-item' + (isActive ? ' active' : '') + '" data-category="' + safeCat + '" draggable="false">' +
                '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>' +
                '</svg>' +
                '<span class="nav-label">' + safeCat + '</span>' +
                '<span class="nav-count">' + count + '</span>' +
                actionBtns +
            '</div>';
        }).join('');

        // Add archive entries (RAR/ZIP files in bucket root that need extraction)
        var archives = window.cloudLibrary.getArchives ? window.cloudLibrary.getArchives() : [];
        if (archives.length > 0) {
            var archiveHtml = archives.map(function(a) {
                var safeName = escapeHTML(a.name);
                var displayName = a.name.replace(/\.(rar|zip|7z)$/i, '');
                var sizeStr = a.size > 1073741824 ? (a.size / 1073741824).toFixed(1) + ' GB' :
                              a.size > 1048576 ? (a.size / 1048576).toFixed(0) + ' MB' : '';
                return '<div class="nav-item archive-item" data-archive="' + safeName + '" title="Archive — click to download">' +
                    '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                        '<path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><path d="M10 12h4"></path>' +
                    '</svg>' +
                    '<span class="nav-label">' + escapeHTML(displayName) + '</span>' +
                    '<span class="nav-count archive-badge">' + (sizeStr || 'RAR') + '</span>' +
                '</div>';
            }).join('');
            categoryFiltersContainer.insertAdjacentHTML('beforeend', archiveHtml);

            // Add click handlers for archive items
            categoryFiltersContainer.querySelectorAll('.archive-item').forEach(function(item) {
                item.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var archiveName = item.dataset.archive;
                    showToast('Getting download link for ' + archiveName + '...');
                    window.cloudLibrary.getArchiveDownloadUrl(archiveName).then(function(url) {
                        if (csInterface && typeof csInterface.openURLInDefaultBrowser === 'function') {
                            csInterface.openURLInDefaultBrowser(url);
                        } else {
                            window.open(url, '_blank');
                        }
                        showToast('Download started for ' + archiveName);
                    }).catch(function(err) {
                        showToast('Failed to get download link: ' + err.message, true);
                    });
                });
            });
        }

        // Add event listeners for category actions
        var categoryItems = categoryFiltersContainer.querySelectorAll('.nav-item:not(.archive-item)');
        categoryItems.forEach(function(item) {
            var categoryName = item.dataset.category;

            // Rename button
            var renameBtn = item.querySelector('.rename-category-btn');
            if (renameBtn) {
                renameBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    promptCategoryRename(categoryName);
                });
            }

            // Delete button
            var deleteBtn = item.querySelector('.delete-category-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    promptCategoryDelete(categoryName);
                });
            }

            // Drag and drop for moving comps
            item.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                item.classList.add('drag-over');
            });

            item.addEventListener('dragleave', function(e) {
                item.classList.remove('drag-over');
            });

            item.addEventListener('drop', function(e) {
                e.preventDefault();
                item.classList.remove('drag-over');
                if (draggedComp) {
                    var targetCategory = item.dataset.category;
                    if (targetCategory && targetCategory !== draggedComp.category) {
                        executeMoveCompDirect(draggedComp.uniqueId, draggedComp.category, targetCategory, draggedComp.name);
                    }
                }
                draggedComp = null;
            });
        });
    }

    // Preview animation state - optimized with requestAnimationFrame
    var previewAnimations = {};
    var currentlyAnimatingId = null; // Track current animation to limit to 1 at a time

    // MEMORY OPTIMIZATION: Single IntersectionObserver instance, reused across renders
    var lazyLoadObserver = null;

    /**
     * Get or create the lazy loading observer (singleton pattern)
     * @returns {IntersectionObserver|null}
     */
    function getLazyLoadObserver() {
        if (!('IntersectionObserver' in window)) {
            return null;
        }

        if (!lazyLoadObserver) {
            // Use .grid-container as root since it's the scrolling ancestor.
            // Without this, images inside the scrollable grid may never
            // intersect the default viewport root, causing thumbnails to not load.
            var scrollRoot = document.querySelector('.grid-container') || null;
            lazyLoadObserver = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting) {
                        var img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            img.classList.remove('lazy-thumb');
                            lazyLoadObserver.unobserve(img);
                        }
                    }
                });
            }, {
                root: scrollRoot,
                rootMargin: '200px',
                threshold: 0.01
            });
        }

        return lazyLoadObserver;
    }

    /**
     * Calculate dynamic frame interval based on composition duration
     * This ensures the preview plays at the correct speed to show the FULL animation
     * @param {number} duration - Composition duration in seconds
     * @param {number} frameCount - Number of preview frames
     * @returns {number} - Milliseconds between frames
     */
    function calculateFrameInterval(duration, frameCount) {
        if (!duration || duration <= 0 || !frameCount || frameCount <= 1) {
            return 100; // Default fallback
        }
        // Calculate interval to match actual duration
        var interval = (duration * 1000) / frameCount;
        // Clamp to reasonable range: 50ms min (20 FPS max), 250ms max (4 FPS min)
        return Math.max(50, Math.min(250, interval));
    }

    /**
     * OPTIMIZED: Starts playing preview animation on hover
     * Uses requestAnimationFrame for smoother animations and better CPU usage
     * Now plays at correct speed to show FULL animation duration
     * @param {HTMLElement} thumbnailContainer - The thumbnail container element
     * @param {Array} previewFrames - Array of preview frame paths
     * @param {string} uniqueId - Unique identifier for this comp
     * @param {number} duration - Composition duration in seconds (optional)
     */
    function startPreviewAnimation(thumbnailContainer, previewFrames, uniqueId, duration) {
        if (!previewFrames || previewFrames.length === 0) return;

        var img = thumbnailContainer.querySelector('.comp-thumbnail');
        if (!img) return;

        // MEMORY OPTIMIZATION: Stop any OTHER running animation (limit to 1 concurrent)
        if (currentlyAnimatingId && currentlyAnimatingId !== uniqueId) {
            var otherContainer = document.querySelector('[data-unique-id="' + currentlyAnimatingId + '"] .thumbnail');
            if (otherContainer) {
                stopPreviewAnimation(otherContainer, currentlyAnimatingId);
            } else {
                // Cleanup orphaned animation
                if (previewAnimations[currentlyAnimatingId]) {
                    if (previewAnimations[currentlyAnimatingId].stop) previewAnimations[currentlyAnimatingId].stop();
                    if (previewAnimations[currentlyAnimatingId].rafId) cancelAnimationFrame(previewAnimations[currentlyAnimatingId].rafId);
                    delete previewAnimations[currentlyAnimatingId];
                }
            }
        }

        // Stop any existing animation for this item
        if (previewAnimations[uniqueId]) {
            stopPreviewAnimation(thumbnailContainer, uniqueId);
        }

        currentlyAnimatingId = uniqueId;

        var frameIndex = 0;
        var originalSrc = img.src;
        var lastFrameTime = 0;
        var isRunning = true;

        // DYNAMIC PLAYBACK: Calculate interval to match actual composition duration
        var frameInterval = calculateFrameInterval(duration, previewFrames.length);

        // Store original src for restoration
        img.dataset.originalSrc = originalSrc;

        // Pre-convert frame paths to proper URLs (handle both file paths and HTTP URLs)
        var frameSrcs = previewFrames.map(function(path) {
            if (typeof path === 'string' && (path.indexOf('http://') === 0 || path.indexOf('https://') === 0)) {
                return path; // Already a URL (cloud preview frames)
            }
            return pathToFileUrl(path);
        });

        // Add preview indicator
        var indicator = thumbnailContainer.querySelector('.preview-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'preview-indicator';
            indicator.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
            thumbnailContainer.appendChild(indicator);
        }
        indicator.classList.add('playing');

        // Animation loop using requestAnimationFrame with DYNAMIC frame interval.
        // We also bail if the previewAnimations entry has been deleted (e.g. card
        // was removed from DOM during a renderUI() before stopPreviewAnimation
        // had a chance to run) — without this, the rAF chains forever and the
        // closure leaks the previewFrames array + image element.
        function animate(timestamp) {
            if (!isRunning) return;
            if (!previewAnimations[uniqueId]) return;

            if (timestamp - lastFrameTime >= frameInterval) {
                img.src = frameSrcs[frameIndex];
                frameIndex = (frameIndex + 1) % frameSrcs.length;
                lastFrameTime = timestamp;
            }

            previewAnimations[uniqueId].rafId = requestAnimationFrame(animate);
        }

        previewAnimations[uniqueId] = {
            rafId: requestAnimationFrame(animate),
            stop: function() { isRunning = false; }
        };
    }

    /**
     * OPTIMIZED: Stops preview animation and restores original thumbnail
     * @param {HTMLElement} thumbnailContainer - The thumbnail container element
     * @param {string} uniqueId - Unique identifier for this comp
     */
    function stopPreviewAnimation(thumbnailContainer, uniqueId) {
        // Clear currently animating tracker
        if (currentlyAnimatingId === uniqueId) {
            currentlyAnimatingId = null;
        }

        // Clear animation
        if (previewAnimations[uniqueId]) {
            if (previewAnimations[uniqueId].stop) {
                previewAnimations[uniqueId].stop();
            }
            if (previewAnimations[uniqueId].rafId) {
                cancelAnimationFrame(previewAnimations[uniqueId].rafId);
            }
            delete previewAnimations[uniqueId];
        }

        var img = thumbnailContainer.querySelector('.comp-thumbnail');
        if (img && img.dataset.originalSrc) {
            img.src = img.dataset.originalSrc;
        }

        // Remove playing indicator
        var indicator = thumbnailContainer.querySelector('.preview-indicator');
        if (indicator) {
            indicator.classList.remove('playing');
        }
    }

    // Track thumbnail 404s to avoid retrying on re-render (persists in localStorage)
    var thumbBlacklist = {};
    try {
        var bl = localStorage.getItem('blitzkrieg_thumb_blacklist');
        if (bl) thumbBlacklist = JSON.parse(bl);
    } catch(e) {}

    // Debounced localStorage write — during a cold load with many missing thumbs,
    // every broken image used to fire a full JSON.stringify+setItem (O(n²) growth
    // in serialization cost). Now we batch writes within a 250ms window so a flurry
    // of broken-image events results in one localStorage write.
    var _blacklistFlushTimer = null;
    function _flushBlacklist() {
        _blacklistFlushTimer = null;
        try { localStorage.setItem('blitzkrieg_thumb_blacklist', JSON.stringify(thumbBlacklist)); } catch(e) {}
    }
    function blacklistThumb(storagePath) {
        thumbBlacklist[storagePath] = 1;
        if (_blacklistFlushTimer) clearTimeout(_blacklistFlushTimer);
        _blacklistFlushTimer = setTimeout(_flushBlacklist, 250);
    }

    function updateAdminBarLabel() {
        var label = document.getElementById('admin-bar-label');
        if (!label) return;
        var cloudComps = allComps.filter(function(c) { return !!c.storagePath; });
        var missing = cloudComps.filter(function(c) {
            if (!c.thumbnailVerified) return true;
            if (thumbBlacklist[c.storagePath]) return true;
            return false;
        }).length;
        var noPreview = cloudComps.filter(function(c) {
            return !c.previewFrameCount;
        }).length;
        if (missing === 0 && noPreview === 0) {
            label.textContent = 'All ' + cloudComps.length + ' templates have thumbnails + previews';
        } else {
            var parts = [];
            if (missing > 0) parts.push(missing + ' missing thumbnails');
            if (noPreview > 0) parts.push(noPreview + ' missing previews');
            label.textContent = parts.join(', ') + ' — click Generate to fix';
        }
    }

    /**
     * Build HTML string for a single comp card (extracted for reuse in pagination)
     */
    function buildCompCardHtml(comp) {
        var safeUniqueId = escapeHTML(comp.uniqueId);
        var safeCategory = escapeHTML(comp.category);
        var safeAepPath = escapeHTML(comp.aepPath || '');
        var safeStoragePath = escapeHTML(comp.storagePath || '');
        var safeName = escapeHTML(comp.name);
        var thumbSrc = comp.thumbUrl || (comp.thumbPath ? pathToFileUrl(comp.thumbPath) : '');
        var thumbSrcAlt = comp.thumbUrlAlt || '';
        // Skip thumbnail if BOTH URLs previously 404'd
        if (thumbSrc && comp.storagePath && thumbBlacklist[comp.storagePath]) {
            thumbSrc = '';
            thumbSrcAlt = '';
        }
        var safeThumbSrc = escapeHTML(thumbSrc);
        var safeThumbSrcAlt = escapeHTML(thumbSrcAlt);

        // previewFrames can be: array of signed URLs (local), or null (cloud, lazy-signed)
        var hasPreviewUrls = comp.previewFrames && comp.previewFrames.length > 0;
        var hasPreview = hasPreviewUrls || (comp.previewFrameCount > 0);
        var previewDataAttr = hasPreviewUrls ? ' data-preview-frames="' + escapeHTML(JSON.stringify(comp.previewFrames)) + '"' : '';
        var durationAttr = comp.duration ? ' data-duration="' + comp.duration + '"' : '';
        var previewClass = hasPreview ? ' has-preview' : '';

        var isAdmin = window.blitzkriegAuth && window.blitzkriegAuth.isAdmin();
        var isBlacklisted = comp.storagePath && thumbBlacklist[comp.storagePath];
        var generatePreviewBtn = '';
        if (comp.storagePath && isAdmin && (!comp.thumbnailVerified || isBlacklisted)) {
            // Cloud template: admin can generate thumbnail (show when not verified or blacklisted)
            generatePreviewBtn = '<button class="generate-preview-btn" title="Generate Thumbnail + Preview"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Generate</button>';
        } else if (!hasPreview && !comp.thumbnailVerified && comp.storagePath) {
            generatePreviewBtn = '<button class="generate-preview-btn" title="Generate Thumbnail"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Thumb</button>';
        } else if (!hasPreview && !comp.storagePath) {
            generatePreviewBtn = '<button class="generate-preview-btn" title="Generate Preview Animation"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Preview</button>';
        }

        var safeName_ = comp.name || '?';
        var nameInitial = safeName_.charAt(0).toUpperCase();
        var placeholderColors = ['#1e3a5f','#2d4a3e','#3d2c5e','#4a2c2c','#2c3e50','#1a472a','#3b1f2b','#2c3e6b'];
        var colorIdx = 0;
        for (var ci2 = 0; ci2 < safeName_.length; ci2++) { colorIdx += safeName_.charCodeAt(ci2); }
        var placeholderColor = placeholderColors[colorIdx % placeholderColors.length];
        var placeholderHtml = '<div class="thumb-placeholder" style="background-color:' + placeholderColor + '"><span class="thumb-placeholder-initial">' + escapeHTML(nameInitial) + '</span></div>';

        var altAttr = safeThumbSrcAlt ? ' data-src-alt="' + safeThumbSrcAlt + '"' : '';
        var thumbHtml = thumbSrc
            ? '<img data-src="' + safeThumbSrc + '"' + altAttr + ' alt="Thumbnail" class="comp-thumbnail lazy-thumb" loading="lazy">' + placeholderHtml
            : placeholderHtml;

        var isFav = isFavorite(comp.uniqueId);
        var favClass = isFav ? ' is-favorite' : '';
        var favTitle = isFav ? 'Remove from favorites' : 'Add to favorites';
        var favFill = isFav ? 'currentColor' : 'none';

        var adminBtns = isAdmin ? (
                '<button class="action-btn move-btn" title="Move to category"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><polyline points="9 14 12 11 15 14"></polyline></svg></button>' +
                '<button class="action-btn rename-btn" title="Rename"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>' +
                '<button class="action-btn delete-btn" title="Delete"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>'
        ) : '';

        var previewCountAttr = comp.previewFrameCount ? ' data-preview-count="' + comp.previewFrameCount + '"' : '';

        var bulkCheckbox = isAdmin ? '<div class="bulk-select-checkbox" data-unique-id="' + safeUniqueId + '"></div>' : '';

        return '<div class="stash-item' + previewClass + favClass + '" data-unique-id="' + safeUniqueId + '" data-category="' + safeCategory + '" data-aep-path="' + safeAepPath + '" data-storage-path="' + safeStoragePath + '" data-name="' + safeName + '"' + previewDataAttr + durationAttr + previewCountAttr + ' draggable="true">' +
            bulkCheckbox +
            '<div class="item-actions">' +
                '<button class="action-btn favorite-btn" title="' + favTitle + '"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="' + favFill + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></button>' +
                adminBtns +
            '</div>' +
            '<div class="thumbnail">' +
                thumbHtml +
                (hasPreview ? '<div class="preview-indicator"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>' : '') +
                generatePreviewBtn +
            '</div>' +
            '<div class="item-info">' +
                '<p class="item-name" title="' + safeName + '">' + safeName + '</p>' +
                '<button class="import-btn"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>Import</span></button>' +
            '</div>' +
        '</div>';
    }

    function renderCompsGrid() {
        // Guard: if a special view is active, delegate and don't render template cards
        var adminBar = document.getElementById('admin-generate-bar');
        if (activeCategory === '__analytics') {
            if (adminBar) adminBar.style.display = 'none';
            renderAnalyticsDashboard();
            return;
        }
        if (activeCategory.indexOf('__submissions_') === 0) {
            if (adminBar) adminBar.style.display = 'none';
            renderSubmissionsGrid(activeCategory.replace('__submissions_', ''));
            return;
        }
        if (activeCategory === '__review_pending') {
            if (adminBar) adminBar.style.display = 'none';
            renderSubmissionsGrid('pending_review');
            return;
        }
        // Show admin bar for template views
        if (adminBar) adminBar.style.display = '';

        // Inject bulk action bar if admin (once)
        var renderIsAdmin = window.blitzkriegAuth && window.blitzkriegAuth.isAdmin();
        if (renderIsAdmin && !document.getElementById('bulk-action-bar')) {
            var bulkBar = document.createElement('div');
            bulkBar.id = 'bulk-action-bar';
            bulkBar.className = 'bulk-action-bar';
            bulkBar.innerHTML =
                '<span class="bulk-count">0 selected</span>' +
                '<button class="bulk-select-all" onclick="return false;">Select All</button>' +
                '<button class="bulk-deselect" onclick="return false;">Deselect</button>' +
                '<button class="bulk-move-btn" onclick="return false;">Move Selected</button>' +
                '<button class="bulk-delete-btn" onclick="return false;">Delete Selected</button>' +
                '<button class="bulk-cancel" onclick="return false;">Exit Selection</button>';
            stashGrid.parentElement.insertBefore(bulkBar, stashGrid);

            bulkBar.querySelector('.bulk-select-all').addEventListener('click', function() { selectAllVisible(); });
            bulkBar.querySelector('.bulk-deselect').addEventListener('click', function() { deselectAll(); });
            bulkBar.querySelector('.bulk-move-btn').addEventListener('click', function() { promptBulkMove(); });
            bulkBar.querySelector('.bulk-delete-btn').addEventListener('click', function() { promptBulkDelete(); });
            bulkBar.querySelector('.bulk-cancel').addEventListener('click', function() { toggleBulkMode(false); });
        }

        // Clear any existing preview animations
        Object.keys(previewAnimations).forEach(function(id) {
            if (previewAnimations[id]) {
                if (previewAnimations[id].stop) previewAnimations[id].stop();
                if (previewAnimations[id].rafId) cancelAnimationFrame(previewAnimations[id].rafId);
            }
        });
        previewAnimations = {};

        // Update favorites count in sidebar
        var favCountEl = document.getElementById('favorites-count');
        if (favCountEl) {
            favCountEl.textContent = favoriteComps.length;
        }

        // Update recent count in sidebar
        var recentCountEl = document.getElementById('recent-count');
        if (recentCountEl) {
            recentCountEl.textContent = recentComps.length;
        }

        // Update Favorites nav item active state
        var favNavItem = document.querySelector('.nav-item[data-category="Favorites"]');
        if (favNavItem) {
            if (activeCategory === 'Favorites') {
                favNavItem.classList.add('active');
            } else {
                favNavItem.classList.remove('active');
            }
        }

        // Update Recent nav item active state
        var recentNavItem = document.querySelector('.nav-item[data-category="Recent"]');
        if (recentNavItem) {
            if (activeCategory === 'Recent') {
                recentNavItem.classList.add('active');
            } else {
                recentNavItem.classList.remove('active');
            }
        }

        var searchTerm = searchInput.value.toLowerCase();
        var filteredComps = sortComps(allComps.filter(function (comp) {
            // Filter by category (parentheses for clarity)
            var matchesCategory = (activeCategory === 'All') ||
                                  (activeCategory === 'Favorites' && isFavorite(comp.uniqueId)) ||
                                  (activeCategory === 'Recent' && isRecent(comp.uniqueId)) ||
                                  (comp.category === activeCategory);
            // Filter by search — indexOf instead of ES6 .includes() for CEP 8/9 compat
            var matchesSearch = !searchTerm || comp.name.toLowerCase().indexOf(searchTerm) !== -1;
            return matchesCategory && matchesSearch;
        }));
        if (filteredComps.length === 0) {
            if (allComps.length === 0) {
                showPlaceholder("No templates in the cloud library yet.");
            } else {
                showPlaceholder("No comps found. Try a different search or category.");
            }
            return;
        }

        // PAGINATED RENDERING: Render first batch, load more on scroll
        var PAGE_SIZE = 40;
        var renderUpTo = Math.min(PAGE_SIZE, filteredComps.length);

        // Store filtered comps and page state for loadMore
        renderCompsGrid._filteredComps = filteredComps;
        renderCompsGrid._rendered = renderUpTo;

        // Build HTML string for first batch only
        var htmlParts = [];
        for (var ci = 0; ci < renderUpTo; ci++) {
            htmlParts.push(buildCompCardHtml(filteredComps[ci]));
        }

        stashGrid.innerHTML = htmlParts.join('');

        // Add scroll sentinel for infinite scroll if more items remain
        if (renderUpTo < filteredComps.length) {
            var sentinel = document.createElement('div');
            sentinel.className = 'scroll-sentinel';
            sentinel.id = 'grid-scroll-sentinel';
            sentinel.style.cssText = 'height:1px;width:100%;grid-column:1/-1;';
            stashGrid.appendChild(sentinel);
            setupScrollSentinel(sentinel);
        }

        // Setup lazy loading + event listeners on rendered cards
        setupCardBehaviors(stashGrid);
    }

    // Error handler: try alt URL first, then hide broken img, show placeholder, blacklist
    function handleThumbError() {
        var img = this;
        // Try alt thumbnail URL before giving up (comp.png vs thumbnail.png)
        if (img.dataset.srcAlt && !img.dataset.altTried) {
            img.dataset.altTried = '1';
            img.src = img.dataset.srcAlt;
            return; // Give the alt URL a chance to load
        }
        img.style.display = 'none';
        var placeholder = img.parentElement.querySelector('.thumb-placeholder');
        if (placeholder) {
            placeholder.style.display = 'flex';
        }
        // Blacklist only after both URLs failed
        var card = img.closest('.stash-item');
        if (card && card.dataset.storagePath) {
            blacklistThumb(card.dataset.storagePath);
        }
    }

    /**
     * Set up lazy loading, preview hover, GIF hover, view tracking, and drag/drop
     * on cards within a container. Works for both initial render and appended batches.
     * @param {Element} container
     */
    function setupCardBehaviors(container) {
        // Lazy load thumbnails
        var lazyThumbnails = container.querySelectorAll('.lazy-thumb:not([src])');
        var observer = getLazyLoadObserver();

        if (observer) {
            lazyThumbnails.forEach(function(img) {
                observer.observe(img);
                img.addEventListener('load', function() {
                    var placeholder = this.parentElement.querySelector('.thumb-placeholder');
                    if (placeholder) placeholder.style.display = 'none';
                });
                img.onerror = handleThumbError;
            });
        } else {
            lazyThumbnails.forEach(function(img) {
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.classList.remove('lazy-thumb');
                }
                img.addEventListener('load', function() {
                    var placeholder = this.parentElement.querySelector('.thumb-placeholder');
                    if (placeholder) placeholder.style.display = 'none';
                });
                img.onerror = handleThumbError;
            });
        }

        // Preview animation hover (supports both pre-signed URLs and lazy signing).
        // CRITICAL: we use `data-preview-bound` here (NOT data-events-bound) — the
        // drag/drop + view tracking loop below uses `:not([data-events-bound])` as
        // its sentinel, so if we set data-events-bound here we'd silently strip
        // drag-drop and analytics from every preview-capable card.
        var stashItems = container.querySelectorAll('.stash-item.has-preview:not([data-preview-bound])');
        stashItems.forEach(function(item) {
            item.setAttribute('data-preview-bound', '1');
            var thumbnailContainer = item.querySelector('.thumbnail');
            var uniqueId = item.dataset.uniqueId;
            var storagePath = item.dataset.storagePath;
            var previewFramesJson = item.dataset.previewFrames;
            var previewCount = parseInt(item.dataset.previewCount) || 0;
            var duration = parseFloat(item.dataset.duration) || 0;
            var signingInProgress = false;
            var cachedFrameUrls = null;

            // Pre-parse local preview frame URLs if available
            if (previewFramesJson) {
                try {
                    var parsed = JSON.parse(previewFramesJson);
                    if (parsed && parsed.length > 0) cachedFrameUrls = parsed;
                } catch (e) {}
            }

            if (thumbnailContainer && (cachedFrameUrls || (previewCount > 0 && storagePath))) {
                item.addEventListener('mouseenter', function() {
                    if (cachedFrameUrls) {
                        // Already have URLs — start immediately
                        startPreviewAnimation(thumbnailContainer, cachedFrameUrls, uniqueId, duration);
                    } else if (previewCount > 0 && storagePath && !signingInProgress) {
                        // Lazy sign preview frames on first hover
                        signingInProgress = true;
                        // Safety timeout: reset flag after 15s if promise never settles
                        var signingTimeout = setTimeout(function() { signingInProgress = false; }, 15000);
                        window.cloudLibrary.signPreviewFrames(storagePath, previewCount).then(function(urls) {
                            clearTimeout(signingTimeout);
                            if (urls && urls.length > 0) {
                                cachedFrameUrls = urls;
                                // Also cache on the comp object for reuse
                                for (var ci = 0; ci < allComps.length; ci++) {
                                    if (allComps[ci].uniqueId === uniqueId) {
                                        allComps[ci].previewFrames = urls;
                                        break;
                                    }
                                }
                                startPreviewAnimation(thumbnailContainer, urls, uniqueId, duration);
                            }
                            signingInProgress = false;
                        }).catch(function() { clearTimeout(signingTimeout); signingInProgress = false; });
                    }
                });
                item.addEventListener('mouseleave', function() {
                    stopPreviewAnimation(thumbnailContainer, uniqueId);
                });
            }
        });

        // Hover auto-generate DISABLED. It was importing AEP files into the
        // user's project just by mousing over cards, triggering "file not found"
        // dialogs and disrupting workflow. Use the explicit generate button instead.

        // View tracking + drag/drop for all unbound stash items.
        // Per-session dedupe: a user scrolling through 40 cards fires 40 trackView
        // calls, which hit Supabase if analytics reports synchronously. Track each
        // uniqueId at most once per session so casual mouse movement doesn't thrash
        // the analytics endpoint.
        var allItems = container.querySelectorAll('.stash-item:not([data-events-bound])');
        allItems.forEach(function(item) {
            item.setAttribute('data-events-bound', '1');
            item.addEventListener('mouseenter', function() {
                if (!window.blitzkriegAnalytics) return;
                var uid = item.dataset.uniqueId;
                if (!uid) return;
                if (_trackedViewsThisSession[uid]) return;
                _trackedViewsThisSession[uid] = 1;
                window.blitzkriegAnalytics.trackView(
                    item.dataset.name,
                    item.dataset.category,
                    item.dataset.storagePath,
                    uid
                );
            });

            item.addEventListener('dragstart', function(e) {
                draggedComp = {
                    uniqueId: item.dataset.uniqueId,
                    category: item.dataset.category,
                    name: item.dataset.name
                };
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.dataset.uniqueId);
            });

            item.addEventListener('dragend', function(e) {
                item.classList.remove('dragging');
                draggedComp = null;
                var allCategories = document.querySelectorAll('.nav-item');
                allCategories.forEach(function(cat) {
                    cat.classList.remove('drag-over');
                });
            });
        });
    }

    // Scroll sentinel observer for infinite scroll
    var scrollSentinelObserver = null;

    function setupScrollSentinel(sentinel) {
        if (scrollSentinelObserver) scrollSentinelObserver.disconnect();

        var scrollRoot = document.querySelector('.grid-container') || null;
        scrollSentinelObserver = new IntersectionObserver(function(entries) {
            if (entries[0].isIntersecting) {
                loadMoreComps();
            }
        }, { root: scrollRoot, rootMargin: '200px', threshold: 0.01 });

        scrollSentinelObserver.observe(sentinel);
    }

    function loadMoreComps() {
        var filteredComps = renderCompsGrid._filteredComps;
        var rendered = renderCompsGrid._rendered;
        if (!filteredComps || rendered >= filteredComps.length) return;

        var PAGE_SIZE = 40;
        var end = Math.min(rendered + PAGE_SIZE, filteredComps.length);
        var htmlParts = [];

        for (var ci = rendered; ci < end; ci++) {
            htmlParts.push(buildCompCardHtml(filteredComps[ci]));
        }

        renderCompsGrid._rendered = end;

        // Remove old sentinel
        var oldSentinel = document.getElementById('grid-scroll-sentinel');
        if (oldSentinel) oldSentinel.remove();

        // Append new cards
        stashGrid.insertAdjacentHTML('beforeend', htmlParts.join(''));

        // Add new sentinel if more items remain
        if (end < filteredComps.length) {
            var sentinel = document.createElement('div');
            sentinel.className = 'scroll-sentinel';
            sentinel.id = 'grid-scroll-sentinel';
            sentinel.style.cssText = 'height:1px;width:100%;grid-column:1/-1;';
            stashGrid.appendChild(sentinel);
            setupScrollSentinel(sentinel);
        }

        // Setup behaviors on newly added cards
        setupCardBehaviors(stashGrid);
    }

    function showPlaceholder(message) { stashGrid.innerHTML = '<p class="placeholder-text">' + escapeHTML(message) + '</p>'; }

    /**
     * Updates the active class on ALL sidebar nav items to reflect the current activeCategory
     */
    function updateNavActiveState() {
        var allNavItems = document.querySelectorAll('.sidebar-nav .nav-item');
        allNavItems.forEach(function(item) {
            if (item.dataset.category === activeCategory) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    function handleCategoryClick(e) {
        // Handle clicks on sidebar nav items (including the label or icon inside)
        var navItem = e.target.closest('.nav-item');
        if (navItem && navItem.dataset.category) {
            // Don't re-handle category action buttons (rename/delete)
            if (e.target.closest('.nav-action-btn')) return;

            // Reset analytics state when leaving analytics
            if (navItem.dataset.category !== '__analytics') {
                analyticsView = null;
                analyticsEditorId = null;
                analyticsEditorName = '';
                analyticsTemplateName = '';
                analyticsDateRange = '30d';
            }

            activeCategory = navItem.dataset.category;

            // Update visual active state for all nav items
            updateNavActiveState();

            // Track category browse for real categories (not special views)
            if (window.blitzkriegAnalytics && activeCategory !== 'All' && activeCategory !== 'Favorites' && activeCategory !== 'Recent'
                && activeCategory.indexOf('__') !== 0) {
                window.blitzkriegAnalytics.trackCategoryBrowse(activeCategory);
            }

            // Handle special navigation categories
            if (activeCategory === '__analytics') {
                renderAnalyticsDashboard();
                return;
            }
            if (activeCategory.indexOf('__submissions_') === 0) {
                var statusFilter = activeCategory.replace('__submissions_', '');
                renderSubmissionsGrid(statusFilter);
                return;
            }
            if (activeCategory === '__review_pending') {
                renderSubmissionsGrid('pending_review');
                return;
            }

            renderUI();
        }
    }

    function handleStashGridClick(e) {
        // Analytics delegation: if we're in an analytics view, handle analytics clicks instead
        if (analyticsView) {
            handleAnalyticsClick(e);
            return;
        }

        // Submission review button delegation
        var actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            var action = actionBtn.dataset.action;
            var subId = actionBtn.dataset.submissionId;
            if (action === 'approve-submission' && subId) { approveSubmission(subId); return; }
            if (action === 'reject-submission' && subId) { promptRejectSubmission(subId); return; }
            if (action === 'withdraw-submission' && subId) { withdrawSubmission(subId); return; }
            if (action === 'resubmit-submission' && subId) { resubmitSubmission(subId); return; }
        }

        // Submission card click → open detail modal
        var submissionCard = e.target.closest('.submission-card');
        if (submissionCard && !e.target.closest('[data-action]')) {
            var clickedSubId = submissionCard.dataset.submissionId;
            if (clickedSubId) { openSubmissionDetail(clickedSubId); return; }
        }

        // Bulk checkbox click
        var checkbox = e.target.closest('.bulk-select-checkbox');
        if (checkbox) {
            var cbId = checkbox.dataset.uniqueId;
            if (cbId) {
                if (!bulkMode) toggleBulkMode(true);
                toggleBulkSelect(cbId);
            }
            return;
        }

        var item = e.target.closest('.stash-item');
        if (!item) return;
        var uniqueId = item.dataset.uniqueId, category = item.dataset.category, aepPath = item.dataset.aepPath, storagePath = item.dataset.storagePath, name = item.dataset.name;

        // In bulk mode, clicking the card itself toggles selection
        if (bulkMode && !e.target.closest('.action-btn') && !e.target.closest('.import-btn') && !e.target.closest('.generate-preview-btn')) {
            toggleBulkSelect(uniqueId);
            return;
        }

        if (e.target.closest('.import-btn')) { importComp(aepPath, uniqueId, storagePath); }
        else if (e.target.closest('.rename-btn')) { renameComp(uniqueId, category, name, storagePath); }
        else if (e.target.closest('.delete-btn')) { promptDelete(uniqueId, category, name, storagePath); }
        else if (e.target.closest('.move-btn')) { promptMoveComp(uniqueId, category, name); }
        else if (e.target.closest('.favorite-btn')) { toggleFavorite(uniqueId); }
        else if (e.target.closest('.generate-preview-btn')) {
            if (storagePath) {
                // Cloud template: generate thumbnail from AEP
                generateCloudThumbnailForCard(uniqueId, storagePath, name);
            } else {
                generatePreview(aepPath, name);
            }
        }
    }

    /**
     * Double-click on a comp card to import it instantly.
     * Cooldown prevents accidental rapid-fire imports (CEP panel lag can
     * register a single click as a double-click).
     */
    var _lastDblClickImportTime = 0;
    function handleStashGridDoubleClick(e) {
        // Suppress double-click in analytics views
        if (analyticsView) return;
        var item = e.target.closest('.stash-item');
        if (!item) return;
        // Don't trigger on buttons
        if (e.target.closest('.action-btn') || e.target.closest('.import-btn') || e.target.closest('.generate-preview-btn')) return;
        // Cooldown: ignore double-clicks within 2 seconds of the last import
        var now = Date.now();
        if (now - _lastDblClickImportTime < 2000) return;
        _lastDblClickImportTime = now;
        var aepPath = item.dataset.aepPath;
        var uniqueId = item.dataset.uniqueId;
        var storagePath = item.dataset.storagePath;
        if (aepPath || storagePath) {
            importComp(aepPath, uniqueId, storagePath);
        }
    }

    /**
     * Generates preview frames for an existing stashed composition
     * @param {string} aepPath - Path to the .aep file
     * @param {string} compName - Name of the composition (for toast messages)
     */
    function generatePreview(aepPath, compName) {
        if (!isValidPath(aepPath)) {
            showToast('Invalid file path.', true);
            return;
        }

        showSpinner();
        showToast('Generating preview for "' + compName + '"...');

        var safePath = escapeForExtendScript(aepPath);
        stashInProgress = true;
        safeEvalScript('generatePreviewFrames("' + safePath + '")', function(result) {
            stashInProgress = false;
            hideSpinner();
            if (!result) {
                showToast('Unexpected error generating preview.', true);
                return;
            }
            if (result.indexOf('Success') === 0 || result.indexOf('Warning') === 0) {
                showToast(result.replace(/^(Success:|Warning:)\s*/, ''));
                // Reload library once to show the new preview. The previous version
                // fired three reloads (immediate + 1s + 3s) "for macOS AE 25.1 file
                // system settling" — that triggered ~744 redundant metadata downloads
                // for one operation. The pendingLibraryReload flag in loadLibrary
                // already handles the case where a reload arrives while one is in flight.
                var libraryPath = getLibraryPath();
                if (libraryPath) {
                    // Single delayed reload — gives AE 800ms to settle the new file
                    // (cloud-mode loadLibrary takes no args; legacy local-mode loaded
                    // by libraryPath, which is now ignored).
                    setTimeout(function() { loadLibrary(); }, 800);
                }
            } else {
                showToast(result, true);
            }
        });
    }

    /**
     * Generate a thumbnail for a single cloud template card and reload.
     */
    function generateCloudThumbnailForCard(uniqueId, storagePath, compName) {
        if (!_hasCepBridge) {
            showToast('Requires After Effects.', true);
            return;
        }

        // Find the comp object
        var comp = null;
        for (var i = 0; i < allComps.length; i++) {
            if (allComps[i].uniqueId === uniqueId) { comp = allComps[i]; break; }
        }
        if (!comp) { comp = { storagePath: storagePath, name: compName }; }

        showSpinner();
        stashInProgress = true;
        showToast('Generating thumbnail + preview for "' + compName + '"...');

        generateCloudThumbnail(comp).then(function() {
            stashInProgress = false;
            hideSpinner();
            showToast('Thumbnail + preview generated for "' + compName + '"!');
            // Invalidate cache and reload to pick up new thumb + preview frames
            window.cloudLibrary.invalidateCache();
            loadLibrary();
        }).catch(function(err) {
            stashInProgress = false;
            hideSpinner();
            showToast('Failed to generate: ' + err.message, true);
        });
    }

    /* --------- add/rename/delete/import flows --------- */
    function addSelectedComp() {
        // Check if CSInterface is available
        if (!_hasCepBridge) {
            showToast('Adding comps requires After Effects.', true);
            return;
        }
        var categories = getUniqueCategories();
        existingCategorySelect.innerHTML = categories.map(function (cat) { return '<option value="' + escapeHTML(cat) + '">' + escapeHTML(cat) + '</option>'; }).join('');
        existingCategorySelect.disabled = categories.length === 0;
        if (categories.length === 0) { existingCategorySelect.innerHTML = '<option value="">No categories yet</option>'; }
        newCategoryInput.value = '';
        // Any signed-in user can create new categories (delete still admin-only)
        var newCatGroup = newCategoryInput.closest('.form-group');
        if (newCatGroup) {
            var addSignedIn = window.blitzkriegAuth && window.blitzkriegAuth.getUser && !!window.blitzkriegAuth.getUser();
            newCatGroup.style.display = addSignedIn ? '' : 'none';
        }
        addCompModal.style.display = 'flex';
    }

    function executeAddComp() {
        var newCatName = newCategoryInput.value.trim();
        var existingCatName = existingCategorySelect.value;
        var categoryName = newCatName || existingCatName;

        if (!categoryName) {
            showToast('Please select or create a category.', true);
            return;
        }
        var nameErr = validateName(categoryName);
        if (nameErr) {
            showToast(nameErr, true);
            return;
        }

        addCompModal.style.display = 'none';
        stashInProgress = true;
        showSpinner();
        showToast('Submitting composition for review...');

        var safeCategory = escapeForExtendScript(categoryName);

        safeEvalScript('stashSelectedCompToTemp("' + safeCategory + '")', function(result) {
            (async function() {
                try {
                    var parsed = JSON.parse(result);
                    if (parsed.result && parsed.result.indexOf('Error') === 0) {
                        showToast(parsed.result, true);
                        stashInProgress = false;
                        hideSpinner();
                        return;
                    }
                    // Missing-footage warning from stashSelectedComp. The .aep still
                    // saved and we still upload, but the user needs to know the bundle
                    // is incomplete so they can relink footage and re-stash. Strip the
                    // "Warning:" prefix to match the local-stash UX at line 2156.
                    if (parsed.result && parsed.result.indexOf('Warning') === 0) {
                        var stripped = parsed.result.replace(/^Warning:\s*/, '');
                        showToast(stripped);
                        debugLog(parsed.result, 'warn');
                    }

                    var tempPath = parsed.tempPath;
                    var files = await readTempFiles(tempPath, categoryName);

                    {
                        // All uploads go through pending/approval flow
                        var userId = window.blitzkriegAuth.getUser().id;
                        var teamMember = window.blitzkriegAuth.getTeamMember();
                        var pendingBasePath = 'pending/' + userId + '/' + files.folderName;
                        var sb = window.blitzkriegSupabase;

                        // Upload AEP to pending path
                        var aepUpload = await sb.storage.from('blitzkrieg')
                            .upload(pendingBasePath + '/' + files.folderName + '.aep', files.aepBlob, {
                                contentType: 'application/octet-stream',
                                upsert: true,
                            });
                        if (aepUpload.error) throw new Error('AEP upload failed: ' + aepUpload.error.message);

                        // Upload thumbnail if present (use comp.png for consistency)
                        if (files.thumbnailBlob) {
                            var thumbUpload = await sb.storage.from('blitzkrieg')
                                .upload(pendingBasePath + '/comp.png', files.thumbnailBlob, {
                                    contentType: 'image/png',
                                    upsert: true,
                                });
                            if (thumbUpload.error) {
                                debugLog('Thumbnail upload warning: ' + thumbUpload.error.message, 'warn');
                            }
                        }

                        // Upload preview frames if present
                        if (files.previewFrameBlobs && files.previewFrameBlobs.length > 0) {
                            var frameUploads = files.previewFrameBlobs.map(function(blob, idx) {
                                return sb.storage.from('blitzkrieg')
                                    .upload(pendingBasePath + '/preview/frame_' + idx + '.png', blob, {
                                        contentType: 'image/png',
                                        upsert: true,
                                    });
                            });
                            await Promise.all(frameUploads);
                        }

                        // Upload metadata
                        if (files.metadata) {
                            var metaBlob = new Blob([JSON.stringify(files.metadata)], { type: 'application/json' });
                            await sb.storage.from('blitzkrieg')
                                .upload(pendingBasePath + '/metadata.json', metaBlob, {
                                    contentType: 'application/json',
                                    upsert: true,
                                });
                        }

                        // Create submission record
                        var submissionName = (files.metadata && (files.metadata.displayName || files.metadata.name)) || files.folderName;
                        if (submissionName && submissionName.length > 255) submissionName = submissionName.substring(0, 255);
                        var insertResult = await sb.from('blitzkrieg_template_submissions').insert({
                            user_id: userId,
                            team_member_id: teamMember ? teamMember.id : null,
                            template_name: submissionName,
                            category: categoryName,
                            storage_path: pendingBasePath,
                            status: 'pending',
                            metadata: files.metadata || {},
                        });
                        if (insertResult.error) throw new Error('Submission record failed: ' + insertResult.error.message);

                        safeEvalScript('cleanupTempStash("' + escapeForExtendScript(tempPath) + '")', function(cuRes) {
                            if (cuRes && cuRes.indexOf('ERROR') === 0) {
                                debugLog('Temp stash cleanup failed: ' + cuRes, 'warn');
                            }
                        });
                        showToast('Template submitted for review!');
                        if (window.blitzkriegAnalytics && window.blitzkriegAnalytics.trackStash) {
                            var totalBytes = 0;
                            try {
                                if (files.aepBlob && files.aepBlob.size) totalBytes += files.aepBlob.size;
                                if (files.thumbnailBlob && files.thumbnailBlob.size) totalBytes += files.thumbnailBlob.size;
                                if (files.previewFrameBlobs) {
                                    files.previewFrameBlobs.forEach(function(b) { if (b && b.size) totalBytes += b.size; });
                                }
                            } catch (e) {}
                            window.blitzkriegAnalytics.trackStash(
                                submissionName,
                                categoryName,
                                pendingBasePath,
                                totalBytes
                            );
                        }
                        stashInProgress = false;
                        hideSpinner();
                        loadSubmissionCounts();

                        // Navigate to the review queue so admin can immediately review
                        var submitIsAdmin = window.blitzkriegAuth && window.blitzkriegAuth.isAdmin();
                        if (submitIsAdmin) {
                            activeCategory = '__review_pending';
                        } else {
                            activeCategory = '__submissions_pending';
                        }
                        updateNavActiveState();
                        renderSubmissionsGrid(submitIsAdmin ? 'pending_review' : 'pending');
                    }
                } catch (err) {
                    debugLog('Upload error: ' + err.message, 'error');
                    showToast('Failed to submit template: ' + err.message, true);
                    stashInProgress = false;
                    hideSpinner();
                    // Clean up the temp stash dir we created — without this, every
                    // failed upload leaks a full comp bundle (AEP + frames + metadata)
                    // in /tmp permanently. The try/catch in cleanupTempStash guards
                    // against permissions / missing-path errors.
                    if (typeof tempPath === 'string' && tempPath) {
                        try {
                            safeEvalScript('cleanupTempStash("' + escapeForExtendScript(tempPath) + '")');
                        } catch (ctErr) {}
                    }
                }
            })();
        });
    }

    /**
     * List directory contents via evalScript (works in all environments).
     * Returns array of entry names; directories have trailing '/'.
     */
    function listDirAsync(dirPath) {
        return new Promise(function(resolve, reject) {
            var safe = escapeForExtendScript(dirPath);
            safeEvalScript(
                '(function(){ var f = new Folder("' + safe + '"); if (!f.exists) return "[]"; ' +
                'var files = f.getFiles(); var names = []; ' +
                'for(var i=0;i<files.length;i++) names.push(files[i].name + (files[i] instanceof Folder ? "/" : "")); ' +
                'return JSON.stringify(names); })()',
                function(r) {
                    try { resolve(JSON.parse(r)); }
                    catch (e) { reject(new Error('Cannot list dir: ' + dirPath)); }
                }
            );
        });
    }

    /**
     * Read stashed temp files from disk.
     * Fully async — uses evalScript for dir listing and readFileAsBlobAsync for reads.
     */
    async function readTempFiles(tempPath, categoryName) {
        var categoryDir = tempPath + '/' + categoryName;

        // List category dir to find the comp subfolder.
        // ES5-safe suffix checks throughout — no String.prototype.endsWith.
        var entries = await listDirAsync(categoryDir);
        var folderName = null;
        for (var i = 0; i < entries.length; i++) {
            var entryRaw = entries[i];
            var eName = entryRaw.replace(/\/$/, '');
            if (eName === '.' || eName === '..' || eName === '.DS_Store') continue;
            // Trailing slash means it's a directory
            if (entryRaw.length > 0 && entryRaw.charAt(entryRaw.length - 1) === '/') {
                folderName = eName;
                break;
            }
        }
        if (!folderName) throw new Error('No comp folder found in ' + categoryDir);

        var compDir = categoryDir + '/' + folderName;
        var compEntries = await listDirAsync(compDir);

        // Find .aep file
        var aepName = null;
        for (var j = 0; j < compEntries.length; j++) {
            var ce = compEntries[j].replace(/\/$/, '');
            var ceLower = ce.toLowerCase();
            if (ceLower.length >= 4 && ceLower.indexOf('.aep', ceLower.length - 4) !== -1) {
                aepName = ce;
                break;
            }
        }
        if (!aepName) throw new Error('No .aep file found');

        // Read AEP file
        var aepBlob = await readFileAsBlobAsync(compDir + '/' + aepName, 'application/octet-stream');

        // Read thumbnail
        var thumbnailBlob = null;
        var thumbNames = ['comp.png', 'thumbnail.png', 'thumbnail.jpg'];
        for (var t = 0; t < thumbNames.length; t++) {
            if (await fileExistsAsync(compDir + '/' + thumbNames[t])) {
                thumbnailBlob = await readFileAsBlobAsync(compDir + '/' + thumbNames[t], 'image/png');
                break;
            }
        }

        // Read metadata
        var metadata = {};
        try {
            var metaBlob = await readFileAsBlobAsync(compDir + '/metadata.json', 'application/json');
            metadata = JSON.parse(await metaBlob.text());
        } catch (e) { /* no metadata */ }

        // Read preview frames
        var previewFrameBlobs = [];
        var frameCount = metadata.previewFrames || 0;
        for (var fi = 0; fi < frameCount; fi++) {
            var framePath = compDir + '/preview/frame_' + fi + '.png';
            if (await fileExistsAsync(framePath)) {
                try { previewFrameBlobs.push(await readFileAsBlobAsync(framePath, 'image/png')); }
                catch (e) { /* skip missing frame */ }
            }
        }

        return {
            folderName: folderName,
            aepBlob: aepBlob,
            thumbnailBlob: thumbnailBlob,
            metadata: metadata,
            previewFrameBlobs: previewFrameBlobs,
        };
    }

    function base64ToBlob(base64, contentType) {
        var binary = atob(base64);
        var array = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        return new Blob([array], { type: contentType });
    }

    function promptDelete(uniqueId, category, name, storagePath) {
        currentDeleteInfo = { uniqueId: uniqueId, category: category, storagePath: storagePath };
        compToDeleteName.textContent = name;
        deleteModal.style.display = 'flex';
    }

    function executeDelete() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to delete templates.', true);
            deleteModal.style.display = 'none';
            return;
        }
        if (!currentDeleteInfo) return;

        var info = currentDeleteInfo;
        deleteModal.style.display = 'none';

        // Cloud delete path
        if (info.storagePath && window.cloudLibrary) {
            showSpinner();
            window.cloudLibrary.deleteTemplate(info.storagePath).then(function() {
                showToast('Template deleted.');
                currentDeleteInfo = null;
                loadLibrary();
            }).catch(function(err) {
                showToast('Failed to delete: ' + err.message, true);
                currentDeleteInfo = null;
                hideSpinner();
            });
            return;
        }

        // Legacy local delete path
        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            currentDeleteInfo = null;
            return;
        }

        var safePath = escapeForExtendScript(libraryPath);
        var safeCategory = escapeForExtendScript(info.category);
        var safeUniqueId = escapeForExtendScript(info.uniqueId);

        safeEvalScript('deleteStashedComp("' + safePath + '","' + safeCategory + '","' + safeUniqueId + '")', function (result) {
            currentDeleteInfo = null;
            if (result && result.indexOf('Success') === 0) {
                showToast('Deleted successfully.');
                loadLibrary();
            } else {
                showToast(result || 'Failed to delete.', true);
            }
        });
    }

    function renameComp(uniqueId, category, currentName, storagePath) {
        currentRenameInfo = { uniqueId: uniqueId, category: category, storagePath: storagePath };
        compToRenameCurrentName.textContent = currentName;
        newNameInput.value = currentName;
        renameModal.style.display = 'flex';
    }

    function executeRename() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to rename templates.', true);
            renameModal.style.display = 'none';
            return;
        }
        var info = currentRenameInfo;
        if (!info) return;

        var newName = newNameInput.value.trim();
        if (!newName) {
            showToast('Please enter a new name.', true);
            return;
        }
        var renameErr = validateName(newName);
        if (renameErr) {
            showToast(renameErr, true);
            return;
        }

        renameModal.style.display = 'none';

        // Cloud rename path
        if (info.storagePath && window.cloudLibrary) {
            showSpinner();
            window.cloudLibrary.renameTemplate(info.storagePath, newName).then(function() {
                showToast('Template renamed.');
                currentRenameInfo = null;
                loadLibrary();
            }).catch(function(err) {
                showToast('Failed to rename: ' + err.message, true);
                currentRenameInfo = null;
                hideSpinner();
            });
            return;
        }

        // Legacy local rename path
        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            currentRenameInfo = null;
            return;
        }

        currentRenameInfo = null;

        var safePath = escapeForExtendScript(libraryPath);
        var safeCategory = escapeForExtendScript(info.category);
        var safeUniqueId = escapeForExtendScript(info.uniqueId);
        var safeNewName = escapeForExtendScript(newName);

        safeEvalScript('renameStashedComp("' + safePath + '","' + safeCategory + '","' + safeUniqueId + '","' + safeNewName + '")', function (result) {
            if (result && result.indexOf('Success') === 0) {
                showToast('Renamed successfully.');
                loadLibrary();
            } else {
                showToast(result || 'Rename failed', true);
            }
        });
    }

    /* --------- Favorites and Recent Comps --------- */

    /**
     * Load favorites and recent comps from localStorage
     */
    function loadFavoritesAndRecent() {
        try {
            var savedFavorites = localStorage.getItem('blitzkrieg_favorites');
            if (savedFavorites) {
                favoriteComps = JSON.parse(savedFavorites);
            }
            var savedRecent = localStorage.getItem('blitzkrieg_recent');
            if (savedRecent) {
                recentComps = JSON.parse(savedRecent);
            }
        } catch (e) {
            console.warn('Blitzkrieg: Could not load favorites/recent from localStorage');
        }
        // Update counts in sidebar immediately
        updateQuickAccessCounts();
    }

    /**
     * Update Favorites and Recent counts in sidebar
     */
    function updateQuickAccessCounts() {
        var favCountEl = document.getElementById('favorites-count');
        if (favCountEl) {
            favCountEl.textContent = favoriteComps.length;
        }
        var recentCountEl = document.getElementById('recent-count');
        if (recentCountEl) {
            recentCountEl.textContent = recentComps.length;
        }
    }

    /**
     * Save favorites and recent comps to localStorage
     */
    function saveFavoritesAndRecent() {
        try {
            localStorage.setItem('blitzkrieg_favorites', JSON.stringify(favoriteComps));
            localStorage.setItem('blitzkrieg_recent', JSON.stringify(recentComps));
        } catch (e) {
            console.warn('Blitzkrieg: Could not save favorites/recent to localStorage');
        }
    }

    /**
     * Toggle favorite status for a comp
     * @param {string} uniqueId - The comp's unique ID
     */
    function toggleFavorite(uniqueId) {
        var index = favoriteComps.indexOf(uniqueId);
        var nowFavorited = false;
        if (index === -1) {
            favoriteComps.push(uniqueId);
            nowFavorited = true;
            showToast('Added to favorites');
            // Track favorite add
            if (window.blitzkriegAnalytics) {
                var favComp = null;
                for (var fi = 0; fi < allComps.length; fi++) {
                    if (allComps[fi].uniqueId === uniqueId) { favComp = allComps[fi]; break; }
                }
                if (favComp) {
                    window.blitzkriegAnalytics.trackFavorite(favComp.name, favComp.category, favComp.storagePath);
                }
            }
        } else {
            favoriteComps.splice(index, 1);
            showToast('Removed from favorites');
        }
        saveFavoritesAndRecent();
        // Targeted DOM update — flipping a star icon does NOT need a full grid
        // re-render. The previous renderUI() rebuilt the entire 248-card innerHTML
        // and re-bound every event listener for a single class change. Just toggle
        // the class on the relevant card. If we're currently viewing the Favorites
        // virtual category, the unfavorited card needs to disappear, so fall back
        // to a re-render in that one case.
        if (activeCategory === 'Favorites') {
            renderUI();
        } else {
            var card = document.querySelector('.stash-item[data-unique-id="' + uniqueId + '"]');
            if (card) {
                if (nowFavorited) card.classList.add('is-favorite');
                else card.classList.remove('is-favorite');
                // Also update any star icon's visual state via class on the button
                var starBtn = card.querySelector('.favorite-btn');
                if (starBtn) {
                    if (nowFavorited) starBtn.classList.add('favorited');
                    else starBtn.classList.remove('favorited');
                }
            } else {
                // Card not in current view — fall back to re-render to be safe
                renderUI();
            }
        }
    }

    /**
     * Check if a comp is favorited
     * @param {string} uniqueId - The comp's unique ID
     * @returns {boolean}
     */
    function isFavorite(uniqueId) {
        return favoriteComps.indexOf(uniqueId) !== -1;
    }

    /**
     * Check if a comp is in recent imports
     * @param {string} uniqueId - The comp's unique ID
     * @returns {boolean}
     */
    function isRecent(uniqueId) {
        for (var i = 0; i < recentComps.length; i++) {
            if (recentComps[i].uniqueId === uniqueId) {
                return true;
            }
        }
        return false;
    }

    /**
     * Add a comp to recent imports
     * @param {string} uniqueId - The comp's unique ID
     */
    function addToRecent(uniqueId) {
        // Remove if already exists
        recentComps = recentComps.filter(function(r) { return r.uniqueId !== uniqueId; });
        // Add to front
        recentComps.unshift({ uniqueId: uniqueId, timestamp: Date.now() });
        // Trim to max
        if (recentComps.length > MAX_RECENT_COMPS) {
            recentComps = recentComps.slice(0, MAX_RECENT_COMPS);
        }
        saveFavoritesAndRecent();
    }

    /**
     * Import a composition and track it as recent
     * @param {string} aepPath - Path to the AEP file
     * @param {string} uniqueId - Optional unique ID for tracking
     */
    function importComp(aepPath, uniqueId, storagePath) {
        // Check if we're in a CEP environment with ExtendScript support
        if (!_hasCepBridge) {
            showToast('Import requires After Effects. Open this panel inside AE.', true);
            return;
        }

        // Resolve comp info for analytics tracking
        var _trackComp = null;
        if (uniqueId) {
            for (var ti = 0; ti < allComps.length; ti++) {
                if (allComps[ti].uniqueId === uniqueId) { _trackComp = allComps[ti]; break; }
            }
        }

        // Cloud import path
        if (storagePath && window.cloudLibrary) {
            showSpinner();
            stashInProgress = true; // Block focus-triggered loadLibrary during import
            showToast('Downloading template...');
            debugLog('IMPORT: starting cloud import for ' + storagePath);

            getTempDir().then(function(sysTempDir) {
                debugLog('IMPORT: temp dir = ' + sysTempDir);
                return window.cloudLibrary.downloadTemplate(storagePath);
            }).then(function(downloaded) {
                debugLog('IMPORT: downloaded ' + downloaded.fileName + ' (' + (downloaded.blob.size / 1024).toFixed(0) + 'KB)');
                var tempAepPath = _cachedTempDir + '/blitzkrieg_import_' + downloaded.fileName;
                return writeBlobToFile(downloaded.blob, tempAepPath).then(function(writtenPath) {
                    var aepDiskPath = writtenPath || tempAepPath;
                    debugLog('IMPORT: written to disk, calling importComp...');
                    return new Promise(function(resolve, reject) {
                        var safePath = escapeForExtendScript(aepDiskPath);
                        var safeDisplayName = _trackComp ? escapeForExtendScript(_trackComp.name) : '';
                        safeEvalScript('importComp("' + safePath + '","' + safeDisplayName + '")', function(result) {
                            // Delay cleanup so AE's scheduleTask can finish opening the comp
                            setTimeout(function() {
                                try { safeEvalScript('(function(){ var f = new File("' + safePath + '"); if(f.exists) f.remove(); return "ok"; })()'); } catch(e) {}
                            }, 2000);

                            if (result && result.indexOf('Success') === 0) {
                                hideSpinner();
                                showToast('Imported and opened in timeline!');
                                if (uniqueId) addToRecent(uniqueId);
                                if (window.blitzkriegAnalytics && _trackComp) {
                                    window.blitzkriegAnalytics.trackImport(_trackComp.name, _trackComp.category, storagePath);
                                }
                                if (window.blitzkriegTelemetry && _trackComp) {
                                    window.blitzkriegTelemetry.trackTemplateImport(_trackComp.name, _trackComp.category, storagePath, _trackComp);
                                }
                                resolve();
                            } else {
                                // hideSpinner called by outer error handler
                                reject(new Error(result || 'Import failed'));
                            }
                        });
                    });
                });
            }).then(function() {
                stashInProgress = false;
            }, function (err) {
                stashInProgress = false;
                hideSpinner();
                debugLog('IMPORT FAIL: ' + err.message, 'error');
                showToast('Import failed: ' + err.message, true);
            });
            return;
        }

        // Legacy local import path
        if (!isValidPath(aepPath)) {
            showToast('Invalid file path.', true);
            return;
        }

        showSpinner();
        stashInProgress = true; // Block focus-triggered loadLibrary during import
        var safePath = escapeForExtendScript(aepPath);
        var safeDisplayName = _trackComp ? escapeForExtendScript(_trackComp.name) : '';

        safeEvalScript('importComp("' + safePath + '","' + safeDisplayName + '")', function (result) {
            stashInProgress = false;
            hideSpinner();
            if (!result) {
                showToast('Unexpected error importing.', true);
                return;
            }
            if (result.indexOf('Success') === 0) {
                showToast('Imported and opened in timeline!');
                if (uniqueId) {
                    addToRecent(uniqueId);
                }
                if (window.blitzkriegAnalytics && _trackComp) {
                    window.blitzkriegAnalytics.trackImport(_trackComp.name, _trackComp.category, storagePath);
                }
                if (window.blitzkriegTelemetry && _trackComp) {
                    window.blitzkriegTelemetry.trackTemplateImport(_trackComp.name, _trackComp.category, storagePath, _trackComp);
                }
            } else {
                showToast(result, true);
            }
        });
    }

    /* --------- Category Operations --------- */

    /**
     * Opens the category rename modal
     * @param {string} categoryName - Current category name
     */
    function promptCategoryRename(categoryName) {
        currentCategoryRenameInfo = { category: categoryName };
        if (categoryToRenameCurrentName) categoryToRenameCurrentName.textContent = categoryName;
        if (newCategoryNameInput) newCategoryNameInput.value = categoryName;
        if (renameCategoryModal) renameCategoryModal.style.display = 'flex';
        // Focus the input
        setTimeout(function() {
            if (newCategoryNameInput) {
                newCategoryNameInput.focus();
                newCategoryNameInput.select();
            }
        }, 100);
    }

    /**
     * Executes the category rename
     */
    function executeCategoryRename() {
        // Renaming is open to any signed-in user (storage RLS still enforces
        // blitzkrieg_access). Delete stays admin-only further down.
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.getUser || !window.blitzkriegAuth.getUser()) {
            showToast('Not signed in.', true);
            renameCategoryModal.style.display = 'none';
            return;
        }
        var info = currentCategoryRenameInfo;
        if (!info) return;

        var newName = newCategoryNameInput.value.trim();
        if (!newName) {
            showToast('Please enter a new name.', true);
            return;
        }
        var catRenameErr = validateName(newName);
        if (catRenameErr) {
            showToast(catRenameErr, true);
            return;
        }

        renameCategoryModal.style.display = 'none';
        showSpinner();

        // Cloud rename: move all files from old category folder to new
        if (window.cloudLibrary && window.cloudLibrary.renameCategory) {
            window.cloudLibrary.renameCategory(info.category, newName).then(function() {
                hideSpinner();
                currentCategoryRenameInfo = null;
                showToast('Category renamed successfully.');
                if (activeCategory === info.category) {
                    activeCategory = newName;
                }
                loadLibrary();
            }).catch(function(err) {
                hideSpinner();
                currentCategoryRenameInfo = null;
                showToast('Failed to rename category: ' + err.message, true);
            });
            return;
        }

        // Legacy local rename fallback
        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            hideSpinner();
            currentCategoryRenameInfo = null;
            return;
        }

        var safePath = escapeForExtendScript(libraryPath);
        var safeOldName = escapeForExtendScript(info.category);
        var safeNewName = escapeForExtendScript(newName);

        safeEvalScript('renameCategory("' + safePath + '","' + safeOldName + '","' + safeNewName + '")', function (result) {
            hideSpinner();
            currentCategoryRenameInfo = null;
            if (result && result.indexOf('Success') === 0) {
                showToast('Category renamed successfully.');
                if (activeCategory === info.category) {
                    activeCategory = newName;
                }
                loadLibrary();
            } else {
                showToast(result || 'Rename failed', true);
            }
        });
    }

    /**
     * Opens the category delete confirmation modal
     * @param {string} categoryName - Category to delete
     */
    function promptCategoryDelete(categoryName) {
        var compCount = allComps.filter(function(c) { return c.category === categoryName; }).length;
        currentCategoryDeleteInfo = { category: categoryName, compCount: compCount };
        if (categoryToDeleteName) categoryToDeleteName.textContent = categoryName;
        if (categoryToDeleteCount) categoryToDeleteCount.textContent = compCount;

        // Populate transfer category dropdown (exclude current category)
        var categories = getUniqueCategories();
        var otherCategories = categories.filter(function(cat) { return cat !== categoryName; });
        if (transferToCategorySelect) {
            transferToCategorySelect.innerHTML = otherCategories.map(function(cat) {
                return '<option value="' + escapeHTML(cat) + '">' + escapeHTML(cat) + '</option>';
            }).join('');
            if (otherCategories.length === 0) {
                transferToCategorySelect.innerHTML = '<option value="">No other categories</option>';
            }
        }

        // Show/hide transfer option based on whether there are templates and other categories
        var transferRadio = document.querySelector('input[name="delete-category-action"][value="transfer"]');
        if (transferRadio) {
            if (compCount === 0 || otherCategories.length === 0) {
                transferRadio.closest('.radio-option').style.display = 'none';
                if (transferCategoryGroup) transferCategoryGroup.style.display = 'none';
                var deleteAllRadio = document.querySelector('input[name="delete-category-action"][value="delete-all"]');
                if (deleteAllRadio) deleteAllRadio.checked = true;
            } else {
                transferRadio.closest('.radio-option').style.display = '';
                if (transferCategoryGroup) transferCategoryGroup.style.display = '';
                transferRadio.checked = true;
            }
        }

        // Toggle transfer dropdown visibility based on radio selection
        var radios = document.querySelectorAll('input[name="delete-category-action"]');
        radios.forEach(function(r) {
            r.onchange = function() {
                if (transferCategoryGroup) {
                    transferCategoryGroup.style.display = r.value === 'transfer' && r.checked ? '' : 'none';
                }
            };
        });

        if (deleteCategoryModal) deleteCategoryModal.style.display = 'flex';
    }

    /**
     * Executes the category deletion
     */
    function executeCategoryDelete() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to delete categories.', true);
            deleteCategoryModal.style.display = 'none';
            return;
        }
        var info = currentCategoryDeleteInfo;
        if (!info) return;

        // Determine user choice: transfer or delete-all
        var selectedAction = 'delete-all';
        var checkedRadio = document.querySelector('input[name="delete-category-action"]:checked');
        if (checkedRadio) selectedAction = checkedRadio.value;

        var transferTarget = transferToCategorySelect ? transferToCategorySelect.value : '';

        if (selectedAction === 'transfer' && !transferTarget) {
            showToast('Please select a category to transfer templates to.', true);
            return;
        }

        deleteCategoryModal.style.display = 'none';
        showSpinner();

        // Cloud path
        if (window.cloudLibrary) {
            var promise;
            if (selectedAction === 'transfer' && transferTarget && info.compCount > 0) {
                // Transfer all templates to target category, then delete the empty category
                showToast('Transferring templates to "' + transferTarget + '"...');
                promise = window.cloudLibrary.moveAllTemplates(info.category, transferTarget);
            } else {
                // Permanent delete of everything in the category
                promise = window.cloudLibrary.deleteCategory(info.category);
            }

            promise.then(function() {
                hideSpinner();
                currentCategoryDeleteInfo = null;
                if (selectedAction === 'transfer') {
                    showToast('Templates transferred and category "' + info.category + '" removed.');
                } else {
                    showToast('Category "' + info.category + '" deleted permanently.');
                }
                if (activeCategory === info.category) {
                    activeCategory = selectedAction === 'transfer' ? transferTarget : 'All';
                }
                // Remove deleted category comps from local state immediately
                // so modals (add comp, move, etc.) don't show stale categories
                allComps = allComps.filter(function(c) { return c.category !== info.category; });
                _invalidateCategoryCache();
                renderUI();
                loadLibrary();
            }).catch(function(err) {
                hideSpinner();
                currentCategoryDeleteInfo = null;
                showToast('Failed: ' + err.message, true);
            });
            return;
        }

        // Legacy local delete fallback
        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            hideSpinner();
            currentCategoryDeleteInfo = null;
            return;
        }

        var safePath = escapeForExtendScript(libraryPath);
        var safeCategoryName = escapeForExtendScript(info.category);

        safeEvalScript('deleteCategory("' + safePath + '","' + safeCategoryName + '")', function (result) {
            hideSpinner();
            currentCategoryDeleteInfo = null;
            if (result && result.indexOf('Success') === 0) {
                showToast('Category deleted successfully.');
                if (activeCategory === info.category) {
                    activeCategory = 'All';
                }
                loadLibrary();
            } else {
                showToast(result || 'Delete failed', true);
            }
        });
    }

    /* --------- Move Comp Operations --------- */

    /**
     * Opens the move comp modal
     * @param {string} uniqueId - Comp unique ID
     * @param {string} category - Current category
     * @param {string} name - Comp display name
     */
    function promptMoveComp(uniqueId, category, name) {
        currentMoveCompInfo = { uniqueId: uniqueId, category: category, name: name };
        if (compToMoveName) compToMoveName.textContent = name;

        // Populate category dropdown excluding current category
        var categories = getUniqueCategories();
        var otherCategories = categories.filter(function(cat) { return cat !== category; });

        if (moveToCategorySelect) {
            moveToCategorySelect.innerHTML = otherCategories.map(function(cat) {
                return '<option value="' + escapeHTML(cat) + '">' + escapeHTML(cat) + '</option>';
            }).join('');
            moveToCategorySelect.disabled = otherCategories.length === 0;
            if (otherCategories.length === 0) {
                moveToCategorySelect.innerHTML = '<option value="">No other categories</option>';
            }
        }

        if (moveToNewCategoryInput) moveToNewCategoryInput.value = '';
        if (moveCompModal) moveCompModal.style.display = 'flex';
    }

    /**
     * Executes the move comp operation from modal
     */
    function executeMoveComp() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to move templates.', true);
            moveCompModal.style.display = 'none';
            return;
        }
        var info = currentMoveCompInfo;
        if (!info) return;

        var newCategoryName = moveToNewCategoryInput.value.trim();
        var existingCategory = moveToCategorySelect.value;
        var targetCategory = newCategoryName || existingCategory;

        if (!targetCategory) {
            showToast('Please select or create a category.', true);
            return;
        }

        var moveNameErr = validateName(targetCategory);
        if (moveNameErr) {
            showToast(moveNameErr, true);
            return;
        }

        if (targetCategory === info.category) {
            showToast('Comp is already in that category.', true);
            return;
        }

        moveCompModal.style.display = 'none';
        executeMoveCompDirect(info.uniqueId, info.category, targetCategory, info.name);
        currentMoveCompInfo = null;
    }

    /**
     * Directly executes move comp (used by drag-drop and modal)
     * @param {string} uniqueId - Comp unique ID
     * @param {string} oldCategory - Current category
     * @param {string} newCategory - Target category
     * @param {string} compName - Comp name for toast
     */
    function executeMoveCompDirect(uniqueId, oldCategory, newCategory, compName) {
        showSpinner();

        // Find the comp's storage path from allComps
        var comp = null;
        for (var i = 0; i < allComps.length; i++) {
            if (allComps[i].uniqueId === uniqueId && allComps[i].category === oldCategory) {
                comp = allComps[i];
                break;
            }
        }

        // Cloud move: use storage move API
        if (comp && comp.storagePath && window.cloudLibrary && window.cloudLibrary.moveTemplate) {
            window.cloudLibrary.moveTemplate(comp.storagePath, newCategory).then(function() {
                hideSpinner();
                showToast('"' + compName + '" moved to ' + newCategory + '.');
                loadLibrary();
            }).catch(function(err) {
                hideSpinner();
                showToast('Move failed: ' + err.message, true);
            });
            return;
        }

        // Legacy local move fallback
        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            hideSpinner();
            return;
        }

        var safePath = escapeForExtendScript(libraryPath);
        var safeUniqueId = escapeForExtendScript(uniqueId);
        var safeOldCategory = escapeForExtendScript(oldCategory);
        var safeNewCategory = escapeForExtendScript(newCategory);

        safeEvalScript('moveCompToCategory("' + safePath + '","' + safeUniqueId + '","' + safeOldCategory + '","' + safeNewCategory + '")', function (result) {
            hideSpinner();
            if (result && result.indexOf('Success') === 0) {
                showToast('"' + compName + '" moved to ' + newCategory + '.');
                loadLibrary();
            } else {
                showToast(result || 'Move failed', true);
            }
        });
    }

    /* --------- Bulk Selection & Actions (Admin) --------- */

    function toggleBulkMode(enable) {
        bulkMode = typeof enable === 'boolean' ? enable : !bulkMode;
        if (!bulkMode) {
            bulkSelectedIds.clear();
        }
        var gridContainer = stashGrid.closest('.grid-container') || stashGrid.parentElement;
        if (gridContainer) {
            gridContainer.classList.toggle('bulk-mode', bulkMode);
        }
        updateBulkActionBar();
    }

    function toggleBulkSelect(uniqueId) {
        if (bulkSelectedIds.has(uniqueId)) {
            bulkSelectedIds.delete(uniqueId);
        } else {
            bulkSelectedIds.add(uniqueId);
        }
        // Update visual state
        var item = stashGrid.querySelector('.stash-item[data-unique-id="' + uniqueId + '"]');
        if (item) {
            item.classList.toggle('bulk-selected', bulkSelectedIds.has(uniqueId));
        }
        updateBulkActionBar();
    }

    function selectAllVisible() {
        var items = stashGrid.querySelectorAll('.stash-item');
        items.forEach(function(item) {
            var uid = item.dataset.uniqueId;
            if (uid) {
                bulkSelectedIds.add(uid);
                item.classList.add('bulk-selected');
            }
        });
        updateBulkActionBar();
    }

    function deselectAll() {
        bulkSelectedIds.clear();
        stashGrid.querySelectorAll('.stash-item.bulk-selected').forEach(function(item) {
            item.classList.remove('bulk-selected');
        });
        updateBulkActionBar();
    }

    function updateBulkActionBar() {
        var bar = document.getElementById('bulk-action-bar');
        if (!bar) return;
        var count = bulkSelectedIds.size;
        if (bulkMode) {
            bar.classList.add('active');
            bar.querySelector('.bulk-count').textContent = count > 0 ? count + ' selected' : 'Select templates...';
        } else {
            bar.classList.remove('active');
        }
    }

    function getSelectedComps() {
        return allComps.filter(function(c) { return bulkSelectedIds.has(c.uniqueId); });
    }

    function promptBulkMove() {
        var selected = getSelectedComps();
        if (selected.length === 0) return;
        if (bulkMoveCount) bulkMoveCount.textContent = selected.length;

        var categories = getUniqueCategories();
        if (bulkMoveCategorySelect) {
            bulkMoveCategorySelect.innerHTML = categories.map(function(cat) {
                return '<option value="' + escapeHTML(cat) + '">' + escapeHTML(cat) + '</option>';
            }).join('');
        }
        if (bulkMoveModal) bulkMoveModal.style.display = 'flex';
    }

    function executeBulkMove() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('Admin permission required.', true);
            return;
        }
        var targetCategory = bulkMoveCategorySelect ? bulkMoveCategorySelect.value : '';
        if (!targetCategory) {
            showToast('Please select a category.', true);
            return;
        }
        var selected = getSelectedComps();
        var storagePaths = selected.filter(function(c) { return c.storagePath; }).map(function(c) { return c.storagePath; });

        if (storagePaths.length === 0) {
            showToast('No cloud templates selected.', true);
            return;
        }

        bulkMoveModal.style.display = 'none';
        showSpinner();
        showToast('Moving ' + storagePaths.length + ' template(s)...');

        window.cloudLibrary.moveTemplates(storagePaths, targetCategory).then(function() {
            hideSpinner();
            showToast(storagePaths.length + ' template(s) moved to "' + targetCategory + '".');
            if (window.blitzkriegAnalytics && window.blitzkriegAnalytics.trackBulkOp) {
                window.blitzkriegAnalytics.trackBulkOp('bulk_move', storagePaths.length, storagePaths);
            }
            toggleBulkMode(false);
            loadLibrary();
        }).catch(function(err) {
            hideSpinner();
            showToast('Bulk move failed: ' + err.message, true);
        });
    }

    function promptBulkDelete() {
        var selected = getSelectedComps();
        if (selected.length === 0) return;
        if (bulkDeleteCount) bulkDeleteCount.textContent = selected.length;
        if (bulkDeleteModal) bulkDeleteModal.style.display = 'flex';
    }

    function executeBulkDelete() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('Admin permission required.', true);
            return;
        }
        var selected = getSelectedComps();
        var storagePaths = selected.filter(function(c) { return c.storagePath; }).map(function(c) { return c.storagePath; });

        if (storagePaths.length === 0) {
            showToast('No cloud templates selected.', true);
            return;
        }

        bulkDeleteModal.style.display = 'none';
        showSpinner();
        showToast('Deleting ' + storagePaths.length + ' template(s)...');

        window.cloudLibrary.deleteTemplates(storagePaths).then(function() {
            hideSpinner();
            showToast(storagePaths.length + ' template(s) deleted.');
            if (window.blitzkriegAnalytics && window.blitzkriegAnalytics.trackBulkOp) {
                window.blitzkriegAnalytics.trackBulkOp('bulk_delete', storagePaths.length, storagePaths);
            }
            toggleBulkMode(false);
            loadLibrary();
        }).catch(function(err) {
            hideSpinner();
            showToast('Bulk delete failed: ' + err.message, true);
        });
    }

    /* --------- Keyboard Shortcuts --------- */

    /**
     * Initialize keyboard shortcuts for common actions
     */
    function initKeyboardShortcuts() {
        document.addEventListener('keydown', function(e) {
            // Don't trigger shortcuts when typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                // Allow Escape to close modals even when in input
                if (e.key === 'Escape') {
                    closeAllModals();
                }
                // Allow Enter to confirm modals
                if (e.key === 'Enter' && !e.shiftKey) {
                    handleModalEnterKey(e);
                }
                return;
            }

            // Escape - close all modals
            if (e.key === 'Escape') {
                closeAllModals();
            }

            // Ctrl/Cmd + F - focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                searchInput.focus();
            }

            // Ctrl/Cmd + R - refresh library
            if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
                e.preventDefault();
                loadLibrary();
                showToast('Library refreshed.');
            }

            // Ctrl/Cmd + , - reserved for future settings

            // A - show all templates
            if (e.key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                activeCategory = 'All';
                renderUI();
            }

            // F - show favorites
            if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                activeCategory = 'Favorites';
                renderUI();
            }

            // R - show recent imports (without Ctrl modifier, since Ctrl+R is refresh)
            if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                activeCategory = 'Recent';
                renderUI();
            }

            // 1-9 - switch to category by number
            if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                var categories = getUniqueCategories();
                var index = parseInt(e.key) - 1;
                if (index < categories.length) {
                    activeCategory = categories[index];
                    renderUI();
                }
            }
        });
    }

    /**
     * Handle Enter key in modals to confirm
     */
    function handleModalEnterKey(e) {
        if (renameModal.style.display === 'flex') {
            e.preventDefault();
            executeRename();
        } else if (renameCategoryModal && renameCategoryModal.style.display === 'flex') {
            e.preventDefault();
            executeCategoryRename();
        } else if (moveCompModal && moveCompModal.style.display === 'flex') {
            e.preventDefault();
            executeMoveComp();
        } else if (addCompModal.style.display === 'flex') {
            e.preventDefault();
            executeAddComp();
        }
    }

    /**
     * Close all open modals
     */
    function closeAllModals() {
        deleteModal.style.display = 'none';
        currentDeleteInfo = null;

        addCompModal.style.display = 'none';

        renameModal.style.display = 'none';
        currentRenameInfo = null;

        if (renameCategoryModal) {
            renameCategoryModal.style.display = 'none';
            currentCategoryRenameInfo = null;
        }

        if (deleteCategoryModal) {
            deleteCategoryModal.style.display = 'none';
            currentCategoryDeleteInfo = null;
        }

        if (moveCompModal) {
            moveCompModal.style.display = 'none';
            currentMoveCompInfo = null;
        }

        if (bulkMoveModal) bulkMoveModal.style.display = 'none';
        if (bulkDeleteModal) bulkDeleteModal.style.display = 'none';

        // Exit bulk mode on Escape
        if (bulkMode) toggleBulkMode(false);

        if (settingsModal) settingsModal.style.display = 'none';

        var subDetailModal = document.getElementById('submission-detail-modal');
        if (subDetailModal) subDetailModal.style.display = 'none';
    }

    /* --------- Submissions & Review Workflow --------- */

    var rejectSubmissionModal = document.getElementById('reject-submission-modal');
    var rejectionNotesInput = document.getElementById('rejection-notes');
    var confirmRejectBtn = document.getElementById('confirm-reject-btn');
    var cancelRejectBtn = document.getElementById('cancel-reject-btn');
    var pendingRejectId = null;

    if (cancelRejectBtn) {
        cancelRejectBtn.addEventListener('click', function() {
            rejectSubmissionModal.style.display = 'none';
            pendingRejectId = null;
        });
    }
    if (confirmRejectBtn) {
        confirmRejectBtn.addEventListener('click', function() {
            if (pendingRejectId) {
                executeRejectSubmission(pendingRejectId, rejectionNotesInput.value.trim());
            }
        });
    }

    /**
     * Load submission counts for sidebar badges
     */
    function loadSubmissionCounts() {
        var sb = window.blitzkriegSupabase;
        if (!sb || !window.blitzkriegAuth || !window.blitzkriegAuth.getUser()) return;

        var userId = window.blitzkriegAuth.getUser().id;
        var isAdmin = window.blitzkriegAuth.isAdmin();

        // User's own submission counts (single query, count per status client-side)
        sb.from('blitzkrieg_template_submissions')
            .select('status')
            .eq('user_id', userId)
            .then(function(res) {
                var counts = { pending: 0, approved: 0, rejected: 0 };
                (res.data || []).forEach(function(row) {
                    if (counts.hasOwnProperty(row.status)) counts[row.status]++;
                });
                var pendingEl = document.getElementById('my-submissions-pending-count');
                var approvedEl = document.getElementById('my-submissions-approved-count');
                var rejectedEl = document.getElementById('my-submissions-rejected-count');
                if (pendingEl) pendingEl.textContent = counts.pending;
                if (approvedEl) approvedEl.textContent = counts.approved;
                if (rejectedEl) rejectedEl.textContent = counts.rejected;
            }).catch(function(err) {
                debugLog('Failed to load user submission counts: ' + err.message, 'warn');
            });

        // Admin review queue count
        if (isAdmin) {
            sb.from('blitzkrieg_template_submissions')
                .select('status', { count: 'exact', head: true })
                .eq('status', 'pending')
                .then(function(res) {
                    var el = document.getElementById('review-pending-count');
                    if (el) el.textContent = res.count || 0;
                }).catch(function(err) {
                    debugLog('Failed to load review queue count: ' + err.message, 'warn');
                });
        }
    }

    /**
     * Diagnostic helper — call from browser console via window.__blitzDiagnoseAdmin()
     * to verify the current user's admin status and see why the Pending Review queue
     * might be empty. Returns the full RPC result.
     */
    window.__blitzDiagnoseAdmin = function() {
        var sb = window.blitzkriegSupabase;
        if (!sb) { console.error('No Supabase client'); return; }
        return sb.rpc('debug_blitzkrieg_admin_status').then(function(res) {
            if (res.error) {
                console.error('debug_blitzkrieg_admin_status failed:', res.error);
                return res.error;
            }
            console.log('%c=== Blitzkrieg Admin Status ===', 'font-weight:bold;color:#4ADE80');
            console.log(res.data);
            if (res.data && res.data.is_admin === false) {
                console.warn('⚠ User is NOT admin according to the database. Check team_members.blitzkrieg_admin.');
            }
            if (res.data && res.data.pending_submission_count === 0) {
                console.warn('⚠ No pending submissions exist at all — the review queue is genuinely empty.');
            }
            return res.data;
        });
    };

    /**
     * Load and render submissions grid with visual thumbnails + preview frames
     * @param {string} statusFilter - 'pending', 'approved', 'rejected', or 'pending_review' (admin view)
     */
    function renderSubmissionsGrid(statusFilter) {
        var sb = window.blitzkriegSupabase;
        if (!sb) return;

        showSpinner();
        var isAdmin = window.blitzkriegAuth && window.blitzkriegAuth.isAdmin();
        var isReviewMode = (statusFilter === 'pending_review');

        var query = sb.from('blitzkrieg_template_submissions')
            .select('*')
            .order('created_at', { ascending: false });

        if (isReviewMode) {
            query = query.eq('status', 'pending');
        } else {
            query = query.eq('user_id', window.blitzkriegAuth.getUser().id)
                         .eq('status', statusFilter);
        }

        query.then(async function(res) {
            if (res.error) {
                hideSpinner();
                showPlaceholder('Failed to load submissions.');
                return;
            }

            var submissions = res.data || [];
            if (submissions.length === 0) {
                hideSpinner();
                var msg = isReviewMode ? 'No submissions pending review.' : 'No ' + statusFilter + ' submissions.';
                showPlaceholder(msg);
                return;
            }

            // Sign thumbnail + preview frame URLs for all submissions
            var thumbPaths = [];
            var previewPaths = {}; // submissionId -> [paths]
            submissions.forEach(function(sub) {
                if (sub.storage_path) {
                    thumbPaths.push(sub.storage_path + '/comp.png');
                    // Check metadata for preview frame count
                    var meta = sub.metadata || {};
                    var frameCount = meta.previewFrames || meta.cloudPreviewFrameCount || 0;
                    if (frameCount > 0) {
                        var paths = [];
                        for (var i = 0; i < frameCount; i++) {
                            paths.push(sub.storage_path + '/preview/frame_' + i + '.png');
                        }
                        previewPaths[sub.id] = paths;
                        thumbPaths = thumbPaths.concat(paths);
                    }
                }
            });

            var signedUrlMap = {};
            if (thumbPaths.length > 0 && window.cloudLibrary && window.cloudLibrary.signPaths) {
                try {
                    signedUrlMap = await window.cloudLibrary.signPaths(thumbPaths);
                } catch (e) {
                    debugLog('Failed to sign submission thumbnails: ' + e.message, 'warn');
                }
            }

            hideSpinner();

            var currentUserId = window.blitzkriegAuth.getUser().id;
            var html = '';
            submissions.forEach(function(sub) {
                var statusClass = 'status-' + sub.status;
                var statusLabel = sub.status.charAt(0).toUpperCase() + sub.status.slice(1);
                var dateStr = new Date(sub.created_at).toLocaleDateString();
                var thumbUrl = sub.storage_path ? (signedUrlMap[sub.storage_path + '/comp.png'] || '') : '';
                var nameInitial = (sub.template_name || '?').charAt(0).toUpperCase();
                var meta = sub.metadata || {};
                var frameCount = meta.previewFrames || meta.cloudPreviewFrameCount || 0;
                var isOwnSubmission = sub.user_id === currentUserId;

                html += '<div class="stash-item submission-card" data-submission-id="' + escapeHTML(sub.id) + '">';

                // Thumbnail with status badge overlay
                html += '<div class="submission-thumbnail">';
                if (thumbUrl) {
                    html += '<img src="' + escapeHTML(thumbUrl) + '" alt="' + escapeHTML(sub.template_name) + '" class="submission-thumb-img">';
                    html += '<div class="submission-thumb-placeholder" style="display:none;">' + escapeHTML(nameInitial) + '</div>';
                } else {
                    html += '<div class="submission-thumb-placeholder">' + escapeHTML(nameInitial) + '</div>';
                }
                html += '<span class="status-badge-overlay ' + statusClass + '">' + statusLabel + '</span>';
                html += '</div>';

                // Preview frames strip
                if (frameCount > 0 && previewPaths[sub.id]) {
                    var hasFrames = false;
                    var stripHtml = '<div class="submission-preview-strip">';
                    previewPaths[sub.id].forEach(function(path) {
                        var frameUrl = signedUrlMap[path];
                        if (frameUrl) {
                            hasFrames = true;
                            stripHtml += '<img src="' + escapeHTML(frameUrl) + '" alt="Preview frame">';
                        }
                    });
                    stripHtml += '</div>';
                    if (hasFrames) html += stripHtml;
                }

                // Card body
                html += '<div class="submission-card-body">';
                html += '<div class="submission-card-header">';
                html += '<span class="submission-name">' + escapeHTML(sub.template_name) + '</span>';
                html += '</div>';
                html += '<div class="submission-card-meta">';
                html += '<span class="submission-category">' + escapeHTML(sub.category) + '</span>';
                html += '<span class="submission-date">' + dateStr + '</span>';
                html += '</div>';

                // Submitter info (for admin review mode)
                if (isReviewMode && sub.metadata && sub.metadata.submitterName) {
                    html += '<div class="submission-submitter">';
                    html += '<span class="submitter-avatar">' + escapeHTML(sub.metadata.submitterName.charAt(0).toUpperCase()) + '</span>';
                    html += '<span>' + escapeHTML(sub.metadata.submitterName) + '</span>';
                    html += '</div>';
                }

                // Show rejection notes if rejected
                if (sub.status === 'rejected' && sub.reviewer_notes) {
                    html += '<div class="submission-rejection-notes">';
                    html += '<strong>Feedback:</strong> ' + escapeHTML(sub.reviewer_notes);
                    html += '</div>';
                }

                // Admin actions — show on pending submissions if admin
                if (isAdmin && sub.status === 'pending') {
                    html += '<div class="submission-actions">';
                    html += '<button class="button-primary btn-approve" data-action="approve-submission" data-submission-id="' + escapeHTML(sub.id) + '">Approve</button>';
                    html += '<button class="button-danger btn-reject" data-action="reject-submission" data-submission-id="' + escapeHTML(sub.id) + '">Reject</button>';
                    html += '</div>';
                }

                // User actions — withdraw own pending submission
                if (isOwnSubmission && sub.status === 'pending') {
                    html += '<div class="submission-actions">';
                    html += '<button class="button-danger btn-reject" data-action="withdraw-submission" data-submission-id="' + escapeHTML(sub.id) + '">Withdraw</button>';
                    html += '</div>';
                }

                // User actions — resubmit rejected submission
                if (isOwnSubmission && sub.status === 'rejected') {
                    html += '<div class="submission-actions">';
                    html += '<button class="button-primary btn-approve" data-action="resubmit-submission" data-submission-id="' + escapeHTML(sub.id) + '">Resubmit</button>';
                    html += '</div>';
                }

                html += '</div>'; // .submission-card-body
                html += '</div>'; // .submission-card
            });

            stashGrid.innerHTML = html;

            // Bind error handlers for submission thumbnails (no inline onerror)
            stashGrid.querySelectorAll('.submission-thumb-img').forEach(function(img) {
                img.addEventListener('error', function() {
                    this.style.display = 'none';
                    var placeholder = this.parentElement.querySelector('.submission-thumb-placeholder');
                    if (placeholder) placeholder.style.display = 'flex';
                });
            });
        }).catch(function(err) {
            hideSpinner();
            showPlaceholder('Failed to load submissions: ' + (err.message || 'Unknown error'));
            debugLog('renderSubmissionsGrid error: ' + (err.message || err), 'error');
        });
    }

    /**
     * Open submission detail modal — fetches submission data and shows full preview
     */
    function openSubmissionDetail(submissionId) {
        var sb = window.blitzkriegSupabase;
        if (!sb) return;

        var detailModal = document.getElementById('submission-detail-modal');
        var detailContent = document.getElementById('submission-detail-content');
        if (!detailModal || !detailContent) return;

        detailContent.innerHTML = '<p style="padding:32px;text-align:center;color:var(--text-muted);">Loading...</p>';
        detailModal.style.display = 'flex';

        sb.from('blitzkrieg_template_submissions')
            .select('*')
            .eq('id', submissionId)
            .single()
            .then(async function(res) {
                if (res.error || !res.data) {
                    detailContent.innerHTML = '<p style="padding:32px;text-align:center;color:var(--error);">Submission not found.</p>';
                    return;
                }

                var sub = res.data;
                var meta = sub.metadata || {};
                var isAdmin = window.blitzkriegAuth && window.blitzkriegAuth.isAdmin();
                var detailCurrentUser = window.blitzkriegAuth && window.blitzkriegAuth.getUser();
                var detailIsOwn = !!(detailCurrentUser && sub.user_id === detailCurrentUser.id);

                // Sign thumbnail + preview frames
                var pathsToSign = [];
                var previewFramePaths = [];
                if (sub.storage_path) {
                    pathsToSign.push(sub.storage_path + '/comp.png');
                    var frameCount = meta.previewFrames || meta.cloudPreviewFrameCount || 0;
                    for (var i = 0; i < frameCount; i++) {
                        var framePath = sub.storage_path + '/preview/frame_' + i + '.png';
                        pathsToSign.push(framePath);
                        previewFramePaths.push(framePath);
                    }
                }

                var signedMap = {};
                if (pathsToSign.length > 0 && window.cloudLibrary && window.cloudLibrary.signPaths) {
                    try {
                        signedMap = await window.cloudLibrary.signPaths(pathsToSign);
                    } catch(e) {
                        debugLog('openSubmissionDetail: signPaths failed: ' + (e && e.message || e), 'warn');
                    }
                }

                var thumbUrl = sub.storage_path ? (signedMap[sub.storage_path + '/comp.png'] || '') : '';
                var nameInitial = (sub.template_name || '?').charAt(0).toUpperCase();
                var statusClass = 'status-' + sub.status;
                var statusLabel = sub.status.charAt(0).toUpperCase() + sub.status.slice(1);
                var dateStr = new Date(sub.created_at).toLocaleDateString();

                var html = '';

                // Preview area
                html += '<div class="submission-detail-preview">';
                if (thumbUrl) {
                    html += '<img src="' + escapeHTML(thumbUrl) + '" alt="' + escapeHTML(sub.template_name) + '" id="submission-detail-main-img" class="submission-thumb-img">';
                    html += '<div class="detail-thumb-placeholder" style="display:none;">' + escapeHTML(nameInitial) + '</div>';
                } else {
                    html += '<div class="detail-thumb-placeholder">' + escapeHTML(nameInitial) + '</div>';
                }
                html += '</div>';

                // Preview frames strip
                if (previewFramePaths.length > 0) {
                    var hasAnyFrame = false;
                    var framesHtml = '<div class="submission-detail-frames">';
                    previewFramePaths.forEach(function(path) {
                        var frameUrl = signedMap[path];
                        if (frameUrl) {
                            hasAnyFrame = true;
                            framesHtml += '<img src="' + escapeHTML(frameUrl) + '" alt="Frame" data-full-url="' + escapeHTML(frameUrl) + '">';
                        }
                    });
                    framesHtml += '</div>';
                    if (hasAnyFrame) html += framesHtml;
                }

                // Body
                html += '<div class="submission-detail-body">';
                html += '<div class="submission-detail-title">' + escapeHTML(sub.template_name) + '</div>';
                html += '<span class="submission-detail-status status-badge-overlay ' + statusClass + '">' + statusLabel + '</span>';

                // Metadata grid
                html += '<div class="submission-detail-meta">';
                html += '<div class="submission-detail-meta-item"><span class="submission-detail-meta-label">Category</span><span class="submission-detail-meta-value">' + escapeHTML(sub.category) + '</span></div>';
                html += '<div class="submission-detail-meta-item"><span class="submission-detail-meta-label">Submitted</span><span class="submission-detail-meta-value">' + escapeHTML(dateStr) + '</span></div>';
                if (meta.duration) {
                    html += '<div class="submission-detail-meta-item"><span class="submission-detail-meta-label">Duration</span><span class="submission-detail-meta-value">' + meta.duration.toFixed(1) + 's</span></div>';
                }
                if (meta.width && meta.height) {
                    html += '<div class="submission-detail-meta-item"><span class="submission-detail-meta-label">Resolution</span><span class="submission-detail-meta-value">' + meta.width + ' x ' + meta.height + '</span></div>';
                }
                if (meta.frameRate) {
                    html += '<div class="submission-detail-meta-item"><span class="submission-detail-meta-label">Frame Rate</span><span class="submission-detail-meta-value">' + meta.frameRate + ' fps</span></div>';
                }
                if (meta.submitterName) {
                    html += '<div class="submission-detail-meta-item"><span class="submission-detail-meta-label">Submitter</span><span class="submission-detail-meta-value">' + escapeHTML(meta.submitterName) + '</span></div>';
                }
                html += '</div>';

                // Rejection notes
                if (sub.status === 'rejected' && sub.reviewer_notes) {
                    html += '<div class="submission-detail-rejection"><strong>Rejection Feedback:</strong> ' + escapeHTML(sub.reviewer_notes) + '</div>';
                }

                // Admin actions for pending submissions
                if (isAdmin && sub.status === 'pending') {
                    html += '<div class="submission-detail-actions">';
                    html += '<button class="btn-detail-approve" data-action="approve-submission" data-submission-id="' + escapeHTML(sub.id) + '">Approve</button>';
                    html += '<button class="btn-detail-reject" data-action="reject-submission" data-submission-id="' + escapeHTML(sub.id) + '">Reject</button>';
                    html += '</div>';
                }

                // Own submission actions
                if (detailIsOwn && sub.status === 'pending') {
                    html += '<div class="submission-detail-actions">';
                    html += '<button class="btn-detail-reject" data-action="withdraw-submission" data-submission-id="' + escapeHTML(sub.id) + '">Withdraw Submission</button>';
                    html += '</div>';
                }
                if (detailIsOwn && sub.status === 'rejected') {
                    html += '<div class="submission-detail-actions">';
                    html += '<button class="btn-detail-approve" data-action="resubmit-submission" data-submission-id="' + escapeHTML(sub.id) + '">Resubmit for Review</button>';
                    html += '</div>';
                }

                html += '</div>'; // .submission-detail-body

                detailContent.innerHTML = html;

                // Bind error handler for detail thumbnail
                var detailImg = detailContent.querySelector('.submission-thumb-img');
                if (detailImg) {
                    detailImg.addEventListener('error', function() {
                        this.style.display = 'none';
                        var ph = this.parentElement.querySelector('.detail-thumb-placeholder');
                        if (ph) ph.style.display = 'flex';
                    });
                }

                // Click preview frame → swap main image
                detailContent.querySelectorAll('.submission-detail-frames img').forEach(function(frameImg) {
                    frameImg.addEventListener('click', function() {
                        var mainImg = document.getElementById('submission-detail-main-img');
                        if (mainImg) {
                            mainImg.src = this.dataset.fullUrl;
                        }
                        // Highlight active frame
                        detailContent.querySelectorAll('.submission-detail-frames img').forEach(function(f) { f.classList.remove('active-frame'); });
                        this.classList.add('active-frame');
                    });
                });

                // Bind all actions from detail modal
                detailContent.querySelectorAll('[data-action]').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var action = this.dataset.action;
                        var sid = this.dataset.submissionId;
                        detailModal.style.display = 'none';
                        if (action === 'approve-submission') approveSubmission(sid);
                        if (action === 'reject-submission') promptRejectSubmission(sid);
                        if (action === 'withdraw-submission') withdrawSubmission(sid);
                        if (action === 'resubmit-submission') resubmitSubmission(sid);
                    });
                });
            }).catch(function(err) {
                detailContent.innerHTML = '<p style="padding:32px;text-align:center;color:var(--error);">Failed to load submission details.</p>';
                debugLog('openSubmissionDetail error: ' + (err.message || err), 'error');
            });
    }

    /**
     * Approve a submission: copy files from pending to production, update DB
     */
    function approveSubmission(submissionId) {
        var sb = window.blitzkriegSupabase;
        if (!sb || !window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) return;
        // Prevent double-submit: if this submission is already being processed,
        // a second click would fire a parallel copy-delete pipeline and corrupt state.
        if (_submissionInFlight[submissionId]) {
            showToast('Already processing this submission...');
            return;
        }
        _submissionInFlight[submissionId] = 1;

        showSpinner();
        showToast('Approving submission...');

        // Clear the in-flight flag on every exit path
        function _approveDone() { delete _submissionInFlight[submissionId]; }

        sb.from('blitzkrieg_template_submissions')
            .select('*')
            .eq('id', submissionId)
            .single()
            .then(function(res) {
                if (res.error || !res.data) {
                    hideSpinner();
                    showToast('Submission not found.', true);
                    _approveDone();
                    return;
                }

                var sub = res.data;

                var pendingPath = sub.storage_path;
                if (!pendingPath || typeof pendingPath !== 'string') {
                    hideSpinner();
                    showToast('Submission has no storage path — cannot approve.', true);
                    _approveDone();
                    return;
                }
                if (!sub.category || typeof sub.category !== 'string') {
                    hideSpinner();
                    showToast('Submission has no category — cannot approve.', true);
                    _approveDone();
                    return;
                }
                var productionPath = sub.category + '/' + pendingPath.split('/').pop();

                // List files in the pending path (including preview subfolder)
                sb.storage.from('blitzkrieg').list(pendingPath).then(async function(listRes) {
                    if (listRes.error || !listRes.data || listRes.data.length === 0) {
                        hideSpinner();
                        showToast('No files found in pending path.', true);
                        _approveDone();
                        return;
                    }

                    // Collect top-level files
                    var filesToCopy = listRes.data
                        .filter(function(f) { return f.id !== null; })
                        .map(function(f) { return { src: pendingPath + '/' + f.name, dest: productionPath + '/' + f.name }; });

                    // Check for preview subfolder
                    var subFolders = listRes.data.filter(function(f) { return f.id === null; });
                    for (var si = 0; si < subFolders.length; si++) {
                        var subName = subFolders[si].name;
                        var subListRes = await sb.storage.from('blitzkrieg').list(pendingPath + '/' + subName);
                        if (subListRes.data) {
                            subListRes.data.filter(function(f) { return f.id !== null; }).forEach(function(f) {
                                filesToCopy.push({
                                    src: pendingPath + '/' + subName + '/' + f.name,
                                    dest: productionPath + '/' + subName + '/' + f.name,
                                });
                            });
                        }
                    }

                    var copyPromises = filesToCopy.map(function(entry) {
                        return sb.storage.from('blitzkrieg').download(entry.src).then(function(dlRes) {
                            if (dlRes.error) throw new Error('Download failed: ' + dlRes.error.message);
                            return sb.storage.from('blitzkrieg').upload(entry.dest, dlRes.data, {
                                upsert: true,
                            });
                        }).then(function(upRes) {
                            if (upRes.error) throw new Error('Upload failed: ' + upRes.error.message);
                            return sb.storage.from('blitzkrieg').remove([entry.src]);
                        });
                    });

                    Promise.all(copyPromises).then(function() {
                        // Update submission record
                        return sb.from('blitzkrieg_template_submissions')
                            .update({
                                status: 'approved',
                                reviewer_id: window.blitzkriegAuth.getUser().id,
                                reviewed_at: new Date().toISOString(),
                                approved_storage_path: productionPath,
                            })
                            .eq('id', submissionId);
                    }).then(function(updateRes) {
                        hideSpinner();
                        if (updateRes.error) {
                            showToast('Files moved but DB update failed: ' + updateRes.error.message, true);
                        } else {
                            showToast('Submission approved and published!');
                            window.cloudLibrary.invalidateCache();
                            loadSubmissionCounts();
                            // Re-render whatever submission view is currently active
                            if (activeCategory === '__review_pending') {
                                renderSubmissionsGrid('pending_review');
                            } else if (activeCategory.indexOf('__submissions_') === 0) {
                                renderSubmissionsGrid(activeCategory.replace('__submissions_', ''));
                            } else {
                                renderSubmissionsGrid('pending_review');
                            }
                        }
                        _approveDone();
                    }).catch(function(err) {
                        hideSpinner();
                        showToast('Approve failed: ' + err.message, true);
                        _approveDone();
                    });
                }).catch(function(listErr) {
                    // inner list().then() rejection — network failure during pending listing
                    hideSpinner();
                    showToast('Approve failed to list files: ' + (listErr && listErr.message || listErr), true);
                    _approveDone();
                });
            }).catch(function(outerErr) {
                // outer select().single() rejection — network failure fetching the submission
                hideSpinner();
                showToast('Approve failed: ' + (outerErr && outerErr.message || outerErr), true);
                _approveDone();
            });
    }

    /**
     * Open rejection modal
     */
    function promptRejectSubmission(submissionId) {
        pendingRejectId = submissionId;
        if (rejectionNotesInput) rejectionNotesInput.value = '';
        if (rejectSubmissionModal) rejectSubmissionModal.style.display = 'flex';
    }

    /**
     * Execute rejection with notes
     */
    function executeRejectSubmission(submissionId, notes) {
        var sb = window.blitzkriegSupabase;
        if (!sb || !window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to reject submissions.', true);
            return;
        }
        if (_submissionInFlight[submissionId]) { showToast('Already processing this submission...'); return; }
        _submissionInFlight[submissionId] = 1;

        rejectSubmissionModal.style.display = 'none';
        showSpinner();

        sb.from('blitzkrieg_template_submissions')
            .update({
                status: 'rejected',
                reviewer_id: window.blitzkriegAuth.getUser().id,
                reviewer_notes: notes || '',
                reviewed_at: new Date().toISOString(),
            })
            .eq('id', submissionId)
            .then(function(res) {
                hideSpinner();
                pendingRejectId = null;
                delete _submissionInFlight[submissionId];
                if (res.error) {
                    showToast('Rejection failed: ' + res.error.message, true);
                } else {
                    showToast('Submission rejected.');
                    loadSubmissionCounts();
                    // Re-render whatever submission view is currently active
                    if (activeCategory === '__review_pending') {
                        renderSubmissionsGrid('pending_review');
                    } else if (activeCategory.indexOf('__submissions_') === 0) {
                        renderSubmissionsGrid(activeCategory.replace('__submissions_', ''));
                    } else {
                        renderSubmissionsGrid('pending_review');
                    }
                }
            }).catch(function(err) {
                hideSpinner();
                pendingRejectId = null;
                delete _submissionInFlight[submissionId];
                showToast('Rejection failed: ' + err.message, true);
            });
    }


    /**
     * Withdraw a pending submission (own submissions only).
     * Deletes files from pending storage and removes the DB record.
     */
    function withdrawSubmission(submissionId) {
        var sb = window.blitzkriegSupabase;
        if (!sb || !window.blitzkriegAuth) return;
        if (_submissionInFlight[submissionId]) { showToast('Already processing this submission...'); return; }
        _submissionInFlight[submissionId] = 1;

        var userId = window.blitzkriegAuth.getUser().id;

        // Verify it's the user's own pending submission
        sb.from('blitzkrieg_template_submissions')
            .select('*')
            .eq('id', submissionId)
            .eq('user_id', userId)
            .eq('status', 'pending')
            .single()
            .then(async function(res) {
                if (res.error || !res.data) {
                    showToast('Cannot withdraw — submission not found or not yours.', true);
                    return;
                }

                showSpinner();
                showToast('Withdrawing submission...');

                var sub = res.data;
                // Delete files from pending storage. The old code referenced a
                // non-existent `window.cloudLibrary.collectAllFilesForPath` via a
                // ternary that always fell through — fixed to a single straightforward
                // list-and-recurse flow.
                if (sub.storage_path) {
                    try {
                        var allFiles = [];
                        var listRes = await sb.storage.from('blitzkrieg').list(sub.storage_path);
                        if (listRes.data) {
                            allFiles = listRes.data
                                .filter(function(f) { return f.id !== null; })
                                .map(function(f) { return sub.storage_path + '/' + f.name; });
                            // Check subfolders (e.g. preview/)
                            var subFolders = listRes.data.filter(function(f) { return f.id === null; });
                            for (var sf = 0; sf < subFolders.length; sf++) {
                                var subList = await sb.storage.from('blitzkrieg').list(sub.storage_path + '/' + subFolders[sf].name);
                                if (subList.data) {
                                    subList.data.filter(function(f) { return f.id !== null; }).forEach(function(f) {
                                        allFiles.push(sub.storage_path + '/' + subFolders[sf].name + '/' + f.name);
                                    });
                                }
                            }
                        }
                        if (allFiles.length > 0) {
                            await sb.storage.from('blitzkrieg').remove(allFiles);
                        }
                    } catch (e) {
                        debugLog('Withdraw file cleanup warning: ' + e.message, 'warn');
                    }
                }

                // Delete DB record
                var delRes = await sb.from('blitzkrieg_template_submissions')
                    .delete()
                    .eq('id', submissionId)
                    .eq('user_id', userId);

                hideSpinner();
                delete _submissionInFlight[submissionId];
                if (delRes.error) {
                    showToast('Withdraw failed: ' + delRes.error.message, true);
                } else {
                    showToast('Submission withdrawn.');
                    loadSubmissionCounts();
                    // Re-render current view
                    if (activeCategory === '__review_pending') {
                        renderSubmissionsGrid('pending_review');
                    } else if (activeCategory.indexOf('__submissions_') === 0) {
                        renderSubmissionsGrid(activeCategory.replace('__submissions_', ''));
                    }
                }
            }).catch(function(err) {
                hideSpinner();
                delete _submissionInFlight[submissionId];
                showToast('Withdraw failed: ' + (err && err.message || err), true);
            });
    }

    /**
     * Resubmit a rejected submission — resets status to 'pending' for admin review.
     */
    function resubmitSubmission(submissionId) {
        var sb = window.blitzkriegSupabase;
        if (!sb || !window.blitzkriegAuth) return;
        if (_submissionInFlight[submissionId]) { showToast('Already processing this submission...'); return; }
        _submissionInFlight[submissionId] = 1;

        var userId = window.blitzkriegAuth.getUser().id;

        showSpinner();
        showToast('Resubmitting for review...');

        sb.from('blitzkrieg_template_submissions')
            .update({
                status: 'pending',
                reviewer_id: null,
                reviewer_notes: null,
                reviewed_at: null,
            })
            .eq('id', submissionId)
            .eq('user_id', userId)
            .eq('status', 'rejected')
            .then(function(res) {
                hideSpinner();
                delete _submissionInFlight[submissionId];
                if (res.error) {
                    showToast('Resubmit failed: ' + res.error.message, true);
                } else {
                    showToast('Submission resubmitted for review!');
                    loadSubmissionCounts();
                    // Navigate to pending view
                    activeCategory = '__submissions_pending';
                    updateNavActiveState();
                    renderSubmissionsGrid('pending');
                }
            }).catch(function(err) {
                hideSpinner();
                delete _submissionInFlight[submissionId];
                showToast('Resubmit failed: ' + (err && err.message || err), true);
            });
    }

    /* --------- Analytics Dashboard (Admin) — Multi-view Drilldown --------- */

    // Analytics view state
    var analyticsView = null; // 'overview' | 'editors' | 'editor-detail' | 'template-detail' | null
    var analyticsEditorId = null;
    var analyticsEditorName = '';
    var analyticsTemplateName = '';
    var analyticsTemplateCategory = '';
    var analyticsDateRange = '30d';
    var analyticsShowAllEvents = false;

    var ANALYTICS_PERIOD_DAYS = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 };

    // Cache for overview data to avoid refetch on tab switch
    var analyticsCache = { summary: null, dailyStats: [], topTemplates: [], userStats: [] };

    function analyticsStartDate() {
        var days = ANALYTICS_PERIOD_DAYS[analyticsDateRange] || 30;
        return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    }

    function analyticsFormatNumber(n) {
        return Number(n || 0).toLocaleString('en-US');
    }

    function analyticsFormatTimeAgo(dateStr) {
        if (!dateStr) return 'never';
        var diff = Date.now() - new Date(dateStr).getTime();
        var mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        var hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        var days = Math.floor(hrs / 24);
        if (days < 30) return days + 'd ago';
        return Math.floor(days / 30) + 'mo ago';
    }

    function analyticsGetInitials(name) {
        if (!name) return '?';
        var parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    function analyticsAvatarColor(name) {
        var colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B', '#10B981', '#6366F1', '#EF4444'];
        var hash = 0;
        for (var i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    }

    function analyticsEventIcon(eventType) {
        switch (eventType) {
            case 'template_import': return { symbol: '↓', cls: 'import' };
            case 'template_view': return { symbol: '◉', cls: 'view' };
            case 'template_favorite': return { symbol: '★', cls: 'favorite' };
            case 'search': return { symbol: '⌕', cls: 'search' };
            case 'category_browse': return { symbol: '☰', cls: 'browse' };
            case 'session_start': return { symbol: '▶', cls: 'session' };
            case 'session_end': return { symbol: '■', cls: 'session' };
            default: return { symbol: '•', cls: 'session' };
        }
    }

    function analyticsEventLabel(eventType) {
        switch (eventType) {
            case 'template_import': return 'Imported';
            case 'template_view': return 'Viewed';
            case 'template_favorite': return 'Favorited';
            case 'search': return 'Searched';
            case 'category_browse': return 'Browsed category';
            case 'session_start': return 'Started session';
            case 'session_end': return 'Ended session';
            default: return eventType;
        }
    }

    function buildStatCard(value, label, opts) {
        opts = opts || {};
        var cls = 'analytics-stat-card' + (opts.clickable ? ' clickable' : '');
        var attrs = opts.action ? ' data-analytics-action="' + opts.action + '"' : '';
        var trendHtml = '';
        if (opts.trend && opts.trend.pct !== undefined) {
            var dir = opts.trend.direction || 'neutral';
            var arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '–';
            var pctStr = Math.abs(opts.trend.pct).toFixed(0) + '%';
            trendHtml = '<div class="stat-trend ' + dir + '">' + arrow + ' ' + pctStr + '</div>';
        }
        return '<div class="' + cls + '"' + attrs + '>' +
            '<div class="stat-value">' + escapeHTML(String(value)) + '</div>' +
            trendHtml +
            '<div class="stat-label">' + escapeHTML(label) + '</div>' +
            '</div>';
    }

    function buildAnalyticsBreadcrumb() {
        if (analyticsView === 'overview' || analyticsView === 'editors') return '';
        var html = '<div class="analytics-breadcrumb">';
        html += '<span class="breadcrumb-link" data-analytics-action="goto-overview">Overview</span>';
        if (analyticsView === 'editor-detail') {
            html += '<span class="breadcrumb-sep">/</span>';
            html += '<span class="breadcrumb-link" data-analytics-action="goto-editors">Editors</span>';
            html += '<span class="breadcrumb-sep">/</span>';
            html += '<span class="breadcrumb-current">' + escapeHTML(analyticsEditorName || 'Editor') + '</span>';
        }
        if (analyticsView === 'template-detail') {
            html += '<span class="breadcrumb-sep">/</span>';
            html += '<span class="breadcrumb-current">' + escapeHTML(analyticsTemplateName || 'Template') + '</span>';
        }
        html += '</div>';
        return html;
    }

    function buildCSSBarChart(dailyStats) {
        if (!dailyStats || dailyStats.length === 0) {
            return '<p class="placeholder-text">No usage data for this period.</p>';
        }
        var maxVal = 1;
        dailyStats.forEach(function(d) {
            maxVal = Math.max(maxVal, Number(d.import_count) || 0, Number(d.session_count) || 0);
        });
        var showLabels = dailyStats.length <= 14;
        var html = '<div class="css-bar-chart-container">';
        html += '<div class="css-bar-chart-title">Daily Activity</div>';
        html += '<div class="css-bar-chart">';
        dailyStats.forEach(function(d) {
            var importH = Math.max(((Number(d.import_count) || 0) / maxVal) * 100, 3);
            var sessionH = Math.max(((Number(d.session_count) || 0) / maxVal) * 100, 3);
            var dateLabel = new Date(d.stat_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            html += '<div class="chart-bar-group" title="' + dateLabel + ': ' + (d.import_count || 0) + ' imports, ' + (d.session_count || 0) + ' sessions">';
            html += '<div class="chart-bar-pair">';
            html += '<div class="chart-bar imports" style="height:' + importH + '%"></div>';
            html += '<div class="chart-bar sessions" style="height:' + sessionH + '%"></div>';
            html += '</div>';
            if (showLabels) html += '<div class="chart-bar-label">' + dateLabel + '</div>';
            html += '</div>';
        });
        html += '</div>';
        html += '<div class="chart-legend">';
        html += '<span class="chart-legend-item"><span class="chart-legend-dot imports"></span>Imports</span>';
        html += '<span class="chart-legend-item"><span class="chart-legend-dot sessions"></span>Sessions</span>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function buildActivityTimeline(events, showAll) {
        if (!events || events.length === 0) {
            return '<p class="placeholder-text">No activity for this period.</p>';
        }

        // Filter out view/browse noise unless showAll is true
        var filtered = showAll ? events : events.filter(function(ev) {
            return ev.event_type !== 'template_view' && ev.event_type !== 'category_browse';
        });

        if (filtered.length === 0) {
            return '<p class="placeholder-text">No import activity for this period. Toggle "Show All Events" to see views.</p>';
        }

        // Group by date
        var groups = {};
        var groupOrder = [];
        filtered.forEach(function(ev) {
            var dateKey = new Date(ev.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
            if (!groups[dateKey]) { groups[dateKey] = []; groupOrder.push(dateKey); }
            groups[dateKey].push(ev);
        });

        var html = '<div class="activity-timeline">';
        groupOrder.forEach(function(dateKey) {
            html += '<div class="timeline-date-group">';
            html += '<div class="timeline-date-header">' + escapeHTML(dateKey) + '</div>';
            groups[dateKey].forEach(function(ev) {
                var icon = analyticsEventIcon(ev.event_type);
                var label = analyticsEventLabel(ev.event_type);
                var time = new Date(ev.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                html += '<div class="timeline-event">';
                html += '<div class="event-icon ' + icon.cls + '">' + icon.symbol + '</div>';
                html += '<div class="event-details"><span>' + escapeHTML(label);
                if (ev.template_name) {
                    html += ' <span class="event-template-link" data-analytics-action="goto-template" data-template-name="' +
                        escapeHTML(ev.template_name) + '" data-template-category="' + escapeHTML(ev.template_category || '') + '">' +
                        escapeHTML(ev.template_name) + '</span>';
                }
                if (ev.search_query) {
                    html += ' <span style="color:var(--text-muted)">&quot;' + escapeHTML(ev.search_query) + '&quot;</span>';
                }
                if (ev.template_category && ev.event_type === 'category_browse') {
                    html += ' <span style="color:var(--text-muted)">' + escapeHTML(ev.template_category) + '</span>';
                }
                html += '</span></div>';
                html += '<span class="event-time">' + time + '</span>';
                html += '</div>';
            });
            html += '</div>';
        });
        html += '</div>';
        return html;
    }

    /**
     * Render the analytics dashboard shell + delegate to sub-view
     */
    function renderAnalyticsDashboard() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showPlaceholder('Analytics is available to admins only.');
            return;
        }

        // Dismiss any stuck spinners/modals from previous operations
        hideSpinner();
        var stuckModal = document.getElementById('submission-detail-modal');
        if (stuckModal) stuckModal.style.display = 'none';

        if (!analyticsView) analyticsView = 'overview';

        // Build shell HTML: header bar with tabs + date range
        var activeTab = analyticsView === 'team' ? 'team' : analyticsView === 'errors' ? 'errors' : (analyticsView === 'overview' || analyticsView === 'template-detail') ? 'overview' : 'editors';
        var html = '<div class="analytics-dashboard">';

        // Header bar
        html += '<div class="analytics-header-bar">';
        html += '<div class="analytics-tabs">';
        html += '<button class="analytics-tab' + (activeTab === 'overview' ? ' active' : '') + '" data-analytics-action="goto-overview">Overview</button>';
        html += '<button class="analytics-tab' + (activeTab === 'editors' ? ' active' : '') + '" data-analytics-action="goto-editors">Editors</button>';
        html += '<button class="analytics-tab' + (activeTab === 'team' ? ' active' : '') + '" data-analytics-action="goto-team">Team</button>';
        html += '<button class="analytics-tab' + (activeTab === 'errors' ? ' active' : '') + '" data-analytics-action="goto-errors">Errors</button>';
        html += '</div>';
        html += '<div class="analytics-date-range">';
        ['7d', '14d', '30d', '90d'].forEach(function(key) {
            html += '<button class="date-range-btn' + (analyticsDateRange === key ? ' active' : '') + '" data-analytics-action="set-period" data-period="' + key + '">' + key + '</button>';
        });
        html += '</div>';
        html += '</div>';

        // Breadcrumb
        html += buildAnalyticsBreadcrumb();

        // Content placeholder (filled by sub-renderer)
        html += '<div id="analytics-content"></div>';
        html += '</div>';

        stashGrid.innerHTML = html;

        // Render the active sub-view
        switch (analyticsView) {
            case 'overview': renderAnalyticsOverview(); break;
            case 'editors': renderAnalyticsEditors(); break;
            case 'editor-detail': renderAnalyticsEditorDetail(); break;
            case 'template-detail': renderAnalyticsTemplateDetail(); break;
            case 'team': renderAnalyticsTeam(); break;
            case 'errors': renderAnalyticsErrors(); break;
        }
    }

    function computeTrend(current, previous) {
        var cur = Number(current) || 0;
        var prev = Number(previous) || 0;
        if (prev === 0 && cur === 0) return { pct: 0, direction: 'neutral' };
        if (prev === 0) return { pct: 100, direction: 'up' };
        var pct = ((cur - prev) / prev) * 100;
        var direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral';
        return { pct: Math.abs(pct), direction: direction };
    }

    function buildCategoryChart(categoryStats) {
        if (!categoryStats || categoryStats.length === 0) {
            return '';
        }
        var maxVal = 1;
        categoryStats.forEach(function(c) { maxVal = Math.max(maxVal, Number(c.import_count) || 0); });

        var html = '<div class="category-chart">';
        html += '<div class="css-bar-chart-title">Imports by Category</div>';
        categoryStats.forEach(function(c) {
            var pct = Math.max(((Number(c.import_count) || 0) / maxVal) * 100, 2);
            html += '<div class="category-bar-row">';
            html += '<div class="category-bar-label">' + escapeHTML(c.template_category || 'Unknown') + '</div>';
            html += '<div class="category-bar-track"><div class="category-bar-fill" style="width:' + pct + '%"></div></div>';
            html += '<div class="category-bar-value">' + analyticsFormatNumber(c.import_count) + '</div>';
            html += '</div>';
        });
        html += '</div>';
        return html;
    }

    // ── SVG World Map Data ──
    // Continent outlines generated from real geographic coordinates via equirectangular projection
    // viewBox is 200x100: x = ((lng+180)/360)*200, y = ((90-lat)/180)*100
    var CONTINENT_PATHS = [
        // North America (Alaska through Mexico)
        'M 19.4,18.3 L 20.6,16.7 L 23.3,15.6 L 27.2,14.4 L 30,13.9 L 33.3,14.4 L 36.1,16.1 L 38.3,17.2 L 40,17.8 L 43.3,18.3 L 45.6,19.4 L 47.2,21.1 L 48.3,22.8 L 49.4,24.4 L 50.6,25 L 51.7,26.1 L 52.2,27.2 L 51.1,28.3 L 50,29.4 L 49.4,30.6 L 48.3,31.1 L 47.2,32.2 L 46.1,33.3 L 45,34.4 L 43.9,35.6 L 42.8,36.7 L 42.2,37.8 L 41.7,38.9 L 41.1,40 L 40.6,41.1 L 39.4,41.7 L 38.3,40.6 L 37.2,39.4 L 36.1,38.3 L 35.6,37.2 L 35,36.1 L 33.9,35 L 32.8,33.9 L 31.1,33.3 L 29.4,32.8 L 28.3,31.7 L 26.7,30.6 L 25,29.4 L 23.3,28.3 L 21.7,26.7 L 20,24.4 L 19.4,21.7 Z',
        // Central America
        'M 40.6,41.1 L 41.7,42.2 L 42.8,43.3 L 43.3,44.4 L 43.9,45 L 44.4,45.6 L 43.9,46.7 L 43.3,47.2 L 42.8,47.8 L 42.2,47.2 L 41.7,46.7 L 41.1,45.6 L 40.6,44.4 L 40,43.3 L 39.4,42.2 Z',
        // South America
        'M 44.4,47.8 L 46.1,47.2 L 47.8,46.7 L 50,47.8 L 52.2,48.9 L 53.9,50 L 55,51.7 L 55.6,53.3 L 55,55 L 54.4,56.7 L 53.9,58.3 L 52.8,60 L 51.7,61.7 L 50.6,63.3 L 49.4,65 L 48.3,66.7 L 47.2,68.3 L 46.1,70 L 45,71.7 L 43.9,73.3 L 42.8,75 L 41.7,76.7 L 40.6,77.8 L 39.4,78.3 L 38.3,77.2 L 37.8,75.6 L 37.2,73.9 L 36.7,72.2 L 36.1,70 L 35.6,67.8 L 35.6,65.6 L 35.6,63.3 L 36.1,61.1 L 36.7,58.9 L 37.2,56.7 L 37.8,54.4 L 38.9,52.2 L 40,50.6 L 41.1,49.4 L 42.2,48.3 Z',
        // Europe
        'M 94.4,18.9 L 95.6,17.8 L 97.2,16.7 L 98.9,17.2 L 100,17.8 L 101.1,18.3 L 102.8,18.9 L 103.9,20 L 105.6,20.6 L 107.2,21.1 L 108.3,22.2 L 108.9,23.3 L 109.4,24.4 L 108.9,25.6 L 108.3,26.7 L 107.2,27.8 L 105.6,28.3 L 103.9,28.9 L 102.2,29.4 L 100.6,30 L 98.9,30.6 L 97.2,30 L 95.6,29.4 L 93.9,28.9 L 92.2,28.3 L 91.1,27.2 L 90.6,26.1 L 91.1,25 L 91.7,23.9 L 92.2,22.8 L 92.8,21.7 L 93.3,20.6 Z',
        // Scandinavian Peninsula
        'M 101.7,13.9 L 103.3,12.8 L 105,13.3 L 106.1,14.4 L 106.7,15.6 L 106.1,16.7 L 105,17.8 L 103.3,18.3 L 101.7,17.8 L 100.6,16.7 L 100.6,15.6 Z',
        // Africa
        'M 95,35 L 96.7,33.9 L 98.3,33.3 L 100,33.9 L 101.7,33.3 L 103.3,33.9 L 105,34.4 L 106.7,35.6 L 108.3,37.2 L 110,38.9 L 111.1,40.6 L 111.7,42.8 L 112.2,45 L 112.2,47.2 L 111.7,49.4 L 111.1,51.1 L 110,53.3 L 108.3,55 L 106.7,56.7 L 105,58.3 L 103.3,59.4 L 101.7,60.6 L 100,61.1 L 98.3,61.7 L 96.7,61.1 L 95,60 L 93.3,58.3 L 91.7,56.7 L 90.6,55 L 89.4,52.8 L 88.9,50.6 L 88.3,48.3 L 88.3,45.6 L 88.9,43.3 L 89.4,41.1 L 90.6,38.9 L 91.7,37.2 L 93.3,35.6 Z',
        // Asia (Russia + mainland)
        'M 110,18.3 L 113.3,16.7 L 116.7,15 L 120,13.9 L 123.3,13.3 L 126.7,12.8 L 130,12.2 L 133.3,12.2 L 136.7,12.8 L 140,13.3 L 143.3,13.9 L 146.7,14.4 L 150,15.6 L 153.3,16.7 L 156.7,17.8 L 160,18.9 L 162.8,20 L 165,21.7 L 166.7,23.3 L 167.8,25 L 167.8,26.7 L 166.7,28.3 L 165,30 L 162.8,31.1 L 160.6,32.2 L 158.3,33.3 L 155.6,33.9 L 152.8,34.4 L 150,33.9 L 147.2,33.3 L 144.4,32.8 L 141.7,32.2 L 138.9,31.7 L 136.1,31.1 L 133.3,31.1 L 130.6,31.7 L 127.8,32.2 L 125,32.8 L 122.2,32.8 L 119.4,32.2 L 116.7,31.7 L 113.9,30.6 L 111.7,29.4 L 110,27.8 L 109.4,25.6 L 109.4,23.3 L 109.4,21.1 Z',
        // Middle East
        'M 113.9,30.6 L 116.1,32.2 L 117.8,33.3 L 118.9,35 L 119.4,36.7 L 118.9,38.3 L 117.8,39.4 L 116.1,38.9 L 114.4,37.8 L 113.3,36.7 L 112.2,35 L 112.2,33.3 Z',
        // Indian subcontinent
        'M 122.2,33.3 L 124.4,34.4 L 126.7,35.6 L 128.3,37.2 L 129.4,38.9 L 130,40.6 L 130,42.2 L 129.4,43.9 L 128.3,45 L 126.7,45.6 L 125,45 L 123.3,43.9 L 121.7,42.2 L 120.6,40.6 L 120,38.9 L 120,37.2 L 120.6,35.6 Z',
        // Southeast Asia / Indochina
        'M 140,33.9 L 142.2,35 L 143.9,36.7 L 145,38.3 L 145.6,40 L 146.1,41.7 L 145.6,43.3 L 144.4,44.4 L 142.8,45 L 141.1,44.4 L 139.4,43.3 L 138.3,41.7 L 137.8,40 L 138.3,38.3 L 138.9,36.7 Z',
        // Indonesia / Philippines
        'M 147.2,45 L 150,44.4 L 152.8,45 L 155.6,46.1 L 158.3,47.2 L 160,48.3 L 161.1,50 L 160.6,51.7 L 158.9,52.2 L 156.7,51.7 L 154.4,50.6 L 152.2,49.4 L 150,48.3 L 148.3,47.2 L 147.2,46.1 Z',
        // Japan
        'M 165.6,22.8 L 167.2,21.7 L 168.3,22.8 L 168.9,24.4 L 168.9,26.1 L 168.3,27.8 L 167.2,28.3 L 165.6,27.2 L 165,25.6 L 165,24.4 Z',
        // Australia
        'M 152.2,61.1 L 155.6,60 L 158.9,60 L 162.2,60.6 L 165.6,61.7 L 168.3,63.3 L 170.6,65 L 172.2,66.7 L 173.3,68.9 L 173.3,71.1 L 172.8,73.3 L 171.7,75 L 170,76.1 L 168.3,76.7 L 165.6,76.7 L 162.8,76.1 L 160,75 L 157.8,73.3 L 155.6,71.7 L 153.9,69.4 L 152.8,67.2 L 152.2,65 L 152.2,62.8 Z',
        // Greenland
        'M 57.2,7.2 L 60,5.6 L 62.8,5 L 65.6,5.6 L 67.8,7.2 L 68.3,8.9 L 67.8,10.6 L 66.1,11.7 L 63.9,12.2 L 61.7,11.7 L 59.4,10.6 L 58.3,8.9 Z',
        // UK + Ireland
        'M 96.1,19.4 L 97.2,18.3 L 98.3,18.9 L 98.3,20 L 97.2,20.6 L 96.1,20 Z'
    ];

    function geoToSvg(lat, lng, svgWidth, svgHeight) {
        var x = ((lng + 180) / 360) * svgWidth;
        var y = ((90 - lat) / 180) * svgHeight;
        return { x: x, y: y };
    }

    function buildCommandMap(editorLocations, svgWidth, svgHeight) {
        svgWidth = svgWidth || 200;
        svgHeight = svgHeight || 100;
        var html = '<div class="command-map-container">';
        html += '<svg viewBox="0 0 200 100" class="command-map-svg" preserveAspectRatio="xMidYMid meet">';

        // Grid lines
        var gridLngs = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
        var gridLats = [60, 30, 0, -30, -60];
        gridLngs.forEach(function(lng) {
            var x = ((lng + 180) / 360) * 200;
            html += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="100" class="map-grid-line"/>';
        });
        gridLats.forEach(function(lat) {
            var y = ((90 - lat) / 180) * 100;
            html += '<line x1="0" y1="' + y + '" x2="200" y2="' + y + '" class="map-grid-line"/>';
        });

        // Continents
        html += '<g class="map-continents">';
        CONTINENT_PATHS.forEach(function(d) {
            html += '<path d="' + d + '"/>';
        });
        html += '</g>';

        // Editor dots
        if (editorLocations && editorLocations.length > 0) {
            editorLocations.forEach(function(ed) {
                if (ed.lat == null || ed.lng == null) return;
                var pos = geoToSvg(ed.lat, ed.lng, 200, 100);
                var cls = ed.is_online ? 'map-dot-online' : 'map-dot-offline';
                var dataAttrs = ' data-name="' + escapeHTML(ed.full_name || '') +
                    '" data-city="' + escapeHTML(ed.city || '') +
                    '" data-country="' + escapeHTML(ed.country || '') +
                    '" data-last="' + escapeHTML(ed.last_active || '') + '"';
                if (ed.is_online) {
                    html += '<circle cx="' + pos.x.toFixed(1) + '" cy="' + pos.y.toFixed(1) + '" r="2.5" class="' + cls + '"' + dataAttrs + '>';
                    html += '<animate attributeName="r" values="2;3.5;2" dur="2s" repeatCount="indefinite"/>';
                    html += '<animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite"/>';
                    html += '</circle>';
                } else {
                    html += '<circle cx="' + pos.x.toFixed(1) + '" cy="' + pos.y.toFixed(1) + '" r="2" class="' + cls + '"' + dataAttrs + '/>';
                }
            });
        }

        html += '</svg>';
        html += '<div class="map-tooltip" style="display:none"></div>';

        if (!editorLocations || editorLocations.length === 0) {
            html += '<div class="map-empty-state">Editor locations appear as team members open Blitzkrieg</div>';
        }
        html += '</div>';
        return html;
    }

    function buildEditorsTicker(editorLocations) {
        if (!editorLocations || editorLocations.length === 0) return '';
        var online = editorLocations.filter(function(e) { return e.is_online; });
        if (online.length === 0) return '';

        var html = '<div class="editors-ticker">';
        online.forEach(function(ed) {
            var bgColor = analyticsAvatarColor(ed.full_name || '');
            var initials = analyticsGetInitials(ed.full_name || '?');
            var city = ed.city ? ed.city : '';
            var ago = analyticsFormatTimeAgo(ed.last_active);
            html += '<div class="ticker-editor">';
            html += '<div class="ticker-avatar" style="background:' + bgColor + '">' + initials + '</div>';
            html += '<div class="ticker-info">';
            html += '<span class="ticker-name">' + escapeHTML(ed.full_name || 'Unknown') + '</span>';
            if (city) html += ' <span class="ticker-city">' + escapeHTML(city) + '</span>';
            html += ' <span class="ticker-ago">' + ago + '</span>';
            html += '</div></div>';
        });
        html += '</div>';
        return html;
    }

    var COMPACT_STAT_ICONS = {
        imports: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v9m0 0L4 7.5M8 11l4-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
        editors: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
        avg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-5 3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        sessions: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.5l2.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        templates: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>',
        submissions: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 12V4a1 1 0 011-1h6a1 1 0 011 1v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 7v3m0-3l-1.5 1.5M8 7l1.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    function buildCompactStatCard(value, label, opts) {
        opts = opts || {};
        var cls = 'analytics-stat-card-compact' + (opts.clickable ? ' clickable' : '');
        var attrs = opts.action ? ' data-analytics-action="' + opts.action + '"' : '';
        var iconSvg = opts.icon && COMPACT_STAT_ICONS[opts.icon] ? COMPACT_STAT_ICONS[opts.icon] : '';
        var iconHtml = iconSvg ? '<div class="compact-stat-icon">' + iconSvg + '</div>' : '';
        var trendHtml = '';
        if (opts.trend && opts.trend.pct !== undefined) {
            var dir = opts.trend.direction || 'neutral';
            var arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '';
            var pctStr = Math.abs(opts.trend.pct).toFixed(0) + '%';
            trendHtml = '<span class="compact-trend ' + dir + '">' + arrow + ' ' + pctStr + '</span>';
        }
        return '<div class="' + cls + '"' + attrs + '>' +
            iconHtml +
            '<div class="compact-stat-value">' + escapeHTML(String(value)) + '</div>' +
            trendHtml +
            '<div class="compact-stat-label">' + escapeHTML(label) + '</div>' +
            '</div>';
    }

    function initMapTooltips(container) {
        var tooltip = container.querySelector('.map-tooltip');
        if (!tooltip) return;
        var dots = container.querySelectorAll('.map-dot-online, .map-dot-offline');
        for (var i = 0; i < dots.length; i++) {
            (function(dot) {
                dot.addEventListener('mouseenter', function(e) {
                    var name = dot.getAttribute('data-name') || 'Unknown';
                    var city = dot.getAttribute('data-city') || '';
                    var country = dot.getAttribute('data-country') || '';
                    var lastActive = dot.getAttribute('data-last') || '';
                    var loc = city ? (city + (country ? ', ' + country : '')) : (country || '');
                    var ago = lastActive ? analyticsFormatTimeAgo(lastActive) : '';
                    tooltip.innerHTML = '<strong>' + escapeHTML(name) + '</strong>' +
                        (loc ? '<br>' + escapeHTML(loc) : '') +
                        (ago ? '<br><span style="color:var(--text-muted)">Active ' + ago + '</span>' : '');
                    tooltip.style.display = 'block';
                    // Position near the dot
                    var svgRect = container.querySelector('.command-map-svg').getBoundingClientRect();
                    var dotRect = dot.getBoundingClientRect();
                    tooltip.style.left = (dotRect.left - svgRect.left + dotRect.width / 2) + 'px';
                    tooltip.style.top = (dotRect.top - svgRect.top - 40) + 'px';
                });
                dot.addEventListener('mouseleave', function() {
                    tooltip.style.display = 'none';
                });
            })(dots[i]);
        }
    }

    function renderAnalyticsOverview() {
        var sb = window.blitzkriegSupabase;
        if (!sb) return;
        var contentEl = document.getElementById('analytics-content');
        if (!contentEl) return;

        contentEl.innerHTML = '<div style="text-align:center;padding:40px 0"><div class="analytics-skeleton" style="width:60px;height:60px;margin:0 auto;border-radius:50%"></div></div>';

        var days = ANALYTICS_PERIOD_DAYS[analyticsDateRange] || 30;
        var startDate = analyticsStartDate();
        var endDate = new Date().toISOString();

        // Previous period for trend comparison
        var prevEndDate = startDate;
        var prevStartDate = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000).toISOString();

        var rpcCalls = [
            sb.rpc('get_blitzkrieg_summary', { p_start_date: startDate, p_end_date: endDate }),
            sb.rpc('get_blitzkrieg_daily_stats', { p_start_date: startDate, p_end_date: endDate }),
            sb.rpc('get_blitzkrieg_top_templates', { p_start_date: startDate, p_limit: 10 }),
            sb.rpc('get_blitzkrieg_user_stats', { p_start_date: startDate }),
            sb.rpc('get_blitzkrieg_summary', { p_start_date: prevStartDate, p_end_date: prevEndDate }),
        ];

        // Category stats (new RPC — graceful fallback if not deployed yet)
        var categoryPromise = sb.rpc('get_blitzkrieg_category_stats', { p_start_date: startDate, p_end_date: endDate })
            .then(function(r) { return r; }, function() { return { data: null }; });

        // Editor locations for command map (graceful fallback)
        var locationsPromise = sb.rpc('get_blitzkrieg_editor_locations')
            .then(function(r) { return r; }, function() { return { data: null }; });

        Promise.all(rpcCalls.concat([categoryPromise, locationsPromise])).then(function(results) {
            var summary = (results[0].data && results[0].data[0]) ? results[0].data[0] : {
                total_imports: 0, active_users: 0, avg_imports_per_user: 0, total_sessions: 0, unique_templates: 0, pending_submissions: 0
            };
            var dailyStats = results[1].data || [];
            var topTemplates = results[2].data || [];
            var userStats = results[3].data || [];
            var prevSummary = (results[4].data && results[4].data[0]) ? results[4].data[0] : {
                total_imports: 0, active_users: 0, avg_imports_per_user: 0, total_sessions: 0, unique_templates: 0, pending_submissions: 0
            };
            var categoryStats = results[5].data || [];
            var editorLocations = results[6] ? (results[6].data || []) : [];

            // Cache for editors tab
            analyticsCache.summary = summary;
            analyticsCache.dailyStats = dailyStats;
            analyticsCache.topTemplates = topTemplates;
            analyticsCache.userStats = userStats;

            // Compute trends
            var trends = {
                imports: computeTrend(summary.total_imports, prevSummary.total_imports),
                users: computeTrend(summary.active_users, prevSummary.active_users),
                avg: computeTrend(summary.avg_imports_per_user, prevSummary.avg_imports_per_user),
                sessions: computeTrend(summary.total_sessions, prevSummary.total_sessions),
                templates: computeTrend(summary.unique_templates, prevSummary.unique_templates),
                submissions: computeTrend(summary.pending_submissions, prevSummary.pending_submissions),
            };

            var onlineCount = 0;
            editorLocations.forEach(function(e) { if (e.is_online) onlineCount++; });

            var html = '';

            // ── Command Center Header ──
            html += '<div class="command-center-header">';
            html += '<div class="command-center-title">';
            html += '<span class="command-title-text">Blitzkrieg Command Center</span>';
            if (onlineCount > 0) {
                html += '<span class="live-dot"></span>';
                html += '<span class="live-label">' + onlineCount + ' online</span>';
            }
            html += '</div>';
            html += '<div class="command-center-timestamp">' + new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</div>';
            html += '</div>';

            // ── Live SVG World Map ──
            html += buildCommandMap(editorLocations);

            // ── Active Editors Ticker ──
            html += buildEditorsTicker(editorLocations);

            // ── 6 KPI Cards (compact single row) ──
            html += '<div class="analytics-stat-cards-6col">';
            html += buildCompactStatCard(analyticsFormatNumber(summary.total_imports), 'Imports', { icon: 'imports', trend: trends.imports });
            html += buildCompactStatCard(analyticsFormatNumber(summary.active_users), 'Editors', { icon: 'editors', clickable: true, action: 'goto-editors', trend: trends.users });
            html += buildCompactStatCard(analyticsFormatNumber(summary.avg_imports_per_user), 'Avg/Editor', { icon: 'avg', trend: trends.avg });
            html += buildCompactStatCard(analyticsFormatNumber(summary.total_sessions), 'Sessions', { icon: 'sessions', trend: trends.sessions });
            html += buildCompactStatCard(analyticsFormatNumber(summary.unique_templates), 'Templates', { icon: 'templates', trend: trends.templates });
            html += buildCompactStatCard(analyticsFormatNumber(summary.pending_submissions), 'Submissions', { icon: 'submissions', trend: trends.submissions });
            html += '</div>';

            // ── Two-column: Daily Activity + Editor Leaderboard ──
            html += '<div class="analytics-two-col">';

            // LEFT: Daily Activity + Category Breakdown
            html += '<div class="analytics-col">';
            html += buildCSSBarChart(dailyStats);
            html += buildCategoryChart(categoryStats);
            html += '</div>';

            // RIGHT: Editor Leaderboard + Recent Submissions
            html += '<div class="analytics-col">';
            html += '<div class="analytics-table-section">';
            html += '<h3 class="analytics-table-title">Editor Leaderboard</h3>';
            if (userStats.length > 0) {
                var sorted = userStats.slice().sort(function(a, b) { return (Number(b.import_count) || 0) - (Number(a.import_count) || 0); });
                html += '<div class="leaderboard-list">';
                sorted.forEach(function(user, i) {
                    var bgColor = analyticsAvatarColor(user.full_name || '');
                    var initials = analyticsGetInitials(user.full_name || 'Unknown');
                    var rank = i + 1;
                    var rankCls = rank <= 3 ? 'top-' + rank : '';
                    html += '<div class="leaderboard-row clickable-row" data-analytics-action="goto-editor" data-editor-id="' +
                        escapeHTML(user.user_id) + '" data-editor-name="' + escapeHTML(user.full_name || 'Unknown') + '">';
                    html += '<div class="leaderboard-rank ' + rankCls + '">' + rank + '</div>';
                    html += '<div class="leaderboard-avatar" style="background:' + bgColor + '">' + initials + '</div>';
                    html += '<div class="leaderboard-info">';
                    html += '<div class="leaderboard-name">' + escapeHTML(user.full_name || 'Unknown') + '</div>';
                    html += '<div class="leaderboard-meta">' + analyticsFormatNumber(user.import_count) + ' imports · ' +
                        analyticsFormatNumber(user.session_count) + ' sessions · ' +
                        analyticsFormatNumber(user.active_days) + ' days</div>';
                    html += '</div>';
                    html += '<div class="leaderboard-stat">' + analyticsFormatNumber(user.import_count) + '</div>';
                    html += '</div>';
                });
                html += '</div>';
            } else {
                html += '<p class="placeholder-text">No editor activity.</p>';
            }
            html += '</div>';

            // Recent Submissions feed (loaded async)
            html += '<div class="analytics-table-section">';
            html += '<h3 class="analytics-table-title">Recent Submissions</h3>';
            html += '<div id="overview-recent-submissions"><div style="text-align:center;padding:16px"><div class="analytics-skeleton" style="width:40px;height:40px;margin:0 auto;border-radius:50%"></div></div></div>';
            html += '</div>';

            html += '</div>'; // .analytics-col right

            html += '</div>'; // .analytics-two-col

            contentEl.innerHTML = html;

            // Init map tooltips
            var mapContainer = contentEl.querySelector('.command-map-container');
            if (mapContainer) initMapTooltips(mapContainer);

            // Load recent submissions async
            sb.from('blitzkrieg_template_submissions')
                .select('id, template_name, category, status, created_at, reviewed_at, metadata, user_id')
                .order('created_at', { ascending: false })
                .limit(10)
                .then(function(res) {
                    var el = document.getElementById('overview-recent-submissions');
                    if (!el) return;
                    var subs = res.data || [];
                    if (subs.length === 0) {
                        el.innerHTML = '<p class="placeholder-text">No submissions yet.</p>';
                        return;
                    }
                    var sHtml = '<div class="submissions-feed">';
                    subs.forEach(function(sub) {
                        var statusCls = 'feed-status-' + sub.status;
                        var statusLabel = sub.status.charAt(0).toUpperCase() + sub.status.slice(1);
                        var timeAgo = analyticsFormatTimeAgo(sub.created_at);
                        var submitter = (sub.metadata && sub.metadata.submitterName) ? sub.metadata.submitterName : 'Unknown';
                        sHtml += '<div class="feed-row">';
                        sHtml += '<div class="feed-status-dot ' + statusCls + '"></div>';
                        sHtml += '<div class="feed-content">';
                        sHtml += '<span class="feed-template">' + escapeHTML(sub.template_name || 'Untitled') + '</span>';
                        sHtml += ' <span class="feed-category">' + escapeHTML(sub.category || '') + '</span>';
                        sHtml += '<div class="feed-meta">by ' + escapeHTML(submitter) + ' · ' + timeAgo + ' · <span class="' + statusCls + '">' + statusLabel + '</span></div>';
                        sHtml += '</div>';
                        sHtml += '</div>';
                    });
                    sHtml += '</div>';
                    el.innerHTML = sHtml;
                });
        }).catch(function(err) {
            contentEl.innerHTML = '<p class="placeholder-text">Analytics error: ' + escapeHTML(err.message) + '</p>';
        });
    }

    function renderAnalyticsEditors() {
        var sb = window.blitzkriegSupabase;
        var contentEl = document.getElementById('analytics-content');
        if (!contentEl) return;

        var userStats = analyticsCache.userStats;

        // If cache is empty, load data first
        if (!userStats || userStats.length === 0) {
            if (!sb) return;
            contentEl.innerHTML = '<div style="text-align:center;padding:40px 0"><div class="analytics-skeleton" style="width:60px;height:60px;margin:0 auto;border-radius:50%"></div></div>';

            sb.rpc('get_blitzkrieg_user_stats', { p_start_date: analyticsStartDate() }).then(function(res) {
                analyticsCache.userStats = res.data || [];
                renderAnalyticsEditors();
            });
            return;
        }

        var maxImports = 1;
        userStats.forEach(function(u) { maxImports = Math.max(maxImports, Number(u.import_count) || 0); });

        var html = '<div class="analytics-editor-grid">';
        userStats.forEach(function(user) {
            var bgColor = analyticsAvatarColor(user.full_name || '');
            var initials = analyticsGetInitials(user.full_name || 'Unknown');
            var activityPct = ((Number(user.import_count) || 0) / maxImports) * 100;

            html += '<div class="analytics-editor-card" data-analytics-action="goto-editor" data-editor-id="' +
                escapeHTML(user.user_id) + '" data-editor-name="' + escapeHTML(user.full_name || 'Unknown') + '">';
            html += '<div class="editor-card-header">';
            html += '<div class="editor-avatar" style="background:' + bgColor + '">' + initials + '</div>';
            html += '<div>';
            html += '<div class="editor-card-name">' + escapeHTML(user.full_name || 'Unknown') + '</div>';
            html += '<div class="editor-card-meta">Last active ' + analyticsFormatTimeAgo(user.last_active) + '</div>';
            html += '</div></div>';
            html += '<div class="editor-stats-row">';
            html += '<div class="editor-stat"><span class="editor-stat-value">' + analyticsFormatNumber(user.import_count) + '</span><span class="editor-stat-label">Imports</span></div>';
            html += '<div class="editor-stat"><span class="editor-stat-value">' + analyticsFormatNumber(user.active_days) + '</span><span class="editor-stat-label">Active Days</span></div>';
            html += '<div class="editor-stat"><span class="editor-stat-value">' + analyticsFormatNumber(user.session_count) + '</span><span class="editor-stat-label">Sessions</span></div>';
            html += '<div class="editor-stat"><span class="editor-stat-value">' + analyticsFormatNumber(user.unique_templates) + '</span><span class="editor-stat-label">Templates</span></div>';
            html += '</div>';
            html += '<div class="editor-activity-bar"><div class="editor-activity-fill" style="width:' + activityPct + '%"></div></div>';
            html += '<div class="editor-sparkline" data-editor-id="' + escapeHTML(user.user_id) + '"></div>';
            html += '</div>';
        });
        html += '</div>';

        if (userStats.length === 0) {
            html = '<p class="placeholder-text">No editor activity for this period.</p>';
        }

        contentEl.innerHTML = html;

        // Load sparklines (new RPC — graceful fallback)
        if (userStats.length > 0) {
            var userIds = userStats.map(function(u) { return u.user_id; });
            var sparkStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            sb.rpc('get_blitzkrieg_editor_sparklines', { p_start_date: sparkStart, p_user_ids: userIds })
                .then(function(res) {
                    var data = res.data || [];
                    // Group by user_id
                    var byUser = {};
                    data.forEach(function(row) {
                        if (!byUser[row.user_id]) byUser[row.user_id] = [];
                        byUser[row.user_id].push(row);
                    });
                    // Render sparklines into each card
                    Object.keys(byUser).forEach(function(uid) {
                        var el = contentEl.querySelector('.editor-sparkline[data-editor-id="' + uid + '"]');
                        if (!el) return;
                        var days = byUser[uid];
                        var max = 1;
                        days.forEach(function(d) { max = Math.max(max, Number(d.import_count) || 0); });
                        var sparkHtml = '';
                        days.forEach(function(d) {
                            var h = Math.max(((Number(d.import_count) || 0) / max) * 100, 4);
                            sparkHtml += '<div class="sparkline-bar" style="height:' + h + '%" title="' + d.stat_date + ': ' + d.import_count + '"></div>';
                        });
                        el.innerHTML = sparkHtml;
                    });
                }, function() {
                    // RPC not deployed yet — silently ignore
                });
        }
    }

    function formatHourAmPm(h) {
        if (h === 0) return '12:00 AM';
        if (h < 12) return h + ':00 AM';
        if (h === 12) return '12:00 PM';
        return (h - 12) + ':00 PM';
    }

    function formatDuration(minutes) {
        if (!minutes || minutes <= 0) return '—';
        var m = Math.round(Number(minutes));
        if (m < 60) return m + 'm';
        var hrs = Math.floor(m / 60);
        var rem = m % 60;
        return hrs + 'h ' + (rem > 0 ? rem + 'm' : '');
    }

    function buildActivityCalendar(calendarData) {
        // GitHub-style 90-day activity grid
        var dayMap = {};
        var maxCount = 1;
        (calendarData || []).forEach(function(row) {
            dayMap[row.stat_date] = row;
            maxCount = Math.max(maxCount, Number(row.event_count) || 0);
        });

        var today = new Date();
        today.setHours(0,0,0,0);
        var startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 89); // 90 days including today

        // Start from the nearest Sunday
        var dayOfWeek = startDate.getDay();
        startDate.setDate(startDate.getDate() - dayOfWeek);

        var html = '<div class="activity-calendar">';

        // Day labels
        html += '<div class="cal-day-labels">';
        ['', 'Mon', '', 'Wed', '', 'Fri', ''].forEach(function(d) {
            html += '<div class="cal-day-label">' + d + '</div>';
        });
        html += '</div>';

        // Weeks
        html += '<div class="cal-weeks">';
        var current = new Date(startDate);
        var weekHtml = '';
        var weekCount = 0;
        while (current <= today || current.getDay() !== 0) {
            if (current.getDay() === 0) {
                if (weekHtml) html += '<div class="cal-week">' + weekHtml + '</div>';
                weekHtml = '';
                weekCount++;
            }
            var dateStr = current.toISOString().split('T')[0];
            var dayData = dayMap[dateStr];
            var count = dayData ? Number(dayData.event_count) : 0;
            var level = 0;
            if (count > 0) level = count <= 2 ? 1 : count <= 5 ? 2 : count <= 10 ? 3 : 4;
            var isFuture = current > today;
            var titleParts = [];
            if (dayData) {
                titleParts.push(dateStr);
                titleParts.push(count + ' events');
                if (dayData.import_count > 0) titleParts.push(dayData.import_count + ' imports');
                if (dayData.session_count > 0) titleParts.push(dayData.session_count + ' sessions');
                if (dayData.first_event_hour !== null && dayData.last_event_hour !== null) {
                    titleParts.push(formatHourAmPm(dayData.first_event_hour) + ' — ' + formatHourAmPm(dayData.last_event_hour));
                }
            } else {
                titleParts.push(dateStr + ': no activity');
            }
            weekHtml += '<div class="cal-cell' + (isFuture ? ' future' : '') + ' level-' + level + '" title="' + escapeHTML(titleParts.join('\n')) + '"></div>';
            current.setDate(current.getDate() + 1);
        }
        if (weekHtml) html += '<div class="cal-week">' + weekHtml + '</div>';
        html += '</div>';

        // Legend
        html += '<div class="cal-legend">';
        html += '<span class="cal-legend-text">Less</span>';
        for (var l = 0; l <= 4; l++) html += '<div class="cal-cell level-' + l + '" style="cursor:default"></div>';
        html += '<span class="cal-legend-text">More</span>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function buildSessionsTable(sessions) {
        if (!sessions || sessions.length === 0) return '<p class="placeholder-text">No session data available.</p>';

        var html = '<table class="analytics-table sessions-table">';
        html += '<thead><tr><th>Date</th><th>Started</th><th>Ended</th><th style="text-align:right">Duration</th><th style="text-align:right">Events</th></tr></thead>';
        html += '<tbody>';
        sessions.slice(0, 30).forEach(function(s) {
            var startTime = new Date(s.session_start);
            var dateStr = startTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            var startStr = startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            var endStr = s.session_end ? new Date(s.session_end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'In progress';
            var durStr = formatDuration(s.duration_minutes);
            html += '<tr>';
            html += '<td>' + dateStr + '</td>';
            html += '<td>' + startStr + '</td>';
            html += '<td>' + endStr + '</td>';
            html += '<td style="text-align:right;font-weight:600">' + durStr + '</td>';
            html += '<td style="text-align:right">' + (s.events_during || 0) + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    function buildWorkPatternInsights(patterns) {
        if (!patterns) return '';
        var html = '<div class="work-pattern-insights">';

        var items = [];
        if (patterns.avg_start_hour != null) {
            items.push({ label: 'Typical Start', value: formatHourAmPm(Math.round(patterns.avg_start_hour)) });
        }
        if (patterns.avg_end_hour != null) {
            items.push({ label: 'Typical End', value: formatHourAmPm(Math.round(patterns.avg_end_hour)) });
        }
        if (patterns.avg_session_minutes != null) {
            items.push({ label: 'Avg Session', value: formatDuration(patterns.avg_session_minutes) });
        }
        if (patterns.longest_session_minutes != null) {
            items.push({ label: 'Longest Session', value: formatDuration(patterns.longest_session_minutes) });
        }
        if (patterns.total_session_hours != null) {
            items.push({ label: 'Total Time', value: Number(patterns.total_session_hours).toFixed(1) + 'h' });
        }
        if (patterns.first_seen) {
            items.push({ label: 'First Seen', value: new Date(patterns.first_seen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
        }
        if (patterns.last_seen) {
            items.push({ label: 'Last Active', value: analyticsFormatTimeAgo(patterns.last_seen) });
        }
        if (patterns.active_days != null) {
            items.push({ label: 'Days Active', value: String(patterns.active_days) });
        }

        items.forEach(function(item) {
            html += '<div class="pattern-item"><span class="pattern-label">' + item.label + '</span><span class="pattern-value">' + escapeHTML(item.value) + '</span></div>';
        });

        html += '</div>';
        return html;
    }

    function renderAnalyticsEditorDetail() {
        var sb = window.blitzkriegSupabase;
        if (!sb || !analyticsEditorId) return;
        var contentEl = document.getElementById('analytics-content');
        if (!contentEl) return;

        // Find cached user stats for KPI row
        var editorData = null;
        (analyticsCache.userStats || []).forEach(function(u) {
            if (u.user_id === analyticsEditorId) editorData = u;
        });

        var bgColor = analyticsAvatarColor(analyticsEditorName);
        var initials = analyticsGetInitials(analyticsEditorName);
        var days = ANALYTICS_PERIOD_DAYS[analyticsDateRange] || 30;

        var html = '';
        // Header
        html += '<div class="editor-detail-header">';
        html += '<div class="editor-detail-avatar" style="background:' + bgColor + '">' + initials + '</div>';
        html += '<div>';
        html += '<div class="editor-detail-name">' + escapeHTML(analyticsEditorName) + '</div>';
        html += '<div class="editor-detail-meta" id="editor-detail-meta-line">' + (editorData ? 'Last active ' + analyticsFormatTimeAgo(editorData.last_active) : 'Loading...') + '</div>';
        html += '</div></div>';

        // KPI Row 1 — Usage
        html += '<div class="analytics-stat-cards-row">';
        html += buildStatCard(analyticsFormatNumber(editorData ? editorData.import_count : 0), 'Imports (' + days + 'd)');
        html += buildStatCard(analyticsFormatNumber(editorData ? editorData.active_days : 0), 'Active Days');
        html += buildStatCard(analyticsFormatNumber(editorData ? editorData.session_count : 0), 'Sessions');
        html += buildStatCard(analyticsFormatNumber(editorData ? editorData.unique_templates : 0), 'Unique Templates');
        html += '</div>';

        // KPI Row 2 — Submissions (placeholder, filled async)
        html += '<div class="analytics-stat-cards-row" id="editor-submission-kpis">';
        html += buildStatCard('...', 'Submitted');
        html += buildStatCard('...', 'Approved');
        html += buildStatCard('...', 'Rejected');
        html += buildStatCard('...', 'Approval Rate');
        html += '</div>';

        // Work pattern insights (placeholder, filled async)
        html += '<div class="analytics-table-section">';
        html += '<h3 class="analytics-table-title">Work Patterns</h3>';
        html += '<div id="editor-work-patterns"><div style="text-align:center;padding:16px"><div class="analytics-skeleton" style="width:40px;height:40px;margin:0 auto;border-radius:50%"></div></div></div>';
        html += '</div>';

        // Activity Calendar (90 days, placeholder)
        html += '<div class="analytics-table-section">';
        html += '<h3 class="analytics-table-title">Activity Calendar (90 Days)</h3>';
        html += '<div id="editor-calendar"><div style="text-align:center;padding:16px"><div class="analytics-skeleton" style="width:40px;height:40px;margin:0 auto;border-radius:50%"></div></div></div>';
        html += '</div>';

        // Daily Activity Chart (per-editor imports+sessions bar chart, placeholder)
        html += '<div id="editor-daily-chart"></div>';

        // Peak hours heatmap placeholder
        html += '<div class="analytics-table-section">';
        html += '<h3 class="analytics-table-title">Peak Hours</h3>';
        html += '<div id="editor-heatmap"><div style="text-align:center;padding:16px"><div class="analytics-skeleton" style="width:40px;height:40px;margin:0 auto;border-radius:50%"></div></div></div>';
        html += '</div>';

        // Sessions table placeholder
        html += '<div class="analytics-table-section">';
        html += '<h3 class="analytics-table-title">Recent Sessions</h3>';
        html += '<div id="editor-sessions"><div style="text-align:center;padding:16px"><div class="analytics-skeleton" style="width:40px;height:40px;margin:0 auto;border-radius:50%"></div></div></div>';
        html += '</div>';

        // Top Imported Templates placeholder
        html += '<div class="analytics-table-section">';
        html += '<h3 class="analytics-table-title">Top Imported Templates</h3>';
        html += '<div id="editor-top-templates"><div style="text-align:center;padding:16px"><div class="analytics-skeleton" style="width:40px;height:40px;margin:0 auto;border-radius:50%"></div></div></div>';
        html += '</div>';

        // Timeline placeholder with filter toggle
        html += '<div class="analytics-table-section">';
        html += '<div style="display:flex;align-items:center;gap:8px">';
        html += '<h3 class="analytics-table-title" style="margin:0">Activity Timeline</h3>';
        html += '<button class="timeline-filter-toggle' + (analyticsShowAllEvents ? ' active' : '') + '" data-analytics-action="toggle-view-events">' +
            (analyticsShowAllEvents ? '✓ ' : '') + 'Show All Events</button>';
        html += '</div>';
        html += '<div id="editor-timeline"><div style="text-align:center;padding:16px"><div class="analytics-skeleton" style="width:40px;height:40px;margin:0 auto;border-radius:50%"></div></div></div>';
        html += '</div>';

        contentEl.innerHTML = html;

        var startDate = analyticsStartDate();
        var calendarStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

        // ——— LOAD SUBMISSION STATS ———
        sb.rpc('get_blitzkrieg_editor_submission_stats', {
            p_user_id: analyticsEditorId,
        }).then(function(res) {
            var kpiEl = document.getElementById('editor-submission-kpis');
            if (!kpiEl) return;
            var d = (res.data && res.data[0]) ? res.data[0] : { total_submitted: 0, approved: 0, rejected: 0, pending: 0, recent_7d: 0, approval_rate: 0 };
            var recentBadge = Number(d.recent_7d) > 0 ? ' <span style="color:var(--accent-green-text);font-size:11px">(' + d.recent_7d + ' this week)</span>' : '';
            kpiEl.innerHTML =
                buildStatCard(analyticsFormatNumber(d.total_submitted), 'Submitted') +
                buildStatCard(analyticsFormatNumber(d.approved), 'Approved') +
                buildStatCard(analyticsFormatNumber(d.rejected), 'Rejected') +
                buildStatCard(d.approval_rate + '%', 'Approval Rate');
        }, function() {
            // RPC not deployed — show basic counts from submissions table
            sb.from('blitzkrieg_template_submissions').select('status').eq('user_id', analyticsEditorId).then(function(res) {
                var kpiEl = document.getElementById('editor-submission-kpis');
                if (!kpiEl) return;
                var rows = res.data || [];
                var counts = { total: rows.length, approved: 0, rejected: 0, pending: 0 };
                rows.forEach(function(r) { if (counts.hasOwnProperty(r.status)) counts[r.status]++; });
                var rate = (counts.approved + counts.rejected) > 0 ? Math.round(counts.approved / (counts.approved + counts.rejected) * 100) : 0;
                kpiEl.innerHTML =
                    buildStatCard(analyticsFormatNumber(counts.total), 'Submitted') +
                    buildStatCard(analyticsFormatNumber(counts.approved), 'Approved') +
                    buildStatCard(analyticsFormatNumber(counts.rejected), 'Rejected') +
                    buildStatCard(rate + '%', 'Approval Rate');
            });
        });

        // ——— LOAD WORK PATTERNS ———
        sb.rpc('get_blitzkrieg_editor_work_patterns', {
            p_user_id: analyticsEditorId,
            p_start_date: startDate,
        }).then(function(res) {
            var el = document.getElementById('editor-work-patterns');
            if (!el) return;
            var data = (res.data && res.data[0]) ? res.data[0] : null;
            if (!data || !data.total_sessions) {
                el.innerHTML = '<p class="placeholder-text">Not enough session data yet.</p>';
                return;
            }
            el.innerHTML = buildWorkPatternInsights(data);
            // Update header meta line with richer info
            var metaEl = document.getElementById('editor-detail-meta-line');
            if (metaEl && data.first_seen) {
                metaEl.innerHTML = 'First seen ' + new Date(data.first_seen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
                    ' · Last active ' + analyticsFormatTimeAgo(data.last_seen) +
                    ' · ' + data.active_days + ' days active';
            }
        }, function() {
            var el = document.getElementById('editor-work-patterns');
            if (el) el.innerHTML = '<p class="placeholder-text">Work pattern analysis requires migration.</p>';
        });

        // ——— LOAD ACTIVITY CALENDAR (90 days) ———
        sb.rpc('get_blitzkrieg_editor_daily_calendar', {
            p_user_id: analyticsEditorId,
            p_start_date: calendarStart,
        }).then(function(res) {
            var calEl = document.getElementById('editor-calendar');
            if (!calEl) return;
            var data = res.data || [];
            calEl.innerHTML = buildActivityCalendar(data);

            // Also build per-editor daily bar chart from calendar data
            var chartEl = document.getElementById('editor-daily-chart');
            if (chartEl && data.length > 0) {
                chartEl.innerHTML = buildCSSBarChart(data.map(function(d) {
                    return { stat_date: d.stat_date, import_count: d.import_count, session_count: d.session_count };
                }));
            }
        }, function() {
            var calEl = document.getElementById('editor-calendar');
            if (calEl) calEl.innerHTML = '<p class="placeholder-text">Activity calendar requires migration.</p>';
        });

        // ——— LOAD SESSIONS ———
        sb.rpc('get_blitzkrieg_editor_sessions', {
            p_user_id: analyticsEditorId,
            p_start_date: startDate,
        }).then(function(res) {
            var el = document.getElementById('editor-sessions');
            if (!el) return;
            el.innerHTML = buildSessionsTable(res.data || []);
        }, function() {
            var el = document.getElementById('editor-sessions');
            if (el) el.innerHTML = '<p class="placeholder-text">Session analysis requires migration.</p>';
        });

        // ——— LOAD TOP TEMPLATES ———
        sb.rpc('get_blitzkrieg_editor_top_templates', {
            p_user_id: analyticsEditorId,
            p_start_date: startDate,
            p_limit: 10,
        }).then(function(res) {
            var topEl = document.getElementById('editor-top-templates');
            if (!topEl) return;
            var templates = res.data || [];
            if (templates.length === 0) {
                topEl.innerHTML = '<p class="placeholder-text">No imports for this period.</p>';
                return;
            }
            var tHtml = '<table class="analytics-table">';
            tHtml += '<thead><tr><th>Template</th><th>Category</th><th style="text-align:right">Imports</th><th style="text-align:right">Last Imported</th></tr></thead>';
            tHtml += '<tbody>';
            templates.forEach(function(t) {
                tHtml += '<tr class="clickable-row" data-analytics-action="goto-template" data-template-name="' +
                    escapeHTML(t.template_name || '') + '" data-template-category="' + escapeHTML(t.template_category || '') + '">';
                tHtml += '<td class="template-name-link">' + escapeHTML(t.template_name || 'Unknown') + '</td>';
                tHtml += '<td>' + escapeHTML(t.template_category || '-') + '</td>';
                tHtml += '<td style="text-align:right">' + analyticsFormatNumber(t.import_count) + '</td>';
                tHtml += '<td style="text-align:right;color:var(--text-muted)">' + analyticsFormatTimeAgo(t.last_imported) + '</td>';
                tHtml += '</tr>';
            });
            tHtml += '</tbody></table>';
            topEl.innerHTML = tHtml;
        }).catch(function(err) {
            var topEl = document.getElementById('editor-top-templates');
            if (topEl) topEl.innerHTML = '<p class="placeholder-text">Failed to load templates: ' + escapeHTML(err.message) + '</p>';
        });

        // ——— LOAD TIMELINE ———
        sb.rpc('get_blitzkrieg_user_activity', {
            p_user_id: analyticsEditorId,
            p_start_date: startDate,
            p_limit: 200,
        }).then(function(res) {
            analyticsCache.editorEvents = res.data || [];
            var timelineEl = document.getElementById('editor-timeline');
            if (timelineEl) {
                timelineEl.innerHTML = buildActivityTimeline(analyticsCache.editorEvents, analyticsShowAllEvents);
            }
        }).catch(function(err) {
            var timelineEl = document.getElementById('editor-timeline');
            if (timelineEl) {
                timelineEl.innerHTML = '<p class="placeholder-text">Failed to load activity: ' + escapeHTML(err.message) + '</p>';
            }
        });

        // ——— LOAD PEAK HOURS HEATMAP ———
        sb.rpc('get_blitzkrieg_user_hourly_activity', {
            p_user_id: analyticsEditorId,
            p_start_date: startDate,
        }).then(function(res) {
            var heatmapEl = document.getElementById('editor-heatmap');
            if (!heatmapEl) return;
            var data = res.data || [];
            if (data.length === 0) {
                heatmapEl.innerHTML = '<p class="placeholder-text">No activity data for heatmap.</p>';
                return;
            }
            var maxCount = 1;
            var grid = {};
            data.forEach(function(row) {
                var key = row.day_of_week + '-' + row.hour_of_day;
                grid[key] = Number(row.event_count) || 0;
                maxCount = Math.max(maxCount, grid[key]);
            });
            var dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            var hHtml = '<div class="heatmap-grid">';
            hHtml += '<div class="heatmap-row"><div class="heatmap-day-label"></div>';
            for (var h = 0; h < 24; h++) {
                if (h % 3 === 0) {
                    hHtml += '<div class="heatmap-hour-label">' + (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p') + '</div>';
                } else {
                    hHtml += '<div class="heatmap-hour-label"></div>';
                }
            }
            hHtml += '</div>';
            for (var d = 0; d < 7; d++) {
                hHtml += '<div class="heatmap-row"><div class="heatmap-day-label">' + dayLabels[d] + '</div>';
                for (var h2 = 0; h2 < 24; h2++) {
                    var count = grid[d + '-' + h2] || 0;
                    var opacity = count === 0 ? 0.05 : Math.max(0.15, (count / maxCount));
                    hHtml += '<div class="heatmap-cell" style="opacity:' + opacity.toFixed(2) + '" title="' + dayLabels[d] + ' ' + h2 + ':00 — ' + count + ' events"></div>';
                }
                hHtml += '</div>';
            }
            hHtml += '</div>';
            heatmapEl.innerHTML = hHtml;
        }, function() {
            var heatmapEl = document.getElementById('editor-heatmap');
            if (heatmapEl) heatmapEl.parentElement.style.display = 'none';
        });
    }

    function renderAnalyticsTemplateDetail() {
        var sb = window.blitzkriegSupabase;
        if (!sb || !analyticsTemplateName) return;
        var contentEl = document.getElementById('analytics-content');
        if (!contentEl) return;

        var html = '';
        // Header
        html += '<div class="template-detail-header">';
        html += '<div class="template-detail-icon">⊞</div>';
        html += '<div>';
        html += '<div class="template-detail-name">' + escapeHTML(analyticsTemplateName) + '</div>';
        html += '<div class="template-detail-meta">' + escapeHTML(analyticsTemplateCategory || 'Uncategorized') + '</div>';
        html += '</div></div>';

        // KPI placeholder (2-col)
        html += '<div class="analytics-stat-cards" id="template-kpi-row">';
        html += buildStatCard('...', 'Imports');
        html += buildStatCard('...', 'Editors');
        html += '</div>';

        // Per-editor table placeholder
        html += '<div class="analytics-table-section">';
        html += '<h3 class="analytics-table-title">Per-Editor Usage</h3>';
        html += '<div id="template-users-table"><div style="text-align:center;padding:20px"><div class="analytics-skeleton" style="width:40px;height:40px;margin:0 auto;border-radius:50%"></div></div></div>';
        html += '</div>';

        contentEl.innerHTML = html;

        // Load template detail
        sb.rpc('get_blitzkrieg_template_detail', {
            p_template_name: analyticsTemplateName,
            p_start_date: analyticsStartDate(),
        }).then(function(res) {
            var users = res.data || [];
            var days = ANALYTICS_PERIOD_DAYS[analyticsDateRange] || 30;
            var totalImports = 0;
            users.forEach(function(u) {
                totalImports += Number(u.import_count) || 0;
            });

            // Update KPI (2 cards)
            var kpiEl = document.getElementById('template-kpi-row');
            if (kpiEl) {
                var kpiHtml = '';
                kpiHtml += buildStatCard(analyticsFormatNumber(totalImports), 'Imports (' + days + 'd)');
                kpiHtml += buildStatCard(analyticsFormatNumber(users.length), 'Editors');
                kpiEl.innerHTML = kpiHtml;
            }

            // Per-editor table (imports only)
            var tableEl = document.getElementById('template-users-table');
            if (!tableEl) return;

            if (users.length === 0) {
                tableEl.innerHTML = '<p class="placeholder-text">No editor data for this period.</p>';
                return;
            }

            var tableHtml = '<table class="analytics-table">';
            tableHtml += '<thead><tr><th>Editor</th><th style="text-align:right">Imports</th><th style="text-align:right">Last Used</th></tr></thead>';
            tableHtml += '<tbody>';
            users.forEach(function(u) {
                var bgColor = analyticsAvatarColor(u.full_name || '');
                var initials = analyticsGetInitials(u.full_name || 'Unknown');
                tableHtml += '<tr class="clickable-row" data-analytics-action="goto-editor" data-editor-id="' +
                    escapeHTML(u.user_id) + '" data-editor-name="' + escapeHTML(u.full_name || 'Unknown') + '">';
                tableHtml += '<td><span style="display:inline-flex;align-items:center;gap:8px">' +
                    '<span class="editor-avatar" style="background:' + bgColor + ';width:24px;height:24px;font-size:10px;border-radius:6px">' + initials + '</span>' +
                    '<span class="editor-name-link">' + escapeHTML(u.full_name || 'Unknown') + '</span></span></td>';
                tableHtml += '<td style="text-align:right">' + analyticsFormatNumber(u.import_count) + '</td>';
                tableHtml += '<td style="text-align:right;color:var(--text-muted)">' + analyticsFormatTimeAgo(u.last_used) + '</td>';
                tableHtml += '</tr>';
            });
            tableHtml += '</tbody></table>';
            tableEl.innerHTML = tableHtml;
        }).catch(function(err) {
            var tableEl = document.getElementById('template-users-table');
            if (tableEl) {
                tableEl.innerHTML = '<p class="placeholder-text">Failed to load template details: ' + escapeHTML(err.message) + '</p>';
            }
        });
    }

    /* --------- Analytics: Errors Tab --------- */
    function renderAnalyticsErrors() {
        var container = document.getElementById('analytics-content');
        if (!container) return;
        container.innerHTML = '<div class="analytics-loading">Loading error logs...</div>';

        var sb = window.blitzkriegSupabase;
        if (!sb) { container.innerHTML = '<div class="analytics-empty">Supabase not available</div>'; return; }

        sb.rpc('get_blitzkrieg_error_logs', { p_limit: 100, p_offset: 0 }).then(function(res) {
            if (res.error) { container.innerHTML = '<div class="analytics-empty">Error: ' + escapeHTML(res.error.message) + '</div>'; return; }
            var logs = res.data || [];
            if (logs.length === 0) { container.innerHTML = '<div class="analytics-empty">No error logs recorded yet.</div>'; return; }

            var errorCount = logs.filter(function(l) { return l.error_level === 'error'; }).length;
            var warnCount = logs.filter(function(l) { return l.error_level === 'warn'; }).length;

            var html = '<div class="analytics-summary-row">';
            html += '<div class="analytics-stat-card-compact"><div class="compact-stat-value" style="color:var(--error)">' + errorCount + '</div><div class="compact-stat-label">Errors</div></div>';
            html += '<div class="analytics-stat-card-compact"><div class="compact-stat-value" style="color:var(--warning)">' + warnCount + '</div><div class="compact-stat-label">Warnings</div></div>';
            html += '<div class="analytics-stat-card-compact"><div class="compact-stat-value">' + logs.length + '</div><div class="compact-stat-label">Total Logs</div></div>';
            html += '</div>';

            html += '<table class="analytics-table" style="margin-top:var(--sp-4)">';
            html += '<thead><tr><th>Level</th><th>Message</th><th>User</th><th>Time</th></tr></thead>';
            html += '<tbody>';
            logs.forEach(function(log) {
                var levelClass = log.error_level === 'error' ? 'color:var(--error)' : 'color:var(--warning)';
                var time = new Date(log.created_at);
                var timeStr = time.toLocaleDateString() + ' ' + ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2);
                html += '<tr>';
                html += '<td><span style="' + levelClass + ';font-weight:600;text-transform:uppercase">' + escapeHTML(log.error_level) + '</span></td>';
                html += '<td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHTML(log.message) + '">' + escapeHTML(log.message) + '</td>';
                html += '<td>' + escapeHTML(log.full_name || 'Unknown') + '</td>';
                html += '<td style="white-space:nowrap">' + timeStr + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';

            container.innerHTML = html;
        }).catch(function(err) {
            container.innerHTML = '<div class="analytics-empty">Failed to load error logs: ' + escapeHTML(err.message) + '</div>';
        });
    }

    /* --------- Analytics: Team Tab --------- */
    function renderAnalyticsTeam() {
        var container = document.getElementById('analytics-content');
        if (!container) return;
        container.innerHTML = '<div class="analytics-loading">Loading team members...</div>';

        var sb = window.blitzkriegSupabase;
        if (!sb) { container.innerHTML = '<div class="analytics-empty">Supabase not available</div>'; return; }

        sb.rpc('get_blitzkrieg_team_members').then(function(res) {
            if (res.error) { container.innerHTML = '<div class="analytics-empty">Error: ' + escapeHTML(res.error.message) + '</div>'; return; }
            var members = res.data || [];

            var activeCount = members.filter(function(m) { return m.blitzkrieg_access; }).length;
            var adminCount = members.filter(function(m) { return m.blitzkrieg_admin; }).length;

            var html = '<div class="analytics-summary-row">';
            html += '<div class="analytics-stat-card-compact"><div class="compact-stat-value">' + activeCount + '</div><div class="compact-stat-label">Active Users</div></div>';
            html += '<div class="analytics-stat-card-compact"><div class="compact-stat-value">' + adminCount + '</div><div class="compact-stat-label">Admins</div></div>';
            html += '<div class="analytics-stat-card-compact"><div class="compact-stat-value">' + members.length + '</div><div class="compact-stat-label">Total Members</div></div>';
            html += '</div>';

            html += '<table class="analytics-table" style="margin-top:var(--sp-4)">';
            html += '<thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Admin</th><th>Last Active</th></tr></thead>';
            html += '<tbody>';
            members.forEach(function(m) {
                var lastActive = m.last_active ? new Date(m.last_active).toLocaleDateString() : 'Never';
                html += '<tr>';
                html += '<td>' + escapeHTML(m.full_name || 'Unknown') + '</td>';
                html += '<td>' + escapeHTML(m.slack_email || '') + '</td>';
                html += '<td><label class="blitz-toggle"><input type="checkbox"' + (m.blitzkrieg_access ? ' checked' : '') + ' data-analytics-action="toggle-access" data-member-id="' + m.id + '" data-member-name="' + escapeHTML(m.full_name || '') + '" data-field="blitzkrieg_access"><span class="blitz-toggle-slider"></span></label></td>';
                html += '<td><label class="blitz-toggle"><input type="checkbox"' + (m.blitzkrieg_admin ? ' checked' : '') + ' data-analytics-action="toggle-admin" data-member-id="' + m.id + '" data-member-name="' + escapeHTML(m.full_name || '') + '" data-field="blitzkrieg_admin"><span class="blitz-toggle-slider"></span></label></td>';
                html += '<td>' + lastActive + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';

            container.innerHTML = html;
        }).catch(function(err) {
            container.innerHTML = '<div class="analytics-empty">Failed to load team: ' + escapeHTML(err.message) + '</div>';
        });
    }

    /* --------- Toggle Access Handler --------- */
    function handleToggleAccess(memberId, field, memberName, checkbox) {
        var sb = window.blitzkriegSupabase;
        if (!sb) return;

        var newValue = checkbox.checked;
        var eventType = field === 'blitzkrieg_access'
            ? (newValue ? 'access_granted' : 'access_revoked')
            : (newValue ? 'admin_granted' : 'admin_revoked');

        sb.rpc('set_blitzkrieg_access', {
            p_team_member_id: memberId,
            p_field: field,
            p_value: newValue
        }).then(function(res) {
            if (res.error) {
                // Revert checkbox on failure
                checkbox.checked = !newValue;
                debugLog('Failed to update access: ' + res.error.message, 'error');
                return;
            }
            debugLog((memberName || 'Member') + ' — ' + eventType.replace(/_/g, ' '), 'success');
            if (window.blitzkriegAnalytics) {
                window.blitzkriegAnalytics.trackAccessChange(memberId, eventType, memberName);
            }
        }).catch(function(err) {
            checkbox.checked = !newValue;
            debugLog('Access update error: ' + err.message, 'error');
        });
    }

    /**
     * Event delegation for all analytics dashboard clicks
     */
    function handleAnalyticsClick(e) {
        var actionEl = e.target.closest('[data-analytics-action]');
        if (!actionEl) return;

        var action = actionEl.dataset.analyticsAction;

        switch (action) {
            case 'goto-overview':
                analyticsView = 'overview';
                analyticsEditorId = null;
                analyticsEditorName = '';
                analyticsTemplateName = '';
                renderAnalyticsDashboard();
                break;

            case 'goto-editors':
                analyticsView = 'editors';
                analyticsEditorId = null;
                analyticsEditorName = '';
                renderAnalyticsDashboard();
                break;

            case 'goto-team':
                analyticsView = 'team';
                renderAnalyticsDashboard();
                break;

            case 'goto-errors':
                analyticsView = 'errors';
                renderAnalyticsDashboard();
                break;

            case 'goto-editor':
                analyticsEditorId = actionEl.dataset.editorId;
                analyticsEditorName = actionEl.dataset.editorName || '';
                analyticsView = 'editor-detail';
                renderAnalyticsDashboard();
                break;

            case 'goto-template':
                analyticsTemplateName = actionEl.dataset.templateName || '';
                analyticsTemplateCategory = actionEl.dataset.templateCategory || '';
                analyticsView = 'template-detail';
                renderAnalyticsDashboard();
                break;

            case 'set-period':
                analyticsDateRange = actionEl.dataset.period || '30d';
                analyticsCache = { summary: null, dailyStats: [], topTemplates: [], userStats: [] };
                renderAnalyticsDashboard();
                break;

            case 'toggle-view-events':
                analyticsShowAllEvents = !analyticsShowAllEvents;
                // Re-render timeline in-place if we have cached events
                var toggleBtn = actionEl;
                if (analyticsShowAllEvents) {
                    toggleBtn.classList.add('active');
                    toggleBtn.innerHTML = '✓ Show All Events';
                } else {
                    toggleBtn.classList.remove('active');
                    toggleBtn.innerHTML = 'Show All Events';
                }
                var timelineEl = document.getElementById('editor-timeline');
                if (timelineEl && analyticsCache.editorEvents) {
                    timelineEl.innerHTML = buildActivityTimeline(analyticsCache.editorEvents, analyticsShowAllEvents);
                }
                break;
        }
    }

    /* --------- OTA Live Update System (GitHub raw) --------- */

    // Source of truth: a public GitHub repo. The panel polls
    //   https://raw.githubusercontent.com/<owner>/<repo>/<branch>/version.json
    // on auth-ready and every 30 min. If `version` is newer than this build's
    // BLITZKRIEG_LOCAL_VERSION constant, all listed files are downloaded from
    // the same repo+branch and written to the extension dir, then the panel
    // reloads. Push to main = panels update. No publish step.
    var GH_OWNER = 'dominatemedia1';
    var GH_REPO  = 'Blitzkrieg-by-Dominatemedia';
    var GH_BRANCH = 'main';
    function ghRawUrl(path) {
        // Cache-bust with a per-check timestamp so GitHub's CDN doesn't serve
        // a stale version.json or stale file bytes (raw.githubusercontent.com
        // caches for ~5 min).
        return 'https://raw.githubusercontent.com/' + GH_OWNER + '/' + GH_REPO + '/' + GH_BRANCH + '/' + path
            + '?_=' + Date.now();
    }

    function isNewerVersion(remote, local) {
        var rParts = String(remote).split('.').map(Number);
        var lParts = String(local).split('.').map(Number);
        for (var i = 0; i < 3; i++) {
            var r = rParts[i] || 0;
            var l = lParts[i] || 0;
            if (r > l) return true;
            if (r < l) return false;
        }
        return false;
    }

    var _updateInProgress = false;
    var _lastFailedVersion = null; // skip auto-retry for a version that already failed this session

    function _removeUpdateBanner() {
        var existing = document.getElementById('blitz-update-banner');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function showUpdatingBanner(version) {
        _removeUpdateBanner();
        var app = document.getElementById('app');
        if (!app) return;
        var banner = document.createElement('div');
        banner.id = 'blitz-update-banner';
        banner.className = 'update-banner';

        var infoDiv = document.createElement('div');
        infoDiv.className = 'update-banner-info';
        infoDiv.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;animation:blitz-spin 1s linear infinite"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6 6" fill="none"/></svg>';
        var infoSpan = document.createElement('span');
        infoSpan.appendChild(document.createTextNode('Auto-updating to '));
        var strongVer = document.createElement('strong');
        strongVer.textContent = 'v' + version;
        infoSpan.appendChild(strongVer);
        var statusSpan = document.createElement('span');
        statusSpan.id = 'blitz-update-status';
        statusSpan.textContent = '… preparing.';
        infoSpan.appendChild(statusSpan);
        infoDiv.appendChild(infoSpan);
        banner.appendChild(infoDiv);
        app.insertBefore(banner, app.firstChild);
    }

    function setUpdateBannerStatus(text) {
        var s = document.getElementById('blitz-update-status');
        if (s) s.textContent = '… ' + text;
    }

    function showUpdateErrorBanner(version, errMsg) {
        _removeUpdateBanner();
        var app = document.getElementById('app');
        if (!app) return;
        var banner = document.createElement('div');
        banner.id = 'blitz-update-banner';
        banner.className = 'update-banner update-banner-error';

        var infoDiv = document.createElement('div');
        infoDiv.className = 'update-banner-info';
        var icon = document.createElement('span');
        icon.style.cssText = 'flex-shrink:0;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center';
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 4.5v4M8 10.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        infoDiv.appendChild(icon);
        var msg = document.createElement('span');
        msg.appendChild(document.createTextNode('Update to v' + version + ' failed: ' + errMsg + ' '));
        var retry = document.createElement('button');
        retry.className = 'button-secondary';
        retry.style.cssText = 'margin-left:8px;padding:4px 10px;font-size:12px';
        retry.textContent = 'Retry';
        retry.onclick = function() {
            _lastFailedVersion = null;
            _updateInProgress = false;
            checkForUpdates(true);
        };
        msg.appendChild(retry);
        infoDiv.appendChild(msg);
        banner.appendChild(infoDiv);
        app.insertBefore(banner, app.firstChild);
    }

    function checkForUpdates(force) {
        if (_updateInProgress) return;
        // Don't pound user with retries during stash/generate — they're writing to disk too
        if (typeof stashInProgress !== 'undefined' && stashInProgress) {
            debugLog('Update check deferred: stash/generate in progress', 'info');
            return;
        }

        fetch(ghRawUrl('version.json'), { cache: 'no-store' }).then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).then(function(manifest) {
            var remoteVersion = manifest && manifest.version;
            if (!remoteVersion || !isNewerVersion(remoteVersion, BLITZKRIEG_LOCAL_VERSION)) return;
            if (!force && _lastFailedVersion === remoteVersion) {
                // Avoid hammering the same broken version every 30 min
                return;
            }

            var files = manifest.files || [];
            if (!files.length) {
                debugLog('Update v' + remoteVersion + ' available but no files in manifest', 'warn');
                return;
            }

            debugLog('Auto-updating from GitHub: v' + BLITZKRIEG_LOCAL_VERSION + ' -> v' + remoteVersion + ' (' + files.length + ' files)', 'info');
            if (window.blitzkriegAnalytics) {
                window.blitzkriegAnalytics.trackAccessChange(null, 'update_check', null);
            }

            _updateInProgress = true;
            showUpdatingBanner(remoteVersion);
            installUpdate(remoteVersion, files);
        }).catch(function(err) {
            debugLog('Update check failed: ' + (err && err.message || err), 'warn');
        });
    }

    // Recheck for updates every 30 minutes — covers long-running sessions where
    // the editor leaves AE open all day. First check still fires on auth-ready.
    function startUpdateChecker() {
        checkForUpdates(false);
        setInterval(function() { checkForUpdates(false); }, 30 * 60 * 1000);
    }

    // UTF-8 safe text -> base64. btoa() throws on non-Latin1; this preserves
    // every byte of the JS/JSX/CSS source including em dashes, smart quotes,
    // emoji, etc. Without this, cep.fs.writeFile in default text mode silently
    // mangles non-ASCII bytes and the panel runs corrupted code after reload.
    function utf8ToBase64(str) {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            return null;
        }
    }

    // Fetch with retry + timeout. Returns a Promise<string> of the response body.
    function fetchTextWithRetry(url, attempts, timeoutMs) {
        attempts = attempts || 3;
        timeoutMs = timeoutMs || 30000;
        var attempt = 0;
        return new Promise(function(resolve, reject) {
            function tryOnce() {
                attempt++;
                var didTimeout = false;
                var timer = setTimeout(function() {
                    didTimeout = true;
                    if (attempt < attempts) {
                        setTimeout(tryOnce, 500 * attempt);
                    } else {
                        reject(new Error('timeout after ' + attempts + ' attempts'));
                    }
                }, timeoutMs);
                fetch(url, { cache: 'no-store' }).then(function(res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.text();
                }).then(function(text) {
                    if (didTimeout) return;
                    clearTimeout(timer);
                    resolve(text);
                }).catch(function(err) {
                    if (didTimeout) return;
                    clearTimeout(timer);
                    if (attempt < attempts) {
                        setTimeout(tryOnce, 500 * attempt);
                    } else {
                        reject(err);
                    }
                });
            }
            tryOnce();
        });
    }

    // Write text file via cep.fs in base64 mode. Avoids encoding corruption
    // and gives a clean error code when permission is denied. Resolves with
    // null on success, Error on failure.
    function writeFileViaCepBase64(filePath, content) {
        return new Promise(function(resolve) {
            try {
                if (typeof cep === 'undefined' || !cep.fs || !cep.fs.writeFile || !cep.encoding || typeof cep.encoding.Base64 === 'undefined') {
                    resolve(new Error('cep.fs unavailable'));
                    return;
                }
                var b64 = utf8ToBase64(content);
                if (b64 === null) {
                    resolve(new Error('utf8 base64 encode failed'));
                    return;
                }
                var res = cep.fs.writeFile(filePath, b64, cep.encoding.Base64);
                if (res && res.err === 0) {
                    resolve(null);
                } else {
                    resolve(new Error('cep.fs.writeFile err=' + (res && res.err)));
                }
            } catch (e) {
                resolve(new Error('cep.fs threw: ' + e.message));
            }
        });
    }

    // Move a staged file to its final destination via ExtendScript.
    function moveStagedFile(srcPath, dstPath) {
        return new Promise(function(resolve) {
            var safeSrc = escapeForExtendScript(srcPath);
            var safeDst = escapeForExtendScript(dstPath);
            safeEvalScript('moveUpdateFile("' + safeSrc + '", "' + safeDst + '")', function(r) {
                if (r === 'ok') resolve(null);
                else resolve(new Error('move failed: ' + r));
            });
        });
    }

    function deleteStagingDir(stagingPath) {
        return new Promise(function(resolve) {
            var safe = escapeForExtendScript(stagingPath);
            safeEvalScript('deleteUpdateDir("' + safe + '")', function(r) {
                resolve(r === 'ok' ? null : new Error(String(r)));
            });
        });
    }

    function mkdirP(dirPath) {
        return new Promise(function(resolve) {
            var safe = escapeForExtendScript(dirPath);
            safeEvalScript('mkdirUnderRoot("' + safe + '")', function(r) {
                resolve(r === 'ok' ? null : new Error(String(r)));
            });
        });
    }

    // Build the set of staging subdirs needed for a list of relative file paths.
    function _stagingSubdirs(stagingRoot, separator, fileList) {
        var dirs = {};
        dirs[stagingRoot] = true;
        for (var i = 0; i < fileList.length; i++) {
            var rel = fileList[i].replace(/\//g, separator);
            var parts = rel.split(separator);
            parts.pop(); // drop filename
            var acc = stagingRoot;
            for (var j = 0; j < parts.length; j++) {
                acc = acc + separator + parts[j];
                dirs[acc] = true;
            }
        }
        // Sorted shortest-first so parents are created before children.
        return Object.keys(dirs).sort(function(a, b) { return a.length - b.length; });
    }

    function installUpdate(version, fileList) {
        if (!fileList || fileList.length === 0) {
            debugLog('No files in update manifest', 'warn');
            _updateInProgress = false;
            _removeUpdateBanner();
            return;
        }

        // SECURITY: client-side validation of update file paths.
        var ALLOWED_UPDATE_EXT = /\.(js|css|html|htm|jsx|json|svg|xml)$/i;
        var validFiles = [];
        for (var vfi = 0; vfi < fileList.length; vfi++) {
            var fname = fileList[vfi];
            if (typeof fname !== 'string' || !fname) continue;
            if (fname.indexOf('..') !== -1 || fname.charAt(0) === '/' || fname.charAt(0) === '\\') continue;
            if (/^[a-zA-Z]:[\\\/]/.test(fname)) continue;
            if (!ALLOWED_UPDATE_EXT.test(fname)) continue;
            validFiles.push(fname);
        }
        if (validFiles.length !== fileList.length) {
            debugLog('Update rejected ' + (fileList.length - validFiles.length) + ' file(s) with invalid paths/extensions', 'warn');
        }
        if (validFiles.length === 0) {
            _failUpdate(version, 'no valid files');
            return;
        }
        fileList = validFiles;

        debugLog('Starting update to v' + version + ' (' + fileList.length + ' files)', 'info');
        if (window.blitzkriegAnalytics) {
            window.blitzkriegAnalytics.trackAccessChange(null, 'update_started', null);
        }

        safeEvalScript('getExtensionRootPath()', function(rootPath) {
            if (!rootPath || rootPath === 'EvalScript error.' || rootPath === 'undefined' ||
                rootPath.indexOf('ERROR:') === 0) {
                _failUpdate(version, 'cannot resolve extension root');
                return;
            }

            var separator = rootPath.indexOf('\\') >= 0 ? '\\' : '/';
            var stagingDirName = '.update-staging-' + version + '-' + Date.now();
            var stagingRoot = rootPath + separator + stagingDirName;

            // Phase 0: pre-create all staging subdirs (cep.fs.writeFile won't
            // create parents, and bailing per-file would leave half-staged
            // garbage on disk).
            setUpdateBannerStatus('preparing');
            var dirs = _stagingSubdirs(stagingRoot, separator, fileList);
            var dirIdx = 0;
            function nextDir() {
                if (dirIdx >= dirs.length) {
                    stageOne(0);
                    return;
                }
                mkdirP(dirs[dirIdx++]).then(function(err) {
                    if (err) {
                        deleteStagingDir(stagingRoot).then(function() {
                            _failUpdate(version, 'mkdir failed: ' + err.message);
                        });
                        return;
                    }
                    nextDir();
                });
            }

            // Phase 1: download + write each file to staging path
            var downloaded = 0;
            var stagedPaths = []; // {staging, final}

            function stageOne(idx) {
                if (idx === 0) setUpdateBannerStatus('downloading 0/' + fileList.length);
                if (idx >= fileList.length) {
                    // Phase 2: atomic move into place
                    setUpdateBannerStatus('installing');
                    moveAll(0);
                    return;
                }
                var fileName = fileList[idx];
                var stagingPath = stagingRoot + separator + fileName.replace(/\//g, separator);
                var finalPath = rootPath + separator + fileName.replace(/\//g, separator);
                fetchTextWithRetry(ghRawUrl(fileName), 3, 30000).then(function(text) {
                    return writeFileViaCepBase64(stagingPath, text);
                }).then(function(err) {
                    if (err) {
                        // Bail entire update — atomic semantics
                        deleteStagingDir(stagingRoot).then(function() {
                            _failUpdate(version, 'write failed for ' + fileName + ': ' + err.message);
                        });
                        return;
                    }
                    downloaded++;
                    stagedPaths.push({ staging: stagingPath, final: finalPath, name: fileName });
                    setUpdateBannerStatus('downloading ' + downloaded + '/' + fileList.length);
                    debugLog('Staged: ' + fileName + ' (' + downloaded + '/' + fileList.length + ')', 'info');
                    stageOne(idx + 1);
                }).catch(function(err) {
                    deleteStagingDir(stagingRoot).then(function() {
                        _failUpdate(version, 'download failed for ' + fileName + ': ' + (err && err.message || err));
                    });
                });
            }

            function moveAll(idx) {
                if (idx >= stagedPaths.length) {
                    // Cleanup: remove now-empty staging dir
                    deleteStagingDir(stagingRoot).then(function() {
                        debugLog('Update to v' + version + ' complete! Reloading panel.', 'success');
                        if (window.blitzkriegAnalytics) {
                            window.blitzkriegAnalytics.trackAccessChange(null, 'update_completed', null);
                        }
                        setUpdateBannerStatus('reloading');
                        // CEP shares one ExtendScript context per extension — it survives
                        // panel reloads, so the just-written hostscript.jsx still points
                        // at the OLD function definitions until we $.evalFile() it.
                        // Without this re-eval, the next OTA cycle would call
                        // mkdirUnderRoot/moveUpdateFile and get ReferenceError.
                        var jsxPath = rootPath + separator + 'jsx' + separator + 'hostscript.jsx';
                        var safeJsx = escapeForExtendScript(jsxPath);
                        safeEvalScript('$.evalFile(File("' + safeJsx + '").fsName)', function() {
                            // Cache-bust reload — change URL so CEF treats this as a fresh
                            // page load rather than potentially serving cached resources.
                            // The version-stamped script srcs in index.html (auto-bumped by
                            // CI) handle the inner-resource cache busting.
                            setTimeout(function() {
                                try {
                                    var base = window.location.pathname || 'index.html';
                                    window.location.replace(base + '?_v=' + version + '&_t=' + Date.now());
                                } catch (e) {
                                    window.location.reload();
                                }
                            }, 300);
                        });
                    });
                    return;
                }
                var entry = stagedPaths[idx];
                moveStagedFile(entry.staging, entry.final).then(function(err) {
                    if (err) {
                        // Move failed mid-way. Best effort: continue moving the rest
                        // but flag overall failure. The next OTA check will retry.
                        debugLog('Move failed: ' + entry.name + ' — ' + err.message, 'error');
                        deleteStagingDir(stagingRoot).then(function() {
                            _failUpdate(version, 'move failed for ' + entry.name + ': ' + err.message);
                        });
                        return;
                    }
                    debugLog('Installed: ' + entry.name, 'info');
                    moveAll(idx + 1);
                });
            }

            nextDir();
        });
    }

    function _failUpdate(version, errMsg) {
        debugLog('Update v' + version + ' failed: ' + errMsg, 'error');
        if (window.blitzkriegAnalytics) {
            window.blitzkriegAnalytics.trackAccessChange(null, 'update_failed', null);
        }
        _lastFailedVersion = version;
        _updateInProgress = false;
        showUpdateErrorBanner(version, errMsg);
    }

    // Expose for banner button + manual retry from console
    window.__blitzInstallUpdate = installUpdate;
    window.__blitzCheckForUpdates = function() {
        _lastFailedVersion = null;
        _updateInProgress = false;
        checkForUpdates(true);
    };

    /* --------- Cloud Thumbnail + Preview Generation --------- */

    // Disk I/O: tested at runtime — cep.fs if it works, else evalScript (guaranteed)
    var _diskIo = null;
    var _cachedTempDir = null;

    /** Get temp dir from ExtendScript (cached). Uses /tmp on macOS to avoid
     *  TemporaryItems permission issues with AE's rendering engine. */
    function getTempDir() {
        return new Promise(function(resolve, reject) {
            if (_cachedTempDir) { resolve(_cachedTempDir); return; }
            safeEvalScript('getSafeTempFolder().fsName', function(r) {
                // Reject the literal "undefined" string (ExtendScript stringifies undefined
                // to the literal word when evaluating non-existent symbols). Also reject
                // EvalScript bridge failures and empty responses.
                if (!r || r === 'EvalScript error.' || r === 'undefined' || r === 'null') {
                    reject(new Error('Cannot get temp dir (got: ' + (r || 'empty') + ')'));
                    return;
                }
                _cachedTempDir = r;
                resolve(r);
            });
        });
    }

    /** Initialize disk I/O — ACTUALLY TESTS each method before committing. */
    function initDiskIo() {
        if (_diskIo) return;

        // Test cep.fs with a real write + read
        try {
            if (typeof cep !== 'undefined' && cep.fs && cep.fs.writeFile && cep.encoding && typeof cep.encoding.Base64 !== 'undefined') {
                // Use platform-aware temp path — '/tmp/' doesn't exist on Windows
                var sysTempDir = csInterface.getSystemPath(SystemPath.USER_DATA) || '/tmp';
                var testPath = sysTempDir + '/blitz_io_test_' + Date.now() + '.bin';
                var testB64 = 'dGVzdA=='; // base64("test")
                var wr = cep.fs.writeFile(testPath, testB64, cep.encoding.Base64);
                if (wr && wr.err === 0) {
                    var rd = cep.fs.readFile(testPath, cep.encoding.Base64);
                    try { cep.fs.deleteFile(testPath); } catch (e2) {}
                    if (rd && rd.err === 0 && rd.data) {
                        _diskIo = { type: 'cep' };
                        debugLog('Disk I/O: cep.fs VERIFIED working', 'success');
                        return;
                    }
                }
                debugLog('Disk I/O: cep.fs exists but write/read failed (wr=' + (wr && wr.err) + ')', 'warn');
            }
        } catch (e) {
            debugLog('Disk I/O: cep.fs test threw: ' + e.message, 'warn');
        }

        // Skip Node.js (unreliable in CEP) — go straight to evalScript
        _diskIo = { type: 'evalscript' };
        debugLog('Disk I/O: using evalScript chunked fallback', 'info');
    }

    /** Write a Blob to disk. Uses tested method: cep.fs or chunked evalScript. */
    function writeBlobToFile(blob, filePath) {
        initDiskIo();
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function() { reject(new Error('FileReader error')); };
            reader.onload = function() {
                var b64 = reader.result.split(',')[1];
                if (!b64 || b64.length === 0) { reject(new Error('Empty base64 from blob')); return; }

                if (_diskIo.type === 'cep') {
                    try {
                        var res = cep.fs.writeFile(filePath, b64, cep.encoding.Base64);
                        if (res && res.err === 0) { resolve(filePath); }
                        else { reject(new Error('cep.fs write err ' + (res ? res.err : 'null result'))); }
                    } catch (e) { reject(new Error('cep.fs throw: ' + e.message)); }
                } else {
                    // Chunked evalScript: write base64 in 500KB pieces, then decode to binary
                    var CHUNK = 500000;
                    var safeTmpB64 = escapeForExtendScript(filePath + '.b64');
                    var safeOut = escapeForExtendScript(filePath);
                    var idx = 0;
                    var totalChunks = Math.ceil(b64.length / CHUNK);
                    debugLog('writeBlobToFile: ' + b64.length + ' bytes b64, ' + totalChunks + ' chunks → ' + filePath);
                    function writeChunk() {
                        if (idx >= b64.length) {
                            // All chunks written — decode to binary
                            safeEvalScript('decodeBase64FileToBinary("' + safeTmpB64 + '", "' + safeOut + '")', function(r) {
                                if (!r || r.indexOf('ERROR') === 0) {
                                    debugLog('decodeBase64FileToBinary failed: ' + r, 'error');
                                    reject(new Error(r || 'Decode failed'));
                                } else {
                                    debugLog('writeBlobToFile: decode OK → ' + r);
                                    resolve(r);
                                }
                            });
                            return;
                        }
                        var chunk = b64.substring(idx, idx + CHUNK);
                        // Validate chunk contains only valid base64 characters
                        if (!/^[A-Za-z0-9+/=]*$/.test(chunk)) {
                            reject(new Error('Invalid base64 data detected'));
                            return;
                        }
                        var isFirst = idx === 0 ? 'true' : 'false';
                        safeEvalScript('appendToTextFile("' + safeTmpB64 + '", "' + chunk + '", ' + isFirst + ')', function(r) {
                            if (r !== 'ok') {
                                debugLog('appendToTextFile chunk failed: ' + r, 'error');
                                reject(new Error('Chunk write failed: ' + r));
                                return;
                            }
                            idx += CHUNK;
                            writeChunk();
                        });
                    }
                    writeChunk();
                }
            };
            reader.readAsDataURL(blob);
        });
    }

    /** Read a file from disk as a Blob (async, works with all I/O methods). */
    function readFileAsBlobAsync(filePath, contentType) {
        initDiskIo();
        if (_diskIo.type === 'cep') {
            try {
                var res = cep.fs.readFile(filePath, cep.encoding.Base64);
                if (res && res.err === 0 && res.data) {
                    return Promise.resolve(base64ToBlob(res.data, contentType || 'application/octet-stream'));
                }
            } catch (e) { /* fall through to evalScript */ }
        }
        // evalScript path: read file as base64 in ExtendScript
        return new Promise(function(resolve, reject) {
            var safePath = escapeForExtendScript(filePath);
            safeEvalScript('readFileAsBase64(new File("' + safePath + '"))', function(b64) {
                if (!b64 || b64 === 'EvalScript error.' || b64 === 'undefined' || b64.length < 4) {
                    reject(new Error('Failed to read: ' + filePath));
                } else {
                    resolve(base64ToBlob(b64, contentType || 'application/octet-stream'));
                }
            });
        });
    }

    /** Check file existence via evalScript (always works). */
    function fileExistsAsync(filePath) {
        return new Promise(function(resolve) {
            safeEvalScript('(new File("' + escapeForExtendScript(filePath) + '")).exists', function(r) {
                resolve(r === 'true');
            });
        });
    }

    /**
     * Sequential generation queue — ExtendScript is single-threaded so concurrent
     * generatePreviewsToDisk calls interfere with each other. This serializes all
     * generation work with a delay between items to let AE recover RAM.
     *
     * Memory bookkeeping: we track how many items are still in flight. When the
     * count drops to zero we reset `_genQueue` to a fresh resolved promise so the
     * chain doesn't accumulate N wrapped results in closures across long sessions
     * (e.g. an admin running "Generate All" 10 times in a row used to leave 2480
     * nested .then() chains in memory).
     */
    var _genQueue = Promise.resolve();
    var _genQueuePending = 0;
    var GEN_DELAY_MS = 800; // breathing room between generations to prevent AE crashes
    function _enqueueGeneration(fn) {
        _genQueuePending++;
        // Wrap fn result so the queue always resolves (never stays rejected).
        // This prevents one failure from killing all subsequent generations.
        //
        // CRITICAL: wrap fn() inside a Promise.resolve().then chain so that a
        // SYNCHRONOUS throw from fn (before it returns a promise) is converted
        // to a rejection instead of escaping the queue. Without this, a sync
        // throw would escape _genQueue.then → the chain becomes permanently
        // rejected → _genQueuePending never decrements → every subsequent
        // generation short-circuits to the catch path.
        var thisRun = _genQueue.then(function() {
            return Promise.resolve().then(fn).then(function(result) {
                return { ok: true, value: result };
            }, function(err) {
                return { ok: false, error: err };
            });
        }).then(function(wrapped) {
            return new Promise(function(resolve) {
                setTimeout(function() { resolve(wrapped); }, GEN_DELAY_MS);
            });
        });
        _genQueue = thisRun;
        // Return a promise that rejects if this specific generation failed,
        // so the caller can distinguish success from failure.
        return thisRun.then(function(wrapped) {
            _genQueuePending--;
            if (_genQueuePending <= 0) {
                _genQueuePending = 0;
                _genQueue = Promise.resolve(); // drop chain, let GC reclaim
            }
            if (wrapped.ok) return wrapped.value;
            throw wrapped.error;
        });
    }

    /**
     * Generate thumbnail + preview frames for a single cloud template.
     * Downloads .aep, writes to disk, renders via ExtendScript,
     * reads rendered files, uploads to Supabase.
     * Queued sequentially to avoid concurrent ExtendScript calls.
     */
    function generateCloudThumbnail(comp) {
        if (!comp || !comp.storagePath) return Promise.reject(new Error('No storage path'));
        if (!_hasCepBridge) {
            return Promise.reject(new Error('Requires After Effects'));
        }

        var sb = window.blitzkriegSupabase;
        if (!sb) return Promise.reject(new Error('No Supabase client'));

        var _genStart = Date.now();
        var _genName = comp.name || '';
        function _reportGen(ok, err) {
            if (window.blitzkriegAnalytics && window.blitzkriegAnalytics.trackGenerate) {
                try {
                    window.blitzkriegAnalytics.trackGenerate(
                        _genName,
                        ok === true,
                        Date.now() - _genStart,
                        ok ? null : (err && err.message ? err.message : String(err || 'unknown'))
                    );
                } catch (e) {}
            }
        }

        // Enqueue to prevent concurrent ExtendScript calls
        return _enqueueGeneration(function() {
        var tempDir, outputDir;
        debugLog('GEN START: ' + comp.name + ' (' + comp.storagePath + ')');

        return getTempDir().then(function(sysTempDir) {
            // Date.now() alone can collide when two generations fire within the
            // same millisecond (rare but reachable on fast machines after batch delays).
            // Append a high-entropy random suffix so each tempDir is unique.
            var unique = Date.now() + '_' + Math.floor(Math.random() * 0x7fffffff).toString(36);
            tempDir = sysTempDir + '/blitzkrieg_gen_' + unique;
            outputDir = tempDir + '/output';

            return new Promise(function(resolve, reject) {
                safeEvalScript(
                    '(function(){ var a = new Folder("' + escapeForExtendScript(tempDir) + '"); a.create(); ' +
                    'var b = new Folder("' + escapeForExtendScript(outputDir) + '"); b.create(); ' +
                    'return b.exists ? "ok" : "fail"; })()',
                    function(r) {
                        if (r === 'ok') { debugLog('GEN: temp dirs created'); resolve(); }
                        else { reject(new Error('Failed to create temp dirs: ' + r)); }
                    }
                );
            });
        }).then(function() {
            debugLog('GEN: downloading AEP...');
            return window.cloudLibrary.downloadTemplate(comp.storagePath);
        }).then(function(downloaded) {
            debugLog('GEN: AEP downloaded (' + (downloaded.blob.size / 1024).toFixed(0) + 'KB), writing to disk...');
            var aepPath = tempDir + '/' + downloaded.fileName;
            return writeBlobToFile(downloaded.blob, aepPath).then(function() {
                debugLog('GEN: AEP written, calling generatePreviewsToDisk...');
                return new Promise(function(resolve, reject) {
                    safeEvalScript(
                        'generatePreviewsToDisk("' + escapeForExtendScript(aepPath) + '", "' + escapeForExtendScript(outputDir) + '")',
                        function(result) {
                            debugLog('GEN: ExtendScript result: ' + (result || '').substring(0, 300));
                            // Detect the literal ExtendScript-bridge failure string BEFORE JSON.parse.
                            // safeEvalScript returns "EvalScript error." (and sometimes "undefined" /
                            // empty string) when the JSX host throws outside the function's try block.
                            if (!result || result === 'EvalScript error.' || result === 'undefined') {
                                reject(new Error('ExtendScript bridge failure: ' + (result || 'empty response') + ' — reload the AE panel and try again.'));
                                return;
                            }
                            try {
                                var parsed = JSON.parse(result);
                                if (parsed.error) {
                                    var errMsg = parsed.error;
                                    if (parsed.step) errMsg += ' [step: ' + parsed.step + ']';
                                    if (parsed.aepSize !== undefined) errMsg += ' (size: ' + parsed.aepSize + 'B)';
                                    reject(new Error(errMsg));
                                    return;
                                }
                                if (parsed.skipped) {
                                    var skipDetail = parsed.skipReason || 'unrenderable';
                                    if (parsed.skipReason === 'memory_limit') {
                                        // Friendly toast for editors — surfaces Muhammad's
                                        // fix so they don't spend time debugging.
                                        showToast('Memory limit hit on "' + comp.name + '" — lower Motion Tile output values and re-stash.', true);
                                        debugLog('GEN: skipped (memory_limit) — ' + (parsed.hint || parsed.memoryError || 'AE memory cap exceeded'), 'error');
                                    } else {
                                        if (parsed.missingFootage && parsed.missingFootage.length) {
                                            skipDetail += ' — missing: ' + parsed.missingFootage.join(', ');
                                        }
                                        debugLog('GEN: skipped — ' + skipDetail, 'warn');
                                    }
                                    resolve(parsed);
                                } else if (parsed.thumbnailOnly) {
                                    var tOnlyDetail = 'thumbnail only (missing footage, skipped preview frames)';
                                    if (parsed.missingFootage && parsed.missingFootage.length) {
                                        tOnlyDetail += ' — missing: ' + parsed.missingFootage.join(', ');
                                    }
                                    debugLog('GEN: ' + tOnlyDetail, 'warn');
                                } else if (parsed.memoryError) {
                                    // Frame-loop bailed mid-way because AE ran out of memory.
                                    // The thumbnail already rendered so we keep the partial result.
                                    showToast('Memory limit hit on "' + comp.name + '" — thumbnail saved but preview frames incomplete. Lower Motion Tile output values.', true);
                                    debugLog('GEN: memory limit reached after ' + parsed.frameCount + '/' + parsed.plannedFrameCount + ' frames — ' + (parsed.hint || parsed.memoryError), 'error');
                                } else if (parsed.incompleteFrames) {
                                    debugLog('GEN: ' + parsed.frameCount + '/' + parsed.plannedFrameCount + ' frames (rendering bailed early after consecutive failures)', 'warn');
                                } else if (parsed.tooShort) {
                                    debugLog('GEN: comp too short for preview animation (frameCount=' + parsed.frameCount + ')', 'warn');
                                } else {
                                    debugLog('GEN: rendered ' + parsed.frameCount + ' frames');
                                }
                                resolve(parsed);
                            } catch (e) {
                                reject(new Error('ExtendScript error: ' + (result || 'empty')));
                            }
                        }
                    );
                });
            });
        }).then(function(renderResult) {
            // If generation was skipped (e.g. missing footage), clean up and return early
            if (renderResult.skipped) {
                debugLog('GEN: skipped upload (no rendered files)');
                _cleanupTempDir(tempDir);
                return Promise.resolve({ skipped: true, reason: renderResult.skipReason });
            }
            debugLog('GEN: reading rendered files and uploading...');
            var thumbPath = outputDir + '/comp.png';
            return readFileAsBlobAsync(thumbPath, 'image/png').then(function(thumbBlob) {
                var uploads = [
                    sb.storage.from('blitzkrieg').upload(
                        comp.storagePath + '/comp.png', thumbBlob,
                        { contentType: 'image/png', upsert: true }
                    )
                ];
                var skippedFrames = 0;
                // Renumber frames during upload so the cloud copy is contiguous
                // (frame_0, frame_1, ..., frame_N) even if some local frames are
                // missing. The hover preview animation expects contiguous indices —
                // a gap (e.g. frame_2 missing) would break loop playback.
                var uploadFrameIdx = 0;

                var frameCount = renderResult.frameCount || 0;
                var frameChain = Promise.resolve();
                for (var i = 0; i < frameCount; i++) {
                    (function(srcIdx) {
                        frameChain = frameChain.then(function() {
                            var framePath = outputDir + '/preview/frame_' + srcIdx + '.png';
                            return readFileAsBlobAsync(framePath, 'image/png').then(function(frameBlob) {
                                var destIdx = uploadFrameIdx++;
                                uploads.push(
                                    sb.storage.from('blitzkrieg').upload(
                                        comp.storagePath + '/preview/frame_' + destIdx + '.png', frameBlob,
                                        { contentType: 'image/png', upsert: true }
                                    )
                                );
                            }).catch(function(readErr) {
                                // Only swallow file-missing errors (the frame file wasn't
                                // produced by ExtendScript). Log everything else so silent
                                // disk-IO failures aren't masked as success.
                                var msg = readErr && readErr.message ? readErr.message : String(readErr);
                                if (msg.indexOf('Failed to read') === -1) {
                                    debugLog('GEN: frame ' + srcIdx + ' read error (' + msg + ')', 'warn');
                                }
                                skippedFrames++;
                            });
                        });
                    })(i);
                }

                return frameChain.then(function() {
                    return Promise.all(uploads);
                }).then(function(results) {
                    // Distinguish thumbnail upload (index 0) from frame uploads.
                    var thumbResult = results[0];
                    var thumbFailed = !!(thumbResult && thumbResult.error);
                    var frameErrs = [];
                    for (var ri = 1; ri < results.length; ri++) {
                        if (results[ri] && results[ri].error) frameErrs.push(results[ri].error.message || 'unknown');
                    }
                    if (thumbFailed) {
                        // Thumbnail upload failure is fatal — without it the template
                        // shows a placeholder forever. Throw so the caller can mark
                        // this generation as failed instead of incrementing succeeded.
                        throw new Error('Thumbnail upload failed: ' + (thumbResult.error.message || 'unknown'));
                    }
                    if (frameErrs.length > 0) {
                        debugLog('GEN: ' + frameErrs.length + '/' + (results.length - 1) + ' frame uploads failed: ' + frameErrs.slice(0, 3).join(', '), 'warn');
                    }
                    if (skippedFrames > 0) {
                        debugLog('GEN: ' + skippedFrames + ' frame(s) missing on disk before upload', 'warn');
                    }
                    var actualFramesUploaded = (results.length - 1) - frameErrs.length;
                    debugLog('GEN: uploaded thumbnail + ' + actualFramesUploaded + '/' + frameCount + ' frames for ' + comp.name, 'success');

                    if (comp.storagePath && thumbBlacklist[comp.storagePath]) {
                        delete thumbBlacklist[comp.storagePath];
                        try { localStorage.setItem('blitzkrieg_thumb_blacklist', JSON.stringify(thumbBlacklist)); } catch(e) {}
                    }

                    return updateMetadataAfterGeneration(comp.storagePath, actualFramesUploaded).then(function() { return true; }).catch(function() { return true; });
                });
            });
        }).then(function(result) {
            // Success: clean up temp dir and purge AE caches
            _cleanupTempDir(tempDir);
            _reportGen(true);
            return result;
        }, function(err) {
            // Failure: log, clean up, re-throw so caller can count it
            debugLog('GEN FAIL [' + comp.name + ']: ' + err.message, 'error');
            _cleanupTempDir(tempDir);
            _reportGen(false, err);
            throw err;
        });
        }); // end _enqueueGeneration
    }

    /** Clean up temp directory and purge AE caches (used after generation) */
    function _cleanupTempDir(tempDir) {
        if (!tempDir) return;
        try {
            safeEvalScript(
                '(function(){' +
                ' var f = new Folder("' + escapeForExtendScript(tempDir) + '");' +
                ' if(f.exists){ var rm = function(d){ var fs=d.getFiles(); for(var i=0;i<fs.length;i++){ if(fs[i] instanceof Folder) rm(fs[i]); else fs[i].remove(); } d.remove(); }; rm(f); }' +
                ' try { app.purge(PurgeTarget.ALL_CACHES); } catch(e) {}' +
                ' return "ok";' +
                '})()'
            );
        } catch(e) {}
    }

    /**
     * Update a template's metadata.json after successful generation.
     * Sets cloudThumbnailGenerated flag + preview frame count.
     */
    function updateMetadataAfterGeneration(storagePath, frameCount) {
        var sb = window.blitzkriegSupabase;
        if (!sb) return Promise.resolve();

        var metaPath = storagePath + '/metadata.json';
        return sb.storage.from('blitzkrieg').download(metaPath).then(function(res) {
            if (res.error) return;
            return res.data.text().then(function(text) {
                try {
                    var metadata = JSON.parse(text);
                    metadata.cloudThumbnailGenerated = true;
                    if (frameCount > 0) {
                        metadata.previewFrames = frameCount;
                        metadata.cloudPreviewFrameCount = frameCount;
                    }
                    var metaBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
                    return sb.storage.from('blitzkrieg').upload(metaPath, metaBlob, {
                        contentType: 'application/json',
                        upsert: true,
                    });
                } catch (e) {
                    debugLog('Failed to parse metadata for ' + storagePath + ': ' + e.message, 'warn');
                }
            });
        }).catch(function(err) {
            debugLog('Failed to update metadata after generation: ' + err.message, 'warn');
        });
    }

    /**
     * Admin batch: generate thumbnails + preview frames for all templates missing them.
     * Processes sequentially to avoid overwhelming AE.
     * @param {boolean} forceAll - If true, regenerate even for templates that have thumbnails
     */
    function generateAllMissingThumbnails(forceAll) {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('Admin access required.', true);
            return;
        }
        if (!_hasCepBridge) {
            showToast('Requires After Effects.', true);
            return;
        }
        // Re-entrance guard — a double-click on the "Generate Missing" button would
        // otherwise spawn two concurrent processing loops, both calling generateCloudThumbnail
        // against overlapping comps and flipping the progress bar between them chaotically.
        if (generateAllMissingThumbnails._running) {
            showToast('Generation already in progress.');
            return;
        }
        generateAllMissingThumbnails._running = true;

        // Wrap the entire setup in a try/catch so a synchronous failure (e.g.
        // localStorage.setItem throwing QuotaExceededError in private mode at the
        // blacklist clear below) can't leave `_running = true` permanently and
        // brick the button until panel reload.
        var compsToProcess;
        try {
            if (forceAll) {
                // Force regenerate all cloud templates
                compsToProcess = allComps.filter(function(c) { return !!c.storagePath; });
            } else {
                // Templates missing thumbnails, blacklisted, or missing preview frames.
                // NOTE: thumbUrl is NOT a reliable signal — Supabase createSignedUrls
                // generates signed URLs even for non-existent files. Use thumbnailVerified
                // (metadata-based) instead.
                compsToProcess = allComps.filter(function(c) {
                    if (!c.storagePath) return false;
                    if (!c.thumbnailVerified) return true;
                    if (thumbBlacklist[c.storagePath]) return true;
                    if (!c.previewFrameCount) return true;
                    return false;
                });
            }
        } catch (setupErr) {
            generateAllMissingThumbnails._running = false;
            debugLog('generateAllMissingThumbnails setup failed: ' + (setupErr && setupErr.message || setupErr), 'error');
            showToast('Generation setup failed: ' + (setupErr && setupErr.message || setupErr), true);
            return;
        }

        if (compsToProcess.length === 0) {
            showToast('All templates already have thumbnails!');
            var emptyBar = document.getElementById('admin-bar-progress');
            if (emptyBar) emptyBar.style.display = 'none';
            generateAllMissingThumbnails._running = false;
            return;
        }

        // Clear blacklist for templates we're about to generate
        compsToProcess.forEach(function(c) {
            if (c.storagePath && thumbBlacklist[c.storagePath]) {
                delete thumbBlacklist[c.storagePath];
            }
        });
        try { localStorage.setItem('blitzkrieg_thumb_blacklist', JSON.stringify(thumbBlacklist)); } catch(e) {}

        showSpinner();
        stashInProgress = true;
        var processed = 0;
        var succeeded = 0;
        var failed = 0;
        var total = compsToProcess.length;

        // Update progress bar
        function updateProgress() {
            // Guard against division by zero AND clamp the "current item" counter
            // to total so the last iteration doesn't read "Generating 11/10".
            var safeTotal = total || 1;
            var pct = Math.round((processed / safeTotal) * 100);
            var currentItem = Math.min(processed + 1, total);
            var bar = document.getElementById('generate-progress-bar');
            var text = document.getElementById('generate-progress-text');
            if (bar) bar.style.width = pct + '%';
            if (text) text.textContent = processed + '/' + total + ' — ' + succeeded + ' done, ' + failed + ' failed';
            showToast('Generating ' + currentItem + '/' + total + ': ' + (compsToProcess[processed] ? compsToProcess[processed].name : ''));
        }

        function processNext() {
            if (processed >= total) {
                stashInProgress = false;
                generateAllMissingThumbnails._running = false;
                hideSpinner();
                var bar = document.getElementById('generate-progress-bar');
                var text = document.getElementById('generate-progress-text');
                if (bar) bar.style.width = '100%';
                if (text) text.textContent = 'Done! ' + succeeded + ' generated, ' + failed + ' failed.';
                var thumbNoun = succeeded === 1 ? 'thumbnail' : 'thumbnails';
                showToast('Generation complete: ' + succeeded + ' ' + thumbNoun + ', ' + failed + ' failed.');
                // Invalidate cache and reload to show new thumbnails + previews
                window.cloudLibrary.invalidateCache();
                loadLibrary();
                return;
            }

            updateProgress();
            var comp = compsToProcess[processed];

            generateCloudThumbnail(comp).then(function() {
                succeeded++;
                processed++;
                processNext();
            }).catch(function(err) {
                debugLog('Generation failed for ' + comp.name + ': ' + err.message, 'error');
                failed++;
                processed++;
                processNext();
            });
        }

        processNext();
    }

    // Expose for dropdown menu and admin toolbar
    window.__blitzkriegGenerateThumbnails = generateAllMissingThumbnails;

    /* --------- Auth-gated initialization --------- */
    // The auth module (auth.js) handles login/access and calls onBlitzkriegAuthReady when access is granted
    window.onBlitzkriegAuthReady = function () {
        masterInit();
        // Auto OTA: install on detection + recheck every 30 min (non-blocking)
        startUpdateChecker();
        // Track session start
        if (window.blitzkriegAnalytics) {
            window.blitzkriegAnalytics.trackSessionStart();
        }
        // Start telemetry session
        if (window.blitzkriegTelemetry) {
            window.blitzkriegTelemetry.startSession();
        }
        // Track session end on panel close
        window.addEventListener('beforeunload', function() {
            if (window.blitzkriegAnalytics) window.blitzkriegAnalytics.trackSessionEnd();
            if (window.blitzkriegTelemetry) window.blitzkriegTelemetry.endSession();
        });
    };

    // Start auth check on load
    document.addEventListener('DOMContentLoaded', function () {
        // auth.js validateSession() runs and shows login or grants access
        if (window.blitzkriegAuth) {
            window.blitzkriegAuth.validateSession();
        }
    });

    // Auto-refresh grid when background manifest fetch finds new/removed templates.
    // Eliminates the "I see 142 but there are actually 245" stale-cache bug.
    window.addEventListener('blitzkrieg-library-changed', function (e) {
        var detail = e && e.detail || {};
        debugLog('Library changed (' + (detail.oldCount || '?') + ' -> ' + (detail.newCount || '?') + '), reloading grid', 'info');
        if (!isLoading) loadLibrary();
        else pendingLibraryReload = true;
    });

    // Surface category-list failures to the user. Without this, an editor whose
    // bucket has a category that times out on Supabase storage just silently
    // sees fewer templates than reality.
    var _lastPartialToastTs = 0;
    window.addEventListener('blitzkrieg-library-partial', function (e) {
        var detail = e && e.detail || {};
        var failed = detail.failedCategories || [];
        if (!failed.length) return;
        debugLog('Library PARTIAL load — categories failed: [' + failed.join(', ') + ']', 'error');
        // Throttle: never show this toast more than once per 30s.
        var now = Date.now();
        if (now - _lastPartialToastTs < 30000) return;
        _lastPartialToastTs = now;
        var label = failed.length === 1
            ? 'Category "' + failed[0] + '" failed to load'
            : failed.length + ' categories failed to load: ' + failed.join(', ');
        showToast(label + '. Click Refresh Library to retry.', true);
    });

    // expose some internals for inline calls (keeps compatibility)
    window.loadLibrary = loadLibrary;

})();
