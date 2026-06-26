#!/usr/bin/env node
/**
 * blitz-storage-optimize.mjs
 *
 * One-off remediation for the "extremely slow library" complaint. Operates
 * directly on the Supabase Storage bucket "blitzkrieg" so EXISTING installs
 * get faster immediately, with NO app update required (the panel loads each
 * thumbnail by its fixed path, so shrinking the stored bytes is transparent).
 *
 * It does two things, each gated by a flag:
 *
 *   --downscale   (default ON)  Resize oversized comp.png thumbnails. The grid
 *                 displays them at ~250px wide but they are stored full-res
 *                 (avg 430KB, up to 4.9MB) = ~158MB across 376 thumbnails.
 *                 Resized to maxWidth WebP they become ~25KB each (~12MB total).
 *   --previews    Also downscale the per-template hover-preview frames
 *                 (preview/frame_N.png) - 5170 frames, ~2.25GB -> ~150MB.
 *   --fix-names   Set a clean metadata.json displayName on the 4 visible
 *                 "Icons-and-Shapes" templates whose folder names are pure
 *                 timestamps. The panel treats those as "garbage names" and
 *                 wipes its entire metadata cache on every load (633 wipes in
 *                 21 days = repeated full 378-file rescans). A clean displayName
 *                 stops the wipe. See SLOW-DIAGNOSIS at the bottom of this file.
 *
 * SAFETY
 *   - DRY RUN BY DEFAULT. Nothing is written unless you pass --apply.
 *   - Backs up every original to __downscale_originals__/<path> before
 *     overwriting (idempotent; skipped with --no-backup). Delete that prefix
 *     later to reclaim space once you are satisfied.
 *   - Idempotent: a thumbnail already <= target width is skipped, so re-running
 *     is safe.
 *   - Only ever touches comp.png, preview/frame_*.png, and (with --fix-names)
 *     metadata.json. Never .aep, never deletes a template.
 *   - Per-file errors are logged and skipped; one bad file never aborts the run.
 *
 * USAGE
 *   export SUPABASE_URL=https://kwrmdxptrrvlqxdcasho.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # NOT the anon key
 *   npm i @supabase/supabase-js sharp                      # one-time
 *
 *   node scripts/blitz-storage-optimize.mjs                       # dry run, thumbnails
 *   node scripts/blitz-storage-optimize.mjs --apply               # do it
 *   node scripts/blitz-storage-optimize.mjs --previews --apply    # + preview frames
 *   node scripts/blitz-storage-optimize.mjs --fix-names --apply   # fix the 4 names
 *   node scripts/blitz-storage-optimize.mjs --limit 5             # test on 5 items
 *
 * FLAGS
 *   --apply               actually write (default: dry run)
 *   --previews            include preview/frame_*.png frames
 *   --no-downscale        skip image downscaling (e.g. run only --fix-names)
 *   --fix-names           fix the 4 garbage-named visible templates
 *   --no-backup           do not back up originals before overwriting
 *   --max-width N         target width in px (default 600 - retina-safe for a 300px card)
 *   --quality N           WebP quality 1-100 (default 80)
 *   --format webp|jpeg|png  output format (default webp - small + keeps alpha)
 *   --skip-below N         skip thumbnails already smaller than N bytes (default 60000)
 *   --concurrency N        parallel workers (default 8)
 *   --limit N              process at most N images (for testing)
 *   --category NAME        only this category
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const APPLY = has('--apply');
const DO_DOWNSCALE = !has('--no-downscale');
const DO_PREVIEWS = has('--previews');
const DO_FIX_NAMES = has('--fix-names');
const DO_BACKUP = !has('--no-backup');
const MAX_WIDTH = parseInt(val('--max-width', '600'), 10);
const QUALITY = parseInt(val('--quality', '80'), 10);
const FORMAT = val('--format', 'webp');
const SKIP_BELOW = parseInt(val('--skip-below', '60000'), 10);
const CONCURRENCY = parseInt(val('--concurrency', '8'), 10);
const LIMIT = parseInt(val('--limit', '0'), 10) || Infinity;
const ONLY_CATEGORY = val('--category', '');

const BUCKET = 'blitzkrieg';
const BACKUP_PREFIX = '__downscale_originals__';
const HIDDEN_CATEGORIES = { 'dominate media': 1, 'john ventura': 1, 'shaz': 1, 'usama ahmad': 1, 'sign': 1 };
// The exact 4 visible garbage-named templates (see SLOW-DIAGNOSIS). Clean
// displayName each so buildCompsFromMetadata stops wiping the cache.
const NAME_FIXES = [
  { path: 'Icons-and-Shapes/1-1768564455228_1768564455228', displayName: 'Icon 1' },
  { path: 'Icons-and-Shapes/3-1768565587833_1768565587833', displayName: 'Icon 3' },
  { path: 'Icons-and-Shapes/8-1768564511803_1768564511803', displayName: 'Icon 8' },
  { path: 'Icons-and-Shapes/13-1768564608227_1768564608227', displayName: 'Icon 13' },
];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('FATAL: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : (b / 1024).toFixed(0) + 'KB');
const log = (...a) => console.log(...a);

// ---- recursive listing ---------------------------------------------------
async function listFolder(prefix) {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, {
      limit: 1000, offset, sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error('list ' + prefix + ': ' + error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

// Collect every target image path (comp.png, and optionally preview frames).
async function collectImagePaths() {
  const root = await listFolder('');
  const categories = root.filter((it) =>
    it.id === null &&
    it.name !== 'pending' && it.name !== '.emptyFolderPlaceholder' && it.name[0] !== '_' &&
    !HIDDEN_CATEGORIES[it.name.toLowerCase()] &&
    (!ONLY_CATEGORY || it.name === ONLY_CATEGORY));

  const paths = [];
  for (const cat of categories) {
    const folders = (await listFolder(cat.name)).filter((it) => it.id === null);
    for (const folder of folders) {
      const base = cat.name + '/' + folder.name;
      paths.push(base + '/comp.png');
      if (DO_PREVIEWS) {
        const frames = (await listFolder(base + '/preview')).filter(
          (it) => it.id !== null && /\.png$/i.test(it.name));
        for (const fr of frames) paths.push(base + '/preview/' + fr.name);
      }
    }
  }
  return paths;
}

// ---- per-image processing ------------------------------------------------
const stats = { seen: 0, skipped: 0, resized: 0, errors: 0, before: 0, after: 0 };

async function processImage(path) {
  stats.seen++;
  try {
    const { data: blob, error } = await sb.storage.from(BUCKET).download(path);
    if (error || !blob) { log('  ! download failed:', path, error && error.message); stats.errors++; return; }
    const input = Buffer.from(await blob.arrayBuffer());
    const meta = await sharp(input).metadata().catch(() => null);
    if (!meta || !meta.width) { log('  ! not an image, skipping:', path); stats.errors++; return; }

    // Idempotent: skip a prior run's output (already the target format at/below
    // the target width) so re-runs never re-encode and accrue generation loss,
    // OR anything already small in any format.
    if ((meta.format === FORMAT && meta.width <= MAX_WIDTH) ||
        (meta.width <= MAX_WIDTH && input.length < SKIP_BELOW)) {
      stats.skipped++; return;
    }

    let pipeline = sharp(input).resize({ width: MAX_WIDTH, withoutEnlargement: true });
    if (FORMAT === 'webp') pipeline = pipeline.webp({ quality: QUALITY });
    else if (FORMAT === 'jpeg') pipeline = pipeline.jpeg({ quality: QUALITY });
    else pipeline = pipeline.png({ compressionLevel: 9, palette: true });
    const output = await pipeline.toBuffer();

    if (output.length >= input.length) { stats.skipped++; return; } // never grow a file

    stats.before += input.length; stats.after += output.length; stats.resized++;
    log('  ' + (APPLY ? 'resize' : 'would resize') + ' ' + path +
        '  ' + fmt(input.length) + ' -> ' + fmt(output.length) +
        ' (' + meta.width + 'px -> ' + Math.min(meta.width, MAX_WIDTH) + 'px)');

    if (!APPLY) return;

    if (DO_BACKUP) {
      const backupPath = BACKUP_PREFIX + '/' + path;
      const { error: cpErr } = await sb.storage.from(BUCKET).copy(path, backupPath);
      // "already exists" => a prior run backed it up; safe to proceed.
      if (cpErr && !/exist/i.test(cpErr.message || '')) {
        log('  ! backup failed, NOT overwriting:', path, cpErr.message); stats.errors++; return;
      }
    }
    const contentType = FORMAT === 'webp' ? 'image/webp' : FORMAT === 'jpeg' ? 'image/jpeg' : 'image/png';
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, output, { upsert: true, contentType });
    if (upErr) { log('  ! upload failed:', path, upErr.message); stats.errors++; }
  } catch (e) {
    log('  ! error:', path, e && e.message); stats.errors++;
  }
}

async function runPool(items, worker) {
  let idx = 0;
  const next = async () => { while (idx < items.length) { const i = idx++; await worker(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
}

// ---- name fix ------------------------------------------------------------
async function fixNames() {
  log('\n=== FIX NAMES (' + (APPLY ? 'APPLY' : 'dry run') + ') ===');
  for (const fix of NAME_FIXES) {
    const metaPath = fix.path + '/metadata.json';
    try {
      const { data: blob, error } = await sb.storage.from(BUCKET).download(metaPath);
      if (error || !blob) { log('  ! cannot read', metaPath, error && error.message); continue; }
      const meta = JSON.parse(Buffer.from(await blob.arrayBuffer()).toString('utf8'));
      const before = meta.displayName || meta.name || '(none)';
      if (meta.displayName === fix.displayName) { log('  = already "' + fix.displayName + '":', fix.path); continue; }
      meta.displayName = fix.displayName;
      log('  ' + (APPLY ? 'set' : 'would set') + ' displayName "' + before + '" -> "' + fix.displayName + '"  (' + fix.path + ')');
      if (!APPLY) continue;
      const body = Buffer.from(JSON.stringify(meta));
      const { error: upErr } = await sb.storage.from(BUCKET).upload(metaPath, body, { upsert: true, contentType: 'application/json' });
      if (upErr) log('  ! write failed:', metaPath, upErr.message);
    } catch (e) { log('  ! error:', metaPath, e && e.message); }
  }
}

// ---- main ----------------------------------------------------------------
(async () => {
  log('blitz-storage-optimize  bucket=' + BUCKET + '  mode=' + (APPLY ? 'APPLY' : 'DRY-RUN'));
  log('  downscale=' + DO_DOWNSCALE + ' previews=' + DO_PREVIEWS + ' fixNames=' + DO_FIX_NAMES +
      ' format=' + FORMAT + ' maxWidth=' + MAX_WIDTH + ' quality=' + QUALITY + ' backup=' + DO_BACKUP);

  if (DO_DOWNSCALE) {
    log('\n=== DOWNSCALE (' + (APPLY ? 'APPLY' : 'dry run') + ') ===');
    log('discovering images...');
    let paths = await collectImagePaths();
    if (paths.length > LIMIT) paths = paths.slice(0, LIMIT);
    log('found ' + paths.length + ' candidate image(s)');
    await runPool(paths, processImage);
    log('\n--- downscale summary ---');
    log('  seen=' + stats.seen + ' resized=' + stats.resized + ' skipped(already small)=' + stats.skipped + ' errors=' + stats.errors);
    log('  bytes: ' + fmt(stats.before) + ' -> ' + fmt(stats.after) +
        (stats.before ? '  (saved ' + fmt(stats.before - stats.after) + ', ' +
        Math.round((1 - stats.after / stats.before) * 100) + '%)' : ''));
  }

  if (DO_FIX_NAMES) await fixNames();

  if (!APPLY) log('\nDRY RUN - nothing was written. Re-run with --apply to commit.');
  log('done.');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

/*
 * SLOW-DIAGNOSIS (2026-06-24, evidence from production project kwrmdxptrrvlqxdcasho)
 * --------------------------------------------------------------------------------
 * Complaint: "library is extremely slow". Measured causes:
 *  1. Thumbnail bloat: 376 comp.png avg 430KB (max 4.9MB) = 158MB; 5170 preview
 *     frames avg 446KB = 2.25GB. All served full-res into a ~250px grid. THIS is
 *     the dominant cost. Fix: this script (downscale in place, no app update).
 *  2. Cache thrash: 4 VISIBLE templates in "Icons-and-Shapes" have folder names
 *     that are <n>-<timestamp>_<timestamp>, so deriveDisplayName yields a name
 *     containing a 10+ digit run -> "garbage" -> buildCompsFromMetadata calls
 *     clearLocalCache() on EVERY load (633 wipes/21d), forcing full rescans.
 *     Fix: --fix-names here (server-side) + the client guard in cloud-library.js.
 *  3. Auto-update broken: "cannot resolve extension root" (installUpdate) - users
 *     stuck on old builds. Fixed in the panel (window.location root fallback).
 *     That fix needs a release; this script's storage changes do NOT.
 */
