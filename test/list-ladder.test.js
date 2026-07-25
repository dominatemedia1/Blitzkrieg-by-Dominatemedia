'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

// The retry ladder used to run 15s + 30s + 60s and never abort the timed-out
// attempt, so all three sat live on the connection pool at once. The ladder ADDED
// load to a backend that was already failing, which is how the logged
// "The connection to the database timed out" errors were produced.

test('the retry ladder tops out at two attempts', () => {
  const { window } = loadModule('js/cloud-library.js', { blitzkriegSupabase: fakeSupabase({}) });
  assert.deepStrictEqual(
    Array.from(window.__blitzListTimeoutsForTest),
    [15000, 30000],
    'the 60s third attempt is pure waste: a list that failed at 30s does not pass at 60s'
  );
});

test('a timed-out list attempt aborts its in-flight request', async () => {
  let aborted = false;
  const sb = fakeSupabase({});
  const api = sb.storage.from('blitzkrieg');
  const origList = api.list.bind(api);
  api.list = function (p, opts) {
    if (opts && opts.signal) {
      opts.signal.addEventListener('abort', () => { aborted = true; });
    }
    // Never settles, so the timeout path is the one that runs.
    return new Promise(() => {});
  };

  const { window } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
  const listWithTimeout = window.__blitzListWithTimeoutForTest;
  assert.strictEqual(typeof listWithTimeout, 'function');

  await assert.rejects(() => listWithTimeout('Backgrounds', {}, 20), /timed out/i);
  assert.strictEqual(aborted, true, 'the timed-out attempt must abort, not leak a live query');
  void origList;
});

test('a failed folder-list RPC is memoized for the run, not re-probed per category', async () => {
  let rpcCalls = 0;
  const sb = fakeSupabase({
    files: {
      'Backgrounds/A_1/template.aep': { size: 1 },
      'Callouts/B_1/template.aep': { size: 1 },
      'Pre-comps/C_1/template.aep': { size: 1 }
    }
  });
  // Count ONLY the folder-list RPC. cloud-library.js also calls
  // blitzkrieg_thumbnail_status, which is unrelated to this ladder.
  sb.rpc = function (fn) {
    if (fn === 'blitzkrieg_list_folders') {
      rpcCalls++;
      return Promise.reject(new Error('RPC folder-list timed out after 15000ms'));
    }
    return Promise.resolve({ data: null, error: { message: 'rpc not stubbed' } });
  };

  const { exports: lib } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
  try { await lib.listTemplates(); } catch (e) { /* the load may still degrade; we assert on RPC calls */ }

  assert.ok(
    rpcCalls <= 1,
    'the shared RPC must be probed at most once per run, not once per category (was 15s x N of waste), saw ' + rpcCalls
  );
});
