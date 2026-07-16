'use strict';
/**
 * C9 PARITY HARNESS — the grammar face (factory-grammar.js, the debate as a concept set on the
 * native engine) versus the imperative reference (factory.js, the MEASURED pipeline). Every
 * scripted scenario of critique.test.js is replayed through BOTH and must produce:
 *   • the SAME result (counts, margin, verdict, basis, norm, journal, ledger, pool, viewpoints,
 *     synthesis, prose — prose compared byte-strict),
 *   • the SAME ask budget AND the SAME prompt set, byte-identical (order-insensitive: independent
 *     leaves fire concurrently in the grammar; at temp 0 the order cannot change any reply).
 * This is the migration gate of design §7 tranche 1(a,b): never claim the grammar face without
 * re-measuring against the reference. The 0-ask structural face (cascade retraction, the native
 * reconcile) is covered by dialectic-grammar.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { createCriticalMind: createImperative } = require('../../plugins/critical-mind/factory.js');
const { createCriticalMind: createGrammar } = require('../../plugins/critical-mind/factory-grammar.js');

const STATEMENTS = [
	'PRO: pro argument one about cost',
	'PRO: pro argument two about speed',
	'PRO: pro argument three about morale',
	'PRO: pro argument four about focus',
	'CON: con argument one about risk',
	'CON: con argument two about coordination',
];

// the full scripted ask of critique.test.js scenario 1 (viewpoints → explore → gen → SAME/NEW → synth)
function scriptedAsk() {
	return async ( q ) => {
		const u = String(q.user);
		if ( /Rewrite the report/.test(String(q.system)) ) return 'polished text.';   // polish: instruction in `system`, prose in `user`
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
		if ( /Summarize the (PRO|CON) case/.test(u) ) return 'one-line synthesis.';
		if ( /Rewrite the report/.test(u) ) return 'polished text.';
		throw new Error('unexpected prompt: ' + u.slice(0, 80));
	};
}

// run one scenario through one implementation, counting + recording every ask
async function runOne( create, makeAsk, input ) {
	const calls = [];
	const inner = makeAsk();
	const ask = async ( q ) => { calls.push(JSON.stringify({ system: q.system, user: q.user, maxTokens: q.maxTokens })); return inner(q); };
	const cm = create({ ask });
	const r = await cm.run(input);
	return { r, calls };
}

// the parity assertion: same result fields, same budget, same prompt set (byte-identical)
async function assertParity( makeAsk, input ) {
	const imp = await runOne(createImperative, makeAsk, input);
	const gra = await runOne(createGrammar, makeAsk, input);
	for ( const k of ['topic', 'frameStatus', 'error', 'rounds', 'counts', 'margin', 'threshold', 'verdict', 'basis', 'norm', 'journal', 'pool', 'viewpoints', 'ledger', 'synthesis', 'polished'] )
		assert.deepEqual(gra.r[k], imp.r[k], 'parity on `' + k + '`:\n  grammar   ' + JSON.stringify(gra.r[k]) + '\n  imperative ' + JSON.stringify(imp.r[k]));
	assert.equal(gra.r.prose, imp.r.prose, 'prose parity (byte-strict)');
	assert.equal(gra.calls.length, imp.calls.length, 'ask BUDGET parity (grammar ' + gra.calls.length + ' vs imperative ' + imp.calls.length + ')');
	assert.deepEqual(gra.calls.slice().sort(), imp.calls.slice().sort(), 'prompt SET parity (byte-identical, order-insensitive)');
	return { imp, gra };
}

test('parity — MATERIAL, witness gate + generation + honest UNDECIDED (scenario 1) + polish', async () => {
	const { gra } = await assertParity(scriptedAsk, { topic: 'Should we adopt X?', statements: STATEMENTS, polish: true });
	assert.equal(gra.r.verdict, 'UNDECIDED');                                    // the scenario's own expectations still hold
	assert.deepEqual(gra.r.counts, { PRO: 2, CON: 1 });
	assert.equal(gra.r.polished, 'polished text.');
});

test('parity — DECLARED, mechanical verdict at margin ≥ 3 (scenario 2)', async () => {
	const makeAsk = () => async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(PRO\): vpB/.test(u) ) return 'cites: p2';
		if ( /Point of view \(CON\)/.test(u) ) return 'cites: NONE';
		if ( /Which statements/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return /p3/.test(u) ? 'THESIS: extra pro one | cites: p3, p4' : 'NONE';
		if ( /restatement/.test(u) ) return 'NEW';
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const { gra } = await assertParity(makeAsk, { topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'PRO', text: 'vpB' }, { side: 'CON', text: 'vpC' }, { side: 'CON', text: 'vpD' }] });
	assert.equal(gra.r.verdict, 'PRO');
	assert.deepEqual(gra.r.counts, { PRO: 3, CON: 0 });
	assert.match(gra.r.prose, /the verdict is mechanical/);
});

test('parity — settled-norm basis, LABELED advisory (scenario 3)', async () => {
	const makeAsk = () => async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(CON\): vpC/.test(u) ) return 'cites: c1';
		if ( /Point of view/.test(u) ) return 'cites: NONE';
		if ( /Which statements/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return 'NONE';
		if ( /genuinely CONTESTED/.test(u) ) return 'SETTLED CON';
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const { gra } = await assertParity(makeAsk, { topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'CON', text: 'vpC' }] });
	assert.equal(gra.r.verdict, 'CON');
	assert.equal(gra.r.basis, 'settled-norm');
	assert.match(gra.r.prose, /ADVISORY prior/);
});

test('parity — FREE frame, two-step brainstorm (scenario 4)', async () => {
	const makeAsk = () => async ( q ) => {
		const u = String(q.user);
		if ( /Reply one per line, each: S:/.test(u) )
			return 'S: it saves a lot of money\nS: no serious framework permits it\nS: it speeds decisions up\nS: it erodes accountability\nS: bananas are yellow\nS: it boosts morale';
		if ( /Reply ONLY one of: PRO \| CON \| OFF-TOPIC/.test(u) ) {
			const s = (u.match(/Statement: ([^\n]+)/) || [])[1] || '';
			if ( /bananas/.test(s) ) return 'OFF-TOPIC';
			return /no serious framework|erodes/.test(s) ? 'CON' : 'PRO';
		}
		if ( /Name the 2 main DISTINCT/.test(u) ) return 'V: some viewpoint';
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return 'NONE';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		return 'NONE';
	};
	const { gra } = await assertParity(makeAsk, { topic: 'Should we adopt X?' });
	assert.equal(gra.r.frameStatus, 'FREE');
	assert.equal(gra.r.pool.length, 5);                                          // OFF-TOPIC dropped
	assert.deepEqual(gra.r.pool.map(( a ) => a.id ), ['p1', 'c1', 'p2', 'c2', 'p3']);
	assert.equal(gra.r.pool.find(( a ) => /no serious framework/.test(a.text) ).side, 'CON');   // forced choice, never the listed text
});

test('parity — FREE frame, ONE bounded "list MORE" re-ask (scenario 5)', async () => {
	const makeAsk = () => async ( q ) => {
		const u = String(q.user);
		if ( /Reply one per line, each: S:/.test(u) ) {
			if ( !/do NOT repeat/.test(u) ) return 'S: duty must prevail always\nS: suffering matters more than rules\nS: discipline holds the unit together';
			assert.match(u, /Already listed/);
			return 'S: duty must prevail always\nS: compassion can outweigh orders\nS: accountability needs witnesses';
		}
		if ( /Reply ONLY one of: PRO \| CON \| OFF-TOPIC/.test(u) ) {
			const s = (u.match(/Statement: ([^\n]+)/) || [])[1] || '';
			return /suffering|compassion/.test(s) ? 'PRO' : 'CON';
		}
		if ( /Name the 2 main DISTINCT/.test(u) ) return 'V: some viewpoint';
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return 'NONE';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		return 'NONE';
	};
	const { gra } = await assertParity(makeAsk, { topic: 'T?' });
	assert.equal(gra.r.pool.length, 5);                                          // 3 + 3 − 1 duplicate
	assert.ok(!gra.r.error);
});

test('parity — NEG: all-OFF-TOPIC brainstorm yields the error result, never a faked pool (scenario 6)', async () => {
	const makeAsk = () => async ( q ) => {
		const u = String(q.user);
		if ( /Reply one per line, each: S:/.test(u) ) return 'S: alpha alpha\nS: beta beta\nS: gamma gamma\nS: delta delta';
		if ( /Reply ONLY one of: PRO \| CON \| OFF-TOPIC/.test(u) ) return 'OFF-TOPIC';
		return 'NONE';
	};
	const { gra } = await assertParity(makeAsk, { topic: 'T?' });
	assert.match(gra.r.error, /pool too small/);
	assert.equal(gra.r.verdict, 'UNDECIDED');
	assert.equal(gra.r.pool.length, 0);
});

test('parity — explore retry on the STANCE slice + stance gate on cites (scenario 7)', async () => {
	const makeAsk = () => {
		let vpBCalls = 0;
		const ask = async ( q ) => {
			const u = String(q.user);
			if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
			if ( /Point of view \(PRO\): vpB/.test(u) ) { vpBCalls++; return /c1/.test(u) ? 'cites: NONE' : 'cites: p3, p4'; }
			if ( /Point of view \(CON\): vpC/.test(u) ) return 'cites: c2, p2';
			if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
			if ( /Propose ONE NEW/.test(u) ) return 'NONE';
			if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
			if ( /Summarize/.test(u) ) return 'syn.';
			return 'NONE';
		};
		ask.state = () => vpBCalls;
		return ask;
	};
	const { imp, gra } = await assertParity(makeAsk, { topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'PRO', text: 'vpB' }, { side: 'CON', text: 'vpC' }] });
	const b = gra.r.ledger.find(( e ) => e.text === 'vpB' );
	assert.equal(b.status, 'active');
	assert.deepEqual(b.witnesses, ['p3', 'p4']);
	assert.deepEqual(gra.r.ledger.find(( e ) => e.text === 'vpC' ).witnesses, ['c2']);   // p2 stance-dropped
	const isLeafB = ( c ) => c.includes('Point of view (PRO): vpB');             // the witness LEAF only (synthesis prompts also contain "vpB")
	assert.equal(imp.calls.filter(isLeafB).length, 2);                           // round 1 + exactly ONE retry — both faces
	assert.equal(gra.calls.filter(isLeafB).length, 2);
});

test('parity — G3 placement: no generation on a decidable, fully-explored node (scenario 9)', async () => {
	const makeAsk = () => async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(PRO\): vpB/.test(u) ) return 'cites: p2';
		if ( /Point of view \(PRO\): vpC/.test(u) ) return 'cites: p3';
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) throw new Error('G3 violated: a generation call was issued');
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const { gra } = await assertParity(makeAsk, { topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'PRO', text: 'vpB' }, { side: 'PRO', text: 'vpC' }] });
	assert.equal(gra.r.rounds, 0);
	assert.equal(gra.r.verdict, 'PRO');
	assert.equal(gra.r.journal.filter(( j ) => /^R0 established/.test(j) ).length, 3);
	assert.ok(!gra.r.journal.some(( j ) => /^R1/.test(j) ));
});

test('parity — single-pass guard: ONE generation pass, leftover unused args stay un-mined (scenario 10)', async () => {
	const DEEP = [];
	for ( let i = 1; i <= 10; i++ ) DEEP.push('PRO: pro statement ' + i );
	DEEP.push('CON: con one'); DEEP.push('CON: con two');
	const makeAsk = () => async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(CON\): vpB/.test(u) ) return 'cites: NONE';
		if ( /Point of view/.test(u) ) return 'cites: NONE';
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW PRO/.test(u) ) {
			const block = u.split('UNUSED statements:')[1] || '';
			const ids = block.match(/p\d+/g) || [];
			return ids.length >= 2 ? 'THESIS: another pro point | cites: ' + ids[0] + ', ' + ids[1] : 'NONE';
		}
		if ( /Propose ONE NEW CON/.test(u) ) return 'NONE';
		if ( /restatement of one known point/.test(u) ) return 'NEW';
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const { gra } = await assertParity(makeAsk, { topic: 'T?', statements: DEEP,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'CON', text: 'vpB' }] });
	assert.equal(gra.r.rounds, 1);
	assert.equal(gra.r.ledger.filter(( e ) => e.kind === 'generated' ).length, 3);   // GEN_TRIES cap
	const cited = new Set(gra.r.ledger.flatMap(( e ) => e.witnesses || [] ));
	assert.ok(!cited.has('p8') && !cited.has('p9') && !cited.has('p10'));
	assert.equal(gra.r.ledger.find(( e ) => e.text === 'vpB' ).status, 'open');
});

test('parity — dialectic: anchored attackers annotate, counts/verdict NEVER move (scenario 11)', async () => {
	const makeAsk = () => async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(CON\): vpC/.test(u) ) return 'cites: c1';
		if ( /Point of view/.test(u) ) return 'cites: NONE';
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return 'NONE';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		if ( /SPECIFICALLY CONTRADICT/.test(u) ) {
			if ( /Established point \(PRO\): vpA/.test(u) ) return 'cites: c2, p3';
			if ( /Established point \(CON\): vpC/.test(u) ) return 'cites: p2';
			return 'cites: NONE';
		}
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const { gra } = await assertParity(makeAsk, { topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'CON', text: 'vpC' }], dialectic: true });
	assert.equal(gra.r.verdict, 'UNDECIDED');
	const a = gra.r.ledger.find(( e ) => e.text === 'vpA' );
	assert.equal(a.contested, true);
	assert.deepEqual(a.attackers, ['c2']);                                       // same-side p3 stance-dropped
	assert.match(gra.r.prose, /contested — attacked by/);
});

test('parity — dialectic placement: cross-refutation NEVER runs on a decided node (scenario 12)', async () => {
	const makeAsk = () => async ( q ) => {
		const u = String(q.user);
		if ( /SPECIFICALLY CONTRADICT/.test(u) ) throw new Error('placement violated: refutation on a decided node');
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(PRO\): vpB/.test(u) ) return 'cites: p2';
		if ( /Point of view \(CON\)/.test(u) ) return 'cites: NONE';
		if ( /Which statements/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return /p3/.test(u) ? 'THESIS: extra pro one | cites: p3, p4' : 'NONE';
		if ( /restatement/.test(u) ) return 'NEW';
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const { gra } = await assertParity(makeAsk, { topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'PRO', text: 'vpB' }, { side: 'CON', text: 'vpC' }, { side: 'CON', text: 'vpD' }], dialectic: true });
	assert.equal(gra.r.verdict, 'PRO');
});

test('grammar — replay determinism: two runs of the same scripted scenario are JSON-identical', async () => {
	const one = await runOne(createGrammar, scriptedAsk, { topic: 'Should we adopt X?', statements: STATEMENTS });
	const two = await runOne(createGrammar, scriptedAsk, { topic: 'Should we adopt X?', statements: STATEMENTS });
	assert.equal(JSON.stringify(one.r), JSON.stringify(two.r));
	assert.deepEqual(one.calls, two.calls);                                      // same asks, same ORDER (serialized queue)
});
