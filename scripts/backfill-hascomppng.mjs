#!/usr/bin/env node
/**
 * backfill-hascomppng.mjs
 *
 * Retroactive half of the "scattered junk / missing thumbnails" fix. The panel
 * reader (cloud-library.js buildCompsFromMetadata) decides a template's
 * thumbnail is "verified" from metadata.json flags only:
 *
 *     thumbnailVerified = !!(meta.hasCompPng || meta.cloudThumbnailGenerated || previewFrameCount > 0)
 *
 * It never lists a folder's children (that would cost one request per folder and
 * re-introduce the cold-load storm), so a bulk-imported template that has a real
 * comp.png but never went through the in-panel generate flow (no
 * cloudThumbnailGenerated, no preview frames) was mislabeled "missing thumbnail":
 * inflated admin count, a phantom Generate button, and a skipped local disk cache.
 *
 * New uploads now write metadata.hasCompPng at stash time. This one-off script
 * backfills the flag onto EXISTING folders that already have a comp.png, so the
 * library reads healthy without any per-folder list on the hot path.
 *
 * It ALSO backfills metadata.hasAep = false onto folders that have a metadata.json
 * but NO .aep in storage. Those are "needs repair" crash tiles: the panel renders
 * them as normal Import cards, but importing throws "No .aep file found". The reader
 * gates any hasAep:false tile into a disabled "Needs repair" state so it can no
 * longer be clicked into a failed import. hasAep is NEVER written true here (the
 * reader defaults an absent flag to true, so only the missing-.aep tiles need one).
 *
 * SAFETY
 *   - DRY RUN BY DEFAULT. Nothing is written unless you pass --apply.
 *   - ONLY ADDS `hasCompPng: true` (folders with a comp.png) and `hasAep: false`
 *     (folders with metadata but no .aep) to metadata.json. Every other field is
 *     preserved verbatim.
 *   - Never touches .aep, footage, thumbnails, or preview frames. Never deletes
 *     template data (only regenerable root manifest cache files on --apply).
 *   - Idempotent: a folder already carrying the flag it needs is skipped, so
 *     re-running is safe.
 *   - Per-folder errors are logged and skipped; one bad folder never aborts.
 *
 * USAGE
 *   export SUPABASE_URL=https://kwrmdxptrrvlqxdcasho.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # NOT the anon key
 *   npm i @supabase/supabase-js                            # one-time (in a dir with node_modules)
 *
 *   node scripts/backfill-hascomppng.mjs                   # dry run - report only
 *   node scripts/backfill-hascomppng.mjs --apply           # write the flag
 *   node scripts/backfill-hascomppng.mjs --category Backgrounds --limit 5   # test a slice
 *
 * FLAGS
 *   --apply           actually write (default: dry run)
 *   --category NAME   only this category
 *   --limit N         process at most N comp folders (for testing)
 *   --concurrency N   parallel workers (default 8)
 *
 * After --apply, the panel corrects itself on the next library load (the flag is
 * read from metadata.json). No app update or migration required.
 */

import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const APPLY = has('--apply');
const ONLY_CATEGORY = val('--category', '');
const LIMIT = parseInt(val('--limit', '0'), 10) || Infinity;
const CONCURRENCY = parseInt(val('--concurrency', '8'), 10);

