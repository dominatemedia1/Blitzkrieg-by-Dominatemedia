// jsx/hostscript.jsx

/**
 * ============================================================================
 * JSON POLYFILL FOR EXTENDSCRIPT COMPATIBILITY
 * ============================================================================
 * ExtendScript (used in After Effects) does not have native JSON support in
 * all versions. This polyfill ensures JSON.parse and JSON.stringify work
 * correctly in both AE 2024 and AE 2025.
 *
 * Based on Douglas Crockford's JSON2 (Public Domain)
 * ============================================================================
 */
if (typeof JSON === 'undefined' || JSON === null) {
    JSON = {};
}

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

    if (typeof JSON.stringify !== 'function') {
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
    }

    if (typeof JSON.parse !== 'function') {
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
 * OPTIMIZED: Gets all stashed compositions from the library
 * Performance improvements:
 * - Minimized file object creation
 * - Batch string operations
 * - Reduced redundant existence checks
 * - Optimized loop structure
 *
 * IMPORTANT: This function is wrapped in try-catch because it's called via
 * csInterface.evalScript. An uncaught exception would return "EvalScript error."
 * instead of JSON, causing the JavaScript side to fail silently.
 */
function getStashedComps(libraryPath) {
    if (!isValidPath(libraryPath)) return "[]";

    try {
        var mainFolder = folderFromPath(libraryPath);
        if (!mainFolder.exists) return "[]";

        var compsData = [];
        var categoryFolders = mainFolder.getFiles(function(f) { return f instanceof Folder; });
        var numCategories = categoryFolders.length;

        for (var i = 0; i < numCategories; i++) {
            var categoryFolder = categoryFolders[i];
            // Use safeDecodeURI to prevent URIError on folder names with literal %
            var categoryName = safeDecodeURI(categoryFolder.name);
            var compFolders = categoryFolder.getFiles(function(f) { return f instanceof Folder; });
            var numComps = compFolders.length;

            for (var j = 0; j < numComps; j++) {
                try {
                    var compFolder = compFolders[j];
                    var compFolderPath = compFolder.fsName;
                    var compFolderName = compFolder.name;

                    // Quick check for .aep files - use glob pattern
                    var aepFiles = compFolder.getFiles("*.aep");
                    if (aepFiles.length === 0) continue;
                    var aepFile = aepFiles[0];
                    if (!(aepFile instanceof File)) continue;

                    // Fast path: derive display name from folder name
                    // Use safeDecodeURI to prevent URIError on names with literal %
                    var displayName = safeDecodeURI(compFolderName.split('_').slice(0, -1).join(' '));
                    var previewFrameCount = 0;
                    var duration = 0;

                    // Read metadata - use buildPath for macOS compatibility
                    var metadataFile = new File(buildPath(compFolder, "metadata.json"));
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

                    // Check thumbnail existence
                    var thumbPath = compFolderPath + "/comp.png";
                    var thumbFile = new File(buildPath(compFolder, "comp.png"));
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

        // Find the comp ID before any modifications
        var compId = compToSave.id;

        // Reduce project to only include selected comp and its dependencies
        app.project.reduceProject([compToSave]);

        // Create footage folder and collect files
        var footageFolder = new Folder(buildPath(compFolder, "(Footage)"));
        footageFolder.create();

        // Collect all footage items
        var collectedFiles = {};
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof FootageItem && item.mainSource && item.mainSource.file) {
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
            }
        }

        // Save the reduced project to library
        var finalAEPFile = new File(buildPath(compFolder, safeCompName + ".aep"));
        app.project.save(finalAEPFile);

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