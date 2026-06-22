'use strict';
/**
 * "Expert scoring" needs NO engine feature: a score (confidence/weight/…) is an
 * ordinary fact in the fact-driven graph. This locks in that:
 *   (B) a score gates concept casting straight from an assert (`$confidence > 0.7`);
 *       a provider reads it from `scope` (i.e. it can feed a prompt);
 *   (A) a score is a queryable fact that aggregates across a path's segments.
 * No confidence/weight schema fields, no conflict-resolution machinery.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
console.log = console.info = console.warn = () => {};

test('confidence is an ordinary fact: gates asserts, feeds providers, aggregates over paths', async () => {
	// A provider that reads `confidence` from the application context (as a prompt
	// input would) and writes a derived fact — no special scoring API involved.
	Graph._providers = {
		AI: {
			boost(graph, concept, scope, argz, cb) {
				const conf = graph.getRef('confidence', scope) || 0;
				cb(null, { $_id: '_parent', Boost: true, boosted: conf * 2 });
			}
		}
	};

	// Concept-prompt library, in code: confidence used purely as a fact.
	const tree = {
		childConcepts: {
			Scored: {
				_id: 'Scored', _name: 'Scored', require: 'Segment',
				childConcepts: {
					// (B) a score threshold gates casting, straight from the assert
					HiConf: { _id: 'HiConf', _name: 'HiConf', require: ['Scored'], assert: ['$confidence > 0.7'] },
					// provider reads the score from scope
					Boost: { _id: 'Boost', _name: 'Boost', require: ['Scored'], provider: ['AI::boost'] }
				}
			}
		}
	};

	const serialized = {
		lastRev: 0,
		nodes: [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }],
		segments: [
			{ _id: 'segHi', originNode: 'a', targetNode: 'b', confidence: 0.9 },
			{ _id: 'segLo', originNode: 'a', targetNode: 'c', confidence: 0.3 }
		]
	};

	const graph = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('scoring graph did not stabilize')), 10000);
		new Graph(serialized, {
			label: 'scoring', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onStabilize(g) { clearTimeout(timer); resolve(g); }
		}, { common: tree });
	});

	const hi = graph._objById['segHi']._etty._;
	const lo = graph._objById['segLo']._etty._;

	// (B) threshold gate via assert — confidence read as a fact
	assert.equal(hi.HiConf, true, 'segHi (0.9) casts HiConf');
	assert.ok(!lo.HiConf, 'segLo (0.3) does not cast HiConf');

	// provider read the score from scope and derived a new fact
	assert.equal(hi.boosted, 1.8, 'provider read confidence=0.9 from scope');
	assert.equal(lo.boosted, 0.6, 'provider read confidence=0.3 from scope');

	// (A) the score is a queryable fact, aggregatable across segments of a path
	const segIds = Object.keys(graph._objById).filter((id) => graph._objById[id]._etty._.Segment);
	const total = segIds.reduce((s, id) => s + (graph._objById[id]._etty._.confidence || 0), 0);
	assert.equal(Math.round(total * 10) / 10, 1.2, 'confidence aggregates across segments');
});
