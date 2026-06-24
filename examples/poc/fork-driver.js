'use strict';
/**
 * PoC M3 — the host FORK-CREATION DRIVER (the roadmap's one real architectural gap:
 * `forkPlan` DERIVES a tiling, but nothing ACTS on it — fork/merge are manual API calls).
 *
 * The driver turns a tile + a sub-problem into a real fork/merge, and makes the frontier
 * a CHECKED assume-guarantee contract AT RUNTIME: it forks a child sub-graph (e.g. a
 * C-regime solver), stabilizes it, and merges back ONLY the declared frontier alphabet —
 * validated by `validateMergeProjection`, so an internal fact (the solver's search `steps`)
 * cannot leak across the boundary. The barrier is enforced, not merely derivable.
 *
 * Host policy, NOT core. Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md (M2/M3).
 */
const { validateMergeProjection } = require('../../lib/authoring/validate');

// Wrap a projection so its output template is CHECKED against the frontier alphabet
// (the keys permitted to cross a sub-graph boundary) before it crosses. Throws on a leak.
function checkedProjection( projectFn, frontierAlphabet ) {
	return function ( child ) {
		const tpl = projectFn(child);
		const { warnings } = validateMergeProjection(tpl, { frontierAlphabet, flagContinuous: true });
		const leaks = warnings.filter(( w ) => w.kind === 'frontier-leak');
		if ( leaks.length )
			throw new Error('frontier-leak: [' + leaks.map(( w ) => w.ref).join(',') +
				'] would cross a sub-graph boundary outside the declared frontier alphabet [' + frontierAlphabet.join(',') + ']');
		return { tpl, warnings };
	};
}

/**
 * Fork a sub-graph for a tile, stabilize it, and merge back the CHECKED frontier projection.
 * `nextStable` is injected (it lives in lib/authoring/supervise.js) so this stays dependency-light.
 *
 * @param parent            the parent Graph
 * @param o.childSeed       the sub-problem seed for the fork
 * @param o.childConf       the fork conf (e.g. { label, conceptMap: solverConceptTree() })
 * @param o.targetId        the parent object the result merges onto
 * @param o.frontierAlphabet the keys permitted to cross (the snapped contract / forkPlan-derived)
 * @param o.project         the projection fn (e.g. snappedFrontier({ targetId }))
 * @param o.nextStable      the settle-awaiter (injected)
 * @returns { child, warnings, projected }  (throws if the projection leaks)
 */
async function forkSolveAndMerge( parent, o ) {
	const checked = checkedProjection(o.project, o.frontierAlphabet);
	const child = parent.fork(o.childSeed, o.childConf);
	await o.nextStable(child);
	const { tpl, warnings } = checked(child);          // validate BEFORE crossing (throws on a leak)
	parent.merge(child, o.targetId, function () { return tpl; });
	await o.nextStable(parent);
	return { child, warnings, projected: tpl };
}

module.exports = { checkedProjection, forkSolveAndMerge };
