# Blitzkrieg Slowness + Missing Project Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the two reported failures in the Blitzkrieg CEP panel: imports that silently land without their footage, and panel loads that stall for minutes.

**Architecture:** Three independent causal chains, fixed in dependency order. (1) The Windows OTA updater cannot write to `Program Files`, so some editors are frozen on pre-1.3.14 builds and cannot receive any fix; that ships first. (2) 26 permissive SELECT policies on `storage.objects` are OR-ed per row, making a 39ms index scan take 11.5s under RLS; every list timeout downstream originates here. (3) When a list times out, `downloadTemplate` silently degrades to an AEP-only bundle and `_doMirrorImport` then marks that incomplete mirror "complete", permanently poisoning the local fast path so the footage never arrives.

**Tech Stack:** Vanilla ES5-flavoured JS in an Adobe CEP (Chromium) panel, no build step, no bundler. ExtendScript (ES3) host layer in `jsx/hostscript.jsx`. Supabase Postgres + Storage. Tests run under Node's built-in `node:test`.

## Global Constraints

- **No build step.** All JS runs directly in the CEP Chromium runtime. Do not introduce a bundler, transpiler, or ES module syntax. Every file stays an IIFE: `(function () { 'use strict'; ... })();`
- **No `Promise.prototype.finally()`.** Unavailable in CEP 8/9 (AE 2018-2019, Chromium 57/61). Use the two-argument `.then(onOk, onErr)` form.
- **ExtendScript is ES3.** In `jsx/hostscript.jsx`: no `const`/`let`, no arrow functions, no `JSON` beyond the bundled polyfill, no `atob`, no `Array.prototype.forEach`/`map`/`indexOf`.
- **`var` only in `js/main.js`.** `const`/`let` are acceptable in `js/cloud-library.js` and `js/local-sync.js` where already used, but match the surrounding function.
- **No em dashes, en dashes, or decorative arrows in any user-facing string.** The CI gate blocks them. Use commas or hyphens. This covers toasts, banners, labels, and error text.
- **No save toasts.** Do not add a toast that only confirms a save succeeded.
- **Logging:** `window._blitzLog(msg, level)` in `cloud-library.js` and `local-sync.js`; `debugLog(msg, level)` in `main.js`. Levels: `info`, `warn`, `error`, `success`.
- **Escaping:** `escapeForExtendScript(str)` before embedding in `evalScript`; `escapeHTML(str)` before any `innerHTML`.
- **CSS tokens only.** Never hardcode a colour or spacing value; use the `:root` custom properties in `CSS/style.css`.
- **Cache invalidation:** call `invalidateCache()` after every mutation in `cloud-library.js`.
- **Bucket name:** `blitzkrieg`. Supabase project id: `kwrmdxptrrvlqxdcasho`.
- **Every migration that adds a column or table ships its GRANT and RLS policy in the same migration**, proven under a real user JWT, not a service-role read.
- **Only one worktree applies Supabase migrations at a time.** This plan's Task 3 and Task 11 both touch the DB; they must not run concurrently with another agent's migration work.
- **Do not auto-commit.** Commit steps in this plan are explicit; do not merge to main, open a PR, or delete branches without an explicit ask.

## Verified Evidence Base

Every task below traces to a finding that survived adversarial verification. Reference numbers are used in task headers.

| # | Finding | Location |
|---|---------|----------|
| F1 | Root list skips the fast RPC (`if (catName)` gate), pays 15s + 30s + 60s = ~110s | `js/cloud-library.js:1110`, gate at `:1182` |
| F2 | Failing categories cost ~124.5s each, drained 2 at a time | `js/cloud-library.js:1269` |
| F3 | Timed-out list calls are never aborted; retries stack live queries on the pooler | `js/cloud-library.js:377-386` |
| F4 | `downloadTemplate` degrades to AEP-only when the list times out | `js/cloud-library.js:1933-1937` |
| F5 | `downloadTemplate` discards the entire footage bundle if any one asset fails | `js/cloud-library.js:1991-1994` |
| F6 | `_doMirrorImport` marks an incomplete mirror complete, poisoning the fast path | `js/main.js:4957-4959` |
| F7 | 300MB footage cap skips files while still reporting fully synced | `js/cloud-library.js:1736`, `:2016` |
| F8 | `mirrorTemplate` returns `skippedCount`, nothing reads it | `js/cloud-library.js:2083` |
| F9 | 26 permissive SELECT policies on `storage.objects` OR-ed per row; 11.5s vs 39ms | live DB |
| F10 | Only admins can publish the manifest, so non-admins never heal the slow path | `js/cloud-library.js:514` |
| F11 | local-sync state is localStorage-only; an AE quit reads every mirror as unsynced | `js/local-sync.js:13` |
| F12 | Every first hover issues a paginated list of the template's preview folder | `js/main.js:3205` |
| F13 | Windows OTA writes to `Program Files`, denied without elevation | `js/main.js:9007`, `:9439` |
| F14 | 68GB library mirror auto-resumes on every load, synchronous writes on the only JS thread | `js/main.js:1799-1806`, `js/local-sync.js:228` |
| F15 | Pre-sizing issues an unbounded N+1 list storm concurrent with the download workers | `js/local-sync.js:930-951`, `js/cloud-library.js:2393` |
| F16 | `buildCompsFromMetadata` wipes the meta and signed-URL caches on one bad folder name | `js/cloud-library.js:915-919`, `:1536-1538` |
| F17 | Thumbnail-seed progress re-renders the grid, discarding pagination and scroll | `js/main.js:2624-2641` |
| F18 | First paint blocks up to 2.5s on a contended ExtendScript round-trip | `js/cloud-library.js:1405`, `:286` |

**Ruled out, do not spend time here:** `blitzkrieg_error_logs` volume is not a latency cost (measured). Signed-URL expiry cannot truncate a footage transfer, because footage downloads do not use signed URLs.

## File Structure

**New files:**
- `test/helpers/load-module.js` - loads an IIFE source file against a stub `window`, returns the exported namespace. Needed because the codebase has no module system.
- `test/helpers/fake-supabase.js` - scriptable stub of the `sb.storage.from(BUCKET)` surface, so download/list failure modes can be simulated deterministically.
- `test/bundle-completeness.test.js` - Task 4 and 5.
- `test/streaming-download.test.js` - Task 6.
- `test/list-ladder.test.js` - Task 9.
- `test/update-target.test.js` - Task 2.
- `supabase/migrations/<ts>_consolidate_storage_objects_select_policies.sql` - Task 3.
- `supabase/migrations/<ts>_blitzkrieg_list_root_rpc.sql` - Task 8.
- `supabase/migrations/<ts>_blitzkrieg_manifest_publish.sql` - Task 11.

**Modified files:**
- `js/cloud-library.js` - the bundle contract, streaming download, list ladder, root RPC call, manifest publish.
- `js/main.js` - mirror completion gating, honest status UI, hover preview, updater install target.
- `js/local-sync.js` - partial state, file backstop.
- `jsx/hostscript.jsx` - streaming write-to-disk helper, per-user extension root resolution.
- `CSS/style.css` - the partial-template badge.
- `.github/workflows/ci.yml` - run the new test suite as a blocking gate.
- `package.json` - add the `test` script.

---

## Task 1: Test harness

The repo has no test framework. Nothing else in this plan can be TDD without one. This task delivers a runner and the two stubs every later test depends on.

**Files:**
- Create: `package.json` (currently untracked in main, commit it properly)
- Create: `test/helpers/load-module.js`
- Create: `test/helpers/fake-supabase.js`
- Create: `test/harness.test.js`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `loadModule(relPath, windowStubExtras) -> { window, exports }` where `exports` is `window.cloudLibrary` / `window.localSync` / whichever namespace the file assigns.
  - `fakeSupabase(config) -> sbLike` where `config` is `{ files: {path: {size, body}}, listBehaviour: {prefix: 'ok'|'timeout'|'error'}, downloadBehaviour: {path: 'ok'|'fail'|'slow'} }`.

