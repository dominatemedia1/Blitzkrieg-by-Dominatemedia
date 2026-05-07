#!/usr/bin/env node
'use strict';
// sync-manifest.js — Regenerate and upload _blitzkrieg_manifest_v2.json to Supabase.
//
// Lists all folders across the 12 animation-type categories from Supabase Storage,
// downloads each metadata.json, builds a fresh manifest, and uploads it.
// This keeps the manifest in sync with the actual bucket contents after migration.
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/sync-manifest.js

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kwrmdxptrrvlqxdcasho.supabase.co';
const BUCKET = 'blitzkrieg';
const MANIFEST_KEY = '_blitzkrieg_manifest_v2.json';

const CATEGORIES = [
  '3D-and-Depth', 'Backgrounds', 'Call-to-Actions', 'Callouts',
  'Icons-and-Shapes', 'Infographics', 'Lower-Thirds', 'Overlays-and-FX',
  'Pre-comps', 'Process-and-Steps', 'Titles-and-Openers', 'Transitions'
];

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

async function downloadJson(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) return null;
  try {
    const text = await data.text();
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('Regenerating manifest from bucket state...\n');

  const folders = [];

  for (const cat of CATEGORIES) {
    console.log(`Scanning ${cat}...`);
    const items = await listAll(cat);
    let count = 0;
    for (const item of items) {
      if (item.id !== null) continue; // skip files, only process template folders
      if (item.name === '.emptyFolderPlaceholder') continue;

      // Each template is a folder named like "{DisplayName}_{timestamp}"
      const folderName = item.name;
      const storagePath = `${cat}/${folderName}`;
      const metadata = await downloadJson(`${storagePath}/metadata.json`);

      if (metadata) {
        folders.push({
          categoryName: cat,
          folderName: folderName,
          metadata: metadata
        });
        count++;
      }
    }
    console.log(`  ${cat}: ${count} templates`);
  }

  const manifest = {
    version: 2,
    ts: Date.now(),
    folders: folders,
    archives: []
  };

  console.log(`\nTotal: ${folders.length} templates`);
  console.log(`Uploading manifest to ${BUCKET}/${MANIFEST_KEY}...`);

  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).upload(MANIFEST_KEY, blob, {
    upsert: true,
    contentType: 'application/json'
  });

  if (error) {
    console.error('Upload failed:', error.message);
    process.exit(1);
  }

  console.log('Manifest synced successfully.');
  console.log(`Categories: ${[...new Set(folders.map(f => f.categoryName))].length}`);
}

main().catch(e => { console.error('FATAL:', e.message || e); process.exit(1); });
