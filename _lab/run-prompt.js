// End-to-end "answer a (huge) prompt" loop against a local LLM server:
//   seed root segment (prompt) -> DECOMPOSE (reactive concepts) -> stabilize
//   -> SYNTHESIZE bottom-up (bounded LLM rollup) -> print root answer.
// Every concept-apply is traced; the artifact is written so `node _lab/sg.js` can inspect it.
//
//   LLM_BASE=http://localhost:8080 OBJECTIVE="..." node _lab/run-prompt.js
//   node _lab/sg.js trace /tmp/run-prompt.trace.json
const path = require('path');
const Graph = require('./_boot.js');
const { loopConceptTree, makeDecomposeProviders, synthesize } = require('./loop.js');
const { ask, parseJSON, BASE, MODEL } = require('./llm.js');
const { createTrace } = require('./trace.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');
console.log = console.info = console.warn = () => {};

const OBJECTIVE = process.env.OBJECTIVE ||
	'Explique comment authentifier et tester la sécurité d\'un Active Directory interne, de l\'accès réseau initial à la compromission Domain Admin.';
const MAX_DEPTH = Number(process.env.MAX_DEPTH || 2);
const TRACE_FILE = process.env.TRACE_FILE || '/tmp/run-prompt.trace.json';
let llmCalls = 0;

const ctx = (scope) => {
	const p = scope._.ctxPath || [];
	return `Objectif global: ${OBJECTIVE}\n` +
		`Chemin: ${p.length ? p.join(' > ') : '(racine)'}\n` +
		`Étape courante: ${scope._.label || 'RÉSOUDRE LE PROBLÈME'}\n` +
		(scope._.description ? `Détail: ${scope._.description}\n` : '') +
		`Profondeur: ${scope._.depth || 0}`;
};
const J = async (system, user) => { llmCalls++; let t = await ask({ system, user: user + '\n\nRéponds UNIQUEMENT le JSON.', maxTokens: 1500 }); return parseJSON(t); };

// ---- the injected "experts" (content), backed by the LLM ----
Graph._providers = makeDecomposeProviders({
	maxDepth: MAX_DEPTH,
	evalFn: async (scope) => {
		const r = await J('Tu juges si une étape de plan est ATOMIQUE (directement répondable) ou doit être DÉCOUPÉE. JSON: {"atomic":true|false,"reason":"court"}', ctx(scope)).catch(() => ({ atomic: true }));
		out(`  [eval d${scope._.depth || 0}] "${scope._.label}" -> ${r.atomic ? 'ATOMIC' : 'SPLIT'}`);
		return r;
	},
	expandFn: async (scope) => {
		const r = await J('Tu découpes une étape en 2 à 3 sous-étapes ORDONNÉES et concrètes. JSON: {"steps":[{"name":"court","description":"..."}]}', ctx(scope)).catch(() => ({ steps: [] }));
		out(`  [expand d${scope._.depth || 0}] "${scope._.label}" -> ${(r.steps || []).map(s => s.name).join(' | ')}`);
		// carry ctxPath down for prompt context
		const cp = [...(scope._.ctxPath || []), scope._.label];
		return (r.steps || []).map(s => ({ name: s.name, description: s.description, ctxPath: cp }));
	},
	answerFn: async (scope) => {
		const t = await ask({ system: 'Réponds à cette étape atomique de façon concise et concrète (3-5 phrases max).', user: ctx(scope), maxTokens: 600 });
		out(`  [answer d${scope._.depth || 0}] "${scope._.label}"`);
		return t.trim();
	}
});

// ---- bounded synthesis: summarize children into a fixed-size parent answer ----
const rollupFn = async (seg, childAnswers) => {
	llmCalls++;
	const t = await ask({
		system: 'Tu synthétises les réponses des sous-étapes en UNE réponse cohérente et BORNÉE (max ~6 phrases). Ne recopie pas, résume.',
		user: `Étape: ${seg.label}\n\nRéponses des sous-étapes:\n` + childAnswers.map((a, i) => `${i + 1}. ${a}`).join('\n'),
		maxTokens: 700
	});
	out(`  [rollup] "${seg.label}" <- ${childAnswers.length} children`);
	return t.trim();
};

const seed = {
	lastRev: 0,
	nodes: [{ _id: 'start', label: 'état initial' }, { _id: 'goal', label: 'objectif' }],
	segments: [{ _id: 'root', originNode: 'start', targetNode: 'goal', depth: 0, label: OBJECTIVE.slice(0, 60), ctxPath: [] }]
};

out(`Endpoint: ${BASE}  modèle: ${MODEL}  MAX_DEPTH=${MAX_DEPTH}`);
out(`Objectif: ${OBJECTIVE}\nDécomposition...\n`);

const trace = createTrace();
let done = false;
const g = new Graph(seed, {
	label: 'run-prompt', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
	onConceptApply: trace.onConceptApply,
	async onStabilize(graph) {
		if (done) return; done = true;
		out('\nSynthèse bottom-up...\n');
		const answer = await synthesize(graph, 'root', rollupFn);
		trace.write(TRACE_FILE, graph, { objective: OBJECTIVE, model: MODEL, llmCalls });
		const segs = Object.keys(graph._objById).filter(k => graph._objById[k]._etty._.Segment).length;
		out('\n=== RÉPONSE ===\n' + answer);
		out(`\n(${segs} segments, ${llmCalls} appels LLM · trace: ${TRACE_FILE} — \`node _lab/sg.js trace ${TRACE_FILE}\`)`);
		setTimeout(() => process.exit(0), 50);
	}
}, { common: loopConceptTree });

setTimeout(() => { out('\n[TIMEOUT] pas stabilisé'); process.exit(1); }, 600000);
