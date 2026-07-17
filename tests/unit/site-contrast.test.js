'use strict';
/**
 * The site's text must stay readable — as a NUMBER, not an opinion.
 *
 * The page shipped with `--faint` at 3.22:1 against the background (WCAG AA needs 4.5:1) while being used
 * for actual prose: the footer note, the terminal labels, the demo caption. It read as "dark gray on a dark
 * background" because that is precisely what it was. Nobody catches that by looking at it; you measure it.
 *
 * This runs scripts/check-contrast.js, which reads the colours straight out of docs/index.html — so
 * darkening a token in the stylesheet fails here rather than shipping unreadable text to a launch page.
 */
require('../_boot.js');
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

test('every text colour on the site passes its WCAG AA floor', () => {
	let out = '', code = 0;
	try {
		out = execFileSync('node', [path.join(ROOT, 'scripts', 'check-contrast.js')], { encoding: 'utf8', cwd: ROOT });
	} catch ( e ) { out = String(e.stdout || '') + String(e.stderr || ''); code = 1; }
	assert.equal(code, 0, 'contrast check failed — a text colour on docs/index.html is unreadable:\n' + out);
	assert.match(out, /all text tokens pass/);
});

test('the body font is NOT a serif, and the base size is not tiny', () => {
	// owner, 2026-07-17: "serif fonts; size a little too small". The body was an 18px light serif on a dark
	// ground; both are pinned here so a redesign cannot quietly bring them back.
	const fs = require('fs');
	const css = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
	const body = css.match(/\nbody\{([\s\S]*?)\}/);
	assert.ok(body, 'body rule found');
	assert.match(body[1], /font-family:var\(--sans\)/, 'body copy must use the sans stack, not a serif');
	const size = Number((body[1].match(/font-size:([\d.]+)px/) || [])[1]);
	assert.ok(size >= 19, 'base font-size should be >= 19px (got ' + size + ')');
	assert.ok(!/--serif:/.test(css), 'the serif token should be gone entirely, not just unused');
	const term = css.match(/\n\.term\{([\s\S]*?)\}/);
	const tsize = Number((term[1].match(/font-size:([\d.]+)px/) || [])[1]);
	assert.ok(tsize >= 14, 'the terminal is the most-read text on the page: >= 14px (got ' + tsize + ')');
});
