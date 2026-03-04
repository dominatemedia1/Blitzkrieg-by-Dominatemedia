// js/main.js
(function () {
    'use strict';

    var csInterface = new CSInterface();

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
    var confirmDeleteCategoryBtn = document.getElementById('confirm-delete-category-btn');
    var cancelDeleteCategoryBtn = document.getElementById('cancel-delete-category-btn');

    // Move comp modal elements
    var moveCompModal = document.getElementById('move-comp-modal');
    var compToMoveName = document.getElementById('comp-to-move-name');
    var moveToCategorySelect = document.getElementById('move-to-category-select');
    var moveToNewCategoryInput = document.getElementById('move-to-new-category-input');
    var confirmMoveCompBtn = document.getElementById('confirm-move-comp-btn');
    var cancelMoveCompBtn = document.getElementById('cancel-move-comp-btn');

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
    var activeCategory = 'All';
    var currentDeleteInfo = null;
    var currentRenameInfo = null;
    var currentCategoryRenameInfo = null;
    var currentCategoryDeleteInfo = null;
    var currentMoveCompInfo = null;
    var isLoading = false; // Prevents race conditions in async operations
    var pendingLibraryReload = false; // Deferred reload when loadLibrary is called while isLoading
    var stashInProgress = false; // Suppresses focus-triggered loads during stash/generate operations

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
    function debugLog(message, level) {
        level = level || 'info';
        var time = new Date();
        var timeStr = ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2) + ':' + ('0' + time.getSeconds()).slice(-2) + '.' + ('00' + time.getMilliseconds()).slice(-3);
        var entry = { time: timeStr, message: String(message), level: level };
        debugLogEntries.push(entry);
        if (debugLogEntries.length > MAX_LOG_ENTRIES) debugLogEntries.shift();

        // Append to panel if visible
        if (debugLogContent) {
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
    }

    function toggleDebugLog() {
        if (debugLogPanel.style.display === 'none') {
            debugLogPanel.style.display = 'flex';
            document.body.classList.add('debug-panel-open');
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
        csInterface.evalScript('loadBlitzkriegSettings()', function(result) {
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
        csInterface.evalScript('saveBlitzkriegSettings("' + safeSettings + '")', function(result) {
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
            .replace(/\t/g, '\\t');  // Escape tabs
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
        var normalized = path.replace(/\\/g, '/');
        // Encode characters that have special meaning in URLs but can appear in file paths
        normalized = normalized
            .replace(/%/g, '%25')   // Must be first to avoid double-encoding
            .replace(/ /g, '%20')   // Spaces (common in macOS paths like "Application Support")
            .replace(/#/g, '%23')   // Fragment separator
            .replace(/\?/g, '%3F') // Query string separator
            .replace(/"/g, '%22'); // Double quotes
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
        window.addEventListener('focus', function() {
            if (!stashInProgress) {
                if (isLoading) {
                    pendingLibraryReload = true;
                } else {
                    loadLibrary();
                }
            }
        });

        // Initialize app directly
        initializeAppLogic();
    }

    /* --------- Utility Functions --------- */
    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
        } else {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
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

        // Refresh Library action
        if (dropdownRefresh) {
            dropdownRefresh.addEventListener('click', function(e) {
                e.preventDefault();
                dropdownContainer.classList.remove('open');
                loadLibrary();
                showToast('Library refreshed.');
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
            if (csInterface && typeof csInterface.evalScript === 'function') {
                csInterface.evalScript('typeof getStashedComps', function(typeResult) {
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

        // Initialize keyboard shortcuts
        initKeyboardShortcuts();

        hideSpinner();
    }

    function loadLibrary() {
        if (isLoading) {
            pendingLibraryReload = true;
            return;
        }
        isLoading = true;
        pendingLibraryReload = false;
        showSpinner();

        debugLog('loadLibrary: Loading templates from cloud...', 'info');

        window.cloudLibrary.listTemplates().then(function (comps) {
            debugLog('loadLibrary: Loaded ' + comps.length + ' templates from cloud', 'success');
            allComps = comps;
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

            if (pendingLibraryReload) {
                pendingLibraryReload = false;
                loadLibrary();
            }
        }).catch(function (err) {
            debugLog('loadLibrary: ERROR - ' + err.message, 'error');
            showToast('Failed to load templates: ' + err.message, true);
            hideSpinner();
            isLoading = false;
        });
    }

    /**
     * Runs library diagnostics and logs detailed folder structure info to the debug log.
     */
    function runLibraryDiagnostics() {
        var libraryPath = getLibraryPath();
        if (!libraryPath) {
            debugLog('Diagnostics: No library path set', 'warn');
            return;
        }
        debugLog('Running diagnostics for: ' + libraryPath, 'info');
        debugLog('Platform: ' + navigator.platform + ' | UserAgent: ' + navigator.userAgent.substring(0, 80), 'info');
        var safePath = escapeForExtendScript(libraryPath);

        // First test: can we even call ExtendScript?
        csInterface.evalScript('typeof getStashedComps', function(typeResult) {
            debugLog('ExtendScript function check: typeof getStashedComps = "' + typeResult + '"', typeResult === 'function' ? 'success' : 'error');

            if (typeResult !== 'function') {
                debugLog('CRITICAL: hostscript.jsx functions not loaded! ExtendScript may have a syntax error.', 'error');
                // Try to get the actual error
                csInterface.evalScript('try { eval("getStashedComps"); "ok"; } catch(e) { e.toString(); }', function(errResult) {
                    debugLog('ExtendScript error detail: ' + errResult, 'error');
                });
                return;
            }

            // Run the full diagnostic
            csInterface.evalScript('debugLibrary("' + safePath + '")', function(result) {
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
                                var status = cmp.hasAep ? 'OK' : 'MISSING .aep!';
                                debugLog('      ' + cmp.name + ' - AEP:' + cmp.hasAep + ' Meta:' + cmp.hasMetadata + ' Thumb:' + cmp.hasThumbnail + ' Files:[' + cmp.files.join(', ') + '] ' + status, cmp.hasAep ? 'success' : 'error');
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
        // Get unique categories from loaded comps
        var categories = Array.from(new Set(allComps.map(function(comp) { return comp.category; }))).sort();

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

        // Render categories in the sidebar with action buttons
        categoryFiltersContainer.innerHTML = categories.map(function(cat) {
            var safeCat = escapeHTML(cat);
            var count = allComps.filter(function(c) { return c.category === cat; }).length;
            var isActive = cat === activeCategory;
            return '<div class="nav-item' + (isActive ? ' active' : '') + '" data-category="' + safeCat + '" draggable="false">' +
                '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>' +
                '</svg>' +
                '<span class="nav-label">' + safeCat + '</span>' +
                '<span class="nav-count">' + count + '</span>' +
                '<div class="nav-item-actions">' +
                    '<button class="nav-action-btn rename-category-btn" title="Rename category">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>' +
                    '</button>' +
                    '<button class="nav-action-btn delete-category-btn" title="Delete category">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
                    '</button>' +
                '</div>' +
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
                rootMargin: '100px',
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

        // Pre-convert frame paths to proper file:// URLs
        var frameSrcs = previewFrames.map(function(path) {
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

        // Animation loop using requestAnimationFrame with DYNAMIC frame interval
        function animate(timestamp) {
            if (!isRunning) return;

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

    function renderCompsGrid() {
        // Guard: if a special view is active, delegate and don't render template cards
        if (activeCategory === '__analytics') {
            renderAnalyticsDashboard();
            return;
        }
        if (activeCategory.indexOf('__submissions_') === 0) {
            renderSubmissionsGrid(activeCategory.replace('__submissions_', ''));
            return;
        }
        if (activeCategory === '__review_pending') {
            renderSubmissionsGrid('pending_review');
            return;
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
            // Filter by search
            var matchesSearch = comp.name.toLowerCase().includes(searchTerm);
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
        // Use DocumentFragment for faster DOM updates
        var fragment = document.createDocumentFragment();
        var tempDiv = document.createElement('div');

        // Build HTML string for all items at once
        var htmlParts = [];
        for (var ci = 0; ci < filteredComps.length; ci++) {
            var comp = filteredComps[ci];
            // Escape all user-controlled data to prevent XSS
            var safeUniqueId = escapeHTML(comp.uniqueId);
            var safeCategory = escapeHTML(comp.category);
            var safeAepPath = escapeHTML(comp.aepPath || '');
            var safeStoragePath = escapeHTML(comp.storagePath || '');
            var safeGifUrl = escapeHTML(comp.gifUrl || '');
            var safeName = escapeHTML(comp.name);
            // Use cloud thumbnail URL or fall back to local path
            var thumbSrc = comp.thumbUrl || (comp.thumbPath ? pathToFileUrl(comp.thumbPath) : '');
            var safeThumbSrc = escapeHTML(thumbSrc);

            // Prepare preview frames data attribute (JSON encoded)
            var hasPreview = comp.previewFrames && comp.previewFrames.length > 0;
            var previewDataAttr = hasPreview ? ' data-preview-frames="' + escapeHTML(JSON.stringify(comp.previewFrames)) + '"' : '';
            var durationAttr = comp.duration ? ' data-duration="' + comp.duration + '"' : '';
            var previewClass = hasPreview ? ' has-preview' : '';

            // Generate preview/thumbnail button for items without preview
            var generatePreviewBtn = '';
            if (!hasPreview && !thumbSrc && comp.storagePath) {
                // Cloud template without thumbnail: show "Thumbnail" button
                generatePreviewBtn = '<button class="generate-preview-btn" title="Generate Thumbnail"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> Thumb</button>';
            } else if (!hasPreview && !comp.storagePath) {
                // Local template: show preview animation button
                generatePreviewBtn = '<button class="generate-preview-btn" title="Generate Preview Animation"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Preview</button>';
            }

            // Generate a colored placeholder with the template initial
            var nameInitial = (comp.name || '?').charAt(0).toUpperCase();
            // Deterministic color from name hash
            var placeholderColors = ['#1e3a5f','#2d4a3e','#3d2c5e','#4a2c2c','#2c3e50','#1a472a','#3b1f2b','#2c3e6b'];
            var colorIdx = 0;
            for (var ci2 = 0; ci2 < comp.name.length; ci2++) { colorIdx += comp.name.charCodeAt(ci2); }
            var placeholderColor = placeholderColors[colorIdx % placeholderColors.length];
            var placeholderHtml = '<div class="thumb-placeholder" style="background-color:' + placeholderColor + '"><span class="thumb-placeholder-initial">' + escapeHTML(nameInitial) + '</span></div>';

            // Use lazy loading for thumbnails - data-src instead of src, with loading="lazy"
            var thumbHtml = thumbSrc
                ? '<img data-src="' + safeThumbSrc + '" alt="Thumbnail" class="comp-thumbnail lazy-thumb" loading="lazy">' + placeholderHtml
                : placeholderHtml;

            // Check if comp is favorited
            var isFav = isFavorite(comp.uniqueId);
            var favClass = isFav ? ' is-favorite' : '';
            var favTitle = isFav ? 'Remove from favorites' : 'Add to favorites';
            var favFill = isFav ? 'currentColor' : 'none';

            var isAdmin = window.blitzkriegAuth && window.blitzkriegAuth.isAdmin();
            var adminBtns = isAdmin ? (
                    '<button class="action-btn move-btn" title="Move to category"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><polyline points="9 14 12 11 15 14"></polyline></svg></button>' +
                    '<button class="action-btn rename-btn" title="Rename"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>' +
                    '<button class="action-btn delete-btn" title="Delete"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>'
            ) : '';

            var gifDataAttr = safeGifUrl ? ' data-gif-url="' + safeGifUrl + '"' : '';

            htmlParts.push('<div class="stash-item' + previewClass + favClass + '" data-unique-id="' + safeUniqueId + '" data-category="' + safeCategory + '" data-aep-path="' + safeAepPath + '" data-storage-path="' + safeStoragePath + '" data-name="' + safeName + '"' + previewDataAttr + durationAttr + gifDataAttr + ' draggable="true">' +
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
            '</div>');
        }

        stashGrid.innerHTML = htmlParts.join('');

        // MEMORY OPTIMIZED: Lazy load thumbnails using singleton Intersection Observer
        var lazyThumbnails = stashGrid.querySelectorAll('.lazy-thumb');
        var observer = getLazyLoadObserver();

        // Error handler: hide broken img and show the placeholder behind it
        function handleThumbError() {
            this.style.display = 'none';
            // The placeholder is already in the DOM behind the img — just let it show through
            var placeholder = this.parentElement.querySelector('.thumb-placeholder');
            if (placeholder) {
                placeholder.style.display = 'flex';
            }
        }

        if (observer) {
            // Use singleton observer - no need to create new one each render
            lazyThumbnails.forEach(function(img) {
                observer.observe(img);
                img.addEventListener('load', function() {
                    // Image loaded successfully — hide the placeholder
                    var placeholder = this.parentElement.querySelector('.thumb-placeholder');
                    if (placeholder) placeholder.style.display = 'none';
                });
                img.onerror = handleThumbError;
            });
        } else {
            // Fallback for browsers without IntersectionObserver - load all immediately
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

        // Add hover event listeners for preview animation
        var stashItems = stashGrid.querySelectorAll('.stash-item.has-preview');
        stashItems.forEach(function(item) {
            var thumbnailContainer = item.querySelector('.thumbnail');
            var uniqueId = item.dataset.uniqueId;
            var previewFramesJson = item.dataset.previewFrames;
            var duration = parseFloat(item.dataset.duration) || 0;

            if (thumbnailContainer && previewFramesJson) {
                try {
                    var previewFrames = JSON.parse(previewFramesJson);
                    if (previewFrames && previewFrames.length > 0) {
                        // Mouse enter - start preview with DYNAMIC playback speed
                        item.addEventListener('mouseenter', function() {
                            startPreviewAnimation(thumbnailContainer, previewFrames, uniqueId, duration);
                        });

                        // Mouse leave - stop preview
                        item.addEventListener('mouseleave', function() {
                            stopPreviewAnimation(thumbnailContainer, uniqueId);
                        });
                    }
                } catch (e) {
                    console.warn('Blitzkrieg: Could not parse preview frames for ' + uniqueId);
                }
            }
        });

        // Add GIF hover preview for cloud templates with gif URLs
        var gifItems = stashGrid.querySelectorAll('.stash-item[data-gif-url]');
        gifItems.forEach(function(item) {
            var gifUrl = item.dataset.gifUrl;
            if (!gifUrl) return;

            // Skip items that already have local preview frames (those use the frame animation system)
            if (item.classList.contains('has-preview')) return;

            var thumbnailContainer = item.querySelector('.thumbnail');
            if (!thumbnailContainer) return;

            // Track whether GIF was verified to exist (avoid repeated 404s)
            var gifVerified = false;
            var gifFailed = false;

            item.addEventListener('mouseenter', function() {
                if (gifFailed) return;
                var img = thumbnailContainer.querySelector('.comp-thumbnail');
                if (!img) return;

                if (!gifVerified) {
                    // First hover: preload GIF to check if it exists
                    var testImg = new Image();
                    testImg.onload = function() {
                        gifVerified = true;
                        // Store original src and swap to GIF
                        if (!img.dataset.originalSrc) {
                            img.dataset.originalSrc = img.src || img.dataset.src || '';
                        }
                        img.src = gifUrl;
                        img.classList.remove('lazy-thumb');
                    };
                    testImg.onerror = function() {
                        gifFailed = true; // Don't try again
                    };
                    testImg.src = gifUrl;
                } else {
                    // GIF already verified — swap immediately
                    if (!img.dataset.originalSrc) {
                        img.dataset.originalSrc = img.src || img.dataset.src || '';
                    }
                    img.src = gifUrl;
                }
            });

            item.addEventListener('mouseleave', function() {
                var img = thumbnailContainer.querySelector('.comp-thumbnail');
                if (img && img.dataset.originalSrc) {
                    img.src = img.dataset.originalSrc;
                }
            });
        });

        // Add view tracking (mouseenter) and drag/drop handlers for all stash items
        var allStashItems = stashGrid.querySelectorAll('.stash-item');
        allStashItems.forEach(function(item) {
            // Track view on hover (deduplicated per session in analytics.js)
            item.addEventListener('mouseenter', function() {
                if (window.blitzkriegAnalytics) {
                    window.blitzkriegAnalytics.trackView(
                        item.dataset.name,
                        item.dataset.category,
                        item.dataset.storagePath,
                        item.dataset.uniqueId
                    );
                }
            });

            // Drag start
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

            // Drag end
            item.addEventListener('dragend', function(e) {
                item.classList.remove('dragging');
                draggedComp = null;
                // Remove drag-over class from all categories
                var allCategories = document.querySelectorAll('.nav-item');
                allCategories.forEach(function(cat) {
                    cat.classList.remove('drag-over');
                });
            });
        });
    }

    function showPlaceholder(message) { stashGrid.innerHTML = '<p class="placeholder-text">' + message + '</p>'; }

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
        var item = e.target.closest('.stash-item');
        if (!item) return;
        var uniqueId = item.dataset.uniqueId, category = item.dataset.category, aepPath = item.dataset.aepPath, storagePath = item.dataset.storagePath, name = item.dataset.name;
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
     * Double-click on a comp card to import it instantly
     */
    function handleStashGridDoubleClick(e) {
        // Suppress double-click in analytics views
        if (analyticsView) return;
        var item = e.target.closest('.stash-item');
        if (!item) return;
        // Don't trigger on buttons
        if (e.target.closest('.action-btn') || e.target.closest('.import-btn') || e.target.closest('.generate-preview-btn')) return;
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
        csInterface.evalScript('generatePreviewFrames("' + safePath + '")', function(result) {
            stashInProgress = false;
            hideSpinner();
            if (!result) {
                showToast('Unexpected error generating preview.', true);
                return;
            }
            if (result.indexOf('Success') === 0 || result.indexOf('Warning') === 0) {
                showToast(result.replace(/^(Success:|Warning:)\s*/, ''));
                // Reload library to show the new preview
                var libraryPath = getLibraryPath();
                if (libraryPath) {
                    // Immediate reload attempt
                    loadLibrary(libraryPath);
                    // Progressive retries for macOS AE 25.1 file system and engine settling
                    setTimeout(function() { loadLibrary(libraryPath); }, 1000);
                    setTimeout(function() { loadLibrary(libraryPath); }, 3000);
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
        if (!csInterface || typeof csInterface.evalScript !== 'function') {
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
        showToast('Generating thumbnail for "' + compName + '"...');

        generateCloudThumbnail(comp).then(function() {
            stashInProgress = false;
            hideSpinner();
            showToast('Thumbnail generated for "' + compName + '"!');
            loadLibrary();
        }).catch(function(err) {
            stashInProgress = false;
            hideSpinner();
            showToast('Failed to generate thumbnail: ' + err.message, true);
        });
    }

    /* --------- add/rename/delete/import flows --------- */
    function addSelectedComp() {
        // Check if CSInterface is available
        if (!csInterface || typeof csInterface.evalScript !== 'function') {
            showToast('Adding comps requires After Effects.', true);
            return;
        }
        var categories = Array.from(new Set(allComps.map(function(c) { return c.category; }))).sort();
        existingCategorySelect.innerHTML = categories.map(function (cat) { return '<option value="' + cat + '">' + cat + '</option>'; }).join('');
        existingCategorySelect.disabled = categories.length === 0;
        if (categories.length === 0) { existingCategorySelect.innerHTML = '<option value="">No categories yet</option>'; }
        newCategoryInput.value = '';
        addCompModal.style.display = 'flex';
    }

    function executeAddComp() {
        var isAdmin = window.blitzkriegAuth && window.blitzkriegAuth.isAdmin();
        var newCatName = newCategoryInput.value.trim();
        var existingCatName = existingCategorySelect.value;
        var categoryName = newCatName || existingCatName;

        if (!categoryName) {
            showToast('Please select or create a category.', true);
            return;
        }
        // Validate category name (prevent path traversal)
        if (categoryName.indexOf('/') !== -1 || categoryName.indexOf('\\') !== -1 || categoryName.indexOf('..') !== -1) {
            showToast('Category name cannot contain path separators.', true);
            return;
        }

        addCompModal.style.display = 'none';
        stashInProgress = true;
        showSpinner();
        showToast(isAdmin ? 'Saving composition...' : 'Submitting composition for review...');

        var safeCategory = escapeForExtendScript(categoryName);

        csInterface.evalScript('stashSelectedCompToTemp("' + safeCategory + '")', function(result) {
            (async function() {
                try {
                    var parsed = JSON.parse(result);
                    if (parsed.result && parsed.result.indexOf('Error') === 0) {
                        showToast(parsed.result, true);
                        stashInProgress = false;
                        hideSpinner();
                        return;
                    }

                    var tempPath = parsed.tempPath;
                    var files = await readTempFiles(tempPath, categoryName);

                    if (isAdmin) {
                        // Admin: upload directly to production path (current behavior)
                        await window.cloudLibrary.uploadTemplate(categoryName, files.folderName, {
                            aep: files.aepBlob,
                            thumbnail: files.thumbnailBlob,
                            metadata: files.metadata,
                        });

                        csInterface.evalScript('cleanupTempStash("' + escapeForExtendScript(tempPath) + '")');
                        showToast('Template added to cloud library!');
                        stashInProgress = false;
                        hideSpinner();
                        activeCategory = categoryName;
                        loadLibrary();
                    } else {
                        // Non-admin: upload to pending path and create submission record
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

                        // Upload thumbnail if present
                        if (files.thumbnailBlob) {
                            var thumbUpload = await sb.storage.from('blitzkrieg')
                                .upload(pendingBasePath + '/thumbnail.png', files.thumbnailBlob, {
                                    contentType: 'image/png',
                                    upsert: true,
                                });
                            if (thumbUpload.error) {
                                debugLog('Thumbnail upload warning: ' + thumbUpload.error.message, 'warn');
                            }
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
                        var insertResult = await sb.from('blitzkrieg_template_submissions').insert({
                            user_id: userId,
                            team_member_id: teamMember ? teamMember.id : null,
                            template_name: files.metadata && files.metadata.name ? files.metadata.name : files.folderName,
                            category: categoryName,
                            storage_path: pendingBasePath,
                            status: 'pending',
                            metadata: files.metadata || {},
                        });
                        if (insertResult.error) throw new Error('Submission record failed: ' + insertResult.error.message);

                        csInterface.evalScript('cleanupTempStash("' + escapeForExtendScript(tempPath) + '")');
                        showToast('Template submitted for review!');
                        stashInProgress = false;
                        hideSpinner();
                        loadSubmissionCounts();
                    }
                } catch (err) {
                    debugLog('Upload error: ' + err.message, 'error');
                    showToast('Failed to ' + (isAdmin ? 'upload' : 'submit') + ' template: ' + err.message, true);
                    stashInProgress = false;
                    hideSpinner();
                }
            })();
        });
    }

    function readTempFiles(tempPath, categoryName) {
        return new Promise(function(resolve, reject) {
            var safePath = escapeForExtendScript(tempPath + '/' + categoryName);
            csInterface.evalScript('readStashedFilesAsBase64("' + safePath + '")', function(result) {
                try {
                    var data = JSON.parse(result);
                    if (data.error) {
                        reject(new Error(data.error));
                        return;
                    }

                    // Convert base64 to blobs
                    var aepBlob = base64ToBlob(data.aepBase64, 'application/octet-stream');
                    var thumbnailBlob = data.thumbnailBase64 ? base64ToBlob(data.thumbnailBase64, 'image/png') : null;

                    resolve({
                        folderName: data.folderName,
                        aepBlob: aepBlob,
                        thumbnailBlob: thumbnailBlob,
                        metadata: data.metadata,
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });
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

        csInterface.evalScript('deleteStashedComp("' + safePath + '","' + safeCategory + '","' + safeUniqueId + '")', function (result) {
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
        // Validate new name (prevent path traversal)
        if (newName.indexOf('/') !== -1 || newName.indexOf('\\') !== -1 || newName.indexOf('..') !== -1) {
            showToast('Name cannot contain path separators.', true);
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

        csInterface.evalScript('renameStashedComp("' + safePath + '","' + safeCategory + '","' + safeUniqueId + '","' + safeNewName + '")', function (result) {
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
        if (index === -1) {
            favoriteComps.push(uniqueId);
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
        renderUI(); // Re-render to update star icon
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
        if (!csInterface || typeof csInterface.evalScript !== 'function') {
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
            showToast('Downloading template...');

            window.cloudLibrary.downloadTemplate(storagePath).then(function (downloaded) {
                // Convert blob to base64, send to ExtendScript to write to temp
                var reader = new FileReader();
                reader.onload = function () {
                    var base64 = reader.result.split(',')[1];
                    var safeName = escapeForExtendScript(downloaded.fileName);

                    csInterface.evalScript('writeTempFileFromBase64("' + base64 + '", "' + safeName + '")', function(tempPath) {
                        if (!tempPath || tempPath === 'EvalScript error.' || tempPath.indexOf('ERROR') === 0) {
                            showToast('Failed to save template. Ensure After Effects is running.', true);
                            hideSpinner();
                            return;
                        }

                        // Import the comp from the temp file
                        csInterface.evalScript('importComp("' + escapeForExtendScript(tempPath) + '")', function(result) {
                            hideSpinner();
                            if (result && result.indexOf('Success') === 0) {
                                showToast('Imported and opened in timeline!');
                                if (uniqueId) addToRecent(uniqueId);
                                if (window.blitzkriegAnalytics && _trackComp) {
                                    window.blitzkriegAnalytics.trackImport(_trackComp.name, _trackComp.category, storagePath);
                                }
                            } else {
                                showToast(result || 'Unexpected error importing.', true);
                            }
                        });
                    });
                };
                reader.readAsDataURL(downloaded.blob);
            }).catch(function (err) {
                hideSpinner();
                showToast('Failed to download template: ' + err.message, true);
            });
            return;
        }

        // Legacy local import path
        if (!isValidPath(aepPath)) {
            showToast('Invalid file path.', true);
            return;
        }

        showSpinner();
        var safePath = escapeForExtendScript(aepPath);

        csInterface.evalScript('importComp("' + safePath + '")', function (result) {
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
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to rename categories.', true);
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
        // Validate new name
        if (newName.indexOf('/') !== -1 || newName.indexOf('\\') !== -1 || newName.indexOf('..') !== -1) {
            showToast('Name cannot contain path separators.', true);
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

        csInterface.evalScript('renameCategory("' + safePath + '","' + safeOldName + '","' + safeNewName + '")', function (result) {
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
        currentCategoryDeleteInfo = { category: categoryName };
        if (categoryToDeleteName) categoryToDeleteName.textContent = categoryName;
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

        deleteCategoryModal.style.display = 'none';
        showSpinner();

        // Cloud delete: remove all files in the category
        if (window.cloudLibrary && window.cloudLibrary.deleteCategory) {
            window.cloudLibrary.deleteCategory(info.category).then(function() {
                hideSpinner();
                currentCategoryDeleteInfo = null;
                showToast('Category deleted successfully.');
                if (activeCategory === info.category) {
                    activeCategory = 'All';
                }
                loadLibrary();
            }).catch(function(err) {
                hideSpinner();
                currentCategoryDeleteInfo = null;
                showToast('Failed to delete category: ' + err.message, true);
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

        csInterface.evalScript('deleteCategory("' + safePath + '","' + safeCategoryName + '")', function (result) {
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
        var categories = Array.from(new Set(allComps.map(function(c) { return c.category; }))).sort();
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

        // Validate new category name
        if (targetCategory.indexOf('/') !== -1 || targetCategory.indexOf('\\') !== -1 || targetCategory.indexOf('..') !== -1) {
            showToast('Category name cannot contain path separators.', true);
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

        csInterface.evalScript('moveCompToCategory("' + safePath + '","' + safeUniqueId + '","' + safeOldCategory + '","' + safeNewCategory + '")', function (result) {
            hideSpinner();
            if (result && result.indexOf('Success') === 0) {
                showToast('"' + compName + '" moved to ' + newCategory + '.');
                loadLibrary();
            } else {
                showToast(result || 'Move failed', true);
            }
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
                var categories = Array.from(new Set(allComps.map(function(c) { return c.category; }))).sort();
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

        if (settingsModal) settingsModal.style.display = 'none';
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

        // Load user's own submission counts
        sb.from('blitzkrieg_template_submissions')
            .select('status', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'pending')
            .then(function(res) {
                var el = document.getElementById('my-submissions-pending-count');
                if (el) el.textContent = res.count || 0;
            });

        sb.from('blitzkrieg_template_submissions')
            .select('status', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'approved')
            .then(function(res) {
                var el = document.getElementById('my-submissions-approved-count');
                if (el) el.textContent = res.count || 0;
            });

        sb.from('blitzkrieg_template_submissions')
            .select('status', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'rejected')
            .then(function(res) {
                var el = document.getElementById('my-submissions-rejected-count');
                if (el) el.textContent = res.count || 0;
            });

        // Load admin review queue count
        if (isAdmin) {
            sb.from('blitzkrieg_template_submissions')
                .select('status', { count: 'exact', head: true })
                .eq('status', 'pending')
                .then(function(res) {
                    var el = document.getElementById('review-pending-count');
                    if (el) el.textContent = res.count || 0;
                });
        }
    }

    /**
     * Load and render submissions grid
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
            // Admin review: show all pending submissions
            query = query.eq('status', 'pending');
        } else {
            // User view: show own submissions with filter
            query = query.eq('user_id', window.blitzkriegAuth.getUser().id)
                         .eq('status', statusFilter);
        }

        query.then(function(res) {
            hideSpinner();
            if (res.error) {
                showPlaceholder('Failed to load submissions.');
                return;
            }

            var submissions = res.data || [];
            if (submissions.length === 0) {
                var msg = isReviewMode ? 'No submissions pending review.' : 'No ' + statusFilter + ' submissions.';
                showPlaceholder(msg);
                return;
            }

            var html = '';
            submissions.forEach(function(sub) {
                var statusClass = 'status-' + sub.status;
                var statusLabel = sub.status.charAt(0).toUpperCase() + sub.status.slice(1);
                var dateStr = new Date(sub.created_at).toLocaleDateString();

                html += '<div class="stash-item submission-card" data-submission-id="' + sub.id + '">';
                html += '<div class="submission-card-header">';
                html += '<span class="submission-name">' + escapeHTML(sub.template_name) + '</span>';
                html += '<span class="status-badge ' + statusClass + '">' + statusLabel + '</span>';
                html += '</div>';
                html += '<div class="submission-card-meta">';
                html += '<span class="submission-category">' + escapeHTML(sub.category) + '</span>';
                html += '<span class="submission-date">' + dateStr + '</span>';
                html += '</div>';

                // Show rejection notes if rejected
                if (sub.status === 'rejected' && sub.reviewer_notes) {
                    html += '<div class="submission-rejection-notes">';
                    html += '<strong>Feedback:</strong> ' + escapeHTML(sub.reviewer_notes);
                    html += '</div>';
                }

                // Admin review actions
                if (isReviewMode && isAdmin) {
                    html += '<div class="submission-actions">';
                    html += '<button class="button-primary btn-approve" onclick="window.__approveSubmission(\'' + sub.id + '\')">Approve</button>';
                    html += '<button class="button-danger btn-reject" onclick="window.__rejectSubmission(\'' + sub.id + '\')">Reject</button>';
                    html += '</div>';
                }

                html += '</div>';
            });

            stashGrid.innerHTML = html;
        });
    }

    /**
     * Approve a submission: copy files from pending to production, update DB
     */
    function approveSubmission(submissionId) {
        var sb = window.blitzkriegSupabase;
        if (!sb || !window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) return;

        showSpinner();
        showToast('Approving submission...');

        sb.from('blitzkrieg_template_submissions')
            .select('*')
            .eq('id', submissionId)
            .single()
            .then(function(res) {
                if (res.error || !res.data) {
                    hideSpinner();
                    showToast('Submission not found.', true);
                    return;
                }

                var sub = res.data;
                var pendingPath = sub.storage_path;
                var productionPath = sub.category + '/' + pendingPath.split('/').pop();

                // List files in the pending path
                sb.storage.from('blitzkrieg').list(pendingPath).then(function(listRes) {
                    if (listRes.error || !listRes.data || listRes.data.length === 0) {
                        hideSpinner();
                        showToast('No files found in pending path.', true);
                        return;
                    }

                    var files = listRes.data.filter(function(f) { return f.id !== null; });
                    var copyPromises = files.map(function(file) {
                        var srcPath = pendingPath + '/' + file.name;
                        var destPath = productionPath + '/' + file.name;

                        // Download from pending, then upload to production
                        return sb.storage.from('blitzkrieg').download(srcPath).then(function(dlRes) {
                            if (dlRes.error) throw new Error('Download failed: ' + dlRes.error.message);
                            return sb.storage.from('blitzkrieg').upload(destPath, dlRes.data, {
                                upsert: true,
                            });
                        }).then(function(upRes) {
                            if (upRes.error) throw new Error('Upload failed: ' + upRes.error.message);
                            // Delete the pending file
                            return sb.storage.from('blitzkrieg').remove([srcPath]);
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
                            loadSubmissionCounts();
                            renderSubmissionsGrid('pending_review');
                        }
                    }).catch(function(err) {
                        hideSpinner();
                        showToast('Approve failed: ' + err.message, true);
                    });
                });
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
        if (!sb) return;

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
                if (res.error) {
                    showToast('Rejection failed: ' + res.error.message, true);
                } else {
                    showToast('Submission rejected.');
                    loadSubmissionCounts();
                    renderSubmissionsGrid('pending_review');
                }
            });
    }

    // Expose review actions globally for inline onclick handlers
    window.__approveSubmission = approveSubmission;
    window.__rejectSubmission = promptRejectSubmission;

    /* --------- Analytics Dashboard (Admin) — Multi-view Drilldown --------- */

    // Analytics view state
    var analyticsView = null; // 'overview' | 'editors' | 'editor-detail' | 'template-detail' | null
    var analyticsEditorId = null;
    var analyticsEditorName = '';
    var analyticsTemplateName = '';
    var analyticsTemplateCategory = '';
    var analyticsDateRange = '30d';

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
        return '<div class="' + cls + '"' + attrs + '>' +
            '<div class="stat-value">' + escapeHTML(String(value)) + '</div>' +
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
            maxVal = Math.max(maxVal, Number(d.import_count) || 0, Number(d.view_count) || 0);
        });
        var showLabels = dailyStats.length <= 14;
        var html = '<div class="css-bar-chart-container">';
        html += '<div class="css-bar-chart-title">Daily Activity</div>';
        html += '<div class="css-bar-chart">';
        dailyStats.forEach(function(d) {
            var importH = Math.max(((Number(d.import_count) || 0) / maxVal) * 100, 1.5);
            var viewH = Math.max(((Number(d.view_count) || 0) / maxVal) * 100, 1.5);
            var dateLabel = new Date(d.stat_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            html += '<div class="chart-bar-group" title="' + dateLabel + ': ' + (d.import_count || 0) + ' imports, ' + (d.view_count || 0) + ' views">';
            html += '<div class="chart-bar-pair">';
            html += '<div class="chart-bar imports" style="height:' + importH + '%"></div>';
            html += '<div class="chart-bar views" style="height:' + viewH + '%"></div>';
            html += '</div>';
            if (showLabels) html += '<div class="chart-bar-label">' + dateLabel + '</div>';
            html += '</div>';
        });
        html += '</div>';
        html += '<div class="chart-legend">';
        html += '<span class="chart-legend-item"><span class="chart-legend-dot imports"></span>Imports</span>';
        html += '<span class="chart-legend-item"><span class="chart-legend-dot views"></span>Views</span>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function buildActivityTimeline(events) {
        if (!events || events.length === 0) {
            return '<p class="placeholder-text">No activity for this period.</p>';
        }
        // Group by date
        var groups = {};
        var groupOrder = [];
        events.forEach(function(ev) {
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

        if (!analyticsView) analyticsView = 'overview';

        // Build shell HTML: header bar with tabs + date range
        var activeTab = (analyticsView === 'overview' || analyticsView === 'template-detail') ? 'overview' : 'editors';
        var html = '<div class="analytics-dashboard">';

        // Header bar
        html += '<div class="analytics-header-bar">';
        html += '<div class="analytics-tabs">';
        html += '<button class="analytics-tab' + (activeTab === 'overview' ? ' active' : '') + '" data-analytics-action="goto-overview">Overview</button>';
        html += '<button class="analytics-tab' + (activeTab === 'editors' ? ' active' : '') + '" data-analytics-action="goto-editors">Editors</button>';
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
        }
    }

    function renderAnalyticsOverview() {
        var sb = window.blitzkriegSupabase;
        if (!sb) return;
        var contentEl = document.getElementById('analytics-content');
        if (!contentEl) return;

        contentEl.innerHTML = '<div style="text-align:center;padding:40px 0"><div class="analytics-skeleton" style="width:60px;height:60px;margin:0 auto;border-radius:50%"></div></div>';

        var startDate = analyticsStartDate();
        var endDate = new Date().toISOString();

        Promise.all([
            sb.rpc('get_blitzkrieg_summary', { p_start_date: startDate, p_end_date: endDate }),
            sb.rpc('get_blitzkrieg_daily_stats', { p_start_date: startDate, p_end_date: endDate }),
            sb.rpc('get_blitzkrieg_top_templates', { p_start_date: startDate, p_limit: 10 }),
            sb.rpc('get_blitzkrieg_user_stats', { p_start_date: startDate }),
        ]).then(function(results) {
            var summary = (results[0].data && results[0].data[0]) ? results[0].data[0] : {
                total_imports: 0, total_views: 0, active_users: 0, total_searches: 0, pending_submissions: 0
            };
            var dailyStats = results[1].data || [];
            var topTemplates = results[2].data || [];
            var userStats = results[3].data || [];

            // Cache for editors tab
            analyticsCache.summary = summary;
            analyticsCache.dailyStats = dailyStats;
            analyticsCache.topTemplates = topTemplates;
            analyticsCache.userStats = userStats;

            var days = ANALYTICS_PERIOD_DAYS[analyticsDateRange] || 30;
            var avgDaily = dailyStats.length > 0
                ? (dailyStats.reduce(function(s, d) { return s + Number(d.unique_users || 0); }, 0) / dailyStats.length).toFixed(1)
                : '0';

            var html = '';

            // 6 KPI Cards (3x2 grid)
            html += '<div class="analytics-stat-cards-3col">';
            html += buildStatCard(analyticsFormatNumber(summary.total_imports), 'Imports (' + days + 'd)');
            html += buildStatCard(analyticsFormatNumber(summary.active_users), 'Active Users', { clickable: true, action: 'goto-editors' });
            html += buildStatCard(analyticsFormatNumber(summary.pending_submissions), 'Pending Submissions');
            html += buildStatCard(analyticsFormatNumber(summary.total_views), 'Template Views');
            html += buildStatCard(analyticsFormatNumber(summary.total_searches), 'Searches');
            html += buildStatCard(avgDaily, 'Avg Daily Users');
            html += '</div>';

            // Daily Activity Bar Chart
            html += buildCSSBarChart(dailyStats);

            // Top 10 Templates Table
            if (topTemplates.length > 0) {
                html += '<div class="analytics-table-section">';
                html += '<h3 class="analytics-table-title">Top Templates (' + days + ' days)</h3>';
                html += '<table class="analytics-table">';
                html += '<thead><tr><th>#</th><th>Template</th><th>Category</th><th style="text-align:right">Imports</th><th style="text-align:right">Views</th><th style="text-align:right">Users</th></tr></thead>';
                html += '<tbody>';
                topTemplates.forEach(function(t, i) {
                    html += '<tr class="clickable-row" data-analytics-action="goto-template" data-template-name="' +
                        escapeHTML(t.template_name || '') + '" data-template-category="' + escapeHTML(t.template_category || '') + '">';
                    html += '<td style="color:var(--text-faint)">' + (i + 1) + '</td>';
                    html += '<td class="template-name-link">' + escapeHTML(t.template_name || 'Unknown') + '</td>';
                    html += '<td>' + escapeHTML(t.template_category || '-') + '</td>';
                    html += '<td style="text-align:right">' + analyticsFormatNumber(t.import_count) + '</td>';
                    html += '<td style="text-align:right">' + analyticsFormatNumber(t.view_count) + '</td>';
                    html += '<td style="text-align:right">' + (t.unique_users || 0) + '</td>';
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
            } else {
                html += '<p class="placeholder-text">No template usage data yet.</p>';
            }

            contentEl.innerHTML = html;
        }).catch(function(err) {
            contentEl.innerHTML = '<p class="placeholder-text">Analytics error: ' + escapeHTML(err.message) + '</p>';
        });
    }

    function renderAnalyticsEditors() {
        var contentEl = document.getElementById('analytics-content');
        if (!contentEl) return;

        var userStats = analyticsCache.userStats;

        // If cache is empty, load data first
        if (!userStats || userStats.length === 0) {
            var sb = window.blitzkriegSupabase;
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
            html += '<div class="editor-stat"><span class="editor-stat-value">' + analyticsFormatNumber(user.view_count) + '</span><span class="editor-stat-label">Views</span></div>';
            html += '<div class="editor-stat"><span class="editor-stat-value">' + analyticsFormatNumber(user.favorite_count) + '</span><span class="editor-stat-label">Favs</span></div>';
            html += '<div class="editor-stat"><span class="editor-stat-value">' + analyticsFormatNumber(user.search_count) + '</span><span class="editor-stat-label">Searches</span></div>';
            html += '</div>';
            html += '<div class="editor-activity-bar"><div class="editor-activity-fill" style="width:' + activityPct + '%"></div></div>';
            html += '</div>';
        });
        html += '</div>';

        if (userStats.length === 0) {
            html = '<p class="placeholder-text">No editor activity for this period.</p>';
        }

        contentEl.innerHTML = html;
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
        html += '<div class="editor-detail-meta">' + (editorData ? 'Last active ' + analyticsFormatTimeAgo(editorData.last_active) : 'Loading...') + '</div>';
        html += '</div></div>';

        // KPI Row
        html += '<div class="analytics-stat-cards-row">';
        html += buildStatCard(analyticsFormatNumber(editorData ? editorData.import_count : 0), 'Imports (' + days + 'd)');
        html += buildStatCard(analyticsFormatNumber(editorData ? editorData.view_count : 0), 'Views');
        html += buildStatCard(analyticsFormatNumber(editorData ? editorData.favorite_count : 0), 'Favorites');
        html += buildStatCard(analyticsFormatNumber(editorData ? editorData.search_count : 0), 'Searches');
        html += '</div>';

        // Timeline placeholder
        html += '<div class="analytics-table-section">';
        html += '<h3 class="analytics-table-title">Activity Timeline</h3>';
        html += '<div id="editor-timeline"><div style="text-align:center;padding:20px"><div class="analytics-skeleton" style="width:40px;height:40px;margin:0 auto;border-radius:50%"></div></div></div>';
        html += '</div>';

        contentEl.innerHTML = html;

        // Load timeline
        sb.rpc('get_blitzkrieg_user_activity', {
            p_user_id: analyticsEditorId,
            p_start_date: analyticsStartDate(),
            p_limit: 200,
        }).then(function(res) {
            var timelineEl = document.getElementById('editor-timeline');
            if (timelineEl) {
                timelineEl.innerHTML = buildActivityTimeline(res.data || []);
            }
        }).catch(function(err) {
            var timelineEl = document.getElementById('editor-timeline');
            if (timelineEl) {
                timelineEl.innerHTML = '<p class="placeholder-text">Failed to load activity: ' + escapeHTML(err.message) + '</p>';
            }
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

        // KPI placeholder
        html += '<div class="analytics-stat-cards-row" id="template-kpi-row">';
        html += buildStatCard('...', 'Imports');
        html += buildStatCard('...', 'Views');
        html += buildStatCard('...', 'Favorites');
        html += buildStatCard('...', 'Users');
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
            var totalImports = 0, totalViews = 0, totalFavs = 0;
            users.forEach(function(u) {
                totalImports += Number(u.import_count) || 0;
                totalViews += Number(u.view_count) || 0;
                totalFavs += Number(u.favorite_count) || 0;
            });

            // Update KPI
            var kpiEl = document.getElementById('template-kpi-row');
            if (kpiEl) {
                var kpiHtml = '';
                kpiHtml += buildStatCard(analyticsFormatNumber(totalImports), 'Imports (' + days + 'd)');
                kpiHtml += buildStatCard(analyticsFormatNumber(totalViews), 'Views');
                kpiHtml += buildStatCard(analyticsFormatNumber(totalFavs), 'Favorites');
                kpiHtml += buildStatCard(analyticsFormatNumber(users.length), 'Users');
                kpiEl.innerHTML = kpiHtml;
            }

            // Per-editor table
            var tableEl = document.getElementById('template-users-table');
            if (!tableEl) return;

            if (users.length === 0) {
                tableEl.innerHTML = '<p class="placeholder-text">No editor data for this period.</p>';
                return;
            }

            var tableHtml = '<table class="analytics-table">';
            tableHtml += '<thead><tr><th>Editor</th><th style="text-align:right">Imports</th><th style="text-align:right">Views</th><th style="text-align:right">Favorites</th><th style="text-align:right">Last Used</th></tr></thead>';
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
                tableHtml += '<td style="text-align:right">' + analyticsFormatNumber(u.view_count) + '</td>';
                tableHtml += '<td style="text-align:right">' + analyticsFormatNumber(u.favorite_count) + '</td>';
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
        }
    }

    /* --------- Cloud Thumbnail Generation --------- */

    /**
     * Generate a thumbnail for a single cloud template by downloading its .aep,
     * rendering a frame via ExtendScript, and uploading the PNG back to Supabase.
     * @param {object} comp - The comp object from allComps (needs storagePath, name)
     * @returns {Promise<boolean>} - true if thumbnail was generated and uploaded
     */
    function generateCloudThumbnail(comp) {
        if (!comp || !comp.storagePath) return Promise.reject(new Error('No storage path'));
        if (!csInterface || typeof csInterface.evalScript !== 'function') {
            return Promise.reject(new Error('Requires After Effects'));
        }

        var sb = window.blitzkriegSupabase;
        if (!sb) return Promise.reject(new Error('No Supabase client'));

        return window.cloudLibrary.downloadTemplate(comp.storagePath).then(function(downloaded) {
            return new Promise(function(resolve, reject) {
                // Convert blob to base64
                var reader = new FileReader();
                reader.onerror = function() { reject(new Error('FileReader error')); };
                reader.onload = function() {
                    var base64 = reader.result.split(',')[1];
                    var safeName = escapeForExtendScript(downloaded.fileName);

                    // Write AEP to temp
                    csInterface.evalScript('writeTempFileFromBase64("' + base64 + '", "' + safeName + '")', function(tempPath) {
                        if (!tempPath || tempPath === 'EvalScript error.' || tempPath.indexOf('ERROR') === 0) {
                            reject(new Error('Failed to write temp AEP'));
                            return;
                        }

                        // Generate thumbnail from the temp AEP
                        var safeTemp = escapeForExtendScript(tempPath);
                        csInterface.evalScript('generateThumbnailFromAep("' + safeTemp + '")', function(thumbResult) {
                            // Clean up temp AEP
                            try { csInterface.evalScript('(function(){ var f = new File("' + safeTemp + '"); if(f.exists) f.remove(); return "ok"; })()'); } catch(e) {}

                            try {
                                var parsed = JSON.parse(thumbResult);
                                if (parsed.error) {
                                    reject(new Error(parsed.error));
                                    return;
                                }
                                if (!parsed.thumbnailBase64) {
                                    reject(new Error('No thumbnail data returned'));
                                    return;
                                }

                                // Convert base64 to blob and upload
                                var thumbBlob = base64ToBlob(parsed.thumbnailBase64, 'image/png');
                                var uploadPath = comp.storagePath + '/thumbnail.png';

                                sb.storage.from('blitzkrieg').upload(uploadPath, thumbBlob, {
                                    contentType: 'image/png',
                                    upsert: true,
                                }).then(function(uploadRes) {
                                    if (uploadRes.error) {
                                        reject(new Error('Upload failed: ' + uploadRes.error.message));
                                    } else {
                                        resolve(true);
                                    }
                                }).catch(reject);
                            } catch(e) {
                                reject(new Error('Parse error: ' + e.message));
                            }
                        });
                    });
                };
                reader.readAsDataURL(downloaded.blob);
            });
        });
    }

    /**
     * Admin batch function: generate thumbnails for all cloud templates that are missing them.
     * Processes sequentially to avoid overwhelming AE.
     */
    function generateAllMissingThumbnails() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('Admin access required.', true);
            return;
        }
        if (!csInterface || typeof csInterface.evalScript !== 'function') {
            showToast('Requires After Effects.', true);
            return;
        }

        // Find comps without thumbnails (those with no thumbUrl or blob URL)
        var compsToProcess = allComps.filter(function(c) {
            return !c.thumbUrl || c.thumbUrl === '';
        });

        if (compsToProcess.length === 0) {
            showToast('All templates already have thumbnails!');
            return;
        }

        showToast('Generating thumbnails for ' + compsToProcess.length + ' templates...');
        showSpinner();
        stashInProgress = true;

        var processed = 0;
        var succeeded = 0;
        var failed = 0;

        function processNext() {
            if (processed >= compsToProcess.length) {
                stashInProgress = false;
                hideSpinner();
                showToast('Thumbnails done: ' + succeeded + ' generated, ' + failed + ' failed.');
                loadLibrary(); // Reload to show new thumbnails
                return;
            }

            var comp = compsToProcess[processed];
            showToast('Generating thumbnail ' + (processed + 1) + '/' + compsToProcess.length + ': ' + comp.name);

            generateCloudThumbnail(comp).then(function() {
                succeeded++;
                processed++;
                processNext();
            }).catch(function(err) {
                debugLog('Thumbnail generation failed for ' + comp.name + ': ' + err.message, 'error');
                failed++;
                processed++;
                processNext();
            });
        }

        processNext();
    }

    // Expose for dropdown menu
    window.__blitzkriegGenerateThumbnails = generateAllMissingThumbnails;

    /* --------- Auth-gated initialization --------- */
    // The auth module (auth.js) handles login/access and calls onBlitzkriegAuthReady when access is granted
    window.onBlitzkriegAuthReady = function () {
        masterInit();
        // Track session start
        if (window.blitzkriegAnalytics) {
            window.blitzkriegAnalytics.trackSessionStart();
        }
    };

    // Start auth check on load
    document.addEventListener('DOMContentLoaded', function () {
        // auth.js validateSession() runs and shows login or grants access
        if (window.blitzkriegAuth) {
            window.blitzkriegAuth.validateSession();
        }
    });

    // expose some internals for inline calls (keeps compatibility)
    window.loadLibrary = loadLibrary;

})();
