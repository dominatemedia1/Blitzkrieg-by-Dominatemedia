#!/usr/bin/env node
/**
 * classify-templates.js — Full depth audit of every single template.
 * Phase 1: folder-name pattern matching
 * Phase 2: editor heuristics for number-only comps
 * Phase 3: thumbnail-size refinement (tiny=simple, huge=complex)
 * Outputs: classification-plan.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── 12 Categories ──────────────────────────────────────────────────────────
const CATS = [
  'Titles & Openers', 'Lower Thirds', 'Backgrounds', 'Transitions',
  'Call to Actions', 'Icons & Shapes', 'Callouts', 'Infographics',
  'Process & Steps', '3D & Depth', 'Overlays & FX', 'Pre-comps'
];

// ── Folder-name rules (first match wins) ───────────────────────────────────
const FOLDER_RULES = [
  { pattern: /linked.?comp|assemble|pre.?comp|Pre_comp/i, cat: 'Pre-comps' },
  { pattern: /Wylie|Sam.?Zia|John.?Ventura.*AI.?Tool/i, cat: 'Pre-comps' },
  { pattern: /^client_/i, cat: 'Pre-comps' },
  { pattern: /^Video_\d|^video_Linked|^Edit.?pr|^Pr.?edit/i, cat: 'Pre-comps' },
  { pattern: /^3d|_3d|3d_|model|isometric|camera|depth/i, cat: '3D & Depth' },
  { pattern: /step|process|timeline|flow|sequence/i, cat: 'Process & Steps' },
  { pattern: /black.?bg|^bg_|_bg$|background|gradient|particle|loop/i, cat: 'Backgrounds' },
  { pattern: /transition|wipe|morph/i, cat: 'Transitions' },
  { pattern: /^graph_|chart|stats|meter|counter|percent|data/i, cat: 'Infographics' },
  { pattern: /^card_|cta|button|subscribe|like_button|follow|end.?screen|arrow/i, cat: 'Call to Actions' },
  { pattern: /icon|^shape_|tool_|^Map_|circle|square_d|badge|divider/i, cat: 'Icons & Shapes' },
  { pattern: /callout|bubble|speech|annotation|highlight|tooltip|sticker/i, cat: 'Callouts' },
  { pattern: /lower.?third|name.?bar|info.?bar|name.?super/i, cat: 'Lower Thirds' },
  { pattern: /grain|dust|scratch|vhs|light.?leak|film.?burn|glitch|overlay/i, cat: 'Overlays & FX' },
  { pattern: /^text$|text_|title|typo|headline|intro|opener|kinetic|credit/i, cat: 'Titles & Openers' },
  { pattern: /human.?body/i, cat: 'Infographics' },
  { pattern: /^zero_/i, cat: 'Backgrounds' },
  { pattern: /^freelancer_|^clinets_/i, cat: 'Pre-comps' },
  { pattern: /^pic.?montage/i, cat: 'Titles & Openers' },
  { pattern: /^P1$|^b1$/i, cat: 'Titles & Openers' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function classifyByEditor(oldCat, folderName, duration, dims, thumbSize) {
  if (oldCat === 'Shaz') {
    if (/^_\d+/.test(folderName)) return { cat: 'Titles & Openers', conf: 0.70, reason: 'Shaz numbered pack' };
    if (/^\d+_\d+/.test(folderName)) return { cat: 'Titles & Openers', conf: 0.60, reason: 'Shaz variant' };
    if (duration && duration < 2.5 && thumbSize < 20000) return { cat: 'Transitions', conf: 0.55, reason: 'short + small thumb → transition' };
    return { cat: 'Titles & Openers', conf: 0.55, reason: 'Shaz default' };
  }
  if (oldCat === 'John Ventura') {
    if (/^A\d|^C\d|^D\d|^Pt|^Bridge/i.test(folderName)) return { cat: 'Titles & Openers', conf: 0.60, reason: 'JV letter-coded' };
    return { cat: 'Titles & Openers', conf: 0.45, reason: 'JV default' };
  }
  if (oldCat === 'Usama Ahmad') {
    return { cat: 'Pre-comps', conf: 0.90, reason: 'Usama linked comps' };
  }
  // Dominate Media number-only
  if (duration && duration < 2.0) return { cat: 'Transitions', conf: 0.50, reason: 'short duration' };
  if (duration && duration > 30) return { cat: 'Pre-comps', conf: 0.40, reason: 'long duration' };
  if (dims === '3840x2160') return { cat: 'Pre-comps', conf: 0.45, reason: '4K' };
  return { cat: 'Titles & Openers', conf: 0.35, reason: 'DM default' };
}

// Phase 3: refine by thumbnail size
function refineByThumbSize(primary, thumbSize, folderName, displayName) {
  if (!thumbSize || thumbSize <= 0) return primary;
  const combined = (displayName + ' ' + folderName).toLowerCase();

  // Tiny thumbs (<5KB) — simple UI elements, icons, shapes, or empty placeholder
  if (thumbSize < 5000 && primary === 'Titles & Openers') {
    if (/\b(icon|shape|circle|square|tool|badge)\b/i.test(combined)) return 'Icons & Shapes';
    if (/\b(bubble|speech|annotation|callout)\b/i.test(combined)) return 'Callouts';
    // Very tiny with no signals → likely simple title text, keep as Titles
  }

  // Huge thumbs (>400KB) — complex scenes
  if (thumbSize > 400000) {
    if (primary === 'Titles & Openers' && /\b(3d|model|depth|particle|gradient)\b/i.test(combined)) return '3D & Depth';
    if (primary === 'Titles & Openers' && /\b(particle|gradient|abstract|bg)\b/i.test(combined)) return 'Backgrounds';
  }

  return primary;
}

const BANNED = /elegant|dynamic|premium|seamless|stunning|amazing|incredible|professional\b|modern\b|creative\b|innovative|beautiful|gorgeous|sophisticated|ultimate\b|perfect|exceptional|outstanding|fantastic|awesome|epic|cinematic|breathtaking|mesmerizing|captivating|enchanting|dazzling|brilliant|sublime/gi;

function generateName(displayName, folderName, category) {
  let base = (displayName || '').toString();
  if (/^\d+$/.test(base.trim()) || base.trim().length < 3 || base.startsWith('#')) {
    base = folderName
      .replace(/_\d+$/, '')
      .replace(/_/g, ' ')
      .replace(/^\d+\s*/, '')
      .replace(/\bLinked Comp\b/i, 'Linked')
      .replace(/\bPre.?comp\b/gi, 'Build Block')
      .replace(/\bassemble_?/gi, '')
      .replace(/^_/, '')
      .trim();
  }
  base = base.replace(BANNED, '').replace(/\s+/g, ' ').trim();
  if (!base || base.length < 3) base = category.replace(/s$/, '') + ' Template';
  return base;
}

