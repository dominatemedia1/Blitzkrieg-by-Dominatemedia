'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

// Promise.race([work, timeout]) settles as soon as the WORK resolves, but the losing
// timeout timer keeps running to its full deadline. _listWithTimeout and
// _downloadWithTimeout both clear theirs; the two RPC helpers did not.
//
// _listFoldersViaRpc runs once per category (up to 24) and _fetchThumbnailStatus once
// per load, so a single library load left ~25 live 15s timers behind. The panel reloads
// on focus, so they accumulate across a working session. It is also why this test file
// used to sit for a full 15s before the runner would exit.

test('a successful folder-list RPC leaves no timer behind', async () => {
  const sb = fakeSupabase({});
  sb.rpc = (fn) => Promise.resolve(
    fn === 'blitzkrieg_list_folders' ? { data: [{ folder: 'A_1' }], error: null } : { data: null, error: null }
  );
  const { window, pendingTimers, clearAllTimers } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
  const viaRpc = window.__blitzListFoldersViaRpcForTest;
  assert.strictEqual(typeof viaRpc, 'function');

  const before = pendingTimers();
  await viaRpc('Backgrounds', 15000);

  assert.strictEqual(
    pendingTimers(), before,
    'the losing 15s timeout must be cleared; one per category per load otherwise'
  );
  clearAllTimers();
});

test('a failed folder-list RPC also leaves no timer behind', async () => {
  const sb = fakeSupabase({});
  sb.rpc = () => Promise.resolve({ data: null, error: { message: 'boom' } });
  const { window, pendingTimers, clearAllTimers } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });

  const before = pendingTimers();
  await assert.rejects(() => window.__blitzListFoldersViaRpcForTest('Backgrounds', 15000));

  assert.strictEqual(pendingTimers(), before, 'the error path must clear it too');
  clearAllTimers();
});

test('a full library load leaves no timer behind', async () => {
  const sb = fakeSupabase({
    files: {
      'Backgrounds/A_1/template.aep': { size: 1 },
      'Callouts/B_1/template.aep': { size: 1 }
    }
  });
  sb.rpc = () => Promise.resolve({ data: [], error: null });
  const { exports: lib, pendingTimerDelays, clearAllTimers } = loadModule('js/cloud-library.js', {
    blitzkriegSupabase: sb,
    blitzSignedUrlStore: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    blitzMetaCacheStore: { load: () => Promise.resolve(null), save: () => Promise.resolve() }
  });

  await lib.listTemplates();

  // A short debounce (the 250ms coalesced meta-cache file write) is legitimate and
  // clears itself. A surviving multi-second deadline is a leaked race loser.
  const stragglers = pendingTimerDelays().filter((ms) => ms >= 1000);
  assert.deepStrictEqual(
    stragglers, [],
    'a load must not leave live multi-second wakeups scheduled; the panel reloads on every focus event'
  );
  clearAllTimers();
});
