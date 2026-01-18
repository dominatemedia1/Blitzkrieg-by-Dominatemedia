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

    var creditBtn = document.getElementById('credit-button');
    var toastElement = document.getElementById('toast-notification');

    // Dropdown menu elements
    var dropdownContainer = document.getElementById('main-dropdown');
    var dropdownToggleBtn = document.getElementById('dropdown-toggle-btn');
    var dropdownMenu = document.getElementById('dropdown-menu');
    var dropdownRefresh = document.getElementById('dropdown-refresh');
    var dropdownSettings = document.getElementById('dropdown-settings');
    var dropdownBecomeEditor = document.getElementById('dropdown-become-editor');

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
    var isLoading = false; // Prevents race conditions in async operations
    var cachedLibraryPath = null; // In-memory cache for library path

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
        creditBtn.addEventListener('click', function (e) {
            e.preventDefault();
            csInterface.openURLInDefaultBrowser('https://dominatemedia.io');
        });

        // Initialize dropdown menu
        initDropdownMenu();

        // Settings modal handlers
        if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);
        if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', saveSettings);
        if (settingsBrowseBtn) settingsBrowseBtn.addEventListener('click', function () {
            // open folder selector via hostscript.jsx
            selectLibraryFolderFromUI();
        });

        // Auto-refresh library when panel gains focus (ensures categories stay in sync)
        window.addEventListener('focus', function() {
            var libraryPath = getLibraryPath();
            if (libraryPath && !isLoading) {
                loadLibrary(libraryPath);
            }
        });

        // App is freely available - initialize directly
        initializeAppLogic();
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
                var libraryPath = getLibraryPath();
                if (libraryPath) {
                    loadLibrary(libraryPath);
                    showToast('Library refreshed.');
                } else {
                    showToast('Please select a library folder first.', true);
                }
            });
        }

        // Settings action
        if (dropdownSettings) {
            dropdownSettings.addEventListener('click', function(e) {
                e.preventDefault();
                dropdownContainer.classList.remove('open');
                openSettings();
            });
        }

        // Become an Editor action - opens external URL
        if (dropdownBecomeEditor) {
            dropdownBecomeEditor.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                dropdownContainer.classList.remove('open');
                var editorUrl = 'https://www.dominatemedia.io/apply-to-join-our-team';
                try {
                    if (csInterface && typeof csInterface.openURLInDefaultBrowser === 'function') {
                        csInterface.openURLInDefaultBrowser(editorUrl);
                    } else {
                        // Fallback for environments where csInterface isn't available
                        window.open(editorUrl, '_blank');
                    }
                } catch (err) {
                    console.error('Blitzkrieg: Failed to open URL', err);
                    window.open(editorUrl, '_blank');
                }
            });
        } else {
            console.warn('Blitzkrieg: dropdown-become-editor element not found');
        }
    }

    /* --------- Settings modal functions --------- */
    function openSettings() {
        // populate current library path into settings
        var savedPath = getLibraryPath() || '';
        settingsLibraryPath.value = savedPath;
        settingsModal.style.display = 'flex';
    }

    function closeSettings() {
        settingsModal.style.display = 'none';
    }

    function saveSettings() {
        // Save any changed path (settingsLibraryPath is readonly and only changed via browse)
        var saved = settingsLibraryPath.value;
        if (saved) {
            // Save to persistent file storage (fixes restart bug)
            savePersistentSettings({ libraryPath: saved }, function(success) {
                if (!success) {
                    console.warn('Blitzkrieg: Could not save settings to file');
                }
            });
            pathDisplay.textContent = saved;
            pathDisplay.title = saved;
            loadLibrary(saved);
            showToast('Library path saved.');
        }
        settingsModal.style.display = 'none';
    }

    function selectLibraryFolderFromUI() {
        // Use hostscript.jsx selectLibraryFolder() to pick folder
        showSpinner();
        csInterface.evalScript('selectLibraryFolder()', function (path) {
            hideSpinner();
            if (path && path !== 'null') {
                settingsLibraryPath.value = path;
                // do not auto-close settings - allow Save to commit
            }
        });
    }

    /* --------- App initialization & core UI logic (kept original behavior) --------- */
    function initializeAppLogic() {
        // Load settings from persistent file storage (fixes categories not showing after restart)
        loadPersistentSettings(function(settings) {
            var savedPath = settings.libraryPath;
            if (savedPath) {
                cachedLibraryPath = savedPath;
                pathDisplay.textContent = savedPath;
                pathDisplay.title = savedPath;
                loadLibrary(savedPath);
            }
        });

        // removed main Browse button usage (it was removed from UI). Folder selection available in Settings.
        var addBtn = document.getElementById('add-comp-btn');
        addBtn.addEventListener('click', addSelectedComp);

        searchInput.addEventListener('input', debouncedRenderComps);
        categoryFiltersContainer.addEventListener('click', handleCategoryClick);
        stashGrid.addEventListener('click', handleStashGridClick);

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

        hideSpinner();
    }

    function loadLibrary(path) {
        if (!isValidPath(path)) {
            showToast('Invalid library path.', true);
            return;
        }
        // Prevent concurrent library loads (race condition fix)
        if (isLoading) {
            console.log("Blitzkrieg: Library load already in progress, skipping...");
            return;
        }
        isLoading = true;
        showSpinner();
        var safePath = escapeForExtendScript(path);
        csInterface.evalScript('getStashedComps("' + safePath + '")', function (result) {
            try {
                allComps = (result && result !== '[]') ? JSON.parse(result).sort(function (a, b) { return a.name.localeCompare(b.name); }) : [];
                renderUI();
            } catch (e) {
                console.error("Failed to parse comps data:", e);
                allComps = [];
                showPlaceholder("Error loading library. Check console for details.");
            } finally {
                isLoading = false;
                hideSpinner();
            }
        });
    }

    function renderUI() { renderCategories(); renderCompsGrid(); }

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

        // Render categories in the sidebar
        categoryFiltersContainer.innerHTML = categories.map(function(cat) {
            var safeCat = escapeHTML(cat);
            var count = allComps.filter(function(c) { return c.category === cat; }).length;
            var isActive = cat === activeCategory;
            return '<div class="nav-item' + (isActive ? ' active' : '') + '" data-category="' + safeCat + '">' +
                '<svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>' +
                '</svg>' +
                '<span class="nav-label">' + safeCat + '</span>' +
                '<span class="nav-count">' + count + '</span>' +
            '</div>';
        }).join('');
    }

    // Preview animation state - optimized with requestAnimationFrame
    var previewAnimations = {};
    var PREVIEW_FRAME_INTERVAL = 83; // ~12 FPS (faster preview)

    /**
     * OPTIMIZED: Starts playing preview animation on hover
     * Uses requestAnimationFrame for smoother animations and better CPU usage
     * @param {HTMLElement} thumbnailContainer - The thumbnail container element
     * @param {Array} previewFrames - Array of preview frame paths
     * @param {string} uniqueId - Unique identifier for this comp
     */
    function startPreviewAnimation(thumbnailContainer, previewFrames, uniqueId) {
        if (!previewFrames || previewFrames.length === 0) return;

        var img = thumbnailContainer.querySelector('.comp-thumbnail');
        if (!img) return;

        // Stop any existing animation for this item
        if (previewAnimations[uniqueId]) {
            stopPreviewAnimation(thumbnailContainer, uniqueId);
        }

        var frameIndex = 0;
        var originalSrc = img.src;
        var lastFrameTime = 0;
        var isRunning = true;

        // Store original src for restoration
        img.dataset.originalSrc = originalSrc;

        // Pre-convert frame paths for faster access
        var frameSrcs = previewFrames.map(function(path) {
            return 'file:///' + path.replace(/\\/g, '/').replace(/"/g, '%22');
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

        // Animation loop using requestAnimationFrame
        function animate(timestamp) {
            if (!isRunning) return;

            if (timestamp - lastFrameTime >= PREVIEW_FRAME_INTERVAL) {
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
        // Clear any existing preview animations
        Object.keys(previewAnimations).forEach(function(id) {
            if (previewAnimations[id]) {
                if (previewAnimations[id].stop) previewAnimations[id].stop();
                if (previewAnimations[id].rafId) cancelAnimationFrame(previewAnimations[id].rafId);
            }
        });
        previewAnimations = {};

        var searchTerm = searchInput.value.toLowerCase();
        var filteredComps = allComps.filter(function (comp) { return (activeCategory === 'All' || comp.category === activeCategory) && comp.name.toLowerCase().includes(searchTerm); });
        if (filteredComps.length === 0) {
            if (allComps.length === 0 && !getLibraryPath()) {
                showPlaceholder("Select a library folder to begin.");
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
            var safeAepPath = escapeHTML(comp.aepPath);
            var safeName = escapeHTML(comp.name);
            var thumbSrc = comp.thumbPath ? 'file:///' + comp.thumbPath.replace(/\\/g, '/').replace(/"/g, '%22') : '';
            var safeThumbSrc = escapeHTML(thumbSrc);

            // Prepare preview frames data attribute (JSON encoded)
            var hasPreview = comp.previewFrames && comp.previewFrames.length > 0;
            var previewDataAttr = hasPreview ? ' data-preview-frames="' + escapeHTML(JSON.stringify(comp.previewFrames)) + '"' : '';
            var previewClass = hasPreview ? ' has-preview' : '';

            // Generate preview button for items without preview
            var generatePreviewBtn = !hasPreview ? '<button class="generate-preview-btn" title="Generate Preview Animation"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Preview</button>' : '';

            // Use lazy loading for thumbnails - data-src instead of src, with loading="lazy"
            var thumbHtml = thumbSrc
                ? '<img data-src="' + safeThumbSrc + '" alt="Thumbnail" class="comp-thumbnail lazy-thumb" loading="lazy">'
                : '<div class="no-preview">No Preview</div>';

            htmlParts.push('<div class="stash-item' + previewClass + '" data-unique-id="' + safeUniqueId + '" data-category="' + safeCategory + '" data-aep-path="' + safeAepPath + '" data-name="' + safeName + '"' + previewDataAttr + '>' +
                '<div class="item-actions">' +
                    '<button class="action-btn rename-btn" title="Rename"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>' +
                    '<button class="action-btn delete-btn" title="Delete"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>' +
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

        // Lazy load thumbnails using Intersection Observer for better performance
        var lazyThumbnails = stashGrid.querySelectorAll('.lazy-thumb');
        if ('IntersectionObserver' in window) {
            var lazyObserver = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting) {
                        var img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            img.classList.remove('lazy-thumb');
                            lazyObserver.unobserve(img);
                        }
                    }
                });
            }, {
                rootMargin: '100px', // Start loading 100px before visible
                threshold: 0.01
            });

            lazyThumbnails.forEach(function(img) {
                lazyObserver.observe(img);
                // Handle load errors
                img.onerror = function() {
                    this.style.display = 'none';
                    var noPreview = document.createElement('div');
                    noPreview.className = 'no-preview';
                    noPreview.textContent = 'No Preview';
                    this.parentElement.appendChild(noPreview);
                };
            });
        } else {
            // Fallback for browsers without IntersectionObserver - load all immediately
            lazyThumbnails.forEach(function(img) {
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.classList.remove('lazy-thumb');
                }
                img.onerror = function() {
                    this.style.display = 'none';
                    var noPreview = document.createElement('div');
                    noPreview.className = 'no-preview';
                    noPreview.textContent = 'No Preview';
                    this.parentElement.appendChild(noPreview);
                };
            });
        }

        // Add hover event listeners for preview animation
        var stashItems = stashGrid.querySelectorAll('.stash-item.has-preview');
        stashItems.forEach(function(item) {
            var thumbnailContainer = item.querySelector('.thumbnail');
            var uniqueId = item.dataset.uniqueId;
            var previewFramesJson = item.dataset.previewFrames;

            if (thumbnailContainer && previewFramesJson) {
                try {
                    var previewFrames = JSON.parse(previewFramesJson);
                    if (previewFrames && previewFrames.length > 0) {
                        // Mouse enter - start preview
                        item.addEventListener('mouseenter', function() {
                            startPreviewAnimation(thumbnailContainer, previewFrames, uniqueId);
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
    }

    function showPlaceholder(message) { stashGrid.innerHTML = '<p class="placeholder-text">' + message + '</p>'; }

    function handleCategoryClick(e) {
        // Handle clicks on sidebar nav items (including the label or icon inside)
        var navItem = e.target.closest('.nav-item');
        if (navItem && navItem.dataset.category) {
            activeCategory = navItem.dataset.category;
            renderUI();
        }
    }

    function handleStashGridClick(e) {
        var item = e.target.closest('.stash-item');
        if (!item) return;
        var uniqueId = item.dataset.uniqueId, category = item.dataset.category, aepPath = item.dataset.aepPath, name = item.dataset.name;
        if (e.target.closest('.import-btn')) { importComp(aepPath); }
        else if (e.target.closest('.rename-btn')) { renameComp(uniqueId, category, name); }
        else if (e.target.closest('.delete-btn')) { promptDelete(uniqueId, category, name); }
        else if (e.target.closest('.generate-preview-btn')) { generatePreview(aepPath, name); }
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
        csInterface.evalScript('generatePreviewFrames("' + safePath + '")', function(result) {
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
                    loadLibrary(libraryPath);
                }
            } else {
                showToast(result, true);
            }
        });
    }

    /* --------- folder selection + add/rename/delete/import flows (kept original) --------- */
    function selectLibraryFolder() { showSpinner(); csInterface.evalScript('selectLibraryFolder()', function (path) { hideSpinner(); if (path && path !== 'null') { savePersistentSettings({ libraryPath: path }); pathDisplay.textContent = path; pathDisplay.title = path; activeCategory = 'All'; searchInput.value = ''; loadLibrary(path); } }); }

    function addSelectedComp() {
        var libraryPath = getLibraryPath();
        if (!libraryPath) { showToast('Please select a library folder first.', true); return; }
        var categories = Array.from(new Set(allComps.map(function(c) { return c.category; }))).sort();
        existingCategorySelect.innerHTML = categories.map(function (cat) { return '<option value="' + cat + '">' + cat + '</option>'; }).join('');
        existingCategorySelect.disabled = categories.length === 0;
        if (categories.length === 0) { existingCategorySelect.innerHTML = '<option value="">No categories yet</option>'; }
        newCategoryInput.value = '';
        addCompModal.style.display = 'flex';
    }

    function executeAddComp() {
        var libraryPath = getLibraryPath();
        var newCatName = newCategoryInput.value.trim();
        var existingCatName = existingCategorySelect.value;
        var categoryName = newCatName || existingCatName;

        if (!categoryName) {
            showToast('Please select or create a category.', true);
            return;
        }
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path. Please select a folder first.', true);
            return;
        }
        // Validate category name (prevent path traversal)
        if (categoryName.indexOf('/') !== -1 || categoryName.indexOf('\\') !== -1 || categoryName.indexOf('..') !== -1) {
            showToast('Category name cannot contain path separators.', true);
            return;
        }

        addCompModal.style.display = 'none';
        var addBtn = document.getElementById('add-comp-btn');
        addBtn.disabled = true;
        addBtn.querySelector('span').textContent = 'Adding...';

        var safePath = escapeForExtendScript(libraryPath);
        var safeCategory = escapeForExtendScript(categoryName);

        csInterface.evalScript('stashSelectedComp("' + safePath + '","' + safeCategory + '")', function (result) {
            addBtn.disabled = false;
            addBtn.querySelector('span').textContent = 'Add Selected Comp';
            if (!result) { showToast('Unexpected error.', true); return; }
            if (result.indexOf('Success') === 0) {
                showToast(result);
                // reload library
                loadLibrary(libraryPath);
            } else {
                showToast(result, true);
            }
        });
    }

    function promptDelete(uniqueId, category, name) {
        currentDeleteInfo = { uniqueId: uniqueId, category: category };
        compToDeleteName.textContent = name;
        deleteModal.style.display = 'flex';
    }

    function executeDelete() {
        var info = currentDeleteInfo;
        if (!info) return;

        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            deleteModal.style.display = 'none';
            currentDeleteInfo = null;
            return;
        }

        var safePath = escapeForExtendScript(libraryPath);
        var safeCategory = escapeForExtendScript(info.category);
        var safeUniqueId = escapeForExtendScript(info.uniqueId);

        csInterface.evalScript('deleteStashedComp("' + safePath + '","' + safeCategory + '","' + safeUniqueId + '")', function (result) {
            deleteModal.style.display = 'none';
            currentDeleteInfo = null;
            if (result && result.indexOf('Success') === 0) {
                showToast('Deleted successfully.');
                loadLibrary(libraryPath);
            } else {
                showToast(result || 'Failed to delete.', true);
            }
        });
    }

    function renameComp(uniqueId, category, currentName) {
        currentRenameInfo = { uniqueId: uniqueId, category: category };
        compToRenameCurrentName.textContent = currentName;
        newNameInput.value = currentName;
        renameModal.style.display = 'flex';
    }

    function executeRename() {
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

        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            renameModal.style.display = 'none';
            currentRenameInfo = null;
            return;
        }

        renameModal.style.display = 'none';
        currentRenameInfo = null;

        var safePath = escapeForExtendScript(libraryPath);
        var safeCategory = escapeForExtendScript(info.category);
        var safeUniqueId = escapeForExtendScript(info.uniqueId);
        var safeNewName = escapeForExtendScript(newName);

        csInterface.evalScript('renameStashedComp("' + safePath + '","' + safeCategory + '","' + safeUniqueId + '","' + safeNewName + '")', function (result) {
            if (result && result.indexOf('Success') === 0) {
                showToast('Renamed successfully.');
                loadLibrary(libraryPath);
            } else {
                showToast(result || 'Rename failed', true);
            }
        });
    }

    function importComp(aepPath) {
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
                showToast('Imported successfully.');
            } else {
                showToast(result, true);
            }
        });
    }

    /* --------- Start the app --------- */
    document.addEventListener('DOMContentLoaded', function () {
        masterInit();
    });

    // expose some internals for inline calls (keeps compatibility)
    window.selectLibraryFolder = selectLibraryFolder;
    window.loadLibrary = loadLibrary;

})();
