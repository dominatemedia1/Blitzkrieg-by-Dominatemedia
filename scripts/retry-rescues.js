#!/usr/bin/env node
'use strict';
// retry-rescues.js — Re-attempt the 12 failed entries from rescue-state.json.
//
// These failed with Bad Gateway / Gateway Timeout during the initial rescue pass.
// The old files may still exist in the legacy folders — this script re-checks
// and copies any remaining missing files.
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/retry-rescues.js

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kwrmdxptrrvlqxdcasho.supabase.co';
const BUCKET = 'blitzkrieg';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function listAll(prefix) {
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    offset += data.length;
  }
  return all;
}

async function collectAllFiles(prefix) {
  const items = await listAll(prefix);
  const files = [];
  for (const item of items) {
    if (item.id === null) {
      const sub = await collectAllFiles(`${prefix}/${item.name}`);
      files.push(...sub);
    } else if (item.name !== '.emptyFolderPlaceholder') {
      files.push(`${prefix}/${item.name}`);
    }
  }
  return files;
}

async function downloadFile(filePath) {
  for (let i = 0; i < 3; i++) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(filePath);
      if (error) throw error;
      return data;
    } catch(e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function uploadFile(filePath, blob) {
  for (let i = 0; i < 3; i++) {
    try {
      const { error } = await supabase.storage.from(BUCKET).upload(filePath, blob, { upsert: true });
      if (error) throw error;
      return;
    } catch(e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function main() {
  const statePath = path.join(__dirname, '..', 'rescue-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const failed = state.failed;

  if (failed.length === 0) {
    console.log('No failed entries to retry.');
    return;
  }

  console.log(`Retrying ${failed.length} failed rescues...\n`);

  let rescued = 0;
  let stillFailed = 0;
  const newFailed = [];

  for (const entry of failed) {
    const { oldPath, newPath } = entry;
    console.log(`${oldPath} → ${newPath}`);

    // Check what old files still exist
    let oldFiles;
    try {
      oldFiles = await collectAllFiles(oldPath);
    } catch(e) {
      console.log(`  Cannot list old: ${e.message || e}`);
      newFailed.push(entry);
      stillFailed++;
      continue;
    }

    if (oldFiles.length === 0) {
      console.log(`  Old folder empty or gone — already migrated?`);
      continue; // not a failure — files already moved
    }

    // Check what new files exist
    let newFiles;
    try {
      newFiles = await collectAllFiles(newPath);
    } catch(e) {
      // New path may not exist yet — that's fine, we're about to create it
      newFiles = [];
    }

    const newRels = new Set(newFiles.map(f => f.substring(newPath.length + 1)));
    const missing = oldFiles.filter(f => {
      const rel = f.substring(oldPath.length + 1);
      return !newRels.has(rel) && !f.endsWith('.emptyFolderPlaceholder');
    });

    if (missing.length === 0) {
      console.log(`  All files already in new location — OK`);
      continue;
    }

    console.log(`  ${missing.length} files missing in new location`);

    let entryRescued = 0;
    for (const oldFile of missing) {
      const rel = oldFile.substring(oldPath.length + 1);
      const dst = `${newPath}/${rel}`;
      try {
        const blob = await downloadFile(oldFile);
        await uploadFile(dst, blob);
        entryRescued++;
      } catch(e) {
        console.log(`  FAIL: ${rel} — ${e.message || e}`);
      }
    }

    if (entryRescued === missing.length) {
      console.log(`  Rescued: ${entryRescued}/${missing.length}`);
      rescued += entryRescued;
    } else {
      console.log(`  Partial: ${entryRescued}/${missing.length}`);
      rescued += entryRescued;
      newFailed.push(entry);
      stillFailed++;
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // Update rescue state
  state.failed = newFailed;
  state.lastRetry = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  console.log(`\n=== SUMMARY ===`);
  console.log(`Rescued: ${rescued} files`);
  console.log(`Still failed: ${stillFailed} entries`);
  console.log(`Rescue state updated at rescue-state.json`);
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
