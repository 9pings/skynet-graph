'use strict';
/**
 * SOURCE HYGIENE — the repo-wide NUL-byte invariant, made CHECKED (Vibe's "audit NUL/CI" · the recurring debt).
 *
 * A NUL (0x00) in source is invisible to grep/Read and shows as a "Bin" diff in git; it has slipped in THREE times as a
 * string separator/marker — the AGPL license-history rewrite, then `local-host.js#cacheKey` (cont.⁶), then
 * `compose-hotspot.js#SEP` (found by this session's audit). Each was a silent footgun. This guard stops the fourth.
 *
 * GOTCHA (CLAUDE.md + memory): `grep -c $'\x00'` and Read LIE — bash/most tools truncate at the NUL, so the count reads
 * 0 while the byte is there. The ONLY reliable detector is a byte scan (`Buffer.indexOf(0)`), which is what this does.
 * FIX a violation by replacing the NUL with a READABLE escape (e.g. '', the ASCII unit separator) — never a raw
 * control byte — so the source stays greppable and human-readable (the "marker must be human-readable" discipline).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
// the shipped/tracked source dirs where a NUL byte is a real defect (engine, facade, authoring, providers, CLI, concepts).
const DIRS = ['lib', 'bin', 'concepts'];
const EXT = /\.(js|json|jsonc)$/;

function walk( dir, acc ) {
	let ents;
	try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch ( e ) { return acc; }
	for ( const e of ents ) {
		const p = path.join(dir, e.name);
		if ( e.isDirectory() ) { if ( e.name !== 'node_modules' ) walk(p, acc); }
		else if ( EXT.test(e.name) ) acc.push(p);
	}
	return acc;
}

test('no NUL byte (0x00) in shipped source — the invisible-separator footgun (fix: a readable escape, never a raw NUL)', () => {
	const files = DIRS.flatMap(( d ) => walk(path.join(ROOT, d), []));
	// vacuity guard (methodology §2.3): if the walk found nothing, "no offenders" would pass for the wrong reason.
	assert.ok(files.length > 50, 'the walk must reach the source tree; found ' + files.length + ' files');
	const offenders = [];
	for ( const f of files ) {
		const at = fs.readFileSync(f).indexOf(0);              // the RELIABLE detector — grep/Read truncate at NUL
		if ( at >= 0 ) offenders.push(path.relative(ROOT, f) + ' @byte ' + at);
	}
	assert.deepEqual(offenders, [],
		'NUL byte(s) in source — replace each with a readable escape like \\u001f:\n  ' + offenders.join('\n  '));
});
