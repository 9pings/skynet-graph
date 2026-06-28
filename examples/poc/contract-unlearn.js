'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * POC — the C-CONTRACT UN-LEARN LOOP in the BELIEF view (the conception's MOAT, §2/§6): a method whose learned
 * typed contract is WRONG on a new case RETRACTS in the belief view (JTMS), BLAMES the contract, and the LIBRARY
 * REVISES it (specialize the pre, CEGIS) so it no longer claims the failing case. This is the belief-half companion
 * of the executor-half guard (durable-contract.js) — together: assume-compose (checkCompose) / assert-settle /
 * retract-blame / revise, end to end across both layers.
 *
 * The differentiator no prose memory / RAG / skill-library can match: PRINCIPLED un-learning. A stale skill in a
 * vector store stays retrievable; here the typed premise is IN the belief, so when it falls the JTMS retracts the
 * derivation (no wrong belief served) AND the library narrows the method's applicability (no wasted future attempt).
 *
 * Scenario (the adversary's hidden-prose-precondition, made concrete): `FastApprove` was learned on US loans —
 * contract pre `score>=700`, post `decision=='approve'`. Its REAL precondition includes a regulatory constraint the
 * typed pre never captured (the §9.1 hole). A compliance audit ingests `compliant=false` on a EU approval →
 *   1. the FastApprove BELIEF RETRACTS (its post-as-`ensure` fails → the cast marker goes false; JTMS un-learn —
 *      any downstream gated on the FastApprove belief retracts, vs a RAG entry that stays retrievable-but-stale);
 *   2. a `cleaner` deposits a typed CONSTAT blame (claim=approve, retractedBecause=compliant);
 *   3. the host reads the blame + the case's discriminating fact (region) → `reviseOnBlame` specializes the pre to
 *      exclude region==EU → the library un-learned the over-general claim;
 *   4. `satisfies` confirms: the revised contract now EXCLUDES a EU app but still ADMITS a US app (surgical, not
 *      method removal — Findler-Felleisen blame → contract revision, not deletion).
 *
 * Avoids engine finding #22 (a cast concept doesn't re-fire on a required-VALUE change) by keying the gate on a
 * DIRECTLY-INGESTED fact (`compliant`) — the E4/ingest pattern — so the ensure re-evaluates on the CDC.
 *
 * Run: `node examples/poc/contract-unlearn.js`.
 */
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { createConstat } = require('../../lib/providers/constat.js');
const C = require('../../lib/authoring/contract.js');

async function settle( g ) {
	for ( let i = 0; i < 50; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r));
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
}

// the LEARNED method's typed contract (what the library holds + composes on).
const FAST_APPROVE = { name: 'FastApprove',
	contract: { read: ['score'], write: ['decision'], pre: ['score>=700'], post: ["decision=='approve'"], effect: 'internal' } };

// the method as an engine concept: the POST `decision=='approve'` is GUARANTEED by the body; the runtime gate that
// makes it DEFEASIBLE is `$compliant` (a directly-ingested premise the typed pre failed to capture). `cleaner`
// deposits the blame on retraction; `constat` config names the claim + the premise that fell.
const tree = { common: { childConcepts: {
	FastApprove: {
		_id: 'FastApprove', _name: 'FastApprove', require: ['score'],
		ensure: ['$score>=700', '$compliant'], provider: ['App::approve'],
		cleaner: ['Constat::record'], constat: { claimKey: 'decision', because: 'compliant' },
	},
} } };

Graph._providers = Object.assign({
	App: { approve( g, c, scope, argz, cb ) { cb(null, { $_id: '_parent', decision: 'approve', FastApprove: true }); } },
}, createConstat());

const cast = ( g, id, k ) => !!g._objById[id]._etty._mappedConcepts[k];
const fact = ( g, id, k ) => g._objById[id]._etty._[k];

// the full loop on the real engine.
async function unlearn() {
	const seed = { lastRev: 0, freeNodes: [{ _id: 'mem', lessons: [] }],
		nodes: [{ _id: 'app1', score: 720, region: 'EU', compliant: true }], segments: [] };
	const g = new Graph(seed, { label: 'unlearn', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
	await settle(g);

	// 1 — initial cast: the method applies, the post holds. assertPost (contract.js) confirms it on the realized facts.
	const before = { FastApprove: cast(g, 'app1', 'FastApprove'), decision: fact(g, 'app1', 'decision') };
	const postCheck = C.assertPost(FAST_APPROVE.contract, { decision: before.decision }, ['decision']);

	// 2 — drift: a compliance audit finds the EU approval non-compliant (a directly-ingested premise falls).
	await new Promise(( res ) => g.ingest({ app1: { compliant: false } }, res));
	await settle(g);
	const after = { FastApprove: cast(g, 'app1', 'FastApprove'), lessons: g._objById['mem']._etty._.lessons };

	// 3 — the library un-learns: read the blame + the case's discriminating fact → revise the contract's pre.
	const blame = (after.lessons || [])[0];
	const revised = C.reviseOnBlame(FAST_APPROVE.contract, { key: 'region', value: fact(g, 'app1', 'region') });

	// 4 — the revised contract excludes the failing kind, still admits the valid kind (surgical, not removal).
	const selection = {
		euExcluded: !C.satisfies(revised.pre, { score: 720, region: 'EU' }),
		usAdmitted: C.satisfies(revised.pre, { score: 720, region: 'US' }),
		origAdmittedBoth: C.satisfies(FAST_APPROVE.contract.pre, { score: 720, region: 'EU' }) && C.satisfies(FAST_APPROVE.contract.pre, { score: 720, region: 'US' }),
	};
	return { before, postCheck, after, blame, revisedPre: revised.pre, selection };
}

module.exports = { FAST_APPROVE, tree, unlearn };

if ( require.main === module ) {
	unlearn().then(( r ) => {
		console.log('[1 cast]    FastApprove belief=%s decision=%s  (assertPost post-holds: %s)', r.before.FastApprove, r.before.decision, r.postCheck.ok);
		console.log('[2 drift]   after ingest(compliant=false): FastApprove belief=%s  (UN-LEARNED via JTMS — the cast is withdrawn)', r.after.FastApprove);
		console.log('[2 blame]   constat: %s', JSON.stringify(r.blame));
		console.log('[3 revise]  pre %j → %j', FAST_APPROVE.contract.pre, r.revisedPre);
		console.log('[4 learned] EU now excluded=%s · US still admitted=%s (orig admitted both=%s)', r.selection.euExcluded, r.selection.usAdmitted, r.selection.origAdmittedBoth);
	}).catch(( e ) => { console.error(e); process.exit(1); });
}
