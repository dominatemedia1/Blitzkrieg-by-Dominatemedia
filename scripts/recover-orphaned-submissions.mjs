#!/usr/bin/env node
/**
 * recover-orphaned-submissions.mjs
 *
 * Retroactive half of the "I uploaded a comp but it's not showing, no crash"
 * data-loss fix (complaint 3). Before the insert-first change, executeAddComp
 * uploaded the .aep / comp.png / frames FIRST and wrote metadata.json LAST. If AE
 * crashed or the network dropped mid-upload, storage kept a partial folder under
 * pending/{userId}/{folderName}/ with NO metadata.json and NO submission row -
 * invisible to the editor (root pending/ is excluded from the grid) and to admins
 * (no blitzkrieg_template_submissions row). The editor's work looked lost.
 *
 * This script reconciles those orphans back into the visible pending queue:
 *
 *   1. Walks pending/{userId}/ folders in storage.
 *   2. For any folder that has a real .aep but NO metadata.json (an interrupted
 *      upload), it RECONSTRUCTS metadata.json from what actually landed on disk:
 *        - width/height parsed from comp.png's IHDR chunk (no AE needed),
 *        - previewFrames counted from preview/frame_*.png,
 *        - bundleAssetCount counted from the collected bundle files,
 *        - hasCompPng / hasAep set to the real storage truth,
 *        - displayName / category / submitterName taken from the submission row
 *          if one exists, else derived from the folder name / team_members.
 *   3. Ensures a blitzkrieg_template_submissions row (status='pending') exists for
 *      the folder so it shows under Submissions > Pending. Idempotent: an existing
 *      row (matched by storage_path) is reused, never duplicated.
 *
 * The complementary forward fix (js/main.js executeAddComp) now INSERTS the row
 * BEFORE any upload, so new interrupted uploads are already visible; this script
 * is only for folders orphaned by the OLD build.
 *
 * SAFETY
 *   - DRY RUN BY DEFAULT. Nothing is written unless you pass --apply.
 *   - ONLY writes a reconstructed metadata.json into a folder that has NONE, and
 *     INSERTS a missing submission row. Never overwrites an existing metadata.json,
 *     never touches .aep / footage / comp.png / frames, never deletes anything,
 *     never approves (approval stays a human action in the panel).
 *   - Idempotent: a folder that already has metadata.json AND a row is skipped, so
 *     re-running is safe.
 *   - Per-folder errors are logged and skipped; one bad folder never aborts.
 *
 * USAGE
 *   export SUPABASE_URL=https://kwrmdxptrrvlqxdcasho.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # NOT the anon key
 *   npm i @supabase/supabase-js                            # one-time (in a dir with node_modules)
 *
 *   node scripts/recover-orphaned-submissions.mjs                    # dry run - report only
 *   node scripts/recover-orphaned-submissions.mjs --apply            # reconstruct + insert
 *   node scripts/recover-orphaned-submissions.mjs --user 62d19d6f... # only this editor's pending/
 *   node scripts/recover-orphaned-submissions.mjs --default-category Titles-and-Openers
 *
 * FLAGS
 *   --apply                actually write (default: dry run)
 *   --user UID             only pending/{UID}/ (default: every editor)
 *   --default-category C   category for a folder with no submission row (default: Uncategorized)
 *   --limit N              process at most N folders (for testing)
 *   --concurrency N        parallel workers (default 6)
 *
 * After --apply, the editor sees the recovered submission under Submissions >
 * Pending on the next panel load. No app update or migration required.
 */

import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const APPLY = has('--apply');
const ONLY_USER = val('--user', '');
const DEFAULT_CATEGORY = val('--default-category', 'Uncategorized');
const LIMIT = parseInt(val('--limit', '0'), 10) || Infinity;
const CONCURRENCY = parseInt(val('--concurrency', '6'), 10);

const BUCKET = 'blitzkrieg';
const SUBMISSIONS = 'blitzkrieg_template_submissions';

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

// Mirror the panel's robustFindAep detection: any *.aep, skipping macOS
// resource forks (._name).
function isAepFile(name) {
  if (!name) return false;
  if (name.indexOf('._') === 0) return false;
  return /\.aep$/i.test(name);
}

// A support file is anything the reader/approve flow treats as scaffolding rather
// than a collected bundle asset. Used to count the TRUE bundle asset total.
function isSupportFile(name) {
  const lower = String(name || '').toLowerCase();
  if (!lower || lower === '.ds_store' || lower === '.emptyfolderplaceholder') return true;
  if (lower === 'metadata.json' || lower === 'comp.png') return true;
  if (isAepFile(name)) return true;
  return false;
}

