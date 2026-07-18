'use strict';
/**
 * R3 — the `dialectic` LIVING-DEBATE descriptor (plugins/critical-mind/descriptor.js): the C9
 * debate as a persistent instance agents enrich over days. Same grammar, same providers (byte-
 * frozen prompts), same projection (project.js, shared verbatim with the one-shot factory).
 *
 * GO bar (roadmap R3): a two-day debate — day 1 create (pool + declared points → one established,
 * one honestly OPEN), the instance SURVIVES a serialize/remount, day 2 adds evidence + a new
 * declared point that establishes against the GROWN pool — the counts move, all through the
 * typed-action door. Negative: a point whose witnesses the gate refuses is OPEN and counted 0 —
 * never silently tallied. Parity: the one-shot createCriticalMind on the same scenario equals the
 * instance's day-1 state on every structural field.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');
const { createInstance, runAction, validateDescriptor } = require('../../lib/plugins/descriptor.js');
const descriptor = require('../../plugins/critical-mind/descriptor.js');
const { projectDebate } = require('../../plugins/critical-mind/project.js');

// ── the scripted model: ordered rules, sticky = reusable; an unmatched prompt THROWS with the
// prompt text (fail loud — also proves a remount fires ZERO new asks). ────────────────────────
function scriptedAsk( rules ) {
	const pool = rules.map(( r ) => ({ ...r, used: false }));
	const counting = async ( p ) => {
		counting.calls++;
		const text = [p && p.system, p && p.user].filter(Boolean).join('\n');
		const hit = pool.find(( r ) => (r.sticky || !r.used) && r.m.test(text) );
		if ( !hit ) throw new Error('scripted ask: no rule matches:\n' + text.slice(0, 300));
		hit.used = true;
		return hit.r;
	};
	counting.calls = 0;
	return counting;
}
const RULES = () => [
	{ m: /Point of view \(PRO\): Coffee improves focus/, r: 'cites: p1 p2' },              // V1 → established
	{ m: /Point of view \(CON\): Coffee is harmful/, r: 'cites: NONE', sticky: true },     // V2 → open (explore + 2 retries)
	{ m: /Point of view \(CON\): Coffee disrupts sleep/, r: 'cites: c3' },                 // V3 (day 2) → established on the GROWN pool
	{ m: /Candidate point/, r: 'cites: NONE', sticky: true },                              // generative pass, honest NONE
	{ m: /Propose ONE NEW/, r: 'NONE', sticky: true },
	{ m: /genuinely CONTESTED/, r: 'CONTESTED', sticky: true },                            // norm probe
	{ m: /Summarize the (PRO|CON) case/, r: 'One-line case summary.', sticky: true },      // one-shot face only
];
const SEED = {
	topic: 'Is daily coffee good for programmers?',
	statements: [
		{ side: 'PRO', text: 'Caffeine measurably improves sustained attention' },
		{ side: 'PRO', text: 'Coffee breaks improve team communication' },
		{ side: 'CON', text: 'Caffeine crashes hurt afternoon productivity' },
		{ side: 'CON', text: 'Habitual use builds tolerance and dependence' }
	],
	viewpoints: [
		{ side: 'PRO', text: 'Coffee improves focus and collaboration' },
		{ side: 'CON', text: 'Coffee is harmful to health in every amount' }
	]
};

test('GO: the two-day living debate — create → open point stays honest → REMOUNT → day-2 evidence + new point moves the counts', async () => {
	const ask = scriptedAsk(RULES());
	descriptor.wireAsk(ask);
	assert.equal(validateDescriptor(descriptor), descriptor, 'the shipped descriptor validates');

	// ── day 1 ──
	const inst = await createInstance(descriptor, { seed: SEED, conceptMap: descriptor.conceptMap, label: 'debate-1' });
	const day1 = await runAction(inst.graph, descriptor, 'state', {}, {});
	assert.equal(day1.verdict, 'UNDECIDED', 'margin 1 < 3 — honest');
	assert.deepEqual(day1.counts, { PRO: 1, CON: 0 });
	const v1 = day1.ledger.find(( e ) => e.key === 'V1' );
	const v2 = day1.ledger.find(( e ) => e.key === 'V2' );
	assert.deepEqual(v1.witnesses, ['p1', 'p2']);
	assert.equal(v1.status, 'active');
	// NEGATIVE (roadmap R3): the witness gate REFUSED V2 — visible as OPEN, never silently tallied
	assert.equal(v2.status, 'open');
	assert.equal(v2.witnesses, null);
	assert.ok(day1.journal.some(( l ) => /R0 open V2/.test(l) ), 'the refusal is journaled, not hidden');
	const day1Calls = ask.calls;

	// ── the instance SURVIVES residency: serialize → remount → identical state, ZERO new asks ──
	const record = inst.graph.serialize();
	inst.graph.destroy();
	const g2 = new Graph(record, { label: 'debate-1b', isMaster: true, autoMount: true,
		conceptSets: ['dialectic'], bagRefManagers: {}, logLevel: 'error' }, descriptor.conceptMap);
	await nextStable(g2);
	assert.deepEqual(projectDebate(g2), day1, 'the remounted debate projects byte-equal');
	assert.equal(ask.calls, day1Calls, 'a remount fires ZERO model calls (flags are facts — nothing re-explores)');

	// ── day 2, on the REMOUNTED graph, through the typed-action door ──
	const r1 = await runAction(g2, descriptor, 'addArguments', {
		statements: [{ side: 'CON', text: 'Late caffeine disrupts sleep cycles for most adults' }] }, { agent: 'agentB' });
	assert.equal(r1.ok, true);
	const r2 = await runAction(g2, descriptor, 'addViewpoint', { text: 'Coffee disrupts sleep and recovery', side: 'CON' }, { agent: 'agentB' });
	assert.equal(r2.ok, true);
	const day2 = await runAction(g2, descriptor, 'state', {}, {});
	const v3 = day2.ledger.find(( e ) => e.key === 'V3' );
	assert.equal(v3.status, 'active', 'the new point ESTABLISHED against the grown pool (the living mechanism)');
	assert.deepEqual(v3.witnesses, ['c3'], 'witnessed by the day-2 evidence');
	assert.deepEqual(day2.counts, { PRO: 1, CON: 1 }, 'the counts moved');
	assert.equal(day2.verdict, 'UNDECIDED', 'still under the margin — still honest');
	assert.equal(day2.pool.length, 5);
	assert.ok(day2.journal.some(( l ) => /R0 established V3 \(CON, c3\)/.test(l) ));

	// the brief (the judgment layer) rides the same projection
	const b = await runAction(g2, descriptor, 'brief', {}, {});
	assert.ok(b.brief && typeof b.judgePrompt === 'string' && b.judgePrompt.length > 100, 'brief + judgePrompt served');
	g2.destroy();
});

test('PARITY: the one-shot createCriticalMind on the same scenario equals the instance day-1 state on every structural field', async () => {
	const askInst = scriptedAsk(RULES());
	descriptor.wireAsk(askInst);
	const inst = await createInstance(descriptor, { seed: SEED, conceptMap: descriptor.conceptMap, label: 'parity-inst' });
	const instState = await runAction(inst.graph, descriptor, 'state', {}, {});
	inst.graph.destroy();

	const { createCriticalMind } = require('../../plugins/critical-mind/factory-grammar.js');
	const askShot = scriptedAsk(RULES());
	const shot = await createCriticalMind({ ask: askShot }).run({ topic: SEED.topic, statements: SEED.statements, viewpoints: SEED.viewpoints });

	for ( const k of ['topic', 'frameStatus', 'rounds', 'journal', 'pool', 'viewpoints', 'ledger', 'counts', 'margin', 'threshold', 'verdict', 'basis', 'norm'] )
		assert.deepEqual(instState[k], shot[k], 'structural field "' + k + '" identical across faces');
	const synthAsks = Object.keys(shot.synthesis || {}).length;   // one presentation ask per side WITH active entries
	assert.equal(askInst.calls, askShot.calls - synthAsks, 'same ask budget minus the presentation syntheses (instance projections never ask)');
});

test('typed failure: no wired ask → the witness gate records a TYPED error and the projection THROWS (never a silent self-flag)', async () => {
	descriptor.wireAsk(null);                                  // nothing wired, no LLM_BASE in tests
	const inst = await createInstance(descriptor, { seed: SEED, conceptMap: descriptor.conceptMap, label: 'no-ask' });
	await assert.rejects(async () => { const r = await runAction(inst.graph, descriptor, 'state', {}, {}); if ( r ) throw new Error(JSON.stringify(r).slice(0, 100)); },
		/no ask wired|dialectic/i, 'the debate fails TYPED without a model');
	inst.graph.destroy();
});

test('empty additions are typed refusals, never silent no-ops', async () => {
	descriptor.wireAsk(scriptedAsk(RULES()));
	const inst = await createInstance(descriptor, { seed: SEED, conceptMap: descriptor.conceptMap, label: 'refusals' });
	const r = await runAction(inst.graph, descriptor, 'addArguments', { statements: ['not a labeled line'] }, { agent: 'a' });
	assert.equal(r.refused, true, 'unparseable statements refuse (side PRO|CON + text required)');
	const r2 = await runAction(inst.graph, descriptor, 'addViewpoint', { text: '' }, { agent: 'a' });
	assert.equal(r2.refused, true);
	inst.graph.destroy();
});
