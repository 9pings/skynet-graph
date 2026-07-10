/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C5 — SUPERVISED SELF-MODIFICATION (`createSelfMod`, OPT-IN and guarded): the system authors a
 * NEW live rule under a host-supplied goal, through the CEGIS loop (propose → validate → install → test →
 * counterexample → revise).
 * THE GUARANTEE SHOWN: a malformed proposal is REJECTED by the author-time validator; a too-strict rule
 * installs but the goal test produces the counterexample that drives the revision; the final patch meets
 * the goal — and every step is a REVISION (rollbackTo = the reversibility guarantee).
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const Graph = require('../../lib/index.js');

// a minimal live graph: one segment carrying Distance 400 (the object the authored rule will classify).
function bootGraph() {
	Graph._providers = {};
	const seed = { lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }],
	               segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }] };
	return new Promise(( resolve ) => {
		const g = new Graph(seed, { label: 'c5', isMaster: true, autoMount: true, conceptSets: ['common'],
			bagRefManagers: {}, onStabilize() { if ( !g.__up ) { g.__up = true; resolve(g); } } },
			{ common: { childConcepts: {} } });
	});
}

// the GOAL (host-owned): `seg` should end up carrying the Far fact.
const goal = ( graph ) => {
	const met = graph._objById['seg']._etty._.Far === true;
	return { met, counterexample: met ? null : 'seg.Distance.inKm=400 did not produce Far' };
};
// the PROPOSER (an LLM in real use — scripted here): malformed → too strict → the fixing patch.
const propose = async ( { round } ) => {
	if ( round === 0 ) return { op: 'add', parent: null, schema: { _id: 'Far', _name: 'Far', require: 'Distance', ensure: ['$Distance.inKm ==== ('] } };
	if ( round === 1 ) return { op: 'add', parent: null, schema: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 500'] } };
	return { op: 'patch', nameOrId: 'Far', updates: { assert: ['$Distance.inKm > 300'] } };
};

async function main() {
	const g = await bootGraph();
	try {
		const sm = Graph.combos.createSelfMod({ graph: g, propose, validate: { knownFacts: ['Distance', 'Segment'], palette: [] } });
		const res = await sm.author({ goal, goalDescription: 'segment should be Far', maxRounds: 5 });

		console.log('CEGIS   : converged=' + res.ok + ' in ' + res.rounds.length
			+ ' rounds (round 0 rejected by the validator, round 1 beaten by its counterexample)');
		assert.equal(res.ok, true, 'the loop converged');
		assert.equal(g._objById['seg']._etty._.Far, true, 'the authored rule now casts Far on the live object');

		console.log('history : ' + sm.revisions().length + ' revision(s) — rollbackTo is the reversibility guarantee');
		console.log('BOOTSTRAP OK — a live rule authored under supervision (validator + counterexamples), reversible');
	} finally { g.destroy(); }
}
main().catch(( e ) => { console.error(e); process.exit(1); });
