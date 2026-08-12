// jsx/hostscript.jsx

/**
 * ============================================================================
 * JSON POLYFILL FOR EXTENDSCRIPT COMPATIBILITY
 * ============================================================================
 * ExtendScript (used in After Effects) does not have reliable native JSON
 * support across all versions. Some AE versions on macOS have a broken native
 * JSON.stringify that drops all keys and values. This polyfill ALWAYS replaces
 * the native JSON to ensure correct behavior in AE 2024, AE 2025, and beyond.
 *
 * Based on Douglas Crockford's JSON2 (Public Domain)
 * ============================================================================
 */
// Always create a fresh JSON object. Some AE versions on macOS have a native
// JSON whose stringify/parse are broken (output like [{: ,: }] with no keys/values).
// By replacing the whole object we guarantee the polyfill methods are used.
JSON = {};

(function() {
    'use strict';

    var rx_one = /^[\],:{}\s]*$/;
    var rx_two = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g;
    var rx_three = /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g;
    var rx_four = /(?:^|:|,)(?:\s*\[)+/g;
    var rx_escapable = /[\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
    var rx_dangerous = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;

    var gap;
    var indent;
    var meta;
    var rep;

    function f(n) {
        return n < 10 ? '0' + n : n;
    }

    function this_value() {
        return this.valueOf();
    }

    if (typeof Date.prototype.toJSON !== 'function') {
        Date.prototype.toJSON = function() {
            return isFinite(this.valueOf())
                ? this.getUTCFullYear() + '-' +
                    f(this.getUTCMonth() + 1) + '-' +
                    f(this.getUTCDate()) + 'T' +
                    f(this.getUTCHours()) + ':' +
                    f(this.getUTCMinutes()) + ':' +
                    f(this.getUTCSeconds()) + 'Z'
                : null;
        };
        Boolean.prototype.toJSON = this_value;
        Number.prototype.toJSON = this_value;
        String.prototype.toJSON = this_value;
    }

    function quote(string) {
        rx_escapable.lastIndex = 0;
        return rx_escapable.test(string)
            ? '"' + string.replace(rx_escapable, function(a) {
                var c = meta[a];
                return typeof c === 'string'
                    ? c
                    : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
            }) + '"'
            : '"' + string + '"';
    }

    function str(key, holder) {
        var i;
        var k;
        var v;
        var length;
        var mind = gap;
        var partial;
        var value = holder[key];

        if (value && typeof value === 'object' && typeof value.toJSON === 'function') {
            value = value.toJSON(key);
        }

        if (typeof rep === 'function') {
            value = rep.call(holder, key, value);
        }

        switch (typeof value) {
            case 'string':
                return quote(value);
            case 'number':
                return isFinite(value) ? String(value) : 'null';
            case 'boolean':
            case 'null':
                return String(value);
            case 'object':
                if (!value) {
                    return 'null';
                }
                gap += indent;
                partial = [];
                if (Object.prototype.toString.apply(value) === '[object Array]') {
                    length = value.length;
                    for (i = 0; i < length; i += 1) {
                        partial[i] = str(i, value) || 'null';
                    }
                    v = partial.length === 0
                        ? '[]'
                        : gap
                            ? '[\n' + gap + partial.join(',\n' + gap) + '\n' + mind + ']'
                            : '[' + partial.join(',') + ']';
                    gap = mind;
                    return v;
                }
                if (rep && typeof rep === 'object') {
                    length = rep.length;
                    for (i = 0; i < length; i += 1) {
                        if (typeof rep[i] === 'string') {
                            k = rep[i];
                            v = str(k, value);
                            if (v) {
                                partial.push(quote(k) + (gap ? ': ' : ':') + v);
                            }
                        }
                    }
                } else {
                    for (k in value) {
                        if (Object.prototype.hasOwnProperty.call(value, k)) {
                            v = str(k, value);
                            if (v) {
                                partial.push(quote(k) + (gap ? ': ' : ':') + v);
                            }
                        }
                    }
                }
                v = partial.length === 0
                    ? '{}'
                    : gap
                        ? '{\n' + gap + partial.join(',\n' + gap) + '\n' + mind + '}'
                        : '{' + partial.join(',') + '}';
                gap = mind;
                return v;
        }
    }

    meta = {
        '\b': '\\b',
        '\t': '\\t',
        '\n': '\\n',
        '\f': '\\f',
        '\r': '\\r',
        '"': '\\"',
        '\\': '\\\\'
    };

    // Always install polyfill – never trust the native implementation.
    // AE 2025 on macOS ships a native JSON.stringify that drops all keys
    // and values, producing output like [{: ,: }] instead of valid JSON.
    JSON.stringify = function(value, replacer, space) {
        var i;
        gap = '';
        indent = '';

        if (typeof space === 'number') {
            for (i = 0; i < space; i += 1) {
                indent += ' ';
            }
        } else if (typeof space === 'string') {
            indent = space;
        }

        rep = replacer;
        if (replacer && typeof replacer !== 'function' &&
            (typeof replacer !== 'object' || typeof replacer.length !== 'number')) {
            throw new Error('JSON.stringify');
        }

        return str('', {'': value});
    };

    JSON.parse = function(text, reviver) {
        var j;

        function walk(holder, key) {
            var k;
            var v;
            var value = holder[key];
            if (value && typeof value === 'object') {
                for (k in value) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        v = walk(value, k);
                        if (v !== undefined) {
                            value[k] = v;
                        } else {
                            delete value[k];
                        }
                    }
                }
            }
            return reviver.call(holder, key, value);
        }

        text = String(text);
        rx_dangerous.lastIndex = 0;
        if (rx_dangerous.test(text)) {
            text = text.replace(rx_dangerous, function(a) {
                return '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
            });
        }

        if (rx_one.test(
            text.replace(rx_two, '@')
                .replace(rx_three, ']')
                .replace(rx_four, ''))) {
            j = eval('(' + text + ')');
            return (typeof reviver === 'function')
                ? walk({'': j}, '')
                : j;
        }

        throw new SyntaxError('JSON.parse');
    };
}());

// Self-test: verify polyfill produces valid JSON. Logs failure but does NOT
// throw — a thrown error here halts the entire hostscript.jsx top-level eval,
// which leaves EVERY function (getStashedComps, generatePreviewFrames,
// debugLibrary, etc.) undefined. Result: panel loads but nothing works,
// debug button shows blank, generate is dead. Silent metadata corruption is
// bad; total panel breakage is worse. Stash a flag so callers can probe.
$.global.__blitzJsonPolyfillOk = true;
$.global.__blitzJsonPolyfillStatus = 'ok';
(function() {
    try {
        var _t = JSON.stringify({"a": "b", "n": 1, "x": null});
        if (_t.indexOf('"a"') === -1) {
            $.global.__blitzJsonPolyfillOk = false;
            $.global.__blitzJsonPolyfillStatus = 'self-test-failed: ' + _t;
            $.writeln("Blitzkrieg: WARN - JSON.stringify polyfill self-test produced unexpected output: " + _t);
        }
    } catch (e) {
        $.global.__blitzJsonPolyfillOk = false;
        $.global.__blitzJsonPolyfillStatus = 'threw: ' + e.toString();
        $.writeln("Blitzkrieg: WARN - JSON.stringify self-test threw: " + e.toString());
    }
}());

/**
 * ============================================================================
 * AFTER EFFECTS VERSION DETECTION AND COMPATIBILITY
 * ============================================================================
 */
// Monotonically increasing counter for import operations. Baked into
// scheduleTask scripts so stale tasks (from a prior import) no-op when
// they fire and find the counter has moved on.
var _blitzImportGeneration = 0;

var AE_VERSION_INFO = (function() {
    var info = {
        version: 0,
        majorVersion: 0,
        minorVersion: 0,
        isAE2024: false,
        isAE2025: false,
        isAE2025OrLater: false,
        versionString: ''
    };

    try {
        if (app && app.version) {
            info.versionString = app.version;
            var parts = app.version.split('.');
            info.majorVersion = parseInt(parts[0], 10) || 0;
            info.minorVersion = parseInt(parts[1], 10) || 0;
            info.version = info.majorVersion + (info.minorVersion / 100);

            // AE 2024 = version 24.x
            // AE 2025 = version 25.x
            info.isAE2024 = (info.majorVersion === 24);
            info.isAE2025 = (info.majorVersion === 25);
            info.isAE2025OrLater = (info.majorVersion >= 25);
        }
    } catch (e) {
        $.writeln("Blitzkrieg: Could not detect AE version: " + e.toString());
    }

    return info;
})();

/**
 * Returns After Effects version information
 * @returns {string} - JSON string with version info
 */
function getAEVersionInfo() {
    return JSON.stringify(AE_VERSION_INFO);
}

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Validates a file/folder path for basic security.
 * @param {string} path - Path to validate
 * @returns {boolean} - True if path is valid
 */
function isValidPath(path) {
    if (!path || typeof path !== 'string') return false;
    // Check for null bytes (could be used for injection)
    if (path.indexOf('\0') !== -1) return false;
    // Reasonable length check
    if (path.length > 1000) return false;
    // Block parent-directory traversal. We match '..' only as a path segment
    // (surrounded by separators or at start/end), so names like "my..file" are still OK.
    if (/(^|[\\\/])\.\.([\\\/]|$)/.test(path)) return false;
    // Block URL-encoded traversal
    if (/(%2e%2e|%2E%2E)/.test(path)) return false;
    return true;
}

/**
 * Validates a name for file system safety (no path separators).
 * @param {string} name - Name to validate
 * @returns {boolean} - True if name is safe
 */
function isValidName(name) {
    if (!name || typeof name !== 'string') return false;
    // Prevent path traversal
    if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) return false;
    if (name.indexOf('..') !== -1) return false;
    // Prevent null bytes
    if (name.indexOf('\0') !== -1) return false;
    // Reasonable length
    if (name.length > 255) return false;
    // Block URL-encoded path separators
    if (/%2[fF]/.test(name) || /%5[cC]/.test(name)) return false;
    // Block leading/trailing dots and whitespace (matches JS validateName)
    if (name !== name.replace(/^\s+|\s+$/g, '')) return false;
    if (name.charAt(0) === '.' || name.charAt(name.length - 1) === '.') return false;
    return true;
}

/**
 * Normalizes a file system path for use with ExtendScript File/Folder constructors.
 * On macOS, .fsName returns POSIX paths (e.g., /Users/name/Library/Application Support)
 * with literal special characters. ExtendScript interprets /-prefixed paths as URI paths,
 * so characters with special URI meaning (space, #, ?) must be percent-encoded.
 *
 * IMPORTANT: We deliberately do NOT use encodeURIComponent() here because:
 * 1. It produces UTF-8 percent-encoding for non-ASCII characters (e.g., é → %C3%A9)
 *    which ExtendScript may not properly decode back to UTF-16
 * 2. It encodes characters like @, $, +, =, :, ; which are valid in URI paths
 *    and would confuse ExtendScript's URI parser
 * 3. Non-ASCII characters (accented letters, CJK, etc.) work fine when passed
 *    directly to new Folder()/new File() in ExtendScript
 *
 * We only encode the three characters that have special meaning in URIs
 * and commonly appear in macOS file paths:
 * - Space → %20 (common in "Application Support", user folder names, etc.)
 * - # → %23 (would be interpreted as fragment separator)
 * - ? → %3F (would be interpreted as query string start)
 *
 * Windows paths (starting with drive letter like C:\) are returned unchanged.
 *
 * @param {string} path - File system path (typically from .fsName)
 * @returns {string} - Path safe for use with new File() or new Folder()
 */
