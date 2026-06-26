/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — a TYPED-DOMAIN concept corpus that GROUNDS the problem-paths search. The generic grammar
 * (Plan→Select→Resolve→Reselect→Summarize, with the `reached` adjacency spine + backtracking) is
 * domain-agnostic SEARCH; a domain corpus supplies the STRUCTURE so a small local model only fills
 * genuine gaps. Faithful to `doc/WIP/orientations-corpus-concepts.md` (the R2 guard: rules ORCHESTRATE /
 * the LLM JUDGES) and the canonicalization barrier (states are typed by a discrete `kind` ENUM, never
 * prose): each move is keyed on `originNode:kind → targetNode:kind`.
 *
 * The corpus = a human-vocabulary VOCABULARY (an ordered chain of `kind`s) + a NAMED action per
 * adjacent transition (the deterministic operators). Composition (the doc's point (d)):
 *   - a KNOWN typed transition resolves DETERMINISTICALLY (zero LLM) — the corpus carries it;
 *   - a known compound gap decomposes through the chain DETERMINISTICALLY (a known route);
 *   - an UNKNOWN move (a missing action, or an UNTYPED endpoint) ESCALATES to the injected LLM,
 *     on that one segment only (the §3.e escalation), then the domain resumes.
 * The measured win (the K6 question the docs flag as unproven): an in-vocabulary problem is solved with
 * the SAME generic engine at ZERO LLM cost; the LLM count rises by exactly one per genuine gap.
 *
 *   DETERMINISTIC (in-vocabulary, no LLM):
 *     node examples/poc/problem-domain.js
 *   HYBRID (an untyped START the LLM must bridge into the vocabulary; thinking off):
 *     MODE=llm LLM_NO_THINK=1 LLM_BASE=http://localhost:5000 LLM_MODEL=qwen36-q2-vram node examples/poc/problem-domain.js
 */
global.__SERVER__ = true;
const { solve, pathSteps } = require('./problem-paths.js');
const { makeAsk } = require('../../lib/providers/llm.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');

// ---- the DOMAIN corpus: a software-delivery vocabulary (ordered kinds) + named transition operators ----
const KINDS = ['legacy', 'modular', 'tested', 'documented', 'packaged', 'published'];
const LABEL = {
	legacy    : 'a messy legacy monolith with no structure',
	modular   : 'cohesive modules with clear interfaces',
	tested    : 'modules covered by a passing test suite',
	documented: 'a documented API with a usage README',
	packaged  : 'a built distribution (wheel/sdist) configured by pyproject.toml',
	published : 'the package published on PyPI'
};
// the named operators — the human vocabulary of MOVES, one per adjacent kind transition (deterministic).
const ACTIONS = {
	'legacy>modular'     : 'Modularize: split the monolith into cohesive modules with clear interfaces',
	'modular>tested'     : 'AddTests: write a pytest suite covering each module',
	'tested>documented'  : 'Document: write API docs and a README with usage examples',
	'documented>packaged': 'Package: configure pyproject.toml and build the wheel/sdist',
	'packaged>published' : 'Publish: upload the built distribution to PyPI via twine'
};

const idx = ( k ) => KINDS.indexOf(k);

/**
 * The domain CONTENT — it grounds the generic search. `omit` lets a test knock out a known action to
 * exercise the LLM-escalation-at-the-gap path; `llm` is the injected fallback (deterministic stub in
 * tests, a real model in the demo). `calls` counts genuine LLM escalations.
 */
function makeDomainContent( opts ) {
	opts = opts || {};
	const omit = opts.omit || {};                       // e.g. { 'tested>documented': true } — a missing operator
	const llm  = opts.llm;                               // async ({from,to,prev}) -> step   (the escalation)
	const stats = { calls: 0, deterministic: 0, escalated: 0 };

	const C = {
		// DECOMPOSE: a typed compound gap routes deterministically through the kind chain (balanced bisection,
		// so the recursion is logarithmic + the leaves are adjacent known transitions). Untyped → escalate.
		plan: async ( ctx ) => {
			const i = idx(ctx.originKind), j = idx(ctx.targetKind);
			if ( i < 0 ) {                                                // UNTYPED origin: bridge it INTO the vocabulary
				if ( j < 0 ) return null;                                // both untyped → nothing the corpus can ground
				if ( ctx.targetKind === KINDS[0] ) return { atomic: true };   // the bridge hop itself → the LLM brings it into the chain head
				return { mids: [{ state: LABEL[KINDS[0]], kind: KINDS[0] }] };// route via the chain entry, then the pipeline takes over
			}
			if ( j < 0 || j <= i ) return null;                          // not an in-vocabulary forward move → let Resolve escalate
			if ( j - i <= 1 ) return { atomic: true };                   // a single known transition → atomic, resolved deterministically
			const mk = KINDS[i + Math.floor((j - i) / 2)];               // the balanced intermediate KIND
			return { mids: [{ state: LABEL[mk], kind: mk }] };           // one deterministic, TYPED route (no alternatives to score)
		},
		score: async () => 0,                                            // a single domain route — nothing to choose
		// RESOLVE: an adjacent known transition is the named action (deterministic). Anything else (a missing
		// action, or an untyped endpoint) ESCALATES to the injected LLM — on this one segment only.
		resolve: async ( ctx ) => {
			const i = idx(ctx.originKind), j = idx(ctx.targetKind);
			const key = ctx.originKind + '>' + ctx.targetKind;
			if ( i >= 0 && j === i + 1 && ACTIONS[key] && !omit[key] ) { stats.deterministic++; return { step: ACTIONS[key] }; }
			// gap (unknown move / untyped) → escalate to the LLM
			stats.escalated++; stats.calls++;
			const step = llm ? await llm({ from: ctx.from, to: ctx.to, prev: ctx.prev, originKind: ctx.originKind, targetKind: ctx.targetKind })
				: `(no operator and no LLM for ${key})`;
			return { step: typeof step === 'string' ? step : (step && step.step) };
		},
		summarize: async ( steps ) => `Delivery plan (${steps.length} steps): ` + steps.join('  →  ')
	};
	C.stats = stats;
	return C;
}

// ---- the LLM escalation client (real model), used for the untyped/gap segments only ----
function makeLLMEscalation() {
	const ask = makeAsk({ base: process.env.LLM_BASE || 'http://localhost:5000', api: 'openai', model: process.env.LLM_MODEL || 'qwen36-q2-vram' });
	return async ( ctx ) => (await ask({ system: 'Describe concretely, in ONE sentence, how to move from the START state to the GOAL state. Continue from the previous step; do not repeat it.', user: `PREVIOUS: ${ctx.prev}\nSTART: ${ctx.from}\nGOAL: ${ctx.to}`, maxTokens: 200 })).trim();
}

async function main() {
	const mode = process.env.MODE || 'stub';
	out(`\nFLAGSHIP problem-domain — a typed software-delivery corpus grounding the generic search  (mode=${mode})`);
	out(`  vocabulary (kinds): ${KINDS.join(' → ')}\n`);

	// (1) a fully IN-VOCABULARY problem: the corpus carries the whole route → ZERO LLM calls.
	out('① in-vocabulary  «legacy»  ⟶  «published»   (the corpus knows every move)');
	const Cdet = makeDomainContent({ llm: makeLLMEscalation() });
	const r1 = await solve({ start: LABEL.legacy, startKind: 'legacy', goal: LABEL.published, goalKind: 'published' }, Cdet, { maxDepth: 16, alts: 1, label: 'domain-det' });
	out(`   path (${r1.steps.length} steps):`); r1.steps.forEach((s, i) => out(`     ${i + 1}. ${s}`));
	out(`   → LLM escalations: ${Cdet.stats.calls}   (deterministic moves: ${Cdet.stats.deterministic})\n`);

	if ( mode === 'llm' ) {
		// (2) HYBRID: an UNTYPED free-form START the corpus can't classify — the LLM bridges it into the
		// vocabulary on those segments only, then the deterministic pipeline takes over.
		out('② hybrid  «a Jupyter notebook of throwaway analysis code»  ⟶  «published»   (LLM bridges the untyped start)');
		const Chy = makeDomainContent({ llm: makeLLMEscalation() });
		const r2 = await solve({ start: 'a Jupyter notebook of throwaway analysis code', goal: LABEL.published, goalKind: 'published' }, Chy, { maxDepth: 16, alts: 1, label: 'domain-hybrid' });
		out(`   path (${r2.steps.length} steps):`); r2.steps.forEach((s, i) => out(`     ${i + 1}. ${s}`));
		out(`   → LLM escalations: ${Chy.stats.calls}   (deterministic moves: ${Chy.stats.deterministic})`);
		out(`\n   SOLUTION (in-graph):\n   ${r2.solution}\n`);
	}
}

module.exports = { makeDomainContent, KINDS, LABEL, ACTIONS };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
