// jsx/hostscript.jsx

function selectLibraryFolder() {
    var folder = Folder.selectDialog("Select your CompBuddy Library Folder");
    if (folder) {
        return folder.fsName;
    }
    return null;
}

function getStashedComps(libraryPath) {
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
                    } catch (e) { /* ignore corrupt json */ }
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
 * THE INVISIBLE STASH FUNCTION - This is the definitive solution to avoid populating the "Recent Files" list.
 * How it works (The "Trick"):
 * 1. All project saving (`app.project.save`) happens on a SECRET temporary file in the system's temp folder.
 * 2. After Effects only ever knows about this secret temp file.
 * 3. Once the temp file is perfected (reduced, footage collected), we use a file system `copy()` command, NOT an AE command,
 *    to place a copy in the user's library.
 * 4. Since After Effects never "saved" or "opened" the file in the library, it NEVER appears in the Recent Files list.
 * 5. The secret temp file is deleted, leaving no trace.
 */
function stashSelectedComp(libraryPath, categoryName) {
    var originalProject = app.project;
    var originalProjectFile = originalProject.file;
    var tempUnsavedBackup = null;
    var secretTempAEP = null; // Our secret file

    try {
        if (!originalProject) throw new Error("Please open a project first.");
        var selectedItems = originalProject.selection;
        if (selectedItems.length !== 1 || !(selectedItems[0] instanceof CompItem)) {
            throw new Error("Please select exactly one composition in the Project Panel.");
        }
        var compToSave = selectedItems[0];
        
        var compToSaveID = compToSave.id;
        var compToSaveName = compToSave.name;
        var safeCompName = compToSaveName.replace(/[^a-z0-9]/gi, '_').replace(/_{2,}/g, '_');
        
        // Safety check for unsaved projects
        if (!originalProjectFile) {
            tempUnsavedBackup = new File(Folder.temp.fsName + "/compbuddy_unsaved_backup_" + new Date().getTime() + ".aep");
            originalProject.save(tempUnsavedBackup);
            originalProjectFile = tempUnsavedBackup;
        }

        // --- Create folder structure ---
        var categoryFolder = new Folder(libraryPath + "/" + categoryName);
        if (!categoryFolder.exists) categoryFolder.create();
        
        var timestamp = new Date().getTime();
        var compFolderName = safeCompName + '_' + timestamp;
        var compFolder = new Folder(categoryFolder.fsName + "/" + compFolderName);
        compFolder.create();
        
        // --- Save Thumbnail & Metadata ---
        var thumbFile = new File(compFolder.fsName + "/comp.png");
        try {
            var frameTime = compToSave.workAreaStart + (compToSave.workAreaDuration / 2);
            compToSave.saveFrameToPng(frameTime, thumbFile);
        } catch(e) { /* Fails silently */ }

        var metadataFile = new File(compFolder.fsName + "/metadata.json");
        metadataFile.open('w');
        metadataFile.encoding = 'UTF-8';
        metadataFile.write(JSON.stringify({ displayName: compToSaveName }));
        metadataFile.close();

        // The "Invisible Save" Workflow
        app.beginUndoGroup("CompBuddy Stash");

        // 1. Create a secret temp file and save the current project to it. AE will only add THIS to recents.
        secretTempAEP = new File(Folder.temp.fsName + "/compbuddy_secret_temp_" + timestamp + ".aep");
        app.project.save(secretTempAEP);

        // 2. Reduce the secret temp project.
        var compInTempProject = null;
        for (var k = 1; k <= app.project.numItems; k++) {
            if (app.project.item(k).id === compToSaveID) {
                compInTempProject = app.project.item(k);
                break;
            }
        }
        if (!compInTempProject) throw new Error("Could not find the composition in the new project.");
        app.project.reduceProject([compInTempProject]);

        // 3. Collect footage.
        var footageSubFolder = new Folder(compFolder.fsName + "/(Footage)");
        footageSubFolder.create();
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof FootageItem && item.mainSource && item.mainSource.file) {
                var sourceFile = item.mainSource.file;
                if (sourceFile.fsName.indexOf("Adobe") === -1 && sourceFile.fsName.indexOf("Plug-ins") === -1) {
                    var newFile = new File(footageSubFolder.fsName + "/" + sourceFile.name);
                    if (!newFile.exists) sourceFile.copy(newFile);
                    item.replace(newFile);
                }
            }
        }
        
        // 4. Save the secret temp project one last time.
        app.project.save(secretTempAEP);

        // 5. THE MAGIC STEP: Copy the secret file to the final destination without telling AE.
        var finalAEPFile = new File(compFolder.fsName + "/" + safeCompName + ".aep");
        if (!secretTempAEP.copy(finalAEPFile)) {
            throw new Error("Could not copy the temporary project to the library.");
        }
        
        app.endUndoGroup();

        return "Success! '" + compToSaveName + "' was added to your library.";

    } catch (e) {
        return "Error: " + e.toString();
    } finally {
        // Cleanup and Restore
        if (originalProjectFile && originalProjectFile.exists) {
            app.open(originalProjectFile); 
        }
        if (secretTempAEP && secretTempAEP.exists) {
            secretTempAEP.remove(); // Delete the secret file
        }
        if (tempUnsavedBackup && tempUnsavedBackup.exists) {
            tempUnsavedBackup.remove();
        }
    }
}


function importComp(aepPath) {
    try {
        if (!app.project) return "Error: Please open a project first.";
        var fileToImport = new File(aepPath);
        if (!fileToImport.exists) return "Error: Source AEP file not found.";

        var metadataFile = new File(fileToImport.parent.fsName + "/metadata.json");
        var compName = "Imported Comp";
        if (metadataFile.exists) {
            try {
                metadataFile.open('r');
                var metadata = JSON.parse(metadataFile.read());
                compName = metadata.displayName || compName;
                metadataFile.close();
            } catch(e) { /* use default */ }
        }
        
        app.beginUndoGroup("CompBuddy Import");
        var importOptions = new ImportOptions(fileToImport);
        var importedFolder = app.project.importFile(importOptions);
        importedFolder.name = compName + " [CompBuddy]";
        
        var mainComp = null;
        for (var i = 1; i <= importedFolder.numItems; i++) {
            if (importedFolder.item(i) instanceof CompItem) {
                mainComp = importedFolder.item(i);
                if(mainComp.name === compName) break;
            }
        }
        if(mainComp && mainComp.name !== compName) {
            mainComp.name = compName;
        }

        app.endUndoGroup();
        return "Success: '" + compName + "' imported.";
    } catch (e) {
        return "Error: " + e.toString();
    }
}


function renameStashedComp(libraryPath, category, uniqueId, newName) {
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