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
 * @param opts.minSteps  granularity floor: a split below it triggers ONE bounded re-ask with a coarseness blame
 *                       (gap iii — anti 1-step collapse); still under → the larger split is kept (honest degrade).
 * @param opts.givenKeys the task's given keys (givens.js): arms the cited-never-produced validation — a "needs"
 *                       key that no part produces and that is not a given joins the same bounded re-ask blame.
 * @param opts.onReask   observer ({task,firstCount,minSteps,uncovered}) fired when the validation re-ask triggers.
 * @param opts.system    override the decompose system prompt.
 * @param opts.hint      an optional one-line orientation appended to the system prompt (the §6.2 per-archetype steer,
 *                       e.g. "The parts are INDEPENDENT — emit no needs." for a fan-out / extraction prompt).
 */
const { canonValue } = require('../../../lib/providers/canonicalize.js');

// the study §6.1 contract, as the system prompt (imperative, the 5 hard rules that encode invariants 1-3,5,8).
const DECOMPOSE_SYSTEM =
	'You are a TASK DECOMPOSER for a bounded-context execution engine. Split the task into parts and output ONLY a ' +
	'JSON array. Each part = {"produces": a short snake_case typed key naming the ARTIFACT this part outputs, ' +
	'"stepKind": the step TYPE, "instruction": one imperative sentence, "needs": the list of OTHER parts\' "produces" ' +
	'keys whose output this part consumes}. HARD RULES (the engine rejects a split that breaks them): ' +
	'(1) ACYCLIC — no part may need a part that (transitively) needs it. ' +
	'(2) COVERED — every key in "needs" must be some other part\'s "produces", or a GIVEN key listed in the task. ' +
	'(3) THIN — need as FEW parts as possible; produce exactly ONE key. ' +
	'(4) INDEPENDENT — if two parts do not depend on each other, do NOT invent a dependency (they run in parallel). ' +
	'(5) TYPED — "produces"/"needs" are keys, never sentences. Decompose only as far as needed; a directly-answerable part is a leaf. ' +
	'(6) GIVENS — when the task lists GIVENS (typed keys, e.g. g1_price=5), a part that uses a base fact MUST cite its ' +
	'given key in "needs" and MUST NOT restate that number in the instruction (the engine injects the value). ' +
	'(7) SELF-CONTAINED — a base fact NOT listed in GIVENS (a quantity spelled in words, a fraction, common knowledge ' +
	'like 52 weeks per year) MUST be written explicitly AS A NUMBER in the instruction of every part that uses it; ' +
	'never reference it as a key and never assume the executor saw the original task.';

// the METHOD-SLOT / higher-order need (roadmap §5(a)): a part may declare it is a LOOP whose behavioural hole (the
// body) is filled by a DISPATCHED sub-method applied over items. The combinator vocabulary is CLOSED to the three the
// LLM can legitimately emit; `fold` is EXCLUDED on purpose — a reducer/init is arbitrary host code, never LLM-emittable
// (roadmap §5(a) confront: a `combinator:'fold'` from the grammar would crash `results.reduce(undefined,undefined)`).
const SLOT_COMBINATORS = ['map', 'all', 'any'];

// the JSON-Schema grammar: a bounded array of typed parts; `stepKind` on the CLOSED enum (the decode-level K1 barrier).
// A part may OPTIONALLY carry a `slot` (the method-slot): `over` = a produced-key whose value yields the items, `body`
// = the dispatched slot-filler on the CLOSED `bodyKinds` enum (same K1 barrier as stepKind), `combinator` closed.
function decomposeSchema( stepKinds, maxSteps, bodyKinds ) {
	const kind = (stepKinds && stepKinds.length) ? { type: 'string', enum: stepKinds } : { type: 'string' };
	const body = (bodyKinds && bodyKinds.length) ? { type: 'string', enum: bodyKinds } : { type: 'string' };
	return {
		type: 'array', minItems: 1, maxItems: maxSteps,
		items: {
			type: 'object',
			properties: {
				produces:    { type: 'string' },
				stepKind:    kind,
				instruction: { type: 'string' },
				needs:       { type: 'array', items: { type: 'string' } },
				slot:        { type: 'object', properties: {                    // OPTIONAL — present ⇒ this part is a loop
					over:       { type: 'string' },
					body:       body,
					combinator: { type: 'string', enum: SLOT_COMBINATORS }
				}, required: ['over', 'body'] }
			},
			required: ['produces', 'stepKind', 'instruction', 'needs']          // slot NOT required → plain parts unchanged
		}
	};
}

