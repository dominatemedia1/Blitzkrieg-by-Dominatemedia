// jsx/hostscript.jsx

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

            if (aepFile instanceof File && aepFile.exists) {
                displayName = decodeURI(compFolder.name.split('_').slice(0, -1).join(' '));
                if (metadataFile.exists) {
                    try {
                        metadataFile.open('r');
                        var metadata = JSON.parse(metadataFile.read());
                        displayName = metadata.displayName || displayName;
                        metadataFile.close();
                    } catch (e) {
                        // Log error but continue with default display name
                        $.writeln("Blitzkrieg: Warning - Could not parse metadata.json for " + compFolder.name + ": " + e.toString());
                    }
                }

                compsData.push({
                    name: displayName,
                    category: categoryName,
                    uniqueId: compFolder.name,
                    aepPath: aepFile.fsName,
                    thumbPath: (thumbFile && thumbFile.exists) ? thumbFile.fsName : null
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

        // --- Save Thumbnail ---
        var thumbFile = new File(compFolder.fsName + "/comp.png");
        try {
            var frameTime = compToSave.workAreaStart + (compToSave.workAreaDuration / 2);
            compToSave.saveFrameToPng(frameTime, thumbFile);
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
            category: categoryName
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