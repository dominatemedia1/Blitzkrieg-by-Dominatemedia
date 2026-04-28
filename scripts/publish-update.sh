#!/usr/bin/env bash
# publish-update.sh — Push current panel files to Supabase OTA bucket and bump
# blitzkrieg_config.current_version so installed panels auto-update on next
# auth-ready check (or 30-min recheck interval).
#
# Usage: ./scripts/publish-update.sh <version>
#   ./scripts/publish-update.sh 1.2.2

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <version> (e.g. 1.2.2)"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_REF="kwrmdxptrrvlqxdcasho"
BUCKET="blitzkrieg-updates"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"

echo "==> Fetching service_role key from Supabase CLI..."
SERVICE_KEY="$(supabase projects api-keys --project-ref "$PROJECT_REF" 2>/dev/null \
  | awk '/service_role/ {print $3}' \
  | head -1)"
if [[ -z "$SERVICE_KEY" ]]; then
  echo "!! could not read service_role key. Run: supabase login"
  exit 1
fi

# Files the OTA installer downloads. Path is relative to repo root AND becomes
# the destination path under <version>/ in the bucket.
FILES=(
  "js/main.js"
  "js/cloud-library.js"
  "js/auth.js"
  "js/analytics.js"
  "js/telemetry.js"
  "jsx/hostscript.jsx"
  "CSS/style.css"
  "index.html"
)

echo "==> Uploading ${#FILES[@]} files to $BUCKET/$VERSION/"
for f in "${FILES[@]}"; do
  src="$REPO_ROOT/$f"
  if [[ ! -f "$src" ]]; then
    echo "  ! skip (missing): $f"
    continue
  fi
  case "$f" in
    *.js)   ct="application/javascript" ;;
    *.jsx)  ct="application/javascript" ;;
    *.css)  ct="text/css" ;;
    *.html) ct="text/html" ;;
    *.xml)  ct="application/xml" ;;
    *.json) ct="application/json" ;;
    *)      ct="application/octet-stream" ;;
  esac
  dst="$VERSION/$f"
  printf "  -> %s ... " "$f"
  http=$(curl -sS -o /tmp/blitz_upload.out -w "%{http_code}" \
    -X POST "$SUPABASE_URL/storage/v1/object/$BUCKET/$dst" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "apikey: $SERVICE_KEY" \
    -H "Content-Type: $ct" \
    -H "x-upsert: true" \
    --data-binary "@$src")
  if [[ "$http" == "200" || "$http" == "201" ]]; then
    echo "ok"
  else
    echo "FAIL ($http): $(cat /tmp/blitz_upload.out)"
    exit 1
  fi
done

echo "==> Bumping blitzkrieg_config rows (current_version + update_files)"
FILES_JSON=$(printf '%s\n' "${FILES[@]}" | jq -R . | jq -sc .)

upsert_config() {
  local k="$1" v="$2"
  curl -sS -o /tmp/blitz_cfg.out -w "%{http_code}\n" \
    -X POST "$SUPABASE_URL/rest/v1/blitzkrieg_config" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "apikey: $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates,return=representation" \
    --data "$(jq -nc --arg k "$k" --arg v "$v" '{key:$k, value:$v}')"
}

http=$(upsert_config "current_version" "$VERSION")
[[ "$http" == "200" || "$http" == "201" ]] || { echo "current_version upsert FAIL ($http): $(cat /tmp/blitz_cfg.out)"; exit 1; }

http=$(upsert_config "update_files" "$FILES_JSON")
[[ "$http" == "200" || "$http" == "201" ]] || { echo "update_files upsert FAIL ($http): $(cat /tmp/blitz_cfg.out)"; exit 1; }

echo "==> Verifying RPC view of manifest..."
curl -sS \
  -X POST "$SUPABASE_URL/rest/v1/rpc/get_blitzkrieg_update_manifest" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "apikey: $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

echo "==> Done. Installed panels auto-update to v$VERSION on next 30-min recheck (or auth-ready)."
