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

async function main() {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'classification-plan.json'), 'utf8'));

  console.log('=== RESCUING PARTIAL TEMPLATES ===\n');

  let totalMissing = 0;
  let totalRescued = 0;
  let totalFailed = 0;

  for (const entry of plan.plan) {
    const oldPath = entry.oldPath;
    const newPath = entry.newPath;

    let oldFiles, newFiles;
    try { oldFiles = await collectAllFiles(oldPath); } catch(e) { continue; }
    try { newFiles = await collectAllFiles(newPath); } catch(e) { newFiles = []; }

    const oldRel = oldFiles.map(f => f.substring(oldPath.length + 1));
    const newRels = new Set(newFiles.map(f => f.substring(newPath.length + 1)));

    const missing = oldRel.filter(f => !newRels.has(f));

    if (missing.length === 0) continue;

    totalMissing += missing.length;
    console.log(`${oldPath} → ${newPath}: ${missing.length} missing`);

    let rescued = 0;
    for (const rel of missing) {
      const srcFile = `${oldPath}/${rel}`;
      const dstFile = `${newPath}/${rel}`;
      try {
        const blob = await downloadFile(srcFile);
        await uploadFile(dstFile, blob);
        rescued++;
        if (rescued % 10 === 0) process.stdout.write(`  ${rescued}/${missing.length}...\n`);
      } catch(e) {
        console.log(`  FAIL: ${rel} — ${e.message || e}`);
      }
    }
    console.log(`  Rescued: ${rescued}/${missing.length}`);
    totalRescued += rescued;
    totalFailed += (missing.length - rescued);
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nTotal missing files: ${totalMissing}`);
  console.log(`Total rescued: ${totalRescued}`);
  console.log(`Total failed: ${totalFailed}`);
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
