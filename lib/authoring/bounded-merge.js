/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * bounded-merge — the BOUNDED `project` at a fork/merge JOIN (host-side, ZERO-CORE). The enforcement gate
 * Lens 3 flagged: `Graph#merge(child, targetId)` with NO project DEFAULTS to crossing the WHOLE serialized
 * child (`{ forkResult: child.serialize() }`) — which re-creates the O(N) context blowup the architecture
 * exists to avoid (a child's entire sub-graph leaks across the AND-join). The bounded-context contract
 * (master-graph study §2.3, rule A1/A6) requires every join to cross only a separator-sized FRONTIER.
 *
 * `boundedProject` builds a `project` fn that crosses ONLY the declared frontier facts (the separator
 * alphabet Σ_sep), snapped off one result object in the child — so the merge traffic is O(|frontier|),
 * independent of the child's size. Pair it with `validate` (the author-time `validateMergeProjection`
 * frontier-leak check) to assert no key escapes the alphabet.
 *
 *   const project = boundedProject({ targetId: 'root', from: 'result', keys: ['answer', 'cost'] });
 *   parent.merge(child, 'root', project);     // crosses {answer,cost} only — NOT the whole child
 */
const { validateMergeProjection } = require('./validate.js');

/**
 * @param spec.targetId  the parent object the projection updates ($$_id)
 * @param spec.from      the child object id whose facts are the result (default: spec.targetId)
 * @param spec.keys      the frontier fact keys allowed to cross (the separator alphabet)
 * @returns (child) => mutationTemplate   a `project` fn for Graph#merge that crosses only `keys`
 */
function boundedProject( spec ) {
	spec = spec || {};
	const targetId = spec.targetId, from = spec.from || spec.targetId, keys = spec.keys || [];
	return function ( child ) {
		const e = child.getEtty ? child.getEtty(from) : null;
		const f = (e && e._) || {};
		const out = { $$_id: targetId };
		for ( const k of keys ) if ( f[k] !== undefined ) out[k] = f[k];   // ONLY the frontier crosses
		return out;
	};
}

/**
 * Author-time check that a produced merge template crosses only the declared frontier alphabet (no leak).
 * Thin wrapper over `validate.js#validateMergeProjection` so a host can gate a merge before applying it.
 * A frontier leak (a key crossing that isn't in the alphabet) is a `frontier-leak` warning (an error under
 * `strict`); `ok` is false if anything leaked.
 * @returns { errors:[…], warnings:[…], leaks:[…], ok:bool }
 */
function validate( template, frontierKeys, opts ) {
	const r = validateMergeProjection(template, Object.assign({ frontierAlphabet: frontierKeys || [] }, opts || {})) || {};
	const errors = r.errors || [], warnings = r.warnings || [];
	const leaks = warnings.filter(( w ) => w && w.kind === 'frontier-leak').concat(errors.filter(( e ) => e && e.kind === 'frontier-leak'));
	return { errors, warnings, leaks, ok: errors.length === 0 && leaks.length === 0 };
}

module.exports = { boundedProject, validate };
