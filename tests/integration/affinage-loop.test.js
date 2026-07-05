'use strict';
// (iii) — the AFFINAGE→LOCK-DÉFAISABLE policy (owner Q#3) end-to-end on the real engine. Each gate carries a
// discriminating control. Assembly of existing bricks only (nogood sound-skip + the cover/grow amortization).
const test = require('node:test');
const assert = require('node:assert');
const { runAffinageLoop } = require('../../examples/poc/affinage-loop.js');

test('affinage→lock-défaisable — the full policy on the real engine', async () => {
	const r = await runAffinageLoop();

	// G1 GROWTH — the affinage proposes + admits facets at the frontier (the lattice grows).
	const grown = r.cold.facets.map(( f ) => f.kind ).sort();
	assert.deepEqual(grown, ['cough', 'fever', 'nausea'], 'cold admitted exactly the 3 verified facets');

	// G2 SOUNDNESS — a WRONG proposal (rash) is refused by the gate: never admitted (0 false facet).
	assert.equal(r.cold.facets.some(( f ) => f.kind === 'rash' ), false, 'the mis-proposed facet never entered the ring');
	assert.equal(r.cold.facets.every(( f ) => f.category != null ), true);

	// G3 LOCK — a dead-end (quux) AND a refused proposal (rash) get nogood-locked; no runaway.
	assert.deepEqual(r.cold.nogoods, ['quux', 'rash'], 'both the dead-end and the refused kind are locked');
	assert.deepEqual(r.cold.divergent, [], 'the lock keeps it bounded — no apply-cap divergence');

	// G4 AMORTIZATION + LOCK (the elision) — warm episode spends ZERO affinage: covered kinds resolve 0-call,
	// locked kinds sound-skip.
	assert.equal(r.warm.affinageCalls, 0, 'warm spends no affinage (amortized + skipped)');
	assert.deepEqual(r.warm.skipped.sort(), ['seg3', 'seg4'], 'the two locked kinds (quux, rash) are the ones skipped');
	// the covered kinds still resolved (amortization is not a silent drop):
	assert.equal(r.warm.qualified.seg0.qualified && r.warm.qualified.seg1.qualified && r.warm.qualified.seg2.qualified, true);

	// G5 DÉFAISANCE — with the lock RETRACTED + new evidence, the previously dead-end kind qualifies (recovers).
	assert.equal(r.defeased.qualified.seg0.qualified, true, 'quux qualifies after the lock is retracted (rare, not permanent)');
	assert.equal(r.defeased.qualified.seg0.category, 'general');
	assert.deepEqual(r.defeased.divergent, []);

	// G6 NEG-CONTROL — the SAME new evidence but the lock KEPT: quux stays skipped (a changed world alone never
	// fabricates a qualification; the un-lock must be an explicit act → the lock is sound while it holds).
	assert.equal(r.control.qualified.seg0.qualified, false, 'lock kept ⇒ no qualification slips in');
	assert.equal(r.control.skipped.length > 0, true, 'lock kept ⇒ the kind is still sound-skipped');
});
