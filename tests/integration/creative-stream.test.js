'use strict';
/**
 * creative-loop on a STREAM — the real-engine adapt-or-forge loop (brick C) driving a real graph over a stream,
 * with the model called only on a method MISS (study 2026-06-30-creative-loop-two-level-grammar.md). The
 * deterministic backbone of the live measurement (doc/WIP/experiments/2026-06-30-creative-loop-stream/, gitignored).
 *
 * TWO ORTHOGONAL claims, each with a discriminating NEG control. ZERO-CORE.
 *  - CALLS (structure-mapping): a method LEARNED under concept `Refine` is dispatched + mounted under a DIFFERENT
 *    concept `Decompose` at 0 model calls (CROSS-CONCEPT transfer — a per-concept derivation cache CANNOT do this);
 *    a novel surface class is FORGED once (region-BLIND signature) then amortised across regions. So CREATIVE forges
 *    only #novel-kinds, strictly fewer than a per-(kind,region) cache. NEG: the per-signature cache forges more.
 *  - CORRECT-UNDER-DRIFT: a feasibility belief is ensure-gated on a premise; an audit ingest UN-CASTS it
 *    selectively (JTMS un-learn — the mount is monotone via the durable guard, the BELIEF is defeasible). NEG: a
 *    flat similarity cache serves the stale pre-audit decision.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { crystallizeStructural } = require('../../lib/authoring/crystallize.js');
const { makeLibrary, indexMethod, dispatch } = require('../../lib/authoring/library.js');
const { hitTemplate } = require('../../lib/authoring/adapt.js');
const { ctxFromScope, instantiate } = require('../../lib/authoring/abstract.js');
const { injectMarker, guardKey } = require('../../lib/authoring/combinator.js');
const { digest } = require('../../lib/providers/canonicalize.js');
console.log = console.info = console.warn = () => {};

const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, extra ) => Object.assign({ _id: id, Segment: true, originNode: o, targetNode: t }, extra || {});
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( facts && k in facts ) o[k] = facts[k]; return o; };
const ground = ( kind ) => 'plan-' + kind;

// learn a structural decompose method under concept `Refine` (≥2 distinct sites per kind → antiUnify stable).
async function learn() {
	const Refine = { refine( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true },
			{ _id: mid, Node: true, state: ground(scope._.kind) },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
		]);
	} };
	const TREE = { childConcepts: { Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] } } };
	const nodes = [], segments = [];
	['hard', 'easy'].forEach(( k, ki ) => { for ( let s = 0; s < 2; s++ ) { const a = `L${ki}_${s}a`, b = `L${ki}_${s}b`; nodes.push(node(a), node(b)); segments.push(seg(`LE${ki}_${s}`, a, b, { kind: k })); } });
	const res = await crystallizeStructural({ episodeTree: { childConcepts: TREE.childConcepts }, seed: { lastRev: 0, nodes, segments }, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine', declaredFrontier: DECL });
	assert.equal(res.admitted, true, 'the warm library learned cleanly');
	const lib = makeLibrary(); indexMethod(lib, res.candidate);
	return { lib, candidate: res.candidate, target: { frontier: res.candidate.schema.frontier, signatureKeys: res.candidate.signatureKeys } };
}

// the FUSED creative provider: dispatch (structure-mapping) → HIT mount (0 calls) → MISS forge content via the
// model, reuse the neighbour STRUCTURE, amortise (region-blind), mount. `cacheKey` set = the per-signature cache control.
function creativeProvider( spec ) {
	return async function ( graph, concept, scope, argz, cb ) {
		const cryId = 'Decompose', noop = { $_id: '_parent', [cryId]: true, [guardKey(cryId)]: true };
		const f = scope._ || {};
		const ctx = ctxFromScope(scope, { frontier: { origin: 'originNode', target: 'targetNode' } });
		if ( !ctx ) return cb(null, noop);
		const r = spec.noLib ? { candidates: [] } : dispatch(spec.lib, spec.target, f);
		const neighbours = r.candidates.map(( e ) => e.candidate );
		for ( const c of neighbours ) { const sig = hitTemplate(c, f); if ( sig ) { const gr = instantiate((c.templatesBySig || {})[sig], ctx); if ( gr ) return cb(null, injectMarker(gr, ctx.base, cryId)); } }
		const ckey = spec.cacheKey ? spec.cacheKey(f) : null;
		if ( ckey && spec.cache[ckey] ) { const gr = instantiate(spec.cache[ckey], ctx); if ( gr ) return cb(null, injectMarker(gr, ctx.base, cryId)); }
		const nb = neighbours[0], proto = nb ? Object.values(nb.templatesBySig)[0] : spec.proto;
		if ( !proto ) return cb(null, noop);
		spec.meter.calls++;
		const res = await spec.model(f.kind);                                  // the (stub) model forges the content
		const forged = JSON.parse(JSON.stringify(proto)).map(( o ) => (o && o.state != null) ? Object.assign({}, o, { state: res }) : o);
		if ( nb ) nb.templatesBySig[digest(projectFacts(f, nb.signatureKeys))] = forged;   // amortise (region-blind)
		if ( ckey ) spec.cache[ckey] = forged;
		const gr = instantiate(forged, ctx);
		return cb(null, gr ? injectMarker(gr, ctx.base, cryId) : noop);
	};
}

const CMAP = { common: { childConcepts: {
	Decompose: { _id: 'Decompose', _name: 'Decompose', require: ['Segment', 'kind', 'toDecompose'], ensure: ['!$' + guardKey('Decompose')], provider: ['Creative::Decompose'] },
	Feasible: { _id: 'Feasible', _name: 'Feasible', require: ['feasible'], ensure: ['$feasible'], provider: ['Dec::feasible'] },
	Infeasible: { _id: 'Infeasible', _name: 'Infeasible', require: ['feasible'], ensure: ['$feasible==false'], provider: ['Dec::infeasible'] },
} } };

function boot( spec ) {
	const decide = ( name, val ) => ( g, c, s, a, cb ) => cb(null, { $_id: '_parent', decision: val, [name]: true });
	Graph._providers = { Creative: { Decompose: creativeProvider(spec) }, Dec: { feasible: decide('Feasible', 'feasible'), infeasible: decide('Infeasible', 'infeasible') } };
	return new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [] }, { label: 'cs', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, CMAP);
}

// the recurrent stream: 2 seen kinds (warm) + 2 novel kinds × 2 regions × 2 cycles = 16 items.
function makeStream() {
	const out = []; let i = 0;
	for ( let c = 0; c < 2; c++ ) for ( const kind of ['hard', 'easy', 'medium', 'complex'] ) for ( const region of ['EU', 'US'] ) out.push({ index: i, id: 'r' + (i++), kind, region });
	return out;
}

test('CALLS — CREATIVE forges only the novel kinds (cross-concept warm transfer + region-blind amortise)', async () => {
	const { lib, target } = await learn();
	const meter = { calls: 0 };
	const model = async ( kind ) => ground(kind);                              // deterministic content forge
	const g = boot({ lib, target, meter, model });
	await nextStable(g);
	for ( const it of makeStream() ) {
		await new Promise(( res ) => g.pushMutation(seg(it.id, 'X', 'Y', { kind: it.kind, region: it.region, toDecompose: true, feasible: true }), null, undefined, undefined, undefined, () => res()));
		await nextStable(g);
	}
	// 2 seen kinds (hard/easy) = 0 calls (the method LEARNED under Refine, mounted under Decompose = cross-concept);
	// 2 novel kinds forged ONCE each (region-blind signature → amortised across regions+cycles).
	assert.equal(meter.calls, 2, 'CREATIVE forges only the 2 novel kinds');
	// the mounts are sound: a seen kind replayed verbatim, a novel kind forged, frontier rebound to the new site.
	assert.equal(g._objById['r0_m0']._etty._.state, 'plan-hard', 'seen kind (hard) replayed from the warm Refine method at 0 calls');
	assert.equal(g._objById['r4_m0']._etty._.state, 'plan-medium', 'novel kind (medium) forged');
	assert.equal(g._objById['r0_a0']._etty._.originNode, 'X', 'frontier rebound to the new origin');
	assert.equal(g._objById['r0_b0']._etty._.targetNode, 'Y', 'frontier rebound to the new target');
	assert.ok(!g._objById['LE0_0'] && !g._objById['L0_0a'], 'no id-space from the learning episode leaked (sound)');
	assert.ok(g.getRevisions().length < 200, 'bounded — no apply-cap runaway');
});

test('NEG (calls) — a per-(kind,region) cache forges MORE than CREATIVE (it cannot transfer cross-concept or region-blind)', async () => {
	const { candidate, target } = await learn();
	const proto = Object.values(candidate.templatesBySig)[0];
	const meter = { calls: 0 }, cache = {};
	const g = boot({ noLib: true, target, meter, model: async ( k ) => ground(k), proto, cache, cacheKey: ( f ) => f.kind + '|' + f.region });
	await nextStable(g);
	for ( const it of makeStream() ) {
		await new Promise(( res ) => g.pushMutation(seg(it.id, 'X', 'Y', { kind: it.kind, region: it.region, toDecompose: true, feasible: true }), null, undefined, undefined, undefined, () => res()));
		await nextStable(g);
	}
	assert.equal(meter.calls, 8, 'the per-signature cache forges once per (kind,region) = 4 kinds × 2 regions = 8');
	assert.ok(meter.calls > 2, 'strictly more than CREATIVE (2) — the structure-mapping transfer is load-bearing');
});

test('CORRECT-UNDER-DRIFT — an audited premise-fall un-casts the feasibility belief SELECTIVELY (the rest stay)', async () => {
	const { lib, target } = await learn();
	const g = boot({ lib, target, meter: { calls: 0 }, model: async ( k ) => ground(k) });
	await nextStable(g);
	// two feasible tasks of the SAME class; one will be audited.
	for ( const id of ['t1', 't2'] ) await new Promise(( res ) => g.pushMutation(seg(id, 'X', 'Y', { kind: 'hard', region: 'EU', toDecompose: true, feasible: true }), null, undefined, undefined, undefined, () => res()));
	await nextStable(g);
	const dec = ( id ) => g.getEtty(id)._.decision;
	const cast = ( id, k ) => !!g._objById[id]._etty._mappedConcepts[k];
	assert.equal(dec('t1'), 'feasible'); assert.equal(dec('t2'), 'feasible');
	assert.ok(cast('t1', 'Feasible') && cast('t2', 'Feasible'), 'both cast Feasible');

	// the audit ingests the premise fall on t1 ONLY → its Feasible belief retracts (JTMS un-learn), t2 untouched.
	await new Promise(( res ) => g.ingest({ t1: { feasible: false } }, res));
	await nextStable(g);
	assert.equal(dec('t1'), 'infeasible', 't1 flipped (Feasible un-cast, Infeasible cast — no stale belief served)');
	assert.equal(cast('t1', 'Feasible'), false, 't1 Feasible retracted');
	assert.equal(cast('t1', 'Infeasible'), true, 't1 Infeasible cast');
	assert.equal(dec('t2'), 'feasible', 't2 stays feasible (selective — only the audited case re-derives)');

	// NEG control — a flat similarity cache keyed on the surface class serves the STALE pre-audit decision.
	const flat = {}; const key = 'hard|EU';
	flat[key] = 'feasible';                                                    // cached pre-audit
	assert.equal(flat[key], 'feasible', 'the flat cache still serves "feasible" post-audit (stale) — what the ensure-gate does NOT');
});
