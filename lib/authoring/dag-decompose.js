/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * dag-decompose — the model-driven TYPED DAG DECOMPOSE (ZERO-CORE, host-side). The upstream half of the context
 * projection: it turns a task into the `needs`/`produces` DAG that `context-project.js` + `plan-loop.js` execute.
 * Realizes the study `WIP/2026-07-08-etude-decoupage-de-tache.md` §6.1: the decompose PROMPT + GRAMMAR-CONSTRAINED
 * decoding force a well-formed typed dataflow graph, and the engine's offline guards (guardPlan cycle/coverage,
 * rebalance) validate the CONTENT — "propose freely, validate hard, refuse cleanly".
 *
 * Where the sibling reactive `typed-loop` chains its steps SEQUENTIALLY (originNode = the previous step's target),
 * this emits an explicit producer→consumer DAG: each part declares WHAT IT PRODUCES (a typed key) and WHAT IT NEEDS
 * (other parts' produced keys). That is the class matching our projection (LLMCompiler `$1,$2` / ReWOO `#E` /
 * HuggingGPT `<resource-N>`), plus bounded per-node context.
 *
 * THE GRAMMAR IS THE K1 BARRIER (the crown jewel, per typed-loop): the output is decoded under a JSON Schema, so a
 * small model CANNOT emit a malformed part — `stepKind` snaps onto a CLOSED enum (fail-closed via `canonValue`), the
 * shape is guaranteed. The grammar guarantees FORMAT, not correct dependency CONTENT — guardPlan/rebalance do that.
 *
 *   const { makeDagDecompose } = require('skynet-graph/lib/authoring/dag-decompose');
 *   const decompose = makeDagDecompose({ ask: makeLocalAsk({ modelPath }), stepKinds: ['retrieve','compute','compare','summarize'] });
 *   const loop = createPlanLoop({ decompose, serveLeaf });   // the projection consumes it directly
 *   // à nu:  const leaves = await decompose(task);  const roadmap = leavesToRoadmap(leaves);
 *
 * @param opts.ask       async ({ system, user, maxTokens, temperature, grammar }) => string  — a grammar-capable
 *                       chat backend (makeLocalAsk supports `grammar:{jsonSchema}`). REQUIRED.
 * @param opts.stepKinds closed enum of step TYPES (the K1-discriminating class) — canon-snapped, fail-closed.
 * @param opts.maxSteps  cap on the number of parts (default 8).
 * @param opts.system    override the decompose system prompt.
 * @param opts.hint      an optional one-line orientation appended to the system prompt (the §6.2 per-archetype steer,
 *                       e.g. "The parts are INDEPENDENT — emit no needs." for a fan-out / extraction prompt).
 */
const { canonValue } = require('../providers/canonicalize.js');

// the study §6.1 contract, as the system prompt (imperative, the 5 hard rules that encode invariants 1-3,5,8).
const DECOMPOSE_SYSTEM =
	'You are a TASK DECOMPOSER for a bounded-context execution engine. Split the task into parts and output ONLY a ' +
	'JSON array. Each part = {"produces": a short snake_case typed key naming the ARTIFACT this part outputs, ' +
	'"stepKind": the step TYPE, "instruction": one imperative sentence, "needs": the list of OTHER parts\' "produces" ' +
	'keys whose output this part consumes}. HARD RULES (the engine rejects a split that breaks them): ' +
	'(1) ACYCLIC — no part may need a part that (transitively) needs it. ' +
	'(2) COVERED — every key in "needs" must be some other part\'s "produces". ' +
	'(3) THIN — need as FEW parts as possible; produce exactly ONE key. ' +
	'(4) INDEPENDENT — if two parts do not depend on each other, do NOT invent a dependency (they run in parallel). ' +
	'(5) TYPED — "produces"/"needs" are keys, never sentences. Decompose only as far as needed; a directly-answerable part is a leaf.';

// the JSON-Schema grammar: a bounded array of typed parts; `stepKind` on the CLOSED enum (the decode-level K1 barrier).
function decomposeSchema( stepKinds, maxSteps ) {
	const kind = (stepKinds && stepKinds.length) ? { type: 'string', enum: stepKinds } : { type: 'string' };
	return {
		type: 'array', minItems: 1, maxItems: maxSteps,
		items: {
			type: 'object',
			properties: {
				produces:    { type: 'string' },
				stepKind:    kind,
				instruction: { type: 'string' },
				needs:       { type: 'array', items: { type: 'string' } }
			},
			required: ['produces', 'stepKind', 'instruction', 'needs']
		}
	};
}

// clean a produced key to a stable typed id (snake_case-ish, the projection's fusion/write key).
function keyOf( raw ) { return String(raw == null ? '' : raw).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'part'; }

function parseSteps( out ) {
	if ( Array.isArray(out) ) return out;
	try { const v = JSON.parse(out); return Array.isArray(v) ? v : (v && Array.isArray(v.parts) ? v.parts : []); }
	catch ( _e ) {                                                    // defensive (grammar-constrained output IS valid JSON; this covers a raw/ungrammared backend)
		const m = String(out).match(/\[[\s\S]*\]/); if ( m ) { try { return JSON.parse(m[0]); } catch ( _e2 ) { /* fall through */ } }
		return [];
	}
}

/**
 * makeDagDecompose(opts) → async decompose(task, ctx) -> [{ id, request:{id,kind}, nl, readsExtra:[keys] }]
 * The returned leaf list is the plan-loop DECOMPOSE contract: `request.id` is the produced key (leafWrites), and
 * `readsExtra` are the produced keys it consumes (the projection derives needs = readsExtra ∩ produced). Fail-closed:
 * an out-of-vocab `stepKind` rides `kindMiss:true` + the raw surface; a `needs` self-reference is dropped.
 */
function makeDagDecompose( opts ) {
	opts = opts || {};
	if ( typeof opts.ask !== 'function' ) throw new Error('makeDagDecompose needs opts.ask({system,user,grammar}) -> string');
	const stepKinds = opts.stepKinds || [];
	const maxSteps  = opts.maxSteps || 8;
	const system    = (opts.system || DECOMPOSE_SYSTEM) + (opts.hint ? ' ' + opts.hint : '');
	const schema    = decomposeSchema(stepKinds, maxSteps);

	return async function decompose( task, ctx ) {
		const user = typeof task === 'string' ? task : ((ctx && ctx.statement) || JSON.stringify(task));
		const out = await opts.ask({ system: system, user: user, grammar: { jsonSchema: schema }, maxTokens: opts.maxTokens || 700, temperature: 0 });
		const raw = parseSteps(out).slice(0, maxSteps);
		const seen = Object.create(null);
		const leaves = [];
		for ( const s of raw ) {
			let key = keyOf(s.produces);
			while ( seen[key] ) key = key + '_2';                    // uniquify a duplicated produced key (rebalance would dedupe identical, but a distinct write key keeps needs unambiguous)
			seen[key] = true;
			const snap = stepKinds.length ? canonValue(s.stepKind, { enum: stepKinds }) : { value: s.stepKind };
			const request = { id: key, kind: snap.miss ? null : snap.value };
			if ( snap.miss ) { request.kindMiss = true; request.kindRaw = String(s.stepKind); }
			const needs = (Array.isArray(s.needs) ? s.needs : []).map(keyOf).filter(( n ) => n !== key );
			leaves.push({ id: 'n_' + key, request: request, nl: String(s.instruction == null ? '' : s.instruction), readsExtra: needs });
		}
		if ( !leaves.length )                                        // never crash the loop: degrade to a single atomic leaf (the whole task)
			leaves.push({ id: 'n_task', request: { id: 'task', kind: null }, nl: user, readsExtra: [] });
		return leaves;
	};
}

// leaves → a context-project roadmap (à-nu use of the projection directly, without plan-loop). produces = the write
// key; needs = readsExtra restricted to keys some leaf produces (an external readsExtra is context, not a gate). ──
function leavesToRoadmap( leaves ) {
	const produced = new Set(leaves.map(( l ) => l.request && l.request.id ).filter(Boolean));
	return leaves.map(( l ) => ({ id: l.request.id, produces: l.request.id, nl: l.nl,
		needs: (l.readsExtra || []).filter(( n ) => produced.has(n) ) }) );
}

module.exports = { makeDagDecompose, leavesToRoadmap, decomposeSchema, DECOMPOSE_SYSTEM, keyOf };
