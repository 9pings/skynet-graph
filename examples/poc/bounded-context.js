/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP measured experiment — answer a question over an input LARGER than the context window,
 * with every LLM call PROVABLY bounded, using the graph as bounded working memory. Fixes the gap
 * found 2026-06-26 (run-prompt carried the whole objective into every call = the blowup it claims
 * to avoid). Here each leaf call sees ONLY its shard; the graph holds the shards and does the reduce
 * via the race-free {__push} reactive synthesis. Compared to a naive baseline (truncate-to-window).
 *
 *   STUB (deterministic, instant — validates the engine map-reduce + the accounting):
 *     N=12 node examples/poc/bounded-context.js
 *   REAL LLM (background; slow reasoning model):
 *     EXTRACTOR=llm LLM_BASE=http://localhost:5000 LLM_MODEL=qwen36-nvfp4-mtp node examples/poc/bounded-context.js
 *
 * Task: a synthetic doc of N sections, each with one planted access code; question = "list ALL codes".
 * Metric: recall (codes found / N) + max per-call prompt tokens. The engine sees every shard at
 * bounded cost; the baseline truncates and can only recover the codes that fit in its window.
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { makeAsk } = require('../../lib/providers/llm.js');

const N        = Number(process.env.N || 12);              // sections (each ~one code)
const FILLER   = Number(process.env.FILLER || 1600);       // filler chars/section (~400 tokens)
const WINDOW   = Number(process.env.WINDOW || 2600);       // baseline truncation window (chars)
const MODE     = process.env.EXTRACTOR || 'stub';          // 'stub' | 'llm'
const estTok   = (s) => Math.ceil((s || '').length / 4);
const CODE_RE  = /CODE-\d+-[A-Z0-9]{4}/g;

// ---- a synthetic document: N sections of filler, each hiding exactly one access code ----
function buildDoc() {
	const lorem = 'the system processes records and emits typed facts across the reasoning graph. ';
	const sections = [], codes = [];
	for ( let k = 0; k < N; k++ ) {
		const code = 'CODE-' + k + '-' + (1000 + k * 7).toString(36).toUpperCase().padStart(4, 'X').slice(0, 4);
		codes.push(code);
		let body = '';
		while ( body.length < FILLER ) body += lorem;
		sections.push(`## Section ${k}\n${body}\nNote: the access code for module ${k} is ${code}. Keep it safe.\n${body}`);
	}
	return { text: sections.join('\n\n'), sections, codes };
}

// ---- the instrumented extractor: STUB (regex the shard) or LLM (bounded per-shard call) ----
let calls = [];
function makeExtractor() {
	if ( MODE !== 'llm' ) {
		return async ( shard ) => { const m = shard.match(CODE_RE) || []; calls.push({ promptTok: estTok(shard) + 30, ms: 0 }); return m; };
	}
	const ask = makeAsk({ base: process.env.LLM_BASE || 'http://localhost:5000', api: 'openai', model: process.env.LLM_MODEL || 'qwen36-nvfp4-mtp' });
	const system = 'You extract access codes of the form CODE-<n>-<XXXX> from a text fragment. List every one you find, verbatim. Be brief.';
	return async ( shard ) => {
		const user = 'Text fragment:\n' + shard + '\n\nList the access code(s) in this fragment.';
		const t0 = Date.now();
		let reply = '';
		try { reply = await ask({ system, user, maxTokens: 400 }); } catch ( e ) { reply = ''; }
		calls.push({ promptTok: estTok(system) + estTok(user), ms: Date.now() - t0 });
		return String(reply).match(CODE_RE) || [];
	};
}

// ---- the ENGINE map-reduce: the graph IS the bounded working memory ----
//   each shard is a leaf segment carrying ONLY its own text; an `Extract` concept (the bounded
//   per-shard call) writes its codes and {__push}es them + its id up to the root; a `Collect` concept
//   on the root fires once every shard reported (the §5.2 cardinality gate) and flattens the result.
function conceptTree() {
	return { common: { childConcepts: {
		Extract: { _id: 'Extract', _name: 'Extract', require: ['shardText'], provider: ['Map::extract'] },
		Collect: { _id: 'Collect', _name: 'Collect', require: ['Root', 'shardCount'], ensure: ['$reported.length == $shardCount'], provider: ['Map::collect'] }
	} } };
}
function providers( extract ) {
	return { Map: {
		extract: function ( graph, concept, scope, argz, cb ) {
			Promise.resolve(extract(scope._.shardText)).then(function ( codes ) {
				cb(null, [
					{ $_id: '_parent', Extract: true, codes: codes },
					{ $$_id: 'R', found: { __push: codes }, reported: { __push: scope._._id } }
				]);
			});
		},
		collect: function ( graph, concept, scope, argz, cb ) {
			const flat = []; (scope._.found || []).forEach(function ( arr ) { (arr || []).forEach(function ( c ) { if ( flat.indexOf(c) < 0 ) flat.push(c); }); });
			cb(null, { $_id: '_parent', Collect: true, collected: flat });
		}
	} };
}

