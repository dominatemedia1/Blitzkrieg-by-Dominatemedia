'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

// Production, 7 days to 2026-07-25:
//   "mirror: skipped unrecoverable file .../11.aep (Failed to fetch)"
//   "mirror: skipped unrecoverable file .../(Footage)/BG - Serge.mp4 ({})"
//
// The skip path gave a file ZERO retries. "Failed to fetch" is a transient network
// drop, not an unrecoverable object, and every one of those logs came from a single
// user inside a single bad half hour. One blip permanently cost that file: the
// template still completed on its .aep, and nothing ever went back for the rest.
//
// A skipped .aep is literally the reported symptom, project files missing.

function bundle(behaviour) {
  const sb = fakeSupabase({
    files: {
      'Backgrounds/A_1/template.aep': { size: 100 },
      'Backgrounds/A_1/comp.png': { size: 10 },
      'Backgrounds/A_1/(Footage)/BG.mp4': { size: 50 }
    },
    downloadBehaviour: behaviour
  });
  const { exports: lib } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
  return { lib, sb };
}

const ALL = [
  'Backgrounds/A_1/template.aep',
  'Backgrounds/A_1/comp.png',
  'Backgrounds/A_1/(Footage)/BG.mp4'
];

test('a file that fails once is retried, not written off', async () => {
  const { lib, sb } = bundle({});
  const api = sb.storage.from('blitzkrieg');
  const orig = api.download.bind(api);
  let firstAttemptSeen = false;
  api.download = function (p) {
    if (p.indexOf('BG.mp4') !== -1 && !firstAttemptSeen) {
      firstAttemptSeen = true;
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return orig(p);
  };

  const skipped = [];
  const out = await lib.__downloadStorageFilesForTest(ALL, 'Backgrounds/A_1', 3, null, {
    skipFailures: true, skipped: skipped
  });

  assert.deepStrictEqual(
    Array.from(skipped), [],
    'a transient "Failed to fetch" must not permanently strand the file'
  );
  assert.strictEqual(out.length, 3, 'all three files land after the retry');
});

test('a genuinely dead object is still skipped, not retried forever', async () => {
  const { lib } = bundle({ 'Backgrounds/A_1/(Footage)/BG.mp4': 'fail' });

  const skipped = [];
  const out = await lib.__downloadStorageFilesForTest(ALL, 'Backgrounds/A_1', 3, null, {
    skipFailures: true, skipped: skipped
  });

  assert.deepStrictEqual(
    Array.from(skipped), ['Backgrounds/A_1/(Footage)/BG.mp4'],
    'a persistently failing object must still be recorded and skipped'
  );
  assert.strictEqual(out.length, 2, 'the rest of the bundle still lands');
});

test('the strict (non-skip) contract is unchanged: essential files still throw', async () => {
  const { lib } = bundle({ 'Backgrounds/A_1/comp.png': 'fail' });

  await assert.rejects(
    () => lib.__downloadStorageFilesForTest(ALL, 'Backgrounds/A_1', 3, null, {}),
    /Failed to download bundle file/,
    'comp.png and dependency callers depend on throw-on-any-failure'
  );
});
