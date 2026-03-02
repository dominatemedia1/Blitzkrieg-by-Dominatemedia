# Blitzkrieg Auth & Cloud Integration Design

**Date:** 2026-03-02
**Status:** Approved

## Overview

Integrate Blitzkrieg (After Effects CEP panel plugin) with the Dominate Media Portal (insight-flow-83) to add:
1. Authentication gated by Supabase Auth
2. Per-member access control (enable/disable from the portal)
3. A "Blitzkrieg Admin" role controlling who can add templates
4. Cloud-only template storage via a Supabase Storage bucket

## Architecture: Direct Supabase Client in Plugin

Embed the Supabase JS client directly in the Blitzkrieg CEP panel. The plugin talks to Supabase for auth and storage with no middleman. RLS policies enforce authorization at the database/storage level.

**Rejected alternatives:**
- Custom API Gateway (Edge Function middleman) — unnecessary complexity, duplicates what RLS handles
- Token-based portal login (copy-paste tokens) — worst UX, token-sharing risk

## 1. Authentication Flow

1. Plugin loads -> checks localStorage for existing Supabase session
2. No valid session -> shows login screen (email + password, Dominate Media branding)
3. User submits credentials -> `supabase.auth.signInWithPassword()` validates
4. Auth succeeds -> query `team_members` where `user_id` matches authenticated user
5. Check `blitzkrieg_access` column:
   - `false` or no record -> "Access Denied" screen, full lockout
   - `true` -> proceed
6. Check `blitzkrieg_admin` column -> store in memory for UI gating
7. Load template library from Supabase `blitzkrieg` storage bucket
8. On every subsequent launch -> validate stored session + re-check `blitzkrieg_access`
9. If access revoked since last login -> immediate lockout

**Offline behavior:** Full lockout. "Cannot connect - check your internet" + Retry button. No cached access.

**Security:** Plugin UI is completely hidden behind auth gate. Zero functionality without verified session + active access.

## 2. Database Changes (insight-flow-83)

### New columns on `team_members` table

```sql
ALTER TABLE team_members
ADD COLUMN blitzkrieg_access BOOLEAN DEFAULT false,
ADD COLUMN blitzkrieg_admin BOOLEAN DEFAULT false;
```

- `blitzkrieg_access` — controls whether the team member can use the plugin
- `blitzkrieg_admin` — controls whether they can upload/add new templates

### RLS

Existing `team_members` RLS policies apply. New columns inherit:
- Admins can read/write all records
- Team members can read their own record

## 3. Portal UI Changes (insight-flow-83)

### Team Member Profile — New "Blitzkrieg" Section

Two toggles on the team member detail/edit view:

1. **"Blitzkrieg Access"** toggle
   - Enable: user can log in and browse/import templates
   - Disable: plugin locks user out on next session check

2. **"Blitzkrieg Admin"** toggle
   - Only visible when Blitzkrieg Access is enabled
   - Enable: user can upload new templates to shared library
   - Disable: user can only browse/import, not add

**Who can manage:** Portal admins only (users with `admin` role in `user_roles`).

## 4. Supabase Storage Bucket

### New bucket: `blitzkrieg`

- **Type:** Private (requires authentication)
- **Max file size:** 50GB
- **Allowed types:** `.aep`, `.aet`, `.mogrt`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.json`

### Bucket structure

```
blitzkrieg/
  Category1/
    CompName_uniqueId/
      template.aep
      thumbnail.jpg
      metadata.json
  Category2/
    ...
```

### RLS Policies

| Operation | Who |
|-----------|-----|
| Read (list/download) | Authenticated users with `blitzkrieg_access = true` |
| Write (upload/create) | Authenticated users with `blitzkrieg_admin = true` |
| Update | Authenticated users with `blitzkrieg_admin = true` |
| Delete | Portal admins only (`user_roles.role = 'admin'`) |

## 5. Plugin UI Changes (Blitzkrieg)

### New screens

1. **Login Screen** — email/password fields, Sign In button, DM branding, error states
2. **Access Denied Screen** — "Your Blitzkrieg access is disabled. Contact your admin."
3. **No Connection Screen** — "Cannot connect. Check your internet and try again." + Retry

### Modified screens

- **Template Grid** — loads from Supabase Storage instead of local filesystem
- **Sidebar** — same categories/favorites/recent, data from cloud
- **"Add Selected Comp" button** — only visible for Blitzkrieg admins
- **Template card actions** — rename/delete/move only for admins; regular users see Import + Favorite only
- **Settings/Menu** — removes "Library Path", adds "Sign Out", shows logged-in user info

### Unchanged

- Dark theme and branding
- Grid layout options
- Search and sort
- Keyboard shortcuts
- Preview frames system

## 6. Dependencies & New Packages

### Blitzkrieg plugin
- `@supabase/supabase-js` — bundled into the CEP panel (loaded via script tag or bundled JS)

### insight-flow-83
- No new dependencies (existing Supabase infrastructure)

## 7. Security Considerations

- Supabase anon key embedded in plugin is public by design — RLS enforces all access control
- Session tokens stored in CEP localStorage (standard Supabase behavior)
- Every plugin launch validates session + checks access flags server-side
- Admin toggling access off = immediate lockout on next session check
- No local caching of templates or credentials
- Storage RLS prevents non-admins from uploading even if UI is bypassed
