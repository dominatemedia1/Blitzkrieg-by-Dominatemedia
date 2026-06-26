#!/usr/bin/env node
/*
 * Zero-dependency comment + string-literal stripper for the CI gate.
 *
 * The old `sed 's://.*$::'` strip erased code after an in-string `//`
 * (e.g. `var u="http://x"; fetch(u)` lost the `fetch(`), producing FALSE
 * NEGATIVES, and never stripped block comments, producing FALSE POSITIVES on
 * banned tokens that appear only inside a comment or string.
 *
 * This scanner understands //, /* *​/, and ' " ` string literals (with \ escapes),
 * blanks the BODIES of comments and strings (so banned tokens inside them are not
 * matched) while preserving newlines (so `grep -n` still reports correct lines)
 * and the surrounding code structure (so real ES3 violations in CODE survive and
 * are still caught). Regex literals are left as-is (treated as operators) - they
 * do not contain the tokens we scan for.
 *
 * Usage: node strip-comments.js <file>   ->  cleaned source on stdout
 */
'use strict';
var fs = require('fs');
var src = fs.readFileSync(process.argv[2], 'utf8');

var CODE = 0, LINE = 1, BLOCK = 2, SQ = 3, DQ = 4, TPL = 5;
var state = CODE;
var out = [];
var i = 0;
var n = src.length;

while (i < n) {
    var c = src[i];
    var d = i + 1 < n ? src[i + 1] : '';

    if (state === CODE) {
        if (c === '/' && d === '/') { state = LINE; i += 2; continue; }
        if (c === '/' && d === '*') { state = BLOCK; out.push(' '); i += 2; continue; }
        if (c === "'") { state = SQ; out.push(c); i++; continue; }
        if (c === '"') { state = DQ; out.push(c); i++; continue; }
        if (c === '`') { state = TPL; out.push(c); i++; continue; }
        out.push(c); i++; continue;
    }
    if (state === LINE) {
        if (c === '\n') { state = CODE; out.push('\n'); }
        i++; continue;
    }
    if (state === BLOCK) {
        if (c === '*' && d === '/') { state = CODE; i += 2; continue; }
        if (c === '\n') out.push('\n'); // keep line numbers aligned
        i++; continue;
    }
    // string states: blank the body, keep escapes' newlines, end on matching quote
    if (state === SQ || state === DQ || state === TPL) {
        if (c === '\\') { i += 2; continue; }        // skip escaped char
        if (c === '\n') { out.push('\n'); i++; continue; }
        if (state === SQ && c === "'") { state = CODE; out.push(c); i++; continue; }
        if (state === DQ && c === '"') { state = CODE; out.push(c); i++; continue; }
        if (state === TPL && c === '`') { state = CODE; out.push(c); i++; continue; }
        i++; continue;                                // blank string body
    }
}
process.stdout.write(out.join(''));
