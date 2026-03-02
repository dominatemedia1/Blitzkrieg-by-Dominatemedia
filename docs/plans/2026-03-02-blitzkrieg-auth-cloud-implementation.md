# Blitzkrieg Auth & Cloud Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Supabase-based authentication, role-based access control, and cloud template storage to the Blitzkrieg After Effects plugin, managed from the Dominate Media Portal.

**Architecture:** Embed the Supabase JS client directly in the CEP panel. Auth and storage go through Supabase with RLS enforcing permissions. The portal gets two new boolean columns on `team_members` (`blitzkrieg_access`, `blitzkrieg_admin`) exposed as toggles on the team member edit form. A new `blitzkrieg` storage bucket holds all templates.

**Tech Stack:** Supabase Auth + Storage (existing infrastructure), Vanilla JS (CEP panel), React + Supabase (portal), PostgreSQL migrations

**Design doc:** `docs/plans/2026-03-02-blitzkrieg-auth-cloud-integration-design.md`

---

## Task 1: Database Migration — Add Blitzkrieg Columns to team_members

**Files:**
- Create: `insight-flow-83/supabase/migrations/20260302200000_add_blitzkrieg_access_columns.sql`

**Step 1: Write the migration**

```sql
-- ============================================
-- ADD BLITZKRIEG ACCESS COLUMNS TO TEAM_MEMBERS
-- ============================================
-- blitzkrieg_access: controls whether the team member can use the Blitzkrieg plugin
-- blitzkrieg_admin: controls whether they can upload/add new templates

ALTER TABLE team_members
ADD COLUMN IF NOT EXISTS blitzkrieg_access BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS blitzkrieg_admin BOOLEAN DEFAULT false;

-- Add comments for documentation
COMMENT ON COLUMN team_members.blitzkrieg_access IS 'Controls whether this team member can use the Blitzkrieg After Effects plugin';
COMMENT ON COLUMN team_members.blitzkrieg_admin IS 'Controls whether this team member can upload new templates to the Blitzkrieg library';
```

**Step 2: Push the migration**

Run: `cd /Users/thenorwegianoilfund/insight-flow-83 && supabase db push --project-ref kwrmdxptrrvlqxdcasho`
Expected: Migration applies successfully. Two new columns on `team_members`.

**Step 3: Commit**

```bash
cd /Users/thenorwegianoilfund/insight-flow-83
git add supabase/migrations/20260302200000_add_blitzkrieg_access_columns.sql
git commit -m "feat: add blitzkrieg_access and blitzkrieg_admin columns to team_members"
```

---

## Task 2: Database Migration — Create Blitzkrieg Storage Bucket

**Files:**
- Create: `insight-flow-83/supabase/migrations/20260302200001_create_blitzkrieg_storage_bucket.sql`

**Step 1: Write the migration**

Follow the exact pattern from `20260121200001_fix_storage_buckets.sql`:

```sql
-- ============================================
-- CREATE BLITZKRIEG STORAGE BUCKET
-- Cloud-only template storage for the Blitzkrieg After Effects plugin
-- ============================================

-- Create the blitzkrieg bucket (private, requires auth)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('blitzkrieg', 'blitzkrieg', false, 53687091200)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- BLITZKRIEG BUCKET RLS POLICIES
-- Read: authenticated users with blitzkrieg_access = true
-- Write/Update: authenticated users with blitzkrieg_admin = true
-- Delete: portal admins only
-- ============================================

-- Helper function to check blitzkrieg access
CREATE OR REPLACE FUNCTION has_blitzkrieg_access()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE user_id = auth.uid()
    AND blitzkrieg_access = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to check blitzkrieg admin
CREATE OR REPLACE FUNCTION has_blitzkrieg_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE user_id = auth.uid()
    AND blitzkrieg_admin = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Drop existing policies if any
DROP POLICY IF EXISTS "blitzkrieg_access_read" ON storage.objects;
DROP POLICY IF EXISTS "blitzkrieg_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "blitzkrieg_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "blitzkrieg_admin_delete" ON storage.objects;

-- Read: any authenticated user with blitzkrieg_access
CREATE POLICY "blitzkrieg_access_read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'blitzkrieg'
  AND has_blitzkrieg_access()
);

-- Insert: only blitzkrieg admins
CREATE POLICY "blitzkrieg_admin_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'blitzkrieg'
  AND has_blitzkrieg_admin()
);

-- Update: only blitzkrieg admins
CREATE POLICY "blitzkrieg_admin_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'blitzkrieg'
  AND has_blitzkrieg_admin()
);

-- Delete: only portal admins (via user_roles table)
CREATE POLICY "blitzkrieg_admin_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'blitzkrieg'
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'super_admin')
  )
);
```

**Step 2: Push the migration**

Run: `cd /Users/thenorwegianoilfund/insight-flow-83 && supabase db push --project-ref kwrmdxptrrvlqxdcasho`
Expected: Bucket created. RLS policies applied. Helper functions created.

**Step 3: Commit**

```bash
cd /Users/thenorwegianoilfund/insight-flow-83
git add supabase/migrations/20260302200001_create_blitzkrieg_storage_bucket.sql
git commit -m "feat: create blitzkrieg storage bucket with access-controlled RLS policies"
```

---

## Task 3: Portal UI — Add Blitzkrieg Toggles to Team Member Edit

**Files:**
- Modify: `insight-flow-83/src/pages/Team.tsx`

This task adds a "Blitzkrieg Plugin" section with two Switch toggles to the team member edit panel, right after the existing "Portal Access" section (line 2069).

**Step 1: Add blitzkrieg fields to the fetchTeamMembers query**

In `Team.tsx`, find the `fetchTeamMembers` function (line 681). Add the two new columns to the `.select()` call:

At line 713 (after `status,`), add:
```typescript
        blitzkrieg_access,
        blitzkrieg_admin,
```

So the select block at lines 685-714 includes the new columns.

**Step 2: Add blitzkrieg fields to the handleSaveMember update**

In `handleSaveMember` (line 1025), add the new fields to the `.update()` call.

At line 1055 (after `status: editData.status,`), add:
```typescript
        blitzkrieg_access: editData.blitzkrieg_access ?? false,
        blitzkrieg_admin: editData.blitzkrieg_admin ?? false,
```

**Step 3: Add the Blitzkrieg section UI after the Portal Access section**

After the Portal Access section closing `</div>` (around line 2069, after the role selection), add a new section:

