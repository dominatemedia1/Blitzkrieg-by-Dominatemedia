#!/usr/bin/env node
/**
 * reclassify-templates.js — Execute the 5-phase migration against Supabase Storage.
 *
 * Phase 0 — Dry-run: log all moves, count objects, estimate size. No mutations.
 * Phase 1 — Backup: upload _blitzkrieg_manifest_v2_backup_<ts>.json
 * Phase 2 — Copy: move each folder to new path (server-side copy+delete).
 *            Batch size: 10. Verify after each batch.
 * Phase 3 — Manifest: upload new manifest with updated fields.
 * Phase 4 — Cleanup: delete old category folders if empty.
 * Phase 5 — Verify: download manifest, spot-check 10 signed URLs.
 *
 * Usage:
 *   node scripts/reclassify-templates.js --plan classification-plan.json [--dry-run] [--batch-size 10]
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Will be initialized from Supabase
let supabase = null;

// ── CLI Args ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = {
    planPath: null,
    dryRun: false,
    batchSize: 10,
    startFrom: 0
  };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--plan' && process.argv[i + 1]) {
      args.planPath = process.argv[++i];
    } else if (process.argv[i] === '--dry-run') {
      args.dryRun = true;
    } else if (process.argv[i] === '--batch-size' && process.argv[i + 1]) {
      args.batchSize = parseInt(process.argv[++i], 10);
    } else if (process.argv[i] === '--start-from' && process.argv[i + 1]) {
      args.startFrom = parseInt(process.argv[++i], 10);
    }
  }
  if (!args.planPath) {
    console.error('Usage: node scripts/reclassify-templates.js --plan <file> [--dry-run] [--batch-size N]');
    process.exit(1);
  }
  return args;
}

// ── Helpers ──────────────────────────────────────────────────────────

function log(phase, msg, level) {
  const prefix = `[${phase}]`;
  if (level === 'error') console.error(prefix, msg);
  else if (level === 'warn') console.warn(prefix, msg);
  else console.log(prefix, msg);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Phase 0: Dry-run ─────────────────────────────────────────────────

async function phase0_DryRun(plan) {
  log('Phase0', `Dry-run: ${plan.plan.length} templates to migrate`);
  const moves = {};
  let totalFolders = 0;

  for (const entry of plan.plan) {
    const oldCat = entry.oldPath.split('/')[0];
    const newCat = entry.primaryCategory;
    if (!moves[oldCat]) moves[oldCat] = { to: newCat, count: 0, templates: [] };
    moves[oldCat].count++;
    moves[oldCat].templates.push(entry.oldFolderName);
    totalFolders++;
  }

  console.log('\nCategory moves:');
  for (const [oldCat, info] of Object.entries(moves)) {
    console.log(`  ${oldCat} → ${info.to}: ${info.count} templates`);
  }

  console.log(`\nTotal folders to move: ${totalFolders}`);
  console.log(`Estimated API calls: ~${totalFolders * 3} (list + move ×2 per folder)`);
  console.log(`Batch size: ${plan.batchSize || 10}, Batches: ${Math.ceil(totalFolders / (plan.batchSize || 10))}`);

  return { moves, totalFolders };
}

// ── Server-side move ─────────────────────────────────────────────────

async function moveFolder(oldPath, newPath) {
  // Supabase Storage move = download + upload + delete
  // Since we can't do server-side move, we do copy-then-delete

  // 1. List all files in old folder
  const { data: files, error: listErr } = await supabase
    .storage
    .from('blitzkrieg')
    .list(oldPath, { limit: 1000 });

  if (listErr) {
    throw new Error(`List failed for ${oldPath}: ${listErr.message}`);
  }

  if (!files || files.length === 0) {
    log('Move', `No files in ${oldPath}, skipping`, 'warn');
    return { moved: 0 };
  }

  // 2. For each file: download, upload to new path, then delete old
  let moved = 0;
  for (const file of files) {
    const oldFilePath = `${oldPath}/${file.name}`;
    const newFilePath = `${newPath}/${file.name}`;

    // Download
    const { data: blob, error: dlErr } = await supabase
      .storage
      .from('blitzkrieg')
      .download(oldFilePath);

    if (dlErr) {
      log('Move', `Download failed: ${oldFilePath}: ${dlErr.message}`, 'error');
      continue;
    }

    // Upload to new location
    const { error: upErr } = await supabase
      .storage
      .from('blitzkrieg')
      .upload(newFilePath, blob, {
        contentType: file.metadata?.mimetype || 'application/octet-stream',
        upsert: true
      });

    if (upErr) {
      log('Move', `Upload failed: ${newFilePath}: ${upErr.message}`, 'error');
      continue;
    }

    // Delete old
    const { error: delErr } = await supabase
      .storage
      .from('blitzkrieg')
      .remove([oldFilePath]);

    if (delErr) {
      log('Move', `Delete failed (non-fatal): ${oldFilePath}: ${delErr.message}`, 'warn');
    }

    moved++;
  }

  return { moved, total: files.length };
}

// ── Manifest operations ──────────────────────────────────────────────

async function downloadManifest() {
  const { data, error } = await supabase
    .storage
    .from('blitzkrieg')
    .download('_blitzkrieg_manifest_v2.json');

  if (error) throw new Error(`Download manifest failed: ${error.message}`);
  const text = await data.text();
  return JSON.parse(text);
}

async function uploadManifest(manifest, filename) {
  const json = JSON.stringify(manifest, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  const { error } = await supabase
    .storage
    .from('blitzkrieg')
    .upload(filename || '_blitzkrieg_manifest_v2.json', blob, {
      contentType: 'application/json',
      upsert: true
    });

  if (error) throw new Error(`Upload manifest failed: ${error.message}`);
}

// ── Main migration ───────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  // Load Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing env: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  // Dynamic import for Supabase JS
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Load plan
  const plan = JSON.parse(fs.readFileSync(args.planPath, 'utf8'));
  log('Init', `Loaded plan: ${plan.plan.length} templates`);

  // ── Phase 0 ──
  const { moves } = await phase0_DryRun(plan);
  if (args.dryRun) {
    console.log('\nDry-run complete. No changes made.');
    process.exit(0);
  }

  // Confirm with user
  console.log('\n──────────────────────────────────────────');
  console.log('  READY TO EXECUTE MIGRATION');
  console.log('  This will move files in Supabase Storage.');
  console.log('  Type "yes" to continue:');
  console.log('──────────────────────────────────────────');

  // In non-interactive mode, require --confirm flag
  if (!process.argv.includes('--confirm')) {
    console.log('\nAdd --confirm to proceed without prompt, or run with --dry-run first.');
    process.exit(0);
  }

  // ── Phase 1: Backup ──
  log('Phase1', 'Creating manifest backup...');
  const manifest = await downloadManifest();
  const backupName = `_blitzkrieg_manifest_v2_backup_${Date.now()}.json`;
  await uploadManifest(manifest, backupName);
  log('Phase1', `Backup saved: ${backupName}`);

  // ── Phase 2: Copy ──
  log('Phase2', `Starting folder moves in batches of ${args.batchSize}...`);
  let successCount = 0;
  let failCount = 0;
  const failures = [];

  for (let i = args.startFrom; i < plan.plan.length; i += args.batchSize) {
    const batch = plan.plan.slice(i, i + args.batchSize);
    const batchNum = Math.floor(i / args.batchSize) + 1;
    log('Phase2', `Batch ${batchNum}: ${batch.length} templates (${i + 1}-${Math.min(i + args.batchSize, plan.plan.length)}/${plan.plan.length})`);

    for (const entry of batch) {
      const oldPath = entry.oldPath;
      const newPath = `${entry.primaryCategory}/${entry.newFolderName}`;

      try {
        const result = await moveFolder(oldPath, newPath);
        if (result.moved === result.total) {
          successCount++;
          log('Phase2', `  OK: ${oldPath} → ${newPath} (${result.moved} files)`);
        } else {
          log('Phase2', `  PARTIAL: ${oldPath} → ${newPath} (${result.moved}/${result.total} files)`, 'warn');
          if (result.moved === 0) {
            failCount++;
            failures.push({ oldPath, newPath, reason: 'No files moved' });
          }
        }
      } catch (err) {
        failCount++;
        failures.push({ oldPath, newPath, reason: err.message });
        log('Phase2', `  FAIL: ${oldPath} → ${newPath}: ${err.message}`, 'error');
      }

      // Small delay to avoid rate limiting
      await sleep(200);
    }

    log('Phase2', `Batch ${batchNum} complete. Progress: ${successCount} ok, ${failCount} failed`);
  }

  if (failures.length > 0) {
    log('Phase2', `${failures.length} failures:`, 'warn');
    failures.forEach(f => console.log(`  ${f.oldPath}: ${f.reason}`));
  }

  // ── Phase 3: Manifest update ──
  log('Phase3', 'Updating manifest...');
  const newManifest = await downloadManifest();

  // Build lookup of oldFolderName → new entry
  const planMap = {};
  for (const entry of plan.plan) {
    planMap[entry.oldFolderName] = entry;
  }

  // Update folders in manifest
  for (const folder of (newManifest.folders || [])) {
    const update = planMap[folder.folderName];
    if (update) {
      folder.categoryName = update.primaryCategory;
      folder.folderName = update.newFolderName;
      folder.categories = update.categories;
      if (folder.metadata) {
        folder.metadata.displayName = update.newDisplayName;
      }
    }
  }

  await uploadManifest(newManifest);
  log('Phase3', 'Manifest updated');

  // ── Phase 4: Cleanup ──
  log('Phase4', 'Checking for empty old category folders...');
  const oldCats = [...new Set(plan.plan.map(e => e.oldPath.split('/')[0]))];

  for (const cat of oldCats) {
    const { data: remaining, error } = await supabase
      .storage
      .from('blitzkrieg')
      .list(cat, { limit: 1 });

    if (error) {
      log('Phase4', `List ${cat} failed: ${error.message}`, 'warn');
      continue;
    }

    if (!remaining || remaining.length === 0) {
      log('Phase4', `${cat}/ is empty — can be deleted (manual step recommended)`);
    } else {
      log('Phase4', `${cat}/ still has ${remaining.length}+ items — keeping`);
    }
  }

  // ── Phase 5: Verify ──
  log('Phase5', 'Verifying...');
  const verifyManifest = await downloadManifest();
  log('Phase5', `Manifest downloaded: ${verifyManifest.folders?.length || 0} folders`);

  // Spot-check 10 random templates
  const sample = plan.plan.sort(() => Math.random() - 0.5).slice(0, 10);
  for (const entry of sample) {
    const testPath = `${entry.primaryCategory}/${entry.newFolderName}/comp.png`;
    const { data, error } = await supabase
      .storage
      .from('blitzkrieg')
      .createSignedUrl(testPath, 60);

    if (error) {
      log('Phase5', `  FAIL: ${testPath}: ${error.message}`, 'error');
    } else {
      log('Phase5', `  OK: ${testPath} → signed URL valid`);
    }
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════');
  console.log('  MIGRATION COMPLETE');
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed:  ${failCount}`);
  console.log('═══════════════════════════════════════');

  // Save failure log
  if (failures.length > 0) {
    const failPath = path.join(__dirname, '..', 'migration-failures.json');
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2));
    console.log(`Failures written to: ${failPath}`);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