// parse a raw `slot` fail-closed: `over` cleaned to a key; `body` snapped onto bodyKinds (a MISS drops the whole slot —
// never mount an unconstrained hole); `combinator` snapped onto SLOT_COMBINATORS (a MISS → the safe default `map`).
// Returns null (⇒ degrade to a PLAIN leaf) when the slot is malformed / the body is out-of-vocab.
function parseSlot( raw, bodyKinds ) {
	if ( !raw || typeof raw !== 'object' ) return null;
	const over = keyOf(raw.over);
	if ( !over ) return null;                                                   // a loop with no items source is malformed
	const bsnap = (bodyKinds && bodyKinds.length) ? canonValue(raw.body, { enum: bodyKinds }) : { value: raw.body };
	if ( bsnap.miss || raw.body == null || raw.body === '' ) return null;       // body∉vocab → fail-closed DROP (plain leaf)
	const csnap = canonValue(raw.combinator, { enum: SLOT_COMBINATORS, default: 'map' });
	const slot = { over: over, body: bsnap.value, combinator: csnap.miss ? 'map' : csnap.value };
	if ( csnap.miss && raw.combinator != null && raw.combinator !== '' ) { slot.combinatorMiss = true; slot.combinatorRaw = String(raw.combinator); }
	return slot;
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
	const bodyKinds = opts.bodyKinds || [];
	const maxSteps  = opts.maxSteps || 8;
	const minSteps  = opts.minSteps || 0;
	const system    = (opts.system || DECOMPOSE_SYSTEM) + (opts.hint ? ' ' + opts.hint : '');
	const schema    = decomposeSchema(stepKinds, maxSteps, bodyKinds);

	const givenKeys = (opts.givenKeys || []).map(keyOf);

	// the OFFLINE plan validation (gap iii + the P0-critique symmetric): granularity floor + cited-never-produced
	// keys (a need that is neither some part's produces nor a given = a phantom the projection would drop → the
	// consuming leaf computes blind). Both feed ONE bounded re-ask with an explicit blame.
	function problemsOf( raw ) {
		const produced = new Set(raw.map(( s ) => keyOf(s.produces) ));
		const uncovered = [];
		for ( const s of raw ) for ( const n of (Array.isArray(s.needs) ? s.needs : []).map(keyOf) )
			if ( n && !produced.has(n) && givenKeys.indexOf(n) < 0 && n !== keyOf(s.produces) ) uncovered.push(n);
		return { tooCoarse: !!(minSteps && raw.length < minSteps), uncovered: Array.from(new Set(uncovered)) };
	}

	return async function decompose( task, ctx ) {
		const user = typeof task === 'string' ? task : ((ctx && ctx.statement) || JSON.stringify(task));
		const askOnce = ( sys ) => opts.ask({ system: sys, user: user, grammar: { jsonSchema: schema }, maxTokens: opts.maxTokens || 700, temperature: 0 });
		let raw = parseSteps(await askOnce(system)).slice(0, maxSteps);
		let probs = problemsOf(raw);
		// ONE bounded re-ask on a validation miss; keep the attempt with fewer uncovered keys (then finer). The check
		// only has teeth when the host declares its vocabulary: no givenKeys ⇒ only the granularity floor fires.
		if ( probs.tooCoarse || (givenKeys.length && probs.uncovered.length) ) {
			if ( opts.onReask ) opts.onReask({ task: user, firstCount: raw.length, minSteps: minSteps, uncovered: probs.uncovered });
			const blame = ' PREVIOUS ATTEMPT REJECTED:'
				+ (probs.tooCoarse ? ' only ' + raw.length + ' part(s) — TOO COARSE, emit AT LEAST ' + minSteps + ' parts, each ONE small operation, chained via "needs".' : '')
				+ (givenKeys.length && probs.uncovered.length ? ' these "needs" keys are produced by NO part and are NOT givens: ['
					+ probs.uncovered.join(', ') + '] — either add a part that produces each, cite a listed given key, or restate the fact as a number in the instruction (rule 7).' : '');
			const raw2 = parseSteps(await askOnce(system + blame)).slice(0, maxSteps);
			const probs2 = problemsOf(raw2);
			const better = probs2.uncovered.length < probs.uncovered.length
				|| (probs2.uncovered.length === probs.uncovered.length && (probs.tooCoarse && !probs2.tooCoarse))
				|| (probs2.uncovered.length === probs.uncovered.length && probs2.tooCoarse === probs.tooCoarse && raw2.length > raw.length);
			if ( better ) { raw = raw2; probs = probs2; }
		}
		const seen = Object.create(null);
		const leaves = [];
		for ( const s of raw ) {
			let key = keyOf(s.produces);
			while ( seen[key] ) key = key + '_2';                    // uniquify a duplicated produced key (rebalance would dedupe identical, but a distinct write key keeps needs unambiguous)
			seen[key] = true;
			const snap = stepKinds.length ? canonValue(s.stepKind, { enum: stepKinds }) : { value: s.stepKind };
			const request = { id: key, kind: snap.miss ? null : snap.value };
			if ( snap.miss ) { request.kindMiss = true; request.kindRaw = String(s.stepKind); }
			const slot = parseSlot(s.slot, bodyKinds);                   // the method-slot (higher-order need), fail-closed
			if ( slot ) request.slot = slot;
			const needs = (Array.isArray(s.needs) ? s.needs : []).map(keyOf).filter(( n ) => n !== key );
			if ( slot && slot.over !== key && !needs.includes(slot.over) ) needs.push(slot.over);   // `over` rides the needs channel (resolution+gate+coverage)
			leaves.push({ id: 'n_' + key, request: request, nl: String(s.instruction == null ? '' : s.instruction), readsExtra: needs });
		}
		if ( !leaves.length )                                        // never crash the loop: degrade to a single atomic leaf (the whole task)
			leaves.push({ id: 'n_task', request: { id: 'task', kind: null }, nl: user, readsExtra: [] });
		return leaves;
	};
}

