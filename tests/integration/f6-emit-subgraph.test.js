'use strict';
/**
 * F6 / U1a — EMIT-METHOD-AS-SUBGRAPH via the ENGINE-NATIVE serializer (2026-06-27).
 *
 * Per the user's pointer: the engine already has `Graph#getMutationFromPath` (graph fragment → normalized
 * mutation template) + the proven travel-path mounting pattern (formal endpoints + re-bind at the call
 * site). This pins that a DERIVED method's sub-graph, serialized through that engine primitive and
 * relativized by `abstract.js`, RE-MOUNTS soundly into a different problem at 0 model calls — i.e. a method
 * is a re-mountable graph (study §8 / U1a), not only a cached opaque provider output.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { emitMethodAsSubgraph, instantiate } = require('../../lib/authoring/abstract.js');

const tree = { common: { childConcepts: {
	Split: { _id: 'Split', _name: 'Split', require: ['Segment', 'toPlan'], provider: ['P::plan'] }
} } };

function bootPlan() {
	const n = { calls: 0 };
	Graph._providers = { P: { plan: function ( g, c, scope, argz, cb ) {
		n.calls++;
		const seg = scope._, base = seg._id, mid = base + '_m0';
		cb(null, [
			{ $_id: '_parent', Split: true, Decomposed: true },
			{ _id: mid, Node: true, kind: seg.originKind + '~' + seg.targetKind, state: 'mid' },
			{ _id: base + '_a0', Segment: true, originNode: seg.originNode, targetNode: mid, parentSeg: base, label: 'A' },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: seg.targetNode, parentSeg: base, label: 'B' }
		]);
	} } };
	return n;
}
const mk = ( pfx ) => {
	// a bare `require:['toPlan']` is satisfied by the key being PRESENT (even `false`) — gating on truthiness
	// is `ensure`/`assert`. So B (the re-mount target) OMITS `toPlan` entirely, else Plan would fire on its boot.
	const root = { _id: pfx + 'root', Segment: true, originNode: pfx + 'S', targetNode: pfx + 'G', originKind: 'X', targetKind: 'Y' };
	if ( pfx === 'A' ) root.toPlan = true;
	return new Graph({ lastRev: 0,
		nodes: [{ _id: pfx + 'S', Node: true, kind: 'X' }, { _id: pfx + 'G', Node: true, kind: 'Y' }], segments: [root] },
		{ label: pfx, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
};

test('a derived method serialized via getMutationFromPath re-mounts SOUNDLY into a different problem at 0 calls', async () => {
	const n = bootPlan();

	// A: derive the method once (1 model call) — it now exists as a sub-graph in A's world.
	const A = mk('A');
	await nextStable(A);
	assert.equal(n.calls, 1, 'A derives the method (cold)');
	assert.deepEqual(Object.keys(A._objById).filter(( id ) => /_(m|a|b)\d/.test(id)).sort(), ['Aroot_a0', 'Aroot_b0', 'Aroot_m0']);

	// emit-as-subgraph through the ENGINE PRIMITIVE, then relativize.
	const param = emitMethodAsSubgraph(A, ['Aroot_m0', 'Aroot_a0', 'Aroot_b0'], { base: 'Aroot', refs: { origin: 'AS', target: 'AG' } });
	assert.ok(param, 'the method serialized + relativized');
	const flatParam = JSON.stringify(param);
	assert.ok(!/Aroot|"AS"|"AG"/.test(flatParam), 'the parameterized method carries NO absolute A ids (fully relativized — incl. the engine-added _origin)');

	// bind to B's call site and re-mount into a FRESH B world (no Plan, no model call).
	const boundForB = instantiate(param, { base: 'Broot', refs: { origin: 'BS', target: 'BG' } });
	const callsBefore = n.calls;
	const B = mk('B');                                            // B has no `toPlan` → Plan never fires
	await nextStable(B);
	await new Promise(( res ) => B.pushMutation(boundForB, 'Broot', false, undefined, undefined, res));
	await nextStable(B);

	assert.equal(n.calls - callsBefore, 0, 'the re-mount cost 0 model calls (transfer)');
	const m0 = B.getEtty('Broot_m0'), a0 = B.getEtty('Broot_a0'), b0 = B.getEtty('Broot_b0');
	assert.ok(m0 && a0 && b0, 'B got the rebased sub-graph');
	assert.equal(a0._.originNode, 'BS', 'first child wired from B’s own origin');
	assert.equal(a0._.targetNode, 'Broot_m0');
	assert.equal(b0._.originNode, 'Broot_m0');
	assert.equal(b0._.targetNode, 'BG', 'second child wired to B’s own target');
	assert.equal(m0._.kind, 'X~Y', 'the typed content (the model’s derived intermediate) replayed verbatim');
	assert.ok(!/Aroot|"AS"|"AG"/.test(JSON.stringify(B.serialize())), 'no A id-space leaked into B (sound)');
});