- [ ] **Step 1: Write the failing test**

Create `test/harness.test.js`:

```js
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/harness.test.js`
Expected: FAIL with `Cannot find module './helpers/load-module'`.

- [ ] **Step 3: Write `test/helpers/load-module.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// The codebase has no module system: every js/ file is an IIFE that assigns a
// namespace onto `window`. To test those functions we evaluate the file inside
// a vm context holding a stub window, then hand back whatever it assigned.
function loadModule(relPath, windowExtras) {
  const src = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');

  const storage = {};
  const localStorageStub = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); }
  };

  const windowStub = Object.assign({
    localStorage: localStorageStub,
    navigator: { onLine: true, userAgent: 'node-test' },
    location: { href: 'file:///test/index.html' },
    _blitzLog: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: () => Promise.reject(new Error('fetch not stubbed')),
    CSInterface: function () { this.evalScript = (s, cb) => cb && cb('undefined'); }
  }, windowExtras || {});

  const sandbox = {
    window: windowStub,
    localStorage: localStorageStub,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Date,
    Math,
    JSON,
    AbortController,
    Blob: globalThis.Blob,
    URL: globalThis.URL
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: relPath });

  const exported =
    windowStub.cloudLibrary ||
    windowStub.localSync ||
    windowStub.blitzkriegAuth ||
    null;

  return { window: windowStub, exports: exported, localStorage: localStorageStub };
}

module.exports = { loadModule, REPO_ROOT };
```

- [ ] **Step 4: Write `test/helpers/fake-supabase.js`**

```js
'use strict';

// Scriptable stand-in for the slice of supabase-js the plugin touches.
// `listBehaviour` / `downloadBehaviour` map an exact path (or a prefix ending
// in '*') to 'ok' | 'timeout' | 'error' so a test can reproduce the exact
// failure the production logs show.
function fakeSupabase(config) {
  const cfg = config || {};
  const files = cfg.files || {};
  const listBehaviour = cfg.listBehaviour || {};
  const downloadBehaviour = cfg.downloadBehaviour || {};
  const calls = { list: [], download: [] };

  function behaviourFor(map, key) {
    if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
    const wild = Object.keys(map).filter((k) => k.endsWith('*'));
    for (const w of wild) {
      if (key.startsWith(w.slice(0, -1))) return map[w];
    }
    return 'ok';
  }

  function childrenOf(prefix) {
    const base = prefix ? prefix.replace(/\/$/, '') + '/' : '';
    const seen = new Map();
    Object.keys(files).forEach((full) => {
      if (base && !full.startsWith(base)) return;
      const rest = full.slice(base.length);
      if (!rest) return;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        seen.set(rest, { name: rest, id: 'id-' + rest, metadata: { size: files[full].size } });
      } else {
        const folder = rest.slice(0, slash);
        if (!seen.has(folder)) seen.set(folder, { name: folder, id: null, metadata: null });
      }
    });
    return Array.from(seen.values());
  }

  const api = {
    list(prefix, opts) {
      calls.list.push({ prefix, opts });
      const b = behaviourFor(listBehaviour, prefix || '');
      if (b === 'timeout') return Promise.reject(new Error('List timed out after 15000ms'));
      if (b === 'error') return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: childrenOf(prefix || ''), error: null });
    },
    download(p) {
      calls.download.push(p);
      const b = behaviourFor(downloadBehaviour, p);
      if (b === 'fail') return Promise.resolve({ data: null, error: { message: 'download failed' } });
      if (b === 'timeout') return new Promise(() => {});
      const f = files[p];
      if (!f) return Promise.resolve({ data: null, error: { message: 'Object not found' } });
      const body = f.body !== undefined ? f.body : 'x'.repeat(Math.min(f.size || 1, 1024));
      return Promise.resolve({ data: { size: f.size || body.length, _body: body }, error: null });
    },
    createSignedUrls(paths) {
      return Promise.resolve({
        data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.test/' + p })),
        error: null
      });
    },
    upload() { return Promise.resolve({ data: {}, error: null }); },
    remove() { return Promise.resolve({ data: {}, error: null }); }
  };

  return {
    storage: { from: () => api },
    rpc: () => Promise.resolve({ data: null, error: { message: 'rpc not stubbed' } }),
    _calls: calls
  };
}

module.exports = { fakeSupabase };
```

- [ ] **Step 5: Write `package.json`**

```json
{
  "name": "blitzkrieg-by-dominatemedia",
  "version": "1.0.0",
  "private": true,
  "description": "Adobe CEP panel for the Dominate Media cloud template library",
  "scripts": {
    "test": "node --test test/"
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 2 tests.

If `loadModule` throws because `cloud-library.js` references a global the stub lacks, add that global to `sandbox` in `load-module.js`. Do not modify `cloud-library.js` to make the harness work.

- [ ] **Step 7: Wire the suite into CI as a blocking gate**

In `.github/workflows/ci.yml`, add a step to the existing job, after the syntax check:

```yaml
      - name: Unit tests
        run: node --test test/
```

A gate blocks. Do not add `continue-on-error`.

- [ ] **Step 8: Commit**

```bash
git add package.json test/ .github/workflows/ci.yml
git commit -m "test: add node:test harness with IIFE loader and supabase stub"
```

---

## Task 2: Windows OTA installs to the per-user extension folder (F13)

Ships first. Abdul Haseeb has 58 consecutive failed updates since June because `Folder.create()` is denied under `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions`. Until this lands, some editors cannot receive any other fix in this plan.

**Files:**
- Modify: `jsx/hostscript.jsx` (add `getUserExtensionsRoot()`)
- Modify: `js/main.js:8786-8815` (`_extensionRootFromLocation`, `_resolveExtensionRoot`)
- Test: `test/update-target.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `chooseUpdateTarget(currentRoot, userRoot, platform) -> { target: string, needsMigration: boolean }`, exported on `window.__blitzUpdateTargetForTest` so the test can reach it without a CEP bridge.

- [ ] **Step 1: Write the failing test**

Create `test/update-target.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');

function target(current, user, platform) {
  const { window } = loadModule('js/main.js');
  return window.__blitzUpdateTargetForTest(current, user, platform);
}

test('a machine-wide Windows install redirects to the per-user folder', () => {
  const r = target(
    'C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\Blitzkrieg-by-Dominatemedia-main',
    'C:\\Users\\abdul\\AppData\\Roaming\\Adobe\\CEP\\extensions',
    'windows'
  );
  assert.strictEqual(
    r.target,
    'C:\\Users\\abdul\\AppData\\Roaming\\Adobe\\CEP\\extensions\\Blitzkrieg-by-Dominatemedia-main'
  );
  assert.strictEqual(r.needsMigration, true);
});

test('an existing per-user Windows install updates in place', () => {
  const current = 'C:\\Users\\abdul\\AppData\\Roaming\\Adobe\\CEP\\extensions\\Blitzkrieg-by-Dominatemedia-main';
  const r = target(current, 'C:\\Users\\abdul\\AppData\\Roaming\\Adobe\\CEP\\extensions', 'windows');
  assert.strictEqual(r.target, current);
  assert.strictEqual(r.needsMigration, false);
});

test('macOS installs are left alone', () => {
  const current = '/Users/p/Library/Application Support/Adobe/CEP/extensions/Blitzkrieg';
  const r = target(current, '/Users/p/Library/Application Support/Adobe/CEP/extensions', 'mac');
  assert.strictEqual(r.target, current);
  assert.strictEqual(r.needsMigration, false);
});

test('a null user root falls back to updating in place rather than throwing', () => {
  const current = 'C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\Blitzkrieg';
  const r = target(current, null, 'windows');
  assert.strictEqual(r.target, current);
  assert.strictEqual(r.needsMigration, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/update-target.test.js`
