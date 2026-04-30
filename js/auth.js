// js/auth.js
// Authentication and access control for Blitzkrieg plugin
(function () {
    'use strict';

    var sb = window.blitzkriegSupabase;

    // Auth state
    var currentUser = null;
    var currentTeamMember = null;
    var isBlitzkriegAdmin = false;

    // Screen elements
    var loginScreen = document.getElementById('auth-login-screen');
    var deniedScreen = document.getElementById('auth-denied-screen');
    var offlineScreen = document.getElementById('auth-offline-screen');
    var appContainer = document.getElementById('app');
    var loginForm = document.getElementById('login-form');
    var loginEmail = document.getElementById('login-email');
    var loginPassword = document.getElementById('login-password');
    var loginError = document.getElementById('login-error');
    var loginBtnText = document.getElementById('login-btn-text');
    var loginBtnLoading = document.getElementById('login-btn-loading');
    var loginSubmitBtn = document.getElementById('login-submit-btn');
    var deniedSignoutBtn = document.getElementById('denied-signout-btn');
    var offlineRetryBtn = document.getElementById('offline-retry-btn');

    function hideAllScreens() {
        // Defensive null-checks: any of these elements can be absent if the HTML
        // was stripped by a minifier or the auth.js loads before DOM is parsed.
        // Without these guards the whole IIFE throws and the plugin fails to boot
        // with a blank screen and no error surface.
        if (loginScreen) loginScreen.style.display = 'none';
        if (deniedScreen) deniedScreen.style.display = 'none';
        if (offlineScreen) offlineScreen.style.display = 'none';
        if (appContainer) appContainer.style.display = 'none';
    }

    function showScreen(screen) {
        hideAllScreens();
        if (screen) screen.style.display = screen === appContainer ? '' : 'flex';
    }

    function showLoginError(message) {
        if (!loginError) return;
        loginError.textContent = message;
        loginError.style.display = 'block';
    }

    function hideLoginError() {
        if (!loginError) return;
        loginError.style.display = 'none';
    }

    function setLoginLoading(loading) {
        if (loginSubmitBtn) loginSubmitBtn.disabled = loading;
        if (loginBtnText) loginBtnText.style.display = loading ? 'none' : '';
        if (loginBtnLoading) loginBtnLoading.style.display = loading ? '' : 'none';
    }

    // Check if user has blitzkrieg_access via team_members table
    async function checkBlitzkriegAccess(userId, userEmail) {
        // Try lookup by user_id first
        var result = await sb.from('team_members')
            .select('id, full_name, blitzkrieg_access, blitzkrieg_admin')
            .eq('user_id', userId)
            .maybeSingle();

        if (result.data) {
            return result.data;
        }

        // Fallback: match by email (slack_email) if user_id not linked yet
        if (userEmail) {
            var emailResult = await sb.from('team_members')
                .select('id, full_name, blitzkrieg_access, blitzkrieg_admin')
                .eq('slack_email', userEmail)
                .maybeSingle();

            if (emailResult.data) {
                // Auto-link user_id for future lookups (SECURITY DEFINER bypasses RLS).
                // Retry-with-backoff because if the RPC silently fails (RPC not yet
                // deployed, network blip, transient permission error), the user
                // is stuck in email-fallback limbo every login. Three attempts
                // at 0, 1.5s, 4.5s — then surface a debug log so we can see
                // recurring failures in telemetry.
                _linkUserIdWithRetry(0);
                return emailResult.data;
            }
        }

        return null;
    }

    function _linkUserIdWithRetry(attempt) {
        var sb = window.blitzkriegSupabase;
        if (!sb) return;
        sb.rpc('link_blitzkrieg_user_id').then(function (res) {
            if (res && res.error) throw res.error;
            if (attempt > 0) console.log('Auto-linked user_id to team member (attempt ' + (attempt + 1) + ')');
            else console.log('Auto-linked user_id to team member');
        }).catch(function (err) {
            if (attempt < 2) {
                var delay = 1500 * Math.pow(3, attempt); // 1.5s, 4.5s
                setTimeout(function () { _linkUserIdWithRetry(attempt + 1); }, delay);
            } else {
                // Surface to debug log for visibility — without this the team
                // member may be stuck in email-fallback every login forever.
                if (typeof window._blitzLog === 'function') {
                    window._blitzLog('link_blitzkrieg_user_id RPC failed after 3 attempts: ' + (err && err.message || err), 'warn');
                }
            }
        });
    }

    // Main auth check — called on plugin load and after login
    async function validateSession() {
        var teamMember;

        try {
            var sessionResult = await sb.auth.getSession();
            var session = sessionResult.data.session;

            if (!session) {
                // No session — show login
                showScreen(loginScreen);
                return;
            }

            currentUser = session.user;

            // Check blitzkrieg access
            teamMember = await checkBlitzkriegAccess(currentUser.id, currentUser.email);

        } catch (err) {
            console.error('Blitzkrieg auth error:', err);
            // Network error — show offline screen
            showScreen(offlineScreen);
            return;
        }

        if (!teamMember || !teamMember.blitzkrieg_access) {
            // User exists but no blitzkrieg access
            currentTeamMember = null;
            isBlitzkriegAdmin = false;
            showScreen(deniedScreen);
            return;
        }

        // Access granted
        currentTeamMember = teamMember;
        isBlitzkriegAdmin = teamMember.blitzkrieg_admin === true;

        // Show the main app
        showScreen(appContainer);

        // Notify main.js that auth is ready (outside try/catch so app errors don't mask as connection errors)
        if (typeof window.onBlitzkriegAuthReady === 'function') {
            try {
                window.onBlitzkriegAuthReady();
            } catch (appErr) {
                console.error('Blitzkrieg app init error:', appErr);
            }
        }
    }

    // Handle login form submission
    async function handleLogin(e) {
        e.preventDefault();
        hideLoginError();

        var email = loginEmail.value.trim();
        var password = loginPassword.value;

        if (!email || !password) {
            showLoginError('Please enter your email and password.');
            return;
        }

        setLoginLoading(true);

        try {
            var result = await sb.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (result.error) {
                showLoginError(result.error.message || 'Invalid email or password.');
                setLoginLoading(false);
                return;
            }

            // Login succeeded — validate access
            setLoginLoading(false);
            loginPassword.value = '';
            await validateSession();

        } catch (err) {
            console.error('Login error:', err);
            showLoginError('Cannot connect to the server. Check your internet.');
            setLoginLoading(false);
        }
    }

    // Handle sign out
    async function handleSignOut() {
        try {
            await sb.auth.signOut();
        } catch (err) {
            // Ignore sign-out errors
        }
        currentUser = null;
        currentTeamMember = null;
        isBlitzkriegAdmin = false;
        showScreen(loginScreen);
        loginEmail.value = '';
        loginPassword.value = '';
        hideLoginError();
    }

    // Attach event listeners — null-guarded so a missing DOM element doesn't
    // throw at module load and block plugin boot
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (deniedSignoutBtn) deniedSignoutBtn.addEventListener('click', handleSignOut);
    if (offlineRetryBtn) offlineRetryBtn.addEventListener('click', function () {
        validateSession();
    });

    // Expose auth API globally
    window.blitzkriegAuth = {
        validateSession: validateSession,
        signOut: handleSignOut,
        isAdmin: function () { return isBlitzkriegAdmin; },
        getUser: function () { return currentUser; },
        getTeamMember: function () { return currentTeamMember; },
    };
})();