```tsx
                {/* SECTION 8: BLITZKRIEG PLUGIN ACCESS */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Blitzkrieg Plugin
                  </h3>
                  <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                    {/* Blitzkrieg Access Toggle */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-medium">Blitzkrieg Access</Label>
                        <p className="text-xs text-muted-foreground">
                          Allow this team member to use the Blitzkrieg After Effects plugin
                        </p>
                      </div>
                      <Switch
                        checked={editData.blitzkrieg_access ?? false}
                        onCheckedChange={(checked) => {
                          setEditData({
                            ...editData,
                            blitzkrieg_access: checked,
                            // If disabling access, also disable admin
                            blitzkrieg_admin: checked ? editData.blitzkrieg_admin : false,
                          });
                        }}
                      />
                    </div>

                    {/* Blitzkrieg Admin Toggle — only visible when access is enabled */}
                    {editData.blitzkrieg_access && (
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-sm font-medium">Blitzkrieg Admin</Label>
                          <p className="text-xs text-muted-foreground">
                            Allow this team member to upload new templates to the shared library
                          </p>
                        </div>
                        <Switch
                          checked={editData.blitzkrieg_admin ?? false}
                          onCheckedChange={(checked) => {
                            setEditData({ ...editData, blitzkrieg_admin: checked });
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
```

**Step 4: Add the Zap icon import**

At the top of Team.tsx, find the Lucide imports and add `Zap` to the import list if not already present.

**Step 5: Verify in dev server**

Run: `cd /Users/thenorwegianoilfund/insight-flow-83 && npm run dev`
Expected: Navigate to Team page, click a team member, scroll to bottom. "Blitzkrieg Plugin" section with two toggles visible. Toggling access off hides the admin toggle. Saving persists to database.

**Step 6: Commit**

```bash
cd /Users/thenorwegianoilfund/insight-flow-83
git add src/pages/Team.tsx
git commit -m "feat: add Blitzkrieg access and admin toggles to team member profile"
```

---

## Task 4: Bundle Supabase JS Client into Blitzkrieg Plugin

**Files:**
- Create: `Blitzkrieg-by-Dominatemedia/js/supabase.min.js` (downloaded bundle)
- Create: `Blitzkrieg-by-Dominatemedia/js/supabase-config.js`

**Step 1: Download the Supabase JS UMD bundle**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
curl -L "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js" -o js/supabase.min.js
```

Verify: File exists and is ~150-200KB.

**Step 2: Create the Supabase config file**

Create `js/supabase-config.js`:

```javascript
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
```

**Step 3: Add script tags to index.html**

In `index.html`, before the existing script tags at line 335, add:

```html
    <script src="./js/supabase.min.js"></script>
    <script src="./js/supabase-config.js"></script>
```

So the full script section (lines 335-338) becomes:

```html
    <script src="./js/supabase.min.js"></script>
    <script src="./js/supabase-config.js"></script>
    <script src="./js/CSInterface.js"></script>
    <script src="./js/main.js"></script>
```

**Step 4: Commit**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
git add js/supabase.min.js js/supabase-config.js index.html
git commit -m "feat: add Supabase JS client bundle and config to plugin"
```

---

## Task 5: Add Login Screen HTML + CSS

**Files:**
- Modify: `Blitzkrieg-by-Dominatemedia/index.html`
- Modify: `Blitzkrieg-by-Dominatemedia/CSS/style.css`

**Step 1: Add login screen HTML**

In `index.html`, after line 8 (`<body class="cep-panel">`) and before line 10 (settings modal), insert the login screen:

```html
    <!-- === AUTH SCREENS === -->
    <div id="auth-login-screen" class="auth-screen" style="display:none;">
        <div class="auth-container">
            <div class="auth-logo">
                <img src="img/logo.png" alt="Blitzkrieg - Dominate Media">
            </div>
            <h2 class="auth-title">Sign In</h2>
            <p class="auth-subtitle">Enter your Dominate Media portal credentials</p>
            <form id="login-form" class="auth-form">
                <div class="form-group">
                    <label for="login-email">Email</label>
                    <input type="email" id="login-email" placeholder="your@email.com" required autocomplete="email">
                </div>
                <div class="form-group">
                    <label for="login-password">Password</label>
                    <input type="password" id="login-password" placeholder="Enter your password" required autocomplete="current-password">
                </div>
                <p id="login-error" class="auth-error" style="display:none;"></p>
                <button type="submit" id="login-submit-btn" class="button-primary auth-submit">
                    <span id="login-btn-text">Sign In</span>
                    <span id="login-btn-loading" style="display:none;">Signing in...</span>
                </button>
            </form>
        </div>
    </div>

    <div id="auth-denied-screen" class="auth-screen" style="display:none;">
        <div class="auth-container">
            <div class="auth-logo">
                <img src="img/logo.png" alt="Blitzkrieg - Dominate Media">
            </div>
            <div class="auth-denied-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
                </svg>
            </div>
            <h2 class="auth-title">Access Denied</h2>
            <p class="auth-subtitle">Your Blitzkrieg access is disabled. Contact your admin to enable it.</p>
            <button id="denied-signout-btn" class="button-secondary auth-submit">Sign Out</button>
        </div>
    </div>

    <div id="auth-offline-screen" class="auth-screen" style="display:none;">
        <div class="auth-container">
            <div class="auth-logo">
                <img src="img/logo.png" alt="Blitzkrieg - Dominate Media">
            </div>
            <div class="auth-denied-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                    <path d="M10.71 5.05A16 16 0 0 1 22.56 9"></path>
                    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                </svg>
            </div>
            <h2 class="auth-title">No Connection</h2>
            <p class="auth-subtitle">Cannot connect to the server. Check your internet and try again.</p>
            <button id="offline-retry-btn" class="button-primary auth-submit">Retry</button>
        </div>
    </div>
```

**Step 2: Add auth screen CSS**

In `CSS/style.css`, add after the existing CSS variables section (after line 64):

```css
/* ========================================
   AUTH SCREENS
   ======================================== */
.auth-screen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--bg-dark);
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
}

.auth-container {
    width: 320px;
    padding: 40px 32px;
    text-align: center;
}

.auth-logo {
    margin-bottom: 32px;
}

.auth-logo img {
    width: 180px;
    height: auto;
    opacity: 0.9;
}

.auth-title {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-bright);
    margin: 0 0 8px 0;
}

.auth-subtitle {
    font-size: 13px;
    color: var(--text-medium);
    margin: 0 0 28px 0;
    line-height: 1.5;
}

.auth-form {
    text-align: left;
}

.auth-form .form-group {
    margin-bottom: 16px;
}

.auth-form label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-medium);
    margin-bottom: 6px;
}

.auth-form input {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-bright);
    font-size: 14px;
    transition: border-color 0.2s;
    box-sizing: border-box;
}

.auth-form input:focus {
    outline: none;
    border-color: var(--brand-green);
}

.auth-form input::placeholder {
    color: var(--text-muted);
}

.auth-error {
    font-size: 12px;
    color: #ef4444;
    margin: 0 0 12px 0;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 6px;
}

.auth-submit {
    width: 100%;
    margin-top: 8px;
    padding: 12px;
    font-size: 14px;
    font-weight: 600;
}

.auth-denied-icon {
    margin-bottom: 20px;
    color: var(--text-muted);
}

.auth-denied-icon svg {
    opacity: 0.4;
}
```