Expected: FAIL, `window.__blitzUpdateTargetForTest is not a function`.

- [ ] **Step 3: Implement `chooseUpdateTarget` in `js/main.js`**

Add near `_extensionRootFromLocation` (around line 8786):

```js
    // A machine-wide CEP install (Program Files / Common Files on Windows) is not
    // writable without elevation, so Folder.create() returns false and every OTA
    // update fails forever. Adobe loads extensions from the per-user folder too,
    // so redirect the install there and let the old copy be superseded.
    function chooseUpdateTarget(currentRoot, userRoot, platform) {
        if (!currentRoot) return { target: currentRoot, needsMigration: false };
        if (platform !== 'windows' || !userRoot) {
            return { target: currentRoot, needsMigration: false };
        }
        var lowered = currentRoot.toLowerCase();
        var machineWide = lowered.indexOf('\\program files') !== -1 ||
                          lowered.indexOf('\\programdata') !== -1;
        if (!machineWide) return { target: currentRoot, needsMigration: false };

        var leaf = currentRoot.replace(/[\\/]+$/, '').split('\\').pop();
        var base = userRoot.replace(/[\\/]+$/, '');
        return { target: base + '\\' + leaf, needsMigration: true };
    }
    window.__blitzUpdateTargetForTest = chooseUpdateTarget;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/update-target.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the ExtendScript side**

In `jsx/hostscript.jsx`, add (ES3 only, no `const`, no arrow functions):

```javascript
// Per-user CEP extensions folder. Writable without elevation on Windows, which
// the machine-wide Common Files location is not.
function getUserExtensionsRoot() {
    try {
        var base = Folder.userData.fsName; // Win: AppData\Roaming, Mac: ~/Library/Application Support
        var p = buildPath(buildPath(buildPath(base, 'Adobe'), 'CEP'), 'extensions');
        var f = folderFromPath(p);
        if (f && !f.exists) { f.create(); }
        return JSON.stringify({ ok: true, path: p });
    } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
    }
}
```

- [ ] **Step 6: Use it in the update flow**

In `js/main.js`, in the function that resolves the root before install (around `:9426-9439`), call `getUserExtensionsRoot()` through `safeEvalScript`, pass the result into `chooseUpdateTarget`, and install to `target`. When `needsMigration` is true, log it:

```js
    if (decision.needsMigration) {
        debugLog('Update: machine-wide install detected at ' + currentRoot +
                 ', installing to the per-user folder instead: ' + decision.target, 'warn');
    }
```

Keep the existing `_failUpdate` path intact for the case where both roots are unresolvable.

- [ ] **Step 7: Manual verification on Windows**

This cannot be verified from macOS. Before claiming this task done, have a Windows editor (Abdul Haseeb is the highest-value case) confirm the panel updates without the stuck banner. Then confirm with:

```sql
select message, created_at from blitzkrieg_error_logs
where message ilike 'Update%failed%' and created_at > now() - interval '2 days'
order by created_at desc;
```

Expected: zero new `mkdir failed` rows for that user after the update lands.

- [ ] **Step 8: Commit**

```bash
git add js/main.js jsx/hostscript.jsx test/update-target.test.js
git commit -m "fix(update): install to per-user CEP folder when the machine-wide root is not writable"
```

---

## Task 3: Consolidate the 26 permissive SELECT policies on storage.objects (F9) [BACKEND]

This is the single highest-leverage change for "super slow". A prefix scan measured 39ms as service role and 11.5s under RLS, because every one of 26 permissive SELECT policies is OR-ed into one filter evaluated per row, dragging in auth functions belonging to unrelated buckets.

Petter chose the portal-wide consolidation over the Blitzkrieg-only workaround, so this touches read access for all 24 buckets. It gets its own PR and its own per-bucket verification matrix.

**Files:**
- Create: `supabase/migrations/<timestamp>_consolidate_storage_objects_select_policies.sql`
- Create: `test/rls-matrix.md` (the recorded before/after evidence, not code)

**Interfaces:**
- Consumes: nothing.
- Produces: a single `storage_objects_unified_select` policy replacing the 26 permissive SELECT policies.

- [ ] **Step 1: Capture the baseline, before touching anything**

```sql
select policyname, permissive, roles, qual
from pg_policies
where schemaname='storage' and tablename='objects' and cmd='SELECT'
order by policyname;
```

Save the full output verbatim into `test/rls-matrix.md` under a `## Before` heading. This is the rollback reference. Do not proceed without it.

- [ ] **Step 2: Record the per-bucket access truth table**

For each of the 24 buckets, record who is currently allowed to SELECT. Derive it from the `qual` column captured in Step 1, one row per bucket, into `test/rls-matrix.md`:

| bucket | allowed to read | policy it came from |
|--------|-----------------|---------------------|

This table is the contract the new single policy must reproduce exactly. Any bucket whose row you cannot determine from the `qual` text is a blocker: stop and ask, do not guess.

- [ ] **Step 3: Write the failing verification query**

Before writing the migration, write the check that proves the consolidation is correct. Save as `test/rls-matrix.sql`:

```sql
-- Run as an authenticated (non-admin editor) JWT, not service role.
-- Returns one row per bucket with the count of objects visible.
select bucket_id, count(*) as visible
from storage.objects
group by bucket_id
order by bucket_id;
```

Run it now under a real editor JWT and record the result in `test/rls-matrix.md` under `## Before: visible counts`. Service-role and MCP reads bypass RLS entirely and will silently show everything, which is exactly the mask this project has been bitten by before. Use a user token.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/<timestamp>_consolidate_storage_objects_select_policies.sql`. Fill the `CASE` arms from the truth table built in Step 2. Illustrative shape, with the blitzkrieg arm made concrete:

```sql
begin;

-- 26 permissive SELECT policies were OR-ed into a single per-row filter, so a
-- scan of the blitzkrieg bucket also evaluated the auth functions of 23 other
-- buckets. Measured: 39ms service-role vs 11.5s under RLS on the same prefix.
-- One policy with a bucket_id dispatch makes each row evaluate exactly one arm.

drop policy if exists "blitzkrieg_read" on storage.objects;
-- ... drop the remaining 25 by their exact names from the Before capture ...

create policy "storage_objects_unified_select"
on storage.objects
for select
to authenticated
using (
  case bucket_id
    when 'blitzkrieg' then public.has_blitzkrieg_access()
    -- ... one arm per bucket, transcribed from the truth table ...
    else false
  end
);

commit;
```

`else false` is deliberate: default-deny. A bucket accidentally omitted from the `CASE` becomes unreadable, which surfaces loudly in Step 6 rather than silently widening access.

- [ ] **Step 5: Apply the migration**

Apply via the Supabase MCP `apply_migration`. Confirm only one worktree is applying migrations right now.

- [ ] **Step 6: Run the verification matrix and diff it**

Re-run `test/rls-matrix.sql` under the SAME editor JWT used in Step 3. Record under `## After: visible counts`.

Expected: every bucket's visible count is **identical** to the Before capture. A bucket that went to zero is a broken arm in the `CASE`. A bucket that went up means access was widened, which is a security regression and a hard stop.

- [ ] **Step 7: Measure the speedup**

```sql
explain (analyze, buffers)
select name, id, updated_at, metadata from storage.objects
where bucket_id='blitzkrieg' and name like 'Backgrounds/%'
order by name limit 100;
```

