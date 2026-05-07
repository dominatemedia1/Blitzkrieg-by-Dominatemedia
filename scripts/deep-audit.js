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

async function main() {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'classification-plan.json'), 'utf8'));

  console.log('=== DEEP AUDIT: OLD vs NEW FILE COMPARISON ===\n');

  let summary = {
    bothHaveFiles: 0,       // old + new both have real content files
    newOnly: 0,             // only new has files (old empty or missing)
    oldOnly: 0,             // only old has files (NEW MISSING — BAD)
    bothEmpty: 0,           // neither has real files (lost)
    oldPartial: 0,          // old has files but new has fewer
    newPartial: 0,          // new has files but old has fewer (normal after deletes)
  };

  const missingInNew = [];   // old has files, new has none
  const partialInNew = [];   // old has more files than new
  const emptyBoth = [];      // both old and new empty

  let checked = 0;

  for (const entry of plan.plan) {
    checked++;
    if (checked % 50 === 0) process.stderr.write(`  ${checked}/${plan.plan.length}...\n`);

    const oldPath = entry.oldPath;
    const newPath = entry.newPath;

    let oldFiles = [];
    let newFiles = [];

    try { oldFiles = await collectAllFiles(oldPath); } catch(e) { /* path doesn't exist */ }
    try { newFiles = await collectAllFiles(newPath); } catch(e) { /* path doesn't exist */ }

    // Strip prefix to compare relative paths
    const oldRel = oldFiles.map(f => f.substring(oldPath.length + 1)).sort();
    const newRel = newFiles.map(f => f.substring(newPath.length + 1)).sort();

    const oldSet = new Set(oldRel);
    const newSet = new Set(newRel);

    if (oldRel.length > 0 && newRel.length > 0) {
      summary.bothHaveFiles++;

      // Check if new is missing files that old has
      const missing = oldRel.filter(f => !newSet.has(f));
      const extra = newRel.filter(f => !oldSet.has(f));

      if (missing.length > 0) {
        summary.oldPartial++;
        partialInNew.push({
          oldPath, newPath,
          oldCount: oldRel.length, newCount: newRel.length,
          missingFromNew: missing,
          extraInNew: extra
        });
      }
    } else if (newRel.length > 0) {
      summary.newOnly++;
    } else if (oldRel.length > 0) {
      summary.oldOnly++;
      missingInNew.push({ oldPath, newPath, oldCount: oldRel.length, files: oldRel.slice(0, 10) });
    } else {
      summary.bothEmpty++;
      emptyBoth.push({ oldPath, newPath });
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Both have files: ${summary.bothHaveFiles}`);
  console.log(`New only (old empty): ${summary.newOnly}`);
  console.log(`Old only (NEW MISSING!): ${summary.oldOnly}`);
  console.log(`Both empty (LOST): ${summary.bothEmpty}`);
  console.log(`Partial (new missing some): ${summary.oldPartial}`);
  console.log(`Total checked: ${checked}`);

  if (missingInNew.length > 0) {
    console.log(`\n=== NEW MISSING ALL FILES (${missingInNew.length}) ===`);
    for (const m of missingInNew) {
      console.log(`  ${m.oldPath} → ${m.newPath}`);
      console.log(`    Old has ${m.oldCount} files, New has 0`);
      console.log(`    Old files: ${m.files.join(', ')}`);
    }
  }

  if (partialInNew.length > 0) {
    console.log(`\n=== NEW MISSING SOME FILES (${partialInNew.length}) ===`);
    for (const p of partialInNew.slice(0, 20)) {
      console.log(`  ${p.oldPath} → ${p.newPath}`);
      console.log(`    Old: ${p.oldCount} files, New: ${p.newCount} files`);
      console.log(`    Missing from new: ${p.missingFromNew.slice(0, 5).join(', ')}${p.missingFromNew.length > 5 ? ` +${p.missingFromNew.length - 5} more` : ''}`);
    }
    if (partialInNew.length > 20) console.log(`  ... and ${partialInNew.length - 20} more`);
  }

  if (emptyBoth.length > 0) {
    console.log(`\n=== BOTH EMPTY (${emptyBoth.length}) ===`);
    for (const e of emptyBoth) {
      console.log(`  ${e.oldPath} → ${e.newPath}`);
    }
  }
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
