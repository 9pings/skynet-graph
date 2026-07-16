/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 */
'use strict';
/**
 * forge (M3) — the one-call STOCK FABRICATION pipeline, promoted from the WikiSQL pilot (2026-07-05) into
 * a reusable brick. Given a class-grouped adapted corpus (each record carries its gold typed-step shape),
 * it runs, per class: a model FORGE decomposition → an engine TRACE (a typed-step Plan chain) → CRYSTALLIZE
 * (distil a per-class structural method) → the GOLD-GATE (admit iff consistent ∧ shape==gold ∧ crystallized)
 * → packStock into a portable `.sgc`. It also emits a VALIDATION DOSSIER — the certification asset: which
 * dataset, which forge model, the per-class verdicts, the aggregate (0 false admitted, by construction of
 * the gate), the soundness gates (neg-control + round-trip), and the sha256 the dossier binds.
 *
 * SOUNDNESS is carried by the GATE + the dataset oracle, never the model: whatever a small model renders,
 * only a gold-matching, consistent, crystallized shape enters the stock. YIELD (how many classes admit) is
 * bounded by model consistency — the soundness-preserving lever is `consistencyVote` (sample N, take the
 * majority shape; still gold-gated).
 *
 *   const r = await forgeStock({ classes, stepEnum, ask, name, version, dataset, negControl:true });
 *   // r.bundle = the .sgc methods stock ; r.dossier = the validation record ; r.verdict = the pass summary
 *
 * The trace-producing engine run lives here (the Plan provider + the typed-step chain are dataset-agnostic);
 * a dataset supplies only the adapted `classes` (+ optionally a tighter `decompose` for yield).
 */
const path = require('path');
const crypto = require('crypto');
const Graph = require('../../lib/graph');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { methodTrace } = require('../learning/lib/mine.js');
const { createLearningLibrary } = require('../learning/factory.js');
const stockMod = require('./lib/stock.js');   // goldGate + packStock + consistencyVote + shapeOf
const packMod = require('../learning/lib/method-pack.js');

// the dataset-agnostic engine scaffold: a Plan concept that decomposes a task segment into a typed-step
// chain. The GRAMMAR lives in FILES, not code (owner: no grammar hard-coded in JS) — loaded from the
// `forge` plugin's concept set (plugins/forge/concepts/forge/). The Plan::plan provider stays
// factory-built per run (makePlanProvider closes over decompose/ask/voters); the grammar only names it.
const { buildConceptTree } = require('../../lib/authoring/core/concepts.js');
const FORGE_SET = 'forge';
const TREE = buildConceptTree(path.join(__dirname, 'concepts', FORGE_SET));
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const CFG = { label: 'forge', isMaster: true, autoMount: true, conceptSets: [FORGE_SET], bagRefManagers: {}, logLevel: 'error' };

/** the default typed-step forge: deterministic gold-forge when no model (ask=null), else a generic prompt. */
function makeDefaultDecompose( stepEnum ) {
	const snap = ( s ) => (stepEnum || []).find(( e ) => String(s || '').toLowerCase().includes(e)) || String(s || '').toLowerCase();
	return async function ( ask, rec, o ) {
		o = o || {};
		if ( !ask ) return o.corrupt ? rec.goldSteps.slice(0, Math.max(1, rec.goldSteps.length - 1)) : rec.goldSteps.slice();
		const txt = await ask({
			system: 'Break the query into an ORDERED list of typed steps. Use ONLY these kinds: ' + (stepEnum || []).join(', ')
				+ '. Reply ONLY JSON: {"steps":["..."]}.',
			user: String(rec.problem || ''), maxTokens: 80, temperature: o.temperature || 0
		});
		try { const m = String(txt).match(/\{[\s\S]*\}/); return (JSON.parse(m ? m[0] : txt).steps || []).map(snap); }
		catch ( e ) { return []; }
	};
}

async function decomposeVoted( voters, rec, decompose ) {
	const samples = [];
	for ( const ask of voters ) { const s = await decompose(ask, rec, { temperature: 0.7 }); if ( s.length ) samples.push(s); }
	return stockMod.consistencyVote(samples).steps;
}

function makePlanProvider( decompose, ask, meter, plans, voters ) {
	return { plan: async function ( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode;
		const rec = plans[scope._.recId];
		let steps;
		if ( voters ) { meter.calls += voters.length; steps = await decomposeVoted(voters, rec, decompose); }
		else if ( ask ) { meter.calls++; steps = await decompose(ask, rec, {}); }
		else steps = await decompose(null, rec, { corrupt: rec._corrupt });
		if ( !steps.length ) return cb(null, { $_id: '_parent', Plan: true, Planned: true, planFailed: true });
		const tpl = [{ $_id: '_parent', Plan: true, Planned: true, nSteps: steps.length }];
		let prev = o;
		steps.forEach(function ( kind, i ) {
			const last = i === steps.length - 1, tnode = last ? t : base + '_m' + i;
			if ( !last ) tpl.push({ _id: tnode, Node: true, state: kind });
			tpl.push({ _id: base + '_s' + i, Segment: true, originNode: prev, targetNode: tnode, parentSeg: base, state: kind });
			prev = tnode;
		});
		rec._modelSteps = steps;
		cb(null, tpl);
	} };
}

