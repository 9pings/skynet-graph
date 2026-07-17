'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 *
 * RECORD the head-to-head on a REAL model → transcript.json   (needs a GPU; run.js replays it offline)
 *
 *   LD_LIBRARY_PATH=/usr/lib/wsl/lib:/usr/lib/x86_64-linux-gnu node examples/head-to-head/record.js
 *
 * WHAT THIS IS. Classic problems that language models are known to get wrong. Each is asked TWICE of the
 * SAME 9.5 GB local model: once the ordinary way (just ask it), and once through skynet-graph. Every prompt
 * sent and every reply received is recorded verbatim, together with the right answer, so the replay can show
 * a reader exactly what happened rather than asserting that something happened.
 *
 * THE DEAL (owner, 2026-07-17): whatever comes back ships. If the graph fails a classic, the failure is in
 * the transcript and on the website — a refuted claim is deleted the day it falls, and a demo that only
 * records its wins is an advert, not evidence.
 */
const fs = require('fs');
const path = require('path');

const SG = path.join(__dirname, '..', '..');
const { makeLocalAsk } = require(path.join(SG, 'lib', 'providers', 'llm-local.js'));
const { createMcpServer, defaultTools } = require(path.join(SG, 'lib', 'sg', 'mcp.js'));
const { createPlanLoop } = require(path.join(SG, 'lib', 'index.js')).factories;
const D = require('../integrated-demo/_data.js');        // the real FinQA report + the forged stock
const S = require('../integrated-demo/_surface.js');     // the SAME steering surface the integrated demo runs
const Graph = require(path.join(SG, 'lib', 'index.js'));
const { nextStable } = require(path.join(SG, 'lib', 'authoring', 'core', 'supervise.js'));
const { loadPlugin, resolvePlugins } = require(path.join(SG, 'lib', 'plugins'));
const { buildConceptTree } = require(path.join(SG, 'lib', 'authoring', 'core', 'concepts.js'));

/**
 * Boot the letters graph: reason-kernel + this demo's own four-line concept set (concepts/letters/Hit.json).
 * A host deposits a grammar and the engine does the counting — that is the shape the product actually has.
 */
function bootLetters( word ) {
	const cfg = resolvePlugins([loadPlugin(path.join(SG, 'plugins', 'reason-kernel'))]);
	Graph._providers = cfg.providers;                                    // the kernel's Ledger bricks
	const letters = buildConceptTree(path.join(__dirname, 'concepts', 'letters'));
	const nodes = [{ _id: 'ledger', isLedger: true, hits: [] }]
		.concat(word.split('').map(( ch, i ) => ({ _id: 'l' + i, isThought: true, ch }) ));
	const g = new Graph({ lastRev: 0, segments: [], freeNodes: [], nodes },
		{ label: 'head-to-head-letters', isMaster: true, autoMount: true,
			conceptSets: cfg.conceptSets.concat(['letters']), bagRefManagers: {}, logLevel: 'error' },
		Object.assign({}, cfg.conceptMap, { letters }));
	const settle = async () => {
		for ( let i = 0; i < 60; i++ ) {
			await nextStable(g);
			if ( !g._unstable.length && !g._triggeredCastCount ) {
				await new Promise(( r ) => setImmediate(r) );
				if ( !g._unstable.length && !g._triggeredCastCount ) return;
			}
		}
		throw new Error('the letters graph did not settle');
	};
	const fact = ( id, k ) => g._objById[id] && g._objById[id]._etty._[k];
	return { g, settle, fact,
		ingest: ( p ) => new Promise(( r ) => g.ingest(p, r) ),
		// the ACTIVE count, read off the ledger: appends only, retractions included (the C9 convention).
		count: () => (fact('ledger', 'hits') || []).length - (fact('ledger', 'hitsRetracted') || []).length,
		close: () => { if ( g.destroy ) g.destroy(); } };
}

