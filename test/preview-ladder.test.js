'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

// getExistingPreviewFramePaths runs a 15s + 30s list ladder. Two gaps made that
// ladder re-run far more often than once:
//
//   1. Only SUCCESS was cached. A preview folder whose listing kept failing re-ran
//      the full 45s ladder on every single hover, against the same storage that was
//      already the reason it was slow.
//   2. Nothing deduped concurrent callers. The card-level guard in main.js reset
//      itself after 15s, which is SHORTER than the ladder's own 45s worst case, so
//      a second hover stacked a second ladder on top of the first.
//
// The production log "preview listing failed for X after 2 attempts" is this path.

const SLOW = 'Backgrounds/Slow_1';
const GOOD = 'Backgrounds/Good_1';

function listCalls(sb, prefix) {
  return sb._calls.list.filter((c) => (c.prefix || '').indexOf(prefix) === 0).length;
}

function failingLib() {
  const sb = fakeSupabase({ listBehaviour: { [SLOW + '/preview']: 'error' } });
  const { exports: lib } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
  return { lib, sb, get: lib.__getExistingPreviewFramePathsForTest };
}

test('concurrent callers share one ladder instead of stacking two', async () => {
  const { lib, sb, get } = failingLib();
  assert.strictEqual(typeof get, 'function');

  await Promise.all([get(SLOW, 12), get(SLOW, 12), get(SLOW, 12)]);

  assert.strictEqual(
    listCalls(sb, SLOW + '/preview'), 2,
    'three simultaneous hovers must cost ONE ladder (2 attempts), not three'
  );
});

test('a failed listing is negatively cached, so the next hover does not re-ladder', async () => {
  const { sb, get } = failingLib();

  await get(SLOW, 12);
  const after1 = listCalls(sb, SLOW + '/preview');
  const second = await get(SLOW, 12);

  assert.strictEqual(
    listCalls(sb, SLOW + '/preview'), after1,
    'a repeat hover inside the negative-cache window must not touch storage again'
  );
  assert.deepStrictEqual(Array.from(second), [], 'and it still reports no frames');
});

test('a successful listing is still cached and still returns its frames', async () => {
  const sb = fakeSupabase({
    files: {
      [GOOD + '/preview/frame_1.png']: { size: 10 },
      [GOOD + '/preview/frame_0.png']: { size: 10 }
    }
  });
  const { exports: lib } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
  const get = lib.__getExistingPreviewFramePathsForTest;

  const first = await get(GOOD, 2);
  assert.deepStrictEqual(
    Array.from(first).sort(),
    [GOOD + '/preview/frame_0.png', GOOD + '/preview/frame_1.png'],
    'a healthy preview folder still resolves its frames'
  );

  const attempts = listCalls(sb, GOOD + '/preview');
  await get(GOOD, 2);
  assert.strictEqual(listCalls(sb, GOOD + '/preview'), attempts, 'success stays cached');
});

test('the negative cache expires so a transient outage recovers', async () => {
  const { lib, sb, get } = failingLib();

  await get(SLOW, 12);
  const after1 = listCalls(sb, SLOW + '/preview');

  lib.__expirePreviewNegativeCacheForTest();
  await get(SLOW, 12);

  assert.ok(
    listCalls(sb, SLOW + '/preview') > after1,
    'once the window passes, a recovered network must get another chance'
  );
});
