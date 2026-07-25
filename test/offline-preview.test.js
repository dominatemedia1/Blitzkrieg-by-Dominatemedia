'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');

// _applyLocalAssetCache serves hover preview frames from the disk mirror by
// FABRICATING file:// paths frame_0..frame_(previewFrameCount-1) from metadata. It
// gated that on getLocalDirsIfComplete, which only asks whether the .aep landed.
//
// Two production log patterns prove those frames are routinely absent from disk:
//   "preview mismatch for X: metadata says 31, storage has N"   (7 users)
//   "mirror: skipped unrecoverable file X/preview/frame_N"      (10+ per template)
//
// So a template could be `complete` (importable) while its preview folder was short,
// and the panel would point hover at file:// URLs that 404 one by one, with no
// per-frame fallback. The primary comp.png path must keep working in that case; only
// the whole-bundle affordances (preview frames, thumbnail.png) need the stricter gate.

function seededSync(templates) {
  const { exports: sync, localStorage } = loadModule('js/local-sync.js');
  localStorage.setItem('blitzkrieg_local_sync', JSON.stringify({
    libraryPath: '/Users/e/Blitzkrieg Library',
    templates
  }));
  return sync;
}

const ITEMS = [{ storagePath: 'Backgrounds/Clean_1' }, { storagePath: 'Backgrounds/Short_1' }];

test('a whole mirror resolves a dir for the offline-hover affordances', () => {
  const sync = seededSync({
    'Backgrounds/Clean_1': { complete: true, partial: false }
  });
  assert.strictEqual(typeof sync.getWholeMirrorDirs, 'function');
  const dirs = sync.getWholeMirrorDirs(ITEMS);
  assert.strictEqual(dirs['Backgrounds/Clean_1'], '/Users/e/Blitzkrieg Library/Backgrounds/Clean_1');
});

test('a partial mirror resolves no dir, so preview frames are not fabricated', () => {
  const sync = seededSync({
    'Backgrounds/Short_1': { complete: true, partial: true, missing: ['Backgrounds/Short_1/preview/frame_28.png'] }
  });
  const dirs = sync.getWholeMirrorDirs(ITEMS);
  assert.strictEqual(
    dirs['Backgrounds/Short_1'], '',
    'a mirror known to be short must not have file:// frame paths invented for it'
  );
});

test('a partial mirror still serves its primary thumbnail from disk', () => {
  const sync = seededSync({
    'Backgrounds/Short_1': { complete: true, partial: true, missing: ['Backgrounds/Short_1/preview/frame_28.png'] }
  });
  assert.strictEqual(
    sync.getLocalDirsIfComplete(ITEMS)['Backgrounds/Short_1'],
    '/Users/e/Blitzkrieg Library/Backgrounds/Short_1',
    'comp.png is always mirrored; tightening the hover gate must not cost the thumbnail'
  );
});

test('an incomplete mirror resolves no dir either way', () => {
  const sync = seededSync({ 'Backgrounds/Clean_1': { complete: false } });
  assert.strictEqual(sync.getWholeMirrorDirs(ITEMS)['Backgrounds/Clean_1'], '');
});

test('a known content-version mismatch still wins over wholeness', () => {
  const sync = seededSync({
    'Backgrounds/Clean_1': { complete: true, partial: false, contentVersion: 'v1' }
  });
  const dirs = sync.getWholeMirrorDirs([{ storagePath: 'Backgrounds/Clean_1', contentVersion: 'v2' }]);
  assert.strictEqual(dirs['Backgrounds/Clean_1'], '', 'a stale disk copy is not whole');
});
