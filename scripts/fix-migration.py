#!/usr/bin/env python3
"""
fix-migration.py — Fix 7 broken category migrations.
Uses URL-safe folder names (dashes instead of spaces/&) for Supabase Storage paths.
Only moves templates still in old category folders that need to go to special-char categories.
"""

import json
import os
import sys
import time
import requests
from io import BytesIO
from collections import defaultdict

# ── Config ──────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://kwrmdxptrrvlqxdcasho.supabase.co")
JWT = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not JWT:
    sys.exit("SUPABASE_SERVICE_ROLE_KEY env var required (sb_secret_* or legacy JWT)")
BUCKET = "blitzkrieg"
PLAN_PATH = os.path.join(os.path.dirname(__file__), "..", "classification-plan.json")
HEADERS = {"Authorization": f"Bearer {JWT}", "apikey": JWT}
API = f"{SUPABASE_URL}/storage/v1"

# URL-safe category name
def safe_cat(name):
    return name.replace(" & ", "-and-").replace(" ", "-")

def list_folder(prefix):
    """List all items in a folder prefix. Returns list of {name, id, metadata}."""
    r = requests.post(
        f"{API}/object/list/{BUCKET}",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={"prefix": prefix, "limit": 1000},
    )
    if r.status_code != 200:
        print(f"  LIST ERROR {prefix}: {r.status_code} {r.text[:200]}")
        return []
    return r.json()

def download_file(path):
    """Download a file from storage. Returns bytes or None."""
    r = requests.get(
        f"{API}/object/{BUCKET}/{path}",
        headers=HEADERS,
    )
    if r.status_code != 200:
        print(f"  DOWNLOAD ERROR {path}: {r.status_code}")
        return None
    return r.content

def upload_file(path, data, content_type="application/octet-stream"):
    """Upload a file to storage."""
    r = requests.post(
        f"{API}/object/{BUCKET}/{path}",
        headers={**HEADERS},
        files={"file": (os.path.basename(path), BytesIO(data), content_type)},
        data={"upsert": "true"},
    )
    if r.status_code not in (200, 201):
        print(f"  UPLOAD ERROR {path}: {r.status_code} {r.text[:200]}")
        return False
    return True

def delete_file(path):
    """Delete a single file from storage."""
    r = requests.delete(
        f"{API}/object/{BUCKET}/{path}",
        headers=HEADERS,
    )
    if r.status_code not in (200, 202, 204):
        print(f"  DELETE ERROR {path}: {r.status_code} {r.text[:200]}")
        return False
    return True

def collect_all_files(prefix):
    """Recursively collect all files under a prefix. Returns list of relative paths."""
    items = list_folder(prefix)
    files = []
    for item in items:
        name = item["name"]
        if item.get("id") is None:
            # It's a folder (null id = placeholder)
            sub_files = collect_all_files(f"{prefix}/{name}")
            files.extend(sub_files)
        else:
            files.append(f"{prefix}/{name}")
    return files

def move_template(old_path, new_path):
    """Move all files from old_path to new_path. Returns (success, files_moved)."""
    files = collect_all_files(old_path)
    if not files:
        return False, 0

    moved = 0
    for old_file in files:
        # Calculate relative path within the template folder
        rel = old_file[len(old_path) + 1:]  # +1 for the /
        new_file = f"{new_path}/{rel}"

        data = download_file(old_file)
        if data is None:
            print(f"    FAIL download: {old_file}")
            continue

        if not upload_file(new_file, data):
            print(f"    FAIL upload: {new_file}")
            continue

        if not delete_file(old_file):
            print(f"    WARN delete failed (non-fatal): {old_file}")

        moved += 1

    return moved == len(files), moved

# ── Main ────────────────────────────────────────────────────────────────

