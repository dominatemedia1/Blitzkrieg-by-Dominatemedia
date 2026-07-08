-- blitzkrieg_list_folders(_category) RPC
-- ========================================
-- REQUIRED BY js/cloud-library.js (_listFoldersViaRpc / listCategoryWithRetry).
-- Applied to the Supabase project the panel connects to (kwrmdxptrrvlqxdcasho,
-- "Dominate Media"), bucket 'blitzkrieg', on 2026-07-07 via migration
-- `blitzkrieg_list_folders_rpc`. Kept here as the source-of-record so the
-- client's dependency on this function is discoverable and reproducible.
--
-- WHY THIS EXISTS
-- The panel used to list each category via Supabase Storage list(), which runs
-- storage.search() -- a grouped scan over EVERY nested object under the prefix.
-- The largest category (Pre-comps: ~2200 objects / 99 folders) exceeded the DB
-- statement timeout, so its list() failed at 15/30/60s and the library loaded
-- only 151 of 250 templates and never published a manifest -> every launch was
-- trapped in a ~183s slow path. An index-only scan of the same rows returns the
-- 99 folder names in ~70ms. This function exposes exactly that: the immediate
-- child folder names of a category in the 'blitzkrieg' bucket, nothing else.
-- With it, a cold load dropped from 183s -> 10.5s and the published manifest
-- makes every subsequent load ~0.66s.
--
-- SECURITY
-- SECURITY DEFINER so it bypasses storage RLS (owner reads storage.objects) but
-- it is read-only, hardcoded to the 'blitzkrieg' bucket, returns only folder
-- names (which any authenticated panel user can already enumerate via the
-- storage API), locks search_path='', and parameterizes + escapes the category
-- input. Granted to authenticated only.

create or replace function public.blitzkrieg_list_folders(_category text)
returns table(name text)
language sql
security definer
set search_path = ''
stable
as $func$
  select distinct (string_to_array(o.name, '/'))[2] as name
  from storage.objects o
  where o.bucket_id = 'blitzkrieg'
    and o.name like
        replace(replace(replace(_category, '\', '\\'), '%', '\%'), '_', '\_') || '/%/%'
        escape '\'
    and (string_to_array(o.name, '/'))[2] <> ''
$func$;

revoke all on function public.blitzkrieg_list_folders(text) from public;
grant execute on function public.blitzkrieg_list_folders(text) to authenticated;
