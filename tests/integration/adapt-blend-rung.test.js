'use strict';
// B.4 — the BLEND rung wired into the adaptOrForge ladder (finishing a pending implementation): before a fresh
// FORGE, graft a donor method into the host neighbour (0 model calls, contract-checked), verifier-gated. Opt-in
// (`opts.blend`) so existing callers are unchanged. Sync + async twins; each claim carries a NEG control.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../_boot.js');
const { crystallizeStructural } = require('../../lib/authoring/learning/crystallize.js');
const { adaptOrForge, adaptOrForgeAsync } = require('../../lib/authoring/learning/adapt.js');
const { makeLibrary, indexMethod } = require('../../lib/authoring/learning/library.js');
console.log = console.info = console.warn = () => {};

const node = ( id ) => ({ _id: id });
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };

async function learn( kind ) {
	const Refine = { refine( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true },
			{ _id: mid, Node: true, state: 'plan-' + scope._.kind },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
		]);
	} };
	const TREE = { childConcepts: { Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] } } };
	const nodes = [], segments = [];
	for ( let s = 0; s < 2; s++ ) { const a = `${kind}a${s}`, b = `${kind}b${s}`; nodes.push(node(a), node(b)); segments.push({ _id: `${kind}E${s}`, Segment: true, originNode: a, targetNode: b, kind }); }
	const res = await crystallizeStructural({ episodeTree: TREE, seed: { lastRev: 0, nodes, segments }, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'Crystal' + kind, declaredFrontier: DECL });
	assert.equal(res.admitted, true);
	return res.candidate;
}

test('BLEND rung — with opts.blend, the ladder GRAFTS the donor into the host before forging (0 calls, outcome "blend")', async () => {
	const host = await learn('hard'), donor = await learn('easy');
	const lib = makeLibrary(); indexMethod(lib, host);
	const target = { frontier: host.schema.frontier, signatureKeys: host.signatureKeys };
	let forged = false;
	const r = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, blend: true, donor,
		verify: () => true, forge: () => { forged = true; return { candidate: host, calls: 1 }; } });
	assert.equal(r.outcome, 'blend', 'the blend rung fired');
	assert.equal(r.calls, 0, 'a structural graft costs 0 model calls');
	assert.ok(r.candidate.blendedFrom, 'the candidate records its parents (blendedFrom)');
	assert.equal(forged, false, 'forge was NOT reached — blend covered it cheaper');
});

test('BLEND rung NEG — WITHOUT opts.blend the ladder ignores the donor and FORGES (existing behaviour unchanged)', async () => {
	const host = await learn('hard'), donor = await learn('easy');
	const lib = makeLibrary(); indexMethod(lib, host);
	const target = { frontier: host.schema.frontier, signatureKeys: host.signatureKeys };
	let forged = false;
	const r = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, donor,
		verify: () => true, forge: () => { forged = true; return { candidate: host, calls: 1 }; } });
	assert.equal(forged, true, 'no opts.blend → forge, as before');
	assert.equal(r.outcome, 'forge');
});

test('BLEND rung — a blended candidate that FAILS verify is rejected (verifier-gated like any forge)', async () => {
	const host = await learn('hard'), donor = await learn('easy');
	const lib = makeLibrary(); indexMethod(lib, host);
	const target = { frontier: host.schema.frontier, signatureKeys: host.signatureKeys };
	const r = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, blend: true, donor,
		verify: () => false, forge: () => null });
	assert.equal(r.outcome, 'reject', 'the blend is not exempt from the verifier');
});

test('BLEND rung — the ASYNC twin grafts too (opt-in), gated by the async verifier', async () => {
	const host = await learn('hard'), donor = await learn('easy');
	const lib = makeLibrary(); indexMethod(lib, host);
	const target = { frontier: host.schema.frontier, signatureKeys: host.signatureKeys };
	const r = await adaptOrForgeAsync({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, blend: true, donor,
		verify: async () => true, forge: async () => ({ candidate: host, calls: 1 }) });
	assert.equal(r.outcome, 'blend');
	assert.equal(r.calls, 0);
});
