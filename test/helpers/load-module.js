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
    navigator: { onLine: true, userAgent: 'node-test', platform: 'MacIntel' },
    location: { href: 'file:///test/index.html' },
    document: {
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
      body: { classList: { add() {}, remove() {} }, appendChild() {} }
    },
    _blitzLog: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: () => Promise.reject(new Error('fetch not stubbed')),
    CSInterface: function () {
      this.evalScript = (s, cb) => { if (cb) cb('undefined'); };
      this.getSystemPath = () => '/tmp/blitz-test';
      this.addEventListener = () => {};
    },
    cep: { fs: { readFile: () => ({ err: 1 }), writeFile: () => ({ err: 0 }) } }
  }, windowExtras || {});

  // js/main.js references several CEP globals bare (not via window.), so they must
  // exist as true globals in the sandbox, not only as properties of the window stub.
  // Counting timers. A Promise.race timeout whose loser is never cleared leaks a
  // live timer per call: harmless-looking, but it keeps a wakeup and a closure
  // scheduled for the full timeout, and on a panel that reloads on every focus
  // event they accumulate. `pendingTimers()` is how a test asserts none leaked.
  const live = new Map();
  const countingSetTimeout = (fn, ms, ...rest) => {
    const id = setTimeout((...a) => { live.delete(id); return fn(...a); }, ms, ...rest);
    live.set(id, ms || 0);
    return id;
  };
  const countingClearTimeout = (id) => { live.delete(id); return clearTimeout(id); };

  const sandbox = {
    CSInterface: windowStub.CSInterface,
    cep: windowStub.cep,
    __adobe_cep__: undefined,
    window: windowStub,
    localStorage: localStorageStub,
    document: windowStub.document,
    navigator: windowStub.navigator,
    console,
    setTimeout: countingSetTimeout,
    clearTimeout: countingClearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Date,
    Math,
    JSON,
    AbortController,
    Blob: globalThis.Blob,
    URL: globalThis.URL,
    FileReader: globalThis.FileReader,
    TextEncoder,
    TextDecoder
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

  return {
    window: windowStub,
    exports: exported,
    localStorage: localStorageStub,
    pendingTimers: () => live.size,
    // Delays of every still-live timer. Short debounces (a coalesced file write) are
    // legitimate and self-clearing; a surviving multi-second deadline is the leak.
    pendingTimerDelays: () => Array.from(live.values()),
    // Drop any still-live timer so a test file exits immediately instead of the
    // runner waiting out a real 15s deadline.
    clearAllTimers: () => { live.forEach((id) => clearTimeout(id)); live.clear(); }
  };
}

module.exports = { loadModule, REPO_ROOT };