// run every instance of ONE class through a live graph, capture the trace, crystallize, gold-gate → verdict.
async function buildClassMethod( sig, recs, ask, meter, voters, decompose ) {
	const plans = {};
	recs.forEach(( r, i ) => { r.recId = sig + '#' + i; r.sig = sig; plans[r.recId] = r; });
	const saved = Graph._providers;
	Graph._providers = Object.assign({}, Graph._providers, { Plan: makePlanProvider(decompose, ask, meter, plans, voters) });
	try {
		const nodes = [], segments = [];
		recs.forEach(( r, i ) => {
			nodes.push({ _id: 'S' + i }, { _id: 'G' + i });
			segments.push({ _id: 'E' + i, originNode: 'S' + i, targetNode: 'G' + i, taskKind: sig, recId: r.recId });
		});
		const mt = methodTrace();
		const g = new Graph({ lastRev: 0, nodes, segments }, CFG, { [FORGE_SET]: TREE });
		mt.listen(g);
		await nextStable(g);

		const lib = createLearningLibrary({ learning: true, signature: ( p ) => ({ structure: { taskKind: p.taskKind }, content: {} }),
			target: () => null, dispatchFacts: ( p ) => ({ Segment: true, taskKind: p.taskKind }), forge: async () => null });
		const res = lib.crystallizeFrom(mt.records, { episodeTree: TREE, schemaGraph: g, declaredFrontier: DECL, equivKeys: ['Planned'], idFor: () => 'Crystal_' + sig.replace(/[^A-Za-z0-9]/g, '_') });

		const gate = stockMod.goldGate({ modelShapes: recs.map(( r ) => r._modelSteps || []), goldSteps: recs[0].goldSteps, crystallized: !!res.admitted });
		return { sig, n: recs.length, modelConsistent: gate.consistent, goldShape: gate.goldShape, modelShape: gate.modelShape || '(none)',
			crystallized: !!res.admitted, crystalReason: res.reason, goldMatch: gate.goldMatch, admitted: gate.admitted,
			reason: gate.reason, candidate: gate.admitted ? res.candidate : null };
	} finally { Graph._providers = saved; }
}

/**
 * Fabricate a gold-verified stock + its validation dossier.
 * @param opts.classes    { sig: [ {problem, goldSteps:[kind]} ] }  — the adapted, class-grouped corpus.
 * @param opts.stepEnum   the typed-step vocabulary (for the default forge prompt).
 * @param opts.decompose  optional async (ask, rec, {corrupt,temperature}) -> steps[] (override the default).
 * @param opts.ask        the model forge (a chat ask). Omit for the deterministic gold-forge (tests).
 * @param opts.voters     optional array of asks → consistencyVote (the yield lever).
 * @param opts.name/version/description/dataset  bundle + dossier metadata.
 * @param opts.negControl add a corrupted-shape neg-control (proves the gate is non-vacuous). Default true.
 * @returns { results, bundle, dossier, verdict }
 */
