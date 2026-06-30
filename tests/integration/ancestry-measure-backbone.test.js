'use strict';
/**
 * §6.3(b) live-measure BACKBONE (deterministic fence; the gitignored live arm is
 * doc/WIP/experiments/2026-06-30-ancestry-measure/measure.js). The live measure on qwen3-8b found: a content leaf that
 * EXACT-ECHOES a typed ancestor fact (`location` = the bug's `failingFn`, 12/12) PROMOTES to `N(s).failingFn` with an
 * EXACT post; a NOVEL leaf (`fixApproach`) FORGES. This fence reproduces those counts deterministically — the stub
 * echoes the ancestor exactly (as the live model did under a structured-echo prompt at temp 0), so the operator's
 * verdict is the same stub↔live (the creative-stream discipline: the measure logic is deterministic).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideLeaf } = require('../../lib/authoring/ancestry.js');

// 12 bugs, 3 classes × 4, each a DISTINCT failingFn — the stub `location` echoes failingFn exactly; `fixApproach` varies.
const CLASSES = ['off-by-one', 'null-deref', 'wrong-branch'];
const FNS = { 'off-by-one': ['parseRange', 'sliceWindow', 'padLeft', 'chunkRows'], 'null-deref': ['readConfig', 'getUser', 'lookupCache', 'mergeOpts'], 'wrong-branch': ['routeEvent', 'pickHandler', 'classify', 'dispatch'] };
const stream = [];
CLASSES.forEach(( cls ) => FNS[cls].forEach(( fn, i ) => stream.push({ bugClass: cls, failingFn: fn })));

const locObs = stream.map(( b ) => ({ value: b.failingFn, ancestry: { bugClass: b.bugClass, failingFn: b.failingFn } }));   // exact echo
const fixObs = stream.map(( b, i ) => ({ value: 'fix-' + i, ancestry: { bugClass: b.bugClass, failingFn: b.failingFn } })); // novel per bug

test('§6.3(b) measure backbone: an ancestor-ECHO leaf PROMOTES (identity FD, exact post); a NOVEL leaf FORGES', () => {
	const dLoc = decideLeaf({ observations: locObs, sigmaSep: ['bugClass', 'failingFn'], minK: 3, leafKey: 'location' });
	assert.equal(dLoc.bin, 'promote', 'location exact-echoes failingFn → promoted (the live 12/12 result)');
	assert.equal(dLoc.promotion.ancestorFact, 'failingFn', 'promoted to N(s).failingFn (not bugClass — the echo determines it)');
	assert.equal(dLoc.post, '$location==$anc_failingFn', 'the EXACT relational post (not a band)');

	const dFix = decideLeaf({ observations: fixObs, sigmaSep: ['bugClass', 'failingFn'], minK: 3, leafKey: 'fixApproach' });
	assert.equal(dFix.bin, 'forge', 'a novel-per-bug leaf is determined by no ancestor → forge (the catch-all)');

	// the PROMOTION-K1 fraction the live measure reports = 1/2 (one promotable echo leaf, one novel forge leaf).
	const promoted = [dLoc, dFix].filter(( d ) => d.bin === 'promote' ).length;
	assert.equal(promoted, 1, 'promotion-K1 fraction = 1/2 (matches the live qwen3-8b run)');
});

test('§6.3(b) measure NEG control: if the echo is INCONSISTENT (a held-out divergence), location does NOT promote', () => {
	// break the echo on the LAST (held-out) instance → the strict-=== held-out eliminates the FD (the load-bearing gate).
	const broken = locObs.slice(0, -1).concat([{ value: 'WRONG', ancestry: locObs[locObs.length - 1].ancestry }]);
	const d = decideLeaf({ observations: broken, sigmaSep: ['bugClass', 'failingFn'], minK: 3, leafKey: 'location' });
	assert.equal(d.bin, 'forge', 'a held-out divergence (location ≠ failingFn) → the spurious FD is REFUSED (not a false promote)');
});
