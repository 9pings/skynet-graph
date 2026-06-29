/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * crystallize — the live crystallization loop (host-side, ZERO-CORE; study
 * doc/WIP/studies/2026-06-26-…, pass 3). Composes the pass-1/2 bricks end-to-end:
 *
 *   run an episode with a trace miner  →  mine the dominant producer→consumer chain
 *     →  compose the constituents' providers into ONE cast  →  gate by MDL/utility
 *     (fixpoint-equivalent + net-cheaper)  →  (adopt) install under a memo-stability guard.
 *
 * This is "observe → crystallize a typed production" — promoting a recurring sub-derivation
 * (a nonterminal in the derivation forest) into a first-class, auditable, defeasible concept.
 * `crystallize` makes the DECISION (offline, on fresh boots — never mid-stabilize); `adopt`
 * installs an admitted candidate into a target grammar, fail-closed on memo regression.
 *
 *   const r = await crystallize({ episodeTree, seed, providers, equivKeys });
 *   if (r.admitted) await adopt(nextGraph, r.candidate);   // adopt into the next episode's grammar
 */
const Graph = require('../graph/index.js');
const { nextStable } = require('./supervise.js');
const { traceMiner, composeProviders } = require('./mine.js');
const { rankCandidates } = require('./mdl.js');
const { evaluate, bootMeasure, factsEqual } = require('./abstraction.js');
const { assertMemoStable } = require('./memo-stability.js');
const { createLifecycle } = require('./lifecycle.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

// find a concept schema by name/key anywhere in a tree
function conceptByName( tree, name ) {
	let found = null;
	(function walk( n ) {
		if ( !n || typeof n !== 'object' || found ) return;
		const kids = n.childConcepts;
		if ( kids ) for ( const k of Object.keys(kids) ) {
			if ( kids[k]._name === name || k === name ) { found = kids[k]; return; }
			walk(kids[k]);
		}
	})(tree);
	return found;
}

// resolve a concept's provider function from a providers map ("Ns::fn" | ["Ns::fn", …])
function providerFn( providers, provRef ) {
	const p = Array.isArray(provRef) ? provRef[0] : provRef;
	if ( !p ) return null;
	const parts = String(p).split('::');
	return providers[parts[0]] && providers[parts[0]][parts[1]];
}

/**
 * Decide whether the dominant mined chain should crystallize into one production.
 * @param opts.episodeTree/seed/providers/equivKeys  the episode + the equivalence contract
 * @param opts.minCount  minimum co-firing count to consider a chain (default 2)
 * @param opts.idFor     (chain)->id   name the crystallized concept (default Crystal_<from>_<to>)
 * @returns { chain, candidate:{schema,providerName,provider}|null, verdict?, admitted, reason? }
 */
async function crystallize( opts ) {
	const { episodeTree, seed, providers, equivKeys } = opts;
	const minCount = opts.minCount || 2;

	// 1. run the episode with a trace miner (offline; fresh boot)
	Graph._providers = Object.assign({}, Graph._providers || {}, providers || {});
	const miner = traceMiner();
	const g = new Graph(clone(seed), {
		label: 'crystallize', isMaster: true, autoMount: true, conceptSets: ['common'],
		bagRefManagers: {}, logLevel: 'error', onConceptApply: miner.onConceptApply,
	}, { common: clone(episodeTree) });
	await nextStable(g);

	const chains = miner.chains(episodeTree);
	// MDL rank (cheap, O(corpus), NO boot): order candidates by bits saved across the whole
	// trace, best first. A pure RANKER by default — `evaluate` stays the admit AUTHORITY (MDL
	// is conservative at tiny N and can't verify equivalence/model-cost). Opt-in `mdlPrefilter`
	// lets MDL cheaply skip a clearly-unprofitable (ΔL≥0) candidate before the expensive boot.
	const ranked = rankCandidates(chains, { tree: episodeTree, records: miner.records, alphabet: opts.alphabet || { knownFacts: [], palette: [] } });
	const top = ranked[0];
	if ( !top || top.count < minCount )
		return { chain: top ? plainChain(top) : null, candidate: null, admitted: false, reason: 'no frequent chain' };
	const mdl = top.mdl;
	if ( opts.mdlPrefilter && mdl && !mdl.admit )
		return { chain: plainChain(top), candidate: null, admitted: false, reason: 'mdl-prefilter (ΔL≥0, not worth a boot)', mdl };

	// 2. compose the from/to providers into one cast
	const fromS = conceptByName(episodeTree, top.from), toS = conceptByName(episodeTree, top.to);
	const fromFn = providerFn(providers, fromS && fromS.provider), toFn = providerFn(providers, toS && toS.provider);
	if ( !fromFn || !toFn )
		return { chain: plainChain(top), candidate: null, admitted: false, reason: 'non-provider constituent (v0 composes provider concepts)', mdl };

	const id = opts.idFor ? opts.idFor(top) : ('Crystal_' + top.from + '_' + top.to);
	const composed = composeProviders(fromFn, toFn);
	const providerName = 'Crystal::' + id;
	const augmented = Object.assign({}, providers, { Crystal: Object.assign({}, providers.Crystal, { [id]: composed }) });
	const schema = { _id: id, _name: id, require: (fromS.require || []).slice(), provider: [providerName] };

	// 3. MDL/utility gate (fixpoint-equivalent + net-cheaper vs the chain)
	const verdict = await evaluate({ seed, providers: augmented, chainTree: episodeTree, abstractTree: { childConcepts: { [id]: schema } }, equivKeys });
	return { chain: plainChain(top), candidate: { schema, providerName, provider: composed }, verdict, admitted: verdict.admit, mdl };
}

// the plain mined-chain shape (drop the attached `mdl` annotation so `res.chain` stays the
// stable { from, to, via, count } record).
function plainChain( c ) {
	const out = { from: c.from, to: c.to, via: c.via, count: c.count };
	if ( c.length != null ) out.length = c.length;
	return out;
}

/**
 * Install an admitted candidate into a target graph, fail-closed on memo regression
 * (assertMemoStable over the existing incumbents). Registers the composed provider first.
 * @returns the memoDiff (stable) — throws on a memo-stability violation.
 */
async function adopt( graph, candidate ) {
	const parts = candidate.providerName.split('::');
	Graph._providers = Object.assign({}, Graph._providers, {
		[parts[0]]: Object.assign({}, Graph._providers[parts[0]], { [parts[1]]: candidate.provider }),
	});
	const incumbents = Object.keys(graph._conceptLib || {});
	return assertMemoStable(graph, incumbents, () => new Promise((res) => graph.addConcept(null, candidate.schema, () => res())));
}

// Offline adoption: rewrite the episode grammar to USE the crystal — drop the chain's
// constituents and add the crystallized production. This materializes the refactor win (one
// cast instead of the chain) WITHOUT needing a core deleteConcept: the next episode is simply
// authored with the new grammar (the form the adversarial lens endorsed).
function rewriteAdopt( episodeTree, chain, candidateSchema ) {
	const t = clone(episodeTree);
	const kids = t.childConcepts || (t.childConcepts = {});
	for ( const k of Object.keys(kids) )
		if ( k === chain.from || k === chain.to || kids[k]._name === chain.from || kids[k]._name === chain.to ) delete kids[k];
	kids[candidateSchema._id] = candidateSchema;
	return t;
}

/**
 * Multi-episode consolidation (CLS): crystallize a candidate, ADOPT it by rewriting the
 * grammar (chain → crystal), then over `rounds` episodes verify it reproduces the baseline
 * and feed the outcome to the plasticity ledger — a proven crystal anneals to FROZEN.
 * @returns { candidate, chain, verdict, adoptedTree, lifecycle, plasticity, regime, reputation,
 *            applies:{chain,adopted}, consolidated }  (or the crystallize decision if not admitted)
 */
async function consolidate( opts ) {
	const rounds = opts.rounds || 3;
	const lc = opts.lifecycle || createLifecycle(opts.lifecycleOpts);
	const dec = await crystallize(opts);
	if ( !dec.admitted ) return Object.assign({}, dec, { lifecycle: lc, consolidated: false });

	const id = dec.candidate.schema._id;
	lc.register(id);
	const augmented = Object.assign({}, opts.providers, { Crystal: Object.assign({}, opts.providers && opts.providers.Crystal, { [id]: dec.candidate.provider }) });
	const baseline = (await bootMeasure(opts.episodeTree, opts.seed, augmented, { equivKeys: opts.equivKeys })).facts;
	const adoptedTree = rewriteAdopt(opts.episodeTree, dec.chain, dec.candidate.schema);

	let adoptedApplies = 0;
	for ( let r = 0; r < rounds; r++ ) {
		const run = await bootMeasure(adoptedTree, opts.seed, augmented, { equivKeys: opts.equivKeys });
		adoptedApplies = run.applies;
		lc.record(id, factsEqual(baseline, run.facts));   // genuine outcome (equivalent to baseline?)
	}

	return {
		candidate: dec.candidate, chain: dec.chain, verdict: dec.verdict, adoptedTree,
		lifecycle: lc, plasticity: lc.plasticity(id), regime: lc.regime(id), reputation: lc.reputation(id),
		applies: { chain: dec.verdict.chainApplies, adopted: adoptedApplies },
		consolidated: lc.regime(id) === 'frozen',
	};
}

module.exports = { crystallize, adopt, consolidate, rewriteAdopt };
