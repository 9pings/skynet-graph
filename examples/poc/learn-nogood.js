'use strict';
/**
 * PoC M6 (reusable) — cross-EPISODE nogood learning. Episode 1 (cold) tries every route
 * and learns the dead-ends; episode 2 (warm — the learned store carried in) sound-skips
 * them, doing strictly less expensive work for the IDENTICAL useful fixpoint. Used by the
 * M6 test and the M9 demo. Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md.
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { createNogood, recordNogood, guardTrial, nogoodGuardConcept } = require('../../lib/providers/nogood');

const DEAD = new Set(['routeA', 'routeB']);   // two of the four routes are dead-ends
const routeProv = { Route: { solve( graph, concept, scope, argz, cb ) {
	const kind = scope._.kind, dead = DEAD.has(kind);
	const out = [
		{ $_id: '_parent', SolveRoute: true, routeResult: dead ? 'deadend' : ('ok:' + kind) },
		{ $$_id: 'mem', expensiveRuns: { __push: scope._._id } }
	];
	if ( dead ) out.push(recordNogood({ ctxKey: kind, trial: 'SolveRoute' }));
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

// Run cold then warm, returning a summary (and no raw graphs — the summary carries everything).
async function runNogoodEpisodes() {
	const e1 = await episode([]);
	const m1 = e1._objById['mem']._etty._;
	const learned = m1.nogoods;
	const e2 = await episode(learned);
	const m2 = e2._objById['mem']._etty._;
	const res = ( id ) => ({ cold: e1._objById[id]._etty._.routeResult, warm: e2._objById[id]._etty._.routeResult });
	return {
		coldRuns: m1.expensiveRuns.length,
		warmRuns: m2.expensiveRuns.length,
		learned: learned.map(( n ) => n.ctxKey).sort(),
		skipped: ['s0', 's1'].filter(( id ) => !e2._objById[id]._etty._.SolveRoute),
		results: { s2: res('s2'), s3: res('s3') },
		divergentWarm: ['s0', 's1', 's2', 's3'].filter(( id ) => e2._objById[id]._etty._.divergent)
	};
}

module.exports = { runNogoodEpisodes };