// Parse a PNG's IHDR for pixel width/height WITHOUT decoding the image. The IHDR
// chunk is always first: 8-byte signature, 4-byte length, "IHDR", then width and
// height as big-endian uint32 at byte offsets 16 and 20. Returns null if the blob
// is not a PNG (so we simply omit width/height rather than write garbage).
async function readPngSize(blob) {
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf.length < 24) return null;
    // PNG signature: 137 80 78 71 13 10 26 10
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (!width || !height || width > 100000 || height > 100000) return null;
    return { width, height };
  } catch (e) {
    return null;
  }
}

// Derive a human display name from a stash folder name. Folder names look like
// "Typography_and_animation_1782983376557" - strip the trailing epoch-ish suffix
// and turn separators into spaces. Mirrors the light cleanup executeAddComp does.
function displayNameFromFolder(folder) {
  let name = String(folder || '')
    .replace(/[_-]\d{10,}$/g, '')
    .replace(/[_-]+$/, '')
    .replace(/[_-]/g, ' ')
    .trim();
  if (name.length > 255) name = name.substring(0, 255);
  return name || folder;
}

const stats = {
  usersScanned: 0, foldersScanned: 0,
  complete: 0, notRecoverable: 0,
  metaWritten: 0, metaWouldWrite: 0,
  rowInserted: 0, rowWouldInsert: 0, rowReused: 0,
  errors: 0,
};

// Cache: user_id -> team_members row (id, full_name) so we do not re-query per folder.
const teamMemberCache = new Map();
async function resolveTeamMember(userId) {
  if (teamMemberCache.has(userId)) return teamMemberCache.get(userId);
  let tm = null;
  try {
    const { data, error } = await sb
      .from('team_members')
      .select('id, full_name')
      .eq('user_id', userId)
      .maybeSingle();
    if (!error && data) tm = data;
  } catch (e) { /* leave null - row insert tolerates a null team_member_id */ }
  teamMemberCache.set(userId, tm);
  return tm;
}

