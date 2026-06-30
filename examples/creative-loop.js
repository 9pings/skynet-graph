/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * creative-loop — the authoring "creative loop" used À NU (no LLM, deterministic, runnable):
 *
 *     node examples/creative-loop.js
 *
 * The supervisor names an ABSTRACT mechanism (a target FrontierSignature); the learned method LIBRARY answers;
 * recombination is the creative step. Five tools, each reachable via the `Graph.authoring` barrel (and each
 * importable on its own, e.g. require('skynet-graph/lib/authoring/library')):
 *
 *   1. crystallize  — distil a recurrent STRUCTURAL cast into a re-mountable, defeasible METHOD (the cold step).
 *   2. library      — index methods by their FrontierSignature; dispatch = O(1) bucket lookup (NOT a corpus search).
 *   3. adapt        — retrieve-or-forge: a HIT replays at 0 calls; a miss FORGES content (antiUnify content-forge),
 *                     then amortises so the next encounter hits.
 *   4. combinator   — mount a dispatched method under a DIFFERENT concept (cross-concept reuse).
 *   5. blend        — COMBINATIONAL creativity: graft one method into another → a NEW composite method.
 *
 * The "model" here is a deterministic stub so the demo runs offline; a host swaps in a real `ask` (see
 * lib/providers/llm.js) exactly where noted. Everything is host-side + ZERO-CORE (the engine is untouched).
 */
'use strict';
const Graph = require('../lib');                                  // the facade
const A = Graph.authoring;                                        // the authoring barrel (parity with Graph.providers)
const { crystallizeStructural } = A.crystallize;
const { makeLibrary, indexMethod, dispatch } = A.library;
const { adaptOrForge, antiUnifyAdapt, blendMethods, synthesizeByBlend, methodDepth } = A.adapt;
const { nextStable } = A.supervise;
const { digest } = Graph.providers.canonicalize || require('../lib/providers/canonicalize.js');

const log = ( ...a ) => console.log(...a);
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, extra ) => Object.assign({ _id: id, Segment: true, originNode: o, targetNode: t }, extra || {});
const DECL = { origin: { field: 'originNode' }, target: { field: 'targetNode' } };
const content = ( kind ) => 'plan-' + kind;                       // the ground-truth method content (what the model forges)

// ── the cold method: a provider that DECOMPOSES a segment into origin → mid → target. In a real host this is the
// model deriving a sub-graph; here it is deterministic so the example runs offline. ──
const Refine = { refine( g, c, scope, argz, cb ) {
	const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
	cb(null, [
		{ $_id: '_parent', Refine: true, Refined: true },
		{ _id: mid, Node: true, state: content(scope._.kind) },
		{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
		{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
	]);
} };
const REFINE_TREE = { childConcepts: { Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] } } };

async function main() {
	// ════ 1. CRYSTALLIZE — learn a re-mountable, defeasible method from ≥2 recurrent casts ════
	const nodes = [], segments = [];
	['hard', 'easy'].forEach(( k, ki ) => { for ( let s = 0; s < 2; s++ ) { const a = `L${ki}${s}a`, b = `L${ki}${s}b`; nodes.push(node(a), node(b)); segments.push(seg(`LE${ki}${s}`, a, b, { kind: k })); } });
	const res = await crystallizeStructural({ episodeTree: REFINE_TREE, seed: { lastRev: 0, nodes, segments },
		providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'Split', declaredFrontier: DECL });
	const method = res.candidate;
	log('1. CRYSTALLIZE  → learned method "%s"  signatureKeys=%j  contract=%s', method.schema._id,
		method.signatureKeys, method.schema.contract ? 'yes (born defeasible)' : 'no');

	// ════ 2. LIBRARY — index by FrontierSignature; dispatch = O(1) bucket lookup ════
	const lib = makeLibrary();
	indexMethod(lib, method);
	const target = { frontier: method.schema.frontier, signatureKeys: method.signatureKeys };
	const r = dispatch(lib, target, { Segment: true, kind: 'hard' });
	log('2. LIBRARY      → dispatch found %d candidate(s); scanned %d of %d (a LOOKUP, not a corpus search)',
		r.candidates.length, r.scanned, r.total);

	// ════ 3. ADAPT (retrieve-or-forge) — a seen signature HITS at 0 calls; a novel one FORGES content + amortises ════
	const calls = { n: 0 };
	// the host's content-forger: fills ONLY the auto-discovered content holes for a new signature (the "model").
	const contentFor = ( holes, scope ) => { calls.n++; const v = {}; for ( const h of holes ) v[h.path] = content(scope.kind); return v; };
	const hit = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'hard' }, adaptContent: contentFor });
	log('3. ADAPT        → seen kind "hard": outcome=%s, model calls=%d', hit.outcome, hit.calls);
	const adapted = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, adaptContent: contentFor });
	log('                → novel kind "medium": outcome=%s (antiUnify content-forge), model calls=%d', adapted.outcome, adapted.calls);
	const again = adaptOrForge({ lib, target, scopeFacts: { Segment: true, kind: 'medium' }, adaptContent: contentFor });
	log('                → "medium" again: outcome=%s, model calls=%d (AMORTISED — total model calls so far: %d)', again.outcome, again.calls, calls.n);

	// ════ 4. COMBINATOR — mount the learned method under a DIFFERENT concept, at 0 calls (cross-concept reuse) ════
	const D = A.combinator.dispatchConcept({ name: 'Decompose', require: ['Segment', 'kind', 'toDecompose'],
		target, frontierFields: { origin: 'originNode', target: 'targetNode' }, lib });
	Graph._providers = { Combinator: { Decompose: D.provider } };           // Refine's OWN provider is NOT wired
	const g = new Graph({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [seg('Z', 'X', 'Y', { kind: 'hard', toDecompose: true })] },
		{ label: 'demo', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: { childConcepts: { Decompose: D.schema } } });
	await nextStable(g);
	log('4. COMBINATOR   → concept "Decompose" REUSED "Split" (learned under Refine) at the site Z: mid Z_m0.state=%j (0 model calls)',
		g._objById['Z_m0'] && g._objById['Z_m0']._etty._.state);

	// ════ 5. BLEND — combinational creativity: synthesize a NOVEL composite method from library parts, 0 calls ════
	const blended = blendMethods(method, method);                           // graft "Split" into its own slot → 2-level
	log('5. BLEND        → blended "%s" + "%s" → a depth-%d method (contract %s)', method.schema._id, method.schema._id,
		methodDepth(blended), blended.contractDerived ? 'DERIVED from both' : 'inherited');
	// the controller can AUTO-DISCOVER a blend to reach a goal (bounded μ-descent → terminates):
	const synth = synthesizeByBlend({ lib, target, scopeFacts: { Segment: true, kind: 'hard' },
		satisfies: ( c ) => methodDepth(c) >= 3, maxDepth: 4 });
	log('                → synthesizeByBlend(goal: depth≥3): outcome=%s, depth=%d, model calls=%d (compositional synthesis — beyond any cache)',
		synth.outcome, synth.depth, synth.calls);

	log('\nDONE — the creative loop ran offline. Swap `contentFor` / the cold provider for a real model (lib/providers/llm.js) to forge genuinely-new content.');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
