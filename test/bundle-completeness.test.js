'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

const TPL = 'Backgrounds/Demo_1768560095933';

function libWith(sbConfig) {
  const sb = fakeSupabase(sbConfig);
  const { exports } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
  return { lib: exports, sb };
}

test('a fully successful download reports complete with no missing files', async () => {
  const { lib } = libWith({
    files: {
      [TPL + '/template.aep']: { size: 1000 },
      [TPL + '/(Footage)/clip.mp4']: { size: 2000 }
    }
  });
  const r = await lib.downloadTemplate(TPL);
  assert.strictEqual(r.complete, true);
  // Array.from: r.missing is built inside the vm realm, so its prototype is not
  // the outer realm's Array. Contents are still compared strictly.
  assert.deepStrictEqual(Array.from(r.missing), []);
  assert.strictEqual(r.reason, null);
});

test('a list timeout yields an incomplete bundle, not a silent AEP-only success', async () => {
  const { lib } = libWith({
    files: { [TPL + '/template.aep']: { size: 1000 } },
    listBehaviour: { [TPL]: 'timeout', [TPL + '*']: 'timeout' }
  });
  const r = await lib.downloadTemplate(TPL);
  assert.ok(r.blob, 'the .aep should still come through');
  assert.strictEqual(r.complete, false, 'a list timeout must NOT report a complete bundle');
  assert.strictEqual(r.reason, 'list-failed');
});

test('one failed asset does not discard the whole footage bundle', async () => {
  const { lib } = libWith({
    files: {
      [TPL + '/template.aep']: { size: 1000 },
      [TPL + '/(Footage)/good.mp4']: { size: 2000 },
      [TPL + '/(Footage)/bad.mp4']: { size: 2000 }
    },
    downloadBehaviour: { [TPL + '/(Footage)/bad.mp4']: 'fail' }
  });
  const r = await lib.downloadTemplate(TPL);
  assert.strictEqual(r.extraFiles.length, 1, 'the good asset must survive one bad sibling');
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.reason, 'assets-failed');
  assert.deepStrictEqual(Array.from(r.missing), [TPL + '/(Footage)/bad.mp4']);
});

// --- Task 5: a partial bundle must never be cached as a complete mirror ---

test('markTemplatePartial records the mirror as NOT complete so it re-fetches', async () => {
  const { exports: sync } = loadModule('js/local-sync.js');
  assert.strictEqual(typeof sync.markTemplatePartial, 'function');

  await sync.markTemplatePartial(TPL, '/tmp/x.aep', '1.3.21', [TPL + '/(Footage)/bad.mp4']);
  const st = sync.getTemplateState(TPL);

  assert.strictEqual(st.complete, false, 'a partial mirror must not read as complete');
  assert.strictEqual(st.partial, true);
  assert.deepStrictEqual(Array.from(st.missing), [TPL + '/(Footage)/bad.mp4']);
});

test('a later complete download clears the partial marker', async () => {
  const { exports: sync } = loadModule('js/local-sync.js');
  await sync.markTemplatePartial(TPL, '/tmp/x.aep', '1.3.21', [TPL + '/(Footage)/bad.mp4']);
  await sync.markTemplateComplete(TPL, '/tmp/x.aep', '1.3.21');
  const st = sync.getTemplateState(TPL);

  assert.strictEqual(st.complete, true);
  assert.ok(!st.partial, 'partial must be cleared once the full bundle lands');
  assert.strictEqual((st.missing || []).length, 0);
});
