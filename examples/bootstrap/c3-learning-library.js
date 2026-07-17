/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C3 — the LEARNING LIBRARY (`createLearningLibrary`): the always-on cost ladder
 * MATCH → RECALL → FORGE over a typed method library.
 * THE GUARANTEE SHOWN: a recurrent typed stream climbs the ladder — the expensive forge runs ONCE per
 * method class, repeats are elided (match/recall at 0 cost), and the library SURVIVES A RESTART (a fresh
 * process over the same store replays at 0 forges). `.sgc` packs the stock for shipping.
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLearningLibrary } = require('../../lib/index.js').factories;

// the typed K1 signature: STRUCTURE = the method class (what amortizes), CONTENT = the per-instance holes.
const signature = ( p ) => ({ structure: { task: p.task }, content: { variant: p.variant } });

async function main() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bootstrap-'));
	const store = path.join(dir, 'library.json');
	try {
		let forges = 0, reForges = 0;
		const forge = async ( p ) => {                       // the EXPENSIVE path (a model call in real use)
			forges++;
			return { result: 'method(' + p.task + '|' + p.variant + ')', cost: 1,
			         signals: { reliability: 0.9, depth: 1, readOnlyFrontier: true } };
		};
		const reForge = async ( p ) => {                     // the CHEAP adapt path: re-instantiate a recalled
			reForges++;                                      // method for a new variant (not a fresh forge)
			return { result: 'method(' + p.task + '|' + p.variant + ')*', cost: 1 };
		};

		// 1. a recurrent stream: 2 classes, 5 problems → the ladder elides the repeats.
		const ll = createLearningLibrary({ signature, forge, reForge, store });
		const arms = [];
		for ( const p of [{ task: 'report', variant: 'v1' }, { task: 'report', variant: 'v1' },
		                  { task: 'report', variant: 'v2' }, { task: 'export', variant: 'v1' },
		                  { task: 'report', variant: 'v3' }] )
			arms.push((await ll.solve(p)).arm);
		console.log('arms    :', arms.join(' → '));
		console.log('economy : ' + forges + ' forges + ' + reForges + ' cheap adapts for 5 problems');
		assert.equal(forges, 2, 'one EXPENSIVE forge per method CLASS, not per problem');

		// 2. the library survives a restart: a FRESH instance over the same store forges NOTHING.
		let forges2 = 0;
		const ll2 = createLearningLibrary({ signature, forge: async () => { forges2++; return { result: 'x', cost: 1 }; }, store });
		const replay = await ll2.solve({ task: 'report', variant: 'v1' });
		console.log('restart : arm=' + replay.arm + ' cost=' + replay.cost + ' forges=' + forges2);
		assert.equal(replay.arm, 'match');
		assert.equal(forges2, 0, 'the persisted library served the repeat — no re-learning');

		// 3. ship the stock: `.sgc` on demand.
		const bundle = ll.pack({ name: 'demo-stock' });
		console.log('.sgc    : kind=' + bundle.kind + ' methods=' + bundle.methods.length);

		console.log('BOOTSTRAP OK — forge once per class, repeats elided, restart at 0 forges, .sgc shippable');
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(( e ) => { console.error(e); process.exit(1); });
