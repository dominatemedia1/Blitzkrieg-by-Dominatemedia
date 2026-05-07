#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://kwrmdxptrrvlqxdcasho.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function listAll(prefix) {
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from('blitzkrieg').list(prefix, { limit: 1000, offset });
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
  const { data, error } = await supabase.storage.from('blitzkrieg').download(filePath);
  if (error) throw error;
  return data;
}

async function uploadFile(filePath, blob) {
  const { error } = await supabase.storage.from('blitzkrieg').upload(filePath, blob, { upsert: true });
  if (error) throw error;
}

const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'classification-plan.json'), 'utf8'));

async function main() {
  console.log('=== FIXING REMAINING PROBLEM TEMPLATES ===\n');

  // Find templates with 0 or 1 file (just metadata.json) in new categories
  const cats = [
    '3D-and-Depth','Backgrounds','Call-to-Actions','Callouts','Icons-and-Shapes',
    'Infographics','Lower-Thirds','Overlays-and-FX','Pre-comps','Process-and-Steps',
    'Titles-and-Openers','Transitions'
  ];

  for (const cat of cats) {
    const subs = await listAll(cat);
    for (const sub of subs) {
      if (sub.id !== null) continue; // skip files at root
      const newPath = `${cat}/${sub.name}`;
      const files = await collectAllFiles(newPath);
      if (files.length === 0) {
        console.log(`EMPTY: ${newPath}`);
        // Find old path
        const entry = plan.plan.find(e => e.newFolderName === sub.name || e.newPath === newPath);
        if (entry) {
          const oldFiles = await collectAllFiles(entry.oldPath).catch(() => []);
          console.log(`  Old (${entry.oldPath}): ${oldFiles.length} files`);
          if (oldFiles.length > 0) {
            for (const oldFile of oldFiles) {
              const rel = oldFile.substring(entry.oldPath.length + 1);
              const dest = `${newPath}/${rel}`;
              try {
                const blob = await downloadFile(oldFile);
                await uploadFile(dest, blob);
                console.log(`  RESCUED: ${rel}`);
              } catch(e) {
                console.log(`  FAIL: ${rel} - ${e.message || e}`);
              }
            }
            const recheck = await collectAllFiles(newPath);
            console.log(`  Final: ${recheck.length} files`);
          }
        }
      } else if (files.length === 1 && files[0].endsWith('metadata.json')) {
        console.log(`METADATA ONLY: ${newPath}`);
        const entry = plan.plan.find(e => e.newFolderName === sub.name || e.newPath === newPath);
        if (entry) {
          const oldFiles = await collectAllFiles(entry.oldPath).catch(() => []);
          console.log(`  Old (${entry.oldPath}): ${oldFiles.length} files`);
          if (oldFiles.length > 1) {
            for (const oldFile of oldFiles) {
              const rel = oldFile.substring(entry.oldPath.length + 1);
              if (files.includes(`${newPath}/${rel}`)) {
                console.log(`  SKIP (already exists): ${rel}`);
                continue;
              }
              const dest = `${newPath}/${rel}`;
              try {
                const blob = await downloadFile(oldFile);
                await uploadFile(dest, blob);
                console.log(`  RESCUED: ${rel}`);
              } catch(e) {
                console.log(`  FAIL: ${rel} - ${e.message || e}`);
              }
            }
            const recheck = await collectAllFiles(newPath);
            console.log(`  Final: ${recheck.length} files`);
          }
        }
      }
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
