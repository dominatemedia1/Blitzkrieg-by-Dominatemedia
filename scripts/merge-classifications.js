#!/usr/bin/env node
/**
 * merge-classifications.js — Merge all 7 batch classification JSONs
 * into a single classification-plan.json with dedup, unique naming,
 * and full category distribution stats.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BATCHES = 7;
const CATS = [
  'Titles & Openers', 'Lower Thirds', 'Backgrounds', 'Transitions',
  'Call to Actions', 'Icons & Shapes', 'Callouts', 'Infographics',
  'Process & Steps', '3D & Depth', 'Overlays & FX', 'Pre-comps'
];

// ── Helpers ──────────────────────────────────────────────────────────

const BANNED = /elegant|dynamic|premium|seamless|stunning|amazing|incredible|professional\b|modern\b|creative\b|innovative|beautiful|gorgeous|sophisticated|ultimate\b|perfect|exceptional|outstanding|fantastic|awesome|epic|cinematic|breathtaking|mesmerizing|captivating|enchanting|dazzling|brilliant|sublime/gi;

function cleanName(name) {
  return name
    .replace(BANNED, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, ' & ')
    .trim();
}

function toFolderName(name, uniqueId) {
  return name
    .replace(/\s+/g, '-')
    .replace(/[\/\\?%*:|\"<>#&]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') + '_' + uniqueId;
}

function extractUniqueId(folderName) {
  const parts = folderName.split('_');
  const last = parts[parts.length - 1];
  if (/^\d{13}$/.test(last)) return last;
  // Try second-to-last
  const second = parts[parts.length - 2];
  if (/^\d{13}$/.test(second)) return second;
  return last;
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  const allEntries = [];
  const seen = new Set();
  let totalFromBatches = 0;

  for (let b = 1; b <= BATCHES; b++) {
    const fpath = path.join('/tmp', `blitzkrieg-batch-${b}-classified.json`);
    if (!fs.existsSync(fpath)) {
      console.error(`Missing: ${fpath}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
    if (!Array.isArray(data)) {
      console.error(`Batch ${b}: not an array`);
      continue;
    }
    console.error(`Batch ${b}: ${data.length} entries`);
    totalFromBatches += data.length;

    for (const entry of data) {
      const key = entry.oldPath;
      if (seen.has(key)) {
        console.error(`  DUPLICATE: ${key} — skipping`);
        continue;
      }
      seen.add(key);

      const primary = entry.primaryCategory || 'Pre-comps';
      const secondary = (entry.secondaryCategories || []).filter(c => c && c !== primary);
      const categories = [primary, ...secondary].slice(0, 3);

      const folderName = entry.oldPath.split('/').pop();
      const uniqueId = extractUniqueId(folderName);

      let displayName = (entry.newDisplayName || folderName).replace(/_/g, ' ').trim();
      displayName = cleanName(displayName);
      if (!displayName || displayName.length < 3) {
        displayName = primary.replace(/s$/, '') + ' Template';
      }

      const newFolderName = toFolderName(displayName, uniqueId);
      const confidence = typeof entry.confidence === 'number'
        ? Math.round(entry.confidence * 100) / 100
        : 0.5;

      allEntries.push({
        oldPath: entry.oldPath,
        newPath: primary + '/' + newFolderName,
        oldDisplayName: entry.oldDisplayName || folderName,
        newDisplayName: displayName,
        oldFolderName: folderName,
        newFolderName,
        oldCategory: (entry.oldPath || '').split('/')[0],
        categories,
        primaryCategory: primary,
        confidence,
        needsReview: confidence < 0.55 || primary === null,
        reason: entry.whatYouSee || 'visual classification',
        metadata: entry.metadata || {}
      });
    }
  }

  // Stats
  const stats = {
    total: allEntries.length,
    autoClassified: 0,
    needsReview: 0,
    byCategory: {},
    byOldCategory: {}
  };

  for (const e of allEntries) {
    if (e.needsReview) stats.needsReview++;
    else stats.autoClassified++;
    const pc = e.primaryCategory;
    if (!stats.byCategory[pc]) stats.byCategory[pc] = 0;
    stats.byCategory[pc]++;
    const oc = e.oldCategory;
    if (!stats.byOldCategory[oc]) stats.byOldCategory[oc] = 0;
    stats.byOldCategory[oc]++;
  }

  // Sort by category then name
  allEntries.sort((a, b) => {
    if (a.primaryCategory !== b.primaryCategory) return a.primaryCategory.localeCompare(b.primaryCategory);
    return a.newDisplayName.localeCompare(b.newDisplayName);
  });

  const output = {
    plan: allEntries,
    summary: {
      ...stats,
      autoPct: Math.round(stats.autoClassified / stats.total * 100),
      reviewPct: Math.round(stats.needsReview / stats.total * 100)
    },
    generatedAt: new Date().toISOString()
  };

  const outPath = path.join(__dirname, '..', 'classification-plan.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.error(`Wrote: ${outPath}`);

  // Print summary
  console.log('── Classification Merge Summary ──');
  console.log(`Total:        ${stats.total}`);
  console.log(`Classified:   ${stats.autoClassified} (${output.summary.autoPct}%)`);
  console.log(`Needs review: ${stats.needsReview} (${output.summary.reviewPct}%)`);
  console.log('\nBy category:');
  for (const [cat, count] of Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log('\nBy old category:');
  for (const [cat, count] of Object.entries(stats.byOldCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  const reviewItems = allEntries.filter(e => e.needsReview);
  if (reviewItems.length > 0) {
    console.log(`\n── Visual Review Required (${reviewItems.length}) ──`);
    reviewItems.forEach(e => {
      console.log(`  [${e.oldCategory}] "${e.oldDisplayName}" → ${e.primaryCategory} (${e.newDisplayName}) conf=${e.confidence}`);
    });
  }
}

main();
