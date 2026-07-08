-- Team-shared favorites for the Blitzkrieg template library.
-- Editors favorite templates; every Blitzkrieg team member can SEE the whole
-- team's favorites (the point of the feature), but can only add/remove their own.
-- Mirrors the access pattern of blitzkrieg_template_submissions
-- (has_blitzkrieg_access() / has_blitzkrieg_admin()).

create table if not exists public.blitzkrieg_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  team_member_id uuid references public.team_members(id) on delete set null,
  storage_path text not null,
  template_name text,
  category text,
  created_at timestamptz not null default now(),
  unique (user_id, storage_path)
);

create index if not exists idx_blitzkrieg_favorites_user on public.blitzkrieg_favorites (user_id);
create index if not exists idx_blitzkrieg_favorites_path on public.blitzkrieg_favorites (storage_path);

alter table public.blitzkrieg_favorites enable row level security;

-- Any Blitzkrieg team member can see all favorites (team-wide visibility).
drop policy if exists blitzkrieg_favorites_select on public.blitzkrieg_favorites;
create policy blitzkrieg_favorites_select
  on public.blitzkrieg_favorites for select
  using (has_blitzkrieg_access());

-- A user can only insert their OWN favorite rows.
drop policy if exists blitzkrieg_favorites_insert_own on public.blitzkrieg_favorites;
create policy blitzkrieg_favorites_insert_own
  on public.blitzkrieg_favorites for insert
  with check (user_id = (select auth.uid()) and has_blitzkrieg_access());

-- A user can only delete their OWN favorite rows.
drop policy if exists blitzkrieg_favorites_delete_own on public.blitzkrieg_favorites;
create policy blitzkrieg_favorites_delete_own
  on public.blitzkrieg_favorites for delete
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.blitzkrieg_favorites to authenticated;
