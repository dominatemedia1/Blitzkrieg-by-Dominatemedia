'use strict';
// Perf eval, not part of the unit suite. Run: node test/perf.bench.js
// Measures the paths an editor actually waits on, against a fake backend with a
// fixed per-op latency, so the numbers show WORK DONE (round-trips, fan-out) rather
// than network noise. Budgets are the pass/fail line; the process exits non-zero if
// any is blown, so this can be wired into CI later.

const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

const LATENCY_MS = 12;      // a modest per-request cost, applied to every storage op
const CATEGORIES = 24;
const PER_CATEGORY = 16;    // ~384 templates, close to the real library

function seededFiles() {
  const files = {};
  for (let c = 0; c < CATEGORIES; c++) {
    for (let t = 0; t < PER_CATEGORY; t++) {
      const base = `Cat${c}/Tpl-${c}-${t}_17687000000${c}${t}`;
      files[`${base}/template.aep`] = { size: 400000 };
      files[`${base}/comp.png`] = { size: 40000 };
      files[`${base}/metadata.json`] = {
        size: 200,
        body: JSON.stringify({ name: `Tpl ${c} ${t}`, width: 1920, height: 1080, duration: 5, frameRate: 30 })
      };
    }
  }
  return files;
}

function laggy(sb) {
  const api = sb.storage.from('blitzkrieg');
  const wrap = (fn) => (...a) => new Promise((r) => setTimeout(r, LATENCY_MS)).then(() => fn(...a));
  api.list = wrap(api.list.bind(api));
  api.download = wrap(api.download.bind(api));
  api.createSignedUrls = wrap(api.createSignedUrls.bind(api));
  return sb;
}

const results = [];
function record(name, ms, budgetMs, detail) {
  const ok = ms <= budgetMs;
  results.push({ name, ms, budgetMs, ok, detail });
  const bar = ok ? 'PASS' : 'FAIL';
  console.log(
    `${bar}  ${name.padEnd(42)} ${String(Math.round(ms)).padStart(6)}ms  (budget ${budgetMs}ms)` +
    (detail ? '  ' + detail : '')
  );
}

async function timed(fn) {
  const t0 = process.hrtime.bigint();
  const out = await fn();
  return [Number(process.hrtime.bigint() - t0) / 1e6, out];
}

(async () => {
  const files = seededFiles();
  const total = CATEGORIES * PER_CATEGORY;
  console.log(`Blitzkrieg perf eval — ${total} templates, ${CATEGORIES} categories, ${LATENCY_MS}ms/op\n`);

  // 1. COLD SLOW PATH: no cache, no manifest, no RPC. The worst legitimate load.
  {
    const sb = laggy(fakeSupabase({ files }));
    sb.rpc = () => Promise.resolve({ data: null, error: { message: 'not available' } });
    const { exports: lib, pendingTimerDelays } = loadModule('js/cloud-library.js', {
      blitzkriegSupabase: sb,
      blitzSignedUrlStore: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
      blitzMetaCacheStore: { load: () => Promise.resolve(null), save: () => Promise.resolve() }
    });
    const [ms, comps] = await timed(() => lib.listTemplates());
    record('cold slow path (no cache, no RPC)', ms, 12000, `${comps.length} comps, ${sb._calls.list.length} lists`);
    const stuck = pendingTimerDelays().filter((d) => d >= 1000);
    record('  timers left live after that load', stuck.length, 0, stuck.length ? JSON.stringify(stuck) : 'none');
  }

  // 2. WARM TIER-1 PAINT: the number an editor sees on nearly every launch. The
  //    host bridge is deliberately hung, because AE is busy opening their project.
  {
    const sb = laggy(fakeSupabase({ files }));
    const hung = { load: () => new Promise(() => {}), save: () => Promise.resolve() };
    const { exports: lib, localStorage, clearAllTimers } = loadModule('js/cloud-library.js', {
      blitzkriegSupabase: sb, blitzSignedUrlStore: hung, blitzMetaCacheStore: hung
    });
    const folders = [];
    for (let c = 0; c < CATEGORIES; c++) {
      for (let t = 0; t < PER_CATEGORY; t++) {
        const fn = `Tpl-${c}-${t}_17687000000${c}${t}`;
        folders.push({
          folderName: fn, category: `Cat${c}`, storagePath: `Cat${c}/${fn}`,
          metadata: { name: `Tpl ${c} ${t}`, width: 1920, height: 1080, duration: 5, frameRate: 30 }
        });
      }
    }
    localStorage.setItem('blitzkrieg_meta_cache', JSON.stringify({ _v: 3, ts: Date.now(), folders }));
    const [ms, comps] = await timed(() => lib.listTemplates());
    record('warm cache first paint (hung host bridge)', ms, 250, `${comps.length} comps`);
    clearAllTimers();
  }

  // 3. FAILING CATEGORY LADDER: every list errors. This is the wall an editor hits
  //    when RLS makes storage.objects slow. The ladder must top out, not grind.
  {
    const sb = fakeSupabase({ files, listBehaviour: { 'Cat0*': 'timeout' } });
    sb.rpc = () => Promise.reject(new Error('RPC folder-list timed out after 15000ms'));
    const { window } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
    const ladder = Array.from(window.__blitzListTimeoutsForTest);
    const worstCase = ladder.reduce((a, b) => a + b, 0);
    record('worst-case ladder wall time per category', worstCase, 45000, `attempts ${JSON.stringify(ladder)}`);
  }

  // 4. HOVER STORM: 40 cards hovered in a sweep, all with a failing preview folder.
  //    Pre-fix this was 40 independent 45s ladders; the in-flight map plus the
  //    negative cache must collapse it to one.
  {
    const sb = fakeSupabase({ listBehaviour: { 'Cat0/Tpl-0-0_1768700000000/preview': 'error' } });
    const { exports: lib } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
    const get = lib.__getExistingPreviewFramePathsForTest;
    const [ms] = await timed(async () => {
      await Promise.all(Array.from({ length: 40 }, () => get('Cat0/Tpl-0-0_1768700000000', 12)));
      for (let i = 0; i < 40; i++) await get('Cat0/Tpl-0-0_1768700000000', 12);
    });
    const listCalls = sb._calls.list.filter((c) => (c.prefix || '').indexOf('Cat0/Tpl-0-0_1768700000000/preview') === 0).length;
    record('80 hovers on a failing preview folder', ms, 500, `${listCalls} storage lists (one ladder = 2)`);
    if (listCalls > 2) { results[results.length - 1].ok = false; }
  }

  // 5. MIRROR RETRY COST: the new single retry must not slow a healthy bundle.
  {
    const sb = laggy(fakeSupabase({ files }));
    const { exports: lib } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
    const base = 'Cat0/Tpl-0-0_1768700000000';
    const paths = [base + '/template.aep', base + '/comp.png', base + '/metadata.json'];
    const [ms] = await timed(() => lib.__downloadStorageFilesForTest(paths, base, 3, null, {
      skipFailures: true, skipped: []
    }));
    record('healthy 3-file mirror (retry adds nothing)', ms, 200, '');
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.log(`${failed.length} budget(s) blown: ` + failed.map((f) => f.name.trim()).join(', '));
    process.exit(1);
  }
  console.log(`All ${results.length} perf budgets met.`);
})();
