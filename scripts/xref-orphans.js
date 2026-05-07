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

async function deepCount(prefix) {
  const items = await listAll(prefix);
  let count = 0;
  for (const item of items) {
    if (item.id === null) {
      count += (await deepCount(`${prefix}/${item.name}`)).count;
    } else if (item.name !== '.emptyFolderPlaceholder') {
      count++;
    }
  }
  return { count };
}

async function main() {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'classification-plan.json'), 'utf8'));

  // Build set of all oldFolderNames from plan
  const planOldFolderNames = new Set(plan.plan.map(e => e.oldFolderName));
  const planOldPaths = new Set(plan.plan.map(e => e.oldPath));

  const oldCats = ['Dominate Media', 'John Ventura', 'Shaz', 'Usama Ahmad'];

  console.log('=== OLD FOLDERS NOT IN PLAN ===\n');

  let orphanCount = 0;
  for (const cat of oldCats) {
    try {
      const items = await listAll(cat);
      const folders = items.filter(i => i.id === null);
      for (const f of folders) {
        const oldFolderPath = `${cat}/${f.name}`;
        if (!planOldPaths.has(oldFolderPath)) {
          const { count } = await deepCount(oldFolderPath);
          if (count > 0) {
            console.log(`ORPHAN (not in plan): ${oldFolderPath} (${count} files)`);
            orphanCount++;
          }
        }
      }
    } catch(e) {
      console.log(`${cat}: ERROR - ${e.message || e}`);
    }
  }

  console.log(`\n=== PLAN ENTRIES WITH OLD PATH STILL HAVING FILES ===\n`);

  let stillHasFilesCount = 0;
  for (const entry of plan.plan) {
    const oldPath = entry.oldPath;
    try {
      const { count } = await deepCount(oldPath);
      if (count > 0) {
        console.log(`STILL IN OLD: ${oldPath} → ${entry.newPath} (${count} files)`);
        stillHasFilesCount++;
      }
    } catch(e) {
      // path doesn't exist — fine
    }
    if (stillHasFilesCount > 30) {
      console.log(`... and more (showing first 30; ${stillHasFilesCount} found so far)`);
      break;
    }
  }

  if (stillHasFilesCount === 0) console.log('None — all plan entries cleared from old locations.');

  console.log(`\nOrphans (old folders not in plan): ${orphanCount}`);
  console.log(`Plan entries still in old location: ${stillHasFilesCount}`);
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
