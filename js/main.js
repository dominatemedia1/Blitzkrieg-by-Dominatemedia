// js/main.js
(function () {
    'use strict';

    var csInterface = new CSInterface();
    
    var GUMROAD_PRODUCT_ID = "xnbp9glJAK2v_8h2S4xUJg=="; 
    var GUMROAD_PRODUCT_URL = "https://kuldeepmp4.gumroad.com/l/compbuddy";

    // License overlay elements
    var licenseOverlay = document.getElementById('license-overlay');
    var licenseInput = document.getElementById('license-key-input');
    var licenseMessage = document.getElementById('license-message');
    var getLicenseLink = document.getElementById('get-license-link');
    var activateBtn = document.getElementById('activate-btn');

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
    var settingsBtn = document.getElementById('settings-btn');

    // Settings modal elements
    var settingsModal = document.getElementById('settings-modal');
    var settingsBrowseBtn = document.getElementById('settings-browse-btn');
    var settingsLibraryPath = document.getElementById('settings-library-path');
    var settingsLicensedDisplay = document.getElementById('settings-licensed-display');
    var resetLicenseBtn = document.getElementById('reset-license-btn');
    var settingsCloseBtn = document.getElementById('settings-close-btn');
    var settingsSaveBtn = document.getElementById('settings-save-btn');

    var toastTimeout;
    var allComps = [];
    var activeCategory = 'All';
    var currentDeleteInfo = null;
    var currentRenameInfo = null;

    /* --------- Utility / UI helpers --------- */
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

    /* --------- License logic (kept your existing behavior; added UI hooks) --------- */
    function masterInit() {
        getLicenseLink.addEventListener('click', function (e) {
            e.preventDefault();
            csInterface.openURLInDefaultBrowser(GUMROAD_PRODUCT_URL);
        });
        creditBtn.addEventListener('click', function (e) {
            e.preventDefault();
            csInterface.openURLInDefaultBrowser('https://www.instagram.com/kuldeep.mp4/');
        });

        // Settings button
        if (settingsBtn) {
            settingsBtn.addEventListener('click', openSettings);
        }

        // Settings modal handlers
        if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettings);
        if (settingsSaveBtn) settingsSaveBtn.addEventListener('click', saveSettings);
        if (settingsBrowseBtn) settingsBrowseBtn.addEventListener('click', function () {
            // open folder selector via hostscript.jsx
            selectLibraryFolderFromUI();
        });
        if (resetLicenseBtn) resetLicenseBtn.addEventListener('click', function () {
            // clear saved license and force license overlay
            window.localStorage.removeItem('compbuddy_license_key');
            window.localStorage.removeItem('compbuddy_local_uses');
            window.sessionStorage.removeItem('compbuddy_session_verified');
            updateSettingsLicenseDisplay();
            showLicenseScreen("License reset. Please activate again.");
        });

        // When clicking activate on license overlay
        activateBtn.addEventListener('click', function () {
            var key = licenseInput.value.trim();
            if (key) {
                verifyLicense(key, false);
            } else {
                showLicenseMessage("Please enter a key.", true);
            }
        });

        // On startup: if session verified -> unlock; else try saved license
        var isSessionVerified = window.sessionStorage.getItem('compbuddy_session_verified');
        if (isSessionVerified) {
            unlockApp();
        } else {
            var savedLicense = window.localStorage.getItem('compbuddy_license_key');
            if (savedLicense) {
                // attempt background verification (keeps old behavior)
                verifyLicense(savedLicense, true);
            } else {
                showLicenseScreen("Please activate your license to begin.");
            }
        }

        // Populate settings license display if saved
        updateSettingsLicenseDisplay();
    }

    function showLicenseMessage(message, isError) { licenseMessage.textContent = message; licenseMessage.style.color = isError ? "var(--danger-color)" : "var(--text-medium)"; }
    function logoutAndClearLicense(message) { window.localStorage.removeItem('compbuddy_license_key'); window.localStorage.removeItem('compbuddy_local_uses'); window.sessionStorage.removeItem('compbuddy_session_verified'); showLicenseScreen(message); }
    function showLicenseScreen(message) { licenseOverlay.style.display = 'flex'; appContainer.classList.add('locked'); if (message) { showLicenseMessage(message, true); } }
    function unlockApp() { licenseOverlay.style.display = 'none'; appContainer.classList.remove('locked'); window.sessionStorage.setItem('compbuddy_session_verified', 'true'); if (!appContainer.dataset.initialized) { initializeAppLogic(); appContainer.dataset.initialized = "true"; } }

    function verifyLicense(key, isBackgroundCheck) {
        showLicenseMessage("Verifying license...", false);
        activateBtn.disabled = true;
        var incrementUses = !isBackgroundCheck;
        fetch('https://api.gumroad.com/v2/licenses/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_id: GUMROAD_PRODUCT_ID,
                license_key: key,
                increment_uses_count: incrementUses
            })
        })
        .then(function (response) {
            if (!response.ok) { throw new Error('Server responded with status: ' + response.status); }
            return response.json();
        })
        .then(function (data) {
            if (data.success === false) { logoutAndClearLicense(data.message || "Invalid license key."); return; }
            var purchase = data.purchase;
            if (purchase.refunded || purchase.disabled || purchase.chargebacked) { logoutAndClearLicense("This license has been refunded or deactivated."); return; }
            if (isBackgroundCheck) {
                var localUses = parseInt(window.localStorage.getItem('compbuddy_local_uses'), 10);
                var apiUses = parseInt(purchase.uses_count, 10);
                if (localUses && apiUses > localUses) { logoutAndClearLicense("This license key has been activated on another device."); return; }
            } else {
                // Auto-save license (keeps existing behavior)
                window.localStorage.setItem('compbuddy_license_key', key);
                window.localStorage.setItem('compbuddy_local_uses', purchase.uses_count);
                showLicenseMessage("Activation successful!", false);
            }
            updateSettingsLicenseDisplay();
            unlockApp();
        })
        .catch(function (error) {
            console.error('License verification error:', error);
            if (isBackgroundCheck && window.localStorage.getItem('compbuddy_license_key')) { unlockApp(); }
            else { logoutAndClearLicense("Network Error. Could not connect to activation server."); }
        })
        .finally(function () { activateBtn.disabled = false; });
    }

    /* --------- Settings modal functions --------- */
    function openSettings() {
        // populate current library path into settings
        var savedPath = window.localStorage.getItem('ae_asset_stash_path') || '';
        settingsLibraryPath.value = savedPath;
        // update license display
        updateSettingsLicenseDisplay();
        settingsModal.style.display = 'flex';
    }
    function closeSettings() {
        settingsModal.style.display = 'none';
    }
    function saveSettings() {
        // Save any changed path (settingsLibraryPath is readonly and only changed via browse)
        var saved = settingsLibraryPath.value;
        if (saved) {
            window.localStorage.setItem('ae_asset_stash_path', saved);
            pathDisplay.textContent = saved;
            pathDisplay.title = saved;
            loadLibrary(saved);
            showToast('Library path saved.');
        }
        settingsModal.style.display = 'none';
    }
    function updateSettingsLicenseDisplay() {
        var savedLicense = window.localStorage.getItem('compbuddy_license_key');
        if (savedLicense) {
            // show masked code like XXXX…last4
            var last4 = savedLicense.slice(-4);
            settingsLicensedDisplay.value = 'XXXX…' + last4;
            licenseInput.value = savedLicense; // populate overlay input so user won't need to retype when shown
        } else {
            settingsLicensedDisplay.value = '';
        }
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
        var savedPath = window.localStorage.getItem('ae_asset_stash_path');
        if (savedPath) {
            pathDisplay.textContent = savedPath;
            pathDisplay.title = savedPath;
            loadLibrary(savedPath);
        }
        // removed main Browse button usage (it was removed from UI). Folder selection available in Settings.
        var addBtn = document.getElementById('add-comp-btn');
        addBtn.addEventListener('click', addSelectedComp);

        searchInput.addEventListener('input', renderCompsGrid);
        categoryFiltersContainer.addEventListener('click', handleCategoryClick);
        stashGrid.addEventListener('click', handleStashGridClick);

        cancelDeleteBtn.addEventListener('click', function () { deleteModal.style.display = 'none'; });
        confirmDeleteBtn.addEventListener('click', executeDelete);

        cancelAddBtn.addEventListener('click', function () { addCompModal.style.display = 'none'; });
        confirmAddBtn.addEventListener('click', executeAddComp);

        cancelRenameBtn.addEventListener('click', function () { renameModal.style.display = 'none'; currentRenameInfo = null; });
        confirmRenameBtn.addEventListener('click', executeRename);

        hideSpinner();
    }

    function loadLibrary(path) {
        showSpinner();
        csInterface.evalScript('getStashedComps("' + path.replace(/\\/g, '\\\\') + '")', function (result) {
            try {
                allComps = (result && result !== '[]') ? JSON.parse(result).sort(function (a, b) { return a.name.localeCompare(b.name); }) : [];
                renderUI();
            } catch (e) {
                console.error("Failed to parse comps data:", e);
                allComps = [];
                showPlaceholder("Error loading library. Check console for details.");
            } finally {
                hideSpinner();
            }
        });
    }

    function renderUI() { renderCategories(); renderCompsGrid(); }

    function renderCategories() {
        var categories = ['All'].concat(Array.from(new Set(allComps.map(function(comp) { return comp.category; }))));
        categoryFiltersContainer.innerHTML = categories.map(function(cat) {
            return '<button class="category-btn ' + (cat === activeCategory ? 'active' : '') + '" data-category="' + cat + '">' + cat + '</button>';
        }).join('');
    }

    function renderCompsGrid() {
        var searchTerm = searchInput.value.toLowerCase();
        var filteredComps = allComps.filter(function (comp) { return (activeCategory === 'All' || comp.category === activeCategory) && comp.name.toLowerCase().includes(searchTerm); });
        if (filteredComps.length === 0) {
            if (allComps.length === 0 && !window.localStorage.getItem('ae_asset_stash_path')) {
                showPlaceholder("Select a library folder to begin.");
            } else {
                showPlaceholder("No comps found. Try a different search or category.");
            }
            return;
        }
        stashGrid.innerHTML = filteredComps.map(function (comp) {
            var thumbSrc = comp.thumbPath ? 'file:///' + comp.thumbPath.replace(/\\/g, '/') : '';
            return `
                <div class="stash-item" data-unique-id="${comp.uniqueId}" data-category="${comp.category}" data-aep-path="${comp.aepPath}" data-name="${comp.name}">
                    <div class="item-actions">
                        <button class="action-btn rename-btn" title="Rename"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>
                        <button class="action-btn delete-btn" title="Delete"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                    </div>
                    <div class="thumbnail"><img src="${thumbSrc}" onerror="this.style.display='none'; this.parentElement.innerHTML += '<div style=\\'color:var(--text-medium); font-size:12px; display:flex; align-items:center; justify-content:center; height:100%;\\'>No Preview</div>';" alt="Thumbnail"></div>
                    <div class="item-info">
                        <p class="item-name" title="${comp.name}">${comp.name}</p>
                        <button class="import-btn"><svg class="icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>Import</span></button>
                    </div>
                </div>`;
        }).join('');
    }

    function showPlaceholder(message) { stashGrid.innerHTML = '<p class="placeholder-text">' + message + '</p>'; }

    function handleCategoryClick(e) { if (e.target.classList.contains('category-btn')) { activeCategory = e.target.dataset.category; renderUI(); } }

    function handleStashGridClick(e) {
        var item = e.target.closest('.stash-item');
        if (!item) return;
        var uniqueId = item.dataset.uniqueId, category = item.dataset.category, aepPath = item.dataset.aepPath, name = item.dataset.name;
        if (e.target.closest('.import-btn')) { importComp(aepPath); }
        else if (e.target.closest('.rename-btn')) { renameComp(uniqueId, category, name); }
        else if (e.target.closest('.delete-btn')) { promptDelete(uniqueId, category, name); }
    }

    /* --------- folder selection + add/rename/delete/import flows (kept original) --------- */
    function selectLibraryFolder() { showSpinner(); csInterface.evalScript('selectLibraryFolder()', function (path) { hideSpinner(); if (path && path !== 'null') { window.localStorage.setItem('ae_asset_stash_path', path); pathDisplay.textContent = path; pathDisplay.title = path; activeCategory = 'All'; searchInput.value = ''; loadLibrary(path); } }); }

    function addSelectedComp() {
        var libraryPath = window.localStorage.getItem('ae_asset_stash_path');
        if (!libraryPath) { showToast('Please select a library folder first.', true); return; }
        var categories = Array.from(new Set(allComps.map(function(c) { return c.category; }))).sort();
        existingCategorySelect.innerHTML = categories.map(function (cat) { return '<option value="' + cat + '">' + cat + '</option>'; }).join('');
        existingCategorySelect.disabled = categories.length === 0;
        if (categories.length === 0) { existingCategorySelect.innerHTML = '<option value="">No categories yet</option>'; }
        newCategoryInput.value = '';
        addCompModal.style.display = 'flex';
    }

    function executeAddComp() {
        var libraryPath = window.localStorage.getItem('ae_asset_stash_path');
        var newCatName = newCategoryInput.value.trim();
        var existingCatName = existingCategorySelect.value;
        var categoryName = newCatName || existingCatName;
        if (!categoryName) { showToast('Please select or create a category.', true); return; }
        addCompModal.style.display = 'none';
        var addBtn = document.getElementById('add-comp-btn');
        addBtn.disabled = true;
        addBtn.querySelector('span').textContent = 'Adding...';
        csInterface.evalScript('stashSelectedComp("' + libraryPath.replace(/\\/g, '\\\\') + '","' + categoryName.replace(/"/g, '\\"') + '")', function (result) {
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
        // tell jsx to delete folder
        var libraryPath = window.localStorage.getItem('ae_asset_stash_path');
        csInterface.evalScript('deleteStashedComp("' + libraryPath.replace(/\\/g, '\\\\') + '","' + info.category.replace(/"/g, '\\"') + '","' + info.uniqueId.replace(/"/g, '\\"') + '")', function (result) {
            deleteModal.style.display = 'none';
            currentDeleteInfo = null;
            if (result && result.indexOf('Success') === 0) {
                showToast(result);
                loadLibrary(window.localStorage.getItem('ae_asset_stash_path'));
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
        if (!newName) { showToast('Please enter a new name.', true); return; }
        renameModal.style.display = 'none';
        currentRenameInfo = null;
        var libraryPath = window.localStorage.getItem('ae_asset_stash_path');
        csInterface.evalScript('renameStashedComp("' + libraryPath.replace(/\\/g, '\\\\') + '","' + info.category.replace(/"/g, '\\"') + '","' + info.uniqueId.replace(/"/g, '\\"') + '","' + newName.replace(/"/g, '\\"') + '")', function (result) {
            if (result && result.indexOf('Success') === 0) {
                showToast(result);
                loadLibrary(libraryPath);
            } else {
                showToast(result || 'Rename failed', true);
            }
        });
    }

    function importComp(aepPath) {
        showSpinner();
        csInterface.evalScript('importComp("' + aepPath.replace(/\\/g, '\\\\') + '")', function (result) {
            hideSpinner();
            if (!result) { showToast('Unexpected error importing.', true); return; }
            if (result.indexOf('Success') === 0) {
                showToast(result);
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
    window.unlockApp = unlockApp;
    window.showLicenseScreen = showLicenseScreen;
    window.selectLibraryFolder = selectLibraryFolder;
    window.loadLibrary = loadLibrary;

})();