async function processFolder(userId, folder) {
  stats.foldersScanned++;
  const base = 'pending/' + userId + '/' + folder;
  try {
    const files = await listFolder(base);
    const hasAep = files.some((it) => isFile(it) && isAepFile(it.name));
    const hasCompPng = files.some((it) => isFile(it) && it.name === 'comp.png');
    const hasMeta = files.some((it) => isFile(it) && it.name === 'metadata.json');

    // Count preview frames (preview/ is a subfolder, listed separately).
    let previewFrameCount = 0;
    if (files.some((it) => isFolder(it) && it.name === 'preview')) {
      try {
        const pv = await listFolder(base + '/preview');
        previewFrameCount = pv.filter((it) => isFile(it) && /^frame_\d+\.png$/i.test(it.name)).length;
      } catch (e) { /* preview unreadable: leave 0 */ }
    }
    // Bundle asset count = top-level files that are not scaffolding.
    const bundleAssetCount = files.filter((it) => isFile(it) && !isSupportFile(it.name)).length;

    // Look up an existing submission row for this exact storage_path.
    let row = null;
    try {
      const { data } = await sb.from(SUBMISSIONS).select('id, template_name, category, metadata, status').eq('storage_path', base).maybeSingle();
      row = data || null;
    } catch (e) { /* treat as no row */ }

    // A folder with metadata.json AND a row is already whole - nothing to do.
    if (hasMeta && row) { stats.complete++; return; }

    // A row that already went through review (approved/rejected) is NOT a lost
    // submit to recover, even if its leftover pending/ copy is missing metadata.
    // Touching it would rewrite an already-decided item. Leave it alone.
    if (row && row.status && row.status !== 'pending') { stats.complete++; return; }

    // Only .aep-bearing folders are real interrupted submits worth recovering. A
    // folder with no .aep is not a lost composition (it may be a stray comp.png or
    // an empty dir); reconstructing a submission for it would surface a broken tile.
    if (!hasAep) {
      stats.notRecoverable++;
      log('  - skip (no .aep, not a recoverable submit): ' + base);
      return;
    }

    // Resolve display fields: prefer the existing row, else derive.
    const rowMeta = (row && row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
    const tm = await resolveTeamMember(userId);
    const displayName = (row && row.template_name) || displayNameFromFolder(folder);
    const category = (row && row.category) || DEFAULT_CATEGORY;
    const submitterName = rowMeta.submitterName || (tm && tm.full_name) || null;

    // ---- 1. reconstruct metadata.json if missing --------------------------
    if (!hasMeta) {
      let size = null;
      if (hasCompPng) {
        try {
          const { data: png } = await sb.storage.from(BUCKET).download(base + '/comp.png');
          if (png) size = await readPngSize(png);
        } catch (e) { /* leave size null */ }
      }
      const meta = {
        displayName: displayName,
        category: category,
        previewFrames: previewFrameCount,
        dependencies: [],
        hasCompPng: hasCompPng,
        hasAep: true,
        bundleAssetCount: bundleAssetCount,
        submitterName: submitterName,
        recoveredBy: 'recover-orphaned-submissions',
      };
      if (size) { meta.width = size.width; meta.height = size.height; }

      if (APPLY) {
        const body = new Blob([JSON.stringify(meta)], { type: 'application/json' });
        const { error: upErr } = await sb.storage.from(BUCKET).upload(base + '/metadata.json', body, {
          contentType: 'application/json', upsert: false,
        });
        if (upErr) { stats.errors++; log('  ! metadata write failed: ' + base + ' - ' + upErr.message); return; }
        stats.metaWritten++;
        log('  + metadata.json written: ' + base + '  [' + (size ? size.width + 'x' + size.height : 'no size') + ', ' + previewFrameCount + ' frames, ' + bundleAssetCount + ' assets]');
      } else {
        stats.metaWouldWrite++;
        log('  would write metadata.json: ' + base + '  [' + (size ? size.width + 'x' + size.height : 'no size') + ', ' + previewFrameCount + ' frames, ' + bundleAssetCount + ' assets, name="' + displayName + '", cat=' + category + ']');
      }
    }

    // ---- 2. ensure a submission row ---------------------------------------
    if (row) {
      stats.rowReused++;
    } else {
      const insertMeta = Object.assign({}, rowMeta, {
        submitterName: submitterName,
        bundleAssetCount: bundleAssetCount,
        recoveredBy: 'recover-orphaned-submissions',
      });
      if (APPLY) {
        const { error: insErr } = await sb.from(SUBMISSIONS).insert({
          user_id: userId,
          team_member_id: tm ? tm.id : null,
          template_name: displayName,
          category: category,
          storage_path: base,
          status: 'pending',
          metadata: insertMeta,
        });
        if (insErr) { stats.errors++; log('  ! submission row insert failed: ' + base + ' - ' + insErr.message); return; }
        stats.rowInserted++;
        log('  + submission row inserted: ' + base);
      } else {
        stats.rowWouldInsert++;
        log('  would insert submission row: ' + base + '  [name="' + displayName + '", cat=' + category + ', user=' + userId + ']');
      }
    }
  } catch (e) {
    stats.errors++;
    log('  ! error on ' + base + ': ' + (e && e.message || e));
  }
}

async function collectOrphanFolders() {
  const users = ONLY_USER
    ? [{ name: ONLY_USER }]
    : (await listFolder('pending')).filter(isFolder);
  const jobs = [];
  for (const u of users) {
    stats.usersScanned++;
    const folders = (await listFolder('pending/' + u.name)).filter(isFolder);
    for (const f of folders) {
      jobs.push({ userId: u.name, folder: f.name });
      if (jobs.length >= LIMIT) return jobs.slice(0, LIMIT);
    }
  }
  return jobs;
}

async function run() {
  log((APPLY ? 'APPLY' : 'DRY RUN') + ' - reconciling orphaned pending submissions in bucket "' + BUCKET + '"');
  const jobs = await collectOrphanFolders();
  log('Found ' + jobs.length + ' pending folder(s) across ' + stats.usersScanned + ' user(s)' + (ONLY_USER ? ' (filtered to --user)' : '') + '. Scanning...\n');

  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const my = jobs[idx++];
      await processFolder(my.userId, my.folder);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(CONCURRENCY, jobs.length); w++) workers.push(worker());
  await Promise.all(workers);

  log('\n---- summary ----');
  log('  users scanned            : ' + stats.usersScanned);
  log('  pending folders scanned  : ' + stats.foldersScanned);
  log('  already complete         : ' + stats.complete);
  log('  skipped (no .aep)        : ' + stats.notRecoverable);
  if (APPLY) {
    log('  metadata.json written    : ' + stats.metaWritten);
    log('  submission rows inserted : ' + stats.rowInserted);
    log('  submission rows reused   : ' + stats.rowReused);
  } else {
    log('  metadata.json would write: ' + stats.metaWouldWrite);
    log('  rows would insert        : ' + stats.rowWouldInsert);
    log('  rows already present     : ' + stats.rowReused);
  }
  log('  errors                   : ' + stats.errors);
  if (!APPLY) log('\nDRY RUN - nothing written. Re-run with --apply to reconstruct metadata + insert rows.');
}

run().catch((e) => { console.error('FATAL:', e && e.message || e); process.exit(1); });
