#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kwrmdxptrrvlqxdcasho.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const PLAN_FILE = path.join(__dirname, '..', 'classification-plan.json');
const STATE_FILE = path.join(__dirname, '..', 'rescue-all-state.json');

function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return { completed: [], failed: [], skipped: [] };
}
function saveState(state) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }

async function listFiles(prefix) {
  const { data, error } = await supabase.storage.from('blitzkrieg').list(prefix, { limit: 1000 });
  if (error) throw error;
  return data || [];
}

async function collectAllFiles(prefix) {
  const items = await listFiles(prefix);
  const files = [];
  for (const item of items) {
    if (item.id === null) {
      const sub = await collectAllFiles(`${prefix}/${item.name}`);
      files.push(...sub);
    } else {
      files.push({ relPath: `${prefix}/${item.name}`, name: item.name });
    }
  }
  return files;
}

async function downloadFile(filePath) {
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { data, error } = await supabase.storage.from('blitzkrieg').download(filePath);
      if (error) throw error;
      return data;
    } catch(e) {
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function uploadFile(filePath, blob) {
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { error } = await supabase.storage.from('blitzkrieg').upload(filePath, blob, { upsert: true });
      if (error) throw error;
      return;
    } catch(e) {
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function hasRealFiles(prefix) {
  try {
    const items = await listFiles(prefix);
    return items.some(s => s.id !== null && s.name !== '.emptyFolderPlaceholder');
  } catch(e) { return null; }
}

async function moveTemplate(oldPath, newPath) {
  const files = await collectAllFiles(oldPath);
  // Filter out .emptyFolderPlaceholder
  const realFiles = files.filter(f => f.name !== '.emptyFolderPlaceholder');
  if (realFiles.length === 0) return { success: true, moved: 0, total: 0 };

  let moved = 0;
  let failed = [];
  for (const file of realFiles) {
    const rel = file.relPath.substring(oldPath.length + 1);
    const newFile = `${newPath}/${rel}`;
    try {
      const blob = await downloadFile(file.relPath);
      await uploadFile(newFile, blob);
      moved++;
    } catch(e) {
      failed.push({ file: file.relPath, dest: newFile, error: e.message || String(e) });
    }
  }
  return { success: failed.length === 0 && moved === realFiles.length, moved, total: realFiles.length, failed };
}

async function main() {
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  const state = loadState();

  const planMap = {};
  for (const entry of plan.plan) planMap[entry.oldPath] = entry.newPath;

  // Find templates needing rescue: old has files, new doesn't
  console.log('Scanning all plan entries for templates needing rescue...\n');

  const toRescue = [];
  const oldEmptyAcc = [];
  const newHasFilesAcc = [];
  const noOldAcc = [];

  for (const entry of plan.plan) {
    const oldPath = entry.oldPath;
    const newPath = entry.newPath;

    if (state.completed.includes(oldPath) || state.skipped.includes(oldPath)) continue;
    if (state.failed.some(f => f.oldPath === oldPath)) continue;

    const oldCheck = await hasRealFiles(oldPath);
    if (oldCheck === null) {
      noOldAcc.push(oldPath);
      state.skipped.push(oldPath);
      continue;
    }
    if (!oldCheck) {
      oldEmptyAcc.push(oldPath);
      state.skipped.push(oldPath);
      continue;
    }

    const newCheck = await hasRealFiles(newPath);
    if (newCheck === true) {
      newHasFilesAcc.push(oldPath);
      state.skipped.push(oldPath);
      continue;
    }
    // newCheck false or null — need to rescue

    toRescue.push({ oldPath, newPath });
  }

  console.log(`To rescue: ${toRescue.length}`);
  console.log(`Old empty: ${oldEmptyAcc.length}`);
  console.log(`New already has files: ${newHasFilesAcc.length}`);
  console.log(`Old path missing: ${noOldAcc.length}`);
  console.log(`Previously completed/skipped: ${state.completed.length + state.skipped.length}\n`);

  if (toRescue.length === 0) {
    console.log('Nothing to rescue. All templates in new locations.');
    return;
  }

  // Process
  let rescued = 0;
  let partialCount = 0;
  let failedCount = 0;

  for (let i = 0; i < toRescue.length; i++) {
    const { oldPath, newPath } = toRescue[i];
    process.stdout.write(`[${i + 1}/${toRescue.length}] ${oldPath} → ${newPath} ... `);

    try {
      const result = await moveTemplate(oldPath, newPath);
      if (result.success && result.total > 0) {
        console.log(`OK (${result.moved} files)`);
        state.completed.push(oldPath);
        rescued++;
      } else if (result.moved === 0 && result.total === 0) {
        console.log(`EMPTY`);
        state.skipped.push(oldPath);
      } else if (result.moved === result.total) {
        console.log(`OK (${result.moved}/${result.total})`);
        state.completed.push(oldPath);
        rescued++;
      } else {
        console.log(`PARTIAL ${result.moved}/${result.total}`);
        partialCount++;
        state.failed.push({ oldPath, newPath, reason: `partial: ${result.moved}/${result.total}`, detail: result.failed });
      }
    } catch(e) {
      console.log(`FAIL: ${e.message || e}`);
      failedCount++;
      state.failed.push({ oldPath, newPath, reason: e.message || String(e) });
    }

    saveState(state);
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n=== RESCUE COMPLETE ===`);
  console.log(`Rescued: ${rescued}/${toRescue.length}`);
  console.log(`Partial: ${partialCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`State saved to ${STATE_FILE}`);
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
