'use strict';
/**
 * §6.2 DONOR-SKELETON TOKEN-WIN live-measure BACKBONE (deterministic fence; the gitignored live arm is
 * doc/WIP/experiments/2026-07-01-flex-live-measures/measure-donor-token-win.js). The §6.2 interface-only dispatch
 * surfaces a NAC-failing in-bucket donor as an ADAPT SKELETON; the controller re-forges ONLY the differing CONTENT,
 * reusing the donor's STRUCTURE. The flex-layers LOG deferred the token win as "measurable only with a real-model
 * structural forge that reuses a donor skeleton" — the live measure (qwen3-8b, temp 0) found FRESH=125 completion
 * tokens vs REUSE=22 (5.68× fewer generated tokens) at a JP site, with the §6.2 gate holding.
 *
 * The dispatch/gate mechanism itself is already fenced by `interface-dispatch.test.js` (7 tests). This backbone fences
 * the NEW claim — the TOKEN WIN direction — deterministically: the content-only forge TARGET (the 3-value diff) is
 * strictly smaller than the whole-method forge TARGET (the 4-object structural template) by a structural atom proxy,
 * reproducing the live 5.68× direction, while the REAL `dispatchInterface` confirms the donor is surfaced at the site.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { libraryKey } = require('../../lib/authoring/crystallize.js');
const { makeLibrary, indexMethod, dispatch, dispatchInterface } = require('../../lib/authoring/library.js');
const { digest } = require('../../lib/providers/canonicalize.js');

const ENDPOINTS = [{ name: 'origin', role: 'endpoint', sort: 'node-ref' }, { name: 'target', role: 'endpoint', sort: 'node-ref' }];
const PURE = { read: [], write: ['Split'], pre: [], post: ['$Split==true'], effect: 'pure' };
const CONTENT_KEYS = ['customsForm', 'hub', 'carrier'];
const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( facts && k in facts ) o[k] = facts[k]; return o; };

// the donor: a cross-border shipping decomposition — a NON-TRIVIAL 4-object structural body, 3 content leaves.
function euTemplate( content ) {
	return [
		{ $_id: '_parent', Split: true, mode: 'cross-border-ship' },
		{ $_id: 'BASE_customs',  originNode: '_parent:originNode', targetNode: 'BASE_hubIn',  role: 'customs',     customsForm: content.customsForm },
		{ $_id: 'BASE_hub',      originNode: 'BASE_hubIn',         targetNode: 'BASE_hubOut',  role: 'hub-routing', hub: content.hub },
		{ $_id: 'BASE_lastmile', originNode: 'BASE_hubOut',        targetNode: '_parent:targetNode', role: 'last-mile', carrier: content.carrier },
	];
}
function mkShipMethod( id, region, content ) {
	const frontier = { params: ENDPOINTS, summaryFacts: [], appConditions: { require: ['Segment'], assert: ["$region=='" + region + "'"] }, summary: { facts: [] } };
	const key = libraryKey(frontier, ['Segment']);
	const sig = digest(projectFacts({ Segment: true }, ['Segment']));
	return { schema: { _id: id, _name: id, frontier, libraryKey: key, contract: PURE }, frontier, libraryKey: key, signatureKeys: ['Segment'], templatesBySig: { [sig]: euTemplate(content) } };
}
// a structural token proxy = the count of keys + primitive values (an under-estimate of real JSON tokens, monotone in size).
function atoms( x ) {
	if ( Array.isArray(x) ) return x.reduce(( n, e ) => n + atoms(e), 0);
	if ( x && typeof x === 'object' ) return Object.keys(x).reduce(( n, k ) => n + 1 + atoms(x[k]), 0);
	return 1;
}
const TARGET = { frontier: { params: ENDPOINTS }, signatureKeys: ['Segment'] };

test('§6.2 backbone: dispatchInterface surfaces the NAC-failing donor at the JP site (exact dispatch drops it)', () => {
	const eu = mkShipMethod('ShipEU', 'EU', { customsForm: 'CN22', hub: 'Leipzig', carrier: 'DHL' });
	const us = mkShipMethod('ShipUS', 'US', { customsForm: 'CBP7501', hub: 'Memphis', carrier: 'FedEx' });
	const lib = makeLibrary(); indexMethod(lib, eu); indexMethod(lib, us);
	const site = { Segment: true, region: 'JP' };
	assert.deepEqual(dispatch(lib, TARGET, site).candidates, [], 'exact dispatch drops both (region NAC fails) — the §6.2 gap');
	const di = dispatchInterface(lib, TARGET, site);
	assert.equal(di.proposals.length, 2, 'the loosened dispatch surfaces both in-bucket donors as skeletons');
	assert.ok(di.proposals.every(( p ) => p.candidate.libraryKey === di.key ), 'proposals come only from the exact structural bucket (never widened)');
});

test('§6.2 backbone: the content-only forge TARGET ≪ the whole-method forge TARGET (the token-win direction, live 5.68×)', () => {
	const euTpl = euTemplate({ customsForm: 'CN22', hub: 'Leipzig', carrier: 'DHL' });
	const wholeMethodTarget = euTpl;                                   // FRESH forge must emit the WHOLE structural template
	const contentDiffTarget = { customsForm: 'J11', hub: 'Osaka', carrier: 'Yamato Transport' };   // REUSE forge emits ONLY the diff
	const aFresh = atoms(wholeMethodTarget), aReuse = atoms(contentDiffTarget);
	assert.ok(aReuse < aFresh, 'the content diff is strictly smaller than the whole template');
	assert.ok(aFresh >= 3 * aReuse, 'and by a large factor (structure reused, not re-emitted) — the live measure saw 125→22 completion tokens (5.68×), same direction');
	// the reused structure IS the expensive part: the 4-object wiring/roles/nesting the fresh forge must generate and the reuse forge does not.
	assert.equal(wholeMethodTarget.length, 4, 'the donor skeleton is a non-trivial 4-object body');
	assert.equal(Object.keys(contentDiffTarget).length, 3, 'the re-forged content is 3 leaves');
});
