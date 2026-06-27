/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * A SELF-CONTAINED problem-paths provider FILE, loadable by a worker thread (`Graph.loadProviders`). The
 * worker rehydrates a sub-graph from a JSON conceptMap + this provider module + a seed; the one effect that
 * can't be serialized — the model `ask` — is PROXIED back to the parent. This module is a factory `(ctx) =>
 * fragment`: it reuses the generic problem-paths providers but with a content whose `resolve`/`summarize`
 * call `ctx.ask` (the proxied model). Structure (decompose/score) is deterministic so the dispatch is
 * reproducible; the STEP TEXT round-trips the parent's model — proving a dispatched sub-graph reasons in a
 * separate OS thread with its model calls answered by the parent.
 */
module.exports = function ( ctx ) {
	ctx = ctx || {};
	const { providers } = require('./problem-paths.js');
	const ask = ctx.ask || (async ( p ) => 'step: ' + ((p && p.user) || ''));
	const env = ctx.env || {};
	const maxDepth = env.WK_MAXDEPTH ? Number(env.WK_MAXDEPTH) : 6;

	// deterministic structure (numeric bisection); the proxied model fills the step + summary text.
	const content = {
		plan: async ( { from, to } ) => (to - from <= 1) ? { atomic: true } : { mids: [{ state: Math.floor((from + to) / 2) }] },
		score: async () => 0,
		resolve: async ( { from, to, prev } ) => {
			const r = await ask({ system: 'Give ONE concrete step to get from the START state to the GOAL state; continue from the previous step.', user: `PREVIOUS: ${prev}\nSTART: ${from}\nGOAL: ${to}` });
			return (typeof r === 'string' ? r : (r && r.step)) || `step ${from}->${to}`;
		},
		summarize: async ( steps ) => {
			const r = await ask({ system: 'Summarize these ordered steps into one short plan.', user: steps.map(( s, i ) => (i + 1) + '. ' + s).join('\n') });
			return (typeof r === 'string' ? r : (r && r.text)) || `plan of ${steps.length} steps`;
		}
	};
	return providers(content, { maxDepth: maxDepth, alts: 1 });   // -> { P: { plan, select, resolve, reselect, summarize } } (a provider fragment)
};
