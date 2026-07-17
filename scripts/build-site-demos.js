'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 *
 * Build the website's demo tabs → docs/demos.js
 *
 *   node scripts/build-site-demos.js
 *
 * It RUNS every example and captures what it actually printed. The site shows that verbatim — nobody
 * writes demo prose by hand, so the page cannot claim a run the code no longer does. If an example
 * changes, re-run this; `tests/integration/site-demos.test.js` fails when the page drifts from the code.
 *
 * The examples narrate themselves in plain language (examples/_say.js) precisely so this capture is
 * readable by a visitor who has never seen the repo.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'demos.js');

// id · file · the human title · the one line a visitor should leave with
const CATALOG = [
	{ group: 'The whole thing at once', items: [
		{ id: 'integrated', file: 'examples/integrated-demo/run.js', args: ['--replay'],
			title: 'A real annual report, start to finish',
			blurb: 'A 9.5 GB model on a laptop-class GPU works a real financial report: it plans, it repairs its own weak answers, it refuses what it cannot back up, an erratum lands and the consequences retract themselves, the process crashes and the whole run replays identically. No big model anywhere.' },
	] },
	{ group: 'Reasoning strategies', items: [
		{ id: 'self-consistency', file: 'examples/strategies/self-consistency.js', title: 'Ask 5 times, believe a clear winner',
			blurb: 'The majority answer wins — but only if it wins by enough. A 2-vs-2 tie says "I do not know" instead of picking one.' },
		{ id: 'react', file: 'examples/strategies/react.js', title: 'The to-do list nobody maintains',
			blurb: 'Which tool calls are still waiting? You never track it. The list keeps itself, and three separate things stop the loop.' },
		{ id: 'tree-of-thoughts', file: 'examples/strategies/tree-of-thoughts.js', title: 'Explore several ideas, drop the bad ones free',
			blurb: 'Abandon one step and everything that followed it goes dark on its own — and abandoned branches cost no further thinking.' },
		{ id: 'mcts', file: 'examples/strategies/mcts.js', title: 'A game search you can reproduce',
			blurb: 'The search family behind game-playing AI, with the randomness taken out: the same position gives the same answer, always.' },
		{ id: 'least-to-most', file: 'examples/strategies/least-to-most.js', title: 'Easy part first — and you cannot cheat',
			blurb: 'No scheduler tells the steps when to run: each opens itself when the one below is done. Answering out of turn is refused.' },
		{ id: 'socratic', file: 'examples/strategies/socratic.js', title: 'Never conclude over a question you skipped',
			blurb: 'Declare your questions, and the conclusion is simply unavailable until every one of them has an answer.' },
		{ id: 'analogical', file: 'examples/strategies/analogical.js', title: 'Borrow an answer — and lose it if the source was wrong',
			blurb: 'Reason by analogy, then withdraw the case you borrowed from: the conclusion collapses by itself, with the reason kept.' },
		{ id: 'reflexion', file: 'examples/strategies/reflexion.js', title: 'Nobody marks their own homework',
			blurb: 'A draft nobody reviewed goes nowhere. The model that wrote it is never allowed to grade it — that was tried, and refuted.' },
		{ id: 'refinement', file: 'examples/strategies/refinement.js', title: 'Draft, get marked, try again — with a hard stop',
			blurb: 'Coarse marks instead of made-up decimals, an outside judge, and a budget that ends the loop by running out.' },
		{ id: 'meta-router', file: 'examples/strategies/meta-router.js', title: 'Work out what kind of job this is',
			blurb: 'A chain and a hundred little jobs deserve different splits. Pick wrong and you get a less tidy split — never a broken one.' },
	] },
	{ group: 'What it does for a model', items: [
		{ id: 'c7-plan-loop', file: 'examples/bootstrap/c7-plan-loop.js', title: 'Big task, one small piece at a time',
			blurb: 'Each step sees only what it asked for, never the whole dossier. Cut a fact a step needed, and it refuses instead of guessing.' },
		{ id: 'c9-critical-mind', file: 'examples/bootstrap/c9-critical-mind.js', title: 'A critic that will not take your word',
			blurb: 'Nothing enters the argument without real evidence behind it — including the model\'s own ideas. Too close to call says so.' },
		{ id: 'f3-task-memory', file: 'examples/bootstrap/f3-task-memory.js', title: 'A finished task that un-finishes itself',
			blurb: 'A number turns out to be wrong. The work that used it re-does itself for free — or, if nothing can be recomputed, un-ticks itself and tells you why.' },
		{ id: 'f7-substrate', file: 'examples/bootstrap/f7-substrate.js', title: 'Undo, for reasoning',
			blurb: 'Every settled state is a version you can diff and roll back to — rules included. And a sandbox stays a sandbox until you merge it.' },
		{ id: 'forge-stock', file: 'examples/bootstrap/forge-stock.js', title: 'Where the certified know-how comes from',
			blurb: 'Turn a dataset with a right-answer checker into reusable method shapes — admitting nothing that is not provably right.' },
	] },
	// NOTE — deliberately NOT on the site yet: c1-appliance / c3-learning-library / c6-proxy. They are green
	// and they are in the suite, but their output still speaks in fact names and JSON. Rather than show a
	// visitor something only this repo can read, they stay out until they are rewritten like the rest.
];

function run( item ) {
	try {
		return execFileSync('node', [path.join(ROOT, item.file)].concat(item.args || []),
			{ encoding: 'utf8', timeout: 120000, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
	} catch ( e ) {
		throw new Error('demo "' + item.id + '" (' + item.file + ') did not run clean:\n' + (e.stdout || '') + (e.stderr || e.message));
	}
}

const groups = CATALOG.map(( g ) => ({
	group: g.group,
	items: g.items.map(( it ) => {
		const out = run(it).replace(/\s+$/, '');
		process.stdout.write('  ' + it.id.padEnd(20) + out.split('\n').length + ' lines\n');
		return { id: it.id, title: it.title, blurb: it.blurb,
			cmd: 'node ' + it.file + ((it.args || []).length ? ' ' + it.args.join(' ') : ''), out };
	}),
}));

const banner = '/* GENERATED by scripts/build-site-demos.js — do not edit.\n'
	+ ' * Every `out` below is what the example ACTUALLY printed when this file was built.\n'
	+ ' * Re-run the script after changing an example; tests/integration/site-demos.test.js\n'
	+ ' * fails if this file drifts from what the code really does. */\n';
fs.writeFileSync(OUT, banner + 'window.SG_DEMOS = ' + JSON.stringify(groups, null, 1) + ';\n');
console.log('wrote docs/demos.js — ' + groups.reduce(( n, g ) => n + g.items.length, 0) + ' demos in ' + groups.length + ' groups');
