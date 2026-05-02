// js/supabase-config.js
// Supabase client initialization for Blitzkrieg plugin
(function () {
    'use strict';

    var SUPABASE_URL = 'https://kwrmdxptrrvlqxdcasho.supabase.co';
    var SUPABASE_ANON_KEY = 'sb_publishable_wMNJ93D7lys_gVC6HZ3oDQ_sUiabT4E';
    var AUTH_STORAGE_KEY_PREFIX = 'sb-kwrmdxptrrvlqxdcasho-auth-token';

    function hasCepBridge() {
        return !!(window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === 'function');
    }

    function escapeForExtendScript(str) {
        if (typeof str !== 'string') str = String(str);
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
    }

    function evalScriptAsync(script) {
        return new Promise(function(resolve) {
            if (!hasCepBridge()) {
                resolve(null);
                return;
            }
            try {
                var cs = new CSInterface();
                cs.evalScript(script, function(result) {
                    if (!result || result === 'EvalScript error.' || result === 'undefined' || result.indexOf('Error:') === 0) {
                        resolve(null);
                    } else {
                        resolve(result);
                    }
                });
            } catch (e) {
                resolve(null);
            }
        });
    }

    function createPersistentAuthStorage() {
        var fileCache = null;

        function isAuthKey(key) {
            return typeof key === 'string' && key.indexOf(AUTH_STORAGE_KEY_PREFIX) === 0;
        }

        function loadFileCache() {
            if (fileCache) return Promise.resolve(fileCache);
            return evalScriptAsync('loadBlitzkriegAuthStorage()').then(function(raw) {
                if (!raw) {
                    fileCache = {};
                    return fileCache;
                }
                try {
                    fileCache = JSON.parse(raw) || {};
                } catch (e) {
                    fileCache = {};
                }
                return fileCache;
            });
        }

        function saveFileCache() {
            if (!fileCache) return Promise.resolve();
            var payload;
            try {
                payload = JSON.stringify(fileCache);
            } catch (e) {
                return Promise.resolve();
            }
            return evalScriptAsync('saveBlitzkriegAuthStorage("' + escapeForExtendScript(payload) + '")').then(function() {});
        }

        return {
            getItem: function(key) {
                try {
                    var localValue = window.localStorage.getItem(key);
                    if (localValue !== null && localValue !== undefined) return Promise.resolve(localValue);
                } catch (e) {}
                if (!isAuthKey(key)) return Promise.resolve(null);
                return loadFileCache().then(function(cache) {
                    var value = cache[key];
                    if (value === undefined || value === null) return null;
                    try { window.localStorage.setItem(key, value); } catch (e) {}
                    return value;
                });
            },
            setItem: function(key, value) {
                try { window.localStorage.setItem(key, value); } catch (e) {}
                if (!isAuthKey(key)) return Promise.resolve();
                return loadFileCache().then(function(cache) {
                    cache[key] = value;
                    return saveFileCache();
                });
            },
            removeItem: function(key) {
                try { window.localStorage.removeItem(key); } catch (e) {}
                if (!isAuthKey(key)) return Promise.resolve();
                return loadFileCache().then(function(cache) {
                    delete cache[key];
                    return saveFileCache();
                });
            },
        };
    }

    // Initialize Supabase client
    // The supabase global is provided by supabase.min.js (UMD build)
    var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            storage: createPersistentAuthStorage(),
            storageKey: AUTH_STORAGE_KEY_PREFIX,
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
        }
    });

    // Expose globally for other scripts
    window.blitzkriegSupabase = supabaseClient;
})();
