'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * POC — the STANDING / autonomous C-contract un-learn loop (§3.1): the engine drives
 * blame → revise → patch as REACTIVE concepts at the stabilize fixpoint, NO host glue.
 * The standing sibling of `contract-unlearn.js` (whose steps 3-4 were plain host JS).
 *
 * Scenario (the same hidden-prose-precondition as contract-unlearn.js): `FastApprove` was
 * learned on US loans — typed pre `score>=700`, post `decision=='approve'`. Its REAL
 * precondition includes a regulatory constraint the typed pre never captured. A compliance
 * audit ingests `compliant=false` on a EU approval →
 *   1. the FastApprove BELIEF RETRACTS (JTMS — its `$compliant` ensure fails);
 *   2. the `Lib::blame` cleaner deposits a typed CONSTAT on `mem` AND a discrete `blamed`
 *      fact on the library node `lib:FastApprove` (the `require` trigger);
 *   3. the `Revise` meta-concept (`require:['blamed']`) fires AUTONOMOUSLY → `Lib::revise`
 *      revises the library contract (reviseOnBlame) AND `patchConcept`es the engine gate to
 *      exclude region==EU (queued mid-stabilize, drains at the quiescent boundary);
 *   4. a fresh EU app is now EXCLUDED upfront (the library un-learned the over-general claim)
 *      while a US app is still ADMITTED (surgical narrowing, not method removal).
 *
 * The whole cascade runs inside ONE `ingest(...).then(settle)` — no host reviseOnBlame call.
 *
 * Run: `node examples/poc/contract-relearn.js`  (also: `node … off` for the loop-OFF control).
 */
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { makeRelearnProviders, relearnTree } = require('../../lib/authoring/learning/relearn.js');
const C = require('../../lib/authoring/core/contract.js');

async function settle( g ) {
	for ( let i = 0; i < 50; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r));
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
}

// the LEARNED method's typed contract — what the library holds + revises.
const FAST_APPROVE = { name: 'FastApprove',
	contract: { read: ['score'], write: ['decision'], pre: ['score>=700'], post: ["decision=='approve'"], effect: 'internal' } };

const cast = ( g, id, k ) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = ( g, id, k ) => g._objById[id] && g._objById[id]._etty._[k];

// Build the concept tree. The defeasant method gets the `Lib::blame` cleaner + a typed
// `discriminator`; loopOn adds the reactive `Revise` meta-concept (relearnTree).
function buildTree( loopOn ) {
	const child = {
		FastApprove: {
			_id: 'FastApprove', _name: 'FastApprove', require: ['score'],
			ensure: ['$score>=700', '$compliant'], provider: ['App::approve'],
			cleaner: ['Lib::blame'], discriminator: 'region',
			constat: { claimKey: 'decision', because: 'compliant' }
		}
	};
	if ( loopOn ) Object.assign(child, relearnTree().childConcepts);
	return { common: { childConcepts: child } };
}

/**
 * The standing loop on the real engine.
 * @param opts.loopOn  wire the reactive Revise concept (default true). false = the neg control.
 * @returns observable state for assertions.
 */
