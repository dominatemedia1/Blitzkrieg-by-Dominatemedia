#!/usr/bin/env node
/**
 * fix-classifications.js — Cross-reference visual classifications with
 * folder-name signals, duration, dimensions. Fix Pre-comp over-count,
 * surface hidden Transitions, apply domain heuristics.
 */
'use strict';

const fs = require('fs');

// ── 12 Categories ──────────────────────────────────────────────────────
const CATS = [
  'Titles & Openers', 'Lower Thirds', 'Backgrounds', 'Transitions',
  'Call to Actions', 'Icons & Shapes', 'Callouts', 'Infographics',
  'Process & Steps', '3D & Depth', 'Overlays & FX', 'Pre-comps'
];

// ── Folder-name rules → category (high confidence) ────────────────────
const FOLDER_TO_CAT = [
  { re: /linked.?comp|assemble|pre.?comp|Pre_comp|client_|freelancer_|clinets_|pic.?montage|Video_\d|video_Linked|^Edit.?pr|^Pr.?edit/i, cat: 'Pre-comps' },
  { re: /^3d|_3d|3d_|model|isometric|camera|depth/i, cat: '3D & Depth' },
  { re: /step|process|timeline|flow|sequence/i, cat: 'Process & Steps' },
  { re: /black.?bg|^bg_|_bg$|background|gradient|particle|loop/i, cat: 'Backgrounds' },
  { re: /transition|wipe|morph/i, cat: 'Transitions' },
  { re: /^graph_|chart|stats|meter|counter|percent|data|human.?body|^Map_/i, cat: 'Infographics' },
  { re: /^card_|cta|button|subscribe|like_button|follow|end.?screen|arrow/i, cat: 'Call to Actions' },
  { re: /icon|^shape_|tool_|circle|square_d|badge|divider/i, cat: 'Icons & Shapes' },
  { re: /callout|bubble|speech|annotation|highlight|tooltip|sticker/i, cat: 'Callouts' },
  { re: /lower.?third|name.?bar|info.?bar|name.?super/i, cat: 'Lower Thirds' },
  { re: /grain|dust|scratch|vhs|light.?leak|film.?burn|glitch|overlay/i, cat: 'Overlays & FX' },
  { re: /title|typo|headline|intro|opener|kinetic|credit|^text$|text_/i, cat: 'Titles & Openers' },
  { re: /^zero_/i, cat: 'Backgrounds' },
  { re: /^P1$|^b1$/i, cat: 'Titles & Openers' },
];

// ── Shaz _N series → these are element/transition packs ────────────────
// Templates like _1, _2, _10 — short elements used inside other comps
const SHAZ_UNDERSCORE_N = /^_\d+_/;

// Shaz N_ series (different) — full templates named by number
const SHAZ_NUM_PREFIX = /^\d+_/;

// ── Helpers ─────────────────────────────────────────────────────────────

function classifyByFolderName(folderName, visualCat, visualDesc) {
  for (const rule of FOLDER_TO_CAT) {
    if (rule.re.test(folderName)) return rule.cat;
  }
  return null;
}

function isTinyElement(visualDesc) {
  if (!visualDesc) return false;
  const desc = visualDesc.toLowerCase();
  return /\btiny\b|\bsingle\s*(pixel|dot|spot|mark)\b|\bminuscule\b|\bextremely\s*minimal\b|\bbarely\s*visible\b|\balmost\s*(entirely|all)\s*(dark|black|transparent)/.test(desc);
}

function hasTextContent(visualDesc) {
  if (!visualDesc) return false;
  const desc = visualDesc.toLowerCase();
  return /\b(text|title|headline|word|letter|character|readable|typography|font)\b/.test(desc);
}

function isProgressOrBar(visualDesc) {
  if (!visualDesc) return false;
  const desc = visualDesc.toLowerCase();
  return /\b(progress\s*bar|horizontal\s*bar|loading|slider|meter|timeline)\b/.test(desc);
}