function normalizeFsPath(path) {
    if (!path || typeof path !== 'string') return path;
    // Only encode for Unix-style paths (macOS/Linux)
    // Windows paths start with a drive letter and are handled natively
    if (path.charAt(0) === '/') {
        // Encode EVERY `%` to `%25` first. The previous "smart" regex
        // `/%(?![0-9A-Fa-f]{2})/` skipped `%` followed by two hex digits to
        // make the function idempotent — but a folder literally named
        // `50%20DISCOUNT` then survived unchanged and ExtendScript's
        // File()/Folder() constructor decoded `%20` as a space, looking up
        // `50 DISCOUNT` and failing to find the folder. Idempotency is not
        // worth that bug. Caller invariant: pass RAW filesystem paths only;
        // do not call this function twice on the same string.
        // Do NOT use encodeURIComponent - it breaks non-ASCII chars in ExtendScript.
        return path
            .replace(/%/g, '%25')
            .replace(/ /g, '%20')
            .replace(/#/g, '%23')
            .replace(/\?/g, '%3F');
    }
    return path;
}

/**
 * Builds a path string suitable for new File() / new Folder() from a parent and child.
 * On macOS, the implicit Folder + String concatenation (toString) may not work correctly
 * in all ExtendScript versions, passing the Folder object through instead of converting
 * to a string. This function explicitly extracts the fsName (always a string) and
 * normalizes it for URI encoding.
 *
 * @param {Folder|File|string} parent - Parent folder (Folder/File object or path string)
 * @param {string} child - Child name to append
 * @returns {string} - Properly encoded path for new File() / new Folder()
 */
function buildPath(parent, child) {
    var parentPath;
    if (parent instanceof File || parent instanceof Folder) {
        parentPath = parent.fsName;
    } else {
        parentPath = String(parent);
    }
    return normalizeFsPath(parentPath + "/" + child);
}

/**
 * Returns true only if BOTH a file AND a SUBFOLDER can be created inside `f` using the
 * SAME raw-concatenation the panel uses downstream (new Folder(f.fsName + "/child")).
 *
 * The old probe tested a FILE only. On AE 2026 (hardened runtime on newer macOS),
 * ExtendScript can create a file in /tmp but Folder.create() there FAILS — /tmp is a
 * symlink to /private/tmp and folder creation through it is rejected. The file-only
 * probe therefore green-lit /tmp, and every import ("Could not create /tmp/blitzkrieg_import_*")
 * and generation ("Failed to create temp dirs: fail") died at the subfolder create.
 *
 * Probing with RAW concat (f.fsName, not buildPath) is deliberate: it mirrors exactly
 * what main.js does, so a base whose spaces would break the raw downstream create is
 * rejected HERE rather than chosen and failing later.
 */
function _tempCandidateUsable(f) {
    var stamp = String((new Date()).getTime()) + '_' + Math.floor(Math.random() * 1000000);
    var base = f.fsName; // RAW path — exactly what main.js concatenates a child onto
    // File probe
    var fileOk = false;
    try {
        var tf = new File(base + '/_blitz_wtest_' + stamp + '.tmp');
        tf.open('w'); tf.write('ok'); tf.close();
        if (tf.exists) { fileOk = true; try { tf.remove(); } catch (rf) {} }
    } catch (eF) {}
    if (!fileOk) return false;
    // Folder probe — the operation that actually fails on AE 2026 /tmp
    var dirOk = false;
    try {
        var td = new Folder(base + '/_blitz_dtest_' + stamp);
        if (td.create() && td.exists) { dirOk = true; try { td.remove(); } catch (rd) {} }
    } catch (eD) {}
    return dirOk;
}

/**
 * Returns a safe temp Folder where BOTH files and subfolders can actually be created.
 * Candidates are tried in order and each is validated with _tempCandidateUsable (which
 * probes real subfolder creation), so the choice is empirical, not assumed — whatever
 * a given AE version / macOS sandbox actually permits wins.
 *
 * macOS order: /tmp (fast, works AE 2018-2025) -> ~/Library/Caches/Blitzkrieg (normal
 * user-writable dir, NOT the restrictive OS TemporaryItems folder, the AE 2026 winner)
 * -> ~/Library/Application Support/Blitzkrieg/tmp (the app's proven data dir) ->
 * Folder.temp. Windows: Folder.temp (%TEMP%).
 */
function getSafeTempFolder() {
    var isMac = ($.os.indexOf('Mac') !== -1 || $.os.indexOf('Macintosh') !== -1);

    // Each builder returns a candidate Folder (creating it on demand) or null.
    // They run in order and the FIRST whose real subfolder-create probe passes
    // wins, so the ~/Library fallback dirs are created ONLY on a machine that
    // actually needs them (e.g. AE 2026) — never as a side effect on AE
    // 2018-2025 where /tmp wins the probe first.
    var builders = [];
    if (isMac) {
        // 0) $TMPDIR - the app's OWN per-user sandbox temp dir (typically
        //    /var/folders/.../T/). CRITICAL for AE 2026: the RENDER engine
        //    (saveFrameToPng) has GUARANTEED write access here, whereas it can be
        //    TCC/sandbox-blocked from ~/Library/Caches even though ExtendScript
        //    File/Folder can create there (the folder-create probe passing does NOT
        //    prove the render engine can open a file for writing). Unlike Folder.temp
        //    (which resolves to this dir's restrictive TemporaryItems child), $TMPDIR
        //    itself is fully writable, so it is tried FIRST on macOS.
        builders.push(function () {
            var td = $.getenv('TMPDIR');
            if (!td) return null;
            var tdRoot = new Folder(td);
            if (!tdRoot.exists) return null;
            var bkTmp = new Folder(buildPath(tdRoot, "Blitzkrieg"));
            if (!bkTmp.exists) bkTmp.create();
            return bkTmp.exists ? bkTmp : null;
        });
        // 1) /tmp — fast, world-writable on AE 2018-2025. AE 2026 creates FILES here
        //    but rejects Folder.create() (symlink to /private/tmp), so the probe drops
        //    it on AE 2026 and we fall through.
        builders.push(function () { return new Folder('/tmp'); });
        // 2) ~/Library/Caches/Blitzkrieg — a normal user-writable directory (NOT the OS
        //    TemporaryItems folder that saveFrameToPng chokes on) and not a symlink, so
        //    ExtendScript Folder.create() works under the AE 2026 sandbox. Folder.userData
        //    is ~/Library/Application Support, so .parent is ~/Library.
        builders.push(function () {
            var cachesRoot = new Folder(buildPath(Folder.userData.parent, "Caches"));
            if (!cachesRoot.exists) return null;
            var bkCache = new Folder(buildPath(cachesRoot, "Blitzkrieg"));
            if (!bkCache.exists) bkCache.create();
            return bkCache.exists ? bkCache : null;
        });
        // 3) ~/Library/Application Support/Blitzkrieg/tmp — the app's own proven-writable
        //    data dir (settings persist here). "Application Support" contains a space; if
        //    that space breaks the raw downstream create, the probe rejects this candidate.
        builders.push(function () {
            var bkRoot = new Folder(buildPath(Folder.userData, "Blitzkrieg"));
            if (!bkRoot.exists) bkRoot.create();
            var bkTmp = new Folder(buildPath(bkRoot, "tmp"));
            if (!bkTmp.exists) bkTmp.create();
            return bkTmp.exists ? bkTmp : null;
        });
    }
    // 4) Cross-platform last resort. Windows: %TEMP% (fully writable). macOS: may be the
    //    restrictive TemporaryItems folder, hence lowest priority.
    builders.push(function () { return Folder.temp; });

    for (var bi = 0; bi < builders.length; bi++) {
        var f = null;
        try { f = builders[bi](); } catch (eb) { f = null; }
        if (!f || !f.exists) continue;
        if (_tempCandidateUsable(f)) return f;
    }
    // Absolute last resort — hand back some folder rather than null.
    return Folder.temp;
}

/**
 * Preview frame generation constants — shared across stashSelectedComp,
 * generatePreviewFrames, and generatePreviewsToDisk so bumping any of these
 * values only requires one edit instead of three.
 */
var PREVIEW_TARGET_FPS = 6;
var PREVIEW_MIN_FRAMES = 12;
// Each preview frame is a full synchronous saveFrameToPng render on AE's UI
// thread, so a deeply-nested comp at the old ceiling of 72 frames could freeze
// AE for tens of seconds ("Not Responding") during stash/generate. The hover
// preview samples at most 12 frames (MAX_HOVER_PREVIEW_FRAMES in cloud-library.js),
// so rendering more than ~24 buys no visible smoothness. 24 keeps a smooth
// sampled loop at a third of the render cost.
var PREVIEW_MAX_FRAMES = 24;

/**
 * Compute the number of preview frames to render for a given comp duration.
 * Mirrors the "~6 FPS preview, min 12, max 72, bounded by totalFrames" logic
 * duplicated in three places before this refactor. Defends against NaN/negative
 * inputs (e.g. comps with workAreaDuration = 0 or a broken frame-rate query).
 */
function computePreviewFrameCount(compDuration, totalFrames) {
    if (!compDuration || compDuration <= 0 || !isFinite(compDuration)) return 0;
    if (!totalFrames || totalFrames <= 0 || !isFinite(totalFrames)) return 0;
    var dynamic = Math.ceil(compDuration * PREVIEW_TARGET_FPS);
    var actual = Math.max(PREVIEW_MIN_FRAMES, Math.min(PREVIEW_MAX_FRAMES, dynamic));
    return Math.min(actual, totalFrames);
}

/**
 * Wait for a PNG written by saveFrameToPng to actually appear on disk.
 *
 * ROOT CAUSE (AE 2026 / 26.x macOS, verified live 2026-07-08): saveFrameToPng
 * flushes the file ASYNCHRONOUSLY via the MediaCore writer. The call returns
 * BEFORE the bytes hit disk (measured ~50ms later), so an immediate File.exists
 * check reads `false` even though the render succeeded. Every synchronous
 * `if (file.exists)` guard after saveFrameToPng therefore mis-reported success
 * as failure, collapsing the whole cloud generate batch to "0 done" and driving
 * a spurious retry/relocation storm. This helper polls (bounded) until the file
 * is present AND non-empty, so callers see the true result.
 *
 * Uses $.sleep in SHORT steps and returns the instant the file appears — on the
 * common success path this adds only ~50ms per frame, not a fixed delay. It only
 * spends the full budget when a render genuinely produced nothing.
 *
 * @param {File} f - the target file
 * @param {number} maxMs - max time to wait (default 4000)
 * @returns {boolean} true if the file exists with length > 0 within the budget
 */
function _waitForFileFlush(f, maxMs) {
    if (!f) return false;
    if (maxMs === undefined || maxMs === null) maxMs = 4000;
    var step = 25;
    var waited = 0;
    while (waited <= maxMs) {
        var probe = new File(f.fsName);
        if (probe.exists && probe.length > 0) return true;
        if (waited === maxMs) break;
        $.sleep(step);
        waited += step;
    }
    var last = new File(f.fsName);
    return last.exists && last.length > 0;
}

/**
 * Creates a Folder object from an fsName path, with fallback.
 * First tries the normalized (URI-encoded) path, then falls back to the raw path.
 * This ensures folders are found even if normalizeFsPath produces an unexpected result.
 * @param {string} fsPath - File system path (typically from .fsName or user input)
 * @returns {Folder} - Folder object (may or may not exist)
 */
function folderFromPath(fsPath) {
    var folder = new Folder(normalizeFsPath(fsPath));
    if (!folder.exists) {
        // Fallback: try the raw path in case normalization broke it
        var rawFolder = new Folder(fsPath);
        if (rawFolder.exists) {
            return rawFolder;
        }
    }
    return folder;
}

/**
 * Creates a File object from an fsName path, with fallback.
 * First tries the normalized (URI-encoded) path, then falls back to the raw path.
 * @param {string} fsPath - File system path
 * @returns {File} - File object (may or may not exist)
 */
function fileFromPath(fsPath) {
    var file = new File(normalizeFsPath(fsPath));
    if (!file.exists) {
        var rawFile = new File(fsPath);
        if (rawFile.exists) {
            return rawFile;
        }
    }
    return file;
}

function selectLibraryFolder() {
    var folder = Folder.selectDialog("Select your Blitzkrieg Library Folder");
    if (folder) {
        return folder.fsName;
    }
    return null;
}

/**
 * Safely decodes a URI-encoded string. Returns the original string if decoding fails.
 * This prevents URIError exceptions when folder names contain literal % characters
 * (e.g., "50%OFF" would cause decodeURI to throw because %OF is not valid percent-encoding).
 * @param {string} str - The string to decode
 * @returns {string} - Decoded string, or original string if decoding fails
 */
function safeDecodeURI(str) {
    try {
        return decodeURI(str);
    } catch (e) {
        // If decoding fails (e.g., folder name contains literal % like "50%OFF"),
        // return the original string as-is
        return str;
    }
}

/**
 * MACFIX: Robustly gets subfolders from a parent folder.
 * On macOS, getFiles() with a function filter can fail to return results when the
 * Folder's internal URI path has encoding issues. This function tries multiple
 * strategies to ensure folders are found.
 *
 * Strategy 1: getFiles(function) - standard approach
 * Strategy 2: getFiles() without filter + manual instanceof check
 * Strategy 3: Recreate Folder from fsName + getFiles() + manual check
 *
 * @param {Folder} parentFolder - The folder to scan for subfolders
 * @returns {Array} - Array of Folder objects
 */
function robustGetFolders(parentFolder) {
    var folders = [];

    // Strategy 1: getFiles with function filter (standard)
    try {
        folders = parentFolder.getFiles(function(f) { return f instanceof Folder; });
        if (folders && folders.length > 0) return folders;
    } catch (e1) {
        $.writeln("Blitzkrieg: robustGetFolders strategy 1 failed: " + e1.toString());
    }

    // Strategy 2: getFiles() without filter, then manually filter
    // On macOS, getFiles() without arguments is more reliable than with a function filter
    try {
        var allItems = parentFolder.getFiles();
        folders = [];
        if (allItems) {
            for (var i = 0; i < allItems.length; i++) {
                if (allItems[i] instanceof Folder) {
                    folders.push(allItems[i]);
                }
            }
        }
        if (folders.length > 0) return folders;
    } catch (e2) {
        $.writeln("Blitzkrieg: robustGetFolders strategy 2 failed: " + e2.toString());
    }

    // Strategy 3: Recreate folder from fsName and try again
    // On macOS, fsName gives the native POSIX path. Creating a new Folder from this
    // may produce a different internal URI that getFiles() handles better.
    try {
        var fsPath = parentFolder.fsName;
        if (fsPath) {
            var freshFolder = new Folder(fsPath);
            if (freshFolder.exists) {
                var freshItems = freshFolder.getFiles();
                folders = [];
                if (freshItems) {
                    for (var j = 0; j < freshItems.length; j++) {
                        if (freshItems[j] instanceof Folder) {
                            folders.push(freshItems[j]);
                        }
                    }
                }
                if (folders.length > 0) return folders;
            }

            // Strategy 4: Try with URI-encoded fsName (macOS spaces workaround)
            var encodedPath = fsPath.replace(/ /g, '%20');
            var encodedFolder = new Folder(encodedPath);
            if (encodedFolder.exists) {
                var encodedItems = encodedFolder.getFiles();
                folders = [];
                if (encodedItems) {
                    for (var k = 0; k < encodedItems.length; k++) {
                        if (encodedItems[k] instanceof Folder) {
                            folders.push(encodedItems[k]);
                        }
                    }
                }
                if (folders.length > 0) return folders;
            }
        }
    } catch (e3) {
        $.writeln("Blitzkrieg: robustGetFolders strategy 3/4 failed: " + e3.toString());
    }

    return folders || [];
}

/**
 * MACFIX: Robustly finds an .aep file inside a comp folder.
 * On macOS, getFiles("*.aep") glob pattern can fail with URI-encoded folder paths.
 * This function tries multiple strategies to locate the AEP file.
 *
 * @param {Folder} compFolder - The comp folder to search
 * @returns {File|null} - The first .aep File found, or null
 */
function robustFindAep(compFolder) {
    var aepFiles, allFiles, i;

    // Strategy 1: glob pattern (standard)
    try {
        aepFiles = compFolder.getFiles("*.aep");
        if (aepFiles && aepFiles.length > 0 && aepFiles[0] instanceof File) {
            return aepFiles[0];
        }
    } catch (e1) {
        $.writeln("Blitzkrieg: robustFindAep strategy 1 failed: " + e1.toString());
    }

    // Strategy 2: get all files, manually filter for .aep extension
    try {
        allFiles = compFolder.getFiles();
        if (allFiles) {
            for (i = 0; i < allFiles.length; i++) {
                if (allFiles[i] instanceof File) {
                    var name = allFiles[i].name.toLowerCase();
                    // Match .aep extension, skip macOS resource forks (._prefix)
                    if (name.length > 4 && name.substr(name.length - 4) === '.aep' && name.charAt(0) !== '.') {
                        return allFiles[i];
                    }
                }
            }
            // If no non-hidden .aep found, try again including all .aep files
            for (i = 0; i < allFiles.length; i++) {
                if (allFiles[i] instanceof File) {
                    var name2 = allFiles[i].name.toLowerCase();
                    if (name2.length > 4 && name2.substr(name2.length - 4) === '.aep') {
                        return allFiles[i];
                    }
                }
            }
        }
    } catch (e2) {
        $.writeln("Blitzkrieg: robustFindAep strategy 2 failed: " + e2.toString());
    }

    // Strategy 3: Recreate folder from fsName, then search
    try {
        var fsPath = compFolder.fsName;
        if (fsPath) {
            var freshFolder = new Folder(fsPath);
            if (freshFolder.exists) {
                allFiles = freshFolder.getFiles();
                if (allFiles) {
                    for (i = 0; i < allFiles.length; i++) {
                        if (allFiles[i] instanceof File) {
                            var name3 = allFiles[i].name.toLowerCase();
                            if (name3.length > 4 && name3.substr(name3.length - 4) === '.aep' && name3.charAt(0) !== '.') {
                                return allFiles[i];
                            }
                        }
                    }
                }
            }

            // Strategy 4: Try with URI-encoded path
            var encodedPath = fsPath.replace(/ /g, '%20');
            var encodedFolder = new Folder(encodedPath);
            if (encodedFolder.exists) {
                allFiles = encodedFolder.getFiles();
                if (allFiles) {
                    for (i = 0; i < allFiles.length; i++) {
                        if (allFiles[i] instanceof File) {
                            var name4 = allFiles[i].name.toLowerCase();
                            if (name4.length > 4 && name4.substr(name4.length - 4) === '.aep' && name4.charAt(0) !== '.') {
                                return allFiles[i];
                            }
                        }
                    }
                }
            }
        }
    } catch (e3) {
        $.writeln("Blitzkrieg: robustFindAep strategy 3/4 failed: " + e3.toString());
    }

    return null;
}

/**
 * Diagnostic function: returns detailed info about the library folder structure.
 * Call from JS via csInterface.evalScript('debugLibrary("path")') for troubleshooting.
 * @param {string} libraryPath - Library path to inspect
 * @returns {string} - JSON string with diagnostic info
 */
function debugLibrary(libraryPath) {
    var info = {
        path: libraryPath,
        exists: false,
        resolvedPath: '',
        platform: $.os,
        aeVersion: AE_VERSION_INFO.versionString,
        categories: [],
        errors: []
    };

    try {
        if (!isValidPath(libraryPath)) {
            info.errors.push("Invalid path");
            return JSON.stringify(info);
        }

        var mainFolder = folderFromPath(libraryPath);
        info.exists = mainFolder.exists;
        info.resolvedPath = mainFolder.fsName;

        if (!mainFolder.exists) {
            info.errors.push("Main folder does not exist");

            // Try alternative folder creation methods and report
            var rawFolder = new Folder(libraryPath);
            info.rawPathExists = rawFolder.exists;
            var encodedFolder = new Folder(libraryPath.replace(/ /g, '%20'));
            info.encodedPathExists = encodedFolder.exists;

            return JSON.stringify(info);
        }

        // Scan categories
        var allItems = mainFolder.getFiles();
        info.totalItems = allItems ? allItems.length : 0;

        var categoryFolders = robustGetFolders(mainFolder);

        for (var i = 0; i < categoryFolders.length; i++) {
            var catFolder = categoryFolders[i];
            var catName = safeDecodeURI(catFolder.name);
            if (catName.charAt(0) === '.') continue;

            var catInfo = {
                name: catName,
                path: catFolder.fsName,
                compFolders: []
            };

            var compFolders = robustGetFolders(catFolder);
            for (var j = 0; j < compFolders.length; j++) {
                var cmpFolder = compFolders[j];
                var cmpName = safeDecodeURI(cmpFolder.name);
                if (cmpName.charAt(0) === '.') continue;

                var cmpInfo = {
                    name: cmpName,
                    path: cmpFolder.fsName,
                    hasAep: false,
                    hasMetadata: false,
                    hasThumbnail: false,
                    isTemplate: false,
                    hasSubfolders: false,
                    files: []
                };

                var cmpFiles = cmpFolder.getFiles();
                if (cmpFiles) {
                    for (var k = 0; k < cmpFiles.length; k++) {
                        var f = cmpFiles[k];
                        var fname = safeDecodeURI(f.name);
                        if (f instanceof Folder) {
                            cmpInfo.hasSubfolders = true;
                        }
                        cmpInfo.files.push(fname);
                        if (fname.toLowerCase().indexOf('.aep') !== -1) cmpInfo.hasAep = true;
                        if (fname === 'metadata.json') cmpInfo.hasMetadata = true;
                        if (fname === 'comp.png') cmpInfo.hasThumbnail = true;
                    }
                }

                // A folder is a template if it has .aep, metadata.json, or comp.png.
                // Folders with only non-template files (assets, presets, plugins, fonts)
                // or folders that are parent/grouping containers (have subfolders but no
                // template markers) are NOT templates.
                cmpInfo.isTemplate = cmpInfo.hasAep || cmpInfo.hasMetadata || cmpInfo.hasThumbnail;

                catInfo.compFolders.push(cmpInfo);
            }

            info.categories.push(catInfo);
        }
    } catch (e) {
        info.errors.push(e.toString());
    }

    return JSON.stringify(info);
}

/**
 * Gets all stashed compositions from the library.
 * Includes robust macOS compatibility with multiple fallback strategies for
 * getFiles() operations that can fail with URI-encoded folder paths.
 *
 * IMPORTANT: This function is wrapped in try-catch because it's called via
 * csInterface.evalScript. An uncaught exception would return "EvalScript error."
 * instead of JSON, causing the JavaScript side to fail silently.
 */
function getStashedComps(libraryPath) {
    if (!isValidPath(libraryPath)) {
        $.writeln("Blitzkrieg: getStashedComps - invalid path: " + libraryPath);
        return "[]";
    }

    try {
        // --- Resolve the main library folder with multiple fallback strategies ---
        // On macOS, ExtendScript treats /-prefixed paths as URIs. The Folder constructor
        // may fail to enumerate contents if the internal URI representation is corrupted
        // by double-encoding or if getFiles() doesn't work with the URI form.
        var mainFolder = folderFromPath(libraryPath);

        // MACFIX: If folderFromPath's result doesn't exist, try additional strategies
        if (!mainFolder.exists) {
            // Strategy 2: raw string directly (works when path has no URI-special chars)
            mainFolder = new Folder(libraryPath);
        }
        if (!mainFolder.exists) {
            // Strategy 3: manually URI-encode only spaces (most common macOS issue)
            mainFolder = new Folder(libraryPath.replace(/ /g, '%20'));
        }
        if (!mainFolder.exists) {
            $.writeln("Blitzkrieg: getStashedComps - library folder not found: " + libraryPath);
            return "[]";
        }

        $.writeln("Blitzkrieg: getStashedComps - scanning library: " + mainFolder.fsName);

        var compsData = [];

        // --- Get category folders with robust fallback ---
        // On macOS, getFiles(function) can fail to return results when the Folder's
        // internal URI path has encoding issues. We use multiple strategies.
        var categoryFolders = robustGetFolders(mainFolder);
        $.writeln("Blitzkrieg: getStashedComps - found " + categoryFolders.length + " category folders");

        var numCategories = categoryFolders.length;

        for (var i = 0; i < numCategories; i++) {
            var categoryFolder = categoryFolders[i];
            // Use safeDecodeURI to prevent URIError on folder names with literal %
            var categoryName = safeDecodeURI(categoryFolder.name);

            // Skip hidden/system folders (macOS creates .DS_Store, .Spotlight, etc.)
            if (categoryName.charAt(0) === '.') continue;

            var compFolders = robustGetFolders(categoryFolder);

            var numComps = compFolders.length;
            $.writeln("Blitzkrieg: getStashedComps - category '" + categoryName + "' has " + numComps + " comp folders");

            for (var j = 0; j < numComps; j++) {
                try {
                    var compFolder = compFolders[j];
                    var compFolderPath = compFolder.fsName;
                    var compFolderName = compFolder.name;

                    // Skip hidden folders
                    if (safeDecodeURI(compFolderName).charAt(0) === '.') continue;

                    // --- Find .aep files with robust fallback ---
                    // On macOS, getFiles("*.aep") glob can fail when the Folder's internal
                    // URI path has encoding issues. We try multiple approaches.
                    var aepFile = robustFindAep(compFolder);
                    if (!aepFile) {
                        $.writeln("Blitzkrieg: getStashedComps - no .aep in: " + compFolderPath);
                        continue;
                    }

                    // Fast path: derive display name from folder name
                    // Use safeDecodeURI to prevent URIError on names with literal %
                    var decodedFolderName = safeDecodeURI(compFolderName);
                    var displayName = decodedFolderName.split('_').slice(0, -1).join(' ');
                    if (!displayName) displayName = decodedFolderName; // Fallback if no underscore
                    var previewFrameCount = 0;
                    var duration = 0;

                    // Read metadata - try multiple path strategies for macOS compatibility
                    var metadataFile = fileFromPath(compFolderPath + "/metadata.json");
                    if (!metadataFile.exists) {
                        metadataFile = new File(buildPath(compFolder, "metadata.json"));
                    }
                    if (metadataFile.exists) {
                        try {
                            metadataFile.open('r');
                            metadataFile.encoding = 'UTF-8';
                            var metaContent = metadataFile.read();
                            metadataFile.close();

                            if (metaContent) {
                                var metadata = JSON.parse(metaContent);
                                displayName = metadata.displayName || displayName;
                                previewFrameCount = metadata.previewFrames || 0;
                                duration = metadata.duration || 0;
                            }
                        } catch (metaErr) {
                            try { metadataFile.close(); } catch (closeErr) {}
                        }
                    }

                    // Check thumbnail existence - try multiple path strategies
                    var thumbPath = compFolderPath + "/comp.png";
                    var thumbFile = fileFromPath(thumbPath);
                    if (!thumbFile.exists) {
                        thumbFile = new File(buildPath(compFolder, "comp.png"));
                    }
                    var hasThumb = thumbFile.exists;

                    // Build preview frame paths only if we know they exist
                    var previewFramePaths = [];
                    if (previewFrameCount > 0) {
                        var previewFolderPath = compFolderPath + "/preview";
                        // Pre-build all frame paths without checking each one
                        // This is faster - we trust the metadata count
                        for (var pf = 0; pf < previewFrameCount; pf++) {
                            previewFramePaths.push(previewFolderPath + "/frame_" + pf + ".png");
                        }
                    }

                    compsData.push({
                        name: displayName,
                        category: categoryName,
                        uniqueId: compFolderName,
                        aepPath: aepFile.fsName,
                        thumbPath: hasThumb ? thumbPath : null,
                        previewFrames: previewFramePaths,
                        duration: duration
                    });
                } catch (compErr) {
                    // Skip this comp but continue loading others
                    $.writeln("Blitzkrieg: Warning - Could not load comp: " + compErr.toString());
                }
            }
        }
        $.writeln("Blitzkrieg: getStashedComps - returning " + compsData.length + " comps");
        return JSON.stringify(compsData);
    } catch (e) {
        $.writeln("Blitzkrieg: Error in getStashedComps: " + e.toString());
        // Return empty array instead of throwing - prevents evalScript from returning error string
        return "[]";
    }
}


/**
 * STASH FUNCTION - Saves the selected composition to the library
 * This version prioritizes reliability over the "invisible" approach
 */
// Resolve the composition the user wants to act on so "Add Comp" is forgiving:
// prefer a single comp SELECTED in the Project panel; if several items are
// selected but exactly one is a comp, use that; otherwise fall back to the comp
// currently OPEN in the viewer (activeItem). Returns the CompItem or null. This
// is the single source of truth shared by the modal gate (getActiveCompInfo),
// the size estimate, and the stash, so all three agree on WHICH comp is saved.
function resolveTargetComp() {
    try {
        if (!app.project) return null;
        var sel = app.project.selection;
        if (sel && sel.length === 1 && sel[0] instanceof CompItem) return sel[0];
        if (sel && sel.length > 1) {
            var found = null, count = 0;
            for (var i = 0; i < sel.length; i++) {
                if (sel[i] instanceof CompItem) { found = sel[i]; count++; }
            }
            if (count === 1) return found;
        }
        var active = app.project.activeItem;
        if (active && active instanceof CompItem) return active;
    } catch (e) {}
    return null;
}

function stashSelectedComp(libraryPath, categoryName) {
    // Validate inputs
    if (!isValidPath(libraryPath)) {
        return "Error: Invalid library path.";
    }
    if (!isValidName(categoryName)) {
        return "Error: Invalid category name. Names cannot contain path separators.";
    }

    var originalProjectFile = null;
    var projectWasDirty = false;

    try {
        if (!app.project) {
            return "Error: Please open a project first.";
        }

        // Store original project reference
        originalProjectFile = app.project.file;
        projectWasDirty = app.project.dirty;

        var compToSave = resolveTargetComp();
        if (!compToSave) {
            return "Error: Open a composition, or select one in the Project panel, then click Add Comp.";
        }
        var compToSaveName = compToSave.name;
        // Sanitize for filesystem: keep [a-z0-9], collapse runs, trim underscores.
        // Fall back to "comp" if the name is all non-ASCII (emoji/CJK) so we don't end
        // up with "_.aep" which collides on rename and makes cloud downloads fail.
        var safeCompName = compToSaveName.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '');
        if (!safeCompName) safeCompName = 'comp';

        // --- Create folder structure (use normalizeFsPath for macOS compatibility) ---
        var categoryFolder = folderFromPath(libraryPath + "/" + categoryName);
        if (!categoryFolder.exists) {
            if (!categoryFolder.create()) {
                return "Error: Could not create category folder.";
            }
        }

        var timestamp = new Date().getTime();
        var compFolderName = safeCompName + '_' + timestamp;
        var compFolder = new Folder(buildPath(categoryFolder, compFolderName));
        if (!compFolder.create()) {
            return "Error: Could not create composition folder.";
        }

        // --- Save Thumbnail and Preview Frames ---
        var thumbFile = new File(buildPath(compFolder, "comp.png"));
        var previewFrameCount = 0;
        var stashMemoryErrorHit = false; // surfaced in the return value so the
                                         // editor gets a specific Motion Tile hint

        // Suppress render-phase dialogs. saveFrameToPng below can raise modal AE
        // warnings (e.g. "Object Matte will not render correctly because the source
        // frame rate changed", or "Could not create file" on Windows) that block the
        // stash on the UI thread. generatePreviewsToDisk already wraps its render in
        // suppression; the stash render must match or it stalls waiting for a click.
        var _stashRenderSuppressed = false;
        try { app.beginSuppressDialogs(); _stashRenderSuppressed = true; } catch (sdRErr) {}

        try {
            // Save main thumbnail (middle frame)
            var frameTime = compToSave.workAreaStart + (compToSave.workAreaDuration / 2);
            compToSave.saveFrameToPng(frameTime, thumbFile);
            // AE 2026 flushes the PNG asynchronously — wait for it to land before
            // metadata is written and the folder is uploaded (see _waitForFileFlush).
            _waitForFileFlush(thumbFile, 5000);

            // Generate preview frames for animation preview
            // Only generate if comp has duration (not a still)
            var compDuration = compToSave.workAreaDuration;
            var frameRate = compToSave.frameRate || 30;
            var totalFrames = Math.floor(compDuration * frameRate);

            if (totalFrames > 1) {
                // Create preview folder
                var previewFolder = new Folder(buildPath(compFolder, "preview"));
                previewFolder.create();

                // Shared dynamic-frame-count logic (see computePreviewFrameCount)
                var actualFrameCount = computePreviewFrameCount(compDuration, totalFrames);

                for (var pf = 0; pf < actualFrameCount; pf++) {
                    try {
                        // FIXED: Evenly distribute frames across ENTIRE duration
                        // Frame 0 = start, Last frame = end (ensures full coverage)
                        var progress = (actualFrameCount > 1) ? (pf / (actualFrameCount - 1)) : 0;
                        var previewTime = compToSave.workAreaStart + (progress * compDuration);

                        var previewFile = new File(buildPath(previewFolder, "frame_" + pf + ".png"));
                        compToSave.saveFrameToPng(previewTime, previewFile);
                        // AE 2026 async flush — only count the frame once it lands.
                        if (_waitForFileFlush(previewFile, 3000)) previewFrameCount++;
                    } catch (previewErr) {
                        // Detect AE memory-allocation OOM (Motion Tile with large
                        // Output Width/Height is the common cause). Break out — no
                        // point rendering more frames that will all fail the same way.
                        var pel = previewErr.toString().toLowerCase();
                        if (pel.indexOf('memory allocation') !== -1 && pel.indexOf('exceed') !== -1) {
                            stashMemoryErrorHit = true;
                            $.writeln("Blitzkrieg: Preview frame render hit AE memory limit (Motion Tile?): " + previewErr.toString());
                            break;
                        }
                        $.writeln("Blitzkrieg: Warning - Could not generate preview frame " + pf + ": " + previewErr.toString());
                    }
                }
            }
        } catch(e) {
            // Also catch memory errors from the thumbnail render itself.
            var tel = e.toString().toLowerCase();
            if (tel.indexOf('memory allocation') !== -1 && tel.indexOf('exceed') !== -1) {
                stashMemoryErrorHit = true;
                $.writeln("Blitzkrieg: Thumbnail render hit AE memory limit (Motion Tile?): " + e.toString());
            } else {
                $.writeln("Blitzkrieg: Warning - Could not generate thumbnail: " + e.toString());
            }
        }

        if (_stashRenderSuppressed) {
            try { app.endSuppressDialogs(false); } catch (edRErr) {}
            _stashRenderSuppressed = false;
        }

        // --- Save Metadata ---
        var metadataFile = new File(buildPath(compFolder, "metadata.json"));
        metadataFile.open('w');
        metadataFile.encoding = 'UTF-8';
        metadataFile.write(JSON.stringify({
            displayName: compToSaveName,
            created: timestamp,
            category: categoryName,
            duration: compToSave.workAreaDuration,
            frameRate: compToSave.frameRate,
            width: compToSave.width,
            height: compToSave.height,
            previewFrames: previewFrameCount,
            // Linked sub-comp / pre-comp dependencies stored in sibling folders.
            // reduceProject() collapses normal dependencies into this single .aep,
            // so a fresh stash is self-contained → []. The storage-remediation pass
            // populates this for legacy split templates; downloadTemplate() reads it.
            dependencies: [],
            aeVersion: AE_VERSION_INFO.versionString
        }));
        metadataFile.close();

        // --- Suppress AE dialogs for the entire stash operation ---
        // app.project.save() and app.open() trigger native "missing files" dialogs
        // when the project has broken footage references. Unlike importFile(), save/open
        // do NOT crash AE 2024/2025 with beginSuppressDialogs, so no version gate needed.
        var _stashDialogsSuppressed = false;
        try { app.beginSuppressDialogs(); _stashDialogsSuppressed = true; } catch (sdErr) {}

        // --- Save the project first if it hasn't been saved ---
        // On macOS, app.project.save() can fail silently. Wrap each call in try/catch
        // AND verify the file exists after, matching the same safety pattern we use
        // for the final library AEP save below.
        if (!originalProjectFile) {
            // Project hasn't been saved yet - we need to save it first
            var tempProjectFile = new File(buildPath(getSafeTempFolder(), "blitzkrieg_temp_" + timestamp + ".aep"));
            try { app.project.save(tempProjectFile); } catch (preSaveErr1) {
                $.writeln("Blitzkrieg: save() threw saving pre-stash temp project: " + preSaveErr1.toString());
            }
            if (!tempProjectFile.exists) {
                if (_stashDialogsSuppressed) { try { app.endSuppressDialogs(false); } catch(e) {} }
                return "Error: Could not save the project to a temp file before stashing. Please save your project manually and try again.";
            }
            originalProjectFile = tempProjectFile;
        } else if (projectWasDirty) {
            // Save current changes so our reduceProject + restore sequence is safe
            try { app.project.save(originalProjectFile); } catch (preSaveErr2) {
                $.writeln("Blitzkrieg: save() threw saving dirty project: " + preSaveErr2.toString());
            }
            // Note: we can't verify .exists here because the file was already on disk;
            // a silent save failure would mean the file still exists with OLD contents.
            // We proceed anyway since stashing reduceProject+save is non-destructive to
            // the on-disk original (we re-open it at the end).
        }

        // --- Create a duplicate project for the library ---
        app.beginUndoGroup("Blitzkrieg Stash");

        // Capture comp ID before any project modifications.
        var compId = compToSave.id;

        // macOS FIX: Re-find the comp by ID after app.project.save().
        // On macOS AE 2024+, project.save() can invalidate existing item references internally,
        // causing reduceProject([compToSave]) to throw:
        //   "Object of type Folder found where a Number, Array, or Property is needed"
        // because AE's engine can no longer recognise the stale reference as a CompItem.
        // Searching by ID gives us a fresh, valid reference every time.
        var freshComp = null;
        // Pass 1: flat iteration over all project items. On modern AE, this includes
        // items nested in FolderItems (project.item(i) is globally indexed).
        for (var ri = 1; ri <= app.project.numItems; ri++) {
            try {
                var riItem = app.project.item(ri);
                if ((riItem instanceof CompItem) && riItem.id === compId) {
                    freshComp = riItem;
                    break;
                }
            } catch (riErr) { /* skip any inaccessible items */ }
        }
        // Pass 2: defensive fallback — recurse into project.rootFolder in case the
        // flat scan missed it on older AE builds where numItems behaves differently.
        if (!freshComp) {
            var _findInFolder = function(folder) {
                for (var fi = 1; fi <= folder.numItems; fi++) {
                    try {
                        var it = folder.item(fi);
                        if ((it instanceof CompItem) && it.id === compId) return it;
                        if (it instanceof FolderItem) {
                            var nested = _findInFolder(it);
                            if (nested) return nested;
                        }
                    } catch (fiErr) {}
                }
                return null;
            };
            try { freshComp = _findInFolder(app.project.rootFolder); } catch (rfErr) {}
        }
        if (!freshComp) freshComp = compToSave; // safe fallback to original reference

        // Reduce project to only include selected comp and its dependencies.
        // Wrapped in try-catch because on macOS, reduceProject can fail with a "Folder" type
        // error when the project has folder-structured items or when running on Apple Silicon.
        // If it fails we continue without reduction; the saved AEP will be larger but fully
        // functional - the user's original project is restored afterwards either way.
        try {
            app.project.reduceProject([freshComp]);
        } catch (reduceErr) {
            $.writeln("Blitzkrieg: reduceProject failed (" + reduceErr.toString() + ") - saving without reduction.");
        }

        // Create footage folder and collect files
        var footageFolder = new Folder(buildPath(compFolder, "(Footage)"));
        footageFolder.create();

        // --- Comprehensive footage collection ---
        // We track EVERY skip reason so nothing silently disappears into the bundle:
        //   - footageMissing=true             (AE lost the file reference)
        //   - sourceFile.exists === false     (file gone from disk)
        //   - copy() returned false           (disk full / permission denied / network drop)
        //   - replace() threw                 (AE rejected the replacement)
        //   - mainSource.file is null         (solids, placeholders, or plugin-injected refs)
        //   - item is an image sequence       (mainSource.file only points to first frame)
        //   - neither mainSource.file nor item.file resolves (pre-CC 2019 fallback attempted)
        //
        // Each skip is added to `missingFootageItems` so the user sees a warning
        // rather than getting a silently-broken bundle (the "ImporterJP" symptom).
        var collectedFiles = {};
        var missingFootageItems = [];
        var missingTotalCount = 0;         // total count incl. overflow past the cap
        var collectedCount = 0;
        var sequenceItems = [];            // tracked separately for a specific warning
        var totalItems = app.project.numItems;
        var MISSING_DETAIL_CAP = 30;

        function _recordMissing(name, reason) {
            missingTotalCount++;
            if (missingFootageItems.length >= MISSING_DETAIL_CAP) return;
            missingFootageItems.push(name + ' (' + reason + ')');
        }

        for (var i = 1; i <= totalItems; i++) {
            var itemName = '';
            try {
                var item = app.project.item(i);
                if (!(item instanceof FootageItem)) continue;
                try { itemName = item.name || ('item ' + i); } catch (nmIt) { itemName = 'item ' + i; }

                // Step 1: explicit footageMissing flag
                var isMissing = false;
                try { isMissing = !!item.footageMissing; } catch (fmChk) {}
                if (isMissing) {
                    _recordMissing(itemName, 'file link broken in project');
                    $.writeln("Blitzkrieg: SKIP (footageMissing): " + itemName);
                    continue;
                }

                // Step 2: resolve a File reference from multiple possible sources.
                // mainSource.file is the modern path, but older AE versions / certain
                // import types populate item.file instead. Try both before giving up.
                var sourceFile = null;
                var isSequence = false;
                try {
                    if (item.mainSource && item.mainSource.file) {
                        sourceFile = item.mainSource.file;
                        // Detect image sequences — mainSource.file only points to the FIRST
                        // frame, so collecting just this one file loses the rest of the sequence.
                        try {
                            if (item.mainSource.isStill === false && item.duration > 0.1) {
                                // Non-still file footage with >1 frame that ISN'T video could be
                                // an image sequence. Exclude all known video container/codec
                                // extensions (consumer + pro formats + animated raster formats)
                                // to avoid false-positives on files like `Reel_001.mxf`, `B_001.r3d`,
                                // `Camera_001.braw`, `Take_001.prores`, animated `.gif`, etc.
                                var srcName = sourceFile.name || '';
                                var videoExtRegex = /\.(mp4|mov|avi|mkv|webm|m4v|wmv|mxf|mts|m2ts|r3d|braw|dnxhd|dnxhr|prores|gif|mpg|mpeg|ts|vob|flv|ogv|3gp|asf|rm|rmvb|f4v|m2v|mpe)$/i;
                                if (/\d+\.[a-z0-9]+$/i.test(srcName) && !videoExtRegex.test(srcName)) {
                                    isSequence = true;
                                }
                            }
                        } catch (seqChk) {}
                    }
                } catch (msChk) {}
                if (!sourceFile) {
                    try { if (item.file) sourceFile = item.file; } catch (ifChk) {}
                }

                // Solids, placeholders, text, adjustment layers → no file, legitimately skip
                if (!sourceFile) {
                    // Only record if it looks like it SHOULD have a file (has a non-empty name
                    // and is flagged as having video/audio). Pure solids don't need tracking.
                    try {
                        var looksLikeFootage = false;
                        if (item.mainSource) {
                            if (item.mainSource.hasVideo || item.mainSource.hasAudio) looksLikeFootage = true;
                        }
                        if (looksLikeFootage) {
                            _recordMissing(itemName, 'no file reference (plugin-injected or corrupt)');
                            $.writeln("Blitzkrieg: SKIP (no file ref): " + itemName);
                        }
                    } catch (lfChk) {}
                    continue;
                }

                // Step 3: verify the file still exists on disk
                if (!sourceFile.exists) {
                    _recordMissing(itemName, 'file missing on disk');
                    $.writeln("Blitzkrieg: SKIP (file gone): " + itemName + " → " + sourceFile.fsName);
                    continue;
                }

                // Step 4: skip already-collected duplicates (dedupe by absolute path)
                if (collectedFiles[sourceFile.fsName]) continue;

                // Step 5: skip Adobe install + plugin paths (avoid copying bundled assets).
                // Matches specific directories only — the old substring-based match
                // falsely rejected user paths containing "adobe" anywhere.
                var pathLower = sourceFile.fsName.toLowerCase().replace(/\\/g, '/');
                var isSystemPath = (
                    pathLower.indexOf('/applications/adobe') !== -1 ||
                    pathLower.indexOf('/program files/adobe') !== -1 ||
                    pathLower.indexOf('/program files (x86)/adobe') !== -1 ||
                    pathLower.indexOf('/plug-ins/') !== -1 ||
                    pathLower.indexOf('/plugins/') !== -1
                );
                if (isSystemPath) continue;

                // Step 6: compute a unique destination filename inside (Footage).
                // Hard cap on iterations: a corrupted/read-only (Footage) folder
                // makes every destFile.exists return true forever, hanging the
                // stash. 9999 is generous (no normal stash needs that many
                // collisions for one filename) and bounds the worst case.
                var destFile = new File(buildPath(footageFolder, sourceFile.name));
                var counter = 1;
                var collisionGuard = 0;
                while (destFile.exists) {
                    if (++collisionGuard > 9999) {
                        throw new Error("Stash aborted: filename collision loop exceeded 9999 iterations on " + sourceFile.name + " — (Footage) folder may be corrupt.");
                    }
                    var nameParts = sourceFile.name.split('.');
                    var destExt = nameParts.length > 1 ? nameParts.pop() : '';
                    var destBase = nameParts.join('.') || sourceFile.name;
                    destFile = new File(buildPath(
                        footageFolder,
                        destExt ? (destBase + "_" + counter + "." + destExt) : (destBase + "_" + counter)
                    ));
                    counter++;
                }

                // Step 7: copy the source file into the (Footage) folder
                var copied = false;
                try { copied = sourceFile.copy(destFile); } catch (copyThrowErr) {
                    $.writeln("Blitzkrieg: copy() threw for " + sourceFile.fsName + ": " + copyThrowErr.toString());
                }
                if (!copied || !destFile.exists) {
                    _recordMissing(itemName, 'copy failed (permission/disk/network)');
                    $.writeln("Blitzkrieg: SKIP (copy failed): " + sourceFile.fsName);
                    // Best-effort cleanup of any partial bytes that may have been
                    // written to disk before the copy aborted.
                    try { if (destFile.exists) destFile.remove(); } catch (cpRmErr) {}
                    continue;
                }

                // Step 8: swap the project's reference to point at the collected copy.
                // If this throws, we leave the collected file in place (not a regression —
                // the bundle will still have the file, it just won't be auto-relinked).
                try {
                    item.replace(destFile);
                    collectedFiles[sourceFile.fsName] = true;
                    collectedCount++;

                    // Step 9: if this was a sequence, the replace above collapsed it to a
                    // single frame. Record this so the user knows the bundle is incomplete.
                    if (isSequence) {
                        sequenceItems.push(itemName);
                        $.writeln("Blitzkrieg: WARN (sequence collapsed to first frame): " + itemName);
                    }
                } catch (replaceErr) {
                    _recordMissing(itemName, 'replace() threw: ' + replaceErr.toString());
                    $.writeln("Blitzkrieg: SKIP (replace failed): " + itemName + " — " + replaceErr.toString());
                    // Best-effort cleanup: remove the now-orphaned collected file
                    try { destFile.remove(); } catch (rmRepErr) {}
                }
            } catch (itemErr) {
                _recordMissing(itemName || ('item ' + i), 'unexpected error: ' + itemErr.toString());
                $.writeln("Blitzkrieg: SKIP (item error): " + itemName + " — " + itemErr.toString());
            }
        }
        $.writeln("Blitzkrieg: Footage collection complete — " + collectedCount + " collected, " + missingTotalCount + " missing/skipped, " + sequenceItems.length + " sequences collapsed.");

        // Merge sequence warnings into the missing list so the user sees them
        for (var sqi = 0; sqi < sequenceItems.length; sqi++) {
            missingTotalCount++;
            if (missingFootageItems.length < MISSING_DETAIL_CAP) {
                missingFootageItems.push(sequenceItems[sqi] + ' (image sequence — only first frame collected)');
            }
        }

        // --- Remove missing footage items before saving ---
        // After reduceProject, any FootageItem with footageMissing or a dead file
        // reference will trigger an AE "file not found" dialog when the AEP is
        // re-imported on another machine. Remove them now so stashed templates
        // are clean. Iterate in reverse so .remove() doesn't shift indices.
        var removedMissingCount = 0;
        for (var rmi = app.project.numItems; rmi >= 1; rmi--) {
            try {
                var rmItem = app.project.item(rmi);
                if (!(rmItem instanceof FootageItem)) continue;

                var shouldRemove = false;
                var rmReason = '';

                // Check explicit footageMissing flag
                try {
                    if (rmItem.footageMissing) {
                        shouldRemove = true;
                        rmReason = 'footageMissing flag';
                    }
                } catch (fmErr) {}

                // Check if file reference exists but file is gone from disk
                if (!shouldRemove) {
                    try {
                        var rmSource = rmItem.mainSource;
                        if (rmSource && rmSource.file && !rmSource.file.exists) {
                            shouldRemove = true;
                            rmReason = 'source file missing: ' + rmSource.file.fsName;
                        }
                    } catch (srcErr) {}
                }

                if (shouldRemove) {
                    // Don't remove if a remaining comp uses it as a layer source
                    var rmUsed = false;
                    for (var cui = 1; cui <= app.project.numItems; cui++) {
                        try {
                            var cuItem = app.project.item(cui);
                            if (!(cuItem instanceof CompItem)) continue;
                            for (var cli = 1; cli <= cuItem.numLayers; cli++) {
                                try {
                                    if (cuItem.layer(cli).source === rmItem) {
                                        rmUsed = true;
                                        break;
                                    }
                                } catch (clErr) {}
                            }
                            if (rmUsed) break;
                        } catch (cuErr) {}
                    }

                    var rmName = '';
                    try { rmName = rmItem.name || ('item ' + rmi); } catch (nmErr) { rmName = 'item ' + rmi; }
                    if (rmUsed) {
                        $.writeln("Blitzkrieg: Keeping missing footage (in use by comp): " + rmName);
                    } else {
                        try {
                            rmItem.remove();
                            removedMissingCount++;
                            $.writeln("Blitzkrieg: Removed missing footage before save: " + rmName + " (" + rmReason + ")");
                        } catch (rmErr) {
                            $.writeln("Blitzkrieg: Could not remove missing footage " + rmName + ": " + rmErr.toString());
                        }
                    }
                }
            } catch (rmiErr) {}
        }
        if (removedMissingCount > 0) {
            $.writeln("Blitzkrieg: Cleaned " + removedMissingCount + " missing footage item(s) before save.");
        }

        // Save the reduced project to library
        // Try the primary path first, then fallback strategies for macOS
        var finalAEPFile = new File(buildPath(compFolder, safeCompName + ".aep"));
        $.writeln("Blitzkrieg: Saving AEP to: " + finalAEPFile.fsName);
        try { app.project.save(finalAEPFile); } catch (saveErr1) {
            $.writeln("Blitzkrieg: save() threw at primary path: " + saveErr1.toString());
        }

        // MACFIX: Verify the AEP was actually saved - app.project.save() can fail silently on macOS
        if (!finalAEPFile.exists) {
            $.writeln("Blitzkrieg: WARNING - AEP save failed at primary path, trying fallback...");
            // Fallback: try saving with raw fsName path (no URI encoding)
            var rawAEPPath = compFolder.fsName + "/" + safeCompName + ".aep";
            var rawAEPFile = new File(rawAEPPath);
            try { app.project.save(rawAEPFile); } catch (saveErr2) {
                $.writeln("Blitzkrieg: save() threw at raw path: " + saveErr2.toString());
            }

            if (!rawAEPFile.exists) {
                $.writeln("Blitzkrieg: WARNING - AEP save failed at raw path too, trying comp.aep...");
                // Last resort: save as comp.aep using a simple filename
                var simpleAEPFile = new File(buildPath(compFolder, "comp.aep"));
                try { app.project.save(simpleAEPFile); } catch (saveErr3) {
                    $.writeln("Blitzkrieg: save() threw at simple path: " + saveErr3.toString());
                }

                if (!simpleAEPFile.exists) {
                    // Try one more time with raw path
                    var simpleRawFile = new File(compFolder.fsName + "/comp.aep");
                    try { app.project.save(simpleRawFile); } catch (saveErr4) {
                        $.writeln("Blitzkrieg: save() threw at simple raw path: " + saveErr4.toString());
                    }
                }
            }
        }

        // CRITICAL: Verify the AEP was actually saved somewhere. If NONE of the
        // fallback paths produced an .aep file, we must abort the stash — otherwise
        // the caller gets a "Success!" message but the comp folder contains only a
        // thumbnail and metadata, causing broken templates in the library and
        // "MISSING .aep" errors during downstream auto-generation.
        var savedAEP = robustFindAep(compFolder);
        if (!savedAEP) {
            $.writeln("Blitzkrieg: CRITICAL - No AEP file found after save attempts in: " + compFolder.fsName);
            // Attempt to clean up the half-written comp folder so it doesn't pollute the library.
            // Use removeFolderRecursive directly on compFolder which handles the null-getFiles
            // case on macOS internally by calling getFiles() inside its own scope.
            try {
                removeFolderRecursive(compFolder);
            } catch (cleanupErr) {
                $.writeln("Blitzkrieg: Could not clean up orphan comp folder " + compFolder.fsName + ": " + cleanupErr.toString());
            }
            app.endUndoGroup();
            // Restore original project before returning error
            if (originalProjectFile && originalProjectFile.exists) {
                try { app.open(originalProjectFile); } catch (rErr) {}
            }
            if (_stashDialogsSuppressed) { try { app.endSuppressDialogs(false); } catch(e) {} }
            return "Error: Failed to save .aep file after all fallback attempts. Composition was not added to the library. Check that the library path is writable and that the project is not locked.";
        }
        $.writeln("Blitzkrieg: AEP verified at: " + savedAEP.fsName);

        app.endUndoGroup();

        // --- Restore original project (NON-FATAL) ---
        // The stash is already complete and verified (savedAEP above), so a
        // failure to reopen the user's project must NOT discard the upload.
        // app.open() of a project with offline/unreadable footage can THROW
        // "After Effects error: Could not read from source" on AE 2024/2025
        // *while dialogs are suppressed* (the same hazard importComp handles at
        // its retry-without-suppression path). This bare app.open was the only
        // unguarded native op on the stash happy path: its throw escaped to the
        // outer catch, which returned "Error: ..." and made the panel discard a
        // fully-saved comp. So: try suppressed; if it throws, end suppression
        // and retry (a normal missing-files dialog is acceptable); only a
        // double-failure is surfaced, and even then as a Warning that still lets
        // the comp upload. generatePreviewsToDisk already guards this same open.
        var restoreFailed = false;
        if (originalProjectFile && originalProjectFile.exists) {
            try {
                app.open(originalProjectFile);
            } catch (restoreErr1) {
                $.writeln("Blitzkrieg: restore app.open threw under suppression, retrying unsuppressed: " + restoreErr1.toString());
                if (_stashDialogsSuppressed) { try { app.endSuppressDialogs(false); } catch(esd1) {} _stashDialogsSuppressed = false; }
                try {
                    app.open(originalProjectFile);
                } catch (restoreErr2) {
                    restoreFailed = true;
                    $.writeln("Blitzkrieg: restore app.open failed after unsuppressed retry: " + restoreErr2.toString());
                }
            }
        }

        // End dialog suppression if still active (the retry path may have already).
        if (_stashDialogsSuppressed) { try { app.endSuppressDialogs(false); } catch(e) {} _stashDialogsSuppressed = false; }

        // Soft note appended to every success/warning return when the project
        // could not be auto-reopened, so the editor knows their file is safe and
        // is not alarmed by seeing the reduced project AE is currently showing.
        var restoreNote = restoreFailed
            ? " (Note: After Effects could not reopen your project automatically. Your file on disk is safe - just reopen it from File > Open Recent.)"
            : "";

        // Clean up the temp project file we created on behalf of an unsaved user
        // project. The user's work is still in-memory in the restored project, so
        // the temp file is safe to delete — leaving it on disk would accumulate
        // one AEP per stash forever.
        if (originalProjectFile && originalProjectFile.fsName.indexOf("blitzkrieg_temp_") !== -1) {
            try { originalProjectFile.remove(); } catch (tmpRmErr) {
                $.writeln("Blitzkrieg: Could not remove temp project file: " + tmpRmErr.toString());
            }
        }

        if (missingTotalCount > 0) {
            var missingList = missingFootageItems.slice(0, 5).join('; ');
            if (missingFootageItems.length > 5) missingList += ' (+' + (missingFootageItems.length - 5) + ' more shown)';
            var countSuffix = (missingTotalCount > missingFootageItems.length)
                ? (missingTotalCount + ' footage file(s) (showing first ' + missingFootageItems.length + ')')
                : (missingTotalCount + ' footage file(s)');
            return "Warning: '" + compToSaveName + "' was added but " + countSuffix +
                   " were not fully collected: " + missingList +
                   ". Open the bundle in AE, relink the missing files, and re-stash to fix." + restoreNote;
        }

        // Memory-limit warning for stash: thumbnail/preview rendering hit AE's
        // "Memory allocation exceeds internal limit" error. The template still
        // uploaded but the previews are incomplete. Muhammad's tip surfaced as
        // actionable guidance for the editor.
        if (stashMemoryErrorHit) {
            return "Warning: '" + compToSaveName + "' was added but AE hit its memory limit while rendering previews. This usually means Motion Tile (or a similar effect) has very large Output Width/Height values. Lower those values and re-stash to get full preview frames." + restoreNote;
        }

        // If the restore failed, return a non-fatal Warning (executeAddComp
        // strips the "Warning:" prefix, shows it, and still uploads) rather than
        // a clean "Success!" that would hide the reduced project from the editor.
        if (restoreFailed) {
            return "Warning: '" + compToSaveName + "' was added to your library." + restoreNote;
        }
        return "Success! '" + compToSaveName + "' was added to your library.";

    } catch (e) {
        // Try to restore original project on error (keep dialog suppression
        // active so app.open doesn't trigger "missing files" dialogs)
        try {
            if (originalProjectFile && originalProjectFile.exists) {
                app.open(originalProjectFile);
            }
        } catch (restoreErr) {
            $.writeln("Blitzkrieg: Error restoring project: " + restoreErr.toString());
        }
        if (_stashDialogsSuppressed) { try { app.endSuppressDialogs(false); } catch(e2) {} }
        return "Error: " + e.toString();
    }
}


