'use strict';
/**
 * §6.3(b) end-to-end — the ANCESTRY ORACLE on the real abstractivation mechanism. Σ_sep is DERIVED from the concept
 * tree (the §6.3(a) horizon, `bagInterface`); a content leaf determined by an on-horizon ancestor is PROMOTED to a
 * frontier ref; the rewritten skeleton RE-MOUNTS at a fresh site bound from the ancestor (`instantiate`, 0 forge);
 * and the EXACT relational post `$leaf==$g` catches a divergence the §6.4-style band would silently admit.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { instantiate } = require('../../lib/authoring/abstract.js');
const { assertPost } = require('../../lib/authoring/contract.js');
const { bagInterface, separatorGate } = require('../../lib/authoring/decompose.js');
const { promoteContentVars } = require('../../lib/authoring/ancestry.js');
console.log = console.info = console.warn = () => {};

// a tree whose thin cross-tile bridge is `kind` (the on-horizon ancestor an oracle may promote to).
const domainTree = { childConcepts: {
	Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['$kind != null'], applyMutations: [{ $_id: '_parent', refined: true }] },
	Stage:  { _id: 'Stage', _name: 'Stage', require: ['kind'], ensure: ['$stage != null'], applyMutations: [{ $_id: '_parent', staged: true }] },
} };

test('§6.3(b) — Σ_sep is derived from the tree; a leaf determined by an ON-HORIZON ancestor promotes and re-mounts bound from it', () => {
	const sigmaSep = bagInterface([['Refine', 'kind'], ['Stage', 'kind']]).sigmaSep;   // kind is the bridge
	assert.ok(sigmaSep.includes('kind'), 'kind is on the separator horizon');
	assert.equal(separatorGate(domainTree, ['kind']).ok, true, 'an ancestry projection of kind is below the horizon');

	const skeleton = [{ $_id: '_parent', Refine: true }, { _id: '⟦@base⟧_m0', Node: true, state: { '§var': '[1].state' } }];
	const leaves = [{ path: '[1].state', observations: [
		{ value: 'A', ancestry: { kind: 'A' } }, { value: 'B', ancestry: { kind: 'B' } },
		{ value: 'A', ancestry: { kind: 'A' } }, { value: 'C', ancestry: { kind: 'C' } },   // held-out C === C → survives
	] }];
	const r = promoteContentVars({ skeleton, leaves, sigmaSep, minK: 3 });
	assert.equal(r.bins['[1].state'], 'promote', 'state = N(s).kind across the fit + held-out → promoted (not forged)');
	const refName = r.promoted[0].refName;

	// RE-MOUNT at a fresh site whose ancestor kind='NEW' → instantiate binds the leaf from the ancestor (0 model calls).
	const ground = instantiate(r.skeleton, { base: 'X', refs: { [refName]: 'NEW' } });
	assert.equal(ground[1].state, 'NEW', 'the promoted leaf is REBOUND from the ancestor at the new site (no forge)');
	assert.equal(ground[1]._id, 'X_m0', 'the structural hole rebased to the new base too');
});

test('§6.3(b) — the EXACT relational post catches a divergence (the §6.4 band would have passed silently)', () => {
	const leaves = [{ path: '[1].state', observations: [
		{ value: 'A', ancestry: { kind: 'A' } }, { value: 'B', ancestry: { kind: 'B' } },
		{ value: 'A', ancestry: { kind: 'A' } }, { value: 'C', ancestry: { kind: 'C' } },
	] }];
	const r = promoteContentVars({ skeleton: [{ $_id: '_parent' }, { state: { '§var': '[1].state' } }], leaves, sigmaSep: ['kind'], minK: 3 });
	const post = r.posts[0], refName = r.promoted[0].refName;
	assert.match(post, /==\$/, 'the promoted post is the EXACT relation, not a band');

	// at a fresh site the leaf must EQUAL the ancestor — consistent passes, a divergence is CAUGHT (assertPost).
	assert.equal(assertPost({ write: ['state'], post: [post], effect: 'pure' }, { state: 'NEW', [refName]: 'NEW' }, ['state']).ok, true, 'leaf == ancestor → ok');
	assert.equal(assertPost({ write: ['state'], post: [post], effect: 'pure' }, { state: 'NEW', [refName]: 'OTHER' }, ['state']).ok, false,
		'a future divergence (leaf ≠ ancestor) is caught EXACTLY → reviseOnBlame; a §6.4 interval/enum band would have passed silently');
});
