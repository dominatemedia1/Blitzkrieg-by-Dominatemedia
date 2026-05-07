#!/usr/bin/env node
/**
 * rescue-templates.js — Robust recovery of templates still in old categories.
 *
 * Moves files from old category folders → new URL-safe paths.
 * Saves state after every template so it can be resumed.
 * Old files are NOT deleted (safe).
 *
 * Usage: node scripts/rescue-templates.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kwrmdxptrrvlqxdcasho.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const STATE_FILE = path.join(__dirname, '..', 'rescue-state.json');
const PLAN_FILE = path.join(__dirname, '..', 'classification-plan.json');

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return { completed: [], failed: [] };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function listFiles(prefix) {
  const { data, error } = await supabase.storage.from('blitzkrieg').list(prefix, { limit: 1000 });
  if (error) throw error;
  return data || [];
}

async function downloadFile(filePath) {
  const { data, error } = await supabase.storage.from('blitzkrieg').download(filePath);
  if (error) throw error;
  return data;
}

async function uploadFile(filePath, blob, contentType) {
  const { error } = await supabase.storage.from('blitzkrieg').upload(filePath, blob, {
    contentType: contentType || 'application/octet-stream',
    upsert: true
  });
  if (error) throw error;
}

async function collectAllFiles(prefix) {
  const items = await listFiles(prefix);
  const files = [];
  for (const item of items) {
    if (item.id === null) {
      // Folder — recurse
      const sub = await collectAllFiles(`${prefix}/${item.name}`);
      files.push(...sub);
    } else {
      files.push({ path: `${prefix}/${item.name}`, meta: item.metadata });
    }
  }
  return files;
}

async function moveTemplate(oldPath, newPath) {
  const files = await collectAllFiles(oldPath);
  if (files.length === 0) {
    return { moved: 0, total: 0 };
  }

  let moved = 0;
  for (const file of files) {
    const rel = file.path.substring(oldPath.length + 1);
    const newFile = `${newPath}/${rel}`;

    const blob = await downloadFile(file.path);
    await uploadFile(newFile, blob, file.meta?.mimetype);
    moved++;
  }
  return { moved, total: files.length };
}

async function main() {
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  const state = loadState();

  // Build lookup: oldPath -> newPath
  const planMap = {};
  for (const entry of plan.plan) {
    planMap[entry.oldPath] = entry.newPath;
  }

  // Find all old folders that still have files
  console.log('Scanning old categories for templates still needing rescue...');
  const oldCats = ['Dominate Media', 'John Ventura', 'Shaz', 'Usama Ahmad'];
  const toRescue = [];

  for (const cat of oldCats) {
    const items = await listFiles(cat);
    for (const item of items) {
      const oldPath = `${cat}/${item.name}`;
      const newPath = planMap[oldPath];
      if (!newPath) {
        console.log(`  SKIP ${oldPath}: no mapping in plan`);
        continue;
      }
      if (state.completed.includes(oldPath)) {
        continue;
      }
      if (state.failed.some(f => f.oldPath === oldPath)) {
        continue;
      }
      // Check if old has real files (not just .emptyFolderPlaceholder)
      const subs = await listFiles(oldPath);
      const hasReal = subs.some(s => s.id !== null && s.name !== '.emptyFolderPlaceholder');
      if (!hasReal) {
        continue;
      }
      // Check if new already has real files
      try {
        const newSubs = await listFiles(newPath);
        const newHasReal = newSubs.some(s => s.id !== null && s.name !== '.emptyFolderPlaceholder');
        if (newHasReal) {
          console.log(`  SKIP ${oldPath}: already rescued`);
          state.completed.push(oldPath);
          continue;
        }
      } catch (e) {
        // New path doesn't exist yet — need to rescue
      }
      toRescue.push({ oldPath, newPath });
    }
  }

  console.log(`\nTemplates to rescue: ${toRescue.length}`);
  if (toRescue.length === 0) {
    console.log('All templates rescued!');
    return;
  }

  // Process
  let rescued = 0;
  for (let i = 0; i < toRescue.length; i++) {
    const { oldPath, newPath } = toRescue[i];
    console.log(`[${i + 1}/${toRescue.length}] ${oldPath} → ${newPath}`);

    try {
      const result = await moveTemplate(oldPath, newPath);
      if (result.moved === result.total && result.total > 0) {
        console.log(`  OK: ${result.moved} files`);
        state.completed.push(oldPath);
        rescued++;
      } else {
        console.log(`  PARTIAL: ${result.moved}/${result.total} files`);
        state.failed.push({ oldPath, newPath, reason: `partial: ${result.moved}/${result.total}` });
      }
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
      state.failed.push({ oldPath, newPath, reason: e.message });
    }

    saveState(state);
    // Small delay between templates
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nRescue complete: ${rescued}/${toRescue.length} rescued`);
  console.log(`State saved to ${STATE_FILE}`);
  console.log('Old files preserved — no data lost.');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
