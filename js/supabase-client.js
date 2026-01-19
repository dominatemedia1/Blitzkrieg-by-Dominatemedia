/**
 * Blitzkrieg - Supabase Client Configuration
 * Handles authentication and database operations
 *
 * IMPORTANT: Replace SUPABASE_URL and SUPABASE_ANON_KEY with your actual values
 * from your Supabase project dashboard (Settings > API)
 */

// ============================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================
var SUPABASE_URL = 'YOUR_SUPABASE_URL'; // e.g., 'https://xxxxx.supabase.co'
var SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // Public anon key

// ============================================
// SUPABASE CLIENT SINGLETON
// ============================================
var BlitzkriegAuth = (function() {
    var supabase = null;
    var currentUser = null;
    var isAdmin = false;
    var authStateListeners = [];

    // Initialize Supabase client
    function init() {
        if (typeof window.supabase === 'undefined') {
            console.error('Supabase library not loaded. Include supabase-js CDN in index.html');
            return false;
        }

        if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
            console.warn('Supabase not configured. Update SUPABASE_URL and SUPABASE_ANON_KEY in supabase-client.js');
            return false;
        }

        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // Listen for auth state changes
        supabase.auth.onAuthStateChange(function(event, session) {
            if (event === 'SIGNED_IN' && session) {
                currentUser = session.user;
                checkAdminStatus();
            } else if (event === 'SIGNED_OUT') {
                currentUser = null;
                isAdmin = false;
            }
            notifyAuthStateListeners(event, session);
        });

        // Check for existing session
        checkSession();

        return true;
    }

    // Check for existing session on load
    async function checkSession() {
        try {
            var { data: { session } } = await supabase.auth.getSession();
            if (session) {
                currentUser = session.user;
                await checkAdminStatus();
                notifyAuthStateListeners('RESTORED', session);
            }
        } catch (error) {
            console.error('Error checking session:', error);
        }
    }

    // Check if current user is admin
    async function checkAdminStatus() {
        if (!currentUser) {
            isAdmin = false;
            return;
        }

        try {
            var { data, error } = await supabase
                .from('admins')
                .select('user_id')
                .eq('user_id', currentUser.id)
                .single();

            isAdmin = !error && data !== null;
        } catch (error) {
            isAdmin = false;
        }
    }

    // Add auth state listener
    function onAuthStateChange(callback) {
        authStateListeners.push(callback);
        return function() {
            authStateListeners = authStateListeners.filter(function(cb) {
                return cb !== callback;
            });
        };
    }

    // Notify all listeners
    function notifyAuthStateListeners(event, session) {
        authStateListeners.forEach(function(callback) {
            try {
                callback(event, session, currentUser, isAdmin);
            } catch (error) {
                console.error('Auth listener error:', error);
            }
        });
    }

    // ============================================
    // INVITE SYSTEM
    // ============================================

    // Validate invite code before registration
    async function validateInvite(code, email) {
        if (!supabase) return { valid: false, error: 'Supabase not initialized' };

        try {
            var { data, error } = await supabase
                .from('invites')
                .select('*')
                .eq('code', code)
                .single();

            if (error || !data) {
                return { valid: false, error: 'Invalid invite code' };
            }

            // Check if expired
            if (data.expires_at && new Date(data.expires_at) < new Date()) {
                return { valid: false, error: 'Invite code has expired' };
            }

            // Check if max uses reached
            if (data.max_uses && data.use_count >= data.max_uses) {
                return { valid: false, error: 'Invite code has reached maximum uses' };
            }

            // Check if email-restricted
            if (data.email && data.email.toLowerCase() !== email.toLowerCase()) {
                return { valid: false, error: 'This invite is for a different email address' };
            }

            return { valid: true, invite: data };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    // Mark invite as used
    async function useInvite(code, userId) {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };

        try {
            var { error } = await supabase
                .from('invites')
                .update({
                    used_by: userId,
                    used_at: new Date().toISOString(),
                    use_count: supabase.sql`use_count + 1`
                })
                .eq('code', code);

            if (error) throw error;
            return { success: true };
        } catch (error) {
            console.error('Error marking invite as used:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // AUTHENTICATION
    // ============================================

    // Sign up with invite code
    async function signUp(email, password, inviteCode) {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };

        // First validate the invite
        var validation = await validateInvite(inviteCode, email);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        try {
            var { data, error } = await supabase.auth.signUp({
                email: email,
                password: password
            });

            if (error) throw error;

            // Mark invite as used
            if (data.user) {
                await useInvite(inviteCode, data.user.id);
            }

            return {
                success: true,
                user: data.user,
                message: 'Account created! Please check your email to verify.'
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Sign in
    async function signIn(email, password) {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };

        try {
            var { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) throw error;

            currentUser = data.user;
            await checkAdminStatus();

            return { success: true, user: data.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Sign out
    async function signOut() {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };

        try {
            var { error } = await supabase.auth.signOut();
            if (error) throw error;

            currentUser = null;
            isAdmin = false;

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Reset password
    async function resetPassword(email) {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };

        try {
            var { error } = await supabase.auth.resetPasswordForEmail(email);
            if (error) throw error;

            return { success: true, message: 'Password reset email sent' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    // Generate invite code (admin only)
    async function generateInvite(options) {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };
        if (!isAdmin) return { success: false, error: 'Admin access required' };

        options = options || {};

        // Generate random code
        var code = generateRandomCode(8);

        try {
            var { data, error } = await supabase
                .from('invites')
                .insert({
                    code: code,
                    created_by: currentUser.id,
                    email: options.email || null,
                    expires_at: options.expiresAt || null,
                    max_uses: options.maxUses || 1
                })
                .select()
                .single();

            if (error) throw error;

            return { success: true, invite: data, code: code };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Get all invites (admin only)
    async function getInvites() {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };
        if (!isAdmin) return { success: false, error: 'Admin access required' };

        try {
            var { data, error } = await supabase
                .from('invites')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            return { success: true, invites: data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Delete invite (admin only)
    async function deleteInvite(inviteId) {
        if (!supabase) return { success: false, error: 'Supabase not initialized' };
        if (!isAdmin) return { success: false, error: 'Admin access required' };

        try {
            var { error } = await supabase
                .from('invites')
                .delete()
                .eq('id', inviteId);

            if (error) throw error;

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    function generateRandomCode(length) {
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        var code = '';
        for (var i = 0; i < length; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    // ============================================
    // PUBLIC API
    // ============================================
    return {
        init: init,
        onAuthStateChange: onAuthStateChange,

        // Auth methods
        signUp: signUp,
        signIn: signIn,
        signOut: signOut,
        resetPassword: resetPassword,

        // Getters
        getUser: function() { return currentUser; },
        isLoggedIn: function() { return currentUser !== null; },
        isAdmin: function() { return isAdmin; },
        getSupabase: function() { return supabase; },

        // Admin methods
        generateInvite: generateInvite,
        getInvites: getInvites,
        deleteInvite: deleteInvite,

        // Config check
        isConfigured: function() {
            return SUPABASE_URL !== 'YOUR_SUPABASE_URL';
        }
    };
})();

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        BlitzkriegAuth.init();
    });
}