const MODEL = process.env.DEMO_MODEL || path.join(SG, 'models', 'Qwen3.6-27B-UD-IQ2_XXS.gguf');
const MODEL_NAME = 'Qwen3.6-27B-IQ2_XXS (9.5 GB, the crippled quant)';
// reasoningBudget 0: on Qwen3.6 maxTokens is a TOTAL ceiling and <think> eats it (measured, 3 times).
const baseAsk = makeLocalAsk({ modelPath: MODEL, reasoningBudget: 0, contextSize: 8192, seed: 0 });

// every exchange, verbatim — this is the whole point of the recording
let LOG = [];
const ask = async ( q ) => {
	const t0 = Date.now();
	const reply = await baseAsk(q);
	LOG.push({ system: q.system || '', user: q.user, reply: String(reply), ms: Date.now() - t0 });
	return reply;
};
const take = () => { const l = LOG; LOG = []; return l; };

const num = ( s ) => { const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g); return m ? m[m.length - 1] : null; };

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CLASSIC 1 — "which is bigger, 9.11 or 9.9?" The one everybody has seen a model get wrong.
//   alone       : ask it.
//   with graph  : self-consistency — sample k paths, snap each answer, let the margin gate decide.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
async function classicDecimal() {
	const question = 'Which number is bigger: 9.11 or 9.9? Answer with just the number.';
	const truth = '9.9';

	const aloneReply = await ask({ system: 'You are a helpful assistant. Answer concisely.', user: question, maxTokens: 200, temperature: 0 });
	const alone = { calls: take(), answer: (String(aloneReply).match(/9\.11|9\.9/) || [null])[0] };

	const tool = defaultTools({ critiqueAsk: ask }).find(( t ) => t.name === 'self_consistency' );
	const r = await tool.call({ question: 'Which number is bigger: 9.11 or 9.9?', k: 5 });
	const withg = { calls: take(), answer: r.verdict, detail: r };

	return { id: 'decimal', truth, question,
		title: 'Which is bigger: 9.11 or 9.9?',
		why: 'The famous one. Models read "9.11 > 9.9" because 11 > 9 — the version-number reflex. It is one line, everyone can check it, and a model that gets THIS wrong is telling you something about every other number it hands you.',
		how: 'Through the graph: ask the same model 5 independent times, snap each reply to a plain class, and let it answer only if one class wins by a clear margin.',
		alone, withg };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CLASSIC 2 — "how many r's in strawberry?" A tokenizer problem: the model never sees the letters.
//   alone       : ask it.
//   with graph  : the graph SPLITS the word and holds each letter as its own fact — then hands the model
//                 the CHARACTER, not a position. "Is 'w' the letter r?" is a question it can answer;
//                 "is letter number 5 an r?" is the impossible task all over again. (Owner, 07-17 — the
//                 first cut asked by POSITION and made things worse: the piece has to be one the model
//                 can actually do, and making the letters VISIBLE is the graph's job, not the model's.)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
async function classicCount() {
	const word = 'strawberry';
	const truth = '3';
	const question = 'How many times does the letter "r" appear in the word "strawberry"? Answer with just the number.';

	const aloneReply = await ask({ system: 'You are a helpful assistant. Answer concisely.', user: question, maxTokens: 200, temperature: 0 });
	const alone = { calls: take(), answer: num(aloneReply) };

	// THE HOST splits the word into facts — a string op is not a reasoning task, and pretending the engine
	// does it would be a lie (the previous comment here claimed exactly that). What the host does NOT do is
	// the counting: each letter is a node carrying its character, the model judges ONE visible character at
	// a time, and every "yes" casts Hit → the kernel's Ledger::tally appends it to `ledger.hits`. The answer
	// is read OFF the graph. (It used to be `leaves.reduce(...)` right here: the JS computed the result and
	// the model was decoration. Owner, 07-17 — the graph must orchestrate, not hard-coded js.)
	const L = bootLetters(word);
	await L.settle();
	const patch = {};
	for ( let i = 0; i < word.length; i++ ) {
		const out = await ask({ system: 'Answer with exactly one word: yes or no.',
			user: 'Is the character "' + word[i] + '" the letter "r"? Answer yes or no.',
			maxTokens: 8, temperature: 0 });
		patch['l' + i] = { verdict: /yes/i.test(String(out)) ? 'yes' : 'no' };   // the host writes what it SAID
	}
	await L.ingest(patch);
	await L.settle();
	const counted = L.count();
	// the live half, and the reason this is a ledger and not a sum: retract one judgment and the count
	// re-derives itself — the entry untallies, the retraction is appended, nothing is spliced out.
	await L.ingest({ l2: { verdict: 'no' } });
	await L.settle();
	const afterRetraction = L.count();
	const withg = { calls: take(), answer: String(counted),
		detail: { hits: L.fact('ledger', 'hits') || [], countedOnGraph: counted, afterRetraction } };
	L.close();

	return { id: 'count', truth, question,
		title: 'How many r\'s in "strawberry"?',
		why: 'The other famous one. A model does not see letters — it sees chunks ("straw" + "berry"), so a question about spelling is a question about something it was never shown. No amount of extra model fixes that: the letters were never there to look at.',
		how: 'Through the graph: the word is split into facts — one node per letter, carrying the character. That '
			+ 'split is a plain string op done by the host, and it is deliberately not the model\'s job. The model is '
			+ 'then shown one CHARACTER at a time — "is \'w\' the letter r?" — which is a question it can actually '
			+ 'answer. Each "yes" tallies onto the ledger through the kernel, so the count is a fact the ENGINE '
			+ 'derives from the model\'s own judgments, not a sum in the demo script. And it stays live: retract one '
			+ 'judgment and the count re-derives itself, with the retraction kept on the record.',
		alone, withg };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CLASSIC 3 — a deep word problem (many chained steps). THE flagship claim: 0/33 whole vs 10/33 in pieces.
//   alone       : hand it the whole thing.
//   with graph  : a typed plan; each step sees only its own inputs; the graph carries the values across.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
async function classicDeepMath() {
	const question = 'A bakery sells 34 loaves on Monday. On Tuesday it sells 12 more than Monday. '
		+ 'On Wednesday it sells half of Tuesday. On Thursday it sells 8 fewer than Wednesday. '
		+ 'Each loaf costs 3 dollars. How many dollars did the bakery take over the four days?';
	// 34 + 46 + 23 + 15 = 118 loaves × 3 = 354
	const truth = '354';

	const aloneReply = await ask({ system: 'You are a helpful assistant. Answer with just the final number.', user: question, maxTokens: 400, temperature: 0 });
	const alone = { calls: take(), answer: num(aloneReply) };

	// The typed plan: each step is ONE arithmetic move and sees only the values it declared it needs.
	//
	// THE CUT IS SUPPLIED, and that is not a shortcut being hidden — it is the measured finding. "The small
	// model as the task CUTTER" is REFUTED (R1a, measured; docs/CAPABILITIES.md: "the cutter/executor split is
	// measured, not assumed — the small model is *not* the task cutter"). Handing this quant the job of
	// decomposing would demo a claim the project has already retracted. What IS measured, and what this shows,
	// is the EXECUTOR half: given the cut, running it in bounded pieces holds (10/33) where the same model on
	// the whole prompt collapses (0/33).
	const STEPS = [
		{ id: 'mon', nl: 'Monday: the bakery sold 34 loaves. How many loaves on Monday?', needs: [] },
		{ id: 'tue', nl: 'Tuesday it sold 12 MORE loaves than Monday. Monday was {mon}. How many on Tuesday?', needs: ['mon'] },
		{ id: 'wed', nl: 'Wednesday it sold HALF of Tuesday. Tuesday was {tue}. How many on Wednesday?', needs: ['tue'] },
		{ id: 'thu', nl: 'Thursday it sold 8 FEWER than Wednesday. Wednesday was {wed}. How many on Thursday?', needs: ['wed'] },
		{ id: 'loaves', nl: 'Add these four numbers: {mon}, {tue}, {wed}, {thu}. What is the total?', needs: ['mon', 'tue', 'wed', 'thu'] },
		{ id: 'money', nl: 'Each loaf costs 3 dollars and {loaves} loaves were sold. How many dollars in total?', needs: ['loaves'] },
	];
	const loop = createPlanLoop({
		decompose: async () => STEPS.map(( s ) => ({ id: 'n_' + s.id, request: { id: s.id }, nl: s.nl, readsExtra: s.needs }) ),
		serveLeaf: async ( lf ) => {
			const spec = STEPS.find(( s ) => s.id === lf.request.id );
			// THE BOUNDED PROMPT: the step's own instruction with its inputs filled in. It never sees the
			// story, the other steps, or anything it did not ask for.
			let q = spec.nl;
			for ( const k of spec.needs ) q = q.replace('{' + k + '}', String((lf.inputs || {})[k]));
			const out = await ask({ system: 'You do ONE arithmetic step. Answer with just the number, nothing else.', user: q, maxTokens: 24, temperature: 0 });
			return num(out);
		},
		fold: ( leaves ) => { const m = leaves.find(( l ) => l.request && l.request.id === 'money' ); return m ? String(m.value) : null; },
	});
	const r = await loop.run(question);
	const withg = { calls: take(), answer: r.answer == null ? null : String(r.answer) };

	return { id: 'deepmath', truth, question,
		title: 'A word problem with six chained steps',
		why: 'Not a trick — just long. Each step feeds the next, so one slip anywhere poisons the answer. This is exactly where a small model asked all at once falls apart: measured over 33 problems this deep, it got 0 of them right.',
		how: 'Through the graph: one arithmetic move per call. Each step is handed only the numbers it asked for — '
			+ 'never the story, never the other steps — and the graph carries the values between them. The cut itself '
			+ 'is supplied, not invented by this model: that this quant makes a poor task-cutter is a measured, '
			+ 'published negative. What is being shown is the other half — that executing the pieces holds where '
			+ 'the whole prompt collapses.',
		alone, withg };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CLASSIC 4 — a REAL question about a REAL annual report (FinQA). This is the certified-steering claim:
//   alone       : hand it the table and the question.
//   with graph  : the forged stock says which SHAPE this class of question takes (subtract>divide —
//                 admitted at the forge behind the 0-false gate). We do not tell it the answer; we tell
//                 it the shape, and it fills it in one step at a time.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
async function classicFinqa() {
	// MECHANICAL selection, announced: the FIRST covered+table-resolvable question in file order. The old
	// version picked the item whose GOLD shape matched a procedure it then hard-coded — that is choosing the
	// question to fit the answer, and it is how a demo manufactures a result. The gold is used for ONE thing
	// here: scoring, after the fact.
	const { report, certified, items } = D.pickReport();
	const it = items[0];
	const tbl = it.table.map(( r ) => r.join(' | ') ).join('\n');
	const truth = String(Math.round(it.exeAns * 10000) / 10000);          // the gold, quoted to 4dp

	const aloneReply = await ask({ system: 'You are a financial analyst. Answer with just the number.',
		user: 'Table from the ' + report + ' annual report:\n' + tbl + '\n\nQuestion: ' + it.problem
			+ '\nAnswer with just the number (a decimal fraction, not a percentage).', maxTokens: 400, temperature: 0 });
	const alone = { calls: take(), answer: num(aloneReply) };

	// STEERED — the REAL surface, the same one the integrated demo runs (`sg mcp` + the forged stock):
	//   1. the model is handed the table and the MENU of certified shapes from the stock — never the gold,
	//      never the operands. IT emits the ordered program (which op, which numbers).
	//   2. the HARD `propose` lane gates that emission: the shape must be in the frozen referential AND every
	//      literal must trace back to a cell of THIS table (the provenance check — an invented number is
	//      refused, by name).
	//   3. a refusal comes back with the blame and the admissible options ENUMERATED THROUGH the gate; the
	//      model gets exactly one bounded revision.
	// (The old version did none of this: two hand-written prompts, the shape copied off the gold, and the
	//  divisor 991.1 fed to the model in the prompt — which walks straight past the provenance gate that is
	//  the actual mechanism. It could not fail, and it proved nothing.)
	const forcedLog = [];
	const wiring = S.createWiring({ certified, tableOf: () => it.table, forcedLog });
	const srv = createMcpServer({ tools: defaultTools(wiring), serverInfo: { name: 'head-to-head', version: '1' } });
	let rpcId = 0;
	const call = async ( name, args ) => {
		const res = await srv.handle({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args || {} } });
		if ( res.error || res.result.isError ) throw new Error(name + ': ' + JSON.stringify(res.error || res.result.content[0].text));
		return JSON.parse(res.result.content[0].text);
	};

	let steps = await S.emitProgram(ask, it, certified);
	let v = await call('propose', { proposal: { stepId: 'q', steps } });
	const refusals = [];
	if ( v.status !== 'admitted' ) {                       // ONE bounded revision, steered by the gate's own blame
		refusals.push({ blame: v.blame, options: (v.options || []).map(( o ) => o.shape ) });
		steps = await S.emitProgram(ask, it, (v.options || []).map(( o ) => o.shape ), v.blame);
		v = await call('propose', { proposal: { stepId: 'q', steps } });
		if ( v.status !== 'admitted' ) refusals.push({ blame: v.blame, options: (v.options || []).map(( o ) => o.shape ) });
	}
	const a = S.analyze(steps, it.table, certified);
	// admitted → the value the model's own program computes. Refused → NO answer: the gate does not yield,
	// and a refusal is a legitimate outcome that must show up in the score as one.
	const withg = { calls: take(), answer: v.status === 'admitted' && a.ok ? String(a.value) : null,
		detail: { status: v.status, shape: a.shape || null, program: a.program || null, refusals } };

	return { id: 'finqa', truth, question: it.problem, tol: 0.00005,
		title: 'A real question about a real annual report',
		why: 'Not a puzzle — the actual job. A real table from a real utility\'s 2008 report, and a question an '
			+ 'analyst would ask. The numbers are all right there; it just has to pick the right two and do the right things to them.',
		how: 'Through the graph: the forged stock carries the op-sequences certified for this domain — mined from '
			+ 'solved examples and admitted only when they matched the checker every time. We hand the model that '
			+ 'MENU of shapes and the table, and it emits the program itself. The gate then refuses any shape outside '
			+ 'the referential, and any number it cannot trace to a cell of this table. We never tell it the answer, '
			+ 'the operands, or which shape to use.',
		alone, withg };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
	const cases = [];
	for ( const fn of [classicDecimal, classicCount, classicDeepMath, classicFinqa] ) {
		process.stdout.write('  recording ' + fn.name + ' … ');
		const t0 = Date.now();
		const c = await fn();
		// NUMERIC comparison with the case's own tolerance — a string compare called -0.03218141 "wrong"
		// against a gold of -0.0322 when they are the SAME number to 4dp (caught 07-17; a false positive
		// is worse than no demo: it manufactures a win the model did not need us for).
		const same = ( a, b, tol ) => {
			if ( a == null ) return false;
			const x = Number(a), y = Number(b);
			if ( isFinite(x) && isFinite(y) ) return Math.abs(x - y) <= (tol == null ? 1e-9 : tol);
			return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
		};
		c.aloneRight = same(c.alone.answer, c.truth, c.tol);
		c.withRight = same(c.withg.answer, c.truth, c.tol);
		cases.push(c);
		console.log(((Date.now() - t0) / 1000).toFixed(1) + 's · alone ' + (c.aloneRight ? 'RIGHT' : 'wrong → ' + c.alone.answer)
			+ ' · with-graph ' + (c.withRight ? 'RIGHT' : 'wrong → ' + c.withg.answer));
	}
	const out = { recordedWith: MODEL_NAME, note: 'Real prompts and real replies from a real local model. Whatever it answered is what is here.', cases };
	fs.writeFileSync(path.join(__dirname, 'transcript.json'), JSON.stringify(out, null, 1));
	console.log('\nwrote examples/head-to-head/transcript.json — replay: node examples/head-to-head/run.js');
	process.exit(0);
})().catch(( e ) => { console.error('RECORD FAIL:', e.stack || e.message); process.exit(1); });
