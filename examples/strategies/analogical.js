/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * STRATEGY — ANALOGICAL: "this new case is like that solved one, so carry the solution across".
 *
 * THE GUARANTEE SHOWN — the part every other implementation of this idea drops: **the analogy is
 * DEFEASIBLE**. A transfer is licensed only while its source case is still live AND still resolved.
 * Retract the source — an erratum, a fact that drifted — and the license uncasts in cascade, with the
 * retraction APPENDED to the audit trail. Nothing pulls the reasoning that leaned on it; the graph does.
 *
 * That matters because an analogy is the reasoning step most likely to be quietly invalidated later: you
 * transferred from a case that turned out to be wrong. Everywhere else, that conclusion just stays. Here it
 * falls, and the ledger says why. This is the same JTMS machinery C9's witness gate runs on, reused verbatim.
 *
 * THE ASYMMETRY (§3 below, worth knowing before you build on this): the retraction cascades natively, but
 * the RESTORE does not — putting the source back needs an explicit host re-arm. Retraction is free;
 * reopening is a write you make on purpose.
 *
 * WHO MATCHES: the host does the structural match + writes the transfer prose. This plugin is the deposited
 * admission + maintenance. Tier-0 — pure grammar, zero JS.
 *
 * Deterministic, no model:  node examples/strategies/analogical.js
 */
const assert = require('node:assert');
const { bootStrategy } = require('./_boot.js');
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');
const { exchange, of, liveBanner } = require('./_live.js');

// a source case: a kernel Thought that is `live` (still believed) and `resolved` (actually solved)
const source = ( o ) => Object.assign({ _id: 'src', isThought: true, live: true, resolved: true, text: 'the solved case' }, o);
// the analogy itself: a kernel Relation of kind maps-to, from the source to the target
const mapsTo = ( relKind ) => ({ _id: 'm1', isRelation: true, relKind: relKind || 'maps-to', from: 'src', to: 'tgt' });
const target = { _id: 'tgt', isThought: true, text: 'the new case' };

