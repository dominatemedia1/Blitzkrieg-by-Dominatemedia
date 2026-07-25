'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

// getTemplateSize recursed into every subfolder with an uncapped Promise.all, so
// real in-flight list count was (workers) x (1 + subfolder count). Combined with the
// download workers listing the same templates again, this produced the logged burst
// of 30 consecutive "List FAILED" entries roughly 0.4s apart.

function buildTemplateWithSubfolders(root, subfolderCount) {
  const files = {};
  files[root + '/template.aep'] = { size: 100 };
  for (let i = 0; i < subfolderCount; i++) {
    files[root + '/sub' + i + '/asset.mp4'] = { size: 100 };
  }
  return files;
}

// Wraps the stub so we can observe how many list calls are in flight at once.
function instrument(sb) {
  const api = sb.storage.from('blitzkrieg');
  const orig = api.list.bind(api);
  const stats = { inFlight: 0, peak: 0, total: 0 };
  api.list = function (prefix, opts) {
    stats.inFlight++;
    stats.total++;
    if (stats.inFlight > stats.peak) stats.peak = stats.inFlight;
    return Promise.resolve()
      .then(() => new Promise((r) => setTimeout(r, 5)))
      .then(() => orig(prefix, opts))
      .then((res) => { stats.inFlight--; return res; },
            (err) => { stats.inFlight--; throw err; });
  };
  return stats;
}

test('getTemplateSize bounds its recursive list fan-out', async () => {
  const ROOT = 'Backgrounds/Big_1';
  const sb = fakeSupabase({ files: buildTemplateWithSubfolders(ROOT, 20) });
  const stats = instrument(sb);
  const { exports: lib } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });

  const res = await lib.getTemplateSize(ROOT);
  assert.ok(res.total > 0, 'it should still compute a size');
  assert.ok(
    stats.peak <= 4,
    'recursive listing must be bounded; 20 subfolders should not mean 20 concurrent lists, peak was ' + stats.peak
  );
});
