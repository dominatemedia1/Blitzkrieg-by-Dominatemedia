#!/usr/bin/env bash
# Blitzkrieg CI gate - BLOCKS a release on: JS/JSX syntax errors, ExtendScript
# ES3 violations (the atob-class bug that silently shipped, plus the whole ES5
# method family), CEP-8/9 / Chromium-57-61-incompatible APIs in panel code, or
# em-dashes / curly quotes in user-facing strings.
#
# Zero dependencies beyond `node` + `grep`. Runs WITHOUT After Effects - this is
# the safety net for a maintainer who cannot test in AE. Exit non-zero == block.
#
# Comment/string handling: ES3 + `.finally` checks run on output of
# scripts/strip-comments.js (banned tokens inside comments/strings are NOT matched
# -> no false positives, and in-string `//` no longer hides later code -> no false
# negatives). Em-dash + HTML/CSS-token checks run on RAW source, because those
# tokens legitimately live inside JS string literals (innerHTML) and markup.
set -uo pipefail
cd "$(dirname "$0")/.."

FAIL=0
ERRTMP="$(mktemp)"
STRIP="$(mktemp)"
note() { echo "  FAIL: $1"; FAIL=1; }
trap 'rm -f "$ERRTMP" "$STRIP"' EXIT

# Only true third-party vendored bundles are skipped. supabase-config.js is
# HAND-AUTHORED (it inits window.blitzkriegSupabase) and MUST be checked.
is_vendored() { case "$1" in js/supabase.min.js|js/CSInterface.js) return 0;; *) return 1;; esac; }

strip() { node scripts/strip-comments.js "$1" > "$STRIP" 2>/dev/null; }

