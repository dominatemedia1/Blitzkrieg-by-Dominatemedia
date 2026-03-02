// js/supabase-config.js
// Supabase client initialization for Blitzkrieg plugin
(function () {
    'use strict';

    var SUPABASE_URL = 'https://kwrmdxptrrvlqxdcasho.supabase.co';
    var SUPABASE_ANON_KEY = 'sb_publishable_wMNJ93D7lys_gVC6HZ3oDQ_sUiabT4E';

    // Initialize Supabase client
    // The supabase global is provided by supabase.min.js (UMD build)
    var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            storage: window.localStorage,
            persistSession: true,
            autoRefreshToken: true,
        }
    });

    // Expose globally for other scripts
    window.blitzkriegSupabase = supabaseClient;
})();
