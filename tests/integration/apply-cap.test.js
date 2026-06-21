'use strict';
/**
 * Roadmap #11.c.1 — the apply-count ceiling (oscillation backstop). #11.a's drain and
 * any self-modifying / self-destabilizing concept can oscillate (A→re-derive→A…) and
 * never reach a fixpoint (HANDOFF §3 #14 OPEN). A per-(target, concept) apply ceiling,
 * reset on each healthy settle, bounds it: once a (target, concept) applies more than
 * `cfg.applyCap` times within one non-settling episode, the engine FREEZES that pair
 * (it stops being applicable → the loop settles) and writes a `divergent` fact — a
 * surfaced, retraction-triggering signal for a host / meta-concept to handle.
 *
 * The runaway here is a provider that unsets its own self-flag every apply (verified
 * non-terminating): without the cap it oscillates forever; with it, it settles + flags.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
console.log = console.info = console.warn = () => {};

test('#11.c.1 the apply-count ceiling breaks a runaway oscillation and flags it divergent', async () => {
	Graph._providers = {
		Loop: {
			go(graph, concept, scope, argz, cb) {
				// unset own self-flag + change a fact -> re-cast forever (a true non-terminating loop)
				cb(null, { $_id: '_parent', Loop: null, loopN: (scope._.loopN || 0) + 1 });
			}
		}
	};
	const conceptMap = {
		common: { childConcepts: {
			Loop: { _id: 'Loop', _name: 'Loop', require: 'Distance', provider: ['Loop::go'] }
		} }
	};
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
	};

	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('oscillation NOT bounded — the apply-cap never fired')), 12000);
		new Graph(seed, {
			label: 'apply-cap', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			applyCap: 5,
			onStabilize(g) {
				const seg = g._objById['seg']._etty;
				if (!seg._.divergent) return;          // wait for the cap to fire and the graph to settle
				clearTimeout(timer);
				try {
					// the de-cast records WHY: a reason record pushed into the `divergent` array fact
					assert.ok(Array.isArray(seg._.divergent), 'divergent is an array fact (the reason record)');
					const rec = seg._.divergent.find((d) => d && d.concept === 'Loop');
					assert.ok(rec, 'the offending concept left a reason record');
					assert.equal(rec.reason, 'apply-cap', 'the reason is named');
					assert.ok(seg._.loopN <= 7, 'loopN bounded near the cap (5), not runaway — was ' + seg._.loopN);
					resolve(true);
				} catch (e) { reject(e); }
			}
		}, conceptMap);
	});
});

test('#11.c.1 a normal concept that applies once is NOT flagged divergent (no false positive)', async () => {
	Graph._providers = {};
	const conceptMap = {
		common: { childConcepts: {
			Far: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 300'] }
		} }
	};
	const seed = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }],
		segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }]
	};
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out')), 8000);
		new Graph(seed, {
			label: 'apply-cap-clean', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			applyCap: 5,
			onStabilize(g) {
				clearTimeout(timer);
				const seg = g._objById['seg']._etty;
				try {
					assert.equal(seg._.Far, true, 'Far cast normally');
					assert.ok(!seg._.divergent, 'a once-applied concept is never flagged divergent');
					resolve(true);
				} catch (e) { reject(e); }
			}
		}, conceptMap);
	});
});