**Step 3: Commit**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
git add index.html CSS/style.css
git commit -m "feat: add login, access denied, and offline auth screens"
```

---

## Task 6: Add Auth Module — js/auth.js

**Files:**
- Create: `Blitzkrieg-by-Dominatemedia/js/auth.js`

**Step 1: Write the auth module**

Create `js/auth.js` — handles login, session validation, access checking, and screen management:

```javascript
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
        loginScreen.style.display = 'none';
        deniedScreen.style.display = 'none';
        offlineScreen.style.display = 'none';
        appContainer.style.display = 'none';
    }

    function showScreen(screen) {
        hideAllScreens();
        screen.style.display = screen === appContainer ? '' : 'flex';
    }

    function showLoginError(message) {
        loginError.textContent = message;
        loginError.style.display = 'block';
    }

    function hideLoginError() {
        loginError.style.display = 'none';
    }

    function setLoginLoading(loading) {
        loginSubmitBtn.disabled = loading;
        loginBtnText.style.display = loading ? 'none' : '';
        loginBtnLoading.style.display = loading ? '' : 'none';
    }

    // Check if user has blitzkrieg_access via team_members table
    async function checkBlitzkriegAccess(userId) {
        var result = await sb.from('team_members')
            .select('id, full_name, blitzkrieg_access, blitzkrieg_admin')
            .eq('user_id', userId)
            .single();

        if (result.error || !result.data) {
            return null;
        }
        return result.data;
    }

    // Main auth check — called on plugin load and after login
    async function validateSession() {
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
            var teamMember = await checkBlitzkriegAccess(currentUser.id);

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

            // Notify main.js that auth is ready
            if (typeof window.onBlitzkriegAuthReady === 'function') {
                window.onBlitzkriegAuthReady();
            }

        } catch (err) {
            console.error('Blitzkrieg auth error:', err);
            // Network error — show offline screen
            showScreen(offlineScreen);
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

    // Attach event listeners
    loginForm.addEventListener('submit', handleLogin);
    deniedSignoutBtn.addEventListener('click', handleSignOut);
    offlineRetryBtn.addEventListener('click', function () {
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
```

**Step 2: Add script tag to index.html**

In `index.html`, add `auth.js` after `supabase-config.js` and before `CSInterface.js`:

```html
    <script src="./js/supabase.min.js"></script>
    <script src="./js/supabase-config.js"></script>
    <script src="./js/auth.js"></script>
    <script src="./js/CSInterface.js"></script>
    <script src="./js/main.js"></script>
```

**Step 3: Commit**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
git add js/auth.js index.html
git commit -m "feat: add auth module with login, access validation, and session management"
```

---

## Task 7: Gate Main App Behind Auth in main.js

**Files:**
- Modify: `Blitzkrieg-by-Dominatemedia/js/main.js`

This task modifies the initialization flow so the app only starts after auth is validated.

**Step 1: Hide the app container by default**

In `index.html`, change line 129 from:
```html
    <div id="app">
```
to:
```html
    <div id="app" style="display:none;">
```

**Step 2: Replace the masterInit entry point**

In `main.js`, the current `masterInit()` (line 506) initializes the app immediately. Change it so the app only initializes after auth succeeds.

Replace the current DOMContentLoaded handler (at the bottom of the file, around line 2100+) or wherever `masterInit()` is called on load. The approach:

At the **very end of `main.js`** (last line before the closing `})();`), find where `masterInit` is invoked. It's likely `document.addEventListener('DOMContentLoaded', masterInit);` or similar. Replace it with:

```javascript
    // Auth-gated initialization
    // The auth module (auth.js) handles login/access and calls onBlitzkriegAuthReady when access is granted
    window.onBlitzkriegAuthReady = function () {
        masterInit();
    };

    // Start auth check on load
    document.addEventListener('DOMContentLoaded', function () {
        // auth.js validateSession() runs and shows login or grants access
        if (window.blitzkriegAuth) {
            window.blitzkriegAuth.validateSession();
        }
    });
```

Remove the old `document.addEventListener('DOMContentLoaded', masterInit);` line.

**Step 3: Add Sign Out to the dropdown menu**

In `main.js`, find the `initDropdownMenu()` function (line 564). After the "Become an Editor" click handler (around line 616), add:

```javascript
        // Sign Out action
        var dropdownSignOut = document.getElementById('dropdown-signout');
        if (dropdownSignOut) {
            dropdownSignOut.addEventListener('click', function(e) {
                e.preventDefault();
                dropdownContainer.classList.remove('open');
                if (window.blitzkriegAuth) {
                    window.blitzkriegAuth.signOut();
                }
            });
        }
```

**Step 4: Add Sign Out menu item to the dropdown HTML**

In `index.html`, inside the dropdown menu (after line 296, before the closing `</div>` of `dropdown-menu`), add:

```html
                            <div class="dropdown-divider"></div>
                            <a href="#" class="dropdown-item" id="dropdown-signout">
                                <svg class="item-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                    <polyline points="16 17 21 12 16 7"></polyline>
                                    <line x1="21" y1="12" x2="9" y2="12"></line>
                                </svg>
                                <div class="item-text">
                                    <div>Sign Out</div>
                                    <div class="item-subtitle">Log out of Blitzkrieg</div>
                                </div>
                            </a>
```

**Step 5: Show logged-in user info in sidebar footer**

In `index.html`, replace the sidebar footer (lines 178-187) with:

```html
            <div class="sidebar-footer">
                <div class="sidebar-user-info" id="sidebar-user-info" style="display:none;">
                    <span class="sidebar-user-name" id="sidebar-user-name"></span>
                </div>
                <a href="#" class="sidebar-footer-link" id="credit-button">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <span>Created by Dominate Media</span>
                </a>
            </div>
```

Then in `main.js` inside `masterInit()`, after `initializeAppLogic()` is called, add code to display the user info:

```javascript
        // Show logged-in user info in sidebar
        var userInfo = document.getElementById('sidebar-user-info');
        var userName = document.getElementById('sidebar-user-name');
        if (userInfo && userName && window.blitzkriegAuth) {
            var tm = window.blitzkriegAuth.getTeamMember();
            var user = window.blitzkriegAuth.getUser();
            if (tm) {
                userName.textContent = tm.full_name || (user ? user.email : '');
                userInfo.style.display = 'block';
            }
        }
```

Add CSS for the user info in `CSS/style.css`:

```css
.sidebar-user-info {
    padding: 8px 16px;
    border-top: 1px solid var(--border-color);
    margin-bottom: 4px;
}

.sidebar-user-name {
    font-size: 12px;
    color: var(--text-medium);
    font-weight: 500;
}
```

**Step 6: Commit**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
git add js/main.js index.html CSS/style.css
git commit -m "feat: gate app behind auth, add sign out and user info display"
```

---

## Task 8: Replace Local Filesystem Library with Supabase Storage

**Files:**
- Create: `Blitzkrieg-by-Dominatemedia/js/cloud-library.js`
- Modify: `Blitzkrieg-by-Dominatemedia/js/main.js`

This is the biggest change — replacing the local library path + ExtendScript `getStashedComps()` with Supabase Storage reads.

**Step 1: Create the cloud library module**

Create `js/cloud-library.js`:

```javascript
// js/cloud-library.js
// Cloud-based template library using Supabase Storage
(function () {
    'use strict';

    var sb = window.blitzkriegSupabase;
    var BUCKET = 'blitzkrieg';

    // List all templates from the Supabase blitzkrieg bucket
    // Returns array in the same format as the old getStashedComps:
    // [{name, category, uniqueId, thumbUrl, duration, aepPath}]
    async function listTemplates() {
        // Step 1: List all top-level folders (categories)
        var categoriesResult = await sb.storage.from(BUCKET).list('', {
            limit: 1000,
            sortBy: { column: 'name', order: 'asc' },
        });

        if (categoriesResult.error) {
            throw new Error('Failed to list categories: ' + categoriesResult.error.message);
        }

        var categories = (categoriesResult.data || []).filter(function (item) {
            // Folders have null metadata
            return item.id === null || item.metadata === null;
        });

        var allComps = [];

        // Step 2: For each category, list comp folders
        for (var i = 0; i < categories.length; i++) {
            var categoryName = categories[i].name;

            var compsResult = await sb.storage.from(BUCKET).list(categoryName, {
                limit: 1000,
                sortBy: { column: 'name', order: 'asc' },
            });

            if (compsResult.error) continue;

            var compFolders = (compsResult.data || []).filter(function (item) {
                return item.id === null || item.metadata === null;
            });

            // Step 3: For each comp folder, read metadata.json
            for (var j = 0; j < compFolders.length; j++) {
                var compFolder = compFolders[j].name;
                var metadataPath = categoryName + '/' + compFolder + '/metadata.json';

                try {
                    var metaDownload = await sb.storage.from(BUCKET).download(metadataPath);
                    if (metaDownload.error) continue;

                    var metaText = await metaDownload.data.text();
                    var metadata = JSON.parse(metaText);

                    // Build thumbnail URL (signed URL for private bucket)
                    var thumbPath = categoryName + '/' + compFolder + '/thumbnail.jpg';
                    var thumbResult = await sb.storage.from(BUCKET).createSignedUrl(thumbPath, 3600);
                    var thumbUrl = thumbResult.data ? thumbResult.data.signedUrl : '';

                    // Extract uniqueId from folder name (format: CompName_timestamp)
                    var parts = compFolder.split('_');
                    var uniqueId = parts.length > 1 ? parts[parts.length - 1] : compFolder;

                    allComps.push({
                        name: metadata.displayName || compFolder,
                        category: categoryName,
                        uniqueId: uniqueId,
                        folderName: compFolder,
                        thumbUrl: thumbUrl,
                        duration: metadata.duration || 0,
                        width: metadata.width || 0,
                        height: metadata.height || 0,
                        frameRate: metadata.frameRate || 0,
                        previewFrames: metadata.previewFrames || 0,
                        storagePath: categoryName + '/' + compFolder,
                    });
                } catch (err) {
                    console.warn('Skipping comp folder ' + compFolder + ': ' + err.message);
                }
            }
        }

        return allComps;
    }

    // Download a template's .aep file to a temp location for import
    async function downloadTemplate(storagePath) {
        // Find the .aep file in the folder
        var filesResult = await sb.storage.from(BUCKET).list(storagePath, { limit: 100 });
        if (filesResult.error) {
            throw new Error('Failed to list template files: ' + filesResult.error.message);
        }

        var aepFile = (filesResult.data || []).find(function (f) {
            return f.name && f.name.toLowerCase().endsWith('.aep');
        });

        if (!aepFile) {
            throw new Error('No .aep file found in template folder');
        }

        var aepPath = storagePath + '/' + aepFile.name;
        var downloadResult = await sb.storage.from(BUCKET).download(aepPath);

        if (downloadResult.error) {
            throw new Error('Failed to download template: ' + downloadResult.error.message);
        }

        return {
            blob: downloadResult.data,
            fileName: aepFile.name,
        };
    }

    // Upload a template bundle (aep + thumbnail + metadata) to the bucket
    // Only works for blitzkrieg admins (RLS enforced)
    async function uploadTemplate(categoryName, compFolderName, files) {
        // files is an object: { aep: Blob, thumbnail: Blob, metadata: object }
        var basePath = categoryName + '/' + compFolderName;

        // Upload .aep file
        if (files.aep) {
            var aepResult = await sb.storage.from(BUCKET)
                .upload(basePath + '/template.aep', files.aep, {
                    contentType: 'application/octet-stream',
                    upsert: true,
                });
            if (aepResult.error) {
                throw new Error('Failed to upload .aep: ' + aepResult.error.message);
            }
        }

        // Upload thumbnail
        if (files.thumbnail) {
            var thumbResult = await sb.storage.from(BUCKET)
                .upload(basePath + '/thumbnail.jpg', files.thumbnail, {
                    contentType: 'image/jpeg',
                    upsert: true,
                });
            if (thumbResult.error) {
                throw new Error('Failed to upload thumbnail: ' + thumbResult.error.message);
            }
        }

        // Upload metadata.json
        if (files.metadata) {
            var metaBlob = new Blob([JSON.stringify(files.metadata)], { type: 'application/json' });
            var metaResult = await sb.storage.from(BUCKET)
                .upload(basePath + '/metadata.json', metaBlob, {
                    contentType: 'application/json',
                    upsert: true,
                });
            if (metaResult.error) {
                throw new Error('Failed to upload metadata: ' + metaResult.error.message);
            }
        }

        return basePath;
    }

    // Delete a template from the bucket (admin-only, RLS enforced)
    async function deleteTemplate(storagePath) {
        // List all files in the folder
        var filesResult = await sb.storage.from(BUCKET).list(storagePath, { limit: 100 });
        if (filesResult.error) {
            throw new Error('Failed to list files for deletion: ' + filesResult.error.message);
        }

        var filePaths = (filesResult.data || []).map(function (f) {
            return storagePath + '/' + f.name;
        });

        if (filePaths.length > 0) {
            var removeResult = await sb.storage.from(BUCKET).remove(filePaths);
            if (removeResult.error) {
                throw new Error('Failed to delete template: ' + removeResult.error.message);
            }
        }
    }

    // Rename a template (re-upload metadata with new displayName)
    async function renameTemplate(storagePath, newName) {
        var metadataPath = storagePath + '/metadata.json';
        var metaDownload = await sb.storage.from(BUCKET).download(metadataPath);
        if (metaDownload.error) {
            throw new Error('Failed to read metadata: ' + metaDownload.error.message);
        }

        var metaText = await metaDownload.data.text();
        var metadata = JSON.parse(metaText);
        metadata.displayName = newName;

        var metaBlob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
        var uploadResult = await sb.storage.from(BUCKET)
            .upload(metadataPath, metaBlob, {
                contentType: 'application/json',
                upsert: true,
            });
        if (uploadResult.error) {
            throw new Error('Failed to update metadata: ' + uploadResult.error.message);
        }
    }

    // Expose globally
    window.cloudLibrary = {
        listTemplates: listTemplates,
        downloadTemplate: downloadTemplate,
        uploadTemplate: uploadTemplate,
        deleteTemplate: deleteTemplate,
        renameTemplate: renameTemplate,
    };
})();
```

**Step 2: Add script tag**

In `index.html`, add `cloud-library.js` after `auth.js`:

```html
    <script src="./js/supabase.min.js"></script>
    <script src="./js/supabase-config.js"></script>
    <script src="./js/auth.js"></script>
    <script src="./js/cloud-library.js"></script>
    <script src="./js/CSInterface.js"></script>
    <script src="./js/main.js"></script>
```

**Step 3: Replace loadLibrary() in main.js**

In `main.js`, replace the `loadLibrary(path)` function (starting at line 766) with a new cloud-based version. The function currently takes a `path` argument and calls ExtendScript. The new version uses `window.cloudLibrary.listTemplates()`:

```javascript
    function loadLibrary() {
        if (isLoading) {
            pendingLibraryReload = true;
            return;
        }
        isLoading = true;
        pendingLibraryReload = false;
        showSpinner();

        debugLog('loadLibrary: Loading templates from cloud...', 'info');

        window.cloudLibrary.listTemplates().then(function (comps) {
            debugLog('loadLibrary: Loaded ' + comps.length + ' templates from cloud', 'success');
            allComps = comps;
            renderComps();
            hideSpinner();
            isLoading = false;

            if (pendingLibraryReload) {
                pendingLibraryReload = false;
                loadLibrary();
            }
        }).catch(function (err) {
            debugLog('loadLibrary: ERROR - ' + err.message, 'error');
            showToast('Failed to load templates: ' + err.message, true);
            hideSpinner();
            isLoading = false;
        });
    }
```

**Step 4: Update initializeAppLogic()**

In `initializeAppLogic()` (line 690), remove the `loadPersistentSettings` block (lines 711-720) that loads from a local path. Replace it with a direct `loadLibrary()` call (no path argument):

Replace:
```javascript
        loadPersistentSettings(function(settings) {
            debugLog('Settings loaded: ' + JSON.stringify(settings), 'info');
            var savedPath = settings.libraryPath;
            if (savedPath) {
                cachedLibraryPath = savedPath;
                pathDisplay.textContent = savedPath;
                pathDisplay.title = savedPath;
                loadLibrary(savedPath);
            }
        });
```

With:
```javascript
        // Load templates from cloud storage
        loadLibrary();
```

**Step 5: Update renderComps to use cloud thumbnail URLs**

In the `renderComps()` / `renderCompsGrid()` function, find where it builds thumbnail `<img>` tags. Currently it uses `pathToFileUrl(comp.thumbPath)` for the `src`. Replace with `comp.thumbUrl` (the signed URL from Supabase Storage).

Find all instances of `pathToFileUrl(comp.thumbPath)` or `comp.thumbPath` in the render function and replace with `comp.thumbUrl || ''`.

**Step 6: Update the window focus auto-refresh**

In `masterInit()`, the focus handler (line 532-543) currently checks `getLibraryPath()`. Replace with:

```javascript
        window.addEventListener('focus', function() {
            if (!stashInProgress) {
                if (isLoading) {
                    pendingLibraryReload = true;
                } else {
                    loadLibrary();
                }
            }
        });
```

**Step 7: Update the Refresh Library dropdown handler**

In `initDropdownMenu()`, the refresh handler (line 588-598) currently checks `getLibraryPath()`. Replace with:

```javascript
        if (dropdownRefresh) {
            dropdownRefresh.addEventListener('click', function(e) {
                e.preventDefault();
                dropdownContainer.classList.remove('open');
                loadLibrary();
                showToast('Library refreshed.');
            });
        }
```

**Step 8: Remove or hide library path display**

In the HTML, hide or remove the library path display (line 202). Change it to show "Cloud Library" or remove it. Simplest: update the default text:

```html
<span id="library-path-display" title="">Cloud Library</span>
```

**Step 9: Remove settings modal for library path**

Since there's no local library path to configure, remove the Settings menu item from the dropdown (lines 264-273) or repurpose it. For now, hide it.

**Step 10: Commit**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
git add js/cloud-library.js js/main.js index.html
git commit -m "feat: replace local filesystem library with Supabase cloud storage"
```

---

## Task 9: Gate Admin Features Behind blitzkrieg_admin

**Files:**
- Modify: `Blitzkrieg-by-Dominatemedia/js/main.js`
- Modify: `Blitzkrieg-by-Dominatemedia/index.html`

**Step 1: Conditionally show/hide the "Add Selected Comp" button**

In `masterInit()` (or just after it in the `onBlitzkriegAuthReady` flow), add:

```javascript
        // Hide admin-only UI elements for non-admins
        var addCompBtn = document.getElementById('add-comp-btn');
        var mainFooter = document.querySelector('.main-footer');
        if (!window.blitzkriegAuth.isAdmin()) {
            if (mainFooter) mainFooter.style.display = 'none';
        }
```

**Step 2: Conditionally hide admin actions on template cards**

In the `renderComps()` / `renderCompsGrid()` function, find where the action buttons are rendered on each card (rename, delete, move). Wrap them in an admin check:

When building the HTML for each comp card, check `window.blitzkriegAuth.isAdmin()` and only include rename/delete/move buttons if true. The import and favorite buttons should always be shown.

Example — find the actions HTML template and change it:

```javascript
var adminActions = '';
if (window.blitzkriegAuth && window.blitzkriegAuth.isAdmin()) {
    adminActions = '<button class="action-btn rename-btn" data-uniqueid="' + comp.uniqueId + '" title="Rename">...</button>' +
                   '<button class="action-btn delete-btn" data-uniqueid="' + comp.uniqueId + '" title="Delete">...</button>' +
                   '<button class="action-btn move-btn" data-uniqueid="' + comp.uniqueId + '" title="Move">...</button>';
}
```

Regular users only see the Import button and Favorite toggle.

**Step 3: Block executeAddComp for non-admins**

At the top of the `executeAddComp()` function, add a guard:

```javascript
    function executeAddComp() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to add templates.', true);
            return;
        }
        // ... rest of function
    }
```

Add similar guards to `executeDelete()`, `executeRename()`, `executeCategoryRename()`, `executeCategoryDelete()`, and `executeMoveComp()`.

**Step 4: Commit**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
git add js/main.js index.html
git commit -m "feat: gate add/rename/delete/move behind blitzkrieg_admin role"
```

---

## Task 10: Update Add Comp to Upload to Cloud

**Files:**
- Modify: `Blitzkrieg-by-Dominatemedia/js/main.js`

Currently `executeAddComp()` calls ExtendScript `stashSelectedComp()` which saves to the local filesystem. Now it needs to:
1. Still use ExtendScript to save the comp locally to a temp folder (to extract the .aep, thumbnail, and metadata)
2. Then upload those files to the Supabase bucket via `cloudLibrary.uploadTemplate()`
3. Then clean up the temp files

**Step 1: Create a temp-stash ExtendScript function**

In `jsx/hostscript.jsx`, add a new function `stashSelectedCompToTemp()` that saves to a system temp directory instead of the library path. It should return the paths to the generated files. Add near the end of the file:

```javascript
function stashSelectedCompToTemp(categoryName) {
    // Same as stashSelectedComp but saves to system temp directory
    // and returns file paths for upload
    var tempFolder = Folder.temp;
    var tempLibPath = tempFolder.fsName + '/blitzkrieg_temp';

    // Create temp directory
    var tempLib = new Folder(tempLibPath);
    if (!tempLib.exists) tempLib.create();

    // Call existing stash logic with temp path
    var result = stashSelectedComp(tempLibPath, categoryName);

    // Return the temp path so the JS layer can read the files
    return JSON.stringify({
        tempPath: tempLibPath,
        result: result
    });
}
```

**Step 2: Modify executeAddComp in main.js**

Replace the `executeAddComp()` function to:
1. Call `stashSelectedCompToTemp()` via ExtendScript
2. Read the generated files from the temp path
3. Upload to Supabase Storage via `cloudLibrary.uploadTemplate()`
4. Clean up temp files
5. Reload the library

This is complex because CEP panels can read local files via `XMLHttpRequest` with `file://` URLs (the manifest enables `--allow-file-access-from-files`).

```javascript
    async function executeAddComp() {
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to add templates.', true);
            return;
        }

        var categoryName = existingCategorySelect.value;
        var newCategory = newCategoryInput.value.trim();
        if (newCategory) categoryName = newCategory;

        if (!categoryName) {
            showToast('Please select or create a category.', true);
            return;
        }

        addCompModal.style.display = 'none';
        stashInProgress = true;
        showSpinner();
        showToast('Saving composition...');

        var safeCategory = escapeForExtendScript(categoryName);

        csInterface.evalScript('stashSelectedCompToTemp("' + safeCategory + '")', async function(result) {
            try {
                var parsed = JSON.parse(result);
                if (parsed.result && parsed.result.indexOf('ERROR') === 0) {
                    showToast(parsed.result, true);
                    stashInProgress = false;
                    hideSpinner();
                    return;
                }

                var tempPath = parsed.tempPath;

                // Read files from temp using ExtendScript (returns base64)
                var files = await readTempFiles(tempPath, categoryName);

                // Upload to cloud
                var compFolderName = files.folderName;
                await window.cloudLibrary.uploadTemplate(categoryName, compFolderName, {
                    aep: files.aepBlob,
                    thumbnail: files.thumbnailBlob,
                    metadata: files.metadata,
                });

                // Clean up temp files via ExtendScript
                csInterface.evalScript('cleanupTempStash("' + escapeForExtendScript(tempPath) + '")');

                showToast('Template added to cloud library!');
                stashInProgress = false;
                hideSpinner();
                loadLibrary();
            } catch (err) {
                debugLog('Upload error: ' + err.message, 'error');
                showToast('Failed to upload template: ' + err.message, true);
                stashInProgress = false;
                hideSpinner();
            }
        });
    }
```

**Step 3: Add readTempFiles helper**

Add a helper function to read files from temp directory using ExtendScript binary reading:

```javascript
    function readTempFiles(tempPath, categoryName) {
        return new Promise(function(resolve, reject) {
            var safePath = escapeForExtendScript(tempPath + '/' + categoryName);
            csInterface.evalScript('readStashedFilesAsBase64("' + safePath + '")', function(result) {
                try {
                    var data = JSON.parse(result);
                    if (data.error) {
                        reject(new Error(data.error));
                        return;
                    }

                    // Convert base64 to blobs
                    var aepBlob = base64ToBlob(data.aepBase64, 'application/octet-stream');
                    var thumbnailBlob = data.thumbnailBase64 ? base64ToBlob(data.thumbnailBase64, 'image/jpeg') : null;

                    resolve({
                        folderName: data.folderName,
                        aepBlob: aepBlob,
                        thumbnailBlob: thumbnailBlob,
                        metadata: data.metadata,
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    function base64ToBlob(base64, contentType) {
        var binary = atob(base64);
        var array = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        return new Blob([array], { type: contentType });
    }
```

**Step 4: Add ExtendScript helpers for reading files as base64**

In `jsx/hostscript.jsx`, add:

```javascript
function readStashedFilesAsBase64(compFolderPath) {
    try {
        var folder = new Folder(compFolderPath);
        if (!folder.exists) return JSON.stringify({error: 'Temp folder not found'});

        // Find the comp subfolder (first subfolder)
        var subFolders = folder.getFiles(function(f) { return f instanceof Folder; });
        if (subFolders.length === 0) return JSON.stringify({error: 'No comp folder found'});

        var compFolder = subFolders[0];
        var folderName = compFolder.name;

        // Read .aep file
        var aepFiles = compFolder.getFiles('*.aep');
        if (aepFiles.length === 0) return JSON.stringify({error: 'No .aep file found'});

        var aepBase64 = readFileAsBase64(aepFiles[0]);

        // Read thumbnail
        var thumbFiles = compFolder.getFiles('thumbnail.jpg');
        var thumbnailBase64 = thumbFiles.length > 0 ? readFileAsBase64(thumbFiles[0]) : null;

        // Read metadata
        var metaFiles = compFolder.getFiles('metadata.json');
        var metadata = {};
        if (metaFiles.length > 0) {
            metaFiles[0].open('r');
            var metaContent = metaFiles[0].read();
            metaFiles[0].close();
            metadata = JSON.parse(metaContent);
        }

        return JSON.stringify({
            folderName: folderName,
            aepBase64: aepBase64,
            thumbnailBase64: thumbnailBase64,
            metadata: metadata
        });
    } catch (e) {
        return JSON.stringify({error: e.toString()});
    }
}

function readFileAsBase64(file) {
    file.encoding = 'BINARY';
    file.open('r');
    var content = file.read();
    file.close();

    // ExtendScript base64 encoding
    var base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var result = '';
    var i = 0;
    while (i < content.length) {
        var b1 = content.charCodeAt(i++) & 0xFF;
        var b2 = i < content.length ? content.charCodeAt(i++) & 0xFF : 0;
        var b3 = i < content.length ? content.charCodeAt(i++) & 0xFF : 0;
        var padding = (i > content.length + 1) ? 2 : (i > content.length) ? 1 : 0;

        result += base64chars.charAt(b1 >> 2);
        result += base64chars.charAt(((b1 & 3) << 4) | (b2 >> 4));
        result += padding >= 1 ? '=' : base64chars.charAt(((b2 & 15) << 2) | (b3 >> 6));
        result += padding >= 2 ? '=' : base64chars.charAt(b3 & 63);
    }
    return result;
}

function cleanupTempStash(tempPath) {
    try {
        var folder = new Folder(tempPath);
        if (folder.exists) {
            // Recursively remove all files and folders
            var files = folder.getFiles();
            for (var i = 0; i < files.length; i++) {
                if (files[i] instanceof Folder) {
                    removeFolder(files[i]);
                } else {
                    files[i].remove();
                }
            }
            folder.remove();
        }
        return 'OK';
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}

function removeFolder(folder) {
    var files = folder.getFiles();
    for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof Folder) {
            removeFolder(files[i]);
        } else {
            files[i].remove();
        }
    }
    folder.remove();
}
```

**Step 5: Update import to download from cloud**

Find the `handleImport()` function in `main.js`. Currently it calls ExtendScript `importComp(aepPath)` with a local path. Replace it to:
1. Download the .aep from Supabase Storage to a temp file
2. Then call ExtendScript `importComp()` with the temp file path

```javascript
    async function handleImport(comp) {
        showSpinner();
        showToast('Downloading template...');

        try {
            var downloaded = await window.cloudLibrary.downloadTemplate(comp.storagePath);

            // Save blob to temp file via a data URL approach
            // Convert blob to base64, send to ExtendScript to write to temp
            var reader = new FileReader();
            reader.onload = function () {
                var base64 = reader.result.split(',')[1];
                var safeName = escapeForExtendScript(downloaded.fileName);

                csInterface.evalScript('writeTempFileFromBase64("' + base64 + '", "' + safeName + '")', function(tempPath) {
                    if (tempPath.indexOf('ERROR') === 0) {
                        showToast('Failed to save template: ' + tempPath, true);
                        hideSpinner();
                        return;
                    }

                    // Import the comp from the temp file
                    csInterface.evalScript('importComp("' + escapeForExtendScript(tempPath) + '")', function(importResult) {
                        hideSpinner();
                        if (importResult && importResult.indexOf('ERROR') === 0) {
                            showToast(importResult, true);
                        } else {
                            showToast('Template imported!');
                            // Track in recent
                            addToRecent(comp.uniqueId);
                        }
                    });
                });
            };
            reader.readAsDataURL(downloaded.blob);
        } catch (err) {
            hideSpinner();
            showToast('Failed to download template: ' + err.message, true);
        }
    }
```

**Step 6: Add writeTempFileFromBase64 to hostscript.jsx**

```javascript
function writeTempFileFromBase64(base64Data, fileName) {
    try {
        var tempFolder = Folder.temp;
        var tempFile = new File(tempFolder.fsName + '/blitzkrieg_import_' + fileName);

        // Decode base64
        var base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        var binary = '';
        var i = 0;
        // Remove padding
        var cleanBase64 = base64Data.replace(/[^A-Za-z0-9+\/]/g, '');
        while (i < cleanBase64.length) {
            var b1 = base64chars.indexOf(cleanBase64.charAt(i++));
            var b2 = base64chars.indexOf(cleanBase64.charAt(i++));
            var b3 = base64chars.indexOf(cleanBase64.charAt(i++));
            var b4 = base64chars.indexOf(cleanBase64.charAt(i++));

            binary += String.fromCharCode((b1 << 2) | (b2 >> 4));
            if (b3 !== -1) binary += String.fromCharCode(((b2 & 15) << 4) | (b3 >> 2));
            if (b4 !== -1) binary += String.fromCharCode(((b3 & 3) << 6) | b4);
        }

        tempFile.encoding = 'BINARY';
        tempFile.open('w');
        tempFile.write(binary);
        tempFile.close();

        return tempFile.fsName;
    } catch (e) {
        return 'ERROR: ' + e.toString();
    }
}
```

**Step 7: Commit**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
git add js/main.js js/cloud-library.js jsx/hostscript.jsx
git commit -m "feat: upload/download templates via Supabase cloud storage"
```

---

## Task 11: Update Delete and Rename to Use Cloud

**Files:**
- Modify: `Blitzkrieg-by-Dominatemedia/js/main.js`

**Step 1: Update executeDelete**

Replace the current `executeDelete()` function to use cloud deletion:

```javascript
    async function executeDelete() {
        if (!currentDeleteInfo) return;
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to delete templates.', true);
            deleteModal.style.display = 'none';
            return;
        }

        deleteModal.style.display = 'none';
        showSpinner();

        try {
            await window.cloudLibrary.deleteTemplate(currentDeleteInfo.storagePath);
            showToast('Template deleted.');
            currentDeleteInfo = null;
            loadLibrary();
        } catch (err) {
            showToast('Failed to delete: ' + err.message, true);
            hideSpinner();
        }
    }
```

**Step 2: Update executeRename**

Replace the current `executeRename()` function:

```javascript
    async function executeRename() {
        if (!currentRenameInfo) return;
        if (!window.blitzkriegAuth || !window.blitzkriegAuth.isAdmin()) {
            showToast('You do not have permission to rename templates.', true);
            renameModal.style.display = 'none';
            return;
        }

        var newName = newNameInput.value.trim();
        if (!newName) {
            showToast('Please enter a new name.', true);
            return;
        }

        renameModal.style.display = 'none';
        showSpinner();

        try {
            await window.cloudLibrary.renameTemplate(currentRenameInfo.storagePath, newName);
            showToast('Template renamed.');
            currentRenameInfo = null;
            loadLibrary();
        } catch (err) {
            showToast('Failed to rename: ' + err.message, true);
            hideSpinner();
        }
    }
```

**Step 3: Commit**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
git add js/main.js
git commit -m "feat: update delete and rename to use cloud storage"
```

---

## Task 12: Final Integration Test and Cleanup

**Files:**
- Modify: `Blitzkrieg-by-Dominatemedia/js/main.js` (cleanup unused local-only code)
- Modify: `Blitzkrieg-by-Dominatemedia/index.html` (final cleanup)

**Step 1: Remove dead code**

In `main.js`, remove or comment out functions that are no longer needed:
- `loadPersistentSettings()` and `savePersistentSettings()` — no longer needed (no local library path)
- `getLibraryPath()` / `cachedLibraryPath` — no longer needed
- `selectLibraryFolderFromUI()` — no longer needed
- `openSettings()` / `saveSettings()` / `closeSettings()` — no longer needed (settings modal removed)
- `isValidPath()` — no longer needed for library (keep if used elsewhere)

**Step 2: Remove Settings modal from HTML**

In `index.html`, remove the settings modal (lines 11-29) since there's no library path to configure. Also remove the Settings dropdown item (lines 264-273) from the dropdown menu.

**Step 3: Remove library-path display or update**

The `#library-path-display` element (line 202) should either be removed or show "Cloud Library" as set in Task 8.

**Step 4: Test checklist**

Manual testing in After Effects:

1. **Login screen shows on launch** — plugin opens to login screen, not template grid
2. **Invalid credentials show error** — enter wrong email/password, see error message
3. **Valid credentials with no access show denied screen** — log in as user without `blitzkrieg_access`, see "Access Denied"
4. **Valid credentials with access show template grid** — log in as user with `blitzkrieg_access = true`, see templates
5. **Admin sees Add/Rename/Delete/Move** — log in as `blitzkrieg_admin = true`, verify all admin UI elements visible
6. **Non-admin doesn't see admin UI** — log in as `blitzkrieg_access = true` but `blitzkrieg_admin = false`, verify Add button hidden, no rename/delete/move on cards
7. **Sign out works** — click Sign Out in menu, returns to login screen
8. **Offline shows offline screen** — disconnect internet, relaunch plugin, see "No Connection" screen
9. **Toggle access off locks user out** — admin disables `blitzkrieg_access` in portal, user's next refresh shows denied screen
10. **Admin can upload template** — select comp in AE, click Add, choose category, template appears in cloud library
11. **User can import template** — click Import on a template card, comp loads into AE project
12. **Refresh loads latest templates** — click Refresh Library, new templates appear

**Step 5: Commit**

```bash
cd /Users/thenorwegianoilfund/Blitzkrieg-by-Dominatemedia
git add -A
git commit -m "chore: clean up dead code and finalize cloud integration"
```

---

## Task 13: Update CLAUDE.md with Blitzkrieg Integration Notes

**Files:**
- Modify: `insight-flow-83/CLAUDE.md`

Add to the Lessons Learned > Architecture Decisions section:

```markdown
- [2026-03-02] **Decision**: Blitzkrieg AE plugin authenticates directly against Supabase (same auth as portal) using embedded anon key + RLS | **Why**: Simplest architecture, RLS handles all authorization, no custom middleware needed | **Alternatives rejected**: Custom API gateway (unnecessary complexity), token-based portal login (worst UX)
```

Add to the Key Data Model section:

```markdown
### Blitzkrieg Plugin
- **team_members.blitzkrieg_access** — boolean, controls plugin login access
- **team_members.blitzkrieg_admin** — boolean, controls template upload permission
- **storage.blitzkrieg** — private bucket, 50GB limit, RLS: access=read, admin=write, portal_admin=delete
```

**Step 1: Commit**

```bash
cd /Users/thenorwegianoilfund/insight-flow-83
git add CLAUDE.md
git commit -m "docs: add Blitzkrieg integration notes to CLAUDE.md"
```
