'use strict';
/**
 * Roadmap #11 (live self-modification) — sub-rung #11.a: re-entrancy.
 *
 * A meta-concept's PROVIDER calls addConcept/patchConcept while stabilization is
 * running (the self-modification scenario). Verified-before-build findings:
 *   - adding a NEW concept mid-stabilize already works (it writes/destabilizes and
 *     the running loop picks it up — the engine's write-to-destabilize auto-throttle);
 *   - BUT patching the concept that is CURRENTLY mid-apply is silently dropped: at
 *     patch time its self-flag is not yet written, so patchConcept's re-eval sees it
 *     as not-cast and skips the retraction (MODELISATION §6.4: "a meta-concept may not
 *     edit a concept currently mid-apply on the stack").
 *
 * The fix: a structural op issued WHILE `_stabilizing` is queued and DRAINED at the
 * next quiescent boundary in `_loopTF`, where cast-state is settled and consistent.
 * The drained op writes/destabilizes → the existing loop converges (no extra kick).
 * Host-issued ops (quiescent boundary, e.g. from onStabilize) still apply immediately.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

const seg = (g) => g._objById['seg']._etty;

// Resolve on the converged stabilize (with the queue, `_applyStabilized` only fires
// once cast-state is settled AND no structural op is pending).
function runUntilStable(label, providers, conceptMap, assertFn) {
	Graph._providers = providers;
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
	};
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(label + ' timed out / oscillating')), 15000);
		let done = false;
		new Graph(seed, {
			label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) {
				if (done || g._pendingStructural && g._pendingStructural.length) return;  // not yet converged
				done = true; clearTimeout(timer);
				try { assertFn(g); resolve(true); } catch (e) { reject(e); }
			}
		}, conceptMap);
	});
}

test('#11.a a meta-concept patching the concept it is mid-applying retracts it (deferred to a quiescent boundary)', async () => {
	const providers = {
		Meta: {
			grow(graph, concept, scope, argz, cb) {
				// retract Meta by tightening its own assert beyond reach — mid-apply
				graph.patchConcept('Meta', { assert: ['$Distance.inKm > 99999'] });
				cb(null, { $_id: '_parent', Meta: true });
			}
		}
	};
	const conceptMap = {
		common: { childConcepts: {
			Meta: { _id: 'Meta', _name: 'Meta', require: 'Distance', assert: ['$Distance.inKm > 0'], provider: ['Meta::grow'] }
		} }
	};
	await runUntilStable('selfmod-retract', providers, conceptMap, (g) => {
		assert.ok(!seg(g)._.Meta, 'the deferred self-patch (>99999 @400) retracted Meta — not silently dropped');
	});
});

test('#11.a a meta-concept that addConcepts a new expert mid-stabilize installs it and it casts', async () => {
	const providers = {
		Meta: {
			grow(graph, concept, scope, argz, cb) {
				if (!graph._conceptLib['Far'])
					graph.addConcept(null, { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 300'] });
				cb(null, { $_id: '_parent', Meta: true });
			}
		}
	};
	const conceptMap = {
		common: { childConcepts: {
			Meta: { _id: 'Meta', _name: 'Meta', require: 'Distance', provider: ['Meta::grow'] }
		} }
	};
	await runUntilStable('selfmod-add', providers, conceptMap, (g) => {
		assert.equal(seg(g)._.Meta, true, 'Meta cast');
		assert.ok(g._conceptLib['Far'], 'Far installed into the live concept library');
		assert.equal(seg(g)._.Far, true, 'the runtime-added Far cast on the live segment (400 > 300)');
	});
});
