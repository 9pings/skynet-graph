'use strict';
/**
 * §6.2 INTERFACE-ONLY DISPATCH — the first flex layer (spec §3.4/§6.2, refined by the 2026-06-30 Laurie confront).
 *
 * Today `library.js#dispatch` filters `appConditions` EXACTLY: a structurally-matching in-bucket method whose one
 * value-discriminating NAC fails at a site is DROPPED → the controller forges from scratch, even though the dropped
 * method is a reusable SKELETON donor. §6.2 lifts `recall.js`'s FUZZY-RECALL→EXACT-VERIFY `partial` discipline into the
 * dispatch/appConditions space: a loosened dispatch SURFACES the NAC-failing in-bucket donors as ADAPT SKELETONS (never
 * replay candidates); the controller re-forges the differing content into a NEW method with SITE-DERIVED appConditions;
 * the EXACT verify gates THAT method's OWN `appConditionsHold` + contract — so §6.2 is as sound as a fresh forge.
 *
 * The four soundness lines (each a discriminating NEG control):
 *   pt1  the donor's NAC is NEVER replayed verbatim — a candidate whose OWN appConditions fail the site is REJECTED.
 *   pt2  `require` re-asserts by PRESENCE (`appConditionsHold`), never `satisfies` truthiness (disagree on present-falsy).
 *   pt3  proposals ranked fewest-NACs-dropped first; a rejected adapt is NOT indexed (no bucket bloat → O(1) preserved).
 *   pt4  `libraryKey` (the structural interface) is NEVER widened — proposals come only from the EXACT bucket.
 * ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { libraryKey } = require('../../lib/authoring/learning/crystallize.js');
const { makeLibrary, indexMethod, dispatch, dispatchInterface, appConditionsHold } = require('../../lib/authoring/learning/library.js');
const { adaptOrForge } = require('../../lib/authoring/learning/adapt.js');
const { satisfies } = require('../../lib/authoring/core/contract.js');
const { digest } = require('../../lib/providers/canonicalize.js');
console.log = console.info = console.warn = () => {};

const ENDPOINTS = [{ name: 'origin', role: 'endpoint', sort: 'node-ref' }, { name: 'target', role: 'endpoint', sort: 'node-ref' }];
const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( facts && k in facts ) o[k] = facts[k]; return o; };
const PURE = { read: [], write: ['Split'], pre: [], post: ['$Split==true'], effect: 'pure' };

// a library method with a value-discriminating appCondition (its NAC) + a replay template for its signature class.
function mkMethod( id, signatureKeys, appConditions, params ) {
	const frontier = { params: params || ENDPOINTS, summaryFacts: [], appConditions: appConditions || { require: [], assert: [] }, summary: { facts: [] } };
	const key = libraryKey(frontier, signatureKeys);
	const tplSig = digest(projectFacts({ Segment: true }, signatureKeys));
	return { schema: { _id: id, _name: id, frontier, libraryKey: key, contract: PURE }, frontier, libraryKey: key, signatureKeys,
		templatesBySig: { [tplSig]: [{ $_id: '_parent', Split: true }] } };
}
const TARGET = { frontier: { params: ENDPOINTS }, signatureKeys: ['Segment'] };

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('pt4/B — loosened dispatch surfaces in-bucket NAC-failing donors as proposals; exact dispatch drops them (the gap)', () => {
	const eu = mkMethod('SplitEU', ['Segment'], { require: ['Segment'], assert: ["$region=='EU'"] });
	const us = mkMethod('SplitUS', ['Segment'], { require: ['Segment'], assert: ["$region=='US'"] });
	assert.equal(eu.libraryKey, us.libraryKey, 'same interface → same bucket (appConditions are NOT in the libraryKey)');
	const lib = makeLibrary(); indexMethod(lib, eu); indexMethod(lib, us);
	const site = { Segment: true, region: 'JP' };

	// today: both NACs fail at JP → exact dispatch is empty (forced fresh forge — the §6.2 gap).
	assert.deepEqual(dispatch(lib, TARGET, site).candidates, [], 'exact dispatch drops both → empty (the gap)');

	const di = dispatchInterface(lib, TARGET, site);
	assert.equal(di.exact.length, 0, 'no exact match at the JP site');
	assert.equal(di.proposals.length, 2, 'the two in-bucket donors are surfaced as adapt skeletons');
	assert.ok(di.proposals.every(( p ) => p.droppedNACs.assert.length === 1), 'each proposal annotates the dropped region NAC');
	// pt4 — libraryKey NEVER widened: every proposal is from the EXACT bucket.
	assert.ok(di.proposals.every(( p ) => p.candidate.libraryKey === di.key), 'proposals come only from the exact libraryKey bucket');
	assert.equal(di.scanned, 2, 'touched only the bucket (the O(1) lookup, not a corpus scan)');
});

test('pt4 NEG — a structurally-different method (different libraryKey) is NEVER proposed, whatever the appCondition overlap', () => {
	const inBucket = mkMethod('InBucket', ['Segment'], { require: ['Segment'], assert: ["$region=='EU'"] });
	// a DIFFERENT bucket: extra endpoint param → different role:sort multiset → different libraryKey.
	const other = mkMethod('OtherShape', ['Segment'], { require: ['Segment'], assert: ["$region=='EU'"] }, ENDPOINTS.concat([{ name: 'c', role: 'endpoint', sort: 'node-ref' }]));
	assert.notEqual(inBucket.libraryKey, other.libraryKey, 'different structural interface → different bucket');
	const lib = makeLibrary(); indexMethod(lib, inBucket); indexMethod(lib, other);
	const di = dispatchInterface(lib, TARGET, { Segment: true, region: 'JP' });
	assert.deepEqual(di.proposals.map(( p ) => p.candidate.schema._id), ['InBucket'], 'only the SAME-bucket donor is proposed — the structural key is never blurred');
});

test('pt2 — `require` re-asserts by PRESENCE (appConditionsHold), not `satisfies` truthiness (disagree on present-falsy)', () => {
	const cnt = mkMethod('Counted', ['Segment'], { require: ['Segment', 'count'], assert: [] });
	const lib = makeLibrary(); indexMethod(lib, cnt);
	const site = { Segment: true, count: 0 };                         // count present but FALSY
	const di = dispatchInterface(lib, TARGET, site);
	assert.equal(di.exact.length, 1, 'a present-but-falsy require key is PRESENT → exact (engine present-not-truthy, finding #32)');
	assert.equal(di.proposals.length, 0, 'no NAC dropped → not a proposal');
	// the documented trap (why §6.2 must use appConditionsHold, never satisfies, for the require half):
	assert.notEqual(appConditionsHold(cnt.frontier, site), satisfies(['count'], site),
		'appConditionsHold(presence) and satisfies(truthiness) DISAGREE on present-falsy — routing require through satisfies would silently de-amortize');
});

test('pt3 — proposals ranked fewest-NACs-dropped first (version-space specificity), top-k', () => {
	const one = mkMethod('OneDrop', ['Segment'], { require: ['Segment'], assert: ["$region=='EU'"] });            // JP: 1 dropped (region)
	const two = mkMethod('TwoDrop', ['Segment'], { require: ['Segment', 'extra'], assert: ["$region=='US'"] });    // JP: 2 dropped (extra absent + region)
	assert.equal(one.libraryKey, two.libraryKey, 'same bucket (appConditions/require differences are not in the key)');
	const lib = makeLibrary(); indexMethod(lib, two); indexMethod(lib, one);                                       // insert worst-first
	const di = dispatchInterface(lib, TARGET, { Segment: true, region: 'JP' });
	assert.deepEqual(di.proposals.map(( p ) => p.candidate.schema._id), ['OneDrop', 'TwoDrop'], 'fewest NACs dropped ranks first (the least-adaptation climb)');
	assert.deepEqual(di.proposals.map(( p ) => p.dropCount), [1, 2]);
	// top-k bound
	assert.equal(dispatchInterface(lib, TARGET, { Segment: true, region: 'JP' }, { k: 1 }).proposals.length, 1, 'k bounds the proposal count');
});

// ── the controller: interface-recall reaches a donor → skeleton-reuse adapt → exact verify → amortise ───────────
function jpAdaptForge( calls ) {
	// PROPER adapt: reuse the donor skeleton, re-derive the SITE's appConditions (region==<site>) + a sound contract.
	return ( scope, neighbours, donors ) => {
		calls.n++;
		const donor = donors && donors[0];
		if ( !donor ) return null;
		const sig = digest(projectFacts(scope, donor.signatureKeys));
		const frontier = Object.assign({}, donor.frontier, { appConditions: { require: ['Segment'], assert: ["$region=='" + scope.region + "'"] } });
		const cand = { schema: { _id: 'SplitJP', _name: 'SplitJP', frontier, libraryKey: donor.libraryKey, contract: PURE },
			frontier, libraryKey: donor.libraryKey, signatureKeys: donor.signatureKeys,
			templatesBySig: Object.assign({}, donor.templatesBySig, { [sig]: [{ $_id: '_parent', Split: true }] }) };
		return { candidate: cand, outcome: 'adapt', calls: 1 };
	};
}

test('C — interfaceRecall reaches an in-bucket donor → skeleton-reuse ADAPT (not fresh forge), then AMORTISES', () => {
	const eu = mkMethod('SplitEU', ['Segment'], { require: ['Segment'], assert: ["$region=='EU'"] });
	const us = mkMethod('SplitUS', ['Segment'], { require: ['Segment'], assert: ["$region=='US'"] });
	const lib = makeLibrary(); indexMethod(lib, eu); indexMethod(lib, us);
	const calls = { n: 0 };
	const r1 = adaptOrForge({ lib, target: TARGET, scopeFacts: { Segment: true, region: 'JP' }, forge: jpAdaptForge(calls), interfaceRecall: true });
	assert.equal(r1.outcome, 'adapt', 'reached an in-bucket donor → adapt (structural reuse), not a from-scratch forge');
	assert.equal(r1.calls, 1, 'one content-forge call (the skeleton was reused)');

	// AMORTISE — the JP-adapted method (its own region==JP appConditions) now exact-dispatches → a 2nd JP site HITS.
	const r2 = adaptOrForge({ lib, target: TARGET, scopeFacts: { Segment: true, region: 'JP' }, forge: jpAdaptForge(calls), interfaceRecall: true });
	assert.equal(r2.outcome, 'hit', 'the adapted method amortises → a hit');
	assert.equal(r2.calls, 0);
	assert.equal(calls.n, 1, 'the model was NOT invoked again');
});

test('pt1 NEG (load-bearing) — a donor REPLAYED VERBATIM fails its own NAC at the site → REJECTED, never mounted', () => {
	const eu = mkMethod('SplitEU', ['Segment'], { require: ['Segment'], assert: ["$region=='EU'"] });
	const lib = makeLibrary(); indexMethod(lib, eu);
	const before = lib.methods.length;
	const calls = { n: 0 };
	// the WRONG forge: returns the donor candidate VERBATIM (it still carries region=='EU') at the JP site.
	const replayForge = ( scope, neighbours, donors ) => { calls.n++; return { candidate: donors[0], outcome: 'adapt', calls: 1 }; };
	const r = adaptOrForge({ lib, target: TARGET, scopeFacts: { Segment: true, region: 'JP' }, forge: replayForge, interfaceRecall: true });
	assert.equal(r.outcome, 'reject', 'the donor’s region==EU NAC fails at the JP site → rejected (the donor is never replayed)');
	assert.match(r.reason, /appcondition|applicab/i);
	// pt3 — a rejected adapt is NOT indexed (no bucket bloat).
	assert.equal(lib.methods.length, before, 'a rejected adapt does not pollute the library (O(1) lookup invariant preserved)');
});

test('NEG control — interfaceRecall OFF: a NAC-failing donor is invisible → no adapt (today’s behaviour preserved)', () => {
	const eu = mkMethod('SplitEU', ['Segment'], { require: ['Segment'], assert: ["$region=='EU'"] });
	const lib = makeLibrary(); indexMethod(lib, eu);
	const calls = { n: 0 };
	// with interfaceRecall OFF and an empty exact neighbourhood, the donor-aware forge gets no donor → null → reject.
	const r = adaptOrForge({ lib, target: TARGET, scopeFacts: { Segment: true, region: 'JP' }, forge: jpAdaptForge(calls) });
	assert.equal(r.outcome, 'reject', 'without interfaceRecall the donor is not reachable (no behaviour change to the exact path)');
});
