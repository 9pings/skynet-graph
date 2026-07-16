'use strict';
/**
 * §6.3(b) WIRING — `enhanceCandidateWithAncestry` post-processes a crystallized candidate: a content leaf determined by
 * an on-horizon ancestor is PROMOTED to a frontier ref, the now-redundant signature key is DROPPED, the templates
 * collapse to one, and the EXACT post is added. The win: the enhanced method MOUNTS on an UNSEEN signature class
 * (rebinding the leaf from the ancestor), where the baked (un-enhanced) method BYPASSES. The §6.3(b) generalization.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { digest } = require('../../lib/providers/canonicalize.js');
const { buildStructuralProvider } = require('../../plugins/learning/lib/crystallize.js');
const { enhanceCandidateWithAncestry } = require('../../plugins/learning/lib/ancestry.js');
console.log = console.info = console.warn = () => {};

// a crystallized candidate whose mid-node `state` = the cast object's `kind` (an ancestor-determined leaf); the
// templatesBySig is keyed on `kind`, the state baked per class — so an UNSEEN kind has no template (bypass).
function mkCandidate() {
	const tplFor = ( k ) => [
		{ $_id: '_parent', Refine: true },
		{ _id: '⟦@base⟧_m0', Node: true, state: k },
		{ _id: '⟦@base⟧_a0', Segment: true, originNode: '⟦@ref:origin⟧', targetNode: '⟦@base⟧_m0', parentSeg: '⟦@base⟧' },
	];
	return {
		schema: { _id: 'Refine', _name: 'Refine',
			frontier: { params: [{ name: 'origin', field: 'originNode', role: 'endpoint', sort: 'node-ref' }], appConditions: { require: [], assert: [] } },
			contract: { read: ['kind'], write: ['Refine'], pre: [], post: ['Refine==true'], effect: 'pure' } },
		providerName: 'Crystal::Refine', signatureKeys: ['kind'], frontierFields: { origin: 'originNode' },
		templatesBySig: { [digest({ kind: 'A' })]: tplFor('A'), [digest({ kind: 'B' })]: tplFor('B') },
	};
}
const mount = ( provider, scopeFacts ) => { let out; provider({}, { _name: 'Refine' }, { _: scopeFacts }, [], ( e, t ) => { out = t; }); return out; };

test('§6.3(b) wiring — a kind-determined leaf is promoted to a ref + the redundant key dropped; the method then mounts on an UNSEEN kind', () => {
	const observations = [
		{ value: 'A', ancestry: { kind: 'A' } }, { value: 'B', ancestry: { kind: 'B' } },
		{ value: 'A', ancestry: { kind: 'A' } }, { value: 'C', ancestry: { kind: 'C' } },   // held-out C === C → survives
	];
	const cand = mkCandidate();
	const enh = enhanceCandidateWithAncestry(cand, { leaves: [{ path: '[1].state', observations }], sigmaSep: ['kind'], minK: 3, dropKeys: true });

	assert.equal(enh.promotions.length, 1, 'state was promoted (FD value=N(s).kind, held-out-verified)');
	assert.deepEqual(enh.signatureKeys, [], 'the now-redundant `kind` signature key is dropped (the content rebinds from it)');
	assert.match(JSON.stringify(enh.templatesBySig), /⟦@ref:anc_kind⟧/, 'the leaf became an ancestor frontier ref in the template');
	assert.ok(enh.schema.contract.post.some(( p ) => /==\s*\$anc_kind/.test(p)), 'the EXACT relational post `$state==$anc_kind` was added');

	// mount the ENHANCED provider at an UNSEEN kind 'C' → the leaf is rebound from the kind fact (state='C').
	const ground = mount(enh.provider, { _id: 'X', originNode: 'O', kind: 'C' });
	assert.ok(Array.isArray(ground), 'the enhanced method MOUNTS on the unseen kind (not a bypass)');
	const mid = ground.find(( o ) => o.Node && o.state !== undefined );
	assert.equal(mid.state, 'C', 'the leaf is REBOUND from the ancestor at the new site — the §6.3(b) generalization');
	assert.equal(mid._id, 'X_m0', 'the structural hole rebased to the new base');

	// the discriminating control: the UN-enhanced (baked) method BYPASSES the unseen kind (no template for C).
	const base = buildStructuralProvider({ cryId: 'Refine', frontier: cand.schema.frontier, frontierFields: cand.frontierFields, templatesBySig: cand.templatesBySig, signatureKeys: cand.signatureKeys });
	const bypass = mount(base, { _id: 'X', originNode: 'O', kind: 'C' });
	assert.ok(!Array.isArray(bypass), 'the un-enhanced method BYPASSES the unseen kind (a flat noop) — promotion is what generalizes it');
});

test('§6.3(b) wiring — a leaf NOT ancestry-determined is left baked (no promotion, no key drop) — conservative', () => {
	const observations = [
		{ value: 'P', ancestry: { kind: 'A' } }, { value: 'Q', ancestry: { kind: 'B' } },
		{ value: 'P', ancestry: { kind: 'A' } }, { value: 'Z', ancestry: { kind: 'C' } },   // value not a function of kind
	];
	const cand = mkCandidate();
	const enh = enhanceCandidateWithAncestry(cand, { leaves: [{ path: '[1].state', observations }], sigmaSep: ['kind'], minK: 3, dropKeys: true });
	assert.equal(enh.promotions.length, 0, 'no FD → no promotion');
	assert.deepEqual(enh.signatureKeys, ['kind'], 'the signature key is PRESERVED (the leaf stays baked per class — forge bin)');
});