/**
 * OPTIMIZED: Imports a composition from the library
 * Performance improvements:
 * - Cached file paths
 * - Streamlined import process
 * - Faster comp discovery
 */
function importComp(aepPath, displayName) {
    if (!isValidPath(aepPath)) {
        return "Error: Invalid file path.";
    }

    try {
        if (!app.project) return "Error: Please open a project first.";

        var fileToImport = fileFromPath(aepPath);
        if (!fileToImport.exists) return "Error: Source AEP file not found.";

        // Use provided displayName (from JS side) or fall back to metadata.json
        var compName = displayName || "";

        if (!compName) {
            var parentFolder = fileToImport.parent;
            var metadataFile = new File(buildPath(parentFolder, "metadata.json"));
            if (metadataFile.exists) {
                try {
                    metadataFile.open('r');
                    var metaContent = metadataFile.read();
                    metadataFile.close();
                    if (metaContent) {
                        var metadata = JSON.parse(metaContent);
                        compName = metadata.displayName || "";
                    }
                } catch(e) {}
            }
        }
        if (!compName) compName = "Imported Comp";

        app.beginUndoGroup("Blitzkrieg Import");

        // Snapshot the project's existing top-level item IDs BEFORE importing.
        // CRITICAL (AE 2026 + missing-effect projects): when the imported .aep
        // references an effect the editor does not have installed (e.g. a
        // third-party plugin like "Deep Glow"), AE 2026's importFile() THROWS
        // "Object is invalid" — yet it STILL adds the import folder + comps to the
        // project (the comp is fully usable, just with that one effect disabled).
        // Trusting importFile()'s return/throw alone made us report "Import
        // returned no items" for a comp that actually imported fine. So after the
        // call we diff the project against this snapshot and adopt whatever new
        // top-level item appeared, regardless of whether importFile threw.
        var _preImportIds = {};
        try {
            for (var _pi = 1; _pi <= app.project.numItems; _pi++) {
                var _pit = app.project.item(_pi);
                if (_pit && _pit.parentFolder === app.project.rootFolder) _preImportIds[_pit.id] = true;
            }
        } catch (preErr) {}

        // Adopt whatever NEW top-level item(s) landed in the project vs the
        // snapshot. Prefers the newly-added folder (project-import container),
        // else the first new item. Returns null when nothing new appeared.
        function _adoptNewlyImported() {
            try {
                var newItems = [];
                for (var ni = 1; ni <= app.project.numItems; ni++) {
                    var nit = app.project.item(ni);
                    if (nit && nit.parentFolder === app.project.rootFolder && !_preImportIds[nit.id]) {
                        newItems.push(nit);
                    }
                }
                for (var fi2 = 0; fi2 < newItems.length; fi2++) {
                    if (newItems[fi2] instanceof FolderItem) return newItems[fi2];
                }
                if (newItems.length > 0) return newItems[0];
            } catch (scanErr) {}
            return null;
        }

        // Suppress "missing file" dialogs during import. On AE 2024+ this MAY
        // cause importFile to throw "Object is invalid" — if so, we catch it and
        // retry without suppression (dialog appears but import works).
        var _importDialogsSuppressed = false;
        try { app.beginSuppressDialogs(); _importDialogsSuppressed = true; } catch (sdErr) {}

        // Import with optimized settings
        var importOptions = new ImportOptions(fileToImport);
        importOptions.importAs = ImportAsType.PROJECT;

        var importedItem = null;
        var _importErrMsg = "";
        // Attempt 1 (suppressed).
        try {
            importedItem = app.project.importFile(importOptions);
        } catch (impErr) {
            _importErrMsg = (impErr && impErr.toString) ? impErr.toString() : String(impErr);
        }

        // If attempt 1 threw but the items still landed (missing-effect case),
        // adopt them and DO NOT retry — retrying would import a second copy.
        if (!importedItem) importedItem = _adoptNewlyImported();

        // Only retry unsuppressed if attempt 1 produced literally nothing new.
        if (!importedItem) {
            if (_importDialogsSuppressed) {
                try { app.endSuppressDialogs(false); } catch (ed) {}
                _importDialogsSuppressed = false;
            }
            try {
                var retryOpts = new ImportOptions(fileToImport);
                retryOpts.importAs = ImportAsType.PROJECT;
                importedItem = app.project.importFile(retryOpts);
            } catch (impErr2) {
                _importErrMsg = (impErr2 && impErr2.toString) ? impErr2.toString() : String(impErr2);
            }
            if (!importedItem) importedItem = _adoptNewlyImported();
        }

        if (_importDialogsSuppressed) {
            try { app.endSuppressDialogs(false); } catch (edErr) {}
            _importDialogsSuppressed = false;
        }

        if (!importedItem) {
            app.endUndoGroup();
            // Surface the real importFile exception so a genuine failure is
            // diagnosable instead of the opaque "returned no items".
            if (_importErrMsg) return "Error: Import failed (" + _importErrMsg + ").";
            return "Error: Import returned no items.";
        }

        // Re-arm dialog suppression for the relink + cleanup + open phase. The
        // AE-native import warnings that block a batch (e.g. "Object Matte will not
        // render correctly because the source frame rate changed from 24 to 30 fps",
        // plus file-not-found / could-not-open alerts) fire during footage replace()
        // and openInViewer() below, NOT during importFile - so the suppression that
        // ended right after importFile lets them leak. Re-arming here covers both the
        // first-attempt-success and the unsuppressed-retry paths uniformly.
        try { app.beginSuppressDialogs(); _importDialogsSuppressed = true; } catch (sdErr2) {}

        // Recursive comp discovery — imported AEPs can have nested folders.
        // Strategy: collect ALL comps, then pick the best one.
        //  1. Exact name match → use it
        //  2. Top-level comp (not used as a pre-comp by any other comp in the
        //     import) → the "main" comp the user wants to see
        //  3. First comp found → last resort
        var mainComp = null;
        var _allImportedComps = [];
        function collectCompsInFolder(folder) {
            for (var j = 1; j <= folder.numItems; j++) {
                var child = folder.item(j);
                if (child instanceof CompItem) {
                    _allImportedComps.push(child);
                } else if (child instanceof FolderItem) {
                    collectCompsInFolder(child);
                }
            }
        }
        if (importedItem instanceof FolderItem) {
            importedItem.name = compName + " [Blitzkrieg]";
            collectCompsInFolder(importedItem);
        } else if (importedItem instanceof CompItem) {
            _allImportedComps.push(importedItem);
        }

        // Pick the best comp from the collected list
        if (_allImportedComps.length === 1) {
            mainComp = _allImportedComps[0];
        } else if (_allImportedComps.length > 1) {
            // Check for exact name match first
            for (var cni = 0; cni < _allImportedComps.length; cni++) {
                if (_allImportedComps[cni].name === compName) {
                    mainComp = _allImportedComps[cni];
                    break;
                }
            }
            // No exact match — find the top-level comp (one not used as a
            // pre-comp source by any other comp in this import)
            if (!mainComp) {
                var _usedAsPrecomp = {};
                for (var sci = 0; sci < _allImportedComps.length; sci++) {
                    var scanComp = _allImportedComps[sci];
                    for (var sli = 1; sli <= scanComp.numLayers; sli++) {
                        try {
                            var slyr = scanComp.layer(sli);
                            if (slyr.source instanceof CompItem) {
                                _usedAsPrecomp[slyr.source.id] = true;
                            }
                        } catch (slErr) {}
                    }
                }
                for (var tli = 0; tli < _allImportedComps.length; tli++) {
                    if (!_usedAsPrecomp[_allImportedComps[tli].id]) {
                        mainComp = _allImportedComps[tli];
                        break;
                    }
                }
            }
            // Still nothing — use first comp as absolute fallback
            if (!mainComp) mainComp = _allImportedComps[0];
        }

        // --- Relink missing footage to the downloaded (Footage)/ bundle ---
        // Stashed AEPs embed absolute footage paths from the uploader's machine.
        // After download into a fresh temp dir those absolute paths are dead, and
        // AE's relative-path fallback does not always re-resolve them (renamed AEP,
        // moved dir). Before the cleanup pass below deletes anything, build a
        // basename index of the sibling (Footage)/ folder and re-point every missing
        // FootageItem at its collected copy. This is the canonical relink the
        // importer previously lacked — without it, missing footage was simply
        // deleted, producing the "missing element/source files" symptom.
        var _relinkStats = { relinked: 0, missing: 0, missingNames: [], survivingMissing: 0, survivingNames: [], survivingImages: 0, survivingImageNames: [] };
        // A still image (png/jpg/etc.) going missing is almost always a decorative
        // asset that does not break the composition — per Petter, "missing footage is
        // usually just images, nothing important." So we classify surviving-missing
        // footage: images get a gentle, non-actionable note; only non-image sources
        // (video/audio/sequences) raise the "needs re-stash" warning.
        var _isImageBasename = function (nm) {
            if (!nm) return false;
            var lower = String(nm).toLowerCase();
            var dot = lower.lastIndexOf('.');
            if (dot < 0) return false;
            var ext = lower.substring(dot + 1);
            return ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' ||
                   ext === 'tif' || ext === 'tiff' || ext === 'bmp' || ext === 'psd' ||
                   ext === 'webp' || ext === 'heic';
        };
        if (importedItem instanceof FolderItem) {
            var _footageIndex = {};   // lowercased basename -> File
            var _indexBuilt = false;
            // Filenames that live inside a template/(Footage) tree but are never
            // footage. They must not become relink candidates, or a footage item
            // literally named comp.png could bind to the thumbnail, and a linked
            // dependency's own .aep could shadow a real source.
            var _isFootageName = function (bn) {
                var l = String(bn).toLowerCase();
                if (l === 'metadata.json' || l === 'comp.png' || l === 'thumbnail.png' || l === 'thumbnail.jpg') return false;
                if (l.length >= 4 && l.indexOf('.aep', l.length - 4) !== -1) return false;
                return true;
            };
            var _buildFootageIndex = function () {
                if (_indexBuilt) return;
                _indexBuilt = true;
                try {
                    var aepDir = fileToImport.parent;
                    var fRoot = new Folder(buildPath(aepDir, "(Footage)"));
                    // Walk in PRIORITY order so the index is deterministic: the
                    // template's OWN footage must always win over a same-named copy
                    // inside a dependency bundle or sitting flat beside the AEP.
                    // getFiles() entry order is not guaranteed by AE, so ties must
                    // be resolved by walk order, never by filesystem ordering.
                    var _walk = function (folder, depth, skip) {
                        if (depth > 6) return;                 // bound recursion
                        var entries;
                        try { entries = folder.getFiles(); } catch (gfErr) { return; }
                        if (!entries) return;
                        for (var wi = 0; wi < entries.length; wi++) {
                            var ent = entries[wi];
                            if (ent instanceof Folder) {
                                var fn = '';
                                try { fn = String(ent.name || '').toLowerCase(); } catch (e) {}
                                if (skip && skip[fn]) continue;
                                _walk(ent, depth + 1, skip);
                            } else if (ent instanceof File) {
                                var bn = '';
                                try { bn = safeDecodeURI(String(ent.name)); } catch (dnErr) { bn = String(ent.name); }
                                if (!bn || bn.indexOf('._') === 0) continue;  // skip mac resource forks
                                if (!_isFootageName(bn)) continue;
                                var key = bn.toLowerCase();
                                if (!_footageIndex[key]) _footageIndex[key] = ent;  // first match wins
                            }
                        }
                    };
                    // Pass 1: the template's own footage (authoritative). Skip the
                    // dependency bundle and preview-frame noise.
                    if (fRoot.exists) _walk(fRoot, 0, { 'preview': 1, '_deps': 1 });
                    // Pass 2: dependency footage — fills only the gaps Pass 1 left.
                    var depsRoot = new Folder(buildPath(fRoot, "_deps"));
                    if (depsRoot.exists) _walk(depsRoot, 0, { 'preview': 1 });
                    // Pass 3: flat footage written beside the AEP (templates stored
                    // without a (Footage)/ subfolder). Skip the (Footage) tree we
                    // already indexed above to avoid a redundant full re-walk.
                    if (aepDir && aepDir.exists) _walk(aepDir, 0, { 'preview': 1, '_deps': 1, '(footage)': 1 });
                } catch (biErr) {}
            };
            var _basenameOf = function (item) {
                // Prefer the File object's name (survives even when the file is
                // missing on disk); fall back to the FootageItem's own name.
                try {
                    if (item.mainSource && item.mainSource.file) {
                        var n = String(item.mainSource.file.name || '');
                        if (n) { try { return safeDecodeURI(n); } catch (e) { return n; } }
                    }
                } catch (e1) {}
                try { return String(item.name || ''); } catch (e2) { return ''; }
            };
            var _relinkMissing = function (folder) {
                for (var ri = 1; ri <= folder.numItems; ri++) {
                    var rItem;
                    try { rItem = folder.item(ri); } catch (e) { continue; }
                    if (rItem instanceof FolderItem) { _relinkMissing(rItem); continue; }
                    if (!(rItem instanceof FootageItem)) continue;
                    var isMissing = false;
                    try { isMissing = !!rItem.footageMissing; } catch (e) {}
                    if (!isMissing) {
                        try {
                            if (rItem.mainSource && rItem.mainSource.file && !rItem.mainSource.file.exists) isMissing = true;
                        } catch (e) {}
                    }
                    if (!isMissing) continue;
                    _buildFootageIndex();
                    var base = _basenameOf(rItem);
                    var match = base ? _footageIndex[base.toLowerCase()] : null;
                    if (match && match.exists) {
                        try {
                            rItem.replace(match);
                            _relinkStats.relinked++;
                            continue;
                        } catch (rpErr) {
                            $.writeln("Blitzkrieg: relink replace() failed for " + base + " — " + rpErr.toString());
                        }
                    }
                    _relinkStats.missing++;
                    if (_relinkStats.missingNames.length < 30 && base) _relinkStats.missingNames.push(base);
                }
            };
            try { _relinkMissing(importedItem); } catch (rmErr) {}
            if (_relinkStats.relinked > 0 || _relinkStats.missing > 0) {
                $.writeln("Blitzkrieg: relink — " + _relinkStats.relinked + " relinked, " + _relinkStats.missing + " still missing.");
            }
        }

        // --- Clean up missing footage from imported project ---
        // Templates with broken file references leave broken items in the
        // project panel. Remove unused missing footage to keep things clean.
        if (importedItem instanceof FolderItem) {
            var _cleanupMissing = function(folder) {
                for (var ci = folder.numItems; ci >= 1; ci--) {
                    try {
                        var cItem = folder.item(ci);
                        if (cItem instanceof FolderItem) {
                            _cleanupMissing(cItem);
                            if (cItem.numItems === 0) {
                                try { cItem.remove(); } catch (efErr) {}
                            }
                        } else if (cItem instanceof FootageItem) {
                            var cMissing = false;
                            try { cMissing = !!cItem.footageMissing; } catch (fmChk) {}
                            if (!cMissing) {
                                try {
                                    if (cItem.mainSource && cItem.mainSource.file && !cItem.mainSource.file.exists) {
                                        cMissing = true;
                                    }
                                } catch (srcChk) {}
                            }
                            if (cMissing) {
                                // Don't remove if used as a layer source in
                                // mainComp or any of its nested pre-comps.
                                var isUsed = false;
                                var _seenComps = {};
                                var _checkUsage = function(comp, item) {
                                    if (_seenComps[comp.id]) return false;
                                    _seenComps[comp.id] = true;
                                    for (var li = 1; li <= comp.numLayers; li++) {
                                        try {
                                            var lyr = comp.layer(li);
                                            if (lyr.source === item) return true;
                                            if (lyr.source instanceof CompItem) {
                                                if (_checkUsage(lyr.source, item)) return true;
                                            }
                                        } catch (lErr) {}
                                    }
                                    return false;
                                };
                                // Check usage across EVERY imported comp, not just
                                // mainComp, so footage referenced by a sibling/nested
                                // comp is preserved as a visible, relinkable missing
                                // placeholder rather than silently deleted (which
                                // produced the "comp won't load into the timeline" bug).
                                for (var _uci = 0; _uci < _allImportedComps.length; _uci++) {
                                    _seenComps = {};
                                    if (_checkUsage(_allImportedComps[_uci], cItem)) { isUsed = true; break; }
                                }
                                if (!isUsed && mainComp) {
                                    _seenComps = {};
                                    isUsed = _checkUsage(mainComp, cItem);
                                }
                                if (!isUsed) {
                                    try { cItem.remove(); } catch (rmErr) {}
                                }
                            }
                        }
                    } catch (ciErr) {}
                }
            };
            _cleanupMissing(importedItem);

            // Re-tally AFTER cleanup so the warning reflects reality. The relink
            // pass counts every un-relinkable source, but the cleanup pass above
            // just DELETED the ones no comp uses. Only footage that survived
            // (because a comp references it) AND is still missing on disk is a
            // genuine problem worth warning the user about. Counting pre-cleanup
            // would fire a scary "could not relink" alert on a perfectly intact
            // import that merely carried unused-missing leftovers.
            var _scanSurviving = function (folder) {
                for (var si = 1; si <= folder.numItems; si++) {
                    var sItem;
                    try { sItem = folder.item(si); } catch (e) { continue; }
                    if (sItem instanceof FolderItem) { _scanSurviving(sItem); continue; }
                    if (!(sItem instanceof FootageItem)) continue;
                    var sMiss = false;
                    try { sMiss = !!sItem.footageMissing; } catch (e) {}
                    if (!sMiss) {
                        try {
                            if (sItem.mainSource && sItem.mainSource.file && !sItem.mainSource.file.exists) sMiss = true;
                        } catch (e) {}
                    }
                    if (sMiss) {
                        var _nm = '';
                        try { _nm = String(sItem.name || ''); } catch (e) { _nm = ''; }
                        if (_isImageBasename(_nm)) {
                            // Decorative image — count separately, do NOT flag re-stash.
                            _relinkStats.survivingImages++;
                            if (_relinkStats.survivingImageNames.length < 30) _relinkStats.survivingImageNames.push(_nm);
                        } else {
                            _relinkStats.survivingMissing++;
                            if (_relinkStats.survivingNames.length < 30) _relinkStats.survivingNames.push(_nm);
                        }
                    }
                }
            };
            try { _scanSurviving(importedItem); } catch (e) {}
        }

        if (mainComp && mainComp.name !== compName) {
            mainComp.name = compName;
        }

        // AUTO-OPEN: Open the imported comp in the viewer/timeline.
        // openInViewer() during ExtendScript eval often fails because the CEP panel
        // holds focus. We schedule a single delayed attempt that uses a generation
        // counter to prevent stale tasks from opening the wrong comp.
        if (mainComp) {
            _blitzImportGeneration++;
            var _thisGen = _blitzImportGeneration;

            try {
                mainComp.selected = true;
                var v = mainComp.openInViewer();
                if (v) try { v.setActive(); } catch(e) {}
            } catch (viewerErr) {}

            // Build a script that finds the comp. Uses a hybrid approach:
            //  1. Try by comp ID first (reliable within same project session)
            //  2. Fall back to name if ID not found (handles edge cases)
            // The generation counter guards against stale tasks from a prior
            // import firing and opening the wrong comp.
            var _safeName = compName.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
            var _openScript =
                '(function(){' +
                '  if(_blitzImportGeneration!==' + _thisGen + ')return;' +
                '  function open(c){var s=false;try{app.beginSuppressDialogs();s=true;}catch(e){}try{c.selected=true;var v=c.openInViewer();if(v){try{v.setActive();}catch(e){}}}catch(e){}if(s){try{app.endSuppressDialogs(false);}catch(e){}}}' +
                '  function findById(p){' +
                '    for(var i=1;i<=p.numItems;i++){' +
                '      try{' +
                '        var it=p.item(i);' +
                '        if(it instanceof CompItem && it.id==' + mainComp.id + '){open(it);return true;}' +
                '        if(it instanceof FolderItem && findById(it))return true;' +
                '      }catch(e){}' +
                '    }' +
                '    return false;' +
                '  }' +
                '  function findByName(p){' +
                '    for(var i=1;i<=p.numItems;i++){' +
                '      try{' +
                '        var it=p.item(i);' +
                '        if(it instanceof CompItem && it.name===\'' + _safeName + '\'){open(it);return true;}' +
                '        if(it instanceof FolderItem && findByName(it))return true;' +
                '      }catch(e){}' +
                '    }' +
                '    return false;' +
                '  }' +
                '  if(!findById(app.project.rootFolder))findByName(app.project.rootFolder);' +
                '})()';

            // Single delayed attempt — the immediate openInViewer above handles
            // the fast path; this catches the case where CEP still holds focus.
            try { app.scheduleTask(_openScript, 500, false); } catch(e) {}
        }

        // End the relink/open-phase suppression re-armed after import. The scheduled
        // openInViewer task registered above re-arms its own suppression because it
        // runs ~500ms later, outside this synchronous scope.
        if (_importDialogsSuppressed) {
            try { app.endSuppressDialogs(false); } catch (edPhaseErr) {}
            _importDialogsSuppressed = false;
        }
        app.endUndoGroup();
        var _resultMsg = mainComp ? "Success: '" + compName + "' imported." : "Success: Project imported.";
        // Append a clear, parseable warning ONLY for footage that survived cleanup
        // (a comp actually uses it) yet is still missing on disk, so the panel can
        // tell the user instead of presenting a silently-broken comp. Unused-missing
        // leftovers were deleted above and must not raise a false alarm.
        if (_relinkStats.survivingMissing > 0) {
            var _shown = _relinkStats.survivingNames.slice(0, 5).join(", ");
            if (_relinkStats.survivingMissing > 5) _shown += ", ...";
            _resultMsg += " [BLITZ_MISSING:" + _relinkStats.survivingMissing + "] Warning: " +
                _relinkStats.survivingMissing + " source file" + (_relinkStats.survivingMissing === 1 ? "" : "s") +
                " could not be relinked" + (_shown ? " (" + _shown + ")" : "") +
                ". Open the comp and relink, or re-stash the template.";
        }
        // Images are treated as non-critical: report them as a soft note (no
        // [BLITZ_MISSING] marker, so the panel does NOT flag the template for
        // re-stash) so the composition still imports and uses cleanly.
        if (_relinkStats.survivingImages > 0) {
            var _imgShown = _relinkStats.survivingImageNames.slice(0, 5).join(", ");
            if (_relinkStats.survivingImages > 5) _imgShown += ", ...";
            _resultMsg += " [BLITZ_IMG_MISSING:" + _relinkStats.survivingImages + "] Note: " +
                _relinkStats.survivingImages + " image" + (_relinkStats.survivingImages === 1 ? "" : "s") +
                " not found" + (_imgShown ? " (" + _imgShown + ")" : "") +
                ". These are usually decorative and safe to ignore.";
        }
        return _resultMsg;

    } catch (e) {
        if (_importDialogsSuppressed) {
            try { app.endSuppressDialogs(false); } catch (edErr) {}
        }
        try { app.endUndoGroup(); } catch(ue) {}
        return "Error: " + e.toString();
    }
}


