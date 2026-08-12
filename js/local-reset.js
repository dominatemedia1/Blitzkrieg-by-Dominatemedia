// js/local-reset.js - Local mirror reset orchestration
//
// Holds the ORDER of operations for "delete the local copy" and
// "delete and download everything again". The primitives live in
// local-sync.js (cancel, drain, wipe, per-template reset) and in the
// ExtendScript host; this file only sequences them, so main.js and
// local-sync.js do not grow another few hundred lines each.
//
// Exposed as window.localReset. Loaded AFTER local-sync.js and BEFORE
// main.js, because main.js wires the buttons that call into here.
//
// No Promise.prototype.finally anywhere: CEP 8/9 runs Chromium 57/61.
// Every path uses .then(onOk, onErr) and clears the guard by hand.

(function () {
    'use strict';

    // Ceiling for the drain in step 4. A full-sync worker only notices the
    // cancel at its next step boundary, and one step can be a large download,
    // so this has to outlast a slow file rather than a fast loop.
    var IDLE_TIMEOUT_MS = 60000;

    // localStorage keys main.js owns that describe MIRROR state and go stale
    // the moment the local copy is deleted.
    //
    // Deliberately NOT in this list:
    //   ae_asset_stash_path   - legacy library-path cache. Clearing it makes the
    //                           editor re-pick his folder for no reason.
    //   blitzkrieg_favorites  - preference
    //   blitzkrieg_recent     - preference
    //   blitzkrieg_sort_order - preference
    //   blitzkrieg_grid_size  - preference
    //   blitzkrieg_update_failed - NOT mirror state at all. It is main.js's
    //                           FAILED_RECORD_KEY, the persistent record of a
    //                           broken OTA release: {version, attempts,
    //                           lastError, ts}. After MAX_UPDATE_ATTEMPTS it is
    //                           what STOPS the panel retrying that release every
    //                           30 minutes and shows the "Reinstall manually"
    //                           banner instead. Clearing it re-arms an update
    //                           loop the panel deliberately shut off, on a
    //                           machine whose user just told us something is
    //                           wrong. The user clears it on purpose via "Try
    //                           anyway" or __blitzClearUpdateFailure(), never as
    //                           a side effect of deleting local files.
    // The mirror ledger itself (blitzkrieg_local_sync) is NOT touched here
    // either. local-sync.js is its only legal writer and resetAllLocal rewrites
    // it in place so libraryPath survives.
    //
    // blitzkrieg_version_cache STAYS in the list: dropping it only costs one
    // re-fetch of the version manifest, it does not restart anything.
    var MIRROR_STATE_KEYS = [
        'blitzkrieg_thumb_blacklist',
        'blitzkrieg_thumb_failed',
        'blitzkrieg_preview_zero',
        'blitzkrieg_version_cache'
    ];

    // Single re-entrancy guard for every destructive flow in this file.
    var _running = false;

    /** Log to the in-panel bug log; warn/error also auto-report to the server. */
    function _log(msg, level) {
        level = level || 'info';
        if (typeof window._blitzLog === 'function') {
            window._blitzLog('[reset] ' + msg, level);
        } else if (level === 'error') {
            console.error('[local-reset] ' + msg);
        } else if (level === 'warn') {
            console.warn('[local-reset] ' + msg);
        } else {
            console.log('[local-reset] ' + msg);
        }
        if ((level === 'error' || level === 'warn') && window.blitzkriegAnalytics && window.blitzkriegAnalytics.reportError) {
            window.blitzkriegAnalytics.reportError('[reset] ' + msg, level, { source: 'local-reset' });
        }
    }

    /** Push inline progress text to the caller. Never let its renderer break the flow. */
    function _status(opts, text) {
        if (!opts || typeof opts.onStatus !== 'function') return;
        try {
            opts.onStatus(text);
        } catch (e) {
            _log('onStatus callback threw: ' + (e && e.message || e), 'warn');
        }
    }

    /** Uniform result shape so callers never have to test for missing keys. */
    function _result(ok, removed, remaining, error, aborted) {
        return {
            ok: !!ok,
            removed: removed || 0,
            remaining: remaining || 0,
            error: error || null,
            aborted: !!aborted
        };
    }

    /** Clear the guard and hand the result back. Called on EVERY exit path. */
    function _finish(res) {
        _running = false;
        return res;
    }

    function _errText(e) {
        if (!e) return 'Unknown error';
        return e.message || String(e);
    }

    /**
     * A required local-sync method is missing, which means a load-order or
     * version mismatch. Surface it loudly instead of throwing a TypeError
     * halfway through a delete.
     */
    function _missingMethod(name) {
        var msg = 'Local sync is not available (' + name + ' is missing). Close and reopen the panel, then try again.';
        _log('localSync.' + name + ' is missing - refusing to run the reset', 'error');
        return msg;
    }

    /** Names that must exist on window.localSync before a wipe is safe to start. */
    function _checkLocalSync(names) {
        if (!window.localSync) return _missingMethod('localSync');
        for (var i = 0; i < names.length; i++) {
            if (typeof window.localSync[names[i]] !== 'function') return _missingMethod(names[i]);
        }
        return null;
    }

    /** Drop the mirror-state localStorage keys. One try per key so one bad key does not skip the rest. */
    function _clearMirrorStateKeys() {
        for (var i = 0; i < MIRROR_STATE_KEYS.length; i++) {
            try {
                localStorage.removeItem(MIRROR_STATE_KEYS[i]);
            } catch (e) {
                _log('could not clear ' + MIRROR_STATE_KEYS[i] + ': ' + _errText(e), 'warn');
            }
        }
    }

    /**
     * Clear THIS panel's cloud caches only.
     *
     * Never call cloudLibrary.invalidateCache() here. It calls
     * invalidateManifest(), which deletes the SHARED cloud manifest that every
     * editor in the agency reads as their fast source of truth. Wiping one
     * editor's local folder must not cost everyone else a full re-listing.
     */
    function _clearCloudCaches() {
        if (!window.cloudLibrary || typeof window.cloudLibrary.clearLocalCache !== 'function') {
            _log('cloudLibrary.clearLocalCache unavailable - metadata cache left in place', 'warn');
            return;
        }
        try {
            window.cloudLibrary.clearLocalCache();
        } catch (e) {
            _log('clearLocalCache threw: ' + _errText(e), 'warn');
        }
    }

    /** Read the host wipe result defensively - another module owns its shape. */
    function _num(v) {
        return (typeof v === 'number' && isFinite(v)) ? v : 0;
    }

    /**
     * Invoke a localSync method and ALWAYS come back with a promise.
     *
     * _checkLocalSync proves the name is a function, not that calling it is safe:
     * a shape or load-order mismatch can still throw synchronously. Without this
     * the throw escapes the chain, _finish never runs, _running stays true, and
     * both wipe buttons stay hidden for the rest of the session.
     */
    function _invoke(name, args) {
        try {
            var out = window.localSync[name].apply(window.localSync, args || []);
            return (out && typeof out.then === 'function') ? out : Promise.resolve(out);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /** The host refused the delete outright (no ownership marker, unsafe root). */
    function _isRefusal(res) {
        return !!(res && (res.refused || res.noMarker));
    }

    /**
     * The host could not re-read the folder after deleting. remaining comes back
     * as -1, which means UNKNOWN, never empty - treating it as 0 would report a
     * successful wipe and orphan whatever is still on disk.
     */
    function _isUnreadable(res, remaining) {
        return !!(res && res.unreadable) || remaining < 0;
    }

    /**
     * Turn a delete result into copy the user can act on.
     *
     * Order is the fix for the bug where the panel painted "library not fully
     * emptied": a partial wipe carries BOTH an internal reason string and a real
     * count, and the count is the half the user can do something about, so it
     * wins. The raw string is used only when the host already wrote it for the
     * user (a refusal) or when there is nothing better to say.
     */
    function _deleteMessage(res, remaining, hostErr, what) {
        if (_isRefusal(res) && hostErr) return hostErr;
        if (remaining > 0) {
            return 'Some files could not be deleted (' + remaining + ' left). Quit After Effects, then try again.';
        }
        if (_isUnreadable(res, remaining)) {
            return 'The folder could not be read after deleting, so some files may still be there. Quit After Effects, then try again.';
        }
        return hostErr || (what + ' could not be deleted. Quit After Effects, then try again.');
    }

    /**
     * Call resetAllLocal so the persisted "cancelled" flag ends up where this flow
     * needs it.
     *
     * local-sync owns that flag and takes an options argument to keep or clear it:
     * a bare call keeps whatever cancelFullSync set, an explicit flag clears it.
     * The flag name is written three ways because both shapes of local-sync are in
     * play (an older build ignores the argument entirely and always rewrites
     * fullSync), and an unknown key is inert under either.
     *
     * keepCancelled === true is the safe direction, so it passes NO argument at
     * all and re-asserts the cancel afterwards instead of trusting either shape.
     */
    function _resetAllLocal(keepCancelled) {
        if (keepCancelled) return _invoke('resetAllLocal', []);
        return _invoke('resetAllLocal', [{
            clearCancelled: true,
            preserveCancelled: false,
            keepCancelled: false
        }]);
    }

    /**
     * Put the sync loop back in the cancelled state after a wipe that must NOT
     * auto-redownload. Idempotent: cancelFullSync only writes flags, and the loop
     * is already drained by the time this runs. Needed because an older local-sync
     * rewrites fullSync to {} during the wipe, which drops the cancel the user
     * just asked for and lets the next resume re-download everything.
     */
    function _reassertCancel() {
        try {
            window.localSync.cancelFullSync();
        } catch (e) {
            _log('could not re-assert the sync cancel after the wipe: ' + _errText(e), 'warn');
        }
    }

    /**
     * The blocking wipe sequence. Order is load-bearing: deleting under live
     * writers produces half-written bundles, so nothing touches disk until the
     * sync loop has actually drained.
     *
     * @param {{onStatus?: function(string)}} opts
     * @param {boolean} keepCancelled - true for a plain delete (the user does not
     *        want a download to start again), false when a sync follows.
     * @returns {Promise<{ok:boolean, removed:number, remaining:number, error:?string, aborted:boolean}>}
     */
    function _wipe(opts, keepCancelled) {
        opts = opts || {};

        // 1. Refuse re-entry.
        if (_running) {
            return Promise.resolve(_result(false, 0, 0, 'A local reset is already running. Wait for it to finish.', false));
        }

        var missing = _checkLocalSync(['cancelFullSync', 'awaitIdle', 'resetAllLocal']);
        if (missing) {
            return Promise.resolve(_result(false, 0, 0, missing, false));
        }

        // 2. Set the guard, then talk to the user.
        _running = true;
        _log('local reset started', 'info');
        _status(opts, 'Stopping the current download...');

        return Promise.resolve()
            .then(function () {
                // 3. Ask the sync loop to stop. Synchronous, returns a status object.
                window.localSync.cancelFullSync();
                // 4. Wait for the workers to actually drain.
                return _invoke('awaitIdle', [IDLE_TIMEOUT_MS]);
            })
            .then(function (idle) {
                if (idle === false) {
                    _log('sync did not drain within ' + IDLE_TIMEOUT_MS + 'ms - wipe aborted', 'error');
                    return _finish(_result(false, 0, 0, 'Sync did not stop. Close and reopen the panel, then try again.', true));
                }

                // 5. Disk. Everything below runs only once nothing is writing.
                _status(opts, 'Deleting the local copy...');
                return _resetAllLocal(keepCancelled).then(function (res) {
                    var removed = _num(res && res.removed);
                    var remaining = _num(res && res.remaining);
                    var hostErr = (res && res.error) ? String(res.error) : null;
                    var ok = !!res
                        && !hostErr
                        && remaining === 0
                        && !_isUnreadable(res, remaining)
                        && !(res && res.ok === false);

                    // 6. Mirror-state localStorage keys.
                    _clearMirrorStateKeys();
                    // 7. This panel's cloud caches. Never the shared manifest.
                    _clearCloudCaches();
                    // 8. A delete with no download after it stays cancelled.
                    if (keepCancelled) _reassertCancel();

                    if (ok) {
                        _log('local reset done - removed ' + removed + ' item(s)', 'info');
                        return _finish(_result(true, removed, remaining, null, false));
                    }

                    // The raw reason is for the log. The user gets the sentence that
                    // tells him what to do about it.
                    _log('local reset incomplete - removed ' + removed + ', remaining ' + remaining + (hostErr ? ', host reason ' + hostErr : ''), 'error');
                    return _finish(_result(false, removed, remaining, _deleteMessage(res, remaining, hostErr, 'The local copy'), false));
                }, function (err) {
                    _log('resetAllLocal failed: ' + _errText(err), 'error');
                    if (keepCancelled) _reassertCancel();
                    return _finish(_result(false, 0, 0, _errText(err), false));
                });
            })
            // 9. One trailing handler for the WHOLE chain. Attaching it to the same
            // .then as the success handler could not catch a throw from that
            // handler, which left _running true and hid both wipe buttons for the
            // rest of the session.
            .then(null, function (err) {
                _log('local reset failed: ' + _errText(err), 'error');
                return _finish(_result(false, 0, 0, _errText(err), false));
            });
    }

    /**
     * Delete the local copy and leave the sync stopped. The user asked for the
     * files to be gone, so nothing may start pulling them back down.
     *
     * @param {{onStatus?: function(string)}} opts
     * @returns {Promise<{ok:boolean, removed:number, remaining:number, error:?string, aborted:boolean}>}
     */
    function wipeLocal(opts) {
        return _wipe(opts, true);
    }

    /**
     * Same wipe, then hand control back so the caller can start the sync.
     * Starting it here would put a second copy of the sync-start logic outside
     * main.js, which already owns the version map the queue is built from.
     *
     * Clears the cancelled flag, because a sync is about to start on purpose.
     *
     * @param {{onStatus?: function(string)}} opts
     * @returns {Promise<{ok:boolean, removed:number, remaining:number, error:?string, aborted:boolean}>}
     */
    function wipeAndRedownload(opts) {
        opts = opts || {};
        return _wipe(opts, false).then(function (res) {
            if (res.ok) {
                _status(opts, 'Deleted ' + res.removed + ' item(s). Starting download.');
            }
            return res;
        }).then(null, function (err) {
            _log('wipe and redownload failed after the delete: ' + _errText(err), 'error');
            return _finish(_result(false, 0, 0, _errText(err), false));
        });
    }

    /**
     * Reset ONE template: delete its folder and drop its ledger entry so the
     * next full sync treats it as never downloaded. Small blast radius, so no
     * cancel/drain and no confirm modal.
     *
     * @param {string} storagePath
     * @returns {Promise<{ok:boolean, error:?string}>}
     */
    function resetOne(storagePath) {
        if (!storagePath) {
            return Promise.resolve({ ok: false, error: 'No template given.' });
        }
        if (_running) {
            return Promise.resolve({ ok: false, error: 'A local reset is already running. Wait for it to finish.' });
        }

        var missing = _checkLocalSync(['resetTemplate']);
        if (missing) {
            return Promise.resolve({ ok: false, error: missing });
        }

        _running = true;
        return _invoke('resetTemplate', [storagePath]).then(function (res) {
            var remaining = _num(res && res.remaining);
            var hostErr = (res && res.error) ? String(res.error) : null;
            // remaining is read BEFORE the error string. A partial delete reports
            // both, and the count is the half the user can act on. remaining of -1
            // means the host could not re-read the folder, so it is never empty.
            if (!res || remaining !== 0 || hostErr || _isRefusal(res)) {
                _log('resetTemplate ' + storagePath + ' incomplete - remaining ' + remaining + (hostErr ? ', host reason ' + hostErr : ''), 'error');
                return _finish({ ok: false, error: _deleteMessage(res, remaining, hostErr, 'This template') });
            }
            _log('reset template ' + storagePath, 'info');
            return _finish({ ok: true, error: null });
        }, function (err) {
            _log('resetTemplate ' + storagePath + ' failed: ' + _errText(err), 'error');
            return _finish({ ok: false, error: _errText(err) });
        }).then(null, function (err) {
            // Trailing net for the handlers above, so a throw there can never leave
            // the guard set and both wipe buttons hidden.
            _log('resetOne ' + storagePath + ' failed after the delete: ' + _errText(err), 'error');
            return _finish({ ok: false, error: _errText(err) });
        });
    }

    /** True while any flow in this file is mid-run. Callers use it to disable their buttons. */
    function isRunning() {
        return _running;
    }

    window.localReset = {
        wipeLocal: wipeLocal,
        wipeAndRedownload: wipeAndRedownload,
        resetOne: resetOne,
        isRunning: isRunning
    };
})();
