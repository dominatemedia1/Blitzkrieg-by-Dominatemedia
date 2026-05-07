#!/usr/bin/env node
'use strict';
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
    } else {
      files.push(`${prefix}/${item.name}`);
    }
  }
  return files;
}

async function deleteFile(filePath) {
  const { error } = await supabase.storage.from('blitzkrieg').remove([filePath]);
  if (error) throw error;
}

async function main() {
  const oldCats = ['Dominate Media', 'John Ventura', 'Shaz', 'Usama Ahmad'];

  for (const cat of oldCats) {
    console.log(`\nProcessing ${cat}...`);
    try {
      const items = await listAll(cat);
      const folders = items.filter(i => i.id === null);

      if (folders.length === 0) {
        console.log(`  No subfolders — deleting root category`);
        // Delete any root files + the empty placeholder
        const rootFiles = items.filter(i => i.id !== null);
        const toDelete = rootFiles.map(f => `${cat}/${f.name}`);
        if (toDelete.length > 0) {
          // Delete in batches
          for (let i = 0; i < toDelete.length; i += 100) {
            const batch = toDelete.slice(i, i + 100);
            await supabase.storage.from('blitzkrieg').remove(batch);
            console.log(`  Deleted ${batch.length} root files`);
          }
        }
        continue;
      }

      console.log(`  ${folders.length} subfolders`);
      let deleted = 0;
      let failed = 0;

      for (const folder of folders) {
        const folderPath = `${cat}/${folder.name}`;
        try {
          const files = await collectAllFiles(folderPath);
          if (files.length === 0) {
            // Delete just the placeholder if it exists
            try {
              await deleteFile(`${folderPath}/.emptyFolderPlaceholder`);
            } catch(e) { /* might not exist */ }
            try {
              await deleteFile(folderPath);
            } catch(e) { /* might not exist */ }
            deleted++;
            continue;
          }

          // Delete all files in batches
          const toDelete = files.map(f => f);
          for (let i = 0; i < toDelete.length; i += 100) {
            const batch = toDelete.slice(i, i + 100);
            await supabase.storage.from('blitzkrieg').remove(batch);
          }
          // Delete folder (may fail if empty placeholder exists)
          try {
            await deleteFile(`${folderPath}/.emptyFolderPlaceholder`);
          } catch(e) { /* might not exist */ }

          deleted++;
          if (deleted % 10 === 0) process.stdout.write(`  ${deleted}/${folders.length}...\n`);
        } catch(e) {
          failed++;
          console.log(`  FAIL ${folderPath}: ${e.message || e}`);
        }
      }
      console.log(`  Done: ${deleted} deleted, ${failed} failed`);

    } catch(e) {
      console.log(`  ERROR: ${e.message || e}`);
    }
  }

  // Also clean up the old "sign" folder
  console.log('\nCleaning up sign/ folder...');
  try {
    const signItems = await listAll('sign');
    const signFiles = [];
    for (const item of signItems) {
      if (item.id !== null) signFiles.push(`sign/${item.name}`);
      else {
        const subs = await collectAllFiles(`sign/${item.name}`);
        signFiles.push(...subs);
        // Delete empty placeholder
        try { await deleteFile(`sign/${item.name}/.emptyFolderPlaceholder`); } catch(e) {}
      }
    }
    if (signFiles.length > 0) {
      for (let i = 0; i < signFiles.length; i += 100) {
        await supabase.storage.from('blitzkrieg').remove(signFiles.slice(i, i + 100));
      }
    }
    console.log(`  Deleted ${signFiles.length} files from sign/`);
    // Remove sign root
    try { await supabase.storage.from('blitzkrieg').remove(['sign/.emptyFolderPlaceholder']); } catch(e) {}
  } catch(e) {
    console.log(`  ERROR: ${e.message || e}`);
  }

  console.log('\nOld category cleanup complete.');
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