function isButtonOrCTA(visualDesc) {
  if (!visualDesc) return false;
  const desc = visualDesc.toLowerCase();
  return /\b(button|subscribe|like\s*button|follow|cta|end\s*screen|pill.?shaped|red\s*(bar|rectangle|pill))\b/.test(desc);
}

function is3DObject(visualDesc) {
  if (!visualDesc) return false;
  const desc = visualDesc.toLowerCase();
  return /\b(3d|metallic|shaded|wireframe|isometric|depth\s*effect|camera\s*rig)\b/.test(desc);
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  const planPath = process.argv[2] || 'classification-plan.json';
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

  let changes = 0;
  const catsBefore = {};
  const catsAfter = {};

  for (const e of plan.plan) {
    catsBefore[e.primaryCategory] = (catsBefore[e.primaryCategory] || 0) + 1;
    catsAfter[e.primaryCategory] = (catsAfter[e.primaryCategory] || 0) + 1;
  }

  for (const e of plan.plan) {
    const fn = e.oldFolderName || '';
    const visualCat = e.primaryCategory;
    const visualDesc = e.reason || '';
    const dur = (e.metadata && e.metadata.duration) || 0;
    const w = (e.metadata && e.metadata.width) || 0;
    const h = (e.metadata && e.metadata.height) || 0;
    const is4K = w === 3840 && h === 2160;
    const isShazUnderscore = SHAZ_UNDERSCORE_N.test(fn);
    const isShazNumPrefix = SHAZ_NUM_PREFIX.test(fn);

    let newCat = visualCat;
    let newConf = e.confidence;
    let reason = e.reason;

    // Rule 1: Folder-name match ALWAYS wins
    const folderCat = classifyByFolderName(fn, visualCat, visualDesc);
    if (folderCat && folderCat !== visualCat && e.confidence < 0.85) {
      catsAfter[visualCat]--;
      catsAfter[folderCat] = (catsAfter[folderCat] || 0) + 1;
      newCat = folderCat;
      newConf = Math.max(newConf, 0.8);
      reason = 'folder-name rule: ' + fn + ' → ' + folderCat;
      changes++;
    }

    // Rule 2: Missing/corrupted thumbnail → folder name rules
    if ((visualCat === 'Pre-comps' && newConf === 0) || (visualDesc && visualDesc.includes('missing'))) {
      if (folderCat) {
        catsAfter[visualCat]--;
        catsAfter[folderCat] = (catsAfter[folderCat] || 0) + 1;
        newCat = folderCat;
        newConf = 0.6;
        reason = 'missing thumb, folder rule → ' + folderCat;
        changes++;
      } else if (isShazUnderscore) {
        catsAfter[visualCat]--;
        catsAfter['Overlays & FX'] = (catsAfter['Overlays & FX'] || 0) + 1;
        newCat = 'Overlays & FX';
        newConf = 0.5;
        reason = 'Shaz _N pack → Overlays & FX';
        changes++;
      }
    }

    // Rule 3: Tiny element + no folder signal + not Icons → Transition or Overlay
    if (isTinyElement(visualDesc) && !folderCat && visualCat === 'Icons & Shapes' && newConf < 0.6) {
      catsAfter[visualCat]--;
      if (isShazUnderscore || dur < 2.0) {
        catsAfter['Transitions'] = (catsAfter['Transitions'] || 0) + 1;
        newCat = 'Transitions';
        newConf = 0.55;
        reason = 'tiny element + short → Transition';
      } else {
        catsAfter['Overlays & FX'] = (catsAfter['Overlays & FX'] || 0) + 1;
        newCat = 'Overlays & FX';
        newConf = 0.5;
        reason = 'tiny element → Overlay';
      }
      changes++;
    }

    // Rule 4: Progress bar → Process & Steps
    if (isProgressOrBar(visualDesc) && visualCat !== 'Process & Steps' && visualCat !== 'Infographics') {
      catsAfter[visualCat]--;
      catsAfter['Process & Steps'] = (catsAfter['Process & Steps'] || 0) + 1;
      newCat = 'Process & Steps';
      newConf = Math.max(newConf, 0.7);
      reason = 'progress bar detected → Process & Steps';
      changes++;
    }

    // Rule 5: Button/CTA visual → Call to Actions
    if (isButtonOrCTA(visualDesc) && visualCat !== 'Call to Actions' && !folderCat) {
      catsAfter[visualCat]--;
      catsAfter['Call to Actions'] = (catsAfter['Call to Actions'] || 0) + 1;
      newCat = 'Call to Actions';
      newConf = Math.max(newConf, 0.75);
      reason = 'button/CTA detected → Call to Actions';
      changes++;
    }

    // Rule 6: 3D visual → 3D & Depth
    if (is3DObject(visualDesc) && visualCat !== '3D & Depth' && !folderCat) {
      catsAfter[visualCat]--;
      catsAfter['3D & Depth'] = (catsAfter['3D & Depth'] || 0) + 1;
      newCat = '3D & Depth';
      newConf = Math.max(newConf, 0.75);
      reason = '3D render detected → 3D & Depth';
      changes++;
    }

    // Rule 7: 4K + long duration (>15s) + Pre-comps visual → keep Pre-comps
    // But 4K + short + Backgrounds visual → could be background loop
    if (is4K && dur > 30 && visualCat === 'Titles & Openers' && !folderCat) {
      catsAfter[visualCat]--;
      catsAfter['Pre-comps'] = (catsAfter['Pre-comps'] || 0) + 1;
      newCat = 'Pre-comps';
      newConf = 0.7;
      reason = '4K + long duration → Pre-comps';
      changes++;
    }

    // Rule 8: Has text AND is Titles → verify, if visual says Icons but has text → Titles
    if (hasTextContent(visualDesc) && visualCat === 'Icons & Shapes' && !folderCat) {
      catsAfter[visualCat]--;
      catsAfter['Titles & Openers'] = (catsAfter['Titles & Openers'] || 0) + 1;
      newCat = 'Titles & Openers';
      newConf = 0.65;
      reason = 'text content detected → Titles & Openers';
      changes++;
    }

    // Apply changes
    catsAfter[visualCat] = catsAfter[visualCat] || 0;
    e.primaryCategory = newCat;
    e.confidence = Math.round(newConf * 100) / 100;
    e.needsReview = e.confidence < 0.55;
    if (reason !== e.reason) e.reason = reason;

    // Update newPath
    const uniqueId = e.oldFolderName.split('_').pop();
    e.newPath = newCat + '/' + e.newFolderName;

    // Update categories array
    const sec = (e.categories || []).filter(c => c !== newCat);
    e.categories = [newCat, ...sec].slice(0, 3);
  }

  // Recompute stats
  const stats = { total: plan.plan.length, autoClassified: 0, needsReview: 0, byCategory: {} };
  for (const e of plan.plan) {
    if (e.needsReview) stats.needsReview++;
    else stats.autoClassified++;
    stats.byCategory[e.primaryCategory] = (stats.byCategory[e.primaryCategory] || 0) + 1;
  }

  plan.summary = {
    ...stats,
    autoPct: Math.round(stats.autoClassified / stats.total * 100),
    reviewPct: Math.round(stats.needsReview / stats.total * 100)
  };
  plan.generatedAt = new Date().toISOString();

  // Sort
  plan.plan.sort((a, b) => {
    if (a.primaryCategory !== b.primaryCategory) return a.primaryCategory.localeCompare(b.primaryCategory);
    return a.newDisplayName.localeCompare(b.newDisplayName);
  });

  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(`Fixed ${changes} classifications. Wrote ${planPath}`);
  console.log(`\nBefore → After:`);
  for (const cat of CATS) {
    const before = catsBefore[cat] || 0;
    const after = catsAfter[cat] || 0;
    if (before !== after) {
      const diff = after - before;
      const sign = diff > 0 ? '+' : '';
      console.log(`  ${cat}: ${before} → ${after} (${sign}${diff})`);
    }
  }
  console.log(`\nFinal distribution:`);
  for (const [cat, count] of Object.entries(catsAfter).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }
}

main();
