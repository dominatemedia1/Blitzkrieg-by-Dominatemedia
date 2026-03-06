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
        var safeCompName = compToSaveName.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_');

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

                // DYNAMIC frame count: ~6 FPS preview, min 12, max 72 frames
                // This ensures the full animation is captured at reasonable quality
                var targetPreviewFPS = 6;
                var minFrames = 12;
                var maxFrames = 72;
                var dynamicFrameCount = Math.ceil(compDuration * targetPreviewFPS);
                var actualFrameCount = Math.max(minFrames, Math.min(maxFrames, dynamicFrameCount));

                // Ensure we don't exceed actual composition frames
                actualFrameCount = Math.min(actualFrameCount, totalFrames);

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
                        $.writeln("Blitzkrieg: Warning - Could not generate preview frame " + pf + ": " + previewErr.toString());
                    }
                }
            }
        } catch(e) {
            $.writeln("Blitzkrieg: Warning - Could not generate thumbnail: " + e.toString());
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

        // --- Save the project first if it hasn't been saved ---
        if (!originalProjectFile) {
            // Project hasn't been saved yet - we need to save it first
            var tempProjectFile = new File(buildPath(Folder.temp, "blitzkrieg_temp_" + timestamp + ".aep"));
            app.project.save(tempProjectFile);
            originalProjectFile = tempProjectFile;
        } else if (projectWasDirty) {
            // Save current changes
            app.project.save(originalProjectFile);
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
        for (var ri = 1; ri <= app.project.numItems; ri++) {
            try {
                var riItem = app.project.item(ri);
                if ((riItem instanceof CompItem) && riItem.id === compId) {
                    freshComp = riItem;
                    break;
                }
            } catch (riErr) { /* skip any inaccessible items */ }
        }
        if (!freshComp) freshComp = compToSave; // safe fallback

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

        // Collect all footage items.
        // Cache numItems before the loop so it stays stable even if AE updates the count.
        var collectedFiles = {};
        var totalItems = app.project.numItems;
        for (var i = 1; i <= totalItems; i++) {
            try {
                var item = app.project.item(i);
                if (!(item instanceof FootageItem)) continue;
                if (!item.mainSource || !item.mainSource.file) continue;

                var sourceFile = item.mainSource.file;
                // Skip system files and already collected files
                if (sourceFile.exists && !collectedFiles[sourceFile.fsName]) {
                    // Skip Adobe system files
                    var pathLower = sourceFile.fsName.toLowerCase();
                    if (pathLower.indexOf("adobe") === -1 &&
                        pathLower.indexOf("plug-ins") === -1 &&
                        pathLower.indexOf("plugins") === -1) {

                        var destFile = new File(buildPath(footageFolder, sourceFile.name));
                        // Handle duplicate filenames
                        var counter = 1;
                        while (destFile.exists) {
                            var nameParts = sourceFile.name.split('.');
                            var ext = nameParts.pop();
                            var baseName = nameParts.join('.');
                            destFile = new File(buildPath(footageFolder, baseName + "_" + counter + "." + ext));
                            counter++;
                        }

                        if (sourceFile.copy(destFile)) {
                            try {
                                item.replace(destFile);
                                collectedFiles[sourceFile.fsName] = true;
                            } catch (replaceErr) {
                                $.writeln("Blitzkrieg: Warning - Could not replace footage: " + replaceErr.toString());
                            }
                        }
                    }
                }
            } catch (itemErr) {
                $.writeln("Blitzkrieg: Warning - Could not process item " + i + ": " + itemErr.toString());
            }
        }

        // Save the reduced project to library
        // Try the primary path first, then fallback strategies for macOS
        var finalAEPFile = new File(buildPath(compFolder, safeCompName + ".aep"));
        $.writeln("Blitzkrieg: Saving AEP to: " + finalAEPFile.fsName);
        app.project.save(finalAEPFile);

        // MACFIX: Verify the AEP was actually saved - app.project.save() can fail silently on macOS
        if (!finalAEPFile.exists) {
            $.writeln("Blitzkrieg: WARNING - AEP save failed at primary path, trying fallback...");
            // Fallback: try saving with raw fsName path (no URI encoding)
            var rawAEPPath = compFolder.fsName + "/" + safeCompName + ".aep";
            var rawAEPFile = new File(rawAEPPath);
            app.project.save(rawAEPFile);

            if (!rawAEPFile.exists) {
                $.writeln("Blitzkrieg: WARNING - AEP save failed at raw path too, trying comp.aep...");
                // Last resort: save as comp.aep using a simple filename
                var simpleAEPFile = new File(buildPath(compFolder, "comp.aep"));
                app.project.save(simpleAEPFile);

                if (!simpleAEPFile.exists) {
                    // Try one more time with raw path
                    var simpleRawFile = new File(compFolder.fsName + "/comp.aep");
                    app.project.save(simpleRawFile);
                }
            }
        }

        // Log final verification
        var savedAEP = robustFindAep(compFolder);
        if (savedAEP) {
            $.writeln("Blitzkrieg: AEP verified at: " + savedAEP.fsName);
        } else {
            $.writeln("Blitzkrieg: CRITICAL - No AEP file found after save attempts in: " + compFolder.fsName);
        }

        app.endUndoGroup();

        // --- Restore original project ---
        if (originalProjectFile && originalProjectFile.exists) {
            app.open(originalProjectFile);
        }

        // Clean up temp file if we created one
        if (originalProjectFile && originalProjectFile.fsName.indexOf("blitzkrieg_temp_") !== -1) {
            // Don't delete - user might need it
        }

        return "Success! '" + compToSaveName + "' was added to your library.";

    } catch (e) {
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
function importComp(aepPath) {
    if (!isValidPath(aepPath)) {
        return "Error: Invalid file path.";
    }

    try {
        if (!app.project) return "Error: Please open a project first.";

        var fileToImport = fileFromPath(aepPath);
        if (!fileToImport.exists) return "Error: Source AEP file not found.";

        // Quick metadata read for comp name - use parent Folder object for macOS compatibility
        var parentFolder = fileToImport.parent;
        var metadataFile = new File(buildPath(parentFolder, "metadata.json"));
        var compName = "Imported Comp";

        if (metadataFile.exists) {
            try {
                metadataFile.open('r');
                var metaContent = metadataFile.read();
                metadataFile.close();
                if (metaContent) {
                    var metadata = JSON.parse(metaContent);
                    compName = metadata.displayName || compName;
                }
            } catch(e) {}
        }

        app.beginUndoGroup("Blitzkrieg Import");

        // Import with optimized settings
        var importOptions = new ImportOptions(fileToImport);
        importOptions.importAs = ImportAsType.PROJECT;

        var importedItem = app.project.importFile(importOptions);
        if (!importedItem) {
            app.endUndoGroup();
            return "Error: Import returned no items.";
        }

        // Fast comp discovery
        var mainComp = null;
        if (importedItem instanceof FolderItem) {
            importedItem.name = compName + " [Blitzkrieg]";
            var numItems = importedItem.numItems;
            for (var i = 1; i <= numItems; i++) {
                var item = importedItem.item(i);
                if (item instanceof CompItem) {
                    if (!mainComp) mainComp = item;
                    if (item.name === compName || item.name.indexOf(compName) !== -1) {
                        mainComp = item;
                        break;
                    }
                }
            }
        } else if (importedItem instanceof CompItem) {
            mainComp = importedItem;
        }

        if (mainComp && mainComp.name !== compName) {
            mainComp.name = compName;
        }

        // AUTO-OPEN: Open the imported comp in the viewer/timeline
        if (mainComp) {
            try {
                // Method 1: Select the comp in the project panel first
                mainComp.selected = true;

                // Method 2: Open the comp in the Composition panel (timeline/viewer)
                var viewer = mainComp.openInViewer();

                // Method 3: If viewer was opened, make sure it's active and maximized for visibility
                if (viewer) {
                    viewer.setActive();
                }
            } catch (viewerErr) {
                $.writeln("Blitzkrieg: Warning - Could not open comp in viewer: " + viewerErr.toString());
            }
        }

        app.endUndoGroup();
        return mainComp ? "Success: '" + compName + "' imported." : "Success: Project imported.";

    } catch (e) {
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
            metadataFile.open('r');
            metadata = JSON.parse(metadataFile.read());
            metadataFile.close();
        }
        metadata.displayName = newName;
        metadataFile.open('w');
        metadataFile.encoding = 'UTF-8';
        metadataFile.write(JSON.stringify(metadata));
        metadataFile.close();

        // Also rename the .aep file itself for consistency
        var aepFiles = aepFolder.getFiles("*.aep");
        if (aepFiles.length > 0) {
            var oldAEP = aepFiles[0];
            var safeNewName = newName.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_');
            oldAEP.rename(safeNewName + ".aep");
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
            function removeFolderRecursive(folder) {
                var items = folder.getFiles();
                for (var i = 0; i < items.length; i++) {
                    if (items[i] instanceof File) {
                        items[i].remove();
                    } else if (items[i] instanceof Folder) {
                        removeFolderRecursive(items[i]);
                    }
                }
                folder.remove();
            }
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
            // Update metadata.json in each comp folder to reflect new category
            var renamedFolder = folderFromPath(libraryPath + "/" + newName);
            var compFolders = renamedFolder.getFiles(function(f) { return f instanceof Folder; });
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

        function removeFolderRecursive(folder) {
            var items = folder.getFiles();
            for (var i = 0; i < items.length; i++) {
                if (items[i] instanceof File) {
                    items[i].remove();
                } else if (items[i] instanceof Folder) {
                    removeFolderRecursive(items[i]);
                }
            }
            folder.remove();
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

        // Copy all files recursively - use Folder objects (not fsName) for macOS compatibility
        function copyFolderRecursive(source, target) {
            if (!target.exists) target.create();
            var items = source.getFiles();
            for (var i = 0; i < items.length; i++) {
                if (items[i] instanceof File) {
                    var destFile = new File(buildPath(target, items[i].name));
                    items[i].copy(destFile);
                } else if (items[i] instanceof Folder) {
                    var destFolder = new Folder(buildPath(target, items[i].name));
                    copyFolderRecursive(items[i], destFolder);
                }
            }
        }

        function removeFolderRecursive(folder) {
            var items = folder.getFiles();
            for (var i = 0; i < items.length; i++) {
                if (items[i] instanceof File) {
                    items[i].remove();
                } else if (items[i] instanceof Folder) {
                    removeFolderRecursive(items[i]);
                }
            }
            folder.remove();
        }

        // Copy to new location
        copyFolderRecursive(sourceFolder, targetFolder);

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

        // Remove original folder
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

        // Remove existing preview folder if it exists
        if (previewFolder.exists) {
            var existingFiles = previewFolder.getFiles();
            for (var ef = 0; ef < existingFiles.length; ef++) {
                if (existingFiles[ef] instanceof File) {
                    existingFiles[ef].remove();
                }
            }
        } else {
            previewFolder.create();
        }

        // Temporarily import the AEP to generate frames
        var importOptions = new ImportOptions(aepFile);
        importOptions.importAs = ImportAsType.PROJECT;
        var importedItem = app.project.importFile(importOptions);

        if (!importedItem) {
            return "Error: Could not import composition for preview generation.";
        }

        // Find the main composition
        var mainComp = null;
        if (importedItem instanceof FolderItem) {
            for (var i = 1; i <= importedItem.numItems; i++) {
                var item = importedItem.item(i);
                if (item instanceof CompItem) {
                    mainComp = item;
                    break;
                }
            }
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
            // DYNAMIC frame count: ~6 FPS preview, min 12, max 72 frames
            // This ensures the full animation is captured at reasonable quality
            var targetPreviewFPS = 6;
            var minFrames = 12;
            var maxFrames = 72;
            var dynamicFrameCount = Math.ceil(compDuration * targetPreviewFPS);
            var actualFrameCount = Math.max(minFrames, Math.min(maxFrames, dynamicFrameCount));

            // Ensure we don't exceed actual composition frames
            actualFrameCount = Math.min(actualFrameCount, totalFrames);

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
    var tempFolder = Folder.temp;
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
 * Read stashed files from a comp folder as base64 for upload.
 */
function readStashedFilesAsBase64(compFolderPath) {
    try {
        var folder = new Folder(compFolderPath);
        if (!folder.exists) return JSON.stringify({error: 'Temp folder not found'});

        // Find the comp subfolder (first subfolder)
        var subFolders = folder.getFiles(function(f) { return f instanceof Folder; });
        if (subFolders.length === 0) return JSON.stringify({error: 'No comp folder found'});

        var compFolder = subFolders[0];
        var folderName = compFolder.name;

        // Read .aep file
        var aepFiles = compFolder.getFiles('*.aep');
        if (aepFiles.length === 0) return JSON.stringify({error: 'No .aep file found'});

        var aepBase64 = readFileAsBase64(aepFiles[0]);

        // Read thumbnail (stashSelectedComp saves as comp.png)
        var thumbFiles = compFolder.getFiles('comp.png');
        if (thumbFiles.length === 0) thumbFiles = compFolder.getFiles('thumbnail.jpg');
        if (thumbFiles.length === 0) thumbFiles = compFolder.getFiles('thumbnail.png');
        var thumbnailBase64 = thumbFiles.length > 0 ? readFileAsBase64(thumbFiles[0]) : null;

        // Read metadata
        var metaFiles = compFolder.getFiles('metadata.json');
        var metadata = {};
        if (metaFiles.length > 0) {
            metaFiles[0].open('r');
            var metaContent = metaFiles[0].read();
            metaFiles[0].close();
            metadata = JSON.parse(metaContent);
        }

        // Read preview frames if they exist
        var previewFramesBase64 = [];
        var previewFolder = new Folder(compFolder.fsName + '/preview');
        if (previewFolder.exists) {
            var frameCount = metadata.previewFrames || 0;
            for (var fi = 0; fi < frameCount; fi++) {
                var frameFile = new File(previewFolder.fsName + '/frame_' + fi + '.png');
                if (frameFile.exists) {
                    previewFramesBase64.push(readFileAsBase64(frameFile));
                }
            }
        }

        return JSON.stringify({
            folderName: folderName,
            aepBase64: aepBase64,
            thumbnailBase64: thumbnailBase64,
            metadata: metadata,
            previewFramesBase64: previewFramesBase64
        });
    } catch (e) {
        return JSON.stringify({error: e.toString()});
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
    var result = '';
    var i = 0;
    while (i < content.length) {
        var b1 = content.charCodeAt(i++) & 0xFF;
        var b2 = i < content.length ? content.charCodeAt(i++) & 0xFF : 0;
        var b3 = i < content.length ? content.charCodeAt(i++) & 0xFF : 0;
        var padding = (i > content.length + 1) ? 2 : (i > content.length) ? 1 : 0;

        result += base64chars.charAt(b1 >> 2);
        result += base64chars.charAt(((b1 & 3) << 4) | (b2 >> 4));
        result += padding >= 1 ? '=' : base64chars.charAt(((b2 & 15) << 2) | (b3 >> 6));
        result += padding >= 2 ? '=' : base64chars.charAt(b3 & 63);
    }
    return result;
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
 * Write a base64-encoded file to a temp location.
 * Returns the temp file path on success, or "ERROR: ..." on failure.
 */
function writeTempFileFromBase64(base64Data, fileName) {
    try {
        var tempFolder = Folder.temp;
        var tempFile = new File(tempFolder.fsName + '/blitzkrieg_import_' + fileName);

        // Decode base64
        var base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        var binary = '';
        var i = 0;
        var cleanBase64 = base64Data.replace(/[^A-Za-z0-9+\/]/g, '');
        while (i < cleanBase64.length) {
            var b1 = base64chars.indexOf(cleanBase64.charAt(i++));
            var b2 = base64chars.indexOf(cleanBase64.charAt(i++));
            var b3 = base64chars.indexOf(cleanBase64.charAt(i++));
            var b4 = base64chars.indexOf(cleanBase64.charAt(i++));

            binary += String.fromCharCode((b1 << 2) | (b2 >> 4));
            if (b3 !== -1) binary += String.fromCharCode(((b2 & 15) << 4) | (b3 >> 2));
            if (b4 !== -1) binary += String.fromCharCode(((b3 & 3) << 6) | b4);
        }

        tempFile.encoding = 'BINARY';
        tempFile.open('w');
        tempFile.write(binary);
        tempFile.close();

        return tempFile.fsName;
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}

/**
 * Clean up temp stash directory after cloud upload.
 */
function cleanupTempStash(tempPath) {
    try {
        var folder = new Folder(tempPath);
        if (folder.exists) {
            var files = folder.getFiles();
            for (var i = 0; i < files.length; i++) {
                if (files[i] instanceof Folder) {
                    removeFolderRecursive(files[i]);
                } else {
                    files[i].remove();
                }
            }
            folder.remove();
        }
        return 'OK';
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}

/**
 * Generate a thumbnail from a temp AEP file and return as base64 PNG.
 * Used for generating thumbnails for cloud templates.
 * @param {string} tempAepPath - Path to the temp AEP file on disk
 * @returns {string} - JSON with base64 thumbnail data or error
 */
function generateThumbnailFromAep(tempAepPath) {
    try {
        var aepFile = new File(tempAepPath);
        if (!aepFile.exists) {
            return JSON.stringify({error: 'AEP file not found: ' + tempAepPath});
        }

        // Import the AEP
        var importOptions = new ImportOptions(aepFile);
        importOptions.importAs = ImportAsType.PROJECT;
        var importedItem = app.project.importFile(importOptions);

        if (!importedItem) {
            return JSON.stringify({error: 'Could not import AEP'});
        }

        // Find the main composition
        var mainComp = null;
        if (importedItem instanceof FolderItem) {
            for (var gi = 1; gi <= importedItem.numItems; gi++) {
                if (importedItem.item(gi) instanceof CompItem) {
                    mainComp = importedItem.item(gi);
                    break;
                }
            }
        } else if (importedItem instanceof CompItem) {
            mainComp = importedItem;
        }

        if (!mainComp) {
            if (importedItem) importedItem.remove();
            return JSON.stringify({error: 'No composition found in AEP'});
        }

        // Render thumbnail — try multiple timestamps as fallback
        var thumbTimes = [
            mainComp.workAreaStart + (mainComp.workAreaDuration / 2),
            mainComp.workAreaStart,
            mainComp.workAreaStart + (mainComp.workAreaDuration * 0.25)
        ];
        var tempThumb = new File(Folder.temp.fsName + '/blitzkrieg_thumb_' + (new Date()).getTime() + '.png');
        for (var tti = 0; tti < thumbTimes.length; tti++) {
            try {
                mainComp.saveFrameToPng(thumbTimes[tti], tempThumb);
                if (tempThumb.exists) break;
            } catch (thumbErr) { /* try next */ }
        }

        // Read as base64
        var thumbBase64 = '';
        if (tempThumb.exists) {
            thumbBase64 = readFileAsBase64(tempThumb);
            tempThumb.remove();
        }

        // Clean up imported project item
        if (importedItem) importedItem.remove();

        if (!thumbBase64) {
            return JSON.stringify({error: 'Failed to render thumbnail frame'});
        }

        return JSON.stringify({thumbnailBase64: thumbBase64});
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    }
}

/**
 * Generate a thumbnail AND preview frames from a temp AEP file.
 * Returns JSON: {thumbnailBase64: "...", previewFrames: ["base64_0", "base64_1", ...]}
 * @param {string} tempAepPath - Path to the temporary AEP file
 * @param {number} maxFrames - Maximum preview frames to generate (default 8)
 */
function generateThumbnailAndPreviewFromAep(tempAepPath, maxFrames) {
    if (!maxFrames || maxFrames < 1) maxFrames = 8;
    try {
        var aepFile = new File(tempAepPath);
        if (!aepFile.exists) {
            return JSON.stringify({error: 'AEP file not found: ' + tempAepPath});
        }

        var importOptions = new ImportOptions(aepFile);
        importOptions.importAs = ImportAsType.PROJECT;
        var importedItem = app.project.importFile(importOptions);

        if (!importedItem) {
            return JSON.stringify({error: 'Could not import AEP'});
        }

        // Find the main composition
        var mainComp = null;
        if (importedItem instanceof FolderItem) {
            for (var gi = 1; gi <= importedItem.numItems; gi++) {
                if (importedItem.item(gi) instanceof CompItem) {
                    mainComp = importedItem.item(gi);
                    break;
                }
            }
        } else if (importedItem instanceof CompItem) {
            mainComp = importedItem;
        }

        if (!mainComp) {
            if (importedItem) importedItem.remove();
            return JSON.stringify({error: 'No composition found in AEP'});
        }

        // Render thumbnail — try multiple timestamps as fallback
        var thumbTimesTP = [
            mainComp.workAreaStart + (mainComp.workAreaDuration / 2),
            mainComp.workAreaStart,
            mainComp.workAreaStart + (mainComp.workAreaDuration * 0.25)
        ];
        var tempThumb = new File(Folder.temp.fsName + '/blitzkrieg_thumb_' + (new Date()).getTime() + '.png');
        for (var tpi = 0; tpi < thumbTimesTP.length; tpi++) {
            try {
                mainComp.saveFrameToPng(thumbTimesTP[tpi], tempThumb);
                if (tempThumb.exists) break;
            } catch (thumbErrTP) { /* try next */ }
        }

        var thumbBase64 = '';
        if (tempThumb.exists) {
            thumbBase64 = readFileAsBase64(tempThumb);
            tempThumb.remove();
        }

        // Render preview frames evenly distributed across duration
        var frames = [];
        var compDuration = mainComp.workAreaDuration;
        var frameRate = mainComp.frameRate || 30;
        var totalFrames = Math.floor(compDuration * frameRate);

        if (totalFrames > 1) {
            var actualFrameCount = Math.min(maxFrames, totalFrames);
            for (var pf = 0; pf < actualFrameCount; pf++) {
                try {
                    var progress = (actualFrameCount > 1) ? (pf / (actualFrameCount - 1)) : 0;
                    var previewTime = mainComp.workAreaStart + (progress * compDuration);
                    var frameFile = new File(Folder.temp.fsName + '/blitzkrieg_frame_' + pf + '_' + (new Date()).getTime() + '.png');
                    mainComp.saveFrameToPng(previewTime, frameFile);
                    if (frameFile.exists) {
                        frames.push(readFileAsBase64(frameFile));
                        frameFile.remove();
                    }
                } catch (frameErr) {
                    // Skip failed frames
                }
            }
        }

        // Clean up imported project item
        if (importedItem) importedItem.remove();

        if (!thumbBase64) {
            return JSON.stringify({error: 'Failed to render thumbnail frame'});
        }

        return JSON.stringify({
            thumbnailBase64: thumbBase64,
            previewFrames: frames
        });
    } catch (e) {
        return JSON.stringify({error: e.toString()});
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
    try {
        var aepFile = new File(aepPath);
        if (!aepFile.exists) {
            return JSON.stringify({error: 'AEP file not found: ' + aepPath});
        }

        // Ensure output directory exists
        var outFolder = new Folder(outputDir);
        if (!outFolder.exists) outFolder.create();

        var importOptions = new ImportOptions(aepFile);
        importOptions.importAs = ImportAsType.PROJECT;
        var importedItem = app.project.importFile(importOptions);

        if (!importedItem) {
            return JSON.stringify({error: 'Could not import AEP'});
        }

        // Find the main composition — search recursively through nested folders
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
            if (importedItem) importedItem.remove();
            return JSON.stringify({error: 'No composition found in AEP'});
        }

        // Detect missing footage in this comp's layer tree (for logging only).
        // We NO LONGER bail — instead we try to render anyway because many comps
        // render fine with missing footage (shape/text/solid layers still work).
        var hasMissingFootage = false;
        try {
            var _checkedComps = {};
            var _checkCompMissing = function(comp) {
                if (!comp || _checkedComps[comp.id]) return false;
                _checkedComps[comp.id] = true;
                for (var li = 1; li <= comp.numLayers; li++) {
                    var layer = comp.layer(li);
                    if (!layer.enabled) continue;
                    var src = layer.source;
                    if (!src) continue;
                    if (src instanceof FootageItem && src.footageMissing) return true;
                    if (src instanceof CompItem) {
                        if (_checkCompMissing(src)) return true;
                    }
                }
                return false;
            };
            hasMissingFootage = _checkCompMissing(mainComp);
        } catch (fmErr) { /* ignore */ }

        // Render thumbnail as comp.png — try multiple timestamps as fallback.
        var thumbTimes = [
            mainComp.workAreaStart + (mainComp.workAreaDuration / 2),
            mainComp.workAreaStart,
            mainComp.workAreaStart + (mainComp.workAreaDuration * 0.25)
        ];
        var thumbFile = new File(outFolder.fsName + '/comp.png');
        for (var tt = 0; tt < thumbTimes.length; tt++) {
            try {
                mainComp.saveFrameToPng(thumbTimes[tt], thumbFile);
                if (thumbFile.exists) break;
            } catch (thumbErr) { /* try next timestamp */ }
        }

        if (!thumbFile.exists) {
            if (importedItem) importedItem.remove();
            try { app.purge(PurgeTarget.ALL_CACHES); } catch (purgeErr) {}
            return JSON.stringify({error: hasMissingFootage ?
                'Comp has missing footage and failed to render' :
                'Failed to render thumbnail frame'});
        }

        // If comp has missing footage, return thumbnail-only (skip preview frames
        // to avoid potential dialog spam from 12-72 saveFrameToPng calls)
        var compDuration = mainComp.workAreaDuration;
        if (hasMissingFootage) {
            if (importedItem) importedItem.remove();
            if (aepFile.exists) aepFile.remove();
            try { app.purge(PurgeTarget.ALL_CACHES); } catch (purgeErr) {}
            return JSON.stringify({
                frameCount: 0,
                duration: compDuration,
                width: mainComp.width,
                height: mainComp.height,
                thumbnailOnly: true
            });
        }

        // Render preview frames
        var previewFrameCount = 0;
        var frameRate = mainComp.frameRate || 30;
        var totalFrames = Math.floor(compDuration * frameRate);
        var consecutiveFailures = 0;

        if (totalFrames > 1) {
            var previewFolder = new Folder(outFolder.fsName + '/preview');
            if (!previewFolder.exists) previewFolder.create();

            // Dynamic frame count: ~6 FPS preview, min 12, max 72 frames
            var targetPreviewFPS = 6;
            var minFrames = 12;
            var maxFrames = 72;
            var dynamicFrameCount = Math.ceil(compDuration * targetPreviewFPS);
            var actualFrameCount = Math.max(minFrames, Math.min(maxFrames, dynamicFrameCount));
            actualFrameCount = Math.min(actualFrameCount, totalFrames);

            for (var pf = 0; pf < actualFrameCount; pf++) {
                try {
                    var progress = (actualFrameCount > 1) ? (pf / (actualFrameCount - 1)) : 0;
                    var previewTime = mainComp.workAreaStart + (progress * compDuration);
                    var frameFile = new File(previewFolder.fsName + '/frame_' + pf + '.png');
                    mainComp.saveFrameToPng(previewTime, frameFile);
                    if (frameFile.exists) {
                        previewFrameCount++;
                        consecutiveFailures = 0;
                    } else {
                        consecutiveFailures++;
                        if (consecutiveFailures >= 2) break;
                    }
                } catch (frameErr) {
                    consecutiveFailures++;
                    if (consecutiveFailures >= 2) break;
                }
            }
        }

        // Clean up imported project item
        if (importedItem) importedItem.remove();

        // Clean up the temp AEP file
        if (aepFile.exists) aepFile.remove();

        // Free AE caches to prevent RAM buildup during batch generation
        try { app.purge(PurgeTarget.ALL_CACHES); } catch (purgeErr) {}

        return JSON.stringify({
            frameCount: previewFrameCount,
            duration: compDuration,
            width: mainComp.width,
            height: mainComp.height
        });
    } catch (e) {
        // Ensure cleanup even on unexpected errors
        try { app.purge(PurgeTarget.ALL_CACHES); } catch (purgeErr) {}
        return JSON.stringify({error: e.toString()});
    }
}

function removeFolderRecursive(folder) {
    var files = folder.getFiles();
    for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof Folder) {
            removeFolderRecursive(files[i]);
        } else {
            files[i].remove();
        }
    }
    folder.remove();
}