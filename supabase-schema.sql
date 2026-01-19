-- ============================================
-- BLITZKRIEG SUPABASE DATABASE SCHEMA
-- ============================================
-- Run this SQL in your Supabase SQL Editor to set up the database
-- Dashboard > SQL Editor > New Query > Paste this > Run

-- ============================================
-- 1. INVITES TABLE (for invite-only registration)
-- ============================================
CREATE TABLE IF NOT EXISTS invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  created_by UUID REFERENCES auth.users,
  email TEXT,
  used_by UUID REFERENCES auth.users,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  max_uses INT DEFAULT 1,
  use_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read invites (needed for validation during signup)
CREATE POLICY "Anyone can read invites for validation" ON invites
  FOR SELECT USING (true);

-- Policy: Only admins can insert/update/delete invites
CREATE POLICY "Admins can manage invites" ON invites
  FOR ALL USING (
    auth.uid() IN (SELECT user_id FROM admins)
  );

-- ============================================
-- 2. ADMINS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can check admin status
CREATE POLICY "Anyone can check admin status" ON admins
  FOR SELECT USING (true);

-- ============================================
-- 3. COMPOSITIONS TABLE (for cloud storage)
-- ============================================
CREATE TABLE IF NOT EXISTS compositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  duration FLOAT,
  frame_rate INT,
  width INT,
  height INT,
  preview_frame_count INT,
  ae_version TEXT,
  aep_s3_key TEXT,
  thumbnail_s3_key TEXT,
  preview_prefix TEXT,
  is_favorite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE compositions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can CRUD their own compositions
CREATE POLICY "Users CRUD own compositions" ON compositions
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 4. CATEGORIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Enable RLS
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Policy: Users can CRUD their own categories
CREATE POLICY "Users CRUD own categories" ON categories
  FOR ALL USING (auth.uid() = user_id);

-- ============================================
-- 5. TEAMS TABLE (for team sharing)
-- ============================================
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES auth.users NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Policy: Team members can read their teams
CREATE POLICY "Team members can read teams" ON teams
  FOR SELECT USING (
    owner_id = auth.uid() OR
    id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Policy: Team owners can update/delete their teams
CREATE POLICY "Team owners can manage teams" ON teams
  FOR ALL USING (owner_id = auth.uid());

-- ============================================
-- 6. TEAM MEMBERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID REFERENCES teams ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- Enable RLS
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- Policy: Team members can read membership
CREATE POLICY "Team members can read membership" ON team_members
  FOR SELECT USING (
    user_id = auth.uid() OR
    team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
  );

-- Policy: Team owners can manage members
CREATE POLICY "Team owners can manage members" ON team_members
  FOR ALL USING (
    team_id IN (SELECT id FROM teams WHERE owner_id = auth.uid())
  );

-- ============================================
-- 7. SHARED COMPOSITIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS shared_compositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  composition_id UUID REFERENCES compositions ON DELETE CASCADE NOT NULL,
  team_id UUID REFERENCES teams ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  permission TEXT DEFAULT 'view',
  shared_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT share_target CHECK (team_id IS NOT NULL OR shared_with_user_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE shared_compositions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see compositions shared with them
CREATE POLICY "Users can see shared compositions" ON shared_compositions
  FOR SELECT USING (
    shared_with_user_id = auth.uid() OR
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()) OR
    composition_id IN (SELECT id FROM compositions WHERE user_id = auth.uid())
  );

-- Policy for viewing shared compositions (add to compositions table)
CREATE POLICY "Users view shared compositions" ON compositions
  FOR SELECT USING (
    user_id = auth.uid() OR
    id IN (
      SELECT composition_id FROM shared_compositions
      WHERE shared_with_user_id = auth.uid()
      OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
    )
  );

-- ============================================
-- 8. HELPER FUNCTION: Update invite use count
-- ============================================
CREATE OR REPLACE FUNCTION increment_invite_use_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE invites
  SET use_count = use_count + 1,
      used_at = CASE WHEN used_at IS NULL THEN NOW() ELSE used_at END
  WHERE code = NEW.code;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- SETUP INSTRUCTIONS
-- ============================================
--
-- After running this SQL:
--
-- 1. Go to Authentication > Settings
--    - Enable Email/Password sign-in
--    - (Optional) Configure email templates
--
-- 2. Create your first admin:
--    a. Sign up a user account first (you'll need to temporarily disable invite requirement)
--    b. Get the user's ID from Authentication > Users
--    c. Run: INSERT INTO admins (user_id) VALUES ('your-user-id-here');
--    d. Re-enable invite requirement
--
-- 3. Get your API credentials:
--    - Go to Settings > API
--    - Copy "Project URL" and "anon public" key
--    - Update js/supabase-client.js with these values
--
-- 4. (Optional) Set up S3 for file storage:
--    - Create an S3 bucket
--    - Create a Supabase Edge Function for signed URLs
--    - Or use Supabase Storage instead of S3
--