// leaves → a context-project roadmap (à-nu use of the projection directly, without plan-loop). produces = the write
// key; needs = readsExtra restricted to keys some leaf produces OR a given key (givens = { key: value } — the
// projection pre-satisfies those; any other external readsExtra is context, not a gate). ──
function leavesToRoadmap( leaves, givens ) {
	givens = givens || {};
	const produced = new Set(leaves.map(( l ) => l.request && l.request.id ).filter(Boolean));
	return leaves.map(( l ) => {
		const step = { id: l.request.id, produces: l.request.id, nl: l.nl,
			needs: (l.readsExtra || []).filter(( n ) => produced.has(n) || n in givens ) };
		if ( l.request.slot ) step.slot = l.request.slot;                // carry the method-slot through to the projection
		return step;
	});
}

// ── the ARCHETYPE ROUTER (study §6.2/§6.3): type-of-prompt → best decomposition organization. A prompt is first
// classified into a decomposition ARCHETYPE (grammar-constrained, closed enum, fail-closed), then the matching
// per-archetype ORIENTATION (`hint`) steers `makeDagDecompose` toward the structure that archetype justifies
// (chain / fan-out / layered DAG / fan-out+merge / general DAG). The type→scheme map is a well-motivated PRIOR
// (the study's caveat: not a proven law — same-model inflation, thin cross-model evidence); this wires the DECISION
// mechanism, not a claim of optimality. ──
const ARCHETYPES = ['sequential', 'extraction', 'multihop', 'aggregate', 'planning'];
const ARCHETYPE_HINTS = {
	sequential: 'This is SEQUENTIAL reasoning (each step feeds the next): emit a CHAIN — each part needs AT MOST the single previous part.',
	extraction: 'This is INDEPENDENT extraction/transformation of many items: emit parts with EMPTY "needs" (a pure fan-out); add one final aggregating part only if a single combined output is required.',
	multihop:   'This is MULTI-HOP gathering: emit the independent gather parts in ONE parallel layer (no "needs" among them), then a SINGLE combine part that needs them.',
	aggregate:  'This is DECOMPOSE-then-AGGREGATE: emit the independent producer parts (empty "needs"), then EXACTLY ONE final part whose "needs" lists ALL of them and merges them.',
	planning:   'Emit the dependency DAG directly: each part references by key the outputs it consumes; keep independent parts free of needs so they run in parallel.',
};
function detectSystem( archetypes ) {
	return 'Classify the task into EXACTLY ONE decomposition archetype and reply with ONLY the label. Labels: ' +
		archetypes.join(' | ') + '. Guidance — sequential: each step strictly feeds the next; extraction: many ' +
		'independent items of the same type; multihop: gather from several sources then combine; aggregate: produce ' +
		'independent pieces then merge into one; planning: a general step/tool plan with mixed dependencies.';
}