function renameStashedComp(libraryPath, category, uniqueId, newName) {
    // Validate inputs
    if (!isValidPath(libraryPath)) {
        return "Error: Invalid library path.";
    }
    if (!isValidName(category) || !isValidName(uniqueId)) {
        return "Error: Invalid category or ID.";
    }
    if (!isValidName(newName)) {
        return "Error: Invalid name. Names cannot contain path separators.";
    }

    try {
        var aepFolder = folderFromPath(libraryPath + "/" + category + "/" + uniqueId);
        var metadataFile = new File(buildPath(aepFolder, "metadata.json"));
        var metadata = {};
        if (metadataFile.exists) {
            try {
                metadataFile.open('r');
                metadata = JSON.parse(metadataFile.read());
            } catch (metaReadErr) {
                $.writeln("Blitzkrieg: renameStashedComp - metadata parse failed: " + metaReadErr.toString());
                metadata = {};
            }
            try { metadataFile.close(); } catch (mcErr) {}
        }
        metadata.displayName = newName;
        metadataFile.open('w');
        metadataFile.encoding = 'UTF-8';
        metadataFile.write(JSON.stringify(metadata));
        metadataFile.close();

        // Also rename the .aep file itself for consistency — use robustFindAep to avoid
        // the bare "*.aep" glob which can return null on macOS with URI-encoded paths.
        var oldAEP = robustFindAep(aepFolder);
        if (oldAEP) {
            var safeNewName = newName.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '');
            if (!safeNewName) safeNewName = 'comp';
            try { oldAEP.rename(safeNewName + ".aep"); } catch (renErr) {
                $.writeln("Blitzkrieg: renameStashedComp - AEP rename failed: " + renErr.toString());
            }
        }

        return "Success";
    } catch(e) {
        return "Error: " + e.toString();
    }
}

