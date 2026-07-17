'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 *
 * RECORD every strategy's real model exchanges on a real Q2 → transcript.json   (GPU; replayed offline)
 *
 *   LD_LIBRARY_PATH=/usr/lib/wsl/lib:/usr/lib/x86_64-linux-gnu node examples/strategies/_record.js
 *
 * Real questions a person would actually ask, real prompts, real replies. The examples then replay these
 * verbatim (_live.js) while driving the REAL graph — so a visitor sees what was sent, what came back, and
 * what the graph did with it. Whatever the model said is what ships.
 */
const fs = require('fs');
const path = require('path');
const SG = path.join(__dirname, '..', '..');
const { makeLocalAsk } = require(path.join(SG, 'lib', 'providers', 'llm-local.js'));

const MODEL = process.env.DEMO_MODEL || path.join(SG, 'models', 'Qwen3.6-27B-UD-IQ2_XXS.gguf');
const baseAsk = makeLocalAsk({ modelPath: MODEL, reasoningBudget: 0, contextSize: 8192, seed: 0 });

const OUT = {};
async function rec( id, label, q ) {
	const reply = String(await baseAsk(q)).trim();
	(OUT[id] = OUT[id] || []).push({ label, system: q.system || '', user: q.user, reply });
	process.stdout.write('    ' + id + ' · ' + label + ' → ' + JSON.stringify(reply.slice(0, 54)) + '\n');
	return reply;
}
const SYS = 'You are a careful assistant. Follow the output format EXACTLY.';

