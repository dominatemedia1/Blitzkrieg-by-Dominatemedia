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
    var dropdownBecomeEditor = document.getElementById('dropdown-become-editor');

    // Settings modal elements
    var settingsModal = document.getElementById('settings-modal');
    var settingsBrowseBtn = document.getElementById('settings-browse-btn');
    var settingsLibraryPath = document.getElementById('settings-library-path');
    var settingsCloseBtn = document.getElementById('settings-close-btn');
    var settingsSaveBtn = document.getElementById('settings-save-btn');

    // Auth modal elements
    var authModal = document.getElementById('auth-modal');
    var authModalTitle = document.getElementById('auth-modal-title');
    var authCloseBtn = document.getElementById('auth-close-btn');

    // Login form
    var loginForm = document.getElementById('login-form');
    var loginEmail = document.getElementById('login-email');
    var loginPassword = document.getElementById('login-password');
    var loginError = document.getElementById('login-error');
    var loginSubmitBtn = document.getElementById('login-submit-btn');

    // Signup form
    var signupForm = document.getElementById('signup-form');
    var signupInvite = document.getElementById('signup-invite');
    var signupEmail = document.getElementById('signup-email');
    var signupPassword = document.getElementById('signup-password');
    var signupConfirm = document.getElementById('signup-confirm');
    var signupError = document.getElementById('signup-error');
    var signupSubmitBtn = document.getElementById('signup-submit-btn');

    // Forgot password form
    var forgotForm = document.getElementById('forgot-form');
    var forgotEmail = document.getElementById('forgot-email');
    var forgotError = document.getElementById('forgot-error');
    var forgotSuccess = document.getElementById('forgot-success');
    var forgotSubmitBtn = document.getElementById('forgot-submit-btn');

    // Auth links
    var showSignupLink = document.getElementById('show-signup-link');
    var showLoginLink = document.getElementById('show-login-link');
    var showForgotLink = document.getElementById('show-forgot-link');
    var backToLoginLink = document.getElementById('back-to-login-link');

    // Sidebar user elements
    var sidebarUser = document.getElementById('sidebar-user');
    var userLoginPrompt = document.getElementById('user-login-prompt');
    var sidebarLoginBtn = document.getElementById('sidebar-login-btn');
    var userProfile = document.getElementById('user-profile');
    var userEmail = document.getElementById('user-email');
    var userBadge = document.getElementById('user-badge');
    var adminPanelBtn = document.getElementById('admin-panel-btn');
    var logoutBtn = document.getElementById('logout-btn');

    // Admin modal elements
    var adminModal = document.getElementById('admin-modal');
    var adminCloseBtn = document.getElementById('admin-close-btn');
    var generateInviteForm = document.getElementById('generate-invite-form');
    var inviteEmailInput = document.getElementById('invite-email');
    var inviteMaxUsesInput = document.getElementById('invite-max-uses');
    var generateInviteBtn = document.getElementById('generate-invite-btn');
    var newInviteResult = document.getElementById('new-invite-result');
    var invitesList = document.getElementById('invites-list');

    var toastTimeout;
    var allComps = [];
    var activeCategory = 'All';
    var currentDeleteInfo = null;
    var currentRenameInfo = null;
    var currentCategoryRenameInfo = null;
    var currentCategoryDeleteInfo = null;
    var currentMoveCompInfo = null;
    var isLoading = false; // Prevents race conditions in async operations
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

        // Initialize sorting and grid size controls
        initSortAndGridControls();

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

        // Initialize auth system
        initAuthSystem();

        // App is freely available - initialize directly
        initializeAppLogic();
    }

    /* --------- Auth System --------- */

    function initAuthSystem() {
        // Check if BlitzkriegAuth is available
        if (typeof BlitzkriegAuth === 'undefined') {
            console.warn('BlitzkriegAuth not loaded');
            return;
        }

        // Listen for auth state changes
        BlitzkriegAuth.onAuthStateChange(function(event, session, user, isAdmin) {
            updateAuthUI(user, isAdmin);
        });

        // Sidebar login button
        if (sidebarLoginBtn) {
            sidebarLoginBtn.addEventListener('click', function() {
                openAuthModal('login');
            });
        }

        // Logout button
        if (logoutBtn) {
            logoutBtn.addEventListener('click', async function() {
                var result = await BlitzkriegAuth.signOut();
                if (result.success) {
                    showToast('Signed out successfully', 'success');
                } else {
                    showToast('Error signing out: ' + result.error, 'error');
                }
            });
        }

        // Admin panel button
        if (adminPanelBtn) {
            adminPanelBtn.addEventListener('click', function() {
                openAdminModal();
            });
        }

        // Auth modal close
        if (authCloseBtn) {
            authCloseBtn.addEventListener('click', closeAuthModal);
        }

        // Click outside modal to close
        if (authModal) {
            authModal.addEventListener('click', function(e) {
                if (e.target === authModal) {
                    closeAuthModal();
                }
            });
        }

        // Form switching links
        if (showSignupLink) {
            showSignupLink.addEventListener('click', function(e) {
                e.preventDefault();
                switchAuthForm('signup');
            });
        }
        if (showLoginLink) {
            showLoginLink.addEventListener('click', function(e) {
                e.preventDefault();
                switchAuthForm('login');
            });
        }
        if (showForgotLink) {
            showForgotLink.addEventListener('click', function(e) {
                e.preventDefault();
                switchAuthForm('forgot');
            });
        }
        if (backToLoginLink) {
            backToLoginLink.addEventListener('click', function(e) {
                e.preventDefault();
                switchAuthForm('login');
            });
        }

        // Login form submit
        if (loginForm) {
            loginForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                await handleLogin();
            });
        }

        // Signup form submit
        if (signupForm) {
            signupForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                await handleSignup();
            });
        }

        // Forgot password form submit
        if (forgotForm) {
            forgotForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                await handleForgotPassword();
            });
        }

        // Admin modal
        if (adminCloseBtn) {
            adminCloseBtn.addEventListener('click', closeAdminModal);
        }
        if (adminModal) {
            adminModal.addEventListener('click', function(e) {
                if (e.target === adminModal) {
                    closeAdminModal();
                }
            });
        }

        // Generate invite form
        if (generateInviteForm) {
            generateInviteForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                await handleGenerateInvite();
            });
        }
    }

    function updateAuthUI(user, isAdmin) {
        if (user) {
            // User is logged in
            if (userLoginPrompt) userLoginPrompt.style.display = 'none';
            if (userProfile) userProfile.style.display = 'flex';
            if (userEmail) userEmail.textContent = user.email || 'Unknown';
            if (userBadge) {
                userBadge.style.display = isAdmin ? 'inline-block' : 'none';
            }
            if (adminPanelBtn) {
                adminPanelBtn.style.display = isAdmin ? 'block' : 'none';
            }
        } else {
            // User is logged out
            if (userLoginPrompt) userLoginPrompt.style.display = 'flex';
            if (userProfile) userProfile.style.display = 'none';
            if (adminPanelBtn) adminPanelBtn.style.display = 'none';
        }
    }

    function openAuthModal(form) {
        if (authModal) {
            authModal.style.display = 'flex';
            switchAuthForm(form || 'login');
        }
    }

    function closeAuthModal() {
        if (authModal) {
            authModal.style.display = 'none';
            clearAuthForms();
        }
    }

    function switchAuthForm(form) {
        // Hide all forms
        if (loginForm) loginForm.style.display = 'none';
        if (signupForm) signupForm.style.display = 'none';
        if (forgotForm) forgotForm.style.display = 'none';

        // Clear errors
        clearAuthErrors();

        // Show selected form
        switch (form) {
            case 'login':
                if (loginForm) loginForm.style.display = 'flex';
                if (authModalTitle) authModalTitle.textContent = 'Sign In';
                break;
            case 'signup':
                if (signupForm) signupForm.style.display = 'flex';
                if (authModalTitle) authModalTitle.textContent = 'Create Account';
                break;
            case 'forgot':
                if (forgotForm) forgotForm.style.display = 'flex';
                if (authModalTitle) authModalTitle.textContent = 'Reset Password';
                break;
        }
    }

    function clearAuthForms() {
        if (loginForm) loginForm.reset();
        if (signupForm) signupForm.reset();
        if (forgotForm) forgotForm.reset();
        clearAuthErrors();
    }

    function clearAuthErrors() {
        if (loginError) { loginError.style.display = 'none'; loginError.textContent = ''; }
        if (signupError) { signupError.style.display = 'none'; signupError.textContent = ''; }
        if (forgotError) { forgotError.style.display = 'none'; forgotError.textContent = ''; }
        if (forgotSuccess) { forgotSuccess.style.display = 'none'; forgotSuccess.textContent = ''; }
    }

    function showAuthError(element, message) {
        if (element) {
            element.textContent = message;
            element.style.display = 'block';
        }
    }

    function setButtonLoading(btn, loading) {
        if (!btn) return;
        var textEl = btn.querySelector('.btn-text');
        var loaderEl = btn.querySelector('.btn-loader');
        if (loading) {
            btn.disabled = true;
            if (textEl) textEl.style.display = 'none';
            if (loaderEl) loaderEl.style.display = 'inline-block';
        } else {
            btn.disabled = false;
            if (textEl) textEl.style.display = 'inline';
            if (loaderEl) loaderEl.style.display = 'none';
        }
    }

    async function handleLogin() {
        if (!BlitzkriegAuth.isConfigured()) {
            showAuthError(loginError, 'Cloud features not configured. Contact admin.');
            return;
        }

        var email = loginEmail ? loginEmail.value.trim() : '';
        var password = loginPassword ? loginPassword.value : '';

        if (!email || !password) {
            showAuthError(loginError, 'Please enter email and password');
            return;
        }

        setButtonLoading(loginSubmitBtn, true);
        clearAuthErrors();

        try {
            var result = await BlitzkriegAuth.signIn(email, password);
            if (result.success) {
                closeAuthModal();
                showToast('Welcome back!', 'success');
            } else {
                showAuthError(loginError, result.error);
            }
        } catch (error) {
            showAuthError(loginError, 'An error occurred. Please try again.');
        } finally {
            setButtonLoading(loginSubmitBtn, false);
        }
    }

    async function handleSignup() {
        if (!BlitzkriegAuth.isConfigured()) {
            showAuthError(signupError, 'Cloud features not configured. Contact admin.');
            return;
        }

        var inviteCode = signupInvite ? signupInvite.value.trim().toUpperCase() : '';
        var email = signupEmail ? signupEmail.value.trim() : '';
        var password = signupPassword ? signupPassword.value : '';
        var confirm = signupConfirm ? signupConfirm.value : '';

        if (!inviteCode) {
            showAuthError(signupError, 'Invite code is required');
            return;
        }
        if (!email || !password) {
            showAuthError(signupError, 'Please enter email and password');
            return;
        }
        if (password.length < 8) {
            showAuthError(signupError, 'Password must be at least 8 characters');
            return;
        }
        if (password !== confirm) {
            showAuthError(signupError, 'Passwords do not match');
            return;
        }

        setButtonLoading(signupSubmitBtn, true);
        clearAuthErrors();

        try {
            var result = await BlitzkriegAuth.signUp(email, password, inviteCode);
            if (result.success) {
                closeAuthModal();
                showToast(result.message || 'Account created! Check your email to verify.', 'success');
            } else {
                showAuthError(signupError, result.error);
            }
        } catch (error) {
            showAuthError(signupError, 'An error occurred. Please try again.');
        } finally {
            setButtonLoading(signupSubmitBtn, false);
        }
    }

    async function handleForgotPassword() {
        if (!BlitzkriegAuth.isConfigured()) {
            showAuthError(forgotError, 'Cloud features not configured. Contact admin.');
            return;
        }

        var email = forgotEmail ? forgotEmail.value.trim() : '';

        if (!email) {
            showAuthError(forgotError, 'Please enter your email');
            return;
        }

        setButtonLoading(forgotSubmitBtn, true);
        clearAuthErrors();

        try {
            var result = await BlitzkriegAuth.resetPassword(email);
            if (result.success) {
                if (forgotSuccess) {
                    forgotSuccess.textContent = result.message || 'Password reset email sent!';
                    forgotSuccess.style.display = 'block';
                }
            } else {
                showAuthError(forgotError, result.error);
            }
        } catch (error) {
            showAuthError(forgotError, 'An error occurred. Please try again.');
        } finally {
            setButtonLoading(forgotSubmitBtn, false);
        }
    }

    /* --------- Admin Panel --------- */

    function openAdminModal() {
        if (adminModal) {
            adminModal.style.display = 'flex';
            loadInvitesList();
        }
    }

    function closeAdminModal() {
        if (adminModal) {
            adminModal.style.display = 'none';
            if (newInviteResult) newInviteResult.style.display = 'none';
        }
    }

    async function handleGenerateInvite() {
        if (!BlitzkriegAuth.isAdmin()) {
            showToast('Admin access required', 'error');
            return;
        }

        var email = inviteEmailInput ? inviteEmailInput.value.trim() : '';
        var maxUses = inviteMaxUsesInput ? parseInt(inviteMaxUsesInput.value, 10) : 1;

        setButtonLoading(generateInviteBtn, true);

        try {
            var result = await BlitzkriegAuth.generateInvite({
                email: email || null,
                maxUses: maxUses || 1
            });

            if (result.success) {
                // Show the generated code
                if (newInviteResult) {
                    var codeDisplay = newInviteResult.querySelector('.invite-code-display');
                    if (codeDisplay) codeDisplay.textContent = result.code;
                    newInviteResult.style.display = 'flex';

                    // Setup copy button
                    var copyBtn = newInviteResult.querySelector('.copy-btn');
                    if (copyBtn) {
                        copyBtn.onclick = function() {
                            copyToClipboard(result.code);
                            showToast('Invite code copied!', 'success');
                        };
                    }
                }

                // Clear form
                if (inviteEmailInput) inviteEmailInput.value = '';
                if (inviteMaxUsesInput) inviteMaxUsesInput.value = '1';

                // Refresh list
                loadInvitesList();
            } else {
                showToast('Error: ' + result.error, 'error');
            }
        } catch (error) {
            showToast('Error generating invite', 'error');
        } finally {
            setButtonLoading(generateInviteBtn, false);
        }
    }

    async function loadInvitesList() {
        if (!invitesList) return;

        invitesList.innerHTML = '<p class="loading-text">Loading invites...</p>';

        try {
            var result = await BlitzkriegAuth.getInvites();
            if (result.success && result.invites) {
                if (result.invites.length === 0) {
                    invitesList.innerHTML = '<p class="loading-text">No invites yet</p>';
                    return;
                }

                invitesList.innerHTML = result.invites.map(function(invite) {
                    var isUsed = invite.use_count >= (invite.max_uses || 1);
                    var usedClass = isUsed ? 'invite-item-used' : '';
                    var statusText = isUsed ? 'Used' : (invite.use_count + '/' + (invite.max_uses || 1) + ' uses');

                    return '<div class="invite-item ' + usedClass + '">' +
                        '<div>' +
                            '<div class="invite-item-code">' + invite.code + '</div>' +
                            '<div class="invite-item-info">' +
                                (invite.email ? 'For: ' + invite.email + ' | ' : '') +
                                statusText +
                            '</div>' +
                        '</div>' +
                        '<div class="invite-item-actions">' +
                            '<button onclick="window.deleteInvite(\'' + invite.id + '\')">Delete</button>' +
                        '</div>' +
                    '</div>';
                }).join('');
            } else {
                invitesList.innerHTML = '<p class="loading-text">Error loading invites</p>';
            }
        } catch (error) {
            invitesList.innerHTML = '<p class="loading-text">Error loading invites</p>';
        }
    }

    // Expose delete function for inline onclick
    window.deleteInvite = async function(inviteId) {
        if (!confirm('Delete this invite?')) return;

        try {
            var result = await BlitzkriegAuth.deleteInvite(inviteId);
            if (result.success) {
                showToast('Invite deleted', 'success');
                loadInvitesList();
            } else {
                showToast('Error: ' + result.error, 'error');
            }
        } catch (error) {
            showToast('Error deleting invite', 'error');
        }
    };

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
        } else {
            // Fallback for older browsers
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

        // Add event listeners for category actions
        var categoryItems = categoryFiltersContainer.querySelectorAll('.nav-item');
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
        // Clear any existing preview animations
        Object.keys(previewAnimations).forEach(function(id) {
            if (previewAnimations[id]) {
                if (previewAnimations[id].stop) previewAnimations[id].stop();
                if (previewAnimations[id].rafId) cancelAnimationFrame(previewAnimations[id].rafId);
            }
        });
        previewAnimations = {};

        var searchTerm = searchInput.value.toLowerCase();
        var filteredComps = sortComps(allComps.filter(function (comp) { return (activeCategory === 'All' || comp.category === activeCategory) && comp.name.toLowerCase().includes(searchTerm); }));
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
            var durationAttr = comp.duration ? ' data-duration="' + comp.duration + '"' : '';
            var previewClass = hasPreview ? ' has-preview' : '';

            // Generate preview button for items without preview
            var generatePreviewBtn = !hasPreview ? '<button class="generate-preview-btn" title="Generate Preview Animation"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Preview</button>' : '';

            // Use lazy loading for thumbnails - data-src instead of src, with loading="lazy"
            var thumbHtml = thumbSrc
                ? '<img data-src="' + safeThumbSrc + '" alt="Thumbnail" class="comp-thumbnail lazy-thumb" loading="lazy">'
                : '<div class="no-preview">No Preview</div>';

            htmlParts.push('<div class="stash-item' + previewClass + '" data-unique-id="' + safeUniqueId + '" data-category="' + safeCategory + '" data-aep-path="' + safeAepPath + '" data-name="' + safeName + '"' + previewDataAttr + durationAttr + ' draggable="true">' +
                '<div class="item-actions">' +
                    '<button class="action-btn move-btn" title="Move to category"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><polyline points="9 14 12 11 15 14"></polyline></svg></button>' +
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

        // MEMORY OPTIMIZED: Lazy load thumbnails using singleton Intersection Observer
        var lazyThumbnails = stashGrid.querySelectorAll('.lazy-thumb');
        var observer = getLazyLoadObserver();

        if (observer) {
            // Use singleton observer - no need to create new one each render
            lazyThumbnails.forEach(function(img) {
                observer.observe(img);
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

        // Add drag and drop event handlers for all stash items
        var allStashItems = stashGrid.querySelectorAll('.stash-item');
        allStashItems.forEach(function(item) {
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
        else if (e.target.closest('.move-btn')) { promptMoveComp(uniqueId, category, name); }
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
                showToast('Imported and opened in timeline!');
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

        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            renameCategoryModal.style.display = 'none';
            currentCategoryRenameInfo = null;
            return;
        }

        renameCategoryModal.style.display = 'none';
        showSpinner();

        var safePath = escapeForExtendScript(libraryPath);
        var safeOldName = escapeForExtendScript(info.category);
        var safeNewName = escapeForExtendScript(newName);

        csInterface.evalScript('renameCategory("' + safePath + '","' + safeOldName + '","' + safeNewName + '")', function (result) {
            hideSpinner();
            currentCategoryRenameInfo = null;
            if (result && result.indexOf('Success') === 0) {
                showToast('Category renamed successfully.');
                // Update active category if it was renamed
                if (activeCategory === info.category) {
                    activeCategory = newName;
                }
                loadLibrary(libraryPath);
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
        var info = currentCategoryDeleteInfo;
        if (!info) return;

        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            deleteCategoryModal.style.display = 'none';
            currentCategoryDeleteInfo = null;
            return;
        }

        deleteCategoryModal.style.display = 'none';
        showSpinner();

        var safePath = escapeForExtendScript(libraryPath);
        var safeCategoryName = escapeForExtendScript(info.category);

        csInterface.evalScript('deleteCategory("' + safePath + '","' + safeCategoryName + '")', function (result) {
            hideSpinner();
            currentCategoryDeleteInfo = null;
            if (result && result.indexOf('Success') === 0) {
                showToast('Category deleted successfully.');
                // Reset active category if it was deleted
                if (activeCategory === info.category) {
                    activeCategory = 'All';
                }
                loadLibrary(libraryPath);
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
        var libraryPath = getLibraryPath();
        if (!isValidPath(libraryPath)) {
            showToast('Invalid library path.', true);
            return;
        }

        showSpinner();

        var safePath = escapeForExtendScript(libraryPath);
        var safeUniqueId = escapeForExtendScript(uniqueId);
        var safeOldCategory = escapeForExtendScript(oldCategory);
        var safeNewCategory = escapeForExtendScript(newCategory);

        csInterface.evalScript('moveCompToCategory("' + safePath + '","' + safeUniqueId + '","' + safeOldCategory + '","' + safeNewCategory + '")', function (result) {
            hideSpinner();
            if (result && result.indexOf('Success') === 0) {
                showToast('"' + compName + '" moved to ' + newCategory + '.');
                loadLibrary(libraryPath);
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
                var libraryPath = getLibraryPath();
                if (libraryPath) {
                    loadLibrary(libraryPath);
                    showToast('Library refreshed.');
                }
            }

            // Ctrl/Cmd + , - open settings
            if ((e.ctrlKey || e.metaKey) && e.key === ',') {
                e.preventDefault();
                openSettings();
            }

            // A - show all templates
            if (e.key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                activeCategory = 'All';
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
        if (authModal) authModal.style.display = 'none';
        if (adminModal) adminModal.style.display = 'none';
    }

    /* --------- Start the app --------- */
    document.addEventListener('DOMContentLoaded', function () {
        masterInit();
    });

    // expose some internals for inline calls (keeps compatibility)
    window.selectLibraryFolder = selectLibraryFolder;
    window.loadLibrary = loadLibrary;

})();
