/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * RECORD the critical-mind demo on a REAL model → c9-transcript.json   (needs a GPU; the demo replays it)
 *
 *   LD_LIBRARY_PATH=/usr/lib/wsl/lib:/usr/lib/x86_64-linux-gnu node examples/bootstrap/c9-record.js
 *
 * NOTHING IS SUPPLIED HERE — and that is the entire point of this file. The run gets a topic string and
 * nothing else: no statement pool, no viewpoints, no sides, no gold. The model brainstorms the pool itself,
 * labels each statement PRO/CON/OFF-TOPIC itself, and the split into viewpoints is its own. Every prompt and
 * every reply is recorded verbatim.
 *
 * WHY THIS SHAPE (2026-07-17). The previous version of this demo handed C9 a hand-written pool AND a
 * hand-written frame, scripted the model's replies so it could not be wrong, and then quoted a benchmark
 * number as if the run had produced it. That benchmark turned out to be confounded (docs/CAPABILITIES.md,
 * "the head-to-head that used to sit here is WITHDRAWN"), and the demo's scripted `'NONE'` reply meant the
 * generation gate — the beat three surfaces advertised — was never even called. This file is the opposite:
 * it is the harness from WIP/experiments/2026-07-13-critical-live, which was always honest, made shippable.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SG = path.join(__dirname, '..', '..');
const { createCriticalMind } = require(path.join(SG, 'lib', 'index.js')).factories;
const { makeLocalAsk } = require(path.join(SG, 'lib', 'providers', 'llm-local.js'));

const OUT = path.join(__dirname, 'c9-transcript.json');
const MODEL = process.env.DEMO_MODEL || path.join(SG, 'models', 'Qwen3.6-27B-UD-IQ2_XXS.gguf');
const MODEL_NAME = 'Qwen3.6-27B-IQ2_XXS (9.5 GB, the crippled quant)';
const TOPIC = 'Should a solo developer open-source a 3-year R&D project instead of trying to monetize it?';

const digest = ( s ) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

(async () => {
	const base = makeLocalAsk({ modelPath: MODEL, seed: 0, reasoningBudget: 0, contextSize: 8192 });
	const calls = [];
	const stages = [];
	const ask = async ( q ) => {
		const reply = await base(q);
		calls.push({ d: digest(String(q.system || '') + '|' + q.user), system: String(q.system || ''), user: q.user, reply: String(reply) });
		return reply;
	};
	const cm = createCriticalMind({ ask, onStage: ( stage, msg ) => { stages.push({ stage, msg }); console.log('  [' + stage + '] ' + msg); } });
	const r = await cm.run({ topic: TOPIC });
	if ( r.error ) { console.error('RECORD FAIL: ' + r.error); process.exit(1); }

	const out = { recordedWith: MODEL_NAME, topic: TOPIC,
		note: 'Real prompts and real replies from a real local model. Nothing was supplied but the topic.',
		stages, calls,
		result: { frameStatus: r.frameStatus, counts: r.counts, margin: r.margin, threshold: r.threshold,
			verdict: r.verdict, basis: r.basis || null, ledger: r.ledger, pool: r.pool, prose: r.prose } };
	fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
	console.log('\n  pool: ' + r.pool.length + ' statements · ledger: ' + r.ledger.length + ' points · '
		+ calls.length + ' model calls');
	console.log('  counts PRO ' + r.counts.PRO + ' vs CON ' + r.counts.CON + ' (margin ' + r.margin
		+ ', threshold ' + r.threshold + ') → ' + r.verdict);
	console.log('\nwrote examples/bootstrap/c9-transcript.json — replay: node examples/bootstrap/c9-critical-mind.js');
	process.exit(0);
})().catch(( e ) => { console.error('RECORD FAIL:', e.stack || e.message); process.exit(1); });