(async () => {
	// ── self-consistency: a real arithmetic question, asked 5 independent times (salted, per the measured
	//    gotcha: a local backend pins its seed, so identical prompts give identical paths = a vacuous vote)
	for ( let i = 1; i <= 5; i++ )
		await rec('self-consistency', 'path ' + i + ' of 5', { system: SYS,
			user: 'A farmer has 3 fields. Each field has 4 rows of corn, with 7 stalks per row. How many corn stalks are there in total?\n(independent attempt ' + i + ' of 5 — work it out your own way)\nEnd with a final line exactly: ANSWER: <number>',
			maxTokens: 300, temperature: 0.7 });

	// ── react: a question needing two tool calls then arithmetic
	const TOOLS = 'lookup_capital(country) · lookup_population(city)';
	const RQ = 'Question: What is the population of the capital of France?';
	await rec('react', 'step 1 — what should we do first?', { system: SYS,
		user: RQ + '\nTools: ' + TOOLS + '\nSteps so far: (none)\nReply exactly 2 lines:\nTHOUGHT: <one sentence>\nACTION: <tool>(<input>)',
		maxTokens: 120, temperature: 0 });
	await rec('react', 'step 2 — we ran it and told it the answer', { system: SYS,
		user: RQ + '\nTools: ' + TOOLS + '\nSteps so far:\n1. lookup_capital(France) -> Paris\nReply exactly 2 lines:\nTHOUGHT: <one sentence>\nACTION: <tool>(<input>)',
		maxTokens: 120, temperature: 0 });
	await rec('react', 'step 3 — it has the number', { system: SYS,
		user: RQ + '\nTools: ' + TOOLS + '\nSteps so far:\n1. lookup_capital(France) -> Paris\n2. lookup_population(Paris) -> 2100000\nReply exactly 2 lines:\nTHOUGHT: <one sentence>\nACTION: FINISH(<the answer>)',
		maxTokens: 120, temperature: 0 });

	// ── least-to-most: THE classic sibling trap. Asked whole this model says 2. The answer is 1.
	//    Cut into two rungs — easiest first — the same model gets it right. A real win, not a refusal.
	const ONE = 'You do ONE small step. Answer with just the number, nothing else.';
	await rec('least-to-most', 'asked whole — the trap', { system: 'Answer concisely.',
		user: 'Sally has 3 brothers. Each brother has 2 sisters. How many sisters does Sally have? Just the number.',
		maxTokens: 250, temperature: 0 });
	await rec('least-to-most', 'rung 1 — the easiest thing first', { system: ONE,
		user: 'In a family, each brother has 2 sisters. How many sisters are there in the family in total? Just the number.',
		maxTokens: 20, temperature: 0 });
	await rec('least-to-most', 'rung 2 — given rung 1\'s answer', { system: ONE,
		user: 'A family has 2 sisters in total. Sally is one of them. How many sisters does Sally have (not counting herself)? Just the number.',
		maxTokens: 20, temperature: 0 });

	// ── socratic: probing a claim, then distilling
	const CLAIM = 'We should rewrite our app in Rust because it would be faster.';
	await rec('socratic', 'ask it to probe the claim', { system: SYS,
		user: 'Claim: "' + CLAIM + '"\nName the 2 most important questions someone should answer before acting on this claim.\nReply 2 lines, each: Q: <question>',
		maxTokens: 140, temperature: 0 });
	await rec('socratic', 'answer probe 1, then distil it', { system: SYS,
		user: 'Claim: "' + CLAIM + '"\nQuestion: Is the app actually slow because of the language?\nAnswer it in one sentence, then give the one-line lesson.\nReply exactly 2 lines:\nA: <answer>\nINSIGHT: <one line>',
		maxTokens: 160, temperature: 0 });

	// ── refinement / reflexion: a draft, and an EXTERNAL judge marking it
	const BRIEF = 'Write a one-sentence description of a bicycle lock for an online shop.';
	const d1 = await rec('refinement', 'draft 1', { system: SYS, user: BRIEF, maxTokens: 80, temperature: 0 });
	await rec('refinement', 'an EXTERNAL judge marks draft 1', { system: SYS,
		user: 'Brief: ' + BRIEF + '\nDraft: "' + d1 + '"\nDoes the draft mention BOTH security AND ease of use? Reply one line exactly: SCORE: <0-10>',
		maxTokens: 20, temperature: 0 });
	const d2 = await rec('refinement', 'draft 2, after the mark', { system: SYS,
		user: BRIEF + '\nThe previous draft was marked down for not mentioning both security and ease of use. Write a better one.',
		maxTokens: 80, temperature: 0 });
	await rec('refinement', 'the judge marks draft 2', { system: SYS,
		user: 'Brief: ' + BRIEF + '\nDraft: "' + d2 + '"\nDoes the draft mention BOTH security AND ease of use? Reply one line exactly: SCORE: <0-10>',
		maxTokens: 20, temperature: 0 });
	await rec('reflexion', 'an EXTERNAL reviewer, pass/fail', { system: SYS,
		user: 'Brief: ' + BRIEF + '\nDraft: "' + d1 + '"\nIs this draft acceptable for the shop? Reply one word exactly: CORRECT or FLAWED',
		maxTokens: 12, temperature: 0 });
	await rec('reflexion', 'the reviewer looks at the rewrite', { system: SYS,
		user: 'Brief: ' + BRIEF + '\nDraft: "' + d2 + '"\nIs this draft acceptable for the shop? Reply one word exactly: CORRECT or FLAWED',
		maxTokens: 12, temperature: 0 });

	// ── tree-of-thoughts: propose lines of attack, an EXTERNAL judge scores one
	await rec('tree-of-thoughts', 'propose 3 different first moves', { system: SYS,
		user: 'Puzzle: arrange the numbers 1 to 9 in a 3x3 grid so every row, column and diagonal adds up to 15.\n'
			+ 'Propose 3 DIFFERENT opening moves (what to place where, and why), one line each, format: MOVE: <move>',
		maxTokens: 200, temperature: 0 });
	await rec('tree-of-thoughts', 'an EXTERNAL judge rates one of them', { system: SYS,
		user: 'Puzzle: 1-9 in a 3x3 grid, every row, column and diagonal summing to 15.\n'
			+ 'Proposed opening move: "Place 5 in the centre."\nHow promising is this move? Reply one line exactly: SCORE: <0-10>',
		maxTokens: 20, temperature: 0 });

	// ── analogical: does the old case really map onto the new one?
	await rec('analogical', 'does the solved case map onto the new one?', { system: SYS,
		user: 'Solved case: "Blood vessels deliver to every cell in the body: a few big arteries, branching down to tiny capillaries."\n'
			+ 'New problem: "Design a more efficient package delivery network for a city."\n'
			+ 'Does the solved case map onto the new problem? Reply exactly 2 lines:\nSAME: yes or no\nWHY: <one line>',
		maxTokens: 120, temperature: 0 });

	// ── meta-router: what KIND of job is this?
	await rec('meta-router', 'classify the job', { system: SYS,
		user: 'Task: "Go through this spreadsheet of 300 invoices and pull out the date and total from each."\n'
			+ 'Which shape is this? Reply with exactly one word from: sequential, extraction, multihop, aggregate, planning',
		maxTokens: 12, temperature: 0 });
	await rec('meta-router', 'classify a different job', { system: SYS,
		user: 'Task: "Work out our runway: take the cash balance, subtract this month\'s burn, then divide by the average burn."\n'
			+ 'Which shape is this? Reply with exactly one word from: sequential, extraction, multihop, aggregate, planning',
		maxTokens: 12, temperature: 0 });

	// ── mcts: what moves are even available?
	await rec('mcts', 'what are the legal moves here?', { system: SYS,
		user: 'A counter starts at 0. Each move adds 3 or 5. You must land on EXACTLY 11 within 3 moves.\n'
			+ 'The counter is at 0 and no moves have been made. List the legal moves, comma separated, from: +3, +5',
		maxTokens: 24, temperature: 0 });

	fs.writeFileSync(path.join(__dirname, 'transcript.json'), JSON.stringify({
		recordedWith: 'Qwen3.6-27B-IQ2_XXS (9.5 GB, a low-quant on one ordinary GPU)', exchanges: OUT }, null, 1));
	console.log('\n  wrote examples/strategies/transcript.json — ' + Object.keys(OUT).length + ' strategies, '
		+ Object.values(OUT).reduce(( n, a ) => n + a.length, 0) + ' real exchanges');
	process.exit(0);
})().catch(( e ) => { console.error('RECORD FAIL:', e.stack || e.message); process.exit(1); });
