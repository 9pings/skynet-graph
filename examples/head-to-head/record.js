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
const { defaultTools } = require(path.join(SG, 'lib', 'sg', 'mcp.js'));
const { createPlanLoop } = require(path.join(SG, 'lib', 'index.js')).factories;

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
//   with graph  : the graph cuts the word into letters (the CUTTING is not the model's job — that is a
//                 measured limit of this project, stated), the model judges ONE letter per call, and the
//                 graph counts. Each piece is something the model can actually do.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
async function classicCount() {
	const word = 'strawberry';
	const truth = '3';
	const question = 'How many times does the letter "r" appear in the word "strawberry"? Answer with just the number.';

	const aloneReply = await ask({ system: 'You are a helpful assistant. Answer concisely.', user: question, maxTokens: 200, temperature: 0 });
	const alone = { calls: take(), answer: num(aloneReply) };

	// the host cuts (deterministic), the model judges each piece, the graph folds the count.
	const letters = word.split('');
	const loop = createPlanLoop({
		decompose: async () => letters.map(( ch, i ) => ({ id: 'n_' + i, request: { id: 'pos' + i }, nl: 'letter ' + (i + 1), readsExtra: [] }) ),
		serveLeaf: async ( lf ) => {
			const i = Number(String(lf.request.id).replace('pos', ''));
			const out = await ask({ system: 'Answer with exactly one word: yes or no.',
				user: 'In the word "' + word + '", is letter number ' + (i + 1) + ' (counting from 1) the letter "r"? Answer yes or no.',
				maxTokens: 8, temperature: 0 });
			return /yes/i.test(String(out)) ? 1 : 0;
		},
		fold: ( leaves ) => String(leaves.reduce(( n, l ) => n + (Number(l.value) || 0), 0)),
	});
	const r = await loop.run(question);
	const withg = { calls: take(), answer: String(r.answer), detail: { leaves: r.leaves } };

	return { id: 'count', truth, question,
		title: 'How many r\'s in "strawberry"?',
		why: 'The other famous one. A model does not see letters — it sees chunks ("straw" + "berry"), so it is guessing at a question about spelling. Nothing about a bigger model fixes the fact that the letters were never there.',
		how: 'Through the graph: cut the word into single letters, ask the model about ONE letter at a time (a question it can actually answer), and let the graph do the counting. The cutting is deliberately not the model\'s job — that is a measured limit of this project.',
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

	// the typed plan: each step is ONE arithmetic move and sees only the values it declared it needs.
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
		how: 'Through the graph: one arithmetic move per call. Each step is handed only the numbers it asked for — never the story, never the other steps — and the graph carries the values between them.',
		alone, withg };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
	const cases = [];
	for ( const fn of [classicDecimal, classicCount, classicDeepMath] ) {
		process.stdout.write('  recording ' + fn.name + ' … ');
		const t0 = Date.now();
		const c = await fn();
		c.aloneRight = c.alone.answer != null && String(c.alone.answer).replace(/\.0+$/, '') === c.truth;
		c.withRight = c.withg.answer != null && String(c.withg.answer).replace(/\.0+$/, '') === c.truth;
		cases.push(c);
		console.log(((Date.now() - t0) / 1000).toFixed(1) + 's · alone ' + (c.aloneRight ? 'RIGHT' : 'wrong → ' + c.alone.answer)
			+ ' · with-graph ' + (c.withRight ? 'RIGHT' : 'wrong → ' + c.withg.answer));
	}
	const out = { recordedWith: MODEL_NAME, note: 'Real prompts and real replies from a real local model. Whatever it answered is what is here.', cases };
	fs.writeFileSync(path.join(__dirname, 'transcript.json'), JSON.stringify(out, null, 1));
	console.log('\nwrote examples/head-to-head/transcript.json — replay: node examples/head-to-head/run.js');
	process.exit(0);
})().catch(( e ) => { console.error('RECORD FAIL:', e.stack || e.message); process.exit(1); });
