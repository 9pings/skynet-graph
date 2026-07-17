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
			user: 'What is 17 multiplied by 23?\n(independent attempt ' + i + ' of 5 — work it out your own way)\nEnd with a final line exactly: ANSWER: <number>',
			maxTokens: 300, temperature: 0.7 });

	// ── react: a question needing two tool calls then arithmetic
	const TOOLS = 'lookup_population(country) · calculate(expression)';
	await rec('react', 'step 1 — what should we do first?', { system: SYS,
		user: 'Question: What is the combined population of France and Japan?\nTools: ' + TOOLS
			+ '\nSteps so far: (none)\nReply exactly 2 lines:\nTHOUGHT: <one sentence>\nACTION: <tool>(<input>)',
		maxTokens: 120, temperature: 0 });
	await rec('react', 'step 2 — after we ran it and told it the result', { system: SYS,
		user: 'Question: What is the combined population of France and Japan?\nTools: ' + TOOLS
			+ '\nSteps so far:\n1. lookup_population(France) -> 68000000\nReply exactly 2 lines:\nTHOUGHT: <one sentence>\nACTION: <tool>(<input>)',
		maxTokens: 120, temperature: 0 });
	await rec('react', 'step 3 — both populations known', { system: SYS,
		user: 'Question: What is the combined population of France and Japan?\nTools: ' + TOOLS
			+ '\nSteps so far:\n1. lookup_population(France) -> 68000000\n2. lookup_population(Japan) -> 125000000\nReply exactly 2 lines:\nTHOUGHT: <one sentence>\nACTION: <tool>(<input>)',
		maxTokens: 120, temperature: 0 });

	// ── least-to-most: a real chained question, one rung at a time
	await rec('least-to-most', 'rung 1 (nothing before it)', { system: SYS,
		user: 'A train leaves at 9:15 and the journey takes 2 hours and 40 minutes.\nStep 1 of 3: how many MINUTES is the journey? Answer with just the number.',
		maxTokens: 24, temperature: 0 });
	await rec('least-to-most', 'rung 2 (given rung 1\'s answer)', { system: SYS,
		user: 'A train leaves at 9:15. The journey is 160 minutes.\nStep 2 of 3: 9:15 plus 160 minutes is what time? Answer as HH:MM only.',
		maxTokens: 24, temperature: 0 });
	await rec('least-to-most', 'rung 3 (given rung 2\'s answer)', { system: SYS,
		user: 'A train arrives at 11:55.\nStep 3 of 3: is that before or after midday? Answer with one word: before or after.',
		maxTokens: 12, temperature: 0 });

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
	await rec('tree-of-thoughts', 'propose 3 lines of attack', { system: SYS,
		user: 'Problem: our cloud bill is $40,000 a month and we must cut it by half.\nPropose 3 DIFFERENT first moves, one line each, format: MOVE: <move>',
		maxTokens: 180, temperature: 0 });
	await rec('tree-of-thoughts', 'an EXTERNAL judge rates one line', { system: SYS,
		user: 'Goal: halve a $40,000/month cloud bill.\nProposed move: "Move workloads to cheaper reserved instances."\nHow likely is this to reach the goal on its own? Reply one line exactly: SCORE: <0-10>',
		maxTokens: 20, temperature: 0 });

	// ── analogical: does the old case really map onto the new one?
	await rec('analogical', 'does the solved case map onto the new one?', { system: SYS,
		user: 'Solved case: "Our checkout was slow because we queried the database once per item in the basket."\n'
			+ 'New case: "Our search page is slow and makes one API call per result shown."\n'
			+ 'Do these two have the SAME underlying shape? Reply exactly 2 lines:\nSAME: yes or no\nWHY: <one line>',
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
