'use strict';
/*
 * mechanics.js — Probe #1 (réutilisation paramétrique) : les mécaniques du mount-par-params, ZERO-CORE,
 * composées sur l'existant (étude §7 + passe Laurie ../../sota/2026-07-03-parametric-reuse-probe-laurie.md).
 *
 * La chaîne : des épisodes typed-loop à params DISJOINTS (Laurie 4) crystallisent en un-template-par-sig ;
 * `methodContentHoles` (la LGG) découvre les TROUS de contenu = les SLOTS (« sous-qualifié = abstrait = un
 * slot ») ; `slotBindings` lit le rôle typé de chaque trou (kind + stepIndex du segment propriétaire) ;
 * `mountParametric` remplit les trous depuis les params typés de l'intake (`fillContentHoles`, fail-closed) et
 * monte en UNE mutation (`mountTemplate` create-mode — la ZERO-FIRE discipline) ; un param manquant →
 * `{ status:'impracticable', hint:[{role,key,stepKind}] }` — le hint typé, JAMAIS un mount partiel ni un
 * provider re-fire (Laurie 5/8a).
 */
const { crystallizeStructural } = require('../../../../plugins/learning/lib/crystallize.js');
const { methodContentHoles } = require('../../../../plugins/learning/lib/adapt.js');
const { typedLoopConceptTree, TYPED_PROSE_KEYS } = require('../../../../lib/authoring/core/typed-loop.js');
// slotBindings + mountParametric were PROMOTED to the lib (plugins/learning/lib/parametric.js, 2026-07-03 cont.¹⁰,
// after three experiment reuses) — this file keeps the experiment-specific seeding and re-exports the brick.
const { slotBindings, mountParametric } = require('../../../../plugins/learning/lib/parametric.js');

/** The frame-DECLARED concept tree (Laurie 8: library/human never formed a RUN-8 composite — the frame cannot
 *  be crystallized from their traces; it is declared): Expand also requires the frame's param keys, so the
 *  premise CAPTURES their values (per-combo signatures → per-combo templates → the LGG holes them). */
function paramLoopConceptTree( paramKeys, opts ) {
	const t = typedLoopConceptTree(opts);
	const ex = t.childConcepts.Task.childConcepts.Expand;
	ex.require = ex.require.concat(paramKeys);
	return t;
}

/** Seed a parameterized method from param-DISJOINT episodes. Returns { candidate, gen:{skeleton,contentVars} }. */
async function seedMethod( opts ) {
	const res = await crystallizeStructural({
		episodeTree: paramLoopConceptTree(opts.paramKeys),
		seed: opts.seed, providers: opts.providers,
		equivKeys: ['Expand'], proseKeys: TYPED_PROSE_KEYS, all: true,
		idFor: ( m ) => 'Crystal_' + (((m.instances[0] || {}).premise || {}).stepKind || m.concept),
		declaredFrontier: { origin: { field: 'originNode' }, target: { field: 'targetNode' } },
	});
	if ( !res.admitted ) return { error: res.reason, res };
	const candidate = (res.candidates || [{ candidate: res.candidate }])
		.map(( c ) => c.candidate).filter(Boolean)
		.find(( c ) => Object.keys(c.templatesBySig || {}).length >= 2) || res.candidate;
	const gen = methodContentHoles(candidate);
	return { candidate, gen, res };
}

module.exports = { paramLoopConceptTree, seedMethod, slotBindings, mountParametric };