function deleteStashedComp(libraryPath, category, uniqueId) {
    // Validate inputs
    if (!isValidPath(libraryPath)) {
        return "Error: Invalid library path.";
    }
    if (!isValidName(category) || !isValidName(uniqueId)) {
        return "Error: Invalid category or ID.";
    }

    try {
        var compFolderPath = libraryPath + "/" + category + "/" + uniqueId;
        var compFolder = folderFromPath(compFolderPath);
        if (compFolder.exists) {
            removeFolderRecursive(compFolder);
            return "Success";
        }
        return "Error: Folder not found.";
    } catch(e) {
        return "Error: " + e.toString();
    }
}

/**
 * RENAME CATEGORY - Renames a category folder in the library
 * @param {string} libraryPath - Path to the library root
 * @param {string} oldName - Current category name
 * @param {string} newName - New category name
 * @returns {string} - Success message or error
 */
function renameCategory(libraryPath, oldName, newName) {
    // Validate inputs
    if (!isValidPath(libraryPath)) {
        return "Error: Invalid library path.";
    }
    if (!isValidName(oldName) || !isValidName(newName)) {
        return "Error: Invalid category name. Names cannot contain path separators.";
    }
    if (oldName === newName) {
        return "Error: New name is the same as the current name.";
    }

    try {
        var oldFolder = folderFromPath(libraryPath + "/" + oldName);
        if (!oldFolder.exists) {
            return "Error: Category folder not found.";
        }

        // Check if a category with the new name already exists
        var newFolder = folderFromPath(libraryPath + "/" + newName);
        if (newFolder.exists) {
            return "Error: A category with that name already exists.";
        }

        // Rename the folder
        if (oldFolder.rename(newName)) {
            // Update metadata.json in each comp folder to reflect new category.
            // Use robustGetFolders so the macOS URI-encoding bugs that getFiles()
            // hits with literal-filter callbacks don't silently skip the metadata
            // refresh and leave every comp's `metadata.category` field stale.
            var renamedFolder = folderFromPath(libraryPath + "/" + newName);
            var compFolders = robustGetFolders(renamedFolder);
            for (var i = 0; i < compFolders.length; i++) {
                var metadataFile = new File(buildPath(compFolders[i], "metadata.json"));
                if (metadataFile.exists) {
                    try {
                        metadataFile.open('r');
                        metadataFile.encoding = 'UTF-8';
                        var metaRaw = metadataFile.read();
                        metadataFile.close();

                        var metadata = JSON.parse(metaRaw);
                        metadata.category = newName;

                        metadataFile.open('w');
                        metadataFile.encoding = 'UTF-8';
                        metadataFile.write(JSON.stringify(metadata));
                        metadataFile.close();
                    } catch (metaErr) {
                        try { metadataFile.close(); } catch (mcErr) {}
                        $.writeln("Blitzkrieg: Warning - Could not update metadata for comp: " + metaErr.toString());
                    }
                }
            }
            return "Success: Category renamed to '" + newName + "'.";
        } else {
            return "Error: Could not rename the category folder.";
        }
    } catch(e) {
        return "Error: " + e.toString();
    }
}

/**
 * DELETE CATEGORY - Deletes an entire category and all its comps
 * @param {string} libraryPath - Path to the library root
 * @param {string} categoryName - Category to delete
 * @returns {string} - Success message or error
 */
function deleteCategory(libraryPath, categoryName) {
    // Validate inputs
    if (!isValidPath(libraryPath)) {
        return "Error: Invalid library path.";
    }
    if (!isValidName(categoryName)) {
        return "Error: Invalid category name.";
    }

    try {
        var categoryFolder = folderFromPath(libraryPath + "/" + categoryName);
        if (!categoryFolder.exists) {
            return "Error: Category folder not found.";
        }

        removeFolderRecursive(categoryFolder);
        return "Success: Category '" + categoryName + "' deleted.";
    } catch(e) {
        return "Error: " + e.toString();
    }
}

/**
 * MOVE COMP TO CATEGORY - Moves a comp from one category to another
 * @param {string} libraryPath - Path to the library root
 * @param {string} uniqueId - The comp's unique folder ID
 * @param {string} oldCategory - Current category name
 * @param {string} newCategory - Target category name
 * @returns {string} - Success message or error
 */
function moveCompToCategory(libraryPath, uniqueId, oldCategory, newCategory) {
    // Validate inputs
    if (!isValidPath(libraryPath)) {
        return "Error: Invalid library path.";
    }
    if (!isValidName(uniqueId) || !isValidName(oldCategory) || !isValidName(newCategory)) {
        return "Error: Invalid parameters.";
    }
    if (oldCategory === newCategory) {
        return "Error: Comp is already in that category.";
    }

    try {
        var sourceFolder = folderFromPath(libraryPath + "/" + oldCategory + "/" + uniqueId);
        if (!sourceFolder.exists) {
            return "Error: Source comp folder not found.";
        }

        // Ensure target category exists
        var targetCategoryFolder = folderFromPath(libraryPath + "/" + newCategory);
        if (!targetCategoryFolder.exists) {
            if (!targetCategoryFolder.create()) {
                return "Error: Could not create target category folder.";
            }
        }

        var targetFolder = folderFromPath(libraryPath + "/" + newCategory + "/" + uniqueId);
        if (targetFolder.exists) {
            return "Error: A comp with the same ID already exists in the target category.";
        }

        // Move by renaming (works on same volume)
        // First try direct rename
        var targetPath = libraryPath + "/" + newCategory + "/" + uniqueId;

        // Copy all files recursively. Throws on the first failed copy() so we
        // never silently delete the source after a partial copy — that was the
        // previous data-loss bug.
        function copyFolderRecursive(source, target) {
            if (!target.exists) target.create();
            if (!target.exists) throw new Error('Could not create target folder: ' + target.fsName);
            var items = source.getFiles();
            if (!items) return; // empty / inaccessible folder
            for (var i = 0; i < items.length; i++) {
                if (items[i] instanceof File) {
                    var destFile = new File(buildPath(target, items[i].name));
                    if (!items[i].copy(destFile) || !destFile.exists) {
                        throw new Error('Copy failed for ' + items[i].name);
                    }
                } else if (items[i] instanceof Folder) {
                    var destFolder = new Folder(buildPath(target, items[i].name));
                    copyFolderRecursive(items[i], destFolder);
                }
            }
        }

        // Copy to new location. If anything fails, abort the move and roll back
        // the partial copy so the user's source folder is preserved.
        try {
            copyFolderRecursive(sourceFolder, targetFolder);
        } catch (copyErr) {
            try { removeFolderRecursive(targetFolder); } catch (rbErr) {}
            return "Error: Move aborted — copy failed: " + copyErr.toString();
        }

        // Update metadata.json with new category
        var metadataFile = new File(buildPath(targetFolder, "metadata.json"));
        if (metadataFile.exists) {
            try {
                metadataFile.open('r');
                metadataFile.encoding = 'UTF-8';
                var metaRaw = metadataFile.read();
                metadataFile.close();

                var metadata = JSON.parse(metaRaw);
                metadata.category = newCategory;

                metadataFile.open('w');
                metadataFile.encoding = 'UTF-8';
                metadataFile.write(JSON.stringify(metadata));
                metadataFile.close();
            } catch (metaErr) {
                try { metadataFile.close(); } catch (mcErr) {}
                $.writeln("Blitzkrieg: Warning - Could not update metadata: " + metaErr.toString());
            }
        }

        // Remove original folder ONLY after we know the copy succeeded.
        try {
            removeFolderRecursive(sourceFolder);
        } catch (rmErr) {
            // Copy succeeded but source cleanup failed — comp exists in both locations.
            // Not data loss, but user should know.
            $.writeln("Blitzkrieg: moveComp - source cleanup failed: " + rmErr.toString());
            return "Warning: Comp copied to '" + newCategory + "' but original folder could not be removed. Please delete it manually.";
        }

        return "Success: Comp moved to '" + newCategory + "'.";
    } catch(e) {
        return "Error: " + e.toString();
    }
}

/**
 * CREATE CATEGORY - Creates a new empty category folder
 * @param {string} libraryPath - Path to the library root
 * @param {string} categoryName - Name of the new category
 * @returns {string} - Success message or error
 */
function createCategory(libraryPath, categoryName) {
    // Validate inputs
    if (!isValidPath(libraryPath)) {
        return "Error: Invalid library path.";
    }
    if (!isValidName(categoryName)) {
        return "Error: Invalid category name. Names cannot contain path separators.";
    }

    try {
        var categoryFolder = folderFromPath(libraryPath + "/" + categoryName);
        if (categoryFolder.exists) {
            return "Error: A category with that name already exists.";
        }

        if (categoryFolder.create()) {
            return "Success: Category '" + categoryName + "' created.";
        } else {
            return "Error: Could not create category folder.";
        }
    } catch(e) {
        return "Error: " + e.toString();
    }
}

/**
 * GENERATE PREVIEW FRAMES - Creates preview animation frames for an existing stashed comp
 * This allows users to add preview capability to comps that were saved before the feature existed
 * @param {string} aepPath - Path to the .aep file in the library
 * @returns {string} - Success message with frame count or error
 */
function generatePreviewFrames(aepPath) {
    // Validate input
    if (!isValidPath(aepPath)) {
        return "Error: Invalid file path.";
    }

    var originalProjectFile = null;
    var projectWasDirty = false;

    try {
        if (!app.project) {
            return "Error: Please open a project first.";
        }

        // Store original project reference
        originalProjectFile = app.project.file;
        projectWasDirty = app.project.dirty;

        var aepFile = fileFromPath(aepPath);
        if (!aepFile.exists) {
            return "Error: AEP file not found at: " + aepPath;
        }

        var compFolder = aepFile.parent;
        var previewFolder = new Folder(buildPath(compFolder, "preview"));

        // Remove existing preview folder contents if it exists
        if (previewFolder.exists) {
            // getFiles() can return null on macOS with URI-encoded paths — guard it
            // or the .length access below throws.
            var existingFiles = previewFolder.getFiles();
            if (existingFiles) {
                for (var ef = 0; ef < existingFiles.length; ef++) {
                    if (existingFiles[ef] instanceof File) {
                        try { existingFiles[ef].remove(); } catch (efErr) {}
                    }
                }
            }
        } else {
            previewFolder.create();
        }

        // Temporarily import the AEP to generate frames.
        // Suppress dialogs; if AE 2024+ throws, retry without suppression.
        var _genFrameDialogsSuppressed = false;
        try { app.beginSuppressDialogs(); _genFrameDialogsSuppressed = true; } catch (sdErr) {}
        var importOptions = new ImportOptions(aepFile);
        importOptions.importAs = ImportAsType.PROJECT;
        var importedItem = null;
        try {
            importedItem = app.project.importFile(importOptions);
        } catch (gfImpErr) {
            if (_genFrameDialogsSuppressed) {
                try { app.endSuppressDialogs(false); } catch (ed) {}
                _genFrameDialogsSuppressed = false;
            }
            try {
                var retryOpts = new ImportOptions(aepFile);
                retryOpts.importAs = ImportAsType.PROJECT;
                importedItem = app.project.importFile(retryOpts);
            } catch (gfImpErr2) { /* both failed */ }
        }
        if (_genFrameDialogsSuppressed) {
            try { app.endSuppressDialogs(false); } catch (edErr) {}
            _genFrameDialogsSuppressed = false;
        }

        if (!importedItem) {
            // Restore the original project before returning so we don't leak the
            // user's current context into the blitzkrieg temp AEP.
            // Suppress dialogs around open() to prevent "missing files" dialogs.
            if (originalProjectFile && originalProjectFile.exists) {
                try { app.beginSuppressDialogs(); } catch (sd) {}
                try { app.open(originalProjectFile); } catch (restImpErr) {}
                try { app.endSuppressDialogs(false); } catch (ed) {}
            }
            return "Error: Could not import composition for preview generation.";
        }

        // Find the main composition — recurse into nested folders so AEPs with
        // folder-organized comps don't fail with "No composition found".
        var mainComp = null;
        if (importedItem instanceof FolderItem) {
            var _searchForComp = function(folder) {
                for (var i = 1; i <= folder.numItems; i++) {
                    if (folder.item(i) instanceof CompItem) return folder.item(i);
                }
                for (var j = 1; j <= folder.numItems; j++) {
                    if (folder.item(j) instanceof FolderItem) {
                        var found = _searchForComp(folder.item(j));
                        if (found) return found;
                    }
                }
                return null;
            };
            mainComp = _searchForComp(importedItem);
        } else if (importedItem instanceof CompItem) {
            mainComp = importedItem;
        }

        if (!mainComp) {
            // Clean up imported item — wrap in try/catch because AE may
            // refuse the remove() if it's holding a reference (e.g. an
            // active render or selection). Without the guard, the throw
            // escapes the outer try and stashInProgress in main.js stays
            // pinned `true` forever, freezing the panel until restart.
            try { if (importedItem) importedItem.remove(); } catch (remErr) {
                $.writeln("Blitzkrieg: Warning - importedItem.remove() failed: " + remErr.toString());
            }
            importedItem = null;
            return "Error: No composition found in the project file.";
        }

        // Generate preview frames
        var previewFrameCount = 0;
        var compDuration = mainComp.workAreaDuration;
        var frameRate = mainComp.frameRate || 30;
        var totalFrames = Math.floor(compDuration * frameRate);

        if (totalFrames > 1) {
            // Shared dynamic-frame-count logic (see computePreviewFrameCount)
            var actualFrameCount = computePreviewFrameCount(compDuration, totalFrames);

            for (var pf = 0; pf < actualFrameCount; pf++) {
                try {
                    // FIXED: Evenly distribute frames across ENTIRE duration
                    // Frame 0 = start, Last frame = end (ensures full coverage)
                    var progress = (actualFrameCount > 1) ? (pf / (actualFrameCount - 1)) : 0;
                    var previewTime = mainComp.workAreaStart + (progress * compDuration);

                    var previewFile = new File(buildPath(previewFolder, "frame_" + pf + ".png"));
                    mainComp.saveFrameToPng(previewTime, previewFile);
                    // AE 2026 async flush — only count the frame once it lands.
                    if (_waitForFileFlush(previewFile, 3000)) previewFrameCount++;
                } catch (previewErr) {
                    $.writeln("Blitzkrieg: Warning - Could not generate preview frame " + pf + ": " + previewErr.toString());
                }
            }

            // Also regenerate the main thumbnail
            try {
                var thumbFile = new File(buildPath(compFolder, "comp.png"));
                var thumbTime = mainComp.workAreaStart + (mainComp.workAreaDuration / 2);
                mainComp.saveFrameToPng(thumbTime, thumbFile);
                // AE 2026 async flush — ensure the PNG lands before we remove the
                // imported project / restore the user's project below.
                _waitForFileFlush(thumbFile, 5000);
            } catch (thumbErr) {
                $.writeln("Blitzkrieg: Warning - Could not regenerate thumbnail: " + thumbErr.toString());
            }
        }

        // Update metadata with preview frame count
        var metadataFile = new File(buildPath(compFolder, "metadata.json"));
        if (metadataFile.exists) {
            try {
                metadataFile.open('r');
                metadataFile.encoding = 'UTF-8';
                var metaRaw = metadataFile.read();
                metadataFile.close();

                var metadata = JSON.parse(metaRaw);
                metadata.previewFrames = previewFrameCount;
                metadata.duration = mainComp.workAreaDuration;
                metadata.frameRate = mainComp.frameRate;
                metadata.width = mainComp.width;
                metadata.height = mainComp.height;
                metadata.aeVersion = AE_VERSION_INFO.versionString;

                metadataFile.open('w');
                metadataFile.encoding = 'UTF-8';
                metadataFile.write(JSON.stringify(metadata));
                metadataFile.close();
            } catch (metaErr) {
                try { metadataFile.close(); } catch (mcErr) {}
                $.writeln("Blitzkrieg: Warning - Could not update metadata: " + metaErr.toString());
            }
        }

        // Clean up - remove imported project. try/catch because a thrown
        // remove() (AE rendering/holding refs) used to escape this whole
        // function — main.js's safeEvalScript callback never fired, the
        // stashInProgress flag stayed `true`, and the panel was wedged.
        if (importedItem) {
            try {
                importedItem.remove();
            } catch (remErr) {
                $.writeln("Blitzkrieg: Warning - importedItem.remove() failed: " + remErr.toString());
            }
            importedItem = null;
        }

        // Restore original project — suppress dialogs around open(). If the
        // restore itself fails, surface that explicitly so the caller knows
        // AE is now showing a temp comp instead of the user's working file.
        var restoreFailed = false;
        if (originalProjectFile && originalProjectFile.exists) {
            try { app.beginSuppressDialogs(); } catch (sd) {}
            try {
                app.open(originalProjectFile);
            } catch (opErr) {
                restoreFailed = true;
                $.writeln("Blitzkrieg: ERROR restoring original project after preview gen: " + opErr.toString());
            }
            try { app.endSuppressDialogs(false); } catch (ed) {}
        }

        if (restoreFailed) {
            return "RESTORE-FAILED: Generated " + previewFrameCount + " preview frames but could not reopen your project. Open it manually from File > Open Recent.";
        }

        if (previewFrameCount > 0) {
            return "Success: Generated " + previewFrameCount + " preview frames.";
        } else {
            return "Warning: Composition has only 1 frame, no preview animation generated.";
        }

    } catch (e) {
        if (_genFrameDialogsSuppressed) {
            try { app.endSuppressDialogs(false); } catch (edErr) {}
        }
        // Best-effort cleanup of zombie import — a crash during preview gen
        // used to leave the imported temp AEP attached to the project,
        // accumulating across retries until AE OOM'd.
        if (importedItem) {
            try { importedItem.remove(); } catch (cleanupErr) {}
            importedItem = null;
        }
        // Try to restore original project on error — suppress dialogs.
        // If THIS fails too, surface explicitly so the user knows their
        // working file is no longer the active project.
        var errRestoreFailed = false;
        try { app.beginSuppressDialogs(); } catch (sd) {}
        try {
            if (originalProjectFile && originalProjectFile.exists) {
                app.open(originalProjectFile);
            }
        } catch (restoreErr) {
            errRestoreFailed = true;
            $.writeln("Blitzkrieg: Error restoring project: " + restoreErr.toString());
        }
        try { app.endSuppressDialogs(false); } catch (ed) {}
        if (errRestoreFailed) {
            return "RESTORE-FAILED: " + e.toString() + " (project restore also failed; open from File > Open Recent)";
        }
        return "Error: " + e.toString();
    }
}

/**
 * Gets the path to the settings file in user's app data folder.
 * This ensures settings persist across After Effects restarts.
 * @returns {string} - Path to settings file
 */
function getSettingsFilePath() {
    // Use Folder.userData directly (not .fsName) for cross-platform compatibility.
    // On macOS, Folder.userData.fsName contains spaces (e.g., "Application Support")
    // that break the Folder constructor. Folder.userData.toString() returns a
    // properly URI-encoded path that works on all platforms.
    var settingsFolder = new Folder(buildPath(Folder.userData, "Blitzkrieg"));
    if (!settingsFolder.exists) {
        settingsFolder.create();
    }
    // Return a proper path string for new File() on macOS
    return buildPath(settingsFolder, "settings.json");
}

function getAuthStorageFilePath() {
    var settingsFolder = new Folder(buildPath(Folder.userData, "Blitzkrieg"));
    if (!settingsFolder.exists) {
        settingsFolder.create();
    }
    return buildPath(settingsFolder, "auth-session.json");
}

/**
 * Loads Blitzkrieg settings from persistent file storage.
 * @returns {string} - JSON string of settings or empty object
 */
function loadBlitzkriegSettings() {
    try {
        var settingsFile = new File(getSettingsFilePath());
        if (settingsFile.exists) {
            settingsFile.open('r');
            settingsFile.encoding = 'UTF-8';
            var content = settingsFile.read();
            settingsFile.close();
            // Validate it's valid JSON
            JSON.parse(content);
            return content;
        }
    } catch (e) {
        $.writeln("Blitzkrieg: Warning - Could not load settings: " + e.toString());
    }
    return "{}";
}

/**
 * Saves Blitzkrieg settings to persistent file storage.
 * @param {string} settingsJson - JSON string of settings to save
 * @returns {string} - Success or error message
 */
function saveBlitzkriegSettings(settingsJson) {
    try {
        // Validate JSON before saving
        JSON.parse(settingsJson);
        var settingsFile = new File(getSettingsFilePath());
        settingsFile.open('w');
        settingsFile.encoding = 'UTF-8';
        settingsFile.write(settingsJson);
        settingsFile.close();
        return "Success";
    } catch (e) {
        return "Error: " + e.toString();
    }
}

function loadBlitzkriegAuthStorage() {
    try {
        var authFile = new File(getAuthStorageFilePath());
        if (authFile.exists) {
            authFile.open('r');
            authFile.encoding = 'UTF-8';
            var content = authFile.read();
            authFile.close();
            JSON.parse(content);
            return content;
        }
    } catch (e) {
        $.writeln("Blitzkrieg: Warning - Could not load auth storage: " + e.toString());
    }
    return "{}";
}

function saveBlitzkriegAuthStorage(authJson) {
    try {
        JSON.parse(authJson);
        var authFile = new File(getAuthStorageFilePath());
        authFile.open('w');
        authFile.encoding = 'UTF-8';
        authFile.write(authJson);
        authFile.close();
        return "Success";
    } catch (e) {
        return "Error: " + e.toString();
    }
}

function getMetaCacheFilePath() {
    var settingsFolder = new Folder(buildPath(Folder.userData, "Blitzkrieg"));
    if (!settingsFolder.exists) {
        settingsFolder.create();
    }
    return buildPath(settingsFolder, "meta-cache.json");
}

/**
 * File-backed backstop for the panel's localStorage template-metadata cache.
 * CEP localStorage is not guaranteed to survive an After Effects quit (the auth
 * session needed the same file mirror for exactly this reason), so without this
 * the whole library slow-path reloads on every launch. Load/save/clear mirror
 * the auth-storage helpers above.
 */
function loadBlitzkriegMetaCache() {
    try {
        var metaFile = new File(getMetaCacheFilePath());
        if (metaFile.exists) {
            metaFile.open('r');
            metaFile.encoding = 'UTF-8';
            var content = metaFile.read();
            metaFile.close();
            JSON.parse(content);
            return content;
        }
    } catch (e) {
        $.writeln("Blitzkrieg: Warning - Could not load meta cache: " + e.toString());
    }
    return "{}";
}

