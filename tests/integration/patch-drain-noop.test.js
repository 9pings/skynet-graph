'use strict';
/**
 * REGRESSION (#11.a re-entrancy boundary) — a queued structural op whose drain is a NO-OP
 * must still settle.
 *
 * `patchConcept` issued mid-stabilize (from a meta-concept's provider) defers to the
 * quiescent `_loopTF` boundary, where `_drainStructural` runs it. The drain branch used to
 * `return` unconditionally, ASSUMING the re-eval always destabilizes an object (which re-arms
 * the loop via the scheduled iteration's `flow.run()`). But when the patch changes NO
 * cast-state — e.g. a TIGHTENING that would exclude an object already un-cast for another
 * reason — the drain is a no-op: the graph is quiescent with nothing to run, the loop never
 * re-arms, and `_stabilizing` stays stuck `true` forever (the `stabilize` event / any waiting
 * `ingest`/`stabilize` cb never fire). This reproduces that stall; before the fix it times out.
 *
 * Found while building the standing C-contract un-learn loop (§3.1): the autonomous revise
 * patches the method's gate to exclude the failing case, but that case is ALREADY un-cast by
 * the JTMS retraction that triggered the revise — so the gate-narrowing drain is a no-op.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

test('#11.a a no-op structural drain (tightening patch that changes no cast-state) still settles', async () => {
	Graph._providers = {
		T: {
			// fired mid-stabilize: tighten `Other` so it would exclude n1 — but n1 is already
			// NOT cast (x<0), so the re-eval changes nothing. The drain must not wedge the loop.
			patch(graph, concept, scope, argz, cb) {
				graph.__wasStabilizing = graph._stabilizing;
				graph.patchConcept('Other', { require: 'x', ensure: ['$x>0', '$x!=99'] });
				cb(null, { $_id: '_parent', Trigger: true, done: true });
			}
		}
	};
	const conceptMap = { common: { childConcepts: {
		// no provider -> auto-flags; n1 never satisfies it (x=-5), so it is never cast.
		Other:   { _id: 'Other', _name: 'Other', require: 'x', ensure: ['$x>0'] },
		// re-fire guarded by `done`; its provider patches Other once.
		Trigger: { _id: 'Trigger', _name: 'Trigger', require: 'go', ensure: ['!$done'], provider: ['T::patch'] }
	} } };
	const seed = { lastRev: 0, nodes: [{ _id: 'n1', x: -5 }], segments: [] };

	let phase = 0;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('patch-drain-noop timed out at phase ' + phase + ' (the no-op drain wedged the stabilize loop)')), 15000);
		const fail = (e) => { clearTimeout(timer); reject(e); };
		const g = new Graph(seed, {
			label: 'patch-drain-noop', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				try {
					if (phase === 0) {
						phase = 1;
						assert.ok(!g._objById['n1']._etty._.Other, 'Other not cast on n1 (x<0)');
						// introduce the trigger node -> Trigger fires -> patchConcept(Other) queued -> no-op drain.
						g.pushMutation({ _id: 't1', go: true });
					} else if (phase === 1) {
						// reaching here AT ALL is the assertion: the graph settled past the no-op drain.
						clearTimeout(timer);
						assert.equal(g.__wasStabilizing, true, 'the patch was issued mid-stabilize (queued, then drained)');
						assert.deepEqual(g.getConceptByName('Other')._schema.ensure, ['$x>0', '$x!=99'], 'the tightening patch did apply');
						assert.ok(!g._objById['n1']._etty._.Other, 'n1 still not cast (the drain was indeed a no-op)');
						resolve(true);
					}
				} catch (e) { fail(e); }
			}
		}, conceptMap);
	});
});
