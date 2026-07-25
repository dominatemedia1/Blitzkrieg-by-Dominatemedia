'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');

// The thumbnail seed re-rendered the whole grid every 25 completed downloads. Each
// rebuild reset the page to the first 40 cards, so an editor scrolled to card 200 was
// thrown back roughly every 1.5s. The panel read as slow and jumpy even though nothing
// was actually blocked.

test('a user-initiated render starts at one page', () => {
  const { window } = loadModule('js/main.js');
  const compute = window.__blitzComputeRenderUpToForTest;
  assert.strictEqual(typeof compute, 'function');
  assert.strictEqual(compute(40, 300, 200, false), 40);
});

test('a background re-render preserves how far the user had scrolled', () => {
  const { window } = loadModule('js/main.js');
  const compute = window.__blitzComputeRenderUpToForTest;
  assert.strictEqual(
    compute(40, 300, 200, true),
    200,
    'a thumbnail-seed repaint must not throw the user back to the top'
  );
});

test('preserved depth never exceeds the number of comps available', () => {
  const { window } = loadModule('js/main.js');
  const compute = window.__blitzComputeRenderUpToForTest;
  assert.strictEqual(compute(40, 120, 200, true), 120, 'clamped to the filtered length');
});

test('preserved depth never drops below one page', () => {
  const { window } = loadModule('js/main.js');
  const compute = window.__blitzComputeRenderUpToForTest;
  assert.strictEqual(compute(40, 300, 0, true), 40);
  assert.strictEqual(compute(40, 300, undefined, true), 40);
});

// --- first paint must not wait on the signed-URL host round-trip ---

const { fakeSupabase } = require('./helpers/fake-supabase');

test('a warm meta cache paints without waiting on the signed-URL host bridge', async () => {
  const CACHE_VERSION = 3; // js/cloud-library.js:205

  // A host bridge that never answers, which is the cold-launch case: AE's
  // ExtendScript engine is busy opening the user's project.
  const neverResolves = { load: () => new Promise(() => {}), save: () => Promise.resolve() };

  const { exports: lib, window, localStorage } = loadModule('js/cloud-library.js', {
    blitzkriegSupabase: fakeSupabase({}),
    blitzSignedUrlStore: neverResolves,
    blitzMetaCacheStore: neverResolves
  });

  // Seed a valid localStorage meta cache so Tier 1 can serve the grid outright.
  const v = CACHE_VERSION;
  localStorage.setItem('blitzkrieg_meta_cache', JSON.stringify({
    _v: v,
    ts: Date.now(),
    folders: [{
      folderName: 'Nice-Name_1768564455228',
      category: 'Backgrounds',
      storagePath: 'Backgrounds/Nice-Name_1768564455228',
      metadata: { name: 'Nice Name', width: 1920, height: 1080, duration: 5, frameRate: 30 }
    }]
  }));

  const t0 = Date.now();
  await lib.listTemplates();
  const elapsed = Date.now() - t0;

  assert.ok(
    elapsed < 1500,
    'first paint must not block on the 2.5s signed-URL host round-trip when the meta cache is warm, took ' + elapsed + 'ms'
  );
});

test('the background-repaint flag is cleared at entry, so it cannot leak to the next render', () => {
  const { window } = loadModule('js/main.js');
  const render = window.__blitzRenderCompsGridForTest;
  assert.strictEqual(typeof render, 'function', 'renderCompsGrid must be reachable for this guard');

  // Simulate a background repaint that hits one of the early returns (no grid element
  // exists in the stub DOM, so renderCompsGrid bails long before it paints).
  render._preserveScrollDepth = true;
  try { render(); } catch (e) { /* the stub DOM cannot paint; the flag reset is what matters */ }

  assert.notStrictEqual(
    render._preserveScrollDepth, true,
    'an early return must not leave the flag set for a later user-initiated render'
  );
});
