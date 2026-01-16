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

function selectLibraryFolder() {
    var folder = Folder.selectDialog("Select your Blitzkrieg Library Folder");
    if (folder) {
        return folder.fsName;
    }
    return null;
}

function getStashedComps(libraryPath) {
    if (!isValidPath(libraryPath)) return "[]";
    var mainFolder = new Folder(libraryPath);
    if (!mainFolder.exists) return "[]";

    var compsData = [];
    var categoryFolders = mainFolder.getFiles(function(f) { return f instanceof Folder; });

    for (var i = 0; i < categoryFolders.length; i++) {
        var categoryFolder = categoryFolders[i];
        var categoryName = decodeURI(categoryFolder.name);
        var compFolders = categoryFolder.getFiles(function(f) { return f instanceof Folder; });

        for (var j = 0; j < compFolders.length; j++) {
            var compFolder = compFolders[j];
            var aepFiles = compFolder.getFiles("*.aep");
            if (aepFiles.length === 0) continue;
            var aepFile = aepFiles[0];

            var thumbFile = compFolder.getFiles("comp.png")[0];
            var metadataFile = new File(compFolder.fsName + "/metadata.json");
            var displayName = "";
            var previewFrameCount = 0;
            var duration = 0;

            if (aepFile instanceof File && aepFile.exists) {
                displayName = decodeURI(compFolder.name.split('_').slice(0, -1).join(' '));
                if (metadataFile.exists) {
                    try {
                        metadataFile.open('r');
                        metadataFile.encoding = 'UTF-8';
                        var metadata = JSON.parse(metadataFile.read());
                        displayName = metadata.displayName || displayName;
                        previewFrameCount = metadata.previewFrames || 0;
                        duration = metadata.duration || 0;
                        metadataFile.close();
                    } catch (e) {
                        // Log error but continue with default display name
                        $.writeln("Blitzkrieg: Warning - Could not parse metadata.json for " + compFolder.name + ": " + e.toString());
                        if (metadataFile.open) {
                            try { metadataFile.close(); } catch (closeErr) {}
                        }
                    }
                }

                // Check for preview frames folder
                var previewFolder = new Folder(compFolder.fsName + "/preview");
                var previewFramePaths = [];
                if (previewFolder.exists && previewFrameCount > 0) {
                    for (var pf = 0; pf < previewFrameCount; pf++) {
                        var frameFile = new File(previewFolder.fsName + "/frame_" + pf + ".png");
                        if (frameFile.exists) {
                            previewFramePaths.push(frameFile.fsName);
                        }
                    }
                }

                compsData.push({
                    name: displayName,
                    category: categoryName,
                    uniqueId: compFolder.name,
                    aepPath: aepFile.fsName,
                    thumbPath: (thumbFile && thumbFile.exists) ? thumbFile.fsName : null,
                    previewFrames: previewFramePaths,
                    duration: duration
                });
            }
        }
    }
    return JSON.stringify(compsData);
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

        // --- Create folder structure ---
        var categoryFolder = new Folder(libraryPath + "/" + categoryName);
        if (!categoryFolder.exists) {
            if (!categoryFolder.create()) {
                return "Error: Could not create category folder.";
            }
        }

        var timestamp = new Date().getTime();
        var compFolderName = safeCompName + '_' + timestamp;
        var compFolder = new Folder(categoryFolder.fsName + "/" + compFolderName);
        if (!compFolder.create()) {
            return "Error: Could not create composition folder.";
        }

        // --- Save Thumbnail and Preview Frames ---
        var thumbFile = new File(compFolder.fsName + "/comp.png");
        var previewFrameCount = 0;
        var PREVIEW_FRAME_TARGET = 12; // Number of preview frames for animation

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
                var previewFolder = new Folder(compFolder.fsName + "/preview");
                previewFolder.create();

                // Calculate frame interval to get PREVIEW_FRAME_TARGET frames
                var frameInterval = Math.max(1, Math.floor(totalFrames / PREVIEW_FRAME_TARGET));
                var actualFrameCount = Math.min(PREVIEW_FRAME_TARGET, totalFrames);

                for (var pf = 0; pf < actualFrameCount; pf++) {
                    try {
                        var previewTime = compToSave.workAreaStart + (pf * frameInterval / frameRate);
                        // Clamp to work area
                        if (previewTime > compToSave.workAreaStart + compToSave.workAreaDuration) {
                            previewTime = compToSave.workAreaStart + compToSave.workAreaDuration - (1 / frameRate);
                        }
                        var previewFile = new File(previewFolder.fsName + "/frame_" + pf + ".png");
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
        var metadataFile = new File(compFolder.fsName + "/metadata.json");
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
            var tempProjectFile = new File(Folder.temp.fsName + "/blitzkrieg_temp_" + timestamp + ".aep");
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
        var footageFolder = new Folder(compFolder.fsName + "/(Footage)");
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

                        var destFile = new File(footageFolder.fsName + "/" + sourceFile.name);
                        // Handle duplicate filenames
                        var counter = 1;
                        while (destFile.exists) {
                            var nameParts = sourceFile.name.split('.');
                            var ext = nameParts.pop();
                            var baseName = nameParts.join('.');
                            destFile = new File(footageFolder.fsName + "/" + baseName + "_" + counter + "." + ext);
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
        var finalAEPFile = new File(compFolder.fsName + "/" + safeCompName + ".aep");
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


function importComp(aepPath) {
    // Validate input
    if (!isValidPath(aepPath)) {
        return "Error: Invalid file path.";
    }

    try {
        if (!app.project) return "Error: Please open a project first.";
        var fileToImport = new File(aepPath);
        if (!fileToImport.exists) return "Error: Source AEP file not found at: " + aepPath;

        var metadataFile = new File(fileToImport.parent.fsName + "/metadata.json");
        var compName = "Imported Comp";
        if (metadataFile.exists) {
            try {
                metadataFile.open('r');
                metadataFile.encoding = 'UTF-8';
                var metadata = JSON.parse(metadataFile.read());
                compName = metadata.displayName || compName;
                metadataFile.close();
            } catch(e) {
                $.writeln("Blitzkrieg: Warning - Could not read metadata during import: " + e.toString());
            }
        }

        app.beginUndoGroup("Blitzkrieg Import");

        // Import the project file
        var importOptions = new ImportOptions(fileToImport);
        importOptions.importAs = ImportAsType.PROJECT;

        var importedItem;
        try {
            importedItem = app.project.importFile(importOptions);
        } catch (importErr) {
            // If import fails, it might be due to missing plugins
            // Try to provide a helpful error message
            var errMsg = importErr.toString();
            if (errMsg.indexOf("plugin") !== -1 || errMsg.indexOf("effect") !== -1) {
                return "Error: Import failed - missing plugins or effects. The composition may require plugins that are not installed.";
            }
            throw importErr;
        }

        if (!importedItem) {
            return "Error: Import returned no items.";
        }

        // Handle different import results
        var mainComp = null;

        if (importedItem instanceof FolderItem) {
            // Project was imported as a folder
            importedItem.name = compName + " [Blitzkrieg]";

            // Find the main composition
            for (var i = 1; i <= importedItem.numItems; i++) {
                var item = importedItem.item(i);
                if (item instanceof CompItem) {
                    mainComp = item;
                    // Prefer comp with matching name
                    if (item.name === compName || item.name.indexOf(compName) !== -1) {
                        break;
                    }
                }
            }
        } else if (importedItem instanceof CompItem) {
            mainComp = importedItem;
        }

        // Rename the main comp if found
        if (mainComp && mainComp.name !== compName) {
            mainComp.name = compName;
        }

        app.endUndoGroup();

        if (mainComp) {
            return "Success: '" + compName + "' imported.";
        } else {
            return "Success: Project imported, but no composition was found inside.";
        }

    } catch (e) {
        var errorMsg = e.toString();
        // Check for common plugin-related errors
        if (errorMsg.indexOf("25") !== -1 || errorMsg.indexOf("plugin") !== -1) {
            return "Error: Import failed - this may be due to missing plugins. " + errorMsg;
        }
        return "Error: " + errorMsg;
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
        var aepFolder = new Folder(libraryPath + "/" + category + "/" + uniqueId);
        var metadataFile = new File(aepFolder.fsName + "/metadata.json");
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
        var compFolder = new Folder(compFolderPath);
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
    var PREVIEW_FRAME_TARGET = 12;

    try {
        if (!app.project) {
            return "Error: Please open a project first.";
        }

        // Store original project reference
        originalProjectFile = app.project.file;
        projectWasDirty = app.project.dirty;

        var aepFile = new File(aepPath);
        if (!aepFile.exists) {
            return "Error: AEP file not found at: " + aepPath;
        }

        var compFolder = aepFile.parent;
        var previewFolder = new Folder(compFolder.fsName + "/preview");

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
            var frameInterval = Math.max(1, Math.floor(totalFrames / PREVIEW_FRAME_TARGET));
            var actualFrameCount = Math.min(PREVIEW_FRAME_TARGET, totalFrames);

            for (var pf = 0; pf < actualFrameCount; pf++) {
                try {
                    var previewTime = mainComp.workAreaStart + (pf * frameInterval / frameRate);
                    // Clamp to work area
                    if (previewTime > mainComp.workAreaStart + mainComp.workAreaDuration) {
                        previewTime = mainComp.workAreaStart + mainComp.workAreaDuration - (1 / frameRate);
                    }
                    var previewFile = new File(previewFolder.fsName + "/frame_" + pf + ".png");
                    mainComp.saveFrameToPng(previewTime, previewFile);
                    previewFrameCount++;
                } catch (previewErr) {
                    $.writeln("Blitzkrieg: Warning - Could not generate preview frame " + pf + ": " + previewErr.toString());
                }
            }

            // Also regenerate the main thumbnail
            try {
                var thumbFile = new File(compFolder.fsName + "/comp.png");
                var thumbTime = mainComp.workAreaStart + (mainComp.workAreaDuration / 2);
                mainComp.saveFrameToPng(thumbTime, thumbFile);
            } catch (thumbErr) {
                $.writeln("Blitzkrieg: Warning - Could not regenerate thumbnail: " + thumbErr.toString());
            }
        }

        // Update metadata with preview frame count
        var metadataFile = new File(compFolder.fsName + "/metadata.json");
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
    var settingsFolder = new Folder(Folder.userData.fsName + "/Blitzkrieg");
    if (!settingsFolder.exists) {
        settingsFolder.create();
    }
    return settingsFolder.fsName + "/settings.json";
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