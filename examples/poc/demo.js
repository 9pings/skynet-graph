'use strict';
/**
 * PoC M9-lite — the one-command demo that runs the full narrative end-to-end, composing the
 * tested rungs over the deterministic socle (no LLM, no GPU):
 *
 *   1. DECOMPOSE — the universal `_substrate` grammar tiles a trip into sub-steps and folds
 *      a bounded answer bottom-up (M1).
 *   2. TILING / PAVAGE — `forkPlan` derives a domain's separators + per-fork frontier
 *      alphabets from the concept-dependency graph (M2).
 *   3. SOLVE + MERGE — a C-regime solver fork searches a sub-problem the D socle can't, and
 *      only the snapped frontier {sat,model} crosses back, enforced as a checked contract (M3).
 *   4. LEARN — cross-episode nogood learning makes the warm episode strictly cheaper for the
 *      same useful fixpoint (M6).
 *
 * Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md (M9-lite cut-line).
 *   node examples/poc/demo.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { forkPlan } = require('../../lib/authoring/decompose');
const { createSolver, snappedFrontier, solverConceptTree } = require('../../lib/providers');
const { runTripDecompose } = require('./trip-decompose.js');
const { forkSolveAndMerge } = require('./fork-driver.js');
const { runNogoodEpisodes } = require('./learn-nogood.js');
const { runClinicalDefeasance } = require('./clinical.js');

// a small 3-domain tree (clinical/travel/supply) sharing two bridge facts {cost, risk} —
// the planted structure forkPlan recovers as the separator interface + 3 tiles.
const domainTree = { childConcepts: {
	Diagnose:   { _id: 'Diagnose', _name: 'Diagnose', require: ['symptom'], ensure: ['$risk != null'], applyMutations: [{ $_id: '_parent', diagnosis: true }] },
	TravelRisk: { _id: 'TravelRisk', _name: 'TravelRisk', require: ['distance'], ensure: ['$risk != null', '$mode != null'] },
	TravelCost: { _id: 'TravelCost', _name: 'TravelCost', require: ['distance'], ensure: ['$cost != null', '$mode != null'] },
	Reorder:    { _id: 'Reorder', _name: 'Reorder', require: ['stock'], ensure: ['$cost != null'], applyMutations: [{ $_id: '_parent', order: true }] }
} };

// Stage 3 — fork a C-solver onto a 5-node odd cycle (3-colorable), merge only the snapped frontier.
async function solverStage() {
	Graph._providers = Object.assign({}, createSolver(), { Chk: { verify( graph, concept, scope, argz, cb ) {
		const m = scope._.model || {}, edges = scope._.edges || [];
		let v = 0; for ( const [a, b] of edges ) if ( m[a] === m[b] ) v++;
		cb(null, { $_id: '_parent', Verify: true, valid: v === 0 });
	} } });
	const dTree = { common: { childConcepts: {
		ProbRoot: { _id: 'ProbRoot', _name: 'ProbRoot', require: ['ProbRoot'], childConcepts: {
			Verify: { _id: 'Verify', _name: 'Verify', require: ['model', 'sat'], ensure: ['$sat==true'], provider: ['Chk::verify'] },
			Unsat: { _id: 'Unsat', _name: 'Unsat', require: ['sat'], ensure: ['$sat==false'] }
		} }
	} } };
	const cfg = { label: 'demo-solver', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };
	const nodes = [0, 1, 2, 3, 4], edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]];
	const parent = new Graph({ lastRev: 0, nodes: [{ _id: 'prob', ProbRoot: true, nodes, edges }], segments: [] }, cfg, dTree);
	await nextStable(parent);
	await forkSolveAndMerge(parent, {
		childSeed: { lastRev: 0, nodes: [{ _id: 'prob', toSolve: true, nodes, edges }], segments: [] },
		childConf: { label: 'demo-Csolver', conceptMap: { common: solverConceptTree() } },
		targetId: 'prob', frontierAlphabet: ['sat', 'model'], project: snappedFrontier({ targetId: 'prob' }), nextStable
	});
	const f = parent._objById['prob']._etty._;
	return { sat: f.sat, modelSize: f.model ? Object.keys(f.model).length : 0, stepsLeaked: f.steps != null, valid: !!f.valid };
}

async function runDemo() {
	// 1 — DECOMPOSE
	const g = await runTripDecompose({ maxDepth: 1 });
	const root = g._objById['root']._etty._;
	const decompose = { rootAnswer: root.answer, subSteps: root.expandedInto.length };

	// 2 — TILING / PAVAGE
	const plan = forkPlan(domainTree);
	const tiling = { separators: plan.separators, forks: plan.forks.length };

	// 3 — SOLVE + MERGE (checked frontier)
	const solve = await solverStage();

	// 4 — LEARN (cross-episode)
	const learn = await runNogoodEpisodes();

	// 5 — DEFEASANCE (the niche): a refuted lab retracts the diagnosis + cascades the medication
	const d = await runClinicalDefeasance();
	const defeasance = {
		retracted: d.before.Diagnosis && !d.after.Diagnosis,
		cascaded: d.before.Medication && !d.after.Medication,
		constat: d.after.lessons[0]
	};

	return { decompose, tiling, solve, learn, defeasance };
}

module.exports = { runDemo, domainTree };

if ( require.main === module ) {
	runDemo().then(( r ) => {
		console.log('\n=== PoC demo — learning + tiling over the deterministic socle ===\n');
		console.log('1. DECOMPOSE  : trip ->', r.decompose.subSteps, 'sub-steps; root answer =', r.decompose.rootAnswer);
		console.log('2. TILING     : separators =', JSON.stringify(r.tiling.separators), '|', r.tiling.forks, 'tiles (pavage)');
		console.log('3. SOLVE+MERGE: sat =', r.solve.sat, '| model crossed =', r.solve.modelSize, 'nodes | steps leaked =', r.solve.stepsLeaked, '| D-verified =', r.solve.valid);
		console.log('4. LEARN      : cold episode =', r.learn.coldRuns, 'trials -> warm =', r.learn.warmRuns, '(learned', JSON.stringify(r.learn.learned) + ')');
		console.log('5. DEFEASANCE : refuted lab -> diagnosis retracted =', r.defeasance.retracted, '| medication cascaded =', r.defeasance.cascaded,
			'| constat =', JSON.stringify(r.defeasance.constat));
		console.log('\nall five axes ran on the real engine, zero core change.\n');
		process.exit(0);
	}).catch(( e ) => { console.error(e); process.exit(1); });
}