echo "== 1. node --check authored panel JS (+ supabase-config.js) =="
for f in js/*.js; do
  is_vendored "$f" && { echo "  skip (vendored): $f"; continue; }
  if node --check "$f" 2>"$ERRTMP"; then echo "  ok: $f"; else note "syntax $f -> $(head -1 "$ERRTMP")"; fi
done

echo "== 2. jsx parses (ExtendScript host) =="
for f in jsx/*.jsx; do
  tmp="$(mktemp).js"; cp "$f" "$tmp"
  if node --check "$tmp" 2>"$ERRTMP"; then echo "  ok: $f"; else note "jsx syntax $f -> $(head -1 "$ERRTMP")"; fi
  rm -f "$tmp"
done

echo "== 3. ES3 violations in jsx (node --check only catches SYNTAX; these are valid ES5+ that DO NOT exist in ExtendScript ES3) =="
# Browser-only globals, ES5 array/string/object methods (NOT indexOf - that IS
# ES3-native), async/await, and ES5+ syntax. Run on comment/string-stripped code.
ES3_API='\b(atob|btoa|fetch|XMLHttpRequest|TextEncoder|TextDecoder)[[:space:]]*\(|\bnew[[:space:]]+Promise\b|\bPromise\.|\.finally[[:space:]]*\('
ES3_METHODS='\.(forEach|map|filter|reduce|reduceRight|some|every|find|findIndex|includes|fill|flat|flatMap|trim|trimStart|trimEnd|startsWith|endsWith|repeat|padStart|padEnd|codePointAt)[[:space:]]*\(|\b(Object\.(keys|values|entries|assign|getOwnPropertyNames|defineProperty|create)|Array\.(from|isArray|of))\b'
ES3_SYNTAX='=>|\blet[[:space:]]|\bconst[[:space:]]|\basync[[:space:]]|\bawait[[:space:]]|`'
for f in jsx/*.jsx; do
  strip "$f"
  if grep -nE "$ES3_API" "$STRIP"; then note "ES3 browser-API/Promise in $f (above)"; fi
  if grep -nE "$ES3_METHODS" "$STRIP"; then note "ES5 method (absent in ExtendScript ES3) in $f (above)"; fi
  if grep -nE "$ES3_SYNTAX" "$STRIP"; then note "ES5+ syntax (let/const/arrow/async/await/template) in $f (above)"; fi
done

echo "== 4. CEP-8/9-incompatible API in panel JS (.finally absent in Chromium 57/61) =="
for f in js/*.js; do
  is_vendored "$f" && continue
  strip "$f"
  if grep -nE '\.finally[[:space:]]*\(' "$STRIP"; then note ".finally() in $f - unavailable in CEP 8/9"; fi
done

echo "== 5. banned modern APIs (Chromium 57/61 ceiling) in panel JS / CSS / HTML =="
# These live inside JS string literals (innerHTML) and markup, so scan RAW source.
# loading=lazy (Chrome 76), content-visibility (85). aspect-ratio (88) is allowed
# ONLY with an @supports fallback, so we do not hard-block it here.
BANNED_MODERN='loading[[:space:]]*=[[:space:]]*["'"'"']?lazy|content-visibility[[:space:]]*:'
# Iterate js/*.js rather than a hardcoded list: the old list was written before
# js/local-reset.js existed and silently skipped it, which is how a new file gets
# shipped unchecked. Sections 1, 4 and 6 already glob; this one now matches.
for f in js/*.js index.html CSS/style.css; do
  [ -f "$f" ] || continue
  is_vendored "$f" && continue
  if grep -nE "$BANNED_MODERN" "$f"; then note "banned modern API (loading=lazy / content-visibility) in $f (above)"; fi
done

echo "== 6. em-dash / en-dash / curly quotes in USER-FACING strings (hard brand rule) =="
# Literal-character alternation so it works on BOTH macOS BSD grep (no -P) and GNU
# grep in CI, locale-independent. Scan RAW source (the chars live inside strings).
JS_USERFACING='(showToast\(|innerHTML|\.textContent|\.title[[:space:]]*=|setAttribute\(|placeholder|aria-label|alert\(|confirm\(|\.value[[:space:]]*=)'
for f in js/*.js; do
  is_vendored "$f" && continue
  if grep -nE "${JS_USERFACING}.*(—|–|‘|’|“|”)" "$f"; then note "em-dash/curly-quote in a user-facing string in $f (above)"; fi
done
# The same-line heuristic above misses a smart char on a CONTINUATION line of a
# MULTI-LINE user-facing assignment (marker on a prior line, e.g. a textContent set
# split across lines). This targeted pass, for every user-facing marker line that does
# not terminate on its own line, joins the statement up to its ';' and flags a smart
# char anywhere in it. Marker-anchored, so dev-only debugLog/_log strings are exempt.
for f in js/*.js; do
  is_vendored "$f" && continue
  python3 - "$f" <<'PY' || note "em-dash/curly-quote in a multi-line user-facing string in $f (above)"
import sys, re
MARK = re.compile(r'(showToast\(|innerHTML|\.textContent|\.title\s*=|setAttribute\(|placeholder|aria-label|\.value\s*=)')
SMART = re.compile(r'[—–‘’“”]')
lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
bad = False
i = 0
while i < len(lines):
    code = lines[i].split('//', 1)[0]
    if MARK.search(code):
        # Gather the statement (this line + continuations) until a ';' or blank/brace.
        stmt = code; j = i
        while ';' not in stmt and j + 1 < len(lines) and (j - i) < 8:
            j += 1
            stmt += '\n' + lines[j].split('//', 1)[0]
        if SMART.search(stmt):
            print(f"{sys.argv[1]}:{i+1}: {lines[i].strip()[:90]}")
            bad = True
    i += 1
sys.exit(1 if bad else 0)
PY
done
# index.html is all user-facing markup; flag any occurrence.
if [ -f index.html ] && grep -nE '(—|–|‘|’|“|”)' index.html; then note "em-dash/curly-quote in index.html (above)"; fi

echo "== 7. OTA manifest is complete and every listed file is tracked by git =="
# Two failures this catches, both silent and both already shipped once:
#   a) a script index.html loads that is NOT in version.json files[] -> OTA pushes a
#      new index.html around a FROZEN module. js/local-sync.js shipped that way from
#      2026-05-07 until 2026-08-12, so editors ran a months-old mirror subsystem.
#   b) a file listed in version.json files[] that git does not track -> the
#      auto-version-bump workflow does readFileSync over that list and dies with
#      ENOENT, so no bump, no tag, no release, and no visible error.
if [ -f version.json ] && [ -f index.html ]; then
  node -e '
    const fs = require("fs");
    const v = JSON.parse(fs.readFileSync("version.json", "utf8"));
    const files = v.files || [];
    // Vendored third-party bundles are intentionally excluded from OTA.
    const vendored = ["js/CSInterface.js", "js/supabase.min.js"];
    const html = fs.readFileSync("index.html", "utf8");
    const loaded = [];
    const re = /<script src="\.\/(js\/[^?"]+)/g;
    let m; while ((m = re.exec(html)) !== null) loaded.push(m[1]);
    let bad = 0;
    for (const f of loaded) {
      if (vendored.indexOf(f) !== -1) continue;
      if (files.indexOf(f) === -1) { console.log("  loaded by index.html but missing from version.json files[]: " + f); bad = 1; }
    }
    for (const f of files) {
      if (f !== "version.json" && !fs.existsSync(f)) { console.log("  listed in version.json files[] but not on disk: " + f); bad = 1; }
    }
    process.exit(bad);
  ' || note "OTA manifest incomplete (above)"
  for f in $(node -e 'const v=require("./version.json");console.log((v.files||[]).join(" "))'); do
    if ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      note "version.json lists an UNTRACKED file (git add it): $f"
    fi
  done
  echo "  checked $(node -e 'const v=require("./version.json");console.log((v.files||[]).length)') manifest entries"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then echo "CI GATE: PASS"; else echo "CI GATE: FAIL (block release)"; fi
exit $FAIL
