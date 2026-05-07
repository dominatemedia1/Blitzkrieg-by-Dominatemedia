# Template Reclassification — Design Spec

**Date:** 2026-05-05
**Status:** design-approved

## Goal

Reorganize 248 templates from 4 editor-name categories into 12 animation-type categories. Rename every template with clear human names. Add multi-category support (1-3 categories per template).

## Taxonomy — 12 Categories

| # | Category | What goes in |
|---|----------|-------------|
| 1 | Titles & Openers | Main titles, intros, kinetic type, headline reveals |
| 2 | Lower Thirds | Name supers, info bars, social handles, speaker IDs |
| 3 | Backgrounds | Abstract, gradients, particles, minimal loops |
| 4 | Transitions | Wipes, slides, zooms, morphs, glitch |
| 5 | Call to Actions | Subscribe, like, follow, end screens, arrows, overlays |
| 6 | Icons & Shapes | Social icons, geometric shapes, lines, dividers, badges |
| 7 | Callouts | Speech bubbles, annotation boxes, highlights, tooltips |
| 8 | Infographics | Charts, graphs, stats, percentages, counters, meters |
| 9 | Process & Steps | Step-by-step, numbered sequences, timelines, tutorials |
| 10 | 3D & Depth | 3D models, isometric, camera rigs, depth effects |
| 11 | Overlays & FX | Grain, dust, light leaks, VHS, glitch overlays, film texture |
| 12 | Pre-comps | Reusable nested comps, building blocks, assembled linked |

## Multi-Category Support

Templates can have 1-3 categories. Primary category = storage folder location. Secondary categories = tags in manifest, virtual only — template appears in filter results for any assigned category. No storage duplication.

**Manifest change:** `categoryName` stays the primary (folder location). New `categories` array on each folder entry for UI filtering.

```json
{
  "folders": [{
    "categoryName": "Titles & Openers",
    "folderName": "White-Text-Centered-Slide_1768765038862",
    "categories": ["Titles & Openers", "Lower Thirds"],
    "metadata": { ... }
  }]
}
```

## Naming Convention

Format: `VisualDescription_<uniqueId>`

Style: describe what's on screen. No AI fluff words. No "elegant," "dynamic," "premium," "seamless." Color + shape + motion + what it is. UniqueId suffix preserved for all existing code paths.

```
Before                             After
1_1768503481030/              →    White-Text-Centered-Slide_1768503481030/
3_model_2_1768502088532/      →    Isometric-Phone-Rotating_1768502088532/
assemble_Linked_Comp_02_.../  →    Linked-Block-Blue-Glow_1768505171855/
```

## Classification Pipeline

Script: `scripts/classify-templates.js`

1. Pull manifest via Supabase REST (service role key from env `SUPABASE_SERVICE_ROLE_KEY`)
2. For each template, extract: `displayName`, `folderName`, `duration`, `width`, `height`, `frameRate`, `previewFrameCount`
3. Run 4-tier classification (keyword match → aspect ratio → duration → flag for review)
4. Assign primary category + secondary categories (1-3 total)
5. Generate new display name + folder name
6. Output `classification-plan.json` — human review before any move

**Output format:**
```json
{
  "templates": [{
    "oldPath": "Dominate Media/1_1768503481030",
    "newPath": "Titles & Openers/White-Text-Centered-Slide_1768503481030",
    "newDisplayName": "White Text Centered Slide",
    "categories": ["Titles & Openers"],
    "confidence": 0.92,
    "needsReview": false
  }],
  "summary": {
    "total": 248,
    "autoClassified": 210,
    "needsReview": 38
  }
}
```

## Migration Script

Script: `scripts/reclassify-templates.js`

Reads approved `classification-plan.json`. Executes in 5 phases with verification at each gate:

**Phase 0 — Dry-run:** Log all proposed moves, count objects, estimate size. No mutations.
**Phase 1 — Backup:** Upload `_blitzkrieg_manifest_v2_backup_<ts>.json` to bucket root.
**Phase 2 — Copy:** Copy each folder to new path via Supabase `move` API (server-side copy+delete). Batch size: 10 templates. Verify after each batch.
**Phase 3 — Manifest:** Upload new manifest with updated `categoryName`, `categories`, `metadata.displayName`, `folderName` for all moved folders.
**Phase 4 — Cleanup:** Delete old category folders if empty after migration.
**Phase 5 — Verify:** Download manifest, spot-check 10 random templates have working signed URLs.

## Manifest Changes Summary

| Field | Change |
|-------|--------|
| `folderName` | Renamed to clean format |
| `categoryName` | New animation-type category |
| `categories` | NEW — array of 1-3 category strings |
| `metadata.displayName` | Renamed to clean human name |

## Code Changes

| File | Change |
|------|--------|
| `js/cloud-library.js` | `buildCompsFromMetadata()` — read `categories` array for filtering; `invalidateManifest()` — rebuild with new fields |
| `js/main.js` | Category sidebar — render from new taxonomy; filter logic — match on any value in `categories` array |
| `CSS/style.css` | No changes needed |
| `jsx/hostscript.jsx` | No changes |
| `index.html` | No changes |

## Verification Gates

1. Classification plan reviewed by human before any mutation
2. Backup manifest uploaded and verified accessible
3. Each batch copy verified before next batch
4. Final manifest integrity check — download and parse
5. Spot-check 10 templates via signed URL
6. Panel smoke test — load library, browse categories, import a template