function saveBlitzkriegMetaCache(metaJson) {
    try {
        JSON.parse(metaJson);
        var metaFile = new File(getMetaCacheFilePath());
        metaFile.open('w');
        metaFile.encoding = 'UTF-8';
        metaFile.write(metaJson);
        metaFile.close();
        return "Success";
    } catch (e) {
        return "Error: " + e.toString();
    }
}

function clearBlitzkriegMetaCache() {
    try {
        var metaFile = new File(getMetaCacheFilePath());
        if (metaFile.exists) metaFile.remove();
        return "Success";
    } catch (e) {
        return "Error: " + e.toString();
    }
}

/**
 * File-backed backstop for the panel's signed-URL cache. Sibling of the meta cache
 * mirror above. Without it, localStorage loses the signed thumbnail URLs on AE quit
 * and the grid re-signs every comp.png on the next launch.
 */
function getSignedUrlCacheFilePath() {
    var settingsFolder = new Folder(buildPath(Folder.userData, "Blitzkrieg"));
    if (!settingsFolder.exists) {
        settingsFolder.create();
    }
    return buildPath(settingsFolder, "signed-url-cache.json");
}

function loadBlitzkriegSignedUrlCache() {
    try {
        var f = new File(getSignedUrlCacheFilePath());
        if (f.exists) {
            f.open('r');
            f.encoding = 'UTF-8';
            var content = f.read();
            f.close();
            JSON.parse(content);
            return content;
        }
    } catch (e) {
        $.writeln("Blitzkrieg: Warning - Could not load signed-url cache: " + e.toString());
    }
    return "{}";
}

// NOTE: the signed-URL cache is WRITTEN from the panel via cep.fs (see
// _writeSignedUrlCacheFile in main.js), not through a jsx save helper, because its
// payload can exceed a comfortable evalScript string size. Only the read (load) and
// clear go through jsx here; the file is plain UTF-8 either way.
function clearBlitzkriegSignedUrlCache() {
    try {
        var f = new File(getSignedUrlCacheFilePath());
        if (f.exists) f.remove();
        return "Success";
    } catch (e) {
        return "Error: " + e.toString();
    }
}

// ============================================
// CLOUD UPLOAD/DOWNLOAD HELPERS
// ============================================

/**
 * Stash selected comp to a system temp directory (for cloud upload).
 * Reuses the existing stashSelectedComp logic but targets temp folder.
 */
function stashSelectedCompToTemp(categoryName) {
    var tempFolder = getSafeTempFolder();
    var tempLibPath = tempFolder.fsName + '/blitzkrieg_temp';

    // Create temp directory
    var tempLib = new Folder(tempLibPath);
    if (!tempLib.exists) tempLib.create();

    // Call existing stash logic with temp path
    var result = stashSelectedComp(tempLibPath, categoryName);

    // Return the temp path so the JS layer can read the files
    return JSON.stringify({
        tempPath: tempLibPath,
        result: result
    });
}

/**
 * READ-ONLY pre-flight estimate of a stash bundle's on-disk footage size, so the JS
 * layer can warn the editor BEFORE the synchronous export freeze (reduceProject +
 * sourceFile.copy run on AE's UI thread and can pause AE for tens of seconds on a
 * multi-GB comp). Walks the SAME selected comp stashSelectedComp exports and sums
 * used FootageItem file sizes. Deliberately conservative: uses file.length per
 * source, so image sequences (first frame only) UNDER-count rather than risk a
 * misleading over-count. Never renders, reduces, copies, or mutates anything. Any
 * failure returns { error } so the JS layer falls back to the generic message.
 */
