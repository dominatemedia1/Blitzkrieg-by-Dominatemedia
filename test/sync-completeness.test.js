'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');

// The SYNC path set `complete = aepOk`, judging only whether the .aep landed and
// ignoring skipped footage entirely, and it never cleared a stale partial/missing
// record. So a full sync could overwrite the import path's partial marker with
// complete:true and leave partial:true sitting next to it.
//
// The fix must NOT simply set complete:false on a skip. _pendingFor treats
// !complete as pending, so a template skipped for a PERMANENT reason (the 300MB
// footage cap) would be re-downloaded on every sync pass forever and the sync would
// never converge. The codebase already models this correctly: a mirror can be
// complete (sync has done all it can) while still carrying an advisory that it
// references missing footage. So `complete` tracks convergence and `partial` tracks
// honesty, and the two are reported separately.

function decider() {
  const { exports: sync } = loadModule('js/local-sync.js');
  const decide = sync.__completenessFromMirrorForTest;
  assert.strictEqual(typeof decide, 'function');
  return decide;
}

test('a clean mirror is complete and not partial', () => {
  const r = decider()(true, 0, []);
  assert.strictEqual(r.complete, true);
  assert.strictEqual(r.partial, false);
  assert.deepStrictEqual(Array.from(r.missing), []);
});

test('skipped footage is recorded as partial but still converges', () => {
  const r = decider()(true, 0, [{ path: 'Backgrounds/X_1/(Footage)/Raw Cam.mp4', size: 1740000000 }]);
  assert.strictEqual(
    r.complete, true,
    'must stay complete so _pendingFor converges; a permanent size-cap skip re-queued every pass would re-download forever'
  );
  assert.strictEqual(r.partial, true, 'but the mirror must be known incomplete');
  assert.deepStrictEqual(Array.from(r.missing), ['Backgrounds/X_1/(Footage)/Raw Cam.mp4']);
});

test('unrecoverable per-file download failures also mark it partial', () => {
  const r = decider()(true, 2, []);
  assert.strictEqual(r.complete, true);
  assert.strictEqual(r.partial, true);
});

test('a missing aep is never complete and never partial', () => {
  const r = decider()(false, 0, [{ path: 'a/b.mp4', size: 1 }]);
  assert.strictEqual(r.complete, false, 'no .aep means the mirror is not usable at all');
  assert.strictEqual(r.partial, false, 'partial describes a USABLE mirror missing extras');
});

test('a later clean sync clears a stale partial record', () => {
  const r = decider()(true, 0, []);
  assert.strictEqual(r.partial, false, 'a clean sync must clear the partial marker');
  assert.strictEqual(r.missing.length, 0, 'and must clear the stale missing list');
});

test('a partial mirror earns the existing restash advisory', () => {
  const { exports: sync } = loadModule('js/local-sync.js');
  const classify = sync.__classifyEntryForTest;
  assert.strictEqual(typeof classify, 'function');

  const r = classify({ complete: true, partial: true, missing: ['a/b.mp4'] }, false);
  assert.strictEqual(r.status, 'complete');
  assert.strictEqual(r.advisory, 'restash', 'the UI already renders this advisory; reuse it');
});
