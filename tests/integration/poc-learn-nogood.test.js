'use strict';
/**
 * PoC M6 — the LEARNING axis, cross-EPISODE. A recurring trial (SolveRoute) is a dead-end
 * for some context kinds. Episode 1 (cold) tries every route and LEARNS the dead-ends as
 * nogoods; episode 2 (warm — the learned store carried in) SOUND-SKIPS them, doing strictly
 * less expensive work while reaching the IDENTICAL useful fixpoint. This is the "the trace
 * shrinks on the second episode" claim of the PoC cut-line — distinct from nogood-policy's
 * within-run 24->12 (it shows the learning PERSISTS and pays across episodes).
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md (M6).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { createNogood, recordNogood, guardTrial, nogoodGuardConcept } = require('../../lib/providers/nogood');

console.log = console.info = console.warn = () => {};

const DEAD = new Set(['routeA', 'routeB']);   // two of the four routes are dead-ends
const routeProv = { Route: { solve( graph, concept, scope, argz, cb ) {
	const kind = scope._.kind, dead = DEAD.has(kind);
	const out = [
		{ $_id: '_parent', SolveRoute: true, routeResult: dead ? 'deadend' : ('ok:' + kind) },
		{ $$_id: 'mem', expensiveRuns: { __push: scope._._id } }   // count each expensive trial
	];
	if ( dead ) out.push(recordNogood({ ctxKey: kind, trial: 'SolveRoute' }));   // learn the dead-end
	cb(null, out);
} } };

const tree = { common: { childConcepts: {
	NogoodGuard: nogoodGuardConcept({ require: ['Trial', 'kind'] }),
	SolveRoute: guardTrial({ _id: 'SolveRoute', _name: 'SolveRoute', require: ['Trial', 'kind'], provider: ['Route::solve'] })
} } };

const cfg = { label: 'poc-nogood', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

function seed( nogoods ) {
	return {
		lastRev: 0,
		nodes: [{ _id: 'n0' }, { _id: 'n1' }, { _id: 'mem', nogoods: nogoods || [], expensiveRuns: [] }],
		segments: ['routeA', 'routeB', 'routeC', 'routeD'].map(( k, i ) => ({ _id: 's' + i, originNode: 'n0', targetNode: 'n1', Trial: true, kind: k }))
	};
}

async function episode( nogoods ) {
	Graph._providers = Object.assign({}, createNogood(), routeProv);
	const g = new Graph(seed(nogoods), cfg, tree);
	await nextStable(g);
	return g;
}

test('cross-episode: the warm episode sound-skips the learned dead-ends, same useful fixpoint', async () => {
	const e1 = await episode([]);                       // cold — nothing learned yet
	const m1 = e1._objById['mem']._etty._;
	assert.equal(m1.expensiveRuns.length, 4, 'episode 1: all 4 routes were tried (expensive)');
	const learned = m1.nogoods;
	assert.equal(learned.length, 2, 'two dead-ends learned');
	assert.deepEqual(learned.map(( n ) => n.ctxKey).sort(), ['routeA', 'routeB'], 'the dead routes, keyed by context');

	const e2 = await episode(learned);                  // warm — carry the learned nogoods
	const m2 = e2._objById['mem']._etty._;
	assert.equal(m2.expensiveRuns.length, 2, 'episode 2: the dead-ends were sound-skipped -> only the 2 useful routes ran');
	assert.ok(m2.expensiveRuns.length < m1.expensiveRuns.length, 'the warm episode does strictly less expensive work');

	const f1 = ( id ) => e1._objById[id]._etty._, f2 = ( id ) => e2._objById[id]._etty._;
	assert.ok(!f2('s0').SolveRoute && !f2('s1').SolveRoute, 'routeA/routeB skipped in episode 2');
	// fixpoint-preserving: the SURVIVING useful conclusions are identical to the cold run
	assert.equal(f2('s2').routeResult, 'ok:routeC');
	assert.equal(f2('s3').routeResult, 'ok:routeD');
	assert.equal(f1('s2').routeResult, f2('s2').routeResult, 'routeC result identical cold vs warm');
	assert.equal(f1('s3').routeResult, f2('s3').routeResult, 'routeD result identical cold vs warm');
	for ( const id of ['s0', 's1', 's2', 's3'] ) assert.ok(!f2(id).divergent, id + ': no oscillation');
});
