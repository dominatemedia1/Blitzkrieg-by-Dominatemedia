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

// Self-test: verify polyfill produces valid JSON (catches future regressions)
(function() {
    try {
        var _t = JSON.stringify({"a": "b", "n": 1, "x": null});
        if (_t.indexOf('"a"') === -1) {
            $.writeln("Blitzkrieg: CRITICAL - JSON.stringify polyfill self-test FAILED: " + _t);
        }
    } catch (e) {
        $.writeln("Blitzkrieg: CRITICAL - JSON.stringify self-test threw: " + e.toString());
    }
}());

/**
 * ============================================================================
 * AFTER EFFECTS VERSION DETECTION AND COMPATIBILITY
 * ============================================================================
 */
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
        // Encode only URI-significant characters that appear in file paths
        // Do NOT use encodeURIComponent - it breaks non-ASCII chars in ExtendScript
        return path.replace(/ /g, '%20').replace(/#/g, '%23').replace(/\?/g, '%3F');
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
 * Returns a safe temp Folder for writing files.
 * On macOS, Folder.temp resolves to /var/folders/.../T/TemporaryItems/ which
 * has OS-managed cleanup and permission restrictions that prevent After Effects'
 * rendering engine (saveFrameToPng) from writing files reliably.
 * Tries multiple fallbacks: /tmp, ~/Library/Caches, desktop, then Folder.temp.
 * Validates writability with a test file before returning.
 */
function getSafeTempFolder() {
    var candidates = [];
    // macOS: prefer /tmp (always writable, no TemporaryItems restrictions)
    if ($.os.indexOf('Mac') !== -1 || $.os.indexOf('Macintosh') !== -1) {
        candidates.push(new Folder('/tmp'));
        // Fallback: user Library/Caches
        try { candidates.push(new Folder(Folder.userData.fsName + '/Caches')); } catch(e) {}
    }
    // Cross-platform fallbacks (never use Desktop — leftover temp files confuse users)
    // Windows: Folder.temp resolves to %TEMP%; macOS: to /var/folders/.../TemporaryItems
    candidates.push(Folder.temp);

    for (var ci = 0; ci < candidates.length; ci++) {
        var f = candidates[ci];
        if (!f || !f.exists) continue;
        // Write test: verify AE can actually create files here
        try {
            var testFile = new File(f.fsName + '/_blitz_write_test_' + Date.now() + '.tmp');
            testFile.open('w');
            testFile.write('ok');
            testFile.close();
            if (testFile.exists) {
                testFile.remove();
                return f;
            }
        } catch (wErr) { /* try next candidate */ }
    }
    // Absolute last resort
    return Folder.temp;
}

/**
 * Preview frame generation constants — shared across stashSelectedComp,
 * generatePreviewFrames, and generatePreviewsToDisk so bumping any of these
 * values only requires one edit instead of three.
 */
var PREVIEW_TARGET_FPS = 6;
var PREVIEW_MIN_FRAMES = 12;
var PREVIEW_MAX_FRAMES = 72;

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
                    files: []
                };

                var cmpFiles = cmpFolder.getFiles();
                if (cmpFiles) {
                    for (var k = 0; k < cmpFiles.length; k++) {
                        var f = cmpFiles[k];
                        var fname = safeDecodeURI(f.name);
                        cmpInfo.files.push(fname);
                        if (fname.toLowerCase().indexOf('.aep') !== -1) cmpInfo.hasAep = true;
                        if (fname === 'metadata.json') cmpInfo.hasMetadata = true;
                        if (fname === 'comp.png') cmpInfo.hasThumbnail = true;
                    }
                }

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

        var selectedItems = app.project.selection;
        if (selectedItems.length !== 1 || !(selectedItems[0] instanceof CompItem)) {
            return "Error: Please select exactly one composition in the Project Panel.";
        }

        var compToSave = selectedItems[0];
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

        try {
            // Save main thumbnail (middle frame)
            var frameTime = compToSave.workAreaStart + (compToSave.workAreaDuration / 2);
            compToSave.saveFrameToPng(frameTime, thumbFile);

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
                        previewFrameCount++;
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

                // Step 6: compute a unique destination filename inside (Footage)
                var destFile = new File(buildPath(footageFolder, sourceFile.name));
                var counter = 1;
                while (destFile.exists) {
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

        // --- Restore original project ---
        if (originalProjectFile && originalProjectFile.exists) {
            app.open(originalProjectFile);
        }

        // End dialog suppression immediately after the last save/open call.
        // Don't leave it active during cleanup or return logic.
        if (_stashDialogsSuppressed) { try { app.endSuppressDialogs(false); } catch(e) {} _stashDialogsSuppressed = false; }

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
                   ". Open the bundle in AE, relink the missing files, and re-stash to fix.";
        }

        // Memory-limit warning for stash: thumbnail/preview rendering hit AE's
        // "Memory allocation exceeds internal limit" error. The template still
        // uploaded but the previews are incomplete. Muhammad's tip surfaced as
        // actionable guidance for the editor.
        if (stashMemoryErrorHit) {
            return "Warning: '" + compToSaveName + "' was added but AE hit its memory limit while rendering previews. This usually means Motion Tile (or a similar effect) has very large Output Width/Height values. Lower those values and re-stash to get full preview frames.";
        }

        return "Success! '" + compToSaveName + "' was added to your library.";

    } catch (e) {
        if (_stashDialogsSuppressed) { try { app.endSuppressDialogs(false); } catch(e2) {} }
        // Try to restore original project on error
        try {
            if (originalProjectFile && originalProjectFile.exists) {
                app.open(originalProjectFile);
            }
        } catch (restoreErr) {
            $.writeln("Blitzkrieg: Error restoring project: " + restoreErr.toString());
        }
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

        // Suppress "file not found" dialogs on AE versions where it's safe.
        // AE 2024+ (majorVersion >= 24) crashes with "Object is invalid" when
        // beginSuppressDialogs() is active during importFile() — skip on those.
        var _importDialogsSuppressed = false;
        if (AE_VERSION_INFO.majorVersion > 0 && AE_VERSION_INFO.majorVersion < 24) {
            try { app.beginSuppressDialogs(); _importDialogsSuppressed = true; } catch (sdErr) {}
        }

        // Import with optimized settings
        var importOptions = new ImportOptions(fileToImport);
        importOptions.importAs = ImportAsType.PROJECT;

        var importedItem = app.project.importFile(importOptions);

        if (_importDialogsSuppressed) {
            try { app.endSuppressDialogs(false); } catch (edErr) {}
            _importDialogsSuppressed = false;
        }

        if (!importedItem) {
            app.endUndoGroup();
            return "Error: Import returned no items.";
        }

        // Recursive comp discovery — imported AEPs can have nested folders.
        // We use EXACT name match only for the override; the previous substring
        // match would falsely override the first comp with any other CompItem
        // whose name happened to contain the target as a substring (e.g.
        // compName="Logo" was overridden by "Logo Reveal" or "My Logo Big"),
        // randomly opening the wrong composition.
        var mainComp = null;
        function findCompInFolder(folder) {
            for (var j = 1; j <= folder.numItems; j++) {
                var child = folder.item(j);
                if (child instanceof CompItem) {
                    if (!mainComp) mainComp = child;
                    if (child.name === compName) {
                        mainComp = child;
                        return true; // exact match found
                    }
                } else if (child instanceof FolderItem) {
                    if (findCompInFolder(child)) return true;
                }
            }
            return false;
        }
        if (importedItem instanceof FolderItem) {
            importedItem.name = compName + " [Blitzkrieg]";
            findCompInFolder(importedItem);
        } else if (importedItem instanceof CompItem) {
            mainComp = importedItem;
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
                                if (mainComp) {
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
        }

        if (mainComp && mainComp.name !== compName) {
            mainComp.name = compName;
        }

        // AUTO-OPEN: Open the imported comp in the viewer/timeline.
        // openInViewer() during ExtendScript eval often fails because the CEP panel
        // holds focus. We schedule multiple delayed attempts that also call
        // viewer.setActive() to force the Timeline panel to the front.
        if (mainComp) {
            try {
                mainComp.selected = true;
                var v = mainComp.openInViewer();
                if (v) try { v.setActive(); } catch(e) {}
            } catch (viewerErr) {}

            // Build a reusable script that recursively finds the comp and opens it.
            // Scheduled tasks run after CEP releases focus, so openInViewer works.
            var _openScript =
                '(function(){' +
                '  function find(p){' +
                '    for(var i=1;i<=p.numItems;i++){' +
                '      try{' +
                '        var it=p.item(i);' +
                '        if(it instanceof CompItem && it.id==' + mainComp.id + '){' +
                '          it.selected=true;' +
                '          var v=it.openInViewer();' +
                '          if(v)try{v.setActive();}catch(e){}' +
                '          return true;' +
                '        }' +
                '        if(it instanceof FolderItem && find(it))return true;' +
                '      }catch(e){}' +
                '    }' +
                '    return false;' +
                '  }' +
                '  find(app.project.rootFolder);' +
                '})()';

            // Schedule two attempts at staggered delays for reliability
            try { app.scheduleTask(_openScript, 300, false); } catch(e) {}
            try { app.scheduleTask(_openScript, 800, false); } catch(e) {}
        }

        app.endUndoGroup();
        return mainComp ? "Success: '" + compName + "' imported." : "Success: Project imported.";

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
                        var metadata = JSON.parse(metadataFile.read());
                        metadataFile.close();

                        metadata.category = newName;

                        metadataFile.open('w');
                        metadataFile.encoding = 'UTF-8';
                        metadataFile.write(JSON.stringify(metadata));
                        metadataFile.close();
                    } catch (metaErr) {
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
                var metadata = JSON.parse(metadataFile.read());
                metadataFile.close();

                metadata.category = newCategory;

                metadataFile.open('w');
                metadataFile.encoding = 'UTF-8';
                metadataFile.write(JSON.stringify(metadata));
                metadataFile.close();
            } catch (metaErr) {
                $.writeln("Blitzkrieg: Warning - Could not update metadata: " + metaErr.toString());
            }
        }

        // Remove original folder ONLY after we know the copy succeeded.
        removeFolderRecursive(sourceFolder);

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

        // Temporarily import the AEP to generate frames
        // Version-gated dialog suppression: safe on AE < 2024, skip on 2024+
        var _genFrameDialogsSuppressed = false;
        if (AE_VERSION_INFO.majorVersion > 0 && AE_VERSION_INFO.majorVersion < 24) {
            try { app.beginSuppressDialogs(); _genFrameDialogsSuppressed = true; } catch (sdErr) {}
        }
        var importOptions = new ImportOptions(aepFile);
        importOptions.importAs = ImportAsType.PROJECT;
        var importedItem = app.project.importFile(importOptions);
        if (_genFrameDialogsSuppressed) {
            try { app.endSuppressDialogs(false); } catch (edErr) {}
            _genFrameDialogsSuppressed = false;
        }

        if (!importedItem) {
            // Restore the original project before returning so we don't leak the
            // user's current context into the blitzkrieg temp AEP.
            if (originalProjectFile && originalProjectFile.exists) {
                try { app.open(originalProjectFile); } catch (restImpErr) {}
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
            // Clean up imported item
            if (importedItem) importedItem.remove();
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
                    previewFrameCount++;
                } catch (previewErr) {
                    $.writeln("Blitzkrieg: Warning - Could not generate preview frame " + pf + ": " + previewErr.toString());
                }
            }

            // Also regenerate the main thumbnail
            try {
                var thumbFile = new File(buildPath(compFolder, "comp.png"));
                var thumbTime = mainComp.workAreaStart + (mainComp.workAreaDuration / 2);
                mainComp.saveFrameToPng(thumbTime, thumbFile);
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
                var metadata = JSON.parse(metadataFile.read());
                metadataFile.close();

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
                $.writeln("Blitzkrieg: Warning - Could not update metadata: " + metaErr.toString());
            }
        }

        // Clean up - remove imported project
        if (importedItem) {
            importedItem.remove();
        }

        // Restore original project if needed
        if (originalProjectFile && originalProjectFile.exists) {
            app.open(originalProjectFile);
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
        // Try to restore original project on error
        try {
            if (originalProjectFile && originalProjectFile.exists) {
                app.open(originalProjectFile);
            }
        } catch (restoreErr) {
            $.writeln("Blitzkrieg: Error restoring project: " + restoreErr.toString());
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
        var f = new File(filePath);
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
        var b64File = new File(base64FilePath);
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

        var outFile = new File(outputPath);
        outFile.encoding = 'BINARY';
        outFile.open('w');
        outFile.write(binary);
        outFile.close();

        return outFile.exists ? outFile.fsName : 'ERROR: Write failed';
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
function generatePreviewsToDisk(aepPath, outputDir) {
    // NOTE: Dialog suppression is deliberately deferred until AFTER the import.
    // On AE 2024/2025, beginSuppressDialogs() before app.project.importFile() can
    // cause the importer to throw "ReferenceError: Object is invalid" when the AEP
    // triggers a version-compatibility or missing-footage dialog that AE then
    // cannot show. Suppressing dialogs only around saveFrameToPng() (the operation
    // that actually spams modal "Could not create file" dialogs on Windows) avoids
    // the import-time crash while still protecting batch rendering.
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

        // --- Import the AEP with version-gated dialog suppression ---
        // On AE < 2024, beginSuppressDialogs() safely silences "file not found"
        // dialogs during import. On AE 2024+ it crashes (see note at top of function).
        _currentStep = 'import_file';
        var importError = null;
        var _genImportDialogsSuppressed = false;
        if (AE_VERSION_INFO.majorVersion > 0 && AE_VERSION_INFO.majorVersion < 24) {
            try { app.beginSuppressDialogs(); _genImportDialogsSuppressed = true; } catch (sdErr) {}
        }
        try {
            var importOptions = new ImportOptions(aepFile);
            importOptions.importAs = ImportAsType.PROJECT;
            importedItem = app.project.importFile(importOptions);
        } catch (impErr1) {
            importError = impErr1;
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
            if (AE_VERSION_INFO.majorVersion > 0 && AE_VERSION_INFO.majorVersion < 24) {
                try { app.beginSuppressDialogs(); _genImportDialogsSuppressed = true; } catch (sdErr2) {}
            }
            try {
                var retryOptions = new ImportOptions(aepFile);
                retryOptions.importAs = ImportAsType.PROJECT;
                importedItem = app.project.importFile(retryOptions);
                if (importedItem) importError = null;
            } catch (impErr2) {
                if (!importError) importError = impErr2;
            }
            if (_genImportDialogsSuppressed) {
                try { app.endSuppressDialogs(false); } catch (edErr2) {}
                _genImportDialogsSuppressed = false;
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
        var thumbFile = new File(outFolder.fsName + '/comp.png');
        var thumbMemoryError = null;
        for (var tt = 0; tt < thumbTimes.length; tt++) {
            try {
                mainComp.saveFrameToPng(thumbTimes[tt], thumbFile);
                if (thumbFile.exists) break;
            } catch (thumbErr) {
                // Look for AE's memory-allocation diagnostic string. The exact text
                // has varied across versions but always contains "memory allocation"
                // and "exceeds". Match substrings case-insensitively.
                var tem = thumbErr.toString().toLowerCase();
                if (tem.indexOf('memory allocation') !== -1 && tem.indexOf('exceed') !== -1) {
                    thumbMemoryError = thumbErr.toString();
                    break; // no point retrying other timestamps — it's a comp-wide issue
                }
                /* otherwise try next timestamp */
            }
        }

        if (!thumbFile.exists) {
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
            return JSON.stringify({
                frameCount: 0,
                duration: compDuration,
                width: compWidth,
                height: compHeight,
                thumbnailOnly: true,
                missingFootage: missingFootageNames
            });
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
                    if (frameFile.exists) {
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
            height: compHeight
        };
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
 * Get the extension root path (parent of jsx/ folder where this script lives).
 * Returns the path string on success, or the literal string "ERROR: ..." on failure.
 * (The previous version returned JSON.stringify({error: ...}), which the JS caller
 * didn't detect and would have used as if it were a real path.)
 */
function getExtensionRootPath() {
    try {
        var scriptFile = new File($.fileName);
        var jsxFolder = scriptFile.parent;
        var rootFolder = jsxFolder.parent;
        return rootFolder.fsName;
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
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
        var rootFolder;
        try {
            var scriptFile = new File($.fileName);
            rootFolder = scriptFile.parent.parent; // jsx/ -> extension root
        } catch (rootErr) {
            return JSON.stringify({error: 'Could not resolve extension root: ' + rootErr.toString()});
        }
        if (!rootFolder || !rootFolder.exists) {
            return JSON.stringify({error: 'Extension root missing'});
        }
        var rootPath = rootFolder.fsName;
        // Normalize both paths to forward slashes for comparison. On case-
        // insensitive filesystems (macOS APFS/HFS+ default, Windows NTFS) also
        // lowercase both sides so a legitimate `/library/...` casing variation
        // isn't incorrectly rejected.
        var normalizedTarget = filePath.replace(/\\/g, '/');
        var normalizedRoot = rootPath.replace(/\\/g, '/');
        var caseInsensitive = ($.os.indexOf('Windows') !== -1) || ($.os.indexOf('Mac') !== -1);
        if (caseInsensitive) {
            normalizedTarget = normalizedTarget.toLowerCase();
            normalizedRoot = normalizedRoot.toLowerCase();
        }
        // Strip trailing slashes
        while (normalizedRoot.length > 1 && normalizedRoot.charAt(normalizedRoot.length - 1) === '/') {
            normalizedRoot = normalizedRoot.substring(0, normalizedRoot.length - 1);
        }
        // Enforce exact match or strictly-under — prevents prefix-collision attacks
        // where an extension root of `/Library/Extensions/Blitzkrieg` would otherwise
        // allow writes to `/Library/Extensions/Blitzkrieg-evil/payload.js`.
        var exactRoot = normalizedTarget === normalizedRoot;
        var underRoot = normalizedTarget.length > normalizedRoot.length &&
                        normalizedTarget.substring(0, normalizedRoot.length) === normalizedRoot &&
                        normalizedTarget.charAt(normalizedRoot.length) === '/';
        if (!exactRoot && !underRoot) {
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