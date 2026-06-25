# STG-1 storage remediation (split linked-comp / pre-comp dependencies)

Status: FOR REVIEW ONLY. Nothing in this document has been run against production.
Owner sign-off required before any backfill or re-nest step executes.

Date: 2026-06-24
Scope: the "import crashes / missing element + source files" #1 bug, data-layer half.
Code half (relink + dependency-aware download + upload de-freeze) shipped in this same branch (Wave A) and is independent of this document.

---

## 1. TL;DR

- The Wave A code now reads a template's linked dependencies from `metadata.json.dependencies` and downloads them into `(Footage)/_deps/<i>_<folder>/` so the host-side relink pass can re-point references.
- BUT every template currently stores `dependencies: []`. The stash writer (`jsx/hostscript.jsx`) hardcodes an empty array and relies on `reduceProject()` plus footage collection to inline everything. For templates where that collapse was incomplete (the STG-1 set), the dependency files live in a SEPARATE sibling storage folder that nothing references, so import lands with missing footage.
- Net: the Wave A dependency-download path is correct but DORMANT, because no template declares its dependencies. This document is the data-layer work to wake it up: detect the affected templates and backfill their `metadata.json.dependencies` (and optionally re-nest the files).
- This is NOT a SQL migration. The live template library is pure Supabase Storage (bucket `blitzkrieg`); `metadata.json` objects are the source of truth for dependencies. There is no `blitzkrieg_templates` table to UPDATE. The only DB table in play is `blitzkrieg_template_submissions`, which is the upload/review QUEUE, not the live library index. A SQL snippet is included in section 7 only for the optional, low-value task of keeping that queue's `metadata` jsonb mirror consistent.

---

## 2. Storage model (grounded, not assumed)

Confirmed from `js/cloud-library.js` and `jsx/hostscript.jsx`:

- Bucket: `blitzkrieg` (PRIVATE). One bucket holds the whole library.
- A template is a folder: `<Category>/<FolderName>/` containing:
  - `metadata.json` (template descriptor; includes `dependencies`, `duration`, `width`, `height`, `frameRate`, `previewFrameCount`, `cloudThumbnailGenerated`, `bundleAssetCount`, etc.)
  - `comp.png` (primary thumbnail), `thumbnail.png` (alt)
  - `preview/frame_<n>.png` (0-based preview frames)
  - the `.aep` (one per template; collapsed via `reduceProject()`)
  - `(Footage)/...` (collected footage for THIS template)
- Reads: `js/cloud-library.js` lists folders and downloads each `metadata.json` directly from Storage. The panel never queries a DB table for library content.

DB tables (from `information_schema`, project `kwrmdxptrrvlqxdcasho`):

| table | role | relevant to STG-1? |
|---|---|---|
| `blitzkrieg_template_submissions` | upload + review QUEUE (`storage_path`, `approved_storage_path`, `metadata` jsonb, `status`) | only as an optional secondary mirror (section 7) |
| `blitzkrieg_usage_events` | analytics | no |
| `blitzkrieg_error_logs` | client error log | useful as a detection signal (section 5b) |
| `blitzkrieg_applicants`, `blitzkrieg_applicant_notes` | designer recruitment | no |
| `blitzkrieg_config` | key/value config | no |

Conclusion: the canonical fix target is the Storage `metadata.json` objects. Operate via the Storage API with a service-role key, run locally, never from the panel.

---

## 3. The STG-1 gap, precisely

In `jsx/hostscript.jsx` (stash path, around the metadata build):

```jsx
// Linked sub-comp / pre-comp dependencies stored in sibling folders.
// reduceProject() collapses normal dependencies into this single .aep,
// ...
dependencies: [],
```

`dependencies` is ALWAYS written empty. The design assumption is that `reduceProject()` + the comprehensive footage collection inline everything into the one `.aep` + `(Footage)/`. STG-1 is the population where that assumption failed: a linked comp / pre-comp was itself a separate library template (its own folder), and the collapse left the `.aep` referencing assets that were never copied into this template's `(Footage)/`.

Because `dependencies` is empty, Wave A's `getTemplateDependencies()` returns `[]` and `fetchDependencyExtras()` fetches nothing. The relink pass then finds the footage genuinely absent, and the import surfaces a `BLITZ_MISSING` warning (the `survivingMissing` counter added in Wave A).

The data fix is to set `dependencies` on each affected template to the list of sibling storage paths it actually needs.

---

## 4. Why detection is the hard part (honest constraint)

You cannot know, from Storage objects alone, that template A references sibling B, because that linkage lives inside the binary `.aep` and is only resolvable by After Effects (or a dedicated `.aep` parser). So there is no pure-SQL or pure-Storage query that yields a definitive A -> [B, C] dependency map.

Two tractable detection paths, used together:

- 4a. Storage-side CANDIDATE flagging (read-only, cheap, approximate): enumerate templates and flag the suspicious ones (empty or tiny `(Footage)/` relative to a large `.aep`, or `bundleAssetCount: 0` on a visually complex template). This narrows the field; it does not prove a dependency.
- 4b. Operational GROUND TRUTH (authoritative, incremental): the Wave A import already computes `survivingMissing` + `survivingNames` after relink. Capturing those at import time tells you exactly which templates are broken and which footage basenames are missing. That is the real signal. Section 5b proposes logging it.

Recommended: ship 4b as the durable detection (it produces a precise broken-set over normal usage), use 4a once now to get a head start on the backlog, and have a human confirm each A -> B mapping before backfill.

Do not fabricate an affected count. Run the section 5a audit to MEASURE it; this document deliberately states no number.

---

## 5. Detection scripts (read-only, DO NOT mutate)

### 5a. Storage audit (Node, local, service-role)

Run locally. Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the environment (never commit the key). Produces a per-template report; mutates nothing.

```js
// stg1-audit.mjs  --  READ ONLY. Lists every template with a footage/aep summary.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node stg1-audit.mjs > stg1-report.json
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BUCKET = 'blitzkrieg'

async function listAll(prefix) {
  const out = []
  let offset = 0
  for (;;) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000, offset })
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
    offset += data.length
  }
  return out
}

// A "folder" entry from storage.list has id === null.
const isFolder = (e) => e && e.id === null

async function walkFootageCount(path) {
  // Count files (not folders) under <path>/(Footage)/ recursively, plus total bytes.
  let files = 0, bytes = 0
  const stack = [path + '/(Footage)']
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = await listAll(dir) } catch { continue }
    for (const e of entries) {
      if (isFolder(e)) stack.push(dir + '/' + e.name)
      else { files++; bytes += (e.metadata && e.metadata.size) || 0 }
    }
  }
  return { files, bytes }
}

const categories = (await listAll('')).filter(isFolder)
const report = []
for (const cat of categories) {
  const templates = (await listAll(cat.name)).filter(isFolder)
  for (const tpl of templates) {
    const base = cat.name + '/' + tpl.name
    const top = await listAll(base)
    const aep = top.find((e) => !isFolder(e) && /\.aep$/i.test(e.name))
    let meta = null
    try {
      const { data } = await sb.storage.from(BUCKET).download(base + '/metadata.json')
      meta = JSON.parse(await data.text())
    } catch { /* missing/unparseable metadata */ }
    const foot = await walkFootageCount(base)
    report.push({
      storagePath: base,
      hasAep: !!aep,
      aepBytes: aep ? ((aep.metadata && aep.metadata.size) || 0) : 0,
      footageFiles: foot.files,
      footageBytes: foot.bytes,
      declaredDeps: (meta && Array.isArray(meta.dependencies)) ? meta.dependencies.length : 0,
      bundleAssetCount: meta ? (meta.bundleAssetCount ?? null) : null,
      // heuristic candidate: a real .aep with zero collected footage is suspicious
      candidate: !!aep && foot.files === 0
    })
  }
}
console.log(JSON.stringify({ total: report.length, candidates: report.filter(r => r.candidate).length, report }, null, 2))
```

Review the `candidates` list by hand. A candidate is a hint, not proof; confirm against the operational signal (5b) and, where needed, by opening the `.aep` in AE.

### 5b. Operational ground-truth (small code add, proposed for a later PR)

At import time the panel already knows `survivingMissing` + `survivingNames` (Wave A). Persist that so the broken-set is measured precisely over normal usage:

- On a non-zero `survivingMissing`, write one row to `blitzkrieg_error_logs` (already exists; `error_level='warn'`, `context` jsonb = `{ storagePath, survivingNames }`). No schema change needed.
- Then `select context->>'storagePath', count(*) from blitzkrieg_error_logs where message like 'STG1%' group by 1 order by 2 desc;` gives the prioritized backfill worklist.

This is the authoritative detector; 5a is only a cold-start head start.

---

## 6. Backfill (mutating; gated on a reviewed mapping)

Only after a human has confirmed, per affected template, the exact sibling storage paths it depends on. Input is a reviewed JSON map `{ "<storagePath>": ["<depPath>", ...], ... }`.

Two independent options. Option A (metadata-only) is the minimal, lowest-risk fix and is preferred. Option B (re-nest) is heavier and only needed if you want plain (non-Wave-A) clients to also resolve dependencies.

### Option A (PREFERRED): backfill `metadata.json.dependencies` (no file moves)

```js
// stg1-backfill-deps.mjs  --  MUTATES metadata.json only. Re-uploads with merged dependencies.
// DRY RUN by default; pass --apply to write. Review stg1-map.json first.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const BUCKET = 'blitzkrieg'
const map = JSON.parse(readFileSync('stg1-map.json', 'utf8'))

for (const [path, deps] of Object.entries(map)) {
  const { data, error } = await sb.storage.from(BUCKET).download(path + '/metadata.json')
  if (error) { console.error('SKIP (no metadata):', path, error.message); continue }
  const meta = JSON.parse(await data.text())
  const before = Array.isArray(meta.dependencies) ? meta.dependencies : []
  const merged = Array.from(new Set([...before, ...deps])).filter((d) => d && d !== path)
  if (JSON.stringify(before) === JSON.stringify(merged)) { console.log('NOOP:', path); continue }
  console.log((APPLY ? 'WRITE' : 'DRY  '), path, before, '->', merged)
  if (!APPLY) continue
  const blob = new Blob([JSON.stringify(meta && { ...meta, dependencies: merged })], { type: 'application/json' })
  const up = await sb.storage.from(BUCKET).upload(path + '/metadata.json', blob, { contentType: 'application/json', upsert: true })
  if (up.error) console.error('FAIL:', path, up.error.message)
}
```

Once `dependencies` is populated, the Wave A code activates with no further changes: `fetchDependencyExtras()` pulls each dep into `(Footage)/_deps/` and the relink pass re-points the references.

### Option B (OPTIONAL): physically re-nest dependency files

Copy each dependency's importable files into `<template>/(Footage)/_deps/<i>_<depFolder>/`, matching the exact convention Wave A's `fetchDependencyExtras` uses (`(Footage)/_deps/<index>_<lastPathSegment>/<relativePath>`). Skip `metadata.json`, `comp.png`, `thumbnail.png`, `thumbnail.jpg`, `preview/*`, `.emptyFolderPlaceholder`, `.DS_Store`. This makes the template self-contained for ALL clients, at the cost of duplicated bytes. Use COPY, never MOVE: the dependency is itself a live library template and must not be emptied. Do not delete the source folder.

(Re-nest script intentionally omitted from this first pass; it is only worth building if a meaningful share of clients are on a pre-Wave-A build. Decide after the 5a/5b numbers are in.)

---

## 7. Optional: keep the submissions-queue mirror consistent (the only SQL here)

`blitzkrieg_template_submissions.metadata` is a jsonb snapshot taken at submission time. The live panel does NOT read it for the library, so updating it is cosmetic/audit-only. If you want the queue's record to match the backfilled live metadata, this is the shape (REVIEW ONLY, do not run):

```sql
-- OPTIONAL, AUDIT-ONLY. The panel does not read this for the live library.
-- Sets dependencies on the submission row that matches a backfilled template.
-- Run one row at a time after confirming the mapping; never a blanket UPDATE.
update public.blitzkrieg_template_submissions
set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{dependencies}', $1::jsonb, true),
    updated_at = now()
where approved_storage_path = $2     -- the live template path
   or storage_path = $2;
```

Skip this unless an audit specifically needs the queue and live state to agree. It does not affect import behavior.

---

## 8. Forward fix (stop the gap regrowing) - CODE, separate from this data work

The durable fix is to make the stash self-declare dependencies so no future backfill is ever needed. In `jsx/hostscript.jsx`, when `reduceProject()` leaves external linked comps / missing footage that map to other library folders, write those sibling paths into `dependencies` instead of the hardcoded `[]`. This requires resolving an AE footage path back to a library `storagePath`, which is only knowable for templates imported FROM the library (carry the origin storagePath on the imported items). Track as a follow-up code task; it is out of scope for this data document.

---

## 9. Rollout order + sign-off gates

1. Run 5a audit (read-only). Review `candidates`. (no risk)
2. Land 5b operational logging in a later PR. Let it accumulate a real broken-set. (no risk; additive)
3. Human builds `stg1-map.json` from 5a + 5b + AE confirmation. (no risk)
4. Run Option A backfill in DRY RUN. Review the `before -> after` lines. (no risk)
5. OWNER SIGN-OFF. Run Option A with `--apply`. (mutates metadata.json only; reversible by re-uploading prior metadata, which the audit JSON preserves)
6. Re-import a sample of backfilled templates in AE; confirm `survivingMissing` is now 0. (verification gate)
7. Decide on Option B / section 7 only if the client-version mix justifies it.

## 10. What NOT to do

- Do not MOVE dependency files; the dependency is a live template too. COPY only (Option B).
- Do not run a blanket UPDATE on `blitzkrieg_template_submissions`; it does not drive the library and a wide write risks the live queue.
- Do not delete any source footage or any sibling folder.
- Do not populate `dependencies` with a path equal to the template itself (self-reference); the backfill script already filters this.
- Do not run any backfill before the 5a/5b measurement and owner sign-off. No fabricated counts.