/**
 * makeArchetypeRouter(opts) → { detect(task), route(task) -> {archetype,hint,leaves}, decompose(task) -> leaves }
 * `decompose` is the plan-loop seam (detect → steer → emit the DAG). `route` also surfaces the detected archetype.
 * @param opts.ask       grammar-capable ask (REQUIRED). @param opts.stepKinds closed step-kind enum (passed through).
 * @param opts.archetypes / opts.hints  override the archetype vocabulary / their orientation lines (usable à nu).
 * @param opts.fallback  archetype used when detection misses (default 'planning' — the general DAG, always safe).
 */
function makeArchetypeRouter( opts ) {
	opts = opts || {};
	if ( typeof opts.ask !== 'function' ) throw new Error('makeArchetypeRouter needs opts.ask({system,user,grammar}) -> string');
	const archetypes = opts.archetypes || ARCHETYPES;
	const hints      = opts.hints || ARCHETYPE_HINTS;
	const fallback   = opts.fallback || (archetypes.indexOf('planning') !== -1 ? 'planning' : archetypes[0]);

	async function detect( task, ctx ) {
		const user = typeof task === 'string' ? task : ((ctx && ctx.statement) || JSON.stringify(task));
		const out = await opts.ask({ system: detectSystem(archetypes), user: user, grammar: { jsonSchema: { type: 'string', enum: archetypes } }, maxTokens: 8, temperature: 0 });
		let raw; try { raw = JSON.parse(out); } catch ( _e ) { raw = String(out).trim().replace(/^["']|["']$/g, ''); }
		const snap = canonValue(raw, { enum: archetypes, default: fallback });   // fail-closed to the safe default
		return snap.miss ? fallback : snap.value;
	}
	async function route( task, ctx ) {
		const archetype = await detect(task, ctx);
		const hint = hints[archetype] || '';
		const leaves = await makeDagDecompose({ ask: opts.ask, stepKinds: opts.stepKinds, maxSteps: opts.maxSteps, hint: hint })(task, ctx);
		return { archetype: archetype, hint: hint, leaves: leaves };
	}
	async function decompose( task, ctx ) { return (await route(task, ctx)).leaves; }
	return { detect: detect, route: route, decompose: decompose, archetypes: archetypes, hints: hints };
}

module.exports = { makeDagDecompose, makeArchetypeRouter, leavesToRoadmap, decomposeSchema, parseSlot, SLOT_COMBINATORS, DECOMPOSE_SYSTEM, ARCHETYPES, ARCHETYPE_HINTS, keyOf };