function toFolderName(name, uniqueId) {
  return name.replace(/\s+/g, '-').replace(/[\/\\?%*:|\"<>#]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') + '_' + uniqueId;
}

function findSecondary(primary, folderName, displayName, duration) {
  const combined = (displayName + ' ' + folderName).toLowerCase();
  const sec = [];
  const checks = [
    ['Titles & Openers', /\b(text|title|typo|headline|intro|credit)\b/i],
    ['Lower Thirds', /\b(lower|third|name.?bar|info.?bar|speaker)\b/i],
    ['Transitions', /\b(wipe|slide|zoom|fade|morph)\b/i],
    ['Call to Actions', /\b(button|subscribe|like|follow|cta|card)\b/i],
    ['3D & Depth', /\b(3d|model|depth|isometric|camera)\b/i],
    ['Pre-comps', /\b(linked|assemble|pre.?comp|nested)\b/i],
    ['Backgrounds', /\b(particle|gradient|abstract|bg|background)\b/i],
  ];
  for (const [cat, re] of checks) {
    if (cat !== primary && re.test(combined)) sec.push(cat);
  }
  return sec.slice(0, 2);
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  let templates, thumbSizes = {};

  const localArg = process.argv.indexOf('--local');
  if (localArg >= 0 && process.argv[localArg + 1]) {
    templates = JSON.parse(fs.readFileSync(process.argv[localArg + 1], 'utf8'));
  } else {
    console.error('Usage: node scripts/classify-templates.js --local <file> [--thumbs <file>]');
    process.exit(1);
  }

  const thumbsArg = process.argv.indexOf('--thumbs');
  if (thumbsArg >= 0 && process.argv[thumbsArg + 1]) {
    thumbSizes = JSON.parse(fs.readFileSync(process.argv[thumbsArg + 1], 'utf8'));
  }

  console.log('Auditing ' + templates.length + ' templates...\n');

  const plan = [];
  const stats = { total: templates.length, autoClassified: 0, needsReview: 0, byCategory: {}, byOldCategory: {} };

  for (const t of templates) {
    const folderName = t.folderName || '';
    const displayName = (t.displayName || '').toString();
    const oldCat = t.categoryName;
    const duration = parseFloat(t.duration) || 0;
    const width = t.width || 0;
    const height = t.height || 0;
    const oldPath = oldCat + '/' + folderName;
    const thumbSize = thumbSizes[oldPath] || 0;

    // Phase 1
    let match = null;
    for (const rule of FOLDER_RULES) {
      if (rule.pattern.test(folderName)) {
        match = { cat: rule.cat, conf: 0.85, reason: 'folder: ' + rule.pattern.toString().slice(1, 40) };
        break;
      }
    }

    // Phase 2
    if (!match) {
      const dims = width && height ? width + 'x' + height : null;
      match = classifyByEditor(oldCat, folderName, duration, dims, thumbSize);
    }

    // Phase 3
    let primaryCat = refineByThumbSize(match.cat, thumbSize, folderName, displayName);
    let confidence = match.conf;

    // Phase 3 adjustment: if thumbnail size signal changed category, lower confidence
    if (primaryCat !== match.cat) {
      confidence = Math.min(confidence, 0.55);
    }

    const humanName = generateName(displayName, folderName, primaryCat);
    const uniqueId = folderName.split('_').pop();
    const newFolderName = toFolderName(humanName, uniqueId);
    const secondary = findSecondary(primaryCat, folderName, displayName, duration);
    const categories = [primaryCat, ...secondary];
    const needsReview = confidence < 0.55;

    plan.push({
      oldPath,
      newPath: primaryCat + '/' + newFolderName,
      oldDisplayName: displayName,
      newDisplayName: humanName,
      oldFolderName: folderName,
      newFolderName,
      oldCategory: oldCat,
      categories,
      primaryCategory: primaryCat,
      confidence: Math.round(confidence * 100) / 100,
      needsReview,
      reason: match.reason,
      thumbSize,
      metadata: { width: width || null, height: height || null, duration: duration || null, frameRate: t.frameRate || null }
    });

    if (needsReview) stats.needsReview++;
    else stats.autoClassified++;
    if (!stats.byCategory[primaryCat]) stats.byCategory[primaryCat] = 0;
    stats.byCategory[primaryCat]++;
    if (!stats.byOldCategory[oldCat]) stats.byOldCategory[oldCat] = 0;
    stats.byOldCategory[oldCat]++;
  }

  plan.sort((a, b) => {
    if (a.primaryCategory !== b.primaryCategory) return a.primaryCategory.localeCompare(b.primaryCategory);
    return a.newDisplayName.localeCompare(b.newDisplayName);
  });

  const output = {
    plan,
    summary: {
      ...stats,
      autoPct: Math.round(stats.autoClassified / stats.total * 100),
      reviewPct: Math.round(stats.needsReview / stats.total * 100)
    },
    generatedAt: new Date().toISOString()
  };

  const outPath = path.join(__dirname, '..', 'classification-plan.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log('Wrote: ' + outPath);

  console.log('── Final Summary ──');
  console.log('Total:        ' + stats.total);
  console.log('Classified:   ' + stats.autoClassified + ' (' + output.summary.autoPct + '%)');
  console.log('Needs review: ' + stats.needsReview + ' (' + output.summary.reviewPct + '%)');
  console.log('\nBy category:');
  for (const [cat, count] of Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + cat + ': ' + count);
  }

  const reviewItems = plan.filter(e => e.needsReview);
  if (reviewItems.length > 0) {
    console.log('\n── Visual Review Required (' + reviewItems.length + ') ──');
    reviewItems.forEach(e => {
      console.log('  [' + e.oldCategory + '] "' + e.oldDisplayName + '" → ' + e.primaryCategory + ' (' + e.newDisplayName + ') conf=' + e.confidence);
    });
  }

  // Print full plan compact
  console.log('\n── Complete Plan ──');
  let lastCat = '';
  plan.forEach((e, i) => {
    if (e.primaryCategory !== lastCat) {
      console.log('\n=== ' + e.primaryCategory + ' ===');
      lastCat = e.primaryCategory;
    }
    const flag = e.needsReview ? ' [REVIEW]' : '';
    console.log('  ' + e.oldDisplayName.padEnd(25).slice(0,25) + ' → ' + e.newDisplayName.slice(0,40) + flag);
  });
}

main();
