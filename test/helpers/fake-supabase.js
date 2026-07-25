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

  function makeBlob(f) {
    const size = f.size || 0;
    // Keep the in-memory body small; tests assert on `size`, not on bytes.
    const body = f.body !== undefined ? f.body : 'x'.repeat(Math.min(size || 1, 1024));
    return {
      size: size || body.length,
      _body: body,
      slice(start, end) {
        return makeBlob({ size: Math.max(0, (end || 0) - (start || 0)), body: '' });
      },
      arrayBuffer() { return Promise.resolve(new ArrayBuffer(0)); }
    };
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
      return Promise.resolve({ data: makeBlob(f), error: null });
    },
    createSignedUrls(paths) {
      return Promise.resolve({
        data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.test/' + p })),
        error: null
      });
    },
    createSignedUrl(p) {
      return Promise.resolve({ data: { signedUrl: 'https://signed.test/' + p }, error: null });
    },
    upload() { return Promise.resolve({ data: {}, error: null }); },
    remove() { return Promise.resolve({ data: {}, error: null }); }
  };

  return {
    storage: { from: () => api },
    rpc: () => Promise.resolve({ data: null, error: { message: 'rpc not stubbed' } }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      getUser: () => Promise.resolve({ data: { user: null }, error: null })
    },
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
      insert: () => Promise.resolve({ data: [], error: null })
    }),
    _calls: calls
  };
}

module.exports = { fakeSupabase };