async function main() {
	title('"THIS NEW CASE IS LIKE THAT SOLVED ONE" — AND IT COLLAPSES IF THAT ONE WAS WRONG');
	say('Reasoning by analogy means borrowing an answer from a case you already solved. The danger');
	say('is obvious once you say it out loud: what if the case you borrowed from turns out to be');
	say('wrong? Everywhere else, the borrowed conclusion just quietly stays. Not here.');
	gap();
	liveBanner();
	gap();
	beat(0, 'A real solved case, a real new one, and a real model asked if they truly match:');
	exchange('analogical', 0, 'it spotted the shared shape — that is the claim the graph will hold, and police');
	gap();
	say('  Because the interesting part is what happens when the old case turns out to be wrong:');

	// ── 1. a live + resolved source LICENSES the transfer ──────────────────────────────────────────
	const g = bootStrategy('analogical', {
		freeNodes: [{ _id: 'ledger', grounded: [], groundedRetracted: [] }],
		nodes    : [source(), target, mapsTo()],
	});
	await g.settle();
	beat(1, 'We have a solved case, a new case, and the claim "these two are alike".');
	good('the borrow is allowed — the old case is still believed, and it really was solved');
	assert.equal(g.cast('m1', 'Mapping'), true, 'relKind maps-to routed into Mapping');
	assert.equal(g.cast('m1', 'Grounded'), true, 'live + resolved source → the transfer license');
	assert.deepEqual(g.fact('ledger', 'grounded'), ['m1'], 'audited on the kernel ledger');
	gap();

	// ── 2. THE CASCADE — the source is retracted, and the analogy falls WITH it ────────────────────
	// This is the whole point. The host writes ONE fact (`live: false`) and writes nothing else. It does not
	// find the dependents, does not invalidate them, does not roll anything back.
	await g.ingest({ src: { live: false } });                                  // the source case turned out to be wrong
	await g.settle();
	const active = g.fact('ledger', 'grounded').length - g.fact('ledger', 'groundedRetracted').length;
	beat(2, 'Bad news: the old case was wrong. We withdraw it — and we change nothing else.');
	good('the borrow collapsed on its own. We did not go looking for what depended on it');
	val('analogies still standing', active);
	good('and the record says both things: it was borrowed, then it was withdrawn');
	say('       (nothing was erased. You can still see it happened, and why it fell.)');
	assert.equal(g.cast('m1', 'Grounded'), false, 'the transfer license uncast in cascade — no invalidation code');
	assert.deepEqual(g.fact('ledger', 'groundedRetracted'), ['m1'], 'the retraction is APPENDED: the audit keeps the history');
	assert.equal(active, 0, 'active analogies fell to 0 — DEFEASANCE, not deletion (both facts survive on the ledger)');
	gap();

	// ── 3. REOPENING is NOT symmetric — and that asymmetry is the contract, so learn it here ──────
	// Restoring the source does NOT bring the license back on its own. The retraction is native; the
	// restore needs an explicit HOST RE-ARM (a write to the dependent). The reason is mechanical: the
	// cross-object hop-watcher that noticed `live` falling is not re-registered once the concept uncasts,
	// so a later change on the SOURCE reaches nothing. (Gates that read facts written to their OWN node —
	// C9's verdict over its ledger counts — do re-decide both ways: the write destabilizes that node.)
	await g.ingest({ src: { live: true } });                                  // the erratum was itself an error
	await g.settle();
	beat(3, 'Better news: the withdrawal was itself a mistake. We put the old case back.');
	bad('the borrow does NOT come back on its own — and you should know that');
	say('       (falling is automatic. Standing back up is a decision someone has to make.)');
	assert.equal(g.cast('m1', 'Grounded'), false, 'restoring the source alone does not re-license: no watcher is listening');

	await g.ingest({ m1: { rearm: 1 } });                                     // the host re-arms the analogy explicitly
	await g.settle();
	const reopened = g.fact('ledger', 'grounded').length - g.fact('ledger', 'groundedRetracted').length;
	gap();
	beat(4, 'So we say it explicitly: reconsider that analogy.');
	good('it stands again — and no model was called to work that out');
	val('analogies still standing', reopened);
	val('the full record', 'borrowed · withdrawn · borrowed again — nothing overwritten');
	assert.equal(g.cast('m1', 'Grounded'), true, 'on the re-arm the license re-derived — at 0 model calls');
	assert.equal(reopened, 1, 'the ledger math holds across the round-trip: 2 groundings − 1 retraction = 1 active');
	assert.deepEqual(g.fact('ledger', 'grounded'), ['m1', 'm1'], 'append-only: the history reads grounded → retracted → grounded, nothing overwritten');
	g.close();
	gap();

	// ── 4. THE NEGATIVE CONTROLS: an unresolved source never licenses; a non-analogy never maps ────
	const n = bootStrategy('analogical', {
		freeNodes: [{ _id: 'ledger', grounded: [], groundedRetracted: [] }],
		nodes    : [
			source({ resolved: null }),                                          // a case we have NOT solved
			target,
			mapsTo(),
			{ _id: 'm2', isRelation: true, relKind: 'attack', from: 'src', to: 'tgt' },   // a different relation kind
		],
	});
	await n.settle();
	say('Two more things it will not do:');
	bad('borrow from a case that was never actually solved');
	bad('treat "these two disagree" as if it meant "these two are alike"');
	assert.equal(n.cast('m1', 'Grounded'), false, 'you cannot transfer FROM a case you have not solved');
	assert.equal(n.cast('m2', 'Mapping'), false, 'relKind attack is not an analogy — the enum routes');
	assert.deepEqual(n.fact('ledger', 'grounded'), [], 'nothing tallied');
	n.close();

	finish('borrow from a wrong case and the conclusion falls by itself, with the reason kept.', 'STRATEGY OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
