'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 *
 * Contrast check for the GitHub Pages site → prints the table, exits non-zero on a failure.
 *
 *   node scripts/check-contrast.js
 *
 * Why this exists: "dark gray on dark background" is not a matter of taste, it is a number, and the page
 * shipped with `--faint` at 3.22:1 — under the WCAG AA floor of 4.5:1 — while being used for real prose.
 * Nobody spots that by looking; you measure it. Colours are READ OUT of docs/index.html, so the check
 * cannot drift from the stylesheet. `tests/unit/site-contrast.test.js` runs it.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');

/** pull `--name:#rrggbb` out of the :root block */
function token( name ) {
	const m = CSS.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
	if ( !m ) throw new Error('token --' + name + ' not found in docs/index.html');
	return m[1];
}

const lin = ( c ) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function lum( hex ) {
	const h = hex.replace('#', '');
	const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio( fg, bg ) {
	const a = lum(fg), b = lum(bg), hi = Math.max(a, b), lo = Math.min(a, b);
	return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;            // WCAG AA, normal text
const AA_LARGE = 3.0;      // WCAG AA, large/bold text

// what is actually used for TEXT on this page, and on which surface
const CHECKS = [
	{ fg: 'ink', on: 'bg', use: 'headings, emphasis', floor: AA },
	{ fg: 'dim', on: 'bg', use: 'body copy, ledes', floor: AA },
	{ fg: 'faint', on: 'bg', use: 'footer note, captions — PROSE, so AA applies', floor: AA },
	{ fg: 'signal', on: 'bg', use: 'links, the closing line', floor: AA },
	{ fg: 'signal-2', on: 'bg', use: 'section labels, tab-group headings', floor: AA },
	{ fg: 'dim', on: 'panel-3', use: 'the terminal — the most-read text here', floor: AA },
	{ fg: 'faint', on: 'panel-3', use: 'terminal rules/labels', floor: AA_LARGE },
	{ fg: 'ok', on: 'panel-3', use: 'the ✓ marks', floor: AA_LARGE },
	{ fg: 'refuse', on: 'panel-3', use: 'the ✗ marks', floor: AA_LARGE },
	{ fg: 'amber', on: 'panel-3', use: 'highlighted values', floor: AA_LARGE },
	{ fg: 'signal', on: 'panel-3', use: 'the closing line in the terminal', floor: AA },
	{ fg: 'signal-2', on: 'panel-3', use: 'step numbers, arrows', floor: AA_LARGE },
];

let failed = 0;
console.log('\n  contrast — docs/index.html (AA: 4.5:1 normal · 3:1 large)\n');
for ( const c of CHECKS ) {
	const fg = token(c.fg), bg = token(c.on);
	const r = ratio(fg, bg);
	const ok = r >= c.floor;
	if ( !ok ) failed++;
	console.log('  ' + (ok ? '✓' : '✗') + '  --' + (c.fg + ' on --' + c.on).padEnd(24)
		+ r.toFixed(2).padStart(5) + ':1  (needs ' + c.floor + ')   ' + c.use);
}
console.log('');
if ( failed ) { console.error('  ' + failed + ' contrast FAILURE(s) — text that cannot be read is not a style choice.\n'); process.exit(1); }
console.log('  all text tokens pass.\n');
