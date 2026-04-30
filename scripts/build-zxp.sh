#!/usr/bin/env bash
# build-zxp.sh — package + sign the Blitzkrieg CEP panel as a .zxp installer.
#
# Usage:
#   ./scripts/build-zxp.sh [<output.zxp>] [<cert.p12>] [<cert_password>]
#
# Defaults:
#   output       dist/blitzkrieg.zxp
#   cert         .tools/blitzkrieg-selfsigned.p12 (auto-generated if missing)
#   password     blitzkrieg
#
# CI: decode ZXP_CERT_P12_BASE64 to .tools/blitzkrieg.p12 first, then call:
#   ./scripts/build-zxp.sh dist/blitzkrieg.zxp .tools/blitzkrieg.p12 "$ZXP_CERT_PASSWORD"
#
# Local: just run `./scripts/build-zxp.sh` — first run downloads ZXPSignCmd and
# generates a dev self-signed cert. Editors must have PlayerDebugMode enabled
# (one-time `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`) to install
# self-signed builds; this is already required for the symlink dev workflow.

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

OUT_ZXP="${1:-$REPO_ROOT/dist/blitzkrieg.zxp}"
CERT_P12="${2:-$REPO_ROOT/.tools/blitzkrieg-selfsigned.p12}"
CERT_PW="${3:-blitzkrieg}"

mkdir -p "$REPO_ROOT/.tools" "$(dirname "$OUT_ZXP")"

# ---- 1. Acquire ZXPSignCmd ----------------------------------------------------
ZXP_TOOL="$REPO_ROOT/.tools/ZXPSignCmd"
if [[ ! -x "$ZXP_TOOL" ]]; then
  echo "==> Downloading ZXPSignCmd 4.1.3..."
  case "$(uname -s)" in
    Darwin)
      URL="https://github.com/Adobe-CEP/CEP-Resources/raw/master/ZXPSignCMD/4.1.3/macOS/ZXPSignCmd"
      ;;
    *)
      # Adobe never shipped a Linux build of ZXPSignCmd; CI must run on macOS.
      echo "!! ZXPSignCmd has no Linux binary. Run on macOS (use 'runs-on: macos-latest' in CI)." >&2
      exit 1
      ;;
  esac
  # --fail makes curl exit non-zero on HTTP 4xx/5xx instead of saving the
  # error body to disk. Atomic-rename via tempfile so a partial download
  # never lands as $ZXP_TOOL — otherwise the next invocation sees the
  # broken file exists and skips re-download forever.
  TMP_TOOL="$ZXP_TOOL.tmp.$$"
  if ! curl --fail -sSL "$URL" -o "$TMP_TOOL"; then
    rm -f "$TMP_TOOL"
    echo "!! ZXPSignCmd download failed: $URL" >&2
    exit 1
  fi
  if ! file "$TMP_TOOL" | grep -q -E "(Mach-O|ELF)"; then
    rm -f "$TMP_TOOL"
    echo "!! Downloaded file is not an executable binary (got: $(file -b "$TMP_TOOL" 2>/dev/null || echo unknown))" >&2
    exit 1
  fi
  chmod +x "$TMP_TOOL"
  mv "$TMP_TOOL" "$ZXP_TOOL"
fi

# ---- 2. Ensure signing cert exists -------------------------------------------
# `-validityDays 1825` (~5 years) — ZXPSignCmd's default is 1 year. Without
# this, the dev cert silently expires; the next CI release-zxp run cannot
# sign and panels stay stuck on the last build until someone notices and
# rotates the secret. 5 years matches the CEP signing best-practice and
# ensures the GitHub Actions cert (when missing secrets cause a fresh
# self-sign) doesn't bake in a 1-year time bomb.
if [[ ! -f "$CERT_P12" ]]; then
  echo "==> No cert at $CERT_P12 — generating self-signed (dev only)..."
  "$ZXP_TOOL" -selfSignedCert US CA "Dominate Media" "Blitzkrieg" "$CERT_PW" "$CERT_P12" -validityDays 1825 >/dev/null
fi

# ---- 3. Stage files for packaging --------------------------------------------
STAGE_DIR="$(mktemp -d -t blitzkrieg-zxp-XXXXXX)"
trap 'rm -rf "$STAGE_DIR"' EXIT

echo "==> Staging files into $STAGE_DIR"
# Whitelist what ships in the .zxp. Anything not listed here stays out.
SHIP=(
  "index.html"
  "version.json"
  "CSXS"
  "CSS"
  "js"
  "jsx"
  "img"
)
for entry in "${SHIP[@]}"; do
  if [[ -e "$REPO_ROOT/$entry" ]]; then
    cp -R "$REPO_ROOT/$entry" "$STAGE_DIR/"
  else
    echo "!! Missing expected file/dir: $entry" >&2
    exit 1
  fi
done

# Hard-strip any .DS_Store, dotfiles, or stray editor backups so the .zxp
# matches an as-installed extension exactly.
find "$STAGE_DIR" \( -name ".DS_Store" -o -name "*.swp" -o -name "*.bak" \) -delete

# ---- 4. Sign + package -------------------------------------------------------
rm -f "$OUT_ZXP"
echo "==> Signing $STAGE_DIR -> $OUT_ZXP"
"$ZXP_TOOL" -sign "$STAGE_DIR" "$OUT_ZXP" "$CERT_P12" "$CERT_PW" -tsa http://timestamp.digicert.com >/dev/null

if [[ ! -f "$OUT_ZXP" ]]; then
  echo "!! Signing produced no output at $OUT_ZXP" >&2
  exit 1
fi

SIZE=$(du -h "$OUT_ZXP" | cut -f1)
echo "==> Built $OUT_ZXP ($SIZE)"
