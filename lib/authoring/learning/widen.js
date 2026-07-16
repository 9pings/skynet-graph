/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * widen — the STANDING / autonomous WIDEN loop (the S-boundary CLIMB; host-side, ZERO-CORE). The reactive SIBLING of
 * `relearn.js` (the narrow loop): where blame → `reviseOnBlame` → patch NARROWS a method on a retraction, ≥k verified
 * positives → `widenOnVerified` → patch WIDENS it — candidate elimination's two boundaries, both engine-driven.
 *
 * Mirrors `relearn.js#{relearnTree, makeRelearnProviders}`:
 *   - the upstream guarded-speculative-admit / sibling-merge signal `{__push}`es a verified positive `{value, methodId}`
 *     onto the method's library node `lib:<Method>` and, at ≥k, deposits a discrete `widenReady` fact (a clean `require`
 *     trigger — #22-safe, keyed on a fact APPEARING, not a value change), exactly as blame deposits `blamed`;
 *   - a `Widen` meta-concept (`require:['widenReady'], ensure:['!$widened']`) fires;
 *   - `Lib::widen` runs `widenOnVerified` (additive enum-union, methodId-gated, `!=`-nogood preserving) AND patches the
 *     engine gate to match — with the G2 ORDERING the §6.4 confront fixed: `recordWiden` DEMOTES FROZEN→INSTANCE
 *     SYNCHRONOUSLY *before* the gate-relax `patchConcept` (which is queued to the quiescent #11.a boundary → lands
 *     strictly after), so the relaxed gate never admits a newly-widened case under a frozen, assertPost-eliding regime.
 *
 * Wiring (symmetric to contract-relearn.js):
 *   const { makeWidenProviders, widenTree } = require('../learning/widen.js');
 *   Graph._providers = Object.assign({ App:{serve} }, makeWidenProviders({ registry, mount }));
 *   // tree: the over-specific method + widenTree(); seed a `lib:<Method>` node with { method, discriminator, positives, widenReady }.
 */
const { widenOnVerified } = require('../core/contract.js');

/**
 * The reactive widen flow as a concept tree. One meta-concept:
 *   widenReady ──require──▶ Widen (ensure !widened) ──▶ Lib::widen widens the library contract + the gate.
 * @param opts.name  the meta-concept id/_name (default 'Widen')
 */
function widenTree( opts ) {
	opts = opts || {};
	var name = opts.name || 'Widen';
	var def  = { _id: name, _name: name, require: ['widenReady'], ensure: ['!$widened'], provider: ['Lib::widen'] };
	var tree = { childConcepts: {} };
	tree.childConcepts[name] = def;
	return tree;
}

/**
 * The Lib widen provider (host opt-in, like makeRelearnProviders).
 * @param opts.registry  { <Method>: contract } — the library's typed contracts; widen mutates the entry to the new
 *                       (versioned) contract. Pass copies for B8.
 * @param opts.mount     optional mount controller (`mount.js`) — `recordWiden` demotes FROZEN→INSTANCE + spends the
 *                       megamorphic WIDTH budget (NOT μ). Called BEFORE the gate patch (the G2 ordering).
 * @returns { Lib: { widen } }
 */
function makeWidenProviders( opts ) {
	opts = opts || {};
	var registry = opts.registry || {};
	var mount    = opts.mount;

	return { Lib: {
		// the standing widen: read the accumulated positives → widen the library contract + the engine gate, autonomously.
		widen: function ( graph, concept, scope, argz, cb ) {
			var e         = (scope && scope._) || {};
			var M         = e.method;
			var positives = e.positives || [];
			var target    = graph.getConceptByName(M);

			// 1 — the contract to widen: the registry entry, else seed from the live gate.
			var contract = registry[M] || { read: e.discriminator ? [e.discriminator] : [], pre: (target && target._schema && target._schema.ensure || []).slice(), effect: 'pure' };
			var out = widenOnVerified(contract, positives, { discriminator: e.discriminator, target: M, siblings: e.siblings, numeric: e.numeric });
			if ( registry[M] != null ) registry[M] = out.contract;

			// 2 — the G2 ORDERING (Laurie confront pt3): demote FROZEN→INSTANCE SYNCHRONOUSLY, BEFORE the gate-relax
			//     patchConcept (which the engine queues to the quiescent #11.a boundary → strictly after). So a
			//     newly-admitted case can never apply under a frozen, assertPost-eliding regime.
			var demoted = (mount && mount.recordWiden) ? mount.recordWiden(M) : null;

			// 3 — widen the engine gate to match. Concept.patch REPLACES arrays → pass the FULL ensure (queued, #11.a).
			graph.patchConcept(M, { ensure: out.ensure });

			// 4 — own cast marker (#33) + `widened` re-fire guard; record the widened pre on lib:<Method> (typed atoms,
			//     not prose) so rollbackTo (N6) restores both the concept and the recorded pre coherently.
			cb(null, { $_id: '_parent', Widen: true, widened: true,
				widenedEnsure: out.ensure, widenedPre: out.contract && out.contract.pre,
				demotedFrom: demoted && demoted.demotedFrom, widenCount: demoted && demoted.widenCount,
				rejected: out.rejected && out.rejected.length ? out.rejected.length : 0, clamped: out.clamped });
		}
	} };
}

module.exports = { makeWidenProviders: makeWidenProviders, widenTree: widenTree };