async function relearn( opts ) {
	opts = opts || {};
	const loopOn = opts.loopOn !== false;

	// a FRESH contract copy per run (B8: revise versions the registry, never the source).
	const registry = { FastApprove: Object.assign({}, FAST_APPROVE.contract,
		{ pre: FAST_APPROVE.contract.pre.slice(), read: FAST_APPROVE.contract.read.slice() }) };

	Graph._providers = Object.assign(
		{ App: { approve( g, c, scope, argz, cb ) { cb(null, { $_id: '_parent', decision: 'approve', FastApprove: true }); } } },
		makeRelearnProviders({ registry })
	);

	// seed: the library node, the blame anchor, a EU app (casts), a US app (the surgical
	// control), and a SECOND EU app held back with no `compliant` (introduced post-drift).
	const seed = { lastRev: 0,
		freeNodes: [{ _id: 'mem', lessons: [] }, { _id: 'lib:FastApprove' }],
		nodes: [
			{ _id: 'app1', score: 720, region: 'EU', compliant: true },
			{ _id: 'usApp', score: 740, region: 'US', compliant: true },
			{ _id: 'app2', score: 730, region: 'EU' }
		], segments: [] };
	const g = new Graph(seed, { label: 'relearn', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree(loopOn));
	await settle(g);

	// 1 — initial cast: the method applies to both compliant 700+ apps (gate not yet narrowed).
	const before = {
		app1: cast(g, 'app1', 'FastApprove'), app1Decision: fact(g, 'app1', 'decision'),
		usApp: cast(g, 'usApp', 'FastApprove'),
		ensure: gateEnsure(g)
	};

	// 2 — drift: a compliance audit finds the EU approval non-compliant. The engine ALONE
	//     retracts, blames, and (loopOn) revises + narrows the gate — inside this one settle.
	await new Promise(( res ) => g.ingest({ app1: { compliant: false } }, res));
	await settle(g);

	// 3 — a fresh EU app arrives AFTER the audit (compliant) → should be EXCLUDED if narrowed.
	await new Promise(( res ) => g.ingest({ app2: { compliant: true } }, res));
	await settle(g);

	const after = {
		app1: cast(g, 'app1', 'FastApprove'),
		app2: cast(g, 'app2', 'FastApprove'),           // ON: false (excluded) · OFF: true (stale re-served)
		usApp: cast(g, 'usApp', 'FastApprove'),          // surgical: still cast both ways
		ensure: gateEnsure(g),
		lessons: fact(g, 'mem', 'lessons'),
		blamed: fact(g, 'lib:FastApprove', 'blamed'),
		revised: fact(g, 'lib:FastApprove', 'revised'),
		narrowedPre: fact(g, 'lib:FastApprove', 'narrowedPre'),
		divergent: fact(g, 'app1', 'divergent') || fact(g, 'lib:FastApprove', 'divergent') || null,
		registryPre: registry.FastApprove.pre
	};

	// 4 — confirm the surgical selection on the revised library contract (host-side check).
	const selection = {
		euExcluded: !C.satisfies(registry.FastApprove.pre, { score: 730, region: 'EU' }),
		usAdmitted: C.satisfies(registry.FastApprove.pre, { score: 740, region: 'US' })
	};

	return { loopOn, before, after, selection };

	function tree( on ) { return buildTree(on); }
}

// read the live engine gate's ensure array for the method.
function gateEnsure( g ) {
	const c = g.getConceptByName('FastApprove');
	return c && c._schema.ensure ? c._schema.ensure.slice() : null;
}

module.exports = { FAST_APPROVE, relearn, buildTree };

if ( require.main === module ) {
	const loopOn = process.argv[2] !== 'off';
	relearn({ loopOn }).then(( r ) => {
		console.log('\n=== contract-relearn  (loop %s) ===', r.loopOn ? 'ON' : 'OFF');
		console.log('[1 cast]    app1(EU) belief=%s decision=%s · usApp(US) belief=%s · gate ensure=%j',
			r.before.app1, r.before.app1Decision, r.before.usApp, r.before.ensure);
		console.log('[2 drift]   after audit(app1 compliant=false): app1 belief=%s  (JTMS un-learn)', r.after.app1);
		console.log('[2 blame]   lib:FastApprove blamed=%s · constat=%j', r.after.blamed, (r.after.lessons || [])[0]);
		console.log('[3 revise]  AUTONOMOUS: revised=%s · gate ensure=%j · registry.pre=%j',
			r.after.revised, r.after.ensure, r.after.registryPre);
		console.log('[3 standing] fresh app2(EU,compliant) casts FastApprove=%s  (ON expects FALSE = excluded)', r.after.app2);
		console.log('[4 surgical] usApp(US) still cast=%s · euExcluded=%s · usAdmitted=%s',
			r.after.usApp, r.selection.euExcluded, r.selection.usAdmitted);
		console.log('[guard]     divergent=%j', r.after.divergent);
	}).catch(( e ) => { console.error(e); process.exit(1); });
}