Run under an editor JWT. Expected: execution time drops from ~11.5s to under 200ms. Record both numbers in `test/rls-matrix.md`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/ test/rls-matrix.md test/rls-matrix.sql
git commit -m "perf(storage): collapse 26 permissive SELECT policies into one bucket-dispatched policy"
```

---

## Task 4: downloadTemplate reports bundle completeness instead of silently degrading (F4, F5)

The core of "project files are missing". Two separate silent-degradation paths return a bundle that looks identical to a complete one.

**Files:**
- Modify: `js/cloud-library.js:1906-2014`
- Test: `test/bundle-completeness.test.js`

**Interfaces:**
- Consumes: `loadModule`, `fakeSupabase` from Task 1.
- Produces: `downloadTemplate(storagePath)` now resolves to
  `{ blob, fileName, storagePath, extraFiles, complete: boolean, missing: string[], reason: string|null }`.
  `complete` is `false` whenever the caller is not holding every import-essential asset. `missing` holds storage paths. `reason` is one of `'list-failed'`, `'assets-failed'`, `'oversized'`, or `null`.
  Task 5 and Task 7 both read these three fields.

- [ ] **Step 1: Write the failing test**

Create `test/bundle-completeness.test.js`:

```js
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
  assert.deepStrictEqual(r.missing, []);
  assert.strictEqual(r.reason, null);
});