async function forgeStock( opts ) {
	opts = opts || {};
	const classes = opts.classes || {};
	const decompose = opts.decompose || makeDefaultDecompose(opts.stepEnum);
	const ask = opts.ask || null;
	const voters = opts.voters || null;
	const meter = { calls: 0 };
	const negControl = opts.negControl !== false;

	const results = [];
	for ( const sig of Object.keys(classes) ) {
		const recs = (classes[sig] || []).slice();
		if ( recs.length < 2 ) continue;   // need ≥2 instances to judge consistency
		results.push(await buildClassMethod(sig, recs, ask, meter, voters, decompose));
	}

	const admittedList = results.filter(( v ) => v.admitted && v.candidate ).map(( v ) => ({ sig: v.sig, candidate: v.candidate }));
	const bundle = stockMod.packStock(admittedList, { name: opts.name || 'stock', version: opts.version || '0.0.0', description: opts.description || '' });
	const packed = (packMod.unpackMethods(bundle).methods || []).length;
	// round-trip: a fresh library reloads the .sgc → the methods hydrate (cross-deployment ship-ability).
	const fresh = createLearningLibrary({ learning: true, signature: ( p ) => ({ structure: { taskKind: p.taskKind }, content: {} }),
		target: () => null, dispatchFacts: ( p ) => ({ Segment: true, taskKind: p.taskKind }), forge: async () => null });
	const ld = fresh.load(bundle, { version: opts.version || '0.0.0' });
	const reloaded = ld.added != null ? ld.added : 0;

	// neg-control: a deliberately-corrupted shape on one class MUST be rejected by the gate (non-vacuity).
	let neg = { ran: false, rejected: null };
	if ( negControl ) {
		// need a MULTI-step gold shape — corrupting a 1-step shape yields the same shape (not a real negative).
		const sig = Object.keys(classes).find(( s ) => (classes[s] || []).length >= 2 && ((classes[s][0] || {}).goldSteps || []).length >= 2 );
		if ( sig ) {
			// the neg-control is a DETERMINISTIC soundness check (corrupt the gold shape) — it uses the
			// default gold-forge, never the caller's model decompose (which need only handle a real ask).
			const recs = classes[sig].slice(0, Math.max(2, 3)).map(( r ) => Object.assign({}, r, { _corrupt: true }));
			const v = await buildClassMethod(sig + '~neg', recs, null, meter, null, makeDefaultDecompose(opts.stepEnum));
			neg = { ran: true, rejected: v.admitted === false, sig };
		}
	}

	const attempted = results.length;
	const admitted = admittedList.length;
	const falseAdmitted = results.filter(( v ) => v.admitted && !v.goldMatch ).length;   // 0 by construction of the gate
	const gates = [
		{ name: 'gold-gate: 0 false admitted (shape != gold never enters)', pass: falseAdmitted === 0 },
		{ name: 'stock packs to .sgc and reloads cross-deployment', pass: packed === admitted && reloaded === admitted },
		negControl ? { name: 'neg-control: a corrupted shape is rejected', pass: neg.rejected === true }
			: { name: 'at least one class admitted', pass: admitted >= 1 }
	];
	const pass = gates.every(( g ) => g.pass );

	const dossier = {
		forge: 'skynet-sg-forge', generated: opts.now || null,
		dataset: { name: opts.dataset || opts.name || 'corpus', classesAttempted: attempted },
		model: { forge: (ask || (voters && voters.length)) ? (opts.modelName || 'embedded model') : 'gold-forge (deterministic)', reasoningBudget: 0, voters: voters ? voters.length : 0, calls: meter.calls },
		classes: results.map(( v ) => ({ sig: v.sig, n: v.n, modelConsistent: v.modelConsistent, modelShape: v.modelShape,
			goldShape: v.goldShape, crystallized: v.crystallized, crystalReason: v.crystalReason, goldMatch: v.goldMatch, admitted: v.admitted, reason: v.reason })),
		summary: { attempted, admitted, falseAdmitted, modelCalls: meter.calls },
		soundness: { negControl: neg, gates },
		gates,
		bundle: { name: bundle.manifest ? bundle.manifest.name : (opts.name || 'stock'), version: opts.version || '0.0.0',
			methods: packed, sha256: crypto.createHash('sha256').update(JSON.stringify(bundle)).digest('hex') },
		verdict: { pass }
	};

	return { results, bundle, dossier, verdict: { attempted, admitted, falseAdmitted, packed, reloaded, pass } };
}

/** Render the validation dossier as a human-readable markdown certificate (the deliverable a buyer reads). */
function dossierMarkdown( d ) {
	const rows = d.classes.map(( c ) => '| `' + c.sig + '` | ' + c.n + ' | `' + c.modelShape + '` | `' + c.goldShape + '` | '
		+ (c.crystallized ? 'yes' : 'no') + ' | ' + (c.admitted ? '✅ admitted' : '⛔ ' + c.reason) + ' |').join('\n');
	return [
		'# Validation dossier — ' + d.bundle.name + '@' + d.bundle.version,
		'', 'Dataset: **' + d.dataset.name + '**  ·  forge: **' + d.model.forge + '**  ·  model calls: ' + d.model.calls,
		'Bundle sha256: `' + d.bundle.sha256 + '`', '',
		'| class | n | model shape | gold shape | crystallized | gold-gate |',
		'|---|---|---|---|---|---|', rows, '',
		'## Summary',
		'- classes attempted: **' + d.summary.attempted + '**',
		'- admitted (gold-verified): **' + d.summary.admitted + '**',
		'- FALSE admitted (shape ≠ gold): **' + d.summary.falseAdmitted + '** ' + (d.summary.falseAdmitted === 0 ? '(the gate keeps the stock clean)' : '(!!)'),
		'', '## Soundness gates',
		d.gates.map(( g ) => '- ' + (g.pass ? '✅' : '❌') + ' ' + g.name).join('\n'), '',
		'**Verdict: ' + (d.verdict.pass ? '✅ PASS' : '❌ FAIL') + '** — a gold-verified `.sgc` stock certified from the dataset oracle.'
	].join('\n');
}

module.exports = { forgeStock, dossierMarkdown, makeDefaultDecompose, buildClassMethod };
