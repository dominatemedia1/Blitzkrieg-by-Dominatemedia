// js/cloud-library.js
// Cloud-based template library using Supabase Storage
(function () {
    'use strict';

    var sb = window.blitzkriegSupabase;
    var BUCKET = 'blitzkrieg';

    // List all templates from the Supabase blitzkrieg bucket
    // Returns array in the same format as the old getStashedComps:
    // [{name, category, uniqueId, thumbUrl, duration, aepPath}]
    async function listTemplates() {
        // Step 1: List all top-level folders (categories)
        var categoriesResult = await sb.storage.from(BUCKET).list('', {
            limit: 1000,
            sortBy: { column: 'name', order: 'asc' },
        });

        if (categoriesResult.error) {
            throw new Error('Failed to list categories: ' + categoriesResult.error.message);
        }

        var categories = (categoriesResult.data || []).filter(function (item) {
            // Folders have null metadata
            return item.id === null || item.metadata === null;
        });

        var allComps = [];

        // Step 2: For each category, list comp folders
        for (var i = 0; i < categories.length; i++) {
            var categoryName = categories[i].name;

            var compsResult = await sb.storage.from(BUCKET).list(categoryName, {
                limit: 1000,
                sortBy: { column: 'name', order: 'asc' },
            });

            if (compsResult.error) continue;

            var compFolders = (compsResult.data || []).filter(function (item) {
                return item.id === null || item.metadata === null;
            });

            // Step 3: For each comp folder, read metadata.json
            for (var j = 0; j < compFolders.length; j++) {
                var compFolder = compFolders[j].name;
                var metadataPath = categoryName + '/' + compFolder + '/metadata.json';

                try {
                    var metaDownload = await sb.storage.from(BUCKET).download(metadataPath);
                    if (metaDownload.error) continue;

                    var metaText = await metaDownload.data.text();
                    var metadata = JSON.parse(metaText);

                    // Build thumbnail URL (signed URL for private bucket)
                    var thumbPath = categoryName + '/' + compFolder + '/thumbnail.jpg';
                    var thumbResult = await sb.storage.from(BUCKET).createSignedUrl(thumbPath, 3600);
                    var thumbUrl = thumbResult.data ? thumbResult.data.signedUrl : '';

                    // Extract uniqueId from folder name (format: CompName_timestamp)
                    var parts = compFolder.split('_');
                    var uniqueId = parts.length > 1 ? parts[parts.length - 1] : compFolder;

                    allComps.push({
                        name: metadata.displayName || compFolder,
                        category: categoryName,
                        uniqueId: uniqueId,
                        folderName: compFolder,
                        thumbUrl: thumbUrl,
                        duration: metadata.duration || 0,
                        width: metadata.width || 0,
                        height: metadata.height || 0,
                        frameRate: metadata.frameRate || 0,
                        previewFrames: metadata.previewFrames || 0,
                        storagePath: categoryName + '/' + compFolder,
                    });
                } catch (err) {
                    console.warn('Skipping comp folder ' + compFolder + ': ' + err.message);
                }
            }
        }

        return allComps;
    }

    // Download a template's .aep file to a temp location for import
    async function downloadTemplate(storagePath) {
        // Find the .aep file in the folder
        var filesResult = await sb.storage.from(BUCKET).list(storagePath, { limit: 100 });
        if (filesResult.error) {
            throw new Error('Failed to list template files: ' + filesResult.error.message);
        }

        var aepFile = (filesResult.data || []).find(function (f) {
            return f.name && f.name.toLowerCase().endsWith('.aep');
        });

        if (!aepFile) {
            throw new Error('No .aep file found in template folder');
        }

        var aepPath = storagePath + '/' + aepFile.name;
        var downloadResult = await sb.storage.from(BUCKET).download(aepPath);

        if (downloadResult.error) {
            throw new Error('Failed to download template: ' + downloadResult.error.message);
        }

        return {
            blob: downloadResult.data,
            fileName: aepFile.name,
        };
    }

    // Upload a template bundle (aep + thumbnail + metadata) to the bucket
    // Only works for blitzkrieg admins (RLS enforced)
    async function uploadTemplate(categoryName, compFolderName, files) {
        // files is an object: { aep: Blob, thumbnail: Blob, metadata: object }
        var basePath = categoryName + '/' + compFolderName;

        // Upload .aep file
        if (files.aep) {
            var aepResult = await sb.storage.from(BUCKET)
                .upload(basePath + '/template.aep', files.aep, {
                    contentType: 'application/octet-stream',
                    upsert: true,
                });
            if (aepResult.error) {
                throw new Error('Failed to upload .aep: ' + aepResult.error.message);
            }
        }

        // Upload thumbnail
        if (files.thumbnail) {
            var thumbResult = await sb.storage.from(BUCKET)
                .upload(basePath + '/thumbnail.jpg', files.thumbnail, {
                    contentType: 'image/jpeg',
                    upsert: true,
                });
            if (thumbResult.error) {
                throw new Error('Failed to upload thumbnail: ' + thumbResult.error.message);
            }
        }

        // Upload metadata.json
        if (files.metadata) {
            var metaBlob = new Blob([JSON.stringify(files.metadata)], { type: 'application/json' });
            var metaResult = await sb.storage.from(BUCKET)
                .upload(basePath + '/metadata.json', metaBlob, {
                    contentType: 'application/json',
                    upsert: true,
                });
            if (metaResult.error) {
                throw new Error('Failed to upload metadata: ' + metaResult.error.message);
            }
        }

        return basePath;
    }

    // Delete a template from the bucket (admin-only, RLS enforced)
    async function deleteTemplate(storagePath) {
        // List all files in the folder
        var filesResult = await sb.storage.from(BUCKET).list(storagePath, { limit: 100 });
        if (filesResult.error) {
            throw new Error('Failed to list files for deletion: ' + filesResult.error.message);
        }

        var filePaths = (filesResult.data || []).map(function (f) {
            return storagePath + '/' + f.name;
        });

        if (filePaths.length > 0) {
            var removeResult = await sb.storage.from(BUCKET).remove(filePaths);
            if (removeResult.error) {
                throw new Error('Failed to delete template: ' + removeResult.error.message);
            }
        }
    }

    // Rename a template (re-upload metadata with new displayName)
    async function renameTemplate(storagePath, newName) {
        var metadataPath = storagePath + '/metadata.json';
        var metaDownload = await sb.storage.from(BUCKET).download(metadataPath);
        if (metaDownload.error) {
            throw new Error('Failed to read metadata: ' + metaDownload.error.message);
        }

        var metaText = await metaDownload.data.text();
        var metadata = JSON.parse(metaText);
        metadata.displayName = newName;

        var metaBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
        var uploadResult = await sb.storage.from(BUCKET)
            .upload(metadataPath, metaBlob, {
                contentType: 'application/json',
                upsert: true,
            });
        if (uploadResult.error) {
            throw new Error('Failed to update metadata: ' + uploadResult.error.message);
        }
    }

    // Expose globally
    window.cloudLibrary = {
        listTemplates: listTemplates,
        downloadTemplate: downloadTemplate,
        uploadTemplate: uploadTemplate,
        deleteTemplate: deleteTemplate,
        renameTemplate: renameTemplate,
    };
})();
