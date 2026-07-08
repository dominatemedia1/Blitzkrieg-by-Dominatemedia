-- blitzkrieg_thumbnail_status() RPC
-- ==================================
-- REQUIRED BY js/cloud-library.js (_fetchThumbnailStatus, called in fetchAllMetadata).
-- Applied to project kwrmdxptrrvlqxdcasho ("Dominate Media"), bucket 'blitzkrieg',
-- 2026-07-07 via migration `blitzkrieg_thumbnail_status_rpc`. Source-of-record.
--
-- WHY THIS EXISTS
-- buildCompsFromMetadata (js/cloud-library.js:784) derives thumbnailVerified and
-- previewFrameCount ONLY from metadata.json, never from actual storage. Bulk-imported
-- comps have a real comp.png in storage but metadata written before the hasCompPng flag
-- existed, so all three verification signals are false even though the thumbnail EXISTS.
-- The panel then shows them as "missing" and offers to regenerate 100+ comps; each
-- regeneration imports the template into the user's live AE project and renders frames,
-- and 100+ of those in a row crash AE 2026 natively. SQL over storage.objects proves
-- 246/250 comps (all 99 Pre-comps) already have comp.png. This function returns the real
-- per-comp storage state so the client can reconcile thumbnailVerified/previewFrameCount
-- to reality and STOP regenerating work that already exists.
--
-- SECURITY: mirrors blitzkrieg_list_folders -- SECURITY DEFINER (bypass storage RLS,
-- owner reads storage.objects), read-only, hardcoded to the 'blitzkrieg' bucket, returns
-- only folder names + counts (which an authenticated panel user can already enumerate),
-- search_path='' , granted to authenticated only. Runs ~260ms (index-only scan), called
-- once per cold load / background refresh, degrades to a null result (client keeps the
-- old metadata-only behaviour) on any error.

create or replace function public.blitzkrieg_thumbnail_status()
returns table(category text, folder text, has_png boolean, preview_frame_count integer)
language sql
security definer
set search_path = ''
stable
as $func$
  select (string_to_array(o.name, '/'))[1] as category,
         (string_to_array(o.name, '/'))[2] as folder,
         bool_or(o.name like '%/comp.png' or o.name like '%/thumbnail.png') as has_png,
         count(*) filter (where o.name ~ '/preview/frame_[0-9]+\.png$')::int as preview_frame_count
  from storage.objects o
  where o.bucket_id = 'blitzkrieg'
    and o.name like '%/%/%'
    and (string_to_array(o.name, '/'))[1] <> 'pending'
    and (string_to_array(o.name, '/'))[2] is not null
    and (string_to_array(o.name, '/'))[2] <> ''
  group by 1, 2
$func$;

revoke all on function public.blitzkrieg_thumbnail_status() from public;
grant execute on function public.blitzkrieg_thumbnail_status() to authenticated;
