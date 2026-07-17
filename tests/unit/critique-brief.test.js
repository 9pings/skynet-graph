'use strict';
// The JUDGMENT BRIEF (C9 → final judge): a pure projection of a critique result into the dossier the
// host's own LLM weighs (decision + certainty note). Tested on a REAL run (the reference scripted ask
// of critique.test.js + the dialectic pass so `contested` is exercised), plus hand fixtures for the
// edges. The invariants: quote fidelity (nothing in the brief that is not verbatim in the result),
// the forward round-trip (carry.statements re-enters `critique` and re-gates), bounded output with an
// explicit omitted counter, and determinism.
const { test } = require('node:test');
const assert = require('node:assert');
const { createCriticalMind } = require('../../plugins/critical-mind/factory.js');
const { buildCritiqueBrief, renderJudgePrompt } = require('../../plugins/critical-mind/brief.js');

const STATEMENTS = [
	'PRO: pro argument one about cost',
	'PRO: pro argument two about speed',
	'PRO: pro argument three about morale',
	'PRO: pro argument four about focus',
	'CON: con argument one about risk',
	'CON: con argument two about coordination',
];

// the reference scripted ask (critique.test.js) + the dialectic attack leaf
function scriptedAsk() {
	return async ( q ) => {
		const u = String(q.user);
		if ( /Name the 2 main DISTINCT points of view/.test(u) )
			return /PRO statements/.test(u) ? 'V: pro efficiency\nV: pro wellbeing' : 'V: con delivery risk\nV: con coordination cost';
		if ( /Which statements GENUINELY make this exact point/.test(u) ) {
			if ( /Point of view/.test(u) )
				return /pro efficiency/.test(u) ? 'cites: p1, p2'
					: /con delivery risk/.test(u) ? 'cites: c1'
					: 'cites: NONE';
			return 'cites: NONE';
		}
		if ( /Propose ONE NEW/.test(u) ) {
			if ( /UNUSED statements:[\s\S]*p3/.test(u) ) return 'THESIS: a new pro angle | cites: p3, p4';
			if ( /UNUSED statements:[\s\S]*c2/.test(u) ) return 'THESIS: a fused con angle | cites: c2, c1';
			return 'NONE';
		}
		if ( /restatement of one known point/.test(u) ) return 'NEW';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		if ( /SPECIFICALLY CONTRADICT/.test(u) )                                 // dialectic attack leaf
			return /pro efficiency/.test(u) ? 'cites: c1' : 'cites: NONE';
		if ( /Summarize the (PRO|CON) case/.test(u) ) return 'one-line synthesis.';
		if ( /Rewrite the report/.test(u) ) return 'polished text.';
		throw new Error('unexpected prompt: ' + u.slice(0, 80));
	};
}

async function realRun() {
	const cm = createCriticalMind({ ask: scriptedAsk() });
	return cm.run({ topic: 'Should we adopt X?', statements: STATEMENTS, dialectic: true });
}

test('brief — a real run projects: sides, standings, open, unused evidence, structural facts', async () => {
	const r = await realRun();
	const b = buildCritiqueBrief(r);

	assert.equal(b.question, 'Should we adopt X?');
	assert.equal(b.frame.status, 'MATERIAL');
	assert.equal(b.verdictMechanical.verdict, 'UNDECIDED');                     // margin 1 < 3 — the STOP layer
	assert.equal(b.signals.belowBound, true);
	// sides = the ACTIVE theses only: V1 (p1+p2) + generated G1 (p3+p4) on PRO, V3 (c1) on CON
	assert.equal(b.sides.PRO.length, 2);
	assert.equal(b.sides.CON.length, 1);
	const g = b.sides.PRO.find(( t ) => t.origin === 'generated' );
	assert.ok(g, 'the generated thesis is in the brief, labeled');
	assert.deepEqual(g.witnesses.map(( w ) => w.id ), ['p3', 'p4']);
	// contested standing: V1 is attacked by c1 (dialectic), attacker carries side + verbatim quote
	const v1 = b.sides.PRO.find(( t ) => t.text === 'pro efficiency' );
	assert.equal(v1.contested, true);
	assert.deepEqual(v1.attackedBy, [{ id: 'c1', quote: 'con argument one about risk', side: 'CON' }]);
	// open points surfaced as missing evidence (pro wellbeing + con coordination)
	assert.equal(b.open.length, 2);
	// unused evidence: c2 is witness of the gate-REFUSED con thesis → cited nowhere → it is a fact
	assert.deepEqual(b.unusedEvidence.shown.map(( a ) => a.id ), ['c2']);
	assert.equal(b.unusedEvidence.omitted, 0);
	// coverage: p1 p2 p3 p4 (witnesses) + c1 (witness AND attacker) = 5 of 6
	assert.deepEqual(b.signals.coverage, { witnessesCited: 5, poolSize: 6 });
	assert.equal(b.signals.theses.contested, 1);
});

test('brief — quote fidelity: every quote/text in the brief is verbatim from the result pool', async () => {
	const r = await realRun();
	const b = buildCritiqueBrief(r);
	const poolTexts = new Set(r.pool.map(( a ) => a.text ));
	for ( const side of ['PRO', 'CON'] ) for ( const t of b.sides[side] ) {
		for ( const w of t.witnesses ) assert.ok(poolTexts.has(w.quote), 'witness quote is verbatim: ' + w.quote);
		for ( const a of t.attackedBy || [] ) assert.ok(poolTexts.has(a.quote), 'attacker quote is verbatim');
	}
	for ( const a of b.unusedEvidence.shown ) assert.ok(poolTexts.has(a.text));
});