function estimateStashFootprint() {
    try {
        if (!app.project) return JSON.stringify({ error: 'no project' });
        // Estimate the SAME comp the stash will export (selected-or-active) so the
        // pre-flight size warning matches the actual bundle.
        var targetComp = resolveTargetComp();
        if (!targetComp) {
            return JSON.stringify({ error: 'no single comp selected' });
        }
        var seenComp = {};
        var seenFoot = {};
        var totalBytes = 0;
        var missing = 0;

        function addFootage(item) {
            if (!item || seenFoot['f' + item.id]) return;
            seenFoot['f' + item.id] = true;
            var file = null;
            try { if (item.mainSource && item.mainSource.file) file = item.mainSource.file; } catch (e1) {}
            if (!file) { try { if (item.file) file = item.file; } catch (e2) {} }
            if (!file) return; // solid / placeholder / plugin source: nothing to copy
            try {
                if (file.exists) totalBytes += (file.length || 0);
                else missing++;
            } catch (e3) { /* unreadable, ignore */ }
        }

        function walkComp(comp) {
            if (!comp || seenComp['c' + comp.id]) return;
            seenComp['c' + comp.id] = true;
            var n = 0;
            try { n = comp.numLayers; } catch (eN) { n = 0; }
            for (var i = 1; i <= n; i++) {
                var lyr = null, s = null;
                try { lyr = comp.layer(i); } catch (eL) { lyr = null; }
                if (!lyr) continue;
                try { s = lyr.source; } catch (eS) { s = null; }
                if (!s) continue;
                if (s instanceof CompItem) walkComp(s);
                else if (s instanceof FootageItem) addFootage(s);
            }
        }

        walkComp(targetComp);
        return JSON.stringify({ bytes: totalBytes, footageMissing: missing });
    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

/**
 * Read a file and return its contents as base64.
 */
function readFileAsBase64(file) {
    file.encoding = 'BINARY';
    file.open('r');
    var content = file.read();
    file.close();

    // ExtendScript base64 encoding
    var base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    // ExtendScript string append is O(n²) — for a 5MB AEP (~6.6M base64 chars) the
    // naive loop takes ~minutes. Build into a chunked array and join at the end.
    // Each chunk holds ~32KB of base64 text so we get O(n) total work.
    var CHUNK_SIZE = 32768;
    var parts = [];
    var chunk = '';
    var i = 0;
    var len = content.length;
    while (i < len) {
        var b1 = content.charCodeAt(i++) & 0xFF;
        var b2 = i < len ? content.charCodeAt(i++) & 0xFF : 0;
        var b3 = i < len ? content.charCodeAt(i++) & 0xFF : 0;
        var padding = (i > len + 1) ? 2 : (i > len) ? 1 : 0;

        chunk += base64chars.charAt(b1 >> 2);
        chunk += base64chars.charAt(((b1 & 3) << 4) | (b2 >> 4));
        chunk += padding >= 1 ? '=' : base64chars.charAt(((b2 & 15) << 2) | (b3 >> 6));
        chunk += padding >= 2 ? '=' : base64chars.charAt(b3 & 63);

        if (chunk.length >= CHUNK_SIZE) {
            parts.push(chunk);
            chunk = '';
        }
    }
    if (chunk.length) parts.push(chunk);
    return parts.join('');
}

/**
 * Append a text chunk to a file (used for chunked base64 writing from JS).
 * @param {string} filePath - Full path to the text file
 * @param {string} chunk - Text chunk to write/append
 * @param {boolean} isFirst - If true, create/overwrite; if false, append
 * @returns {string} "ok" or "ERROR: ..."
 */
function appendToTextFile(filePath, chunk, isFirst) {
    try {
        // Normalize so the macOS URI-style path (space in default library root)
        // resolves; decodeBase64FileToBinary normalizes the same raw path, so the
        // chunk file written here is found there. Windows paths pass through.
        var f = new File(normalizeFsPath(filePath));
        f.encoding = 'UTF-8';
        f.open(isFirst ? 'w' : 'a');
        f.write(chunk);
        f.close();
        return 'ok';
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}

/**
 * Read a base64 file from disk, decode to binary, and write to outputPath.
 * Used after chunked base64 writing to produce the final binary file.
 * @param {string} base64FilePath - Path to the text file containing base64
 * @param {string} outputPath - Path to write the decoded binary file
 * @returns {string} Output file path on success, or "ERROR: ..."
 */
function decodeBase64FileToBinary(base64FilePath, outputPath) {
    try {
        // fileFromPath normalizes (matching appendToTextFile's write path) so the
        // macOS space-in-path chunk file is found; falls back to raw if needed.
        var b64File = fileFromPath(base64FilePath);
        if (!b64File.exists) return 'ERROR: Base64 file not found';

        b64File.encoding = 'UTF-8';
        b64File.open('r');
        var base64Data = b64File.read();
        b64File.close();
        b64File.remove();

        // Build lookup table for fast decoding
        var base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        var lookup = {};
        for (var li = 0; li < base64chars.length; li++) {
            lookup[base64chars.charAt(li)] = li;
        }

        var cleanBase64 = base64Data.replace(/[^A-Za-z0-9+\/]/g, '');

        // Decode in chunks to avoid O(n²) string concatenation
        var DECODE_CHUNK = 32768;
        var parts = [];
        var i = 0;
        while (i < cleanBase64.length) {
            var chunk = '';
            var end = Math.min(i + DECODE_CHUNK, cleanBase64.length);
            // Ensure we process complete 4-byte groups
            end = end - (end % 4);
            if (end <= i) end = Math.min(i + 4, cleanBase64.length);
            while (i < end) {
                var b1 = lookup[cleanBase64.charAt(i++)] || 0;
                var b2 = lookup[cleanBase64.charAt(i++)] || 0;
                var b3c = cleanBase64.charAt(i++);
                var b4c = cleanBase64.charAt(i++);
                var b3 = b3c ? (lookup[b3c] !== undefined ? lookup[b3c] : -1) : -1;
                var b4 = b4c ? (lookup[b4c] !== undefined ? lookup[b4c] : -1) : -1;
                chunk += String.fromCharCode((b1 << 2) | (b2 >> 4));
                if (b3 !== -1) chunk += String.fromCharCode(((b2 & 15) << 4) | (b3 >> 2));
                if (b4 !== -1) chunk += String.fromCharCode(((b3 & 3) << 6) | b4);
            }
            parts.push(chunk);
        }
        var binary = parts.join('');

        var outFile = new File(normalizeFsPath(outputPath));
        outFile.encoding = 'BINARY';
        outFile.open('w');
        outFile.write(binary);
        outFile.close();

        if (!outFile.exists) return 'ERROR: Write failed';
        // 0-byte guard (parity with blitzLocalWriteBinary): a non-empty input that
        // produced an empty file is a silent write failure, not a success. This is
        // the live fallback writer for the local mirror when cep.fs is absent.
        if (cleanBase64.length > 0 && outFile.length === 0) return 'ERROR: decode produced 0 bytes: ' + outputPath;
        return outFile.fsName;
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}

/**
 * Clean up temp stash directory after cloud upload.
 *
 * SECURITY: refuses to recursively delete anything outside the OS temp folder.
 * A forged `tempPath` (e.g. '/Users/victim/Documents') would otherwise wipe the
 * user's home directory. We compare against getSafeTempFolder() as the allow-list.
 */
// Sweep stale Blitzkrieg temp bundles left by prior imports/generations. Cloud
// import bundles are intentionally NOT deleted on success (the imported project
// references their footage by disk path, so deleting them pops AE's native
// "missing files" modal). This reaper — called once on panel load — reclaims those
// bundles after they are old enough that nothing references them. It only removes
// dirs whose embedded timestamp is older than maxAgeMs, so a bundle from the import
// the user just did is never touched. Returns "OK: <count removed>".
function blitzReapStaleTempDirs(maxAgeMs) {
    try {
        var maxAge = maxAgeMs;
        if (!maxAge || maxAge < 0) maxAge = 21600000; // 6h default
        // Scan BOTH the Blitzkrieg temp folder (import/gen bundles) AND its parent
        // ($TMPDIR root), because render-relocation dirs (blitzkrieg_relo_*) are created
        // directly under $TMPDIR, a sibling of the Blitzkrieg folder, not inside it.
        var bases = [];
        try { var b0 = getSafeTempFolder(); if (b0 && b0.exists) bases.push(b0); } catch (stErr) {}
        try { if (bases.length && bases[0].parent && bases[0].parent.exists) bases.push(bases[0].parent); } catch (pErr) {}
        if (bases.length === 0) return 'OK: 0';
        var now = (new Date()).getTime();
        var removed = 0;
        var seen = {};
        var re = /^blitzkrieg_(import|gen|relo)_(\d+)/;
        for (var bi = 0; bi < bases.length; bi++) {
            var entries;
            try { entries = bases[bi].getFiles(); } catch (glErr) { continue; }
            if (!entries) continue;
            for (var i = 0; i < entries.length; i++) {
                var f = entries[i];
                if (!(f instanceof Folder)) continue;
                var m = re.exec(f.name);
                if (!m) continue;
                var key;
                try { key = f.fsName; } catch (fnErr) { key = f.name; }
                if (seen[key]) continue;   // the Blitzkrieg folder itself is under $TMPDIR; avoid double-processing
                seen[key] = true;
                var ts = parseInt(m[2], 10);
                if (!ts || (now - ts) < maxAge) continue; // too new / unparseable — keep
                try { removeFolderRecursive(f); removed++; } catch (rmErr) {}
            }
        }
        return 'OK: ' + removed;
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}

function cleanupTempStash(tempPath) {
    try {
        if (!isValidPath(tempPath)) {
            return 'ERROR: Invalid temp path';
        }
        var safeTemp;
        try { safeTemp = getSafeTempFolder().fsName; } catch (stErr) {
            return 'ERROR: Could not resolve temp folder';
        }
        // Normalize paths for prefix comparison. On case-insensitive filesystems
        // (NTFS on Windows, APFS/HFS+ default on macOS) we lowercase both sides so
        // legitimate case variations don't get incorrectly rejected.
        var normTarget = tempPath.replace(/\\/g, '/');
        var normSafe = safeTemp.replace(/\\/g, '/');
        var caseInsensitiveFS = ($.os.indexOf('Windows') !== -1) || ($.os.indexOf('Mac') !== -1);
        if (caseInsensitiveFS) {
            normTarget = normTarget.toLowerCase();
            normSafe = normSafe.toLowerCase();
        }
        // Strip trailing slashes so comparison is stable
        while (normSafe.length > 1 && normSafe.charAt(normSafe.length - 1) === '/') {
            normSafe = normSafe.substring(0, normSafe.length - 1);
        }
        // Enforce that the target is EXACTLY the safe folder OR strictly under it.
        // The old `indexOf === 0` check matched `/tmp_evil/...` when safeTemp was
        // `/tmp`, allowing recursive deletion of unrelated directories.
        var isExactMatch = normTarget === normSafe;
        var isUnder = normTarget.length > normSafe.length &&
                      normTarget.substring(0, normSafe.length) === normSafe &&
                      normTarget.charAt(normSafe.length) === '/';
        if (!isExactMatch && !isUnder) {
            return 'ERROR: cleanupTempStash target is outside the temp folder';
        }
        var folder = new Folder(tempPath);
        if (folder.exists) {
            removeFolderRecursive(folder);
        }
        return 'OK';
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}

/**
 * Generate thumbnail + preview frames from an AEP file and write them to disk.
 * Uses same dynamic frame count logic as stashSelectedComp (~6 FPS, min 12, max 72).
 * Returns only a small JSON string (no base64), avoiding evalScript size limits.
 *
 * @param {string} aepPath - Path to the .aep file on disk
 * @param {string} outputDir - Directory to write comp.png and preview/ frames into
 * @returns {string} JSON: {frameCount: N} or {error: "..."}
 */
function generatePreviewsToDisk(aepPath, outputDir, thumbnailOnly) {
    // NOTE: We always suppress dialogs before importFile() to prevent blocking
    // "missing file" dialogs. On AE 2024/2025 this MAY cause importFile() to throw
    // "Object is invalid" — the import try/catch handles this by ending suppression
    // and retrying without it (dialog appears but import completes). Separate
    // _dialogsSuppressed flag still used around saveFrameToPng() for Windows.
    var _dialogsSuppressed = false;
    var importedItem = null;  // declared outside try so catch block can clean up
    var aepFile = null;
    var _currentStep = 'init';

    // Helper: normalize path for Windows (convert forward slashes to backslashes).
    // AE's importFile() on Windows can fail with "Object is invalid" when given a
    // mixed-slash path like "C:\Users\x/blitzkrieg_gen_123/_9.aep". This also covers
    // UNC paths (\\server\share\...) which are common in production studios with NAS.
    function _normalizeForPlatform(p) {
        if (!p || typeof p !== 'string') return p;
        if ($.os.indexOf('Windows') === -1) return p;
        var isDriveLetter = p.length > 2 && p.charAt(1) === ':';
        var isUNC = p.length > 2 && (p.substr(0, 2) === '\\\\' || p.substr(0, 2) === '//');
        if (isDriveLetter || isUNC) {
            var normalized = p.replace(/\//g, '\\');
            // For UNC paths that started with // the replace above leaves the leading
            // double-slash, which is correct (\\server\share), but we must not end up
            // with more than 2 backslashes at the start.
            return normalized;
        }
        return p;
    }

    // Helper: ensure every exit path cleans up thoroughly.
    function _cleanup() {
        if (importedItem) {
            try { importedItem.remove(); } catch (cuErr) {}
            importedItem = null;
        }
        try { app.purge(PurgeTarget.ALL_CACHES); } catch (purgeErr) {}
        if (_dialogsSuppressed) {
            try { app.endSuppressDialogs(false); } catch(edErr) {}
            _dialogsSuppressed = false;
        }
    }

    try {
        _currentStep = 'validate_aep_path';
        var normalizedAepPath = _normalizeForPlatform(aepPath);
        aepFile = new File(normalizedAepPath);
        if (!aepFile.exists) {
            // Fallback: try the raw path in case normalization broke it
            aepFile = new File(aepPath);
        }
        if (!aepFile.exists) {
            _cleanup();
            return JSON.stringify({error: 'AEP file not found: ' + aepPath});
        }

        // Sanity-check the AEP is readable and non-empty. A 0-byte file will cause
        // importFile() to throw "Object is invalid" on some AE versions. `File.length`
        // returns -1 on some macOS network mounts when the size cannot be determined,
        // which we treat as "unknown" and allow through.
        _currentStep = 'validate_aep_size';
        if (aepFile.length === 0) {
            _cleanup();
            return JSON.stringify({error: 'AEP file is empty (0 bytes): ' + aepFile.fsName});
        }

        _currentStep = 'create_output_dir';
        var normalizedOutDir = _normalizeForPlatform(outputDir);
        var outFolder = new Folder(normalizedOutDir);
        if (!outFolder.exists) outFolder.create();
        if (!outFolder.exists) {
            outFolder = new Folder(outputDir);
            if (!outFolder.exists) outFolder.create();
        }
        if (!outFolder.exists) {
            _cleanup();
            return JSON.stringify({error: 'Cannot create output dir: ' + outFolder.fsName});
        }

        // --- Import the AEP with dialog suppression ---
        // Always suppress to prevent blocking "missing file" dialogs. If AE 2024+
        // throws "Object is invalid" with suppression active, we catch it, end
        // suppression, and retry (dialog may appear but import completes).
        _currentStep = 'import_file';
        var importError = null;
        var _genImportDialogsSuppressed = false;
        try { app.beginSuppressDialogs(); _genImportDialogsSuppressed = true; } catch (sdErr) {}
        try {
            var importOptions = new ImportOptions(aepFile);
            importOptions.importAs = ImportAsType.PROJECT;
            importedItem = app.project.importFile(importOptions);
        } catch (impErr1) {
            importError = impErr1;
            // AE 2024+ may throw with suppression — end it before retry
            if (_genImportDialogsSuppressed) {
                try { app.endSuppressDialogs(false); } catch (ed) {}
                _genImportDialogsSuppressed = false;
            }
        }
        if (_genImportDialogsSuppressed) {
            try { app.endSuppressDialogs(false); } catch (edErr) {}
            _genImportDialogsSuppressed = false;
        }

        // Retry once on failure: purge caches and try again. Transient state in
        // AE's importer (especially after a prior failed run left stale items)
        // can be cleared by app.purge().
        //
        // NOTE: we deliberately do NOT use $.sleep() here — it's a synchronous halt
        // that freezes the entire CEP↔ExtendScript bridge and the AE UI. On a long
        // batch with 240 retries that's minutes of frozen UI. The JS caller handles
        // OneDrive/Dropbox flush timing via _cleanupTempDir delays between items.
        if (!importedItem) {
            try { app.purge(PurgeTarget.ALL_CACHES); } catch (purgeErr) {}
            try {
                var retryOptions = new ImportOptions(aepFile);
                retryOptions.importAs = ImportAsType.PROJECT;
                importedItem = app.project.importFile(retryOptions);
                if (importedItem) importError = null;
            } catch (impErr2) {
                if (!importError) importError = impErr2;
            }
        }

        if (!importedItem) {
            _cleanup();
            return JSON.stringify({
                error: 'Import failed' + (importError ? ': ' + importError.toString() : ': unknown'),
                step: 'import_file',
                aepPath: aepFile.fsName,
                aepSize: aepFile.length
            });
        }

        // --- Find the main composition ---
        _currentStep = 'find_main_comp';
        var mainComp = null;
        if (importedItem instanceof CompItem) {
            mainComp = importedItem;
        } else if (importedItem instanceof FolderItem) {
            var searchFolder = function(folder) {
                for (var gi = 1; gi <= folder.numItems; gi++) {
                    if (folder.item(gi) instanceof CompItem) return folder.item(gi);
                }
                for (var gj = 1; gj <= folder.numItems; gj++) {
                    if (folder.item(gj) instanceof FolderItem) {
                        var found = searchFolder(folder.item(gj));
                        if (found) return found;
                    }
                }
                return null;
            };
            mainComp = searchFolder(importedItem);
        }

        if (!mainComp) {
            _cleanup();
            return JSON.stringify({error: 'No composition found in AEP', step: 'find_main_comp'});
        }

        // --- Detect missing footage (for logging & deciding whether to render preview) ---
        _currentStep = 'check_missing_footage';
        var hasMissingFootage = false;
        var missingFootageNames = [];
        try {
            var _checkedComps = {};
            var _checkedCounter = 0;
            var _checkCompMissing = function(comp) {
                if (!comp) return false;
                // comp.id can be undefined on pre-CC AE versions; fall back to a counter
                // so recursion guard still works without all undefined IDs colliding.
                var ckey = (comp.id !== undefined && comp.id !== null) ? ('id_' + comp.id) : ('ctr_' + (++_checkedCounter));
                if (_checkedComps[ckey]) return false;
                _checkedComps[ckey] = true;
                var found = false;
                for (var li = 1; li <= comp.numLayers; li++) {
                    try {
                        var layer = comp.layer(li);
                        if (!layer.enabled) continue;
                        var src = layer.source;
                        if (!src) continue;
                        if (src instanceof FootageItem && src.footageMissing) {
                            found = true;
                            if (missingFootageNames.length < 5) {
                                try { missingFootageNames.push(src.name); } catch (e) {}
                            }
                        }
                        if (src instanceof CompItem) {
                            if (_checkCompMissing(src)) found = true;
                        }
                    } catch (layerErr) { /* skip inaccessible layer */ }
                }
                return found;
            };
            hasMissingFootage = _checkCompMissing(mainComp);
        } catch (fmErr) { /* ignore */ }

        // Capture comp properties BEFORE rendering (the CompItem reference can become
        // stale after saveFrameToPng in rare AE edge cases).
        var compDuration = mainComp.workAreaDuration;
        var compWidth = mainComp.width;
        var compHeight = mainComp.height;
        var compFrameRate = mainComp.frameRate || 30;
        var compWorkAreaStart = mainComp.workAreaStart;

        // --- Suppress dialogs ONLY for the render phase ---
        // saveFrameToPng can spam modal "Could not create file" dialogs on Windows.
        _currentStep = 'suppress_dialogs';
        try { app.beginSuppressDialogs(); _dialogsSuppressed = true; } catch (sdErr) { /* AE < 13.8 */ }

        // --- Render thumbnail ---
        // Also detect the AE "Memory allocation X gb exceeds the internal limit"
        // error that Motion Tile + other effects with huge output values can throw.
        // When we detect it we surface a clear skip reason so the admin knows to
        // lower the Motion Tile output values (or raise AE's memory cap), rather
        // than getting a generic "render failed" cascade that makes the whole
        // batch look broken.
        _currentStep = 'render_thumbnail';
        var thumbTimes = [
            compWorkAreaStart + (compDuration / 2),
            compWorkAreaStart,
            compWorkAreaStart + (compDuration * 0.25)
        ];
        // Relocation support (AE 2026 hardened runtime). If the render engine
        // (saveFrameToPng) cannot OPEN the output file for writing in the chosen
        // temp base, relocate the output folder to $TMPDIR - the app's own per-user
        // sandbox temp where the render engine has GUARANTEED write access - and
        // retry. This is empirical at the exact failing operation, so it recovers
        // even if getSafeTempFolder's Folder.create probe green-lit a base (e.g.
        // ~/Library/Caches) that the render engine later refuses. The modal
        // "File couldn't be opened for writing ( 3 :: 0 )" dialog is a SYMPTOM of
        // that refusal and is NOT suppressible via beginSuppressDialogs on macOS,
        // so we prevent it by writing where the engine can open the file.
        var _relocatedRoot = null;
        function _isWriteOpenError(errStr) {
            var s = String(errStr).toLowerCase();
            if (s.indexOf('opened for writing') !== -1) return true;
            if (s.indexOf('could not be created') !== -1) return true;
            if (s.indexOf('couldn') !== -1 && s.indexOf('open') !== -1) return true;
            if (s.indexOf('could') !== -1 && s.indexOf('open') !== -1 && s.indexOf('writ') !== -1) return true;
            if (s.indexOf('( 3 :: 0 )') !== -1) return true;
            return false;
        }
        function _renderWritableBase() {
            var cand = [];
            var td = $.getenv('TMPDIR');
            if (td) cand.push(new Folder(td));
            try { if (Folder.temp && Folder.temp.parent) cand.push(Folder.temp.parent); } catch (eB) {}
            cand.push(Folder.temp);
            for (var ci = 0; ci < cand.length; ci++) {
                if (cand[ci] && cand[ci].exists) return cand[ci];
            }
            return Folder.temp;
        }
        function _relocateOutputFolder() {
            try {
                var base = _renderWritableBase();
                if (!base || !base.exists) return null;
                var stamp = String((new Date()).getTime()) + '_' + Math.floor(Math.random() * 1000000);
                var reloRoot = new Folder(buildPath(base, 'blitzkrieg_relo_' + stamp));
                if (!reloRoot.exists) reloRoot.create();
                if (!reloRoot.exists) return null;
                var reloOut = new Folder(buildPath(reloRoot, 'output'));
                if (!reloOut.exists) reloOut.create();
                if (!reloOut.exists) return null;
                _relocatedRoot = reloRoot.fsName;
                return reloOut;
            } catch (eR) { return null; }
        }

        // PROACTIVE writability probe (AE 2026 hardened runtime). saveFrameToPng pops a
        // NON-suppressible "File couldn't be opened for writing ( 3 :: 0 )" modal that
        // blocks the entire UI thread when the render engine cannot write the chosen
        // base. The post-throw relocation below can only recover AFTER a human dismisses
        // that modal — during a 100+ comp batch that is the "stuck at 0/N frozen" hang.
        // So probe write access up front with a plain File write; if it fails, relocate
        // to a guaranteed-writable base BEFORE any saveFrameToPng, so the modal path is
        // never entered.
        _currentStep = 'probe_render_writable';
        (function () {
            function _canWrite(folder) {
                try {
                    if (!folder || !folder.exists) return false;
                    var probe = new File(folder.fsName + '/.blitz_wtest_' + String((new Date()).getTime()));
                    probe.encoding = 'BINARY';
                    if (!probe.open('w')) return false;
                    var okw = probe.write('x');
                    probe.close();
                    var existed = probe.exists;
                    try { probe.remove(); } catch (rmErr) {}
                    return okw && existed;
                } catch (pErr) { return false; }
            }
            if (!_canWrite(outFolder)) {
                var _preRe = _relocateOutputFolder();
                if (_preRe) { outFolder = _preRe; }
            }
        })();

        var thumbFile = new File(outFolder.fsName + '/comp.png');
        var thumbMemoryError = null;
        var _thumbRelocated = false;
        for (var tt = 0; tt < thumbTimes.length; tt++) {
            try {
                mainComp.saveFrameToPng(thumbTimes[tt], thumbFile);
                // AE 2026 flushes the PNG asynchronously — poll instead of an
                // immediate .exists check (see _waitForFileFlush).
                if (_waitForFileFlush(thumbFile, 5000)) break;
            } catch (thumbErr) {
                // Look for AE's memory-allocation diagnostic string. The exact text
                // has varied across versions but always contains "memory allocation"
                // and "exceeds". Match substrings case-insensitively.
                var tem = thumbErr.toString().toLowerCase();
                if (tem.indexOf('memory allocation') !== -1 && tem.indexOf('exceed') !== -1) {
                    thumbMemoryError = thumbErr.toString();
                    break; // no point retrying other timestamps — it's a comp-wide issue
                }
                // AE 2026: render engine refused to open the file for writing in the
                // current base. Relocate to $TMPDIR and retry the whole timestamp
                // sweep ONCE against the new, engine-writable location.
                if (!_thumbRelocated && _isWriteOpenError(thumbErr.toString())) {
                    var _reloOut = _relocateOutputFolder();
                    if (_reloOut) {
                        outFolder = _reloOut;
                        thumbFile = new File(outFolder.fsName + '/comp.png');
                        _thumbRelocated = true;
                        tt = -1; // restart sweep against relocated folder
                        continue;
                    }
                }
                /* otherwise try next timestamp */
            }
        }

        if (!_waitForFileFlush(thumbFile, 2000)) {
            _cleanup();
            if (aepFile && aepFile.exists) { try { aepFile.remove(); } catch(e) {} }
            if (thumbMemoryError) {
                return JSON.stringify({
                    frameCount: 0,
                    duration: compDuration,
                    width: compWidth,
                    height: compHeight,
                    skipped: true,
                    skipReason: 'memory_limit',
                    memoryError: thumbMemoryError,
                    hint: 'Motion Tile or similar effect with large output values is exceeding AE memory limit. Lower the Motion Tile output dimensions (Output Width/Height) and re-stash this template.'
                });
            }
            if (hasMissingFootage) {
                return JSON.stringify({
                    frameCount: 0,
                    duration: compDuration,
                    width: compWidth,
                    height: compHeight,
                    skipped: true,
                    skipReason: 'missing_footage',
                    missingFootage: missingFootageNames
                });
            }
            return JSON.stringify({error: 'Failed to render thumbnail frame', step: 'render_thumbnail'});
        }

        // If footage is missing, emit thumbnail-only (skip spamming 12-72 frame renders)
        if (hasMissingFootage) {
            _cleanup();
            if (aepFile && aepFile.exists) { try { aepFile.remove(); } catch(e) {} }
            var _toResult = {
                frameCount: 0,
                duration: compDuration,
                width: compWidth,
                height: compHeight,
                thumbnailOnly: true,
                missingFootage: missingFootageNames,
                outputDir: outFolder.fsName
            };
            if (_relocatedRoot) _toResult.relocatedTempDir = _relocatedRoot;
            return JSON.stringify(_toResult);
        }

        // Caller requested THUMBNAIL-ONLY (the default "Generate Missing" batch).
        // comp.png is rendered and uploaded; skip the expensive 12-72 frame preview
        // loop entirely. Rendering previews for 100+ comps means thousands of
        // saveFrameToPng calls on the synchronous UI thread — the batch freeze. Preview
        // animations are optional and produced by the explicit "Force regenerate ALL".
        if (thumbnailOnly) {
            _cleanup();
            if (aepFile && aepFile.exists) { try { aepFile.remove(); } catch (e) {} }
            var _tmResult = {
                frameCount: 0,
                duration: compDuration,
                width: compWidth,
                height: compHeight,
                thumbnailMode: true,
                outputDir: outFolder.fsName
            };
            if (_relocatedRoot) _tmResult.relocatedTempDir = _relocatedRoot;
            return JSON.stringify(_tmResult);
        }

        // --- Render preview frames ---
        _currentStep = 'render_preview_frames';
        var previewFrameCount = 0;
        var totalFrames = Math.floor(compDuration * compFrameRate);
        var consecutiveFailures = 0;
        var plannedFrameCount = 0;         // how many we intended to render
        var incompleteFrames = false;      // did we bail early due to failures?
        var tooShortWarning = false;       // was the comp too short for a preview?
        var frameMemoryError = null;       // populated if AE threw OOM during frame render

        if (totalFrames > 1) {
            var previewFolder = new Folder(outFolder.fsName + '/preview');
            if (!previewFolder.exists) previewFolder.create();

            // Shared dynamic-frame-count logic (see computePreviewFrameCount)
            var actualFrameCount = computePreviewFrameCount(compDuration, totalFrames);
            plannedFrameCount = actualFrameCount;

            for (var pf = 0; pf < actualFrameCount; pf++) {
                try {
                    var progress = (actualFrameCount > 1) ? (pf / (actualFrameCount - 1)) : 0;
                    var previewTime = compWorkAreaStart + (progress * compDuration);
                    var frameFile = new File(previewFolder.fsName + '/frame_' + pf + '.png');
                    mainComp.saveFrameToPng(previewTime, frameFile);
                    // AE 2026 async flush — poll instead of an immediate .exists check.
                    if (_waitForFileFlush(frameFile, 3000)) {
                        previewFrameCount++;
                        consecutiveFailures = 0;
                    } else {
                        consecutiveFailures++;
                        if (consecutiveFailures >= 2) { incompleteFrames = true; break; }
                    }
                } catch (frameErr) {
                    // Detect AE memory-allocation errors and bail immediately —
                    // no point grinding through 11 more frames that will all fail
                    // with the same error. Surface the memory-limit signal so the
                    // caller can display the Motion Tile fix hint.
                    var fem = frameErr.toString().toLowerCase();
                    if (fem.indexOf('memory allocation') !== -1 && fem.indexOf('exceed') !== -1) {
                        frameMemoryError = frameErr.toString();
                        incompleteFrames = true;
                        break;
                    }
                    consecutiveFailures++;
                    if (consecutiveFailures >= 2) { incompleteFrames = true; break; }
                }
            }
        } else {
            // Too few frames for a preview animation (static comp, 1-frame still, etc).
            // This is not an error, but the caller should know the result is
            // thumbnail-only so the UI doesn't expect a hover animation.
            tooShortWarning = true;
        }

        // --- Success: clean up and return ---
        // Remove the temp AEP BEFORE _cleanup() calls app.purge(), since purge can
        // defer File handle release on some AE versions.
        _currentStep = 'cleanup';
        if (aepFile && aepFile.exists) { try { aepFile.remove(); } catch(e) {} }
        _cleanup();

        var result = {
            frameCount: previewFrameCount,
            duration: compDuration,
            width: compWidth,
            height: compHeight,
            outputDir: outFolder.fsName
        };
        if (_relocatedRoot) result.relocatedTempDir = _relocatedRoot;
        if (incompleteFrames) {
            result.incompleteFrames = true;
            result.plannedFrameCount = plannedFrameCount;
        }
        if (frameMemoryError) {
            result.memoryError = frameMemoryError;
            result.hint = 'Motion Tile or similar effect with large output values is exceeding AE memory limit. Lower the Motion Tile Output Width/Height and re-stash this template.';
        }
        if (tooShortWarning) result.tooShort = true;
        return JSON.stringify(result);
    } catch (e) {
        // Unexpected error: always clean up stale imports AND the temp AEP to
        // prevent cascading failures and disk leaks. The caller's _cleanupTempDir()
        // also wipes the parent dir, but we remove the .aep here for defense in depth.
        var errMsg = e.toString();
        var stepAtError = _currentStep;
        if (aepFile && aepFile.exists) { try { aepFile.remove(); } catch (rmErr) {} }
        _cleanup();
        // Special-case memory-allocation errors at the outer catch level too.
        // Some AE versions throw these through the ExtendScript bridge before
        // our per-call try/catch can touch them.
        var outerLower = errMsg.toLowerCase();
        if (outerLower.indexOf('memory allocation') !== -1 && outerLower.indexOf('exceed') !== -1) {
            return JSON.stringify({
                frameCount: 0,
                skipped: true,
                skipReason: 'memory_limit',
                memoryError: errMsg,
                step: stepAtError,
                hint: 'Motion Tile or similar effect with large output values is exceeding AE memory limit. Lower the Motion Tile Output Width/Height and re-stash this template.',
                aepPath: aepPath
            });
        }
        return JSON.stringify({
            error: errMsg,
            step: stepAtError,
            aepPath: aepPath
        });
    }
}

function removeFolderRecursive(folder) {
    if (!folder || !folder.exists) return;
    // getFiles() can return null on macOS when the Folder URI is malformed.
    var files = folder.getFiles();
    if (files) {
        for (var i = 0; i < files.length; i++) {
            try {
                if (files[i] instanceof Folder) {
                    removeFolderRecursive(files[i]);
                } else {
                    files[i].remove();
                }
            } catch (rfrErr) { /* skip file we can't delete; loop continues */ }
        }
    }
    try { folder.remove(); } catch (rmErr) {}
}

/**
 * Get the extension root path.
 * Returns the path string on success, or the literal string "ERROR: ..." on failure.
 */
var BLITZKRIEG_EXTENSION_ROOT_OVERRIDE = null;

function _existingFolderFromPath(path) {
    try {
        if (!path || typeof path !== 'string') return null;
        if (!isValidPath(path)) return null;
        var folder = new Folder(path);
        if (folder && folder.exists) return folder;
    } catch (e) {}
    return null;
}

function _resolveExtensionRootFolder(rootHint) {
    var hinted = _existingFolderFromPath(rootHint);
    if (hinted) {
        BLITZKRIEG_EXTENSION_ROOT_OVERRIDE = hinted.fsName;
        return hinted;
    }

    var override = _existingFolderFromPath(BLITZKRIEG_EXTENSION_ROOT_OVERRIDE);
    if (override) return override;

    try {
        if (typeof $ !== 'undefined' && $.fileName && String($.fileName).length > 0) {
            var scriptFile = new File($.fileName);
            if (scriptFile && scriptFile.parent && scriptFile.parent.parent) {
                var rootFolder = scriptFile.parent.parent;
                if (rootFolder.exists) {
                    BLITZKRIEG_EXTENSION_ROOT_OVERRIDE = rootFolder.fsName;
                    return rootFolder;
                }
            }
        }
    } catch (e) {}

    return null;
}

function setBlitzkriegExtensionRoot(rootPath) {
    try {
        var folder = _existingFolderFromPath(rootPath);
        if (!folder) return 'ERROR: invalid extension root';
        BLITZKRIEG_EXTENSION_ROOT_OVERRIDE = folder.fsName;
        return 'ok';
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}

function getExtensionRootPath(rootHint) {
    try {
        var rootFolder = _resolveExtensionRootFolder(rootHint);
        if (!rootFolder || !rootFolder.exists) return 'ERROR: cannot resolve extension root';
        return rootFolder.fsName;
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}

function _normalizeForRootCheck(path) {
    var normalized = String(path || '').replace(/\\/g, '/');
    if (($.os.indexOf('Windows') !== -1) || ($.os.indexOf('Mac') !== -1)) {
        normalized = normalized.toLowerCase();
    }
    while (normalized.length > 1 && normalized.charAt(normalized.length - 1) === '/') {
        normalized = normalized.substring(0, normalized.length - 1);
    }
    return normalized;
}

function _isPathInsideRoot(path, rootPath, allowExact) {
    var target = _normalizeForRootCheck(path);
    var root = _normalizeForRootCheck(rootPath);
    var exactRoot = target === root;
    var underRoot = target.length > root.length &&
                    target.substring(0, root.length) === root &&
                    target.charAt(root.length) === '/';
    return (allowExact && exactRoot) || underRoot;
}

/**
 * Write a text file to disk. Creates parent directories if needed.
 * Used by the OTA update system to write JS/CSS files.
 *
 * SECURITY: refuses to write outside the extension root directory. This prevents
 * a compromised or malicious update manifest from dropping arbitrary files into
 * system paths (e.g. LaunchAgents, Startup folders, etc). Only .js/.css/.html/.jsx/.json
 * extensions under the extension root are accepted.
 */
function writeUpdateFile(filePath, content) {
    try {
        if (!isValidPath(filePath)) {
            return JSON.stringify({error: 'Invalid update file path'});
        }
        // Extension allow-list — reject binaries and native executables
        var lower = filePath.toLowerCase();
        var allowedExt = false;
        var exts = ['.js', '.css', '.html', '.htm', '.jsx', '.json', '.svg', '.xml'];
        for (var ei = 0; ei < exts.length; ei++) {
            if (lower.length >= exts[ei].length &&
                lower.substring(lower.length - exts[ei].length) === exts[ei]) {
                allowedExt = true;
                break;
            }
        }
        if (!allowedExt) {
            return JSON.stringify({error: 'Update file extension not allowed: ' + filePath});
        }
        // Resolve extension root and make sure the target stays under it
        var rootFolder = _resolveExtensionRootFolder();
        if (!rootFolder || !rootFolder.exists) {
            return JSON.stringify({error: 'Extension root missing'});
        }
        var rootPath = rootFolder.fsName;
        // Enforce strictly-under-root — prevents prefix-collision attacks
        // where an extension root of `/Library/Extensions/Blitzkrieg` would otherwise
        // allow writes to `/Library/Extensions/Blitzkrieg-evil/payload.js`.
        if (!_isPathInsideRoot(filePath, rootPath, false)) {
            return JSON.stringify({error: 'Update target is outside extension root'});
        }

        var f = new File(filePath);
        // Create parent directories if they don't exist
        var parentFolder = f.parent;
        if (!parentFolder.exists) {
            parentFolder.create();
        }
        f.open('w');
        f.encoding = 'UTF-8';
        f.write(content);
        f.close();
        return 'ok';
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    }
}

/**
 * Recursively create a directory (mkdir -p) under the extension root.
 * Refuses to create paths outside the extension dir.
 */
function mkdirUnderRoot(targetPath) {
    try {
        if (!isValidPath(targetPath)) return JSON.stringify({error: 'Invalid path'});
        var rootFolder = _resolveExtensionRootFolder();
        if (!rootFolder || !rootFolder.exists) {
            return JSON.stringify({error: 'Could not resolve extension root'});
        }
        var rootPath = rootFolder.fsName;
        if (!_isPathInsideRoot(targetPath, rootPath, true)) return JSON.stringify({error: 'mkdir target outside extension root'});
        var folder = new Folder(targetPath);
        if (folder.exists) return 'ok';
        if (!folder.create()) return JSON.stringify({error: 'Folder.create() returned false for ' + targetPath});
        return 'ok';
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    }
}

/**
 * Atomic move for OTA: rename a staged file into its final destination.
 * Both src and dst must be inside the extension root and must have allow-listed
 * extensions. Used after staging downloaded update bytes so a partial failure
 * leaves the installed copy untouched.
 */
function moveUpdateFile(srcPath, dstPath) {
    try {
        if (!isValidPath(srcPath) || !isValidPath(dstPath)) {
            return JSON.stringify({error: 'Invalid move path'});
        }
        var allowedExt = ['.js', '.css', '.html', '.htm', '.jsx', '.json', '.svg', '.xml'];
        function hasAllowedExt(p) {
            var lower = p.toLowerCase();
            for (var i = 0; i < allowedExt.length; i++) {
                if (lower.length >= allowedExt[i].length &&
                    lower.substring(lower.length - allowedExt[i].length) === allowedExt[i]) return true;
            }
            return false;
        }
        if (!hasAllowedExt(dstPath)) {
            return JSON.stringify({error: 'Move destination extension not allowed: ' + dstPath});
        }
        var rootFolder = _resolveExtensionRootFolder();
        if (!rootFolder || !rootFolder.exists) {
            return JSON.stringify({error: 'Extension root missing'});
        }
        var rootPath = rootFolder.fsName;
        function underRoot(p) {
            return _isPathInsideRoot(p, rootPath, false);
        }
        if (!underRoot(srcPath) || !underRoot(dstPath)) {
            return JSON.stringify({error: 'Move endpoints outside extension root'});
        }
        var src = new File(srcPath);
        if (!src.exists) {
            return JSON.stringify({error: 'Staged file missing: ' + srcPath});
        }
        var dst = new File(dstPath);
        // ExtendScript File.copy + remove pattern — rename across same volume works
        // but copy+remove is more reliable when dest exists.
        var parentFolder = dst.parent;
        if (!parentFolder.exists) parentFolder.create();
        // If dst exists, delete it first (File.copy refuses to overwrite on Windows)
        if (dst.exists) {
            if (!dst.remove()) {
                return JSON.stringify({error: 'Could not overwrite ' + dstPath});
            }
        }
        if (!src.copy(dst)) {
            return JSON.stringify({error: 'Copy failed ' + srcPath + ' -> ' + dstPath});
        }
        try { src.remove(); } catch (rmErr) {}
        return 'ok';
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    }
}

/**
 * Recursively delete a staging directory under the extension root.
 * Used to clean up after a failed or successful OTA update.
 */
function deleteUpdateDir(dirPath) {
    try {
        if (!isValidPath(dirPath)) return JSON.stringify({error: 'Invalid path'});
        var rootFolder = _resolveExtensionRootFolder();
        if (!rootFolder || !rootFolder.exists) {
            return JSON.stringify({error: 'Could not resolve extension root'});
        }
        var rootPath = rootFolder.fsName;
        var nt = _normalizeForRootCheck(dirPath);
        if (!_isPathInsideRoot(dirPath, rootPath, false)) return JSON.stringify({error: 'Path outside extension root'});
        // Refuse to delete anything that doesn't look like a staging dir
        if (nt.indexOf('/.update-staging') === -1) {
            return JSON.stringify({error: 'Refusing to delete non-staging dir: ' + dirPath});
        }
        var dir = new Folder(dirPath);
        if (!dir.exists) return 'ok';
        function rmTree(folder) {
            var entries = folder.getFiles();
            if (entries) {
                for (var i = 0; i < entries.length; i++) {
                    var e = entries[i];
                    if (e instanceof Folder) {
                        rmTree(e);
                        try { e.remove(); } catch (re) {}
                    } else {
                        try { e.remove(); } catch (re2) {}
                    }
                }
            }
        }
        rmTree(dir);
        try { dir.remove(); } catch (e2) {}
        return 'ok';
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    }
}

/**
 * Get metadata about the active composition for telemetry.
 * Returns JSON string with comp info or "null" if no active comp.
 */
function getActiveCompInfo() {
    try {
        // Same resolution as the stash: a comp selected in the Project panel OR
        // the one open in the viewer. So the modal opens in both cases and never
        // opens for a target the stash would then reject.
        var comp = resolveTargetComp();
        if (!comp || !(comp instanceof CompItem)) return 'null';

        return JSON.stringify({
            name: comp.name,
            width: comp.width,
            height: comp.height,
            duration: comp.duration,
            frameRate: comp.frameRate,
            numLayers: comp.numLayers
        });
    } catch (e) {
        return 'null';
    }
}

// ── Local Library Mirror ──────────────────────────────────────────
// ExtendScript helpers for the local mirror at ~/Blitzkrieg Library/.
// Called by js/local-sync.js via safeEvalScript. All functions return
// a JSON string: {ok:true} on success, {error:"message"} on failure.

/** Filename Blitzkrieg drops in a library root to prove it owns that folder.
 *  blitzLocalWipeLibrary refuses to empty a root without it, so the recursive
 *  delete can never run against an ordinary folder the user happened to type
 *  into the library path field. */
var BLITZ_LIBRARY_MARKER = '.blitzkrieg-library';

/**
 * Write the ownership marker into a library root, so a later wipe is provably
 * scoped to a folder this panel manages.
 *
 * Adoption rule for libraries created before the marker existed: a root already
 * holding Blitzkrieg's own <Category>/<Template>/metadata.json shape is adopted
 * and marked. An ordinary user folder never has that shape, so adoption cannot
 * turn someone's Documents folder into a wipe target.
 *
 * Returns JSON {ok, marked, adopted, reason}.
 */
function blitzLocalEnsureLibraryMarker(rawRootPath, allowAdopt) {
    try {
        if (!isValidPath(rawRootPath)) return JSON.stringify({ error: 'Invalid path' });
        var root = folderFromPath(rawRootPath);
        if (!root.exists) return JSON.stringify({ ok: false, marked: false, reason: 'root missing' });

        var markerFile = new File(buildPath(root.fsName, BLITZ_LIBRARY_MARKER));
        if (markerFile.exists) return JSON.stringify({ ok: true, marked: true, adopted: false });

        var adopted = false;
        if (!allowAdopt) {
            // Marking without adoption is only safe for a folder this panel just
            // created. Stamping an EXISTING folder full of the user's own files
            // would hand the recursive wipe a target it must never have, which is
            // exactly what the marker exists to prevent. An empty folder has
            // nothing to lose, so it can be marked freely.
            var existing = root.getFiles();
            if (existing === null) return JSON.stringify({ ok: false, marked: false, reason: 'cannot read root' });
            if (existing.length > 0) {
                return JSON.stringify({
                    ok: false, marked: false, adopted: false,
                    reason: 'folder is not empty, adoption required'
                });
            }
        }
        if (allowAdopt) {
            // Containing Blitzkrieg content is NOT proof the folder is OURS to empty.
            // A legacy install could have a hand-typed library path pointing at a
            // working folder that holds the editor's own projects alongside the
            // synced categories, and adopting that would hand the recursive wipe a
            // target full of files we never downloaded. Require the folder to be
            // NAMED as a Blitzkrieg library as well. Every path the panel has ever
            // produced satisfies this: the "~/Blitzkrieg Library" default, the
            // Browse suffix, and the Save-path normalization. Only a hand-typed
            // shared folder fails, which is exactly the case we must refuse.
            var leafName = '';
            try { leafName = root.name ? safeDecodeURI(root.name) : ''; } catch (eLeaf) { leafName = ''; }
            if (String(leafName).toLowerCase().indexOf('blitzkrieg library') === -1) {
                return JSON.stringify({
                    ok: false, marked: false, adopted: false,
                    reason: 'folder is not named as a Blitzkrieg library'
                });
            }
            // Look two levels down for a metadata.json. Bail out early - this runs
            // on a library that can hold hundreds of folders.
            var cats = root.getFiles();
            if (cats) {
                for (var c = 0; c < cats.length && !adopted; c++) {
                    if (!(cats[c] instanceof Folder)) continue;
                    var tpls = cats[c].getFiles();
                    if (!tpls) continue;
                    for (var t = 0; t < tpls.length && t < 40; t++) {
                        if (!(tpls[t] instanceof Folder)) continue;
                        var meta = new File(buildPath(tpls[t].fsName, 'metadata.json'));
                        if (meta.exists) { adopted = true; break; }
                    }
                }
            }
            if (!adopted) {
                return JSON.stringify({
                    ok: false, marked: false, adopted: false,
                    reason: 'no Blitzkrieg content found to adopt'
                });
            }
        }

        markerFile.encoding = 'UTF-8';
        if (!markerFile.open('w')) return JSON.stringify({ ok: false, marked: false, reason: 'cannot open marker' });
        markerFile.write('Blitzkrieg local library. Blitzkrieg may delete the contents of this folder.');
        markerFile.close();
        return JSON.stringify({ ok: true, marked: true, adopted: adopted });
    } catch (e) { return JSON.stringify({ error: e + '' }); }
}

/** Create a directory and any missing parents. Returns JSON. */
function blitzLocalMkdir(rawPath) {
    try {
        // folderFromPath normalizes the path (encodes the space in the default
        // "~/Blitzkrieg Library" so ExtendScript's URI-style Folder() resolves on
        // macOS) and falls back to raw if an existing folder was created unencoded.
        // normalizeFsPath no-ops on Windows drive-letter paths, so Windows is unchanged.
        var f = folderFromPath(rawPath);
        if (!f.exists) {
            if (!f.create()) return JSON.stringify({ error: 'Cannot create: ' + rawPath });
        }
        return JSON.stringify({ ok: true });
    } catch (e) { return JSON.stringify({ error: e + '' }); }
}

/** Write text content to a file with UTF-8 encoding. Returns JSON. */
function blitzLocalWriteFile(rawPath, content) {
    try {
        var f = fileFromPath(rawPath);
        f.encoding = 'UTF-8';
        f.open('w');
        if (!f.write(content)) {
            f.close();
            return JSON.stringify({ error: 'Write failed: ' + rawPath });
        }
        f.close();
        return JSON.stringify({ ok: true });
    } catch (e) { return JSON.stringify({ error: e + '' }); }
}

/** Write binary content (base64 encoded) to a file. Returns JSON.
 *  ExtendScript (ES3) has NO atob, so we decode base64 with the same pure-JS
 *  lookup decoder used by decodeBase64FileToBinary. The previous atob() call
 *  threw silently and wrote 0-byte files for every small asset. */
function blitzLocalWriteBinary(rawPath, base64Content) {
    try {
        var base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        var lookup = {};
        for (var li = 0; li < base64chars.length; li++) {
            lookup[base64chars.charAt(li)] = li;
        }
        var cleanBase64 = String(base64Content).replace(/[^A-Za-z0-9+\/]/g, '');
        var DECODE_CHUNK = 32768;
        var parts = [];
        var i = 0;
        while (i < cleanBase64.length) {
            var chunk = '';
            var end = Math.min(i + DECODE_CHUNK, cleanBase64.length);
            end = end - (end % 4);
            if (end <= i) end = Math.min(i + 4, cleanBase64.length);
            while (i < end) {
                var b1 = lookup[cleanBase64.charAt(i++)] || 0;
                var b2 = lookup[cleanBase64.charAt(i++)] || 0;
                var b3c = cleanBase64.charAt(i++);
                var b4c = cleanBase64.charAt(i++);
                var b3 = b3c ? (lookup[b3c] !== undefined ? lookup[b3c] : -1) : -1;
                var b4 = b4c ? (lookup[b4c] !== undefined ? lookup[b4c] : -1) : -1;
                chunk += String.fromCharCode((b1 << 2) | (b2 >> 4));
                if (b3 !== -1) chunk += String.fromCharCode(((b2 & 15) << 4) | (b3 >> 2));
                if (b4 !== -1) chunk += String.fromCharCode(((b3 & 3) << 6) | b4);
            }
            parts.push(chunk);
        }
        var raw = parts.join('');

        // fileFromPath normalizes the macOS URI-style path (the default library
        // root contains a space); Windows drive-letter paths pass through unchanged.
        var f = fileFromPath(rawPath);
        f.encoding = 'BINARY';
        f.open('w');
        if (!f.write(raw)) {
            f.close();
            return JSON.stringify({ error: 'Binary write failed: ' + rawPath });
        }
        f.close();

        // Re-stat the EXACT file we wrote (f.fsName) so the 0-byte guard checks the
        // same normalized path, not a re-resolution that could diverge on macOS.
        var check = new File(f.fsName);
        if (cleanBase64.length > 0 && (!check.exists || check.length === 0)) {
            return JSON.stringify({ error: 'Binary write produced 0 bytes: ' + rawPath });
        }
        return JSON.stringify({ ok: true, size: (check.exists ? check.length : 0) });
    } catch (e) { return JSON.stringify({ error: e + '' }); }
}

/** Check if a file or folder exists at rawPath. Returns JSON {exists, size}.
 *  Normalizes the path (fileFromPath/folderFromPath try encoded then raw) so the
 *  macOS space-in-path default library root resolves; this gate drives the sync
 *  "complete" flag, so an un-normalized miss here made every import re-download. */
function blitzLocalExists(rawPath) {
    try {
        var f = fileFromPath(rawPath);
        if (f.exists) return JSON.stringify({ exists: true, size: f.length });
        var d = folderFromPath(rawPath);
        return JSON.stringify({ exists: d.exists, size: 0 });
    } catch (e) { return JSON.stringify({ exists: false, size: 0 }); }
}

/** Delete a folder and its contents recursively. Returns JSON {ok, remaining, notFound}.
 *  Caller (local-sync.js) MUST validate that rawPath stays inside the library
 *  root before calling - this is a recursive delete primitive.
 *
 *  Folder.remove() only removes an EMPTY folder, so the old bare-remove() form
 *  never deleted a real template folder. removeFolderRecursive is the primitive
 *  the rest of this file uses. It swallows per-entry failures and returns nothing,
 *  so we re-stat afterwards and report `remaining` - callers must gate any
 *  "deleted" claim on remaining === 0, never on ok alone. */
function blitzLocalRemoveDir(rawPath) {
    try {
        if (!isValidPath(rawPath)) return JSON.stringify({ error: 'Invalid path' });
        var f = folderFromPath(rawPath);
        if (!f.exists) return JSON.stringify({ ok: true, remaining: 0, notFound: true });
        removeFolderRecursive(f);
        // Re-stat through a FRESH Folder object; the old handle can cache existence.
        var after = folderFromPath(rawPath);
        if (!after.exists) return JSON.stringify({ ok: true, remaining: 0, notFound: false });
        var left = after.getFiles();
        if (left === null) {
            // getFiles() returns null on macOS for a malformed Folder URI. That is
            // UNREADABLE, not empty. Collapsing it to 0 would tell the caller the
            // delete succeeded and let it drop the state entry, orphaning the bytes
            // with nothing left that knows to look for them.
            return JSON.stringify({
                ok: false,
                unreadable: true,
                remaining: -1,
                folderRemains: true,
                notFound: false,
                error: 'Could not read the folder after deleting'
            });
        }
        return JSON.stringify({
            ok: left.length === 0,
            remaining: left.length,
            folderRemains: true,
            notFound: false
        });
    } catch (e) { return JSON.stringify({ error: e + '' }); }
}

/**
 * Structural refusal list for the library wipe. Returns a reason string when the
 * path must NEVER be wiped, or '' when it is acceptable.
 *
 * This runs BEFORE any containment logic on purpose. Containment answers "is the
 * child inside the root"; it says nothing about whether the ROOT is a sane thing
 * to empty. An empty or half-built library path (local-sync builds paths by bare
 * string concat) can resolve to the home folder or to '/', and a recursive delete
 * there is unrecoverable.
 *
 * ES3: no Array.prototype.forEach / indexOf on arrays, no Array.isArray.
 */
function _blitzWipeRefusalReason(rawRootPath) {
    if (!rawRootPath || typeof rawRootPath !== 'string') return 'Empty path';
    var p = rawRootPath.replace(/\\/g, '/');
    while (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.substring(0, p.length - 1);
    if (!p) return 'Empty path';
    if (p === '/' || p === '~' || p === '.' || p === '..') return 'Refusing to wipe ' + p;
    if (!isValidPath(rawRootPath)) return 'Invalid path';

    var isWindowsPath = /^[A-Za-z]:/.test(p);

    // Segment-count floor. A library root must be nested, never a volume root or a
    // single top-level folder. macOS "/Users/x/Blitzkrieg Library" is 3 segments;
    // Windows "C:/Blitz Library" is 2 (drive counts as one).
    var segs = [];
    var rawSegs = p.split('/');
    for (var s = 0; s < rawSegs.length; s++) {
        if (rawSegs[s] !== '') segs.push(rawSegs[s]);
    }
    var minSegs = isWindowsPath ? 2 : 3;
    if (segs.length < minSegs) return 'Path is too close to the drive root: ' + p;
    if (isWindowsPath && segs.length === 1) return 'Refusing to wipe a drive root';

    // Never the well-known user folders themselves. Compare case-folded, matching
    // _normalizeForRootCheck's platform behaviour.
    var target = _normalizeForRootCheck(p);
    var forbidden = [];
    function _push(v) { if (v) forbidden.push(_normalizeForRootCheck(v)); }
    try { _push(blitzGetHomeDir()); } catch (e1) {}
    try { _push(Folder.myDocuments.fsName); } catch (e2) {}
    try { _push(Folder.desktop.fsName); } catch (e3) {}
    try { _push(Folder.userData.fsName); } catch (e4) {}
    try { _push(Folder.system.fsName); } catch (e5) {}
    try { _push(Folder.startup.fsName); } catch (e6) {}
    try { _push(Folder.temp.fsName); } catch (e7) {}
    for (var f = 0; f < forbidden.length; f++) {
        if (forbidden[f] && target === forbidden[f]) return 'Refusing to wipe a system folder: ' + p;
    }
    return '';
}

/**
 * Empty the Blitzkrieg local library: delete every CHILD of the library root,
 * keeping the root folder itself. Returns JSON
 * {ok, removed, remaining, rootExists, notFound, refused}.
 *
 * Deleting children rather than the root reclaims every byte while keeping the
 * user's configured path valid (he never has to re-pick a folder), and means the
 * containment check never needs allowExact - the one flag that would turn the
 * guard into permission to delete the root itself.
 *
 * `remaining` is authoritative. removeFolderRecursive swallows per-entry errors,
 * so a partial wipe is invisible without the re-stat.
 */
function blitzLocalWipeLibrary(rawRootPath) {
    try {
        var refusal = _blitzWipeRefusalReason(rawRootPath);
        if (refusal) return JSON.stringify({ error: refusal, refused: true });

        // Pass the RAW path. folderFromPath normalizes internally and
        // normalizeFsPath is deliberately non-idempotent, so pre-normalizing here
        // double-encodes and silently targets a folder that does not exist.
        var root = folderFromPath(rawRootPath);
        if (!root.exists) {
            return JSON.stringify({ ok: true, removed: 0, remaining: 0, rootExists: false, notFound: true });
        }

        var rootFs = root.fsName;
        // Re-check the RESOLVED path. A path can pass the string checks and still
        // resolve somewhere else entirely through the normalize/fallback ladder.
        var resolvedRefusal = _blitzWipeRefusalReason(rootFs);
        if (resolvedRefusal) return JSON.stringify({ error: resolvedRefusal, refused: true });

        // Ownership marker. The refusal list blocks the well-known system folders,
        // but nothing stops a user typing an ordinary folder of his own into the
        // library path field. Requiring a marker this panel wrote means the wipe can
        // only ever empty a folder Blitzkrieg created, which is exactly what the
        // confirm dialog promises the user.
        var marker = new File(buildPath(rootFs, BLITZ_LIBRARY_MARKER));
        if (!marker.exists) {
            return JSON.stringify({
                error: 'This folder is not a Blitzkrieg library, so nothing was deleted. Set the library folder again from the sidebar and retry.',
                refused: true,
                noMarker: true
            });
        }

        // getFiles() returns null on macOS when the Folder URI is malformed.
        var entries = root.getFiles();
        if (!entries) {
            return JSON.stringify({ error: 'Cannot read the library folder', rootExists: true });
        }

        var removed = 0;
        var skipped = 0;
        // Names we deliberately left alone. They must NOT count as "bytes we failed
        // to delete" in the re-stat below, or the wipe reports ok:false forever and
        // the UI tells the user to quit After Effects over a shortcut we chose to
        // preserve.
        // Keys are PREFIXED because a bare object is not a safe map in ES3: a file
        // legitimately named "constructor", "toString", "valueOf", "hasOwnProperty"
        // or "__proto__" would inherit a truthy value from Object.prototype and be
        // silently treated as preserved, so a file we failed to delete would vanish
        // from the remaining count and the wipe would report a false success.
        var preserved = {};
        preserved['k:' + BLITZ_LIBRARY_MARKER] = true;
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var entryPath = '';
            var entryName = '';
            try { entryPath = entry.fsName; } catch (eName) { entryPath = ''; }
            try { entryName = entry.name; } catch (eNm) { entryName = ''; }
            // Never delete our own ownership marker. The wipe requires it to run, so
            // deleting it here would make the SECOND wipe refuse with "not a
            // Blitzkrieg library" on a library this panel plainly owns.
            if (entryName === BLITZ_LIBRARY_MARKER) { continue; }
            // allowExact = false: an entry that resolves to the root itself (a
            // symlink loop, a '.' entry) is skipped, never deleted.
            if (!entryPath || !_isPathInsideRoot(entryPath, rootFs, false)) {
                skipped++; if (entryName) preserved['k:' + entryName] = true; continue;
            }
            // An alias/symlink's fsName is the LINK's path, which is always inside
            // the root, so the containment check above passes while
            // removeFolderRecursive would walk the RESOLVED target and delete files
            // outside the library. Never follow a link: skip it entirely.
            var isLink = false;
            try { isLink = !!entry.alias; } catch (eAl) { isLink = false; }
            if (isLink) {
                skipped++; if (entryName) preserved['k:' + entryName] = true; continue;
            }
            try {
                if (entry instanceof Folder) {
                    removeFolderRecursive(entry);
                } else {
                    entry.remove();
                }
                removed++;
            } catch (eRm) { skipped++; }
        }

        // Re-stat. The marker is ours and is expected to survive, so it does not
        // count toward `remaining`.
        var after = folderFromPath(rawRootPath);
        if (!after.exists) {
            return JSON.stringify({
                ok: true, removed: removed, skipped: skipped,
                remaining: 0, rootExists: false, notFound: false
            });
        }
        var left = after.getFiles();
        if (left === null) {
            return JSON.stringify({
                ok: false, unreadable: true, removed: removed, skipped: skipped,
                remaining: -1, rootExists: true, notFound: false,
                error: 'Could not read the library folder after deleting'
            });
        }
        var remaining = 0;
        for (var j = 0; j < left.length; j++) {
            var leftName = '';
            try { leftName = left[j].name; } catch (eLn) { leftName = ''; }
            // preserved holds the marker plus anything we intentionally left alone
            // (out-of-root entries, aliases). remaining must mean "we tried to delete
            // this and could not", nothing else.
            if (leftName && preserved['k:' + leftName]) continue;
            remaining++;
        }

        return JSON.stringify({
            ok: remaining === 0,
            removed: removed,
            skipped: skipped,
            remaining: remaining,
            rootExists: true,
            notFound: false
        });
    } catch (e) { return JSON.stringify({ error: e + '' }); }
}

/** Get the user's home directory. Returns a path string. */
function blitzGetHomeDir() {
    try { return Folder.myDocuments.parent.fsName; } catch (_) { return '~'; }
}

function blitzPickFolder() {
    try {
        var f = Folder.selectDialog('Select Blitzkrieg Library folder');
        if (f) return f.fsName;
        return '';
    } catch (_) { return 'Error: ' + _.message; }
}

/** Open a folder in Finder/Explorer so the user can SEE where files land. Returns
 *  JSON. Uses system.callSystem (a shell open) rather than Folder.execute() so AE's
 *  "Warn User When Executing Files" security prompt does NOT pop on every reveal. */
function blitzRevealInFinder(rawPath) {
    try {
        var f = folderFromPath(rawPath);
        // If the exact folder is missing (e.g. library not synced yet), fall back to
        // the nearest existing ancestor so Reveal still opens something useful.
        var target = f;
        var guard = 0;
        while (target && !target.exists && target.parent && guard < 40) {
            target = target.parent; guard++;
        }
        if (!target || !target.exists) return JSON.stringify({ error: 'Folder not found: ' + rawPath });
        var p = target.fsName;
        var isWin = ($.os && $.os.indexOf('Windows') !== -1);
        if (typeof system !== 'undefined' && system.callSystem) {
            if (isWin) system.callSystem('explorer "' + p + '"');
            else system.callSystem('open "' + p + '"');
            return JSON.stringify({ ok: true });
        }
        // Last resort if callSystem is unavailable: execute() (may prompt).
        target.execute();
        return JSON.stringify({ ok: true });
    } catch (e) { return JSON.stringify({ error: e + '' }); }
}

/** Report free/total bytes on the volume holding rawPath + whether it is writable.
 *  macOS uses `df -Pk` (POSIX single-line). Fails SOFT: any problem returns
 *  {error:...} (or zeros) so the capacity UI degrades and NEVER blocks Set-Path. */
function blitzGetDiskFree(rawPath) {
    try {
        var f = folderFromPath(rawPath);
        // Walk up to the nearest EXISTING ancestor. A not-yet-created library
        // folder (e.g. a fresh /Volumes/LaCie/Blitzkrieg Library the user just
        // picked) will be made by setLibraryPath, so probe the volume/parent that
        // actually exists for BOTH free space and writability - otherwise df runs
        // against a missing path (returns nothing) and the write test fails, which
        // would blank the capacity line and wrongly report "not writable".
        var probe = f;
        var guard = 0;
        while (probe && !probe.exists && probe.parent && guard < 40) {
            probe = probe.parent; guard++;
        }
        var probePath = (probe && probe.fsName) ? probe.fsName : ((f && f.fsName) ? f.fsName : rawPath);
        var writable = false;
        if (probe && probe.exists) {
            try {
                var tf = new File(probe.fsName + '/.blitz_write_test');
                tf.encoding = 'UTF-8';
                if (tf.open('w')) { tf.write('ok'); tf.close(); tf.remove(); writable = true; }
            } catch (we) { writable = false; }
        }
        var freeBytes = 0, totalBytes = 0;
        var isWin = ($.os && $.os.indexOf('Windows') !== -1);
        if (!isWin && typeof system !== 'undefined' && system.callSystem) {
            var out = system.callSystem('/bin/df -Pk "' + probePath + '"');
            if (out) {
                var lines = String(out).split('\n');
                var row = '';
                for (var i = lines.length - 1; i >= 0; i--) {
                    if (lines[i] && lines[i].replace(/^\s+|\s+$/g, '').length > 0) { row = lines[i]; break; }
                }
                var parts = row.replace(/^\s+|\s+$/g, '').split(/\s+/);
                // POSIX df columns: Filesystem 1024-blocks Used Available Capacity Mounted
                if (parts.length >= 4) {
                    var totalK = parseFloat(parts[1]);
                    var availK = parseFloat(parts[3]);
                    if (!isNaN(totalK)) totalBytes = totalK * 1024;
                    if (!isNaN(availK)) freeBytes = availK * 1024;
                }
            }
        }
        return JSON.stringify({ freeBytes: freeBytes, totalBytes: totalBytes, writable: writable });
    } catch (e) { return JSON.stringify({ error: e + '' }); }
}

function blitzLocalListAep(rawPath) {
    try {
        var f = folderFromPath(rawPath);
        if (!f.exists) return JSON.stringify({ files: [] });
        var aepFiles = [];
        var all = f.getFiles('*.aep');
        for (var i = 0; i < all.length; i++) {
            // Skip macOS ._ AppleDouble resource forks and 0-byte files —
            // neither is an importable project.
            if (all[i] instanceof File && all[i].name.indexOf('._') !== 0 && all[i].length > 0) {
                aepFiles.push(all[i].name);
            }
        }
        return JSON.stringify({ files: aepFiles });
    } catch (_) { return JSON.stringify({ error: _.message }); }
}
