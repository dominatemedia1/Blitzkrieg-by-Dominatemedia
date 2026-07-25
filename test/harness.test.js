'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

test('loadModule exposes the cloudLibrary namespace from an IIFE file', () => {
  const { exports } = loadModule('js/cloud-library.js', {
    blitzkriegSupabase: fakeSupabase({ files: {} })
  });
  assert.ok(exports, 'cloudLibrary namespace should be defined');
  assert.strictEqual(typeof exports.downloadTemplate, 'function');
});

test('fakeSupabase can simulate a list timeout', async () => {
  const sb = fakeSupabase({ listBehaviour: { 'Backgrounds/X': 'timeout' } });
  await assert.rejects(
    () => sb.storage.from('blitzkrieg').list('Backgrounds/X'),
    /timed out/i
  );
});