async function runEngine( doc ) {
	const extract = makeExtractor();
	Graph._providers = Object.assign({}, providers(extract));
	const nodes = [{ _id: 'R', Root: true, shardCount: doc.sections.length }];
	const segments = doc.sections.map((txt, i) => ({ _id: 's' + i, Segment: true, originNode: 'R', targetNode: 'R', shardText: txt, parentSeg: 'R' }));
	const g = new Graph({ lastRev: 0, nodes, segments }, { label: 'bounded', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, conceptTree());
	await nextStable(g);
	return g._objById['R']._etty._.collected || [];
}

// ---- the NAIVE baseline: one call, the doc TRUNCATED to the window ----
async function runBaseline( doc ) {
	const truncated = doc.text.slice(0, WINDOW);
	if ( MODE !== 'llm' ) return { codes: truncated.match(CODE_RE) || [], promptTok: estTok(truncated) + 30 };
	const ask = makeAsk({ base: process.env.LLM_BASE || 'http://localhost:5000', api: 'openai', model: process.env.LLM_MODEL || 'qwen36-nvfp4-mtp' });
	const system = 'You extract every access code of the form CODE-<n>-<XXXX> from a document. List them all.';
	const user = 'Document:\n' + truncated + '\n\nList ALL access codes in the document.';
	let reply = ''; try { reply = await ask({ system, user, maxTokens: 800 }); } catch ( e ) { reply = ''; }
	return { codes: String(reply).match(CODE_RE) || [], promptTok: estTok(system) + estTok(user) };
}

const recallOf = (doc, found) => { const s = new Set(found); let n = 0; for ( const c of doc.codes ) if ( s.has(c) ) n++; return n / doc.codes.length; };
const maxCallTokens = () => calls.reduce((m, c) => Math.max(m, c.promptTok), 0);

async function main() {
	const doc = buildDoc();
	const recall = (found) => recallOf(doc, found);

	console.log(`\nFLAGSHIP bounded-context experiment  (mode=${MODE}, N=${N} sections, doc≈${estTok(doc.text)} tokens, window=${estTok(doc.text.slice(0, WINDOW))} tokens)\n`);

	const engineFound = await runEngine(doc);
	const base = await runBaseline(doc);

	const maxCall = calls.reduce((m, c) => Math.max(m, c.promptTok), 0);
	const totCall = calls.reduce((s, c) => s + c.promptTok, 0);

	console.log('ENGINE (graph as bounded working memory, map-reduce over shards):');
	console.log(`   recall = ${(recall(engineFound) * 100).toFixed(0)}%  (${engineFound.length}/${doc.codes.length} codes)`);
	console.log(`   LLM calls = ${calls.length} ; MAX per-call context = ${maxCall} tokens ; total = ${totCall} tokens`);
	console.log(`   → max per-call context is BOUNDED (~one shard) regardless of document size\n`);
	console.log('BASELINE (naive: whole doc truncated to the window, one call):');
	console.log(`   recall = ${(recall(base.codes) * 100).toFixed(0)}%  (${base.codes.length}/${doc.codes.length} codes)`);
	console.log(`   single-call context = ${base.promptTok} tokens (the doc is ${estTok(doc.text)} → it cannot all fit)\n`);
	console.log(`VERDICT: the engine recovers ${(recall(engineFound) * 100).toFixed(0)}% with every call ≤ ${maxCall} tokens; the baseline,`);
	console.log(`         capped at its window, recovers only ${(recall(base.codes) * 100).toFixed(0)}% — it cannot see past the truncation.\n`);
}

module.exports = { buildDoc, runEngine, recallOf, maxCallTokens };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