test('a list timeout yields an incomplete bundle, not a silent AEP-only success', async () => {
  const { lib } = libWith({
    files: { [TPL + '/template.aep']: { size: 1000 } },
    listBehaviour: { [TPL]: 'timeout', [TPL + '*']: 'timeout' }
  });
  const r = await lib.downloadTemplate(TPL);
  assert.ok(r.blob, 'the .aep should still come through');
  assert.strictEqual(r.complete, false);
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
  assert.strictEqual(r.extraFiles.length, 1, 'the good asset must survive');
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.reason, 'assets-failed');
  assert.deepStrictEqual(r.missing, [TPL + '/(Footage)/bad.mp4']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/bundle-completeness.test.js`
Expected: FAIL. The first test fails on `r.complete` being `undefined`; the third fails because `extraFiles.length` is `0`, which is the bug.

- [ ] **Step 3: Replace the list-failure branch**

In `js/cloud-library.js`, replace lines 1930-1937 with:

```js
        var allFiles = [];
        var bundleComplete = true;
        var bundleMissing = [];
        var bundleReason = null;

        try {
            allFiles = await collectAllFiles(storagePath, { _timeoutMs: 45000 });
        } catch (listErr) {
            if (!chosenAepPath) throw listErr; // no .aep yet AND cannot list -> real failure
            // We have the .aep but cannot enumerate its footage. Returning here used
            // to look identical to a complete bundle, so the caller cached it as good
            // and the footage never arrived. Report it instead.
            _log('downloadTemplate: asset listing failed (' + (listErr && listErr.message || listErr) +
                 '); bundle is INCOMPLETE for ' + storagePath, 'warn');
            allFiles = [chosenAepPath];
            bundleComplete = false;
            bundleReason = 'list-failed';
        }
```

- [ ] **Step 4: Replace the all-or-nothing asset download**

Replace lines 1986-1995 with a per-file settle so one bad asset cannot discard the rest:

```js
        var extras = [];
        if (extraPaths.length > 0) {
            var settled = await downloadStorageFilesSettled(extraPaths, storagePath, 6);
            extras = settled.ok;
            if (settled.failed.length > 0) {
                bundleComplete = false;
                bundleReason = bundleReason || 'assets-failed';
                bundleMissing = bundleMissing.concat(settled.failed);
                _log('downloadTemplate: ' + settled.failed.length + ' of ' + extraPaths.length +
                     ' bundle asset(s) failed for ' + storagePath + '; bundle is INCOMPLETE', 'warn');
            } else {
                _log('downloadTemplate: downloaded AEP + ' + extras.length +
                     ' bundle asset(s) for ' + storagePath, 'info');
            }
        }
```

- [ ] **Step 5: Add `downloadStorageFilesSettled`**

Add next to the existing `downloadStorageFiles`. Do not change `downloadStorageFiles` itself; other callers rely on its throwing contract.

```js
    // Like downloadStorageFiles but never rejects on a single failure. Returns
    // {ok: [...downloaded], failed: [...storagePaths]} so the caller can decide
    // whether a partial bundle is acceptable rather than having that decided
    // for it by a swallowed catch.
    async function downloadStorageFilesSettled(paths, storagePath, concurrency) {
        var ok = [];
        var failed = [];
        var idx = 0;

        async function worker() {
            while (idx < paths.length) {
                var myIdx = idx++;
                var p = paths[myIdx];
                try {
                    var one = await downloadStorageFiles([p], storagePath, 1);
                    if (one && one.length) { ok.push(one[0]); }
                    else { failed.push(p); }
                } catch (e) {
                    failed.push(p);
                }
            }
        }

        var workers = [];
        var n = Math.min(concurrency || 6, paths.length);
        for (var w = 0; w < n; w++) workers.push(worker());
        await Promise.all(workers);
        return { ok: ok, failed: failed };
    }
```

- [ ] **Step 6: Return the new fields**

Replace the return at lines 2008-2013:

```js
        return {
            blob: aepBlob,
            fileName: chosenAepPath.split('/').pop(),
            storagePath: chosenAepPath,
            extraFiles: depExtras.length > 0 ? extras.concat(depExtras) : extras,
            complete: bundleComplete,
            missing: bundleMissing,
            reason: bundleReason
        };
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/bundle-completeness.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
git add js/cloud-library.js test/bundle-completeness.test.js
git commit -m "fix(import): report bundle completeness instead of silently degrading to AEP-only"
```

---

## Task 5: A partial bundle never marks the mirror complete (F6)

This is what makes the bug permanent. `_doMirrorImport` calls `markTemplateComplete` unconditionally, so an AEP-only mirror is cached as current and the fast path serves it forever.

**Files:**
- Modify: `js/main.js:4945-4983`
- Modify: `js/local-sync.js` (add `markTemplatePartial`)
- Test: `test/bundle-completeness.test.js` (extend)

**Interfaces:**
- Consumes: `downloaded.complete`, `downloaded.missing`, `downloaded.reason` from Task 4.
- Produces: `window.localSync.markTemplatePartial(storagePath, aepDiskPath, version, missingPaths)` which records the mirror as present but NOT content-current, so the next import re-fetches.

- [ ] **Step 1: Write the failing test**

Append to `test/bundle-completeness.test.js`:

```js
test('localSync exposes markTemplatePartial and it does not set contentCurrent', async () => {
  const { exports: sync } = loadModule('js/local-sync.js');
  assert.strictEqual(typeof sync.markTemplatePartial, 'function');
  await sync.markTemplatePartial(TPL, '/tmp/x.aep', '1.3.21', [TPL + '/(Footage)/bad.mp4']);
  const st = await sync.getTemplateState(TPL);
  assert.strictEqual(st.contentCurrent, false, 'a partial mirror must not read as current');
  assert.strictEqual(st.partial, true);
  assert.deepStrictEqual(st.missing, [TPL + '/(Footage)/bad.mp4']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/bundle-completeness.test.js`
Expected: FAIL, `sync.markTemplatePartial is not a function`.

- [ ] **Step 3: Implement `markTemplatePartial` in `js/local-sync.js`**

Mirror the shape of the existing `markTemplateComplete`, but write `contentCurrent: false` plus the partial fields:

```js
    // A mirror that exists on disk but is KNOWN to be missing assets. Deliberately
    // leaves contentCurrent false so the fast path re-fetches instead of serving
    // an incomplete template forever.
    function markTemplatePartial(storagePath, aepDiskPath, version, missingPaths) {
        var state = _readState();
        state[storagePath] = {
            aepPath: aepDiskPath,
            version: version,
            contentCurrent: false,
            partial: true,
            missing: missingPaths || [],
            updatedAt: Date.now()
        };
        return _writeState(state);
    }
```

Export it on the `window.localSync` namespace alongside `markTemplateComplete`.

- [ ] **Step 4: Gate the completion call in `js/main.js`**

In `_doMirrorImport`, replace the `.then(function(aepDiskPath) {` block at line 4957:

```js
        }).then(function(aepDiskPath) {
            var mark = downloaded.complete
                ? window.localSync.markTemplateComplete(storagePath, aepDiskPath, impVer)
                : window.localSync.markTemplatePartial(storagePath, aepDiskPath, impVer, downloaded.missing);

            if (!downloaded.complete) {
                debugLog('IMPORT: bundle incomplete (' + downloaded.reason + '), ' +
                         downloaded.missing.length + ' file(s) missing for ' + storagePath, 'warn');
            }
            return mark.then(function () {
```

`downloaded` must be captured in the enclosing scope. Hoist `var downloaded = null;` beside `var mirrorDir = null;` and assign it in the preceding `.then`.

Leave the `syncThumbnail` block and the rest of the chain unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/bundle-completeness.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Regression guard on the import path**

The import must still succeed for the user even when the bundle is partial. Confirm by reading the chain: `_doImportLocalAep(aepDiskPath, ...)` is still called on both branches. A partial import is degraded, not blocked. Do not add an early return that skips the import.

- [ ] **Step 7: Commit**

```bash
git add js/main.js js/local-sync.js test/bundle-completeness.test.js
git commit -m "fix(sync): never mark an incomplete mirror content-current"
```

---

## Task 6: Stream large footage to disk and remove the 300MB cap (F7, F8)

Petter's call: stream to disk, drop the cap. The cap exists because buffering a 1.7GB file whole in the CEP Chromium heap hangs the download. Streaming to disk in chunks removes the reason for the cap. 18 templates are currently affected.

**Files:**
- Modify: `js/cloud-library.js:1730-1736` (the cap), `:2012-2020` (the skip and its log)
- Modify: `jsx/hostscript.jsx` (add `appendChunkToFile`)
- Test: `test/streaming-download.test.js`

**Interfaces:**
- Consumes: `downloadStorageFilesSettled` from Task 4.
- Produces: `streamToDisk(storagePath, destPath, onProgress) -> Promise<{bytes: number}>`, used by `mirrorTemplate` for any file above `STREAM_THRESHOLD_BYTES`.

- [ ] **Step 1: Write the failing test**

Create `test/streaming-download.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

test('a file above the streaming threshold is streamed, not skipped', async () => {
  const big = 'Backgrounds/Demo_1/(Footage)/Raw Cam.mp4';
  const sb = fakeSupabase({
    files: {
      'Backgrounds/Demo_1/template.aep': { size: 1000 },
      [big]: { size: 1740 * 1024 * 1024 }
    }
  });
  const written = [];
  const { exports: lib } = loadModule('js/cloud-library.js', {
    blitzkriegSupabase: sb,
    __blitzStreamSink: (destPath, chunk) => { written.push({ destPath, len: chunk.length }); }
  });
  const r = await lib.mirrorTemplate('Backgrounds/Demo_1');
  assert.strictEqual(r.skippedLarge.length, 0, 'nothing should be skipped for size any more');
  assert.ok(written.length > 0, 'the large file should have been streamed to disk');
});

test('mirrorTemplate reports skippedLarge so callers can surface it', async () => {
  const sb = fakeSupabase({ files: { 'Backgrounds/Demo_2/template.aep': { size: 10 } } });
  const { exports: lib } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
  const r = await lib.mirrorTemplate('Backgrounds/Demo_2');
  assert.ok(Array.isArray(r.skippedLarge), 'skippedLarge must be an array, not a bare count');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/streaming-download.test.js`
Expected: FAIL, `r.skippedLarge` is `undefined` (today `mirrorTemplate` returns only `skippedCount`).

- [ ] **Step 3: Add the ExtendScript chunk writer**

In `jsx/hostscript.jsx` (ES3 only):

```javascript
// Append one base64 chunk to a binary file. CEP cannot hand a multi-GB Blob to
// ExtendScript in one piece without hanging the Chromium heap, so the JS side
// streams it in bounded chunks and each one lands here.
function appendChunkToFile(destPath, b64Chunk, isFirst) {
    try {
        var f = fileFromPath(destPath);
        f.encoding = 'BINARY';
        if (!f.open(isFirst ? 'w' : 'a')) {
            return JSON.stringify({ ok: false, error: 'could not open ' + destPath });
        }
        f.write(base64Decode(b64Chunk));
        f.close();
        return JSON.stringify({ ok: true });
    } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
    }
}
```

`base64Decode` must be the repo's existing ES3 decoder. Do not call `atob`: it does not exist in ExtendScript, and reaching for it is the exact class of bug already recorded against this codebase.

- [ ] **Step 4: Add `streamToDisk` in `js/cloud-library.js`**

```js
    // Chunk size for streaming a large object to disk. Small enough that no single
    // slice sits in the CEP heap long enough to stall the panel, large enough that
    // the per-chunk evalScript round-trip is not the bottleneck.
    var STREAM_CHUNK_BYTES = 8 * 1024 * 1024;
    // Files at or above this size go to disk in chunks instead of being buffered
    // whole. This replaces the old MIRROR_MAX_FOOTAGE_BYTES skip: nothing is
    // dropped for being large any more, it just takes a different route.
    var STREAM_THRESHOLD_BYTES = 64 * 1024 * 1024;

    async function streamToDisk(objectPath, destPath, onProgress) {
        var res = await sb.storage.from(BUCKET).download(objectPath);
        if (res.error || !res.data) {
            throw new Error('stream download failed for ' + objectPath + ': ' +
                            (res.error && res.error.message || 'unknown'));
        }
        var blob = res.data;
        var total = blob.size || 0;
        var offset = 0;
        var isFirst = true;

        while (offset < total) {
            var end = Math.min(offset + STREAM_CHUNK_BYTES, total);
            var slice = blob.slice(offset, end);
            var b64 = await _blobToBase64(slice);
            var out = await _writeChunk(destPath, b64, isFirst);
            if (!out || !out.ok) {
                throw new Error('chunk write failed at offset ' + offset + ': ' +
                                (out && out.error || 'unknown'));
            }
            isFirst = false;
            offset = end;
            if (onProgress) onProgress(offset, total);
        }
        return { bytes: total };
    }
```

`_writeChunk` routes through `window.__blitzStreamSink` when present (the test seam) and otherwise through `safeEvalScript('appendChunkToFile(...)')` with `escapeForExtendScript` applied to both paths.

- [ ] **Step 5: Remove the cap and use streaming in `mirrorTemplate`**

Delete `MIRROR_MAX_FOOTAGE_BYTES` (line 1736) and its comment block (lines 1730-1735). At the skip site around line 2012, route by size instead of skipping:

```js
                if (fileSize >= STREAM_THRESHOLD_BYTES) {
                    await streamToDisk(filePath, destPath, null);
                } else {
                    // existing buffered write
                }
```

Keep a `skippedLarge` array in the return value, now populated only when a stream genuinely fails, never as a size policy. Change the return at line 2083 from `skippedCount` to `{ skippedLarge: [...], skippedCount: skippedLarge.length }` so existing readers of `skippedCount` keep working.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/streaming-download.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 7: Verify against the live system**

After deploying, confirm the skip stops happening:

```sql
select count(*) as oversized_skips
from blitzkrieg_error_logs
where message ilike '%oversized footage%'
  and created_at > now() - interval '2 days';
```

Expected: 0. Baseline for comparison is 137 events across 18 templates in the prior 30 days.

Then prove a specific previously-broken template imports whole. Use `Backgrounds/Bright-White-Clean-Background_1768566428279` (a confirmed offender): import it in AE and confirm no offline footage in the project panel.

- [ ] **Step 8: Commit**

```bash
git add js/cloud-library.js jsx/hostscript.jsx test/streaming-download.test.js
git commit -m "feat(sync): stream large footage to disk and remove the 300MB skip"
```

---

## Task 7: Surface partial templates honestly (F8)

`mirrorTemplate` has returned `skippedCount` all along and nothing ever read it. With Tasks 4 to 6 producing real completeness data, the UI has to show it. Silent degradation is what destroyed trust here.

**Files:**
- Modify: `js/main.js` (import result handling, card rendering)
- Modify: `CSS/style.css` (the badge)

**Interfaces:**
- Consumes: `state.partial` and `state.missing` from Task 5, `skippedLarge` from Task 6.
- Produces: no new API.

- [ ] **Step 1: Add the badge style**

In `CSS/style.css`, using existing tokens only:

```css
.card-partial-badge {
    position: absolute;
    top: var(--sp-2);
    left: var(--sp-2);
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    border: 1px solid var(--warning);
    color: var(--warning);
    font-size: 11px;
    line-height: 1;
}
```

- [ ] **Step 2: Render the badge on partial templates**

In the card render path, when `localSync.getTemplateState(storagePath).partial` is true, inject:

```js
        if (st && st.partial) {
            badgeHtml = '<span class="card-partial-badge" title="' +
                        escapeHTML(st.missing.length + ' file(s) did not download. Re-import to retry.') +
                        '">Incomplete</span>';
        }
```

- [ ] **Step 3: Tell the user at import time**

In `_doMirrorImport`, on the partial branch, replace the silent path with a real message. Not a save toast, this is a genuine warning:

```js
            if (!downloaded.complete) {
                showToast('Imported without ' + downloaded.missing.length +
                          ' asset(s). Re-import to retry the missing files.', 'warn');
            }
```

Read it out loud before shipping. No em dashes, no arrows, no sales-page phrasing.

- [ ] **Step 4: Verify in a logged-in panel**

Open the panel in AE, force a partial by importing while offline mid-transfer, and confirm: the toast appears, the card shows the Incomplete badge, and re-importing clears both once the assets land. A screenshot of the badge on the actual route is required before calling this done.

- [ ] **Step 5: Commit**

```bash
git add js/main.js CSS/style.css
git commit -m "feat(ui): surface incomplete templates instead of failing silently"
```

---

## Task 8: Give the root listing its own RPC (F1, F13-adjacent)

The `if (catName)` gate at `js/cloud-library.js:1182` means the root list can never use the fast RPC, so it always pays the full ~110s ladder. `blitzkrieg_list_folders` measured 51ms mean in production against 15s client timeouts, so the RPC route is 116x faster.

**Files:**
- Create: `supabase/migrations/<timestamp>_blitzkrieg_list_root_rpc.sql`
- Modify: `js/cloud-library.js:1110`, `:1182`

- [ ] **Step 1: Write the migration**

```sql
begin;

-- Root listing cannot use blitzkrieg_list_folders because root must also surface
-- archive files and the manifest, not just folders. This returns both shapes in
-- one index-only pass so the client never falls back to storage.search for root.
create or replace function public.blitzkrieg_list_root()
returns table(name text, is_folder boolean)
language sql
stable
security definer
set search_path to 'public', 'storage', 'pg_temp'
as $$
  select distinct
    split_part(o.name, '/', 1) as name,
    position('/' in o.name) > 0 as is_folder
  from storage.objects o
  where o.bucket_id = 'blitzkrieg'
    and public.has_blitzkrieg_access()
$$;

revoke all on function public.blitzkrieg_list_root() from public;
grant execute on function public.blitzkrieg_list_root() to authenticated;

commit;
```

The `has_blitzkrieg_access()` call is inside the function body so a SECURITY DEFINER function cannot become an access bypass. Verify that: a user without access must get zero rows, not an error and not the full list.

- [ ] **Step 2: Prove the guard under a non-access JWT**

Call `blitzkrieg_list_root()` with a token for a user lacking blitzkrieg access. Expected: 0 rows. If it returns rows, the function is a privilege escalation and must not ship.

- [ ] **Step 3: Use it in the client**

At `js/cloud-library.js:1110`, try the RPC first and fall back to the existing ladder only if it errors:

```js
        var allRootItems = null;
        try {
            allRootItems = await _listRootViaRpc();
        } catch (rpcErr) {
            _log('[cloud] root RPC failed (' + (rpcErr && rpcErr.message || rpcErr) +
                 '); falling back to storage list', 'warn');
            allRootItems = await listCategoryWithRetry('', 2, { column: 'name', order: 'asc' });
        }
```

Note the retry count drops from 3 to 2 on the fallback: Task 9 covers why the 60s third attempt is pure waste.

- [ ] **Step 4: Verify the timing**

Cold-open the panel with the localStorage cache and manifest both cleared, and time to interactive grid. Target: under 5s. Record the number.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ js/cloud-library.js
git commit -m "perf(list): add blitzkrieg_list_root RPC so root never hits storage.search"
```

---

## Task 9: List ladder discipline (F2, F3)

Two defects compound: a timed-out attempt is never aborted, so retries stack three live queries on the same pooler instead of relieving it; and there is no ceiling on the total listing phase, only per-attempt timeouts.

**Files:**
- Modify: `js/cloud-library.js:361` (timeouts), `:377-386` (`_listWithTimeout`), `:1183-1188` (RPC memoization), `:1269` (concurrency)
- Test: `test/list-ladder.test.js`

**Interfaces:**
- Produces: `LIST_TIMEOUT_BY_ATTEMPT` becomes `[15000, 30000]`; a module-level `_listPhaseDeadline` bounds the whole phase.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { loadModule } = require('./helpers/load-module');
const { fakeSupabase } = require('./helpers/fake-supabase');

test('a timed-out list attempt aborts its in-flight request', async () => {
  let aborted = false;
  const sb = fakeSupabase({ listBehaviour: { 'X': 'timeout' } });
  const orig = sb.storage.from('blitzkrieg').list;
  sb.storage.from('blitzkrieg').list = (p, opts) => {
    if (opts && opts.signal) opts.signal.addEventListener('abort', () => { aborted = true; });
    return orig(p, opts);
  };
  const { exports: lib } = loadModule('js/cloud-library.js', { blitzkriegSupabase: sb });
  await lib.listCategory('X').catch(() => {});
  assert.strictEqual(aborted, true, 'the timed-out attempt must abort, not leak a live query');
});

test('the retry ladder tops out at two attempts', () => {
  const { window } = loadModule('js/cloud-library.js', { blitzkriegSupabase: fakeSupabase({}) });
  assert.deepStrictEqual(window.__blitzListTimeoutsForTest, [15000, 30000]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/list-ladder.test.js`
Expected: FAIL on both.

- [ ] **Step 3: Drop the 60s third attempt**

At `js/cloud-library.js:361`:

```js
    // A storage.list that already failed at 30s does not succeed at 60s; the third
    // attempt only held the spinner up for another minute. Two attempts, then
    // degrade to whatever the manifest already has.
    var LIST_TIMEOUT_BY_ATTEMPT = [15000, 30000];
    window.__blitzListTimeoutsForTest = LIST_TIMEOUT_BY_ATTEMPT;
```

- [ ] **Step 4: Make `_listWithTimeout` actually abort**

Replace the `Promise.race` at `:377-386` so the timeout path aborts the underlying request before rejecting:

```js
    function _listWithTimeout(prefix, opts, timeoutMs) {
        var controller = null;
        try { if (typeof AbortController === 'function') controller = new AbortController(); } catch (e) {}
        var timer = null;

        var timeout = new Promise(function (_, reject) {
            timer = setTimeout(function () {
                // Without this abort the attempt stays live on the pooler while the
                // next attempt opens another, so the ladder ADDS load to a backend
                // that is already failing.
                if (controller) { try { controller.abort(); } catch (e) {} }
                reject(new Error('List timed out after ' + timeoutMs + 'ms'));
            }, timeoutMs);
        });

        var listOpts = Object.assign({}, opts || {});
        if (controller) listOpts.signal = controller.signal;

        var call = sb.storage.from(BUCKET).list(prefix, listOpts).then(function (r) {
            if (timer) { clearTimeout(timer); timer = null; }
            return r;
        }, function (e) {
            if (timer) { clearTimeout(timer); timer = null; }
            throw e;
        });

        return Promise.race([call, timeout]);
    }
```

- [ ] **Step 5: Memoize the RPC failure per load**

At `:1183-1188`, the fast RPC is retried per category with no memoization, adding 15s times N of pure waste when the RPC itself is down. Add a session flag:

```js
    var _rpcFolderListDown = false;
```

Check it before attempting the RPC, set it on failure, and clear it at the start of each `listTemplates` run.

- [ ] **Step 6: Raise category concurrency**

At `:1269`, `LIST_CAT_CONCURRENCY = 2` was a defensive choice against a backend that Task 3 fixes. Raise to 6. Do not raise further without re-measuring: uncapped fan-out is what produced the 0.4s-apart burst in the logs.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/list-ladder.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 8: Commit**

```bash
git add js/cloud-library.js test/list-ladder.test.js
git commit -m "perf(list): abort timed-out attempts, drop the 60s retry, memoize RPC failure"
```

---

## Task 10: Stop the per-hover preview list storm (F12)

Every first hover on a card issues a paginated storage list of that template's preview folder. A mouse sweep across the grid fires one list per card.

**Files:**
- Modify: `js/main.js:3205`

- [ ] **Step 1: Debounce the hover intent**

Only start the preview fetch after 250ms of sustained hover, so a sweep across the grid fires nothing:

```js
    var _hoverTimer = null;
    function onCardMouseEnter(storagePath) {
        if (_hoverTimer) clearTimeout(_hoverTimer);
        _hoverTimer = setTimeout(function () { _beginPreviewLoad(storagePath); }, 250);
    }
    function onCardMouseLeave() {
        if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
    }
```

- [ ] **Step 2: Cache negative results**

A template whose preview listing failed currently re-lists on every hover. Cache the failure for the session so a broken template costs one list, not one per hover.

- [ ] **Step 3: Prefer the metadata frame count**

`previewFrameCount` is already in metadata. When it is present, sign the frame paths directly and skip the list entirely. Fall back to listing only when the count is absent.

- [ ] **Step 4: Verify**

Open the panel, sweep the mouse across 30 cards quickly, and confirm in the debug log that fewer than 3 preview lists were issued. Before this change it is one per card.

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "perf(ui): debounce hover preview loads and cache negative listings"
```

---

## Task 11: Let non-admins publish the manifest (F10)

19 logged `uploadManifest: new row violates row-level security policy` errors. Only admins can publish, so a non-admin editor pays a full bucket scan on every stale-manifest load and can never heal it. This is the self-reinforcing loop that keeps editors on the slow path.

**Files:**
- Create: `supabase/migrations/<timestamp>_blitzkrieg_manifest_publish.sql`
- Modify: `js/cloud-library.js:514`, `:599`

- [ ] **Step 1: Decide the publishing surface**

Two options. Prefer the second.

1. Widen the storage RLS policy so any authenticated user with blitzkrieg access can write the manifest object. Simple, but any editor can now overwrite a shared artefact.
2. Move publication behind a SECURITY DEFINER RPC that validates the manifest shape and writes it server-side. The client never writes the object directly.

Take option 2. Write `blitzkrieg_publish_manifest(p_manifest jsonb)` that checks `has_blitzkrieg_access()`, validates `version` and `entries`, and upserts. Grant execute to `authenticated`.

- [ ] **Step 2: Stop deleting the manifest on mutation**

At `js/cloud-library.js:599` the manifest is deleted on every mutation, so the window between delete and republish drops every concurrent reader onto the slow path. Overwrite instead of delete. `MANIFEST_TTL_MS` at `:345` already handles staleness, so a slightly stale manifest is strictly better than no manifest.

- [ ] **Step 3: Verify under an editor JWT**

```sql
select count(*) from blitzkrieg_error_logs
where message ilike '%uploadManifest%row-level security%'
  and created_at > now() - interval '2 days';
```

Expected: 0. Then confirm as a non-admin editor that a mutation republishes the manifest and the next panel open takes the fast path.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/ js/cloud-library.js
git commit -m "fix(manifest): publish via RPC so non-admin editors can heal the fast path"
```

---

## Task 12: Give local-sync a file backstop (F11)

Sync state lives only in localStorage. CEP clears it on some AE quits, so every already-mirrored template reads as unsynced and the panel re-mirrors 68GB.

**Files:**
- Modify: `js/local-sync.js:13`
- Modify: `jsx/hostscript.jsx` (reuse the existing settings file helpers)

- [ ] **Step 1: Write state to disk alongside localStorage**

`_writeState` writes both. `_readState` prefers localStorage and falls back to the file when localStorage is empty, then rehydrates localStorage from the file.

- [ ] **Step 2: Verify**

Mirror a template, clear localStorage in DevTools, reload the panel, and confirm the template still reads as synced and does not re-download.

- [ ] **Step 3: Commit**

```bash
git add js/local-sync.js jsx/hostscript.jsx
git commit -m "fix(sync): back local-sync state with a file so an AE quit does not lose it"
```

---

## Task 13: Stop auto-resuming the 68GB library mirror on every load (F14)

Likely the largest single contributor to felt slowness, and the one no user ever asked for. Every successful `loadLibrary()` restarts a full-library mirror: 3 concurrent workers, 6 concurrent requests each, plus a parallel 4-way pre-sizing pass. Every downloaded file is base64-encoded through `FileReader` and written with the **synchronous** `cep.fs.writeFile` on the panel's only JS thread. It saturates the network, which starves the very `listCategory` calls that then time out at 15s/30s/60s in the logs.

**Files:**
- Modify: `js/main.js:1799-1806`, `:7151`
- Modify: `js/local-sync.js:228` (the synchronous write), `:1058` (worker count)

**Interfaces:**
- Produces: `localSync.getFullSyncOptIn() -> boolean` and `localSync.setFullSyncOptIn(bool) -> void`, persisted per machine under localStorage key `blitzkrieg_full_sync_optin` with the Task 12 file backstop; `localSync.isUserActionInFlight() -> boolean`, consulted by the sync loop at the top of each file.

- [ ] **Step 1: Remove the auto-resume**

At `js/main.js:1799`, the mirror starts whenever anything is pending and the user has not explicitly paused. Invert that default: it starts only when the user has explicitly opted in on this machine.

```js
            // A whole-library mirror is 68GB. Auto-resuming it on every library load
            // saturated the network that listCategory needs and stalled the UI thread
            // on synchronous writes. It is now opt-in per machine.
            if (window.localSync.getFullSyncOptIn()) {
                _startFullLibrarySync();
            }
```

- [ ] **Step 2: Yield between file writes**

At `js/local-sync.js:228`, the synchronous `cep.fs.writeFile` blocks the only JS thread. Wrap each write so the event loop gets a frame between files:

```js
        // cep.fs.writeFile is synchronous and this is the panel's only JS thread, so
        // a run of large writes freezes the UI outright. Yield between files.
        await new Promise(function (r) { setTimeout(r, 0); });
```

- [ ] **Step 3: Pause on user action**

Track a flag set by import, generate, and grid load. The sync worker checks it at the top of each file and waits while it is true, so a user-initiated action always wins the network and the thread.

- [ ] **Step 4: Drop to a single worker**

At `js/local-sync.js:1058`, reduce the worker count from 3 to 1. A background mirror has no deadline; it must never compete with foreground work.

- [ ] **Step 5: Verify**

Open the panel with pending sync work and confirm: no network activity starts unless opted in; with opt-in on, the grid stays interactive and scrolling does not stutter during the mirror.

- [ ] **Step 6: Commit**

```bash
git add js/main.js js/local-sync.js
git commit -m "perf(sync): make the full-library mirror opt-in and stop it starving the UI thread"
```

---

## Task 14: Kill the pre-sizing list storm (F15)

`_presize` walks the pending queue calling `getTemplateSize` with 4 workers, but `getTemplateSize` recurses into every subfolder via an uncapped `Promise.all`, so real in-flight lists are 4 x (1 + subfolder count). It runs concurrently with the mirror workers, which list the same templates again via `collectAllFiles`, doubling traffic for no new information. Errors are swallowed with no retry and no backoff, so a failing backend gets hammered at full rate. This is the logged burst: 30 consecutive `List FAILED` entries 0.4s apart.

**Files:**
- Modify: `js/local-sync.js:930-951`
- Modify: `js/cloud-library.js:2373-2393` (`getTemplateSize`)

- [ ] **Step 1: Read sizes from metadata instead of listing**

`fetchAllMetadata` already downloads every `metadata.json`. Persist each template's byte total into the manifest at publish time and read it from there. This removes the pre-sizing pass entirely, which is strictly better than tuning it.

- [ ] **Step 2: If pre-sizing must remain as a fallback, bound it**

Cap total in-flight lists globally (not per worker), gate the pass behind the download pool being idle, and add a circuit breaker:

```js
    // A backend returning instant 'Failed to fetch' lets the workers churn the queue
    // at full speed, which is what produced the 30-lists-in-10-seconds burst. Stop
    // the pass after 5 consecutive failures rather than hammering a failing backend.
    var _presizeConsecutiveFailures = 0;
    var PRESIZE_FAILURE_LIMIT = 5;
```

- [ ] **Step 3: Cap the recursion in `getTemplateSize`**

Replace the uncapped `Promise.all(subPromises)` at `js/cloud-library.js:2393` with a bounded pool of 3.

- [ ] **Step 4: Stop swallowing errors silently**

At `js/local-sync.js:951` the error handler is `, function () { _sizeWorker(); }`. Log the failure at `warn` before continuing, so the next occurrence is visible in `blitzkrieg_error_logs` rather than invisible.

- [ ] **Step 5: Verify**

```sql
select count(*) from blitzkrieg_error_logs
where message like '[cloud] List FAILED for%'
  and created_at > now() - interval '2 days';
```

Expected: a large drop against the prior 30-day baseline, and no more tight bursts. Check the timestamps: consecutive failures should no longer land 0.4s apart.

- [ ] **Step 6: Commit**

```bash
git add js/local-sync.js js/cloud-library.js
git commit -m "perf(sync): read sizes from metadata and bound the pre-sizing list fan-out"
```

---

## Task 15: buildCompsFromMetadata must not wipe the cache it is rendering from (F16)

One permanently bad folder name (the logs confirm these exist) makes `buildCompsFromMetadata` call `clearLocalCache()` once per session. That does not only drop the meta cache: it zeroes the signed-URL caches and deletes the persisted signed-URL file. On the manifest path the order is actively wrong, because `listTemplates` writes the cache at `:1536` and then calls `buildCompsFromMetadata` at `:1538`, which immediately deletes what was just written. Result: every session re-downloads the manifest and re-signs all ~248 thumbnails.

**Files:**
- Modify: `js/cloud-library.js:915-919`, `:724-733`, `:1536-1538`

- [ ] **Step 1: Make the builder pure**

Remove the `clearLocalCache()` call from `buildCompsFromMetadata` entirely. A builder must not mutate caches.

- [ ] **Step 2: Move the clear to the only path where it is correct**

In `listTemplates`, run the one-shot clear only on the Tier-1 (localStorage) path, never after a fresh manifest or slow-path write.

- [ ] **Step 3: Never drop signed URLs for a naming problem**

Signed URLs are keyed by `storagePath` and are completely unaffected by display names. Give `clearLocalCache` a `{ keepSignedUrls: true }` option and use it at this call site.

- [ ] **Step 4: Verify**

Load the panel twice in a row with a known garbage-named template present. Confirm the second load takes the fast path and does not re-sign every thumbnail. The debug log should show no bulk `signPaths` call on the second load.

- [ ] **Step 5: Commit**

```bash
git add js/cloud-library.js
git commit -m "fix(cache): stop a bad folder name wiping the meta and signed-URL caches"
```

---

## Task 16: Panel-thread polish (F17, F18)

Two independent papercuts that both read as "slow".

**Files:**
- Modify: `js/main.js:2624-2641`, `:2961-2998`
- Modify: `js/cloud-library.js:1405`, `:286`

- [ ] **Step 1: Stop re-rendering the grid on thumbnail-seed progress**

`_reRenderThrottled` calls `renderCompsGrid()` every 25 completed thumbnails, which resets pagination to the first 40 cards and replaces `innerHTML` wholesale. An editor scrolled to card 200 is thrown back roughly every 1.5s. Patch the individual `img.src` for the templates that just landed instead; they are known per completion.

- [ ] **Step 2: Do not block first paint on the ExtendScript meta-cache round-trip**

`listTemplates` awaits `_ensureMetaRehydrated()` before reading the localStorage cache. At cold launch the ExtendScript engine is busy opening the user's project, so this reliably burns the full 2.5s timeout with only a spinner on screen. Render immediately from whatever localStorage holds, let the file rehydration resolve in the background, and re-render only if it yields a newer cache.

- [ ] **Step 3: Verify**

Cold-open the panel and confirm the grid paints from cache without waiting on the host bridge. Scroll to card 200 during a thumbnail seed and confirm position is retained.

- [ ] **Step 4: Commit**

```bash
git add js/main.js js/cloud-library.js
git commit -m "perf(ui): keep scroll position during thumbnail seed and unblock first paint"
```

---

## Ship Order and Gates

Strict order. Each gate blocks the next task.

1. **Task 1** (harness) - nothing is TDD without it.
2. **Task 2** (Windows updater) - until this lands, some editors cannot receive anything below.
3. **Task 13** (stop the 68GB auto-resume) - move this early. It is a small diff with the largest felt effect, and leaving it running distorts every timing measurement taken in Tasks 3, 8, and 9.
4. **Task 3** (RLS consolidation) - ships alone, its own PR, per-bucket JWT matrix must show identical visible counts before and after.
5. **Tasks 4, 5, 6, 7** (missing files) - one PR. This is the trust-critical block.
6. **Tasks 8, 9, 10, 14** (list traffic) - one PR, after Task 3 lands so the measurements are meaningful.
7. **Tasks 11, 12, 15, 16** (durability and polish) - one PR.

**Before claiming any of this done, run the ship-gate skill.** Green build gates audit the tree, not the running system. Specifically required here:

- `node --test test/` green.
- The CI gate green (syntax, ES3, CEP compat, em dash).
- A logged-in panel screenshot showing the Incomplete badge on a genuinely partial template.
- The four live SQL checks named in Tasks 2, 6, 8, and 11, run after deploy, confirming the corresponding log lines have stopped.
- A cold panel open timed with cache and manifest cleared.

**Regression risk to watch:** Tasks 4 to 6 all touch the import path, which is the single most damaging thing to break. The guard is that `_doImportLocalAep` is still called on both the complete and partial branches, so a degraded bundle still imports. Do not add an early return that blocks the import on incompleteness.

## Open Question Deferred to Execution

`streamToDisk` chunk size (8MB) and threshold (64MB) are estimates, not measurements. During Task 6, time a real 1.7GB transfer at 4MB, 8MB, and 16MB chunks and keep the fastest that does not visibly stall the panel. Record the numbers in the commit message.