test('brief — the FORWARD round-trips: carry.statements re-enters critique and re-gates', async () => {
	const r = await realRun();
	const b = buildCritiqueBrief(r);
	assert.equal(b.carry.statements.length, 6);
	assert.ok(b.carry.statements.every(( s ) => /^(PRO|CON): /.test(s) ));
	// the plan change: same evidence, DECLARED frame this time — the witness gate re-runs on the carry
	const cm2 = createCriticalMind({ ask: scriptedAsk() });
	const r2 = await cm2.run({ topic: 'Should we adopt X?', statements: b.carry.statements,
		viewpoints: ['PRO: pro efficiency', 'CON: con delivery risk'] });
	assert.equal(r2.frameStatus, 'DECLARED');
	assert.equal(r2.pool.length, 6, 'the whole pool crossed the call boundary');
	assert.ok(r2.ledger.some(( e ) => e.status === 'active' && e.witnesses ), 'evidence re-gated under the new frame');
});

test('judge prompt — self-contained: trust rules, verbatim witnesses, structural facts, typed output format', async () => {
	const r = await realRun();
	const b = buildCritiqueBrief(r);
	const p = renderJudgePrompt(b);
	assert.match(p, /Should we adopt X\?/);
	assert.match(p, /STOP signal/, 'the margin-is-a-stop rule is stated');
	assert.match(p, /Weighing the arguments is YOUR job/);
	assert.match(p, /"pro argument one about cost"/, 'witness quoted verbatim');
	assert.match(p, /ATTACKED by c1/, 'the standing (KP-history) is rendered');
	assert.match(p, /DECISION: PRO \| CON \| CONDITIONAL \| UNDECIDABLE/);
	assert.match(p, /CERTAINTY: high \| moderate \| low — grounded in/);
	assert.match(p, /DISJOINT dimensions/, 'the conditional-verdict path is offered');
	assert.match(p, /counts PRO 2 \/ CON 1 · margin 1/, 'structural facts rendered from the graph');
});

test('brief — determinism: the same result projects to the byte-identical brief', async () => {
	const r = await realRun();
	assert.equal(JSON.stringify(buildCritiqueBrief(r)), JSON.stringify(buildCritiqueBrief(r)));
});

// ── hand fixtures: the edges ────────────────────────────────────────────────────────────────────
const fixture = ( over ) => Object.assign({
	topic: 'T?', frameStatus: 'MATERIAL', threshold: 3, verdict: 'UNDECIDED', basis: null, norm: null,
	counts: { PRO: 1, CON: 0 }, margin: 1, synthesis: {},
	pool: [{ id: 'p1', side: 'PRO', text: 'x'.repeat(500) }, { id: 'c1', side: 'CON', text: 'short con' }],
	ledger: [{ key: 'V1', kind: 'declared', side: 'PRO', text: 'y'.repeat(500), witnesses: ['p1'], status: 'active' }],
}, over || {});

test('brief — NEG: an error result (pool too small) projects to null, and so does its prompt', () => {
	assert.equal(buildCritiqueBrief({ topic: 'T?', error: 'pool too small', ledger: [], verdict: 'UNDECIDED' }), null);
	assert.equal(renderJudgePrompt(null), null);
});

test('brief — bounded: long texts are capped with an ellipsis, never emitted whole', () => {
	const b = buildCritiqueBrief(fixture());
	assert.ok(b.sides.PRO[0].text.length <= 180 && /…$/.test(b.sides.PRO[0].text));
	assert.ok(b.sides.PRO[0].witnesses[0].quote.length <= 160 && /…$/.test(b.sides.PRO[0].witnesses[0].quote));
});

test('brief — NEG: the unused-evidence cap is never silent (omitted counter carries the rest)', () => {
	const pool = Array.from({ length: 12 }, ( _, i ) => ({ id: 'c' + (i + 1), side: 'CON', text: 'con stmt ' + (i + 1) }) );
	const b = buildCritiqueBrief(fixture({ pool, ledger: [] }));
	assert.equal(b.unusedEvidence.shown.length, 8);
	assert.equal(b.unusedEvidence.omitted, 4);
	const p = renderJudgePrompt(b);
	assert.match(p, /4 more omitted/);
});

test('brief — a retracted thesis lands in withdrawn (know it fell, do not weigh it)', () => {
	const b = buildCritiqueBrief(fixture({ ledger: [
		{ key: 'V1', kind: 'declared', side: 'PRO', text: 'kept', witnesses: ['p1'], status: 'active' },
		{ key: 'V2', kind: 'declared', side: 'CON', text: 'fell', witnesses: null, status: 'retracted' },
	] }));
	assert.equal(b.withdrawn.length, 1);
	assert.equal(b.withdrawn[0].id, 'V2');
	assert.match(renderJudgePrompt(b), /WITHDRAWN[\s\S]*\[V2\]/);
});

test('brief — NEG: a witness id missing from the pool is kept as id, never given an invented quote', () => {
	const b = buildCritiqueBrief(fixture({ ledger: [
		{ key: 'V1', kind: 'declared', side: 'PRO', text: 't', witnesses: ['p9'], status: 'active' },
	] }));
	assert.deepEqual(b.sides.PRO[0].witnesses, [{ id: 'p9' }]);
	assert.match(renderJudgePrompt(b), /witness p9: "\(text unavailable\)"/);
});