const BUCKET = 'blitzkrieg';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('FATAL: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const log = (...a) => console.log(...a);

// ---- paginated listing (Supabase caps a list() page at 1000) --------------
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

// A storage.list() entry is a FOLDER when it has no id (no object row).
const isFolder = (it) => it && it.id === null;
const isFile = (it) => it && it.id !== null;

async function collectCompFolders() {
  const root = await listFolder('');
  const categories = root.filter((it) =>
    isFolder(it) &&
    it.name !== 'pending' &&
    it.name !== '.emptyFolderPlaceholder' &&
    it.name[0] !== '_' &&
    (!ONLY_CATEGORY || it.name === ONLY_CATEGORY));

  const folders = [];
  for (const cat of categories) {
    const children = (await listFolder(cat.name)).filter(isFolder);
    for (const child of children) folders.push(cat.name + '/' + child.name);
    if (folders.length >= LIMIT) break;
  }
  return folders.slice(0, LIMIT === Infinity ? folders.length : LIMIT);
}

const stats = {
  folders: 0, alreadyFlagged: 0, patched: 0, wouldPatch: 0,
  noMetadata: 0, errors: 0,
  wouldCompPng: 0, wouldAep: 0, compPngWrites: 0, aepFalseWrites: 0,
};

// A folder has an .aep when it contains any *.aep file (case-insensitive), skipping
// macOS resource forks (._name). Mirrors the panel's robustFindAep detection.
function isAepFile(name) {
  if (!name) return false;
  if (name.indexOf('._') === 0) return false;
  return /\.aep$/i.test(name);
}

async function processFolder(base) {
  stats.folders++;
  try {
    const files = await listFolder(base);
    const hasCompPng = files.some((it) => isFile(it) && it.name === 'comp.png');
    const hasAep = files.some((it) => isFile(it) && isAepFile(it.name));
    const hasMeta = files.some((it) => isFile(it) && it.name === 'metadata.json');

    // A flag can only be written into an existing metadata.json. NOTE: we no longer
    // early-return on "no comp.png" - a comp.png-LESS folder that also has no .aep is
    // exactly a "needs repair" crash tile we must flag hasAep:false (6 of the 9 live
    // crash tiles have no comp.png, so the old `if (!hasCompPng) return` silently
    // skipped them).
    if (!hasMeta) {
      if (hasCompPng) {
        stats.noMetadata++;
        log('  ! comp.png present but NO metadata.json (skipped, needs separate handling): ' + base);
      }
      // no metadata + no comp.png: nothing flaggable here; ignore quietly.
      return;
    }

    const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(base + '/metadata.json');
    if (dlErr || !blob) { stats.errors++; log('  ! metadata download failed: ' + base + ' - ' + (dlErr && dlErr.message)); return; }

    let meta;
    try { meta = JSON.parse(await blob.text()); }
    catch (e) { stats.errors++; log('  ! metadata.json unparseable (skipped): ' + base); return; }
    if (!meta || typeof meta !== 'object') { stats.errors++; log('  ! metadata.json not an object (skipped): ' + base); return; }

    // Two independent, idempotent flags:
    //   hasCompPng:true  when a comp.png exists but the flag is not yet set
    //   hasAep:false     when NO .aep exists and the folder is not yet gated
    // We never write hasAep:true - the panel reader defaults an absent hasAep to true,
    // so only the missing-.aep "needs repair" tiles need an explicit flag (writing
    // true onto ~370 healthy folders would be needless churn).
    const needCompPng = hasCompPng && meta.hasCompPng !== true;
    const needAepFalse = !hasAep && meta.hasAep !== false;

    if (!needCompPng && !needAepFalse) {
      if (meta.hasCompPng === true || meta.hasAep === false) stats.alreadyFlagged++;
      return;
    }

    if (!APPLY) {
      stats.wouldPatch++;
      if (needCompPng) stats.wouldCompPng++;
      if (needAepFalse) stats.wouldAep++;
      log('  would flag [' + (needCompPng ? 'hasCompPng ' : '') + (needAepFalse ? 'hasAep:false(needs-repair) ' : '') + ']: ' + base);
      return;
    }

    if (needCompPng) meta.hasCompPng = true;
    if (needAepFalse) meta.hasAep = false;
    const body = new Blob([JSON.stringify(meta)], { type: 'application/json' });
    const { error: upErr } = await sb.storage.from(BUCKET).upload(base + '/metadata.json', body, {
      contentType: 'application/json', upsert: true,
    });
    if (upErr) { stats.errors++; log('  ! metadata upload failed: ' + base + ' - ' + upErr.message); return; }
    stats.patched++;
    if (needCompPng) stats.compPngWrites++;
    if (needAepFalse) stats.aepFalseWrites++;
    log('  flagged [' + (needCompPng ? 'hasCompPng ' : '') + (needAepFalse ? 'hasAep:false ' : '') + ']: ' + base);
  } catch (e) {
    stats.errors++;
    log('  ! error on ' + base + ': ' + (e && e.message || e));
  }
}

// ---- bounded-concurrency runner ------------------------------------------
async function run() {
  log((APPLY ? 'APPLY' : 'DRY RUN') + ' - backfilling metadata.hasCompPng + hasAep on bucket "' + BUCKET + '"');
  const folders = await collectCompFolders();
  log('Found ' + folders.length + ' comp folder(s)' + (ONLY_CATEGORY ? ' in ' + ONLY_CATEGORY : '') + '. Scanning...\n');

  let idx = 0;
  async function worker() {
    while (idx < folders.length) {
      const myIdx = idx++;
      await processFolder(folders[myIdx]);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(CONCURRENCY, folders.length); w++) workers.push(worker());
  await Promise.all(workers);

  // The panel prefers the aggregated root manifest on cold load; the per-folder
  // metadata.json we just patched is only re-read when the manifest is missing or
  // stale (up to 1h TTL). Remove the manifest(s) so the next library load rebuilds
  // FROM the backfilled metadata and the corrected counts appear immediately. These
  // are regenerable cache files (rebuilt by the panel's uploadManifest), NEVER
  // template data - nothing is lost.
  if (APPLY && stats.patched > 0) {
    const manifests = ['_blitzkrieg_manifest_v2.json', '_blitzkrieg_manifest.json'];
    // Also sweep any stale backup manifests (_blitzkrieg_manifest_v2_backup_*.json).
    // These are regenerable cache files, never template data; leaving one behind can
    // let a cold-load rescue path resurface pre-backfill flags.
    try {
      const rootItems = await listFolder('');
      for (const it of rootItems) {
        if (isFile(it) && /^_blitzkrieg_manifest_v2_backup_.*\.json$/.test(it.name)) manifests.push(it.name);
      }
    } catch (e) { log('  ! could not list root for backup-manifest sweep: ' + (e && e.message)); }
    const { error: rmErr } = await sb.storage.from(BUCKET).remove(manifests);
    if (rmErr) log('\n! could not remove manifest(s) (they will still rebuild on the 1h TTL): ' + rmErr.message);
    else log('\nRemoved ' + manifests.length + ' manifest file(s) (active + legacy + stale backups); next library load rebuilds from the backfilled metadata.');
  }

  log('\n---- summary ----');
  log('  comp folders scanned : ' + stats.folders);
  log('  already flagged      : ' + stats.alreadyFlagged);
  if (APPLY) {
    log('  folders written      : ' + stats.patched);
    log('    hasCompPng:true    : ' + stats.compPngWrites);
    log('    hasAep:false       : ' + stats.aepFalseWrites + '   (these become "needs repair" tiles - re-upload the .aep)');
  } else {
    log('  folders would write  : ' + stats.wouldPatch);
    log('    hasCompPng:true    : ' + stats.wouldCompPng);
    log('    hasAep:false       : ' + stats.wouldAep + '   (these will become "needs repair" tiles - re-upload the .aep)');
  }
  log('  comp.png, no metadata: ' + stats.noMetadata + '   (needs separate handling - not touched)');
  log('  errors               : ' + stats.errors);
  if (!APPLY) log('\nDRY RUN - nothing written. Re-run with --apply to write the flags.');
}

run().catch((e) => { console.error('FATAL:', e && e.message || e); process.exit(1); });
