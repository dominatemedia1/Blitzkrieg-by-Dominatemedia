'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');

// A whole-library mirror is 68GB. It used to auto-resume on every library load,
// saturating the network that listCategory needs and stalling the panel's only
// JS thread on synchronous writes. It is now opt-in per machine.

test('full sync is OFF by default on a fresh machine', () => {
  const { exports: sync } = loadModule('js/local-sync.js');
  assert.strictEqual(typeof sync.getFullSyncOptIn, 'function');
  assert.strictEqual(typeof sync.setFullSyncOptIn, 'function');
  assert.strictEqual(sync.getFullSyncOptIn(), false, 'must default to off, never auto-resume');
});

test('the opt-in round-trips through localStorage', () => {
  const { exports: sync, localStorage } = loadModule('js/local-sync.js');
  sync.setFullSyncOptIn(true);
  assert.strictEqual(sync.getFullSyncOptIn(), true);
  assert.strictEqual(localStorage.getItem('blitzkrieg_full_sync_optin'), '1');

  sync.setFullSyncOptIn(false);
  assert.strictEqual(sync.getFullSyncOptIn(), false);
});

test('a corrupt opt-in value reads as off rather than throwing', () => {
  const { exports: sync, localStorage } = loadModule('js/local-sync.js');
  localStorage.setItem('blitzkrieg_full_sync_optin', 'not-a-flag');
  assert.strictEqual(sync.getFullSyncOptIn(), false);
});

test('isUserActionInFlight is exposed so the sync loop can yield to the user', () => {
  const { exports: sync } = loadModule('js/local-sync.js');
  assert.strictEqual(typeof sync.isUserActionInFlight, 'function');
  assert.strictEqual(sync.isUserActionInFlight(), false);
  sync.setUserActionInFlight(true);
  assert.strictEqual(sync.isUserActionInFlight(), true);
  sync.setUserActionInFlight(false);
  assert.strictEqual(sync.isUserActionInFlight(), false);
});
