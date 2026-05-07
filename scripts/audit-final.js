#!/usr/bin/env node
'use strict';
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kwrmdxptrrvlqxdcasho.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

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
  let realFiles = 0;
  let realFileNames = [];
  for (const item of items) {
    if (item.id === null) {
      const sub = await deepCount(`${prefix}/${item.name}`);
      realFiles += sub.count;
      realFileNames.push(...sub.names);
    } else if (item.name !== '.emptyFolderPlaceholder') {
      realFiles++;
      realFileNames.push(`${prefix}/${item.name}`);
    }
  }
  return { count: realFiles, names: realFileNames };
}

async function main() {
  const cats = [
    '3D-and-Depth','Backgrounds','Call-to-Actions','Callouts','Icons-and-Shapes',
    'Infographics','Lower-Thirds','Overlays-and-FX','Pre-comps','Process-and-Steps',
    'Titles-and-Openers','Transitions'
  ];

  console.log('=== FULL AUDIT OF ALL 12 CATEGORIES ===\n');

  let grandTotal = 0;
  const problems = [];

  for (const cat of cats) {
    try {
      const subs = await listAll(cat);
      let catFiles = 0;
      let catTemplates = 0;
      let emptyTemplates = [];

      for (const sub of subs) {
        if (sub.id === null) {
          catTemplates++;
          const { count, names } = await deepCount(`${cat}/${sub.name}`);
          catFiles += count;
          if (count === 0) {
            emptyTemplates.push(sub.name);
          } else if (count === 1 && names[0] && names[0].endsWith('metadata.json')) {
            problems.push({ cat, template: sub.name, files: count, note: 'only metadata.json', names });
          }
        } else if (sub.name !== '.emptyFolderPlaceholder') {
          catFiles++;
          catTemplates++;
        }
      }

      console.log(`${cat}: ${catTemplates} templates, ${catFiles} files`);
      if (emptyTemplates.length > 0) console.log(`  EMPTY: ${emptyTemplates.join(', ')}`);
      grandTotal += catTemplates;
    } catch(e) {
      console.log(`${cat}: ERROR - ${e.message || e}`);
    }
  }

  console.log(`\nTotal templates: ${grandTotal}`);

  if (problems.length > 0) {
    console.log(`\n=== PROBLEMS (${problems.length}) ===`);
    for (const p of problems) {
      console.log(`  ${p.cat}/${p.template}: ${p.note}`);
      console.log(`    Names: ${JSON.stringify(p.names)}`);
    }
  } else {
    console.log('\nAll templates have real files. No problems found.');
  }

  // Check old categories
  console.log('\n=== OLD CATEGORY CHECK ===');
  const oldCats = ['Dominate Media', 'John Ventura', 'Shaz', 'Usama Ahmad'];
  for (const cat of oldCats) {
    try {
      const items = await listAll(cat);
      const realFiles = items.filter(i => i.id !== null && i.name !== '.emptyFolderPlaceholder');
      const folders = items.filter(i => i.id === null);
      console.log(`${cat}: ${folders.length} folders, ${realFiles.length} root files`);
      let stillHasFiles = 0;
      for (const f of folders) {
        const { count } = await deepCount(`${cat}/${f.name}`);
        if (count > 0) { console.log(`  STILL HAS FILES: ${cat}/${f.name} (${count} files)`); stillHasFiles++; }
      }
      if (stillHasFiles === 0 && folders.length > 0) console.log('  (all empty - safe to delete)');
    } catch(e) {
      console.log(`${cat}: ERROR - ${e.message || e}`);
    }
  }

  // Check manifest
  console.log('\n=== MANIFEST CHECK ===');
  try {
    const { data, error } = await supabase.storage.from('blitzkrieg').download('_blitzkrieg_manifest_v2.json');
    if (error) throw error;
    const manifest = JSON.parse(await data.text());
    console.log(`Manifest version: ${manifest.version}, ts: ${manifest.ts}`);
    console.log(`Folders in manifest: ${manifest.folders?.length || 0}`);
    const catsInMan = {};
    for (const f of (manifest.folders || [])) {
      catsInMan[f.categoryName] = (catsInMan[f.categoryName] || 0) + 1;
    }
    for (const [cat, count] of Object.entries(catsInMan)) {
      console.log(`  ${cat}: ${count}`);
    }
  } catch(e) {
    console.log(`Manifest: ERROR - ${e.message || e}`);
  }
}

main().catch(e => console.error('FATAL:', e.message || e));
