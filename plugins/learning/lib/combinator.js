/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * combinator — the dispatch→MOUNT bridge (P2.5; host-side, ZERO-CORE; study
 * docs/WIP/studies/2026-06-30-creative-loop-two-level-grammar.md, brick B).
 *
 * Brick A (`library.js`) SELECTS a learned method for an abstract mechanism (an O(1) `libraryKey` lookup refined by
 * application-conditions = structure-mapping). Brick B MOUNTS it: a higher-order method = a CONCEPT whose `require`
 * is its behavioral hole; when the hole's fragment co-occurs justified at a site, the concept casts and its provider
 * binds the DISPATCHED fragment's template to the call site and splices it — at 0 model calls. The hole is filled by
 * the library method whose FrontierSignature the structuring grammar's target dispatched to, so a concept can REUSE
 * another concept's learned method purely because their abstract interfaces match (recombination = the creative step).
 *
 * Engine landmines respected (mirrors crystallize.js#buildStructuralProvider): the returned template MUST self-flag
 * the cast (provider-cast-marker gotcha, else re-fire to the apply-cap), an unbound frontier ref BYPASSES (never a
 * wrong replay), and the splice rides the SEQUENCED cb (determinism). The interface alphabet must align: the
 * combinator's frontier param NAMES must equal the fragment's hole names (the snapped separator).
 */
const { dispatch } = require('./library.js');
const { ctxFromScope, instantiate } = require('../../../lib/authoring/core/abstract.js');
const { digest } = require('../../../lib/providers/canonicalize.js');

// the call-site facts projected onto a fragment's replay signature (mirrors crystallize.js#projectFacts).
const projectFacts = ( facts, keys ) => { const o = {}; for ( const k of (keys || []) ) if ( facts && k in facts ) o[k] = facts[k]; return o; };

// the re-fire GUARD fact a combinator gates on — a DISTINCT durable mutation fact, NOT the concept's own `_name`
// marker. Gating on the self-flag does not stop re-application (finding #27 "self-flag not durable" — verified: the
// concept-name marker set by a provider does not gate the same concept's `ensure`; the crystallizer gates on the
// fragment's `Refined`, not `!$CrystalRefine`). So we mint `<cryId>Done`.
const guardKey = ( cryId ) => cryId + 'Done';

// add the combinator's cast marker AND its durable re-fire guard to the mounted parent object (mirrors
// crystallize.js#injectCastMarker, plus the separate guard so the concept de-applies after one mount).
function injectMarker( ground, base, cryId ) {
	return (Array.isArray(ground) ? ground : [ground]).map(( o ) => {
		if ( !o || typeof o !== 'object' ) return o;
		const idv = String(o.$$_id != null ? o.$$_id : (o.$_id != null ? o.$_id : o._id)).replace(/^\$+/, '');
		return (o.$_id === '_parent' || idv === base) ? Object.assign({}, o, { [cryId]: true, [guardKey(cryId)]: true }) : o;
	});
}

/**
 * A provider that DISPATCHES a library fragment for the call site, then MOUNTS it bound to the site (0 model calls).
 * @param spec.lib            the method library (`library.js`).
 * @param spec.cryId          the combinator's cast-marker / concept name.
 * @param spec.target         { frontier, signatureKeys } — the abstract mechanism this combinator wants (the target
 *                            FrontierSignature the structuring grammar describes). May be a fn (scope)->target.
 * @param spec.frontierFields { name: factKey|"ref:path" } — where each frontier endpoint lives on the cast object (its
 *                            names MUST equal the dispatched fragment's hole names).
 * @param spec.pick           optional (candidates, scope)->candidate (default = top by weight; the supervisor's choice).
 */
function buildDispatchProvider( spec ) {
	return function ( graph, concept, scope, argz, cb ) {
		const noop = { $_id: '_parent', [spec.cryId]: true, [guardKey(spec.cryId)]: true };   // bypass: marker + guard (no re-fire)
		const target = typeof spec.target === 'function' ? spec.target(scope) : spec.target;
		const r = dispatch(spec.lib, target, scope._ || {});
		const top = spec.pick ? spec.pick(r.candidates, scope) : r.candidates[0];
		if ( !top ) return cb(null, noop);                             // the structuring grammar must forge (no library hit)
		const cand = top.candidate;
		const ctx = ctxFromScope(scope, { frontier: spec.frontierFields });
		if ( !ctx ) return cb(null, noop);                             // unknown base → bypass
		const tpl = (cand.templatesBySig || {})[digest(projectFacts(scope._ || {}, cand.signatureKeys || []))];
		if ( !tpl ) return cb(null, noop);                             // the dispatched method has no template for this signature class
		const ground = instantiate(tpl, ctx);
		if ( !ground ) return cb(null, noop);                          // an unbound frontier ref → bypass
		return cb(null, injectMarker(ground, ctx.base, spec.cryId));   // mount the dispatched fragment, self-flagged
	};
}

/**
 * Build a higher-order combinator CONCEPT that mounts a dispatched library fragment via require-resolution. The
 * concept casts when its `require` markers co-occur (the fragment is justified-present); its provider dispatches +
 * mounts. Mirrors `method.js#selectCluster` / `relearn.js#relearnTree` (concept + provider, host-wired).
 * @returns { schema, provider, providerName }  — register the provider and drop the schema into a concept tree.
 */
function dispatchConcept( opts ) {
	const cryId = opts.name;
	const provider = buildDispatchProvider({ lib: opts.lib, cryId, target: opts.target, frontierFields: opts.frontierFields, pick: opts.pick });
	const providerName = 'Combinator::' + cryId;
	// gate on the DURABLE guard fact `<cryId>Done` (set by the mount/bypass), NOT the self-flag `!$<cryId>` (which does
	// not stop re-application — finding #27). require + this ensure = the higher-order require-resolution trigger.
	const schema = { _id: cryId, _name: cryId, require: (opts.require || []).slice(), ensure: ['!$' + guardKey(cryId)], provider: [providerName] };
	if ( opts.assert ) schema.assert = Array.isArray(opts.assert) ? opts.assert.slice() : [opts.assert];
	return { schema, provider, providerName };
}

module.exports = { buildDispatchProvider, dispatchConcept, injectMarker, guardKey };
