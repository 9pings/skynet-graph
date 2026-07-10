/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP C4 — the REACTIVE KG (`reactiveKG`): the engine's ORIGINAL use — a rule-driven knowledge graph
 * where concept rules automatically ENRICH data objects when their conditions are met (and un-cast when not).
 * THE GUARANTEE SHOWN: seed two positioned nodes + a segment → stabilization casts the real `common`
 * concepts (the geo builtin computes Distance from the Positions — nobody wrote Distance in the seed);
 * every stabilize captures a REVISION (rollbackTo/getRevisions = the reversibility verbs).
 *
 * The full tour (LongTravel/ShortTravel/Stay…) is `examples/run-basic.js`; the CLI equivalent is
 * `sg run --concepts ./concepts --builtins`.
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const path = require('path');
const Graph = require('../../lib/index.js');

async function main() {
	// boot the combo on the shipped `common` concept set (builtins ON = the geo provider is wired).
	const g = Graph.combos.reactiveKG({
		concepts: path.resolve(__dirname, '../../concepts/common'),
		seed: {   // a serialized record (a string would be read as a snapshot PATH)
			lastRev : 0,
			nodes   : [{ _id: 'paris', Position: { lat: 48.8566, lng: 2.3522 } },
			           { _id: 'versailles', Position: { lat: 48.8049, lng: 2.1204 } }],
			segments: [{ _id: 'trip', originNode: 'paris', targetNode: 'versailles' }]
		}
	});
	await new Promise(( resolve ) => g.on('stabilize', resolve));

	// the RULES enriched the data: Distance was CAST by the concept system, not written by the host.
	const trip = g._objById['trip']._etty._;
	console.log('seeded  : paris ⇄ versailles (Positions only — no Distance in the seed)');
	console.log('enriched: trip.Distance =', JSON.stringify(trip.Distance));
	assert.ok(trip.Distance && trip.Distance.inKm > 10 && trip.Distance.inKm < 30,
		'the geo builtin computed the ~17 km distance from the Positions');

	// every stabilize is a REVISION — the reversibility verbs are on the graph.
	const revs = g.getRevisions();
	console.log('history : ' + revs.length + ' revision(s) captured; rollbackTo/diffRevisions available');
	assert.ok(revs.length >= 1);

	g.destroy();
	console.log('BOOTSTRAP OK — rules enriched the data (Distance cast from Positions), history captured');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
