'use strict';
/**
 * Logging end-to-end: a provider logs via scope.log and concept.log(scope) during
 * its apply. The records are retrievable from graph.logger by {concept}/{applyId},
 * carry the right context, correlate with the onConceptApply trace by applyId — and
 * the target object gains NO new fact (logs never touch the graph).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { createLogger } = require('../../lib/graph/log.js');

test('provider logs are routed, contextual, apply-correlated, and leave no fact on the object', async () => {
	const logger = createLogger({ label: 'lt', level: 'verbose', console: false });
	const trace = [];
	let g;

	Graph._providers = {
		AI: {
			work( graph, concept, scope, argz, cb ) {
				scope.log.warn('object-level note');                 // ctx {target,type}
				const log = concept.log(scope);                      // ctx {concept,target,applyId}
				log.info('provider detail', 42);
				cb(null, { $_id: '_parent', Worked: true, result: 7 });
			}
		}
	};
	const conceptMap = {
		common: { childConcepts: {
			Worked: { _id: 'Worked', _name: 'Worked', require: 'Segment', provider: ['AI::work'] }
		} }
	};
	const seed = { lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }], segments: [{ _id: 's', originNode: 'a', targetNode: 'b' }] };

	await new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error('logging run timed out')), 15000);
		let done = false;
		g = new Graph(seed, {
			label: 'lt', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			logger, onConceptApply: ( r ) => trace.push(r),
			onStabilize() { if ( done ) return; done = true; clearTimeout(timer); resolve(); }
		}, conceptMap);
	});

	// retrieve the logs THIS concept made while applying
	const byConcept = logger.tail(null, { concept: 'Worked' });
	assert.ok(byConcept.length >= 1, 'concept.log(scope) records retrievable by {concept}');
	const rec = byConcept[0];
	assert.equal(rec.ctx.target, 's');
	assert.equal(rec.ctx.type, 'segment');
	assert.equal(typeof rec.ctx.applyId, 'number');

	// scope.log carried object context but no concept
	const objLevel = logger.records.find(( r ) => r.msg === 'object-level note');
	assert.ok(objLevel && objLevel.ctx.target === 's' && objLevel.ctx.type === 'segment' && objLevel.ctx.concept == null,
		'scope.log carries {target,type} but no concept');

	// logs <-> trace correlate by applyId
	const tr = trace.find(( t ) => t.conceptName === 'Worked');
	assert.ok(tr, 'Worked trace record present');
	assert.equal(tr.applyId, rec.ctx.applyId, 'log and trace share applyId');

	// NO fact bloat: the object only has what the provider wrote (+ engine keys), never a log key
	const objKeys = Object.keys(g._objById['s']._etty._).sort();
	assert.ok(objKeys.includes('Worked') && objKeys.includes('result'), 'provider facts present');
	assert.ok(!objKeys.some(( k ) => /log/i.test(k)), 'no log-related fact written to the object');
	assert.ok(!('_applyId' in g._objById['s']._etty._), '_applyId lives on the Entity, never in the serialized data');
});
