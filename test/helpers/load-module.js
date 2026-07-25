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

  const sandbox = {
    window: windowStub,
    localStorage: localStorageStub,
    document: windowStub.document,
    navigator: windowStub.navigator,
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

  return { window: windowStub, exports: exported, localStorage: localStorageStub };
}

module.exports = { loadModule, REPO_ROOT };