def main():
    with open(PLAN_PATH) as f:
        plan = json.load(f)

    # Find templates that need migration (primaryCategory has special chars)
    to_move = []
    for e in plan["plan"]:
        cat = e["primaryCategory"]
        safe = safe_cat(cat)
        if cat != safe:
            to_move.append(e)

    print(f"Templates needing migration: {len(to_move)}")

    if not to_move:
        print("Nothing to fix. All categories use URL-safe names.")
        return

    # Group by old category for reporting
    by_old = defaultdict(list)
    for e in to_move:
        by_old[e["oldPath"].split("/")[0]].append(e)

    print("\nBreakdown by old category:")
    for cat, items in sorted(by_old.items()):
        print(f"  {cat}: {len(items)} templates")

    print("\nBreakdown by new URL-safe category:")
    by_new = defaultdict(list)
    for e in to_move:
        by_new[safe_cat(e["primaryCategory"])].append(e)
    for cat, items in sorted(by_new.items()):
        print(f"  {cat}: {len(items)} templates")

    # Confirm
    if "--yes" not in sys.argv:
        print("\nPress Enter to start migration (or Ctrl+C to abort)...")
        input()

    success_count = 0
    fail_count = 0
    failures = []

    for i, entry in enumerate(to_move):
        old_path = entry["oldPath"]
        old_cat = entry["oldPath"].split("/")[0]
        new_cat = safe_cat(entry["primaryCategory"])
        new_folder = entry["newFolderName"]
        new_path = f"{new_cat}/{new_folder}"

        print(f"\n[{i+1}/{len(to_move)}] {old_path} -> {new_path}")

        # Check if old path still has files
        check = list_folder(old_path)
        if not check:
            print(f"  SKIP: old path empty or missing")
            # Still update the plan entry even if files already moved
            entry["primaryCategory"] = new_cat
            entry["categories"][0] = new_cat
            entry["newPath"] = new_path
            success_count += 1
            continue

        ok, count = move_template(old_path, new_path)
        if ok:
            print(f"  OK: {count} files moved")
            # Update plan entry
            entry["primaryCategory"] = new_cat
            entry["categories"] = [new_cat] + [c for c in entry["categories"][1:] if c != new_cat and safe_cat(c) != new_cat]
            entry["newPath"] = new_path
            success_count += 1
        else:
            print(f"  FAIL: only {count} files moved")
            fail_count += 1
            failures.append({"oldPath": old_path, "newPath": new_path, "filesMoved": count})

        time.sleep(0.1)  # Small delay

    # ── Update classification-plan.json ──
    print(f"\nUpdating classification-plan.json with URL-safe paths...")

    # Also update primaryCategory for ALL entries that reference broken categories
    for e in plan["plan"]:
        safe = safe_cat(e["primaryCategory"])
        if safe != e["primaryCategory"]:
            e["primaryCategory"] = safe
        e["categories"] = [safe_cat(c) for c in e["categories"]]
        # Update newPath
        old_new = e["newPath"]
        parts = old_new.split("/", 1)
        if len(parts) == 2:
            e["newPath"] = f"{safe_cat(parts[0])}/{parts[1]}"

    # Recompute stats
    stats = {"total": len(plan["plan"]), "autoClassified": 0, "needsReview": 0, "byCategory": {}}
    for e in plan["plan"]:
        if e["needsReview"]:
            stats["needsReview"] += 1
        else:
            stats["autoClassified"] += 1
        pc = e["primaryCategory"]
        stats["byCategory"][pc] = stats["byCategory"].get(pc, 0) + 1

    plan["summary"] = {
        **stats,
        "autoPct": round(stats["autoClassified"] / stats["total"] * 100),
        "reviewPct": round(stats["needsReview"] / stats["total"] * 100),
    }
    plan["generatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())

    with open(PLAN_PATH, "w") as f:
        json.dump(plan, f, indent=2)
    print(f"Updated {PLAN_PATH}")

    # ── Update manifest on Supabase ──
    print("\nUpdating manifest on Supabase...")
    manifest_data = download_file("_blitzkrieg_manifest_v2.json")
    if manifest_data:
        manifest = json.loads(manifest_data)
        # Build lookup: oldFolderName -> new entry
        plan_map = {}
        for e in plan["plan"]:
            plan_map[e["oldFolderName"]] = e

        for folder in manifest.get("folders", []):
            update = plan_map.get(folder.get("folderName", ""))
            if update:
                safe_name = safe_cat(update["primaryCategory"])
                folder["categoryName"] = safe_name
                folder["folderName"] = update["newFolderName"]
                folder["categories"] = update["categories"]
                if folder.get("metadata"):
                    folder["metadata"]["displayName"] = update["newDisplayName"]

        # Upload updated manifest
        manifest_json = json.dumps(manifest, indent=2)
        if upload_file("_blitzkrieg_manifest_v2.json", manifest_json.encode(), "application/json"):
            print("Manifest updated successfully")
        else:
            print("ERROR: Failed to upload manifest")

    # ── Summary ──
    print(f"\n{'='*50}")
    print(f"  MIGRATION FIX COMPLETE")
    print(f"  Success: {success_count}")
    print(f"  Failed:  {fail_count}")
    print(f"{'='*50}")

    if failures:
        fail_path = os.path.join(os.path.dirname(__file__), "..", "fix-migration-failures.json")
        with open(fail_path, "w") as f:
            json.dump(failures, f, indent=2)
        print(f"Failures written to: {fail_path}")

    # Print final category distribution
    print("\nFinal category distribution:")
    for cat, count in sorted(stats["byCategory"].items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")


if __name__ == "__main__":
    main()
