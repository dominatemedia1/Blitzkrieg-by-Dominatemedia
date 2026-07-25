'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

// One permanently bad folder name made buildCompsFromMetadata call clearLocalCache(),
// which does not only drop the meta cache: it also zeroes the signed-URL caches and
// deletes the persisted signed-URL file. Signed URLs are keyed by storagePath and are
// completely unaffected by a display-name problem, so every session was needlessly
// re-signing all ~248 thumbnails.

test('clearLocalCache can keep signed URLs while dropping the meta cache', () => {
  const { exports: lib, localStorage } = loadModule('js/cloud-library.js', {
    blitzkriegSupabase: fakeSupabase({})
  });
  assert.strictEqual(typeof lib.clearLocalCache, 'function');

  localStorage.setItem('blitzkrieg_meta_cache', JSON.stringify({ comps: [] }));
  lib.__setSignedUrlForTest('Backgrounds/A_1/comp.png', 'https://signed.test/a');
  assert.strictEqual(lib.__getSignedUrlForTest('Backgrounds/A_1/comp.png'), 'https://signed.test/a');

  lib.clearLocalCache({ keepSignedUrls: true });

  assert.strictEqual(localStorage.getItem('blitzkrieg_meta_cache'), null, 'meta cache must still be dropped');
  assert.strictEqual(
    lib.__getSignedUrlForTest('Backgrounds/A_1/comp.png'),
    'https://signed.test/a',
    'a naming problem must not cost every signed thumbnail URL'
  );
});

test('clearLocalCache with no options still wipes everything, as before', () => {
  const { exports: lib, localStorage } = loadModule('js/cloud-library.js', {
    blitzkriegSupabase: fakeSupabase({})
  });
  localStorage.setItem('blitzkrieg_meta_cache', JSON.stringify({ comps: [] }));
  lib.__setSignedUrlForTest('Backgrounds/A_1/comp.png', 'https://signed.test/a');

  lib.clearLocalCache();

  assert.strictEqual(localStorage.getItem('blitzkrieg_meta_cache'), null);
  assert.ok(!lib.__getSignedUrlForTest('Backgrounds/A_1/comp.png'), 'full clear still drops signed URLs');
});

// The builder is called immediately AFTER setCachedMetadata on the manifest and
// slow paths (js/cloud-library.js:1625/1627, :1689/1694, :2972/2974). Clearing the
// cache from inside the builder therefore deleted what had just been written, so a
// single bad folder name meant re-downloading the manifest on every single load.

function badNameEntries() {
  // A folder name that is nothing but a timestamp derives to an empty display name,
  // which is what trips the garbage-name detector.
  return [
    {
      folderName: '1768564455228_1768564455228',
      category: 'Backgrounds',
      storagePath: 'Backgrounds/1768564455228_1768564455228',
      metadata: { name: '', width: 1920, height: 1080, duration: 5, frameRate: 30 }
    }
  ];
}

test('the builder does NOT clear the cache by default, so a fresh write survives', async () => {
  const { exports: lib, localStorage } = loadModule('js/cloud-library.js', {
    blitzkriegSupabase: fakeSupabase({})
  });
  localStorage.setItem('blitzkrieg_meta_cache', JSON.stringify({ folders: [], ts: Date.now() }));

  await lib.__buildCompsFromMetadataForTest(badNameEntries());

  assert.ok(
    localStorage.getItem('blitzkrieg_meta_cache'),
    'the builder must be pure: a manifest/slow-path write must not be deleted by it'
  );
});

test('the builder clears only when the caller allows it (the Tier-1 cache path)', async () => {
  const { exports: lib, localStorage } = loadModule('js/cloud-library.js', {
    blitzkriegSupabase: fakeSupabase({})
  });
  localStorage.setItem('blitzkrieg_meta_cache', JSON.stringify({ folders: [], ts: Date.now() }));

  await lib.__buildCompsFromMetadataForTest(badNameEntries(), { allowCacheClear: true });

  assert.strictEqual(
    localStorage.getItem('blitzkrieg_meta_cache'),
    null,
    'the Tier-1 path may still drop a stale cache that produced garbage names'
  );
});
