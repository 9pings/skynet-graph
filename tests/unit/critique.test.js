'use strict';
// C9 createCriticalMind — the external critical mind combo: witness gate, fuse, anchored
// generation (0-fabrication is STRUCTURAL: witnesses must be unused in-pool same-side ids),
// the certification-aware verdict (mechanical only at the measured margin bound), prose from
// the ledger, and the MCP `critique` tool exposure.
const { test } = require('node:test');
const assert = require('node:assert');
const { createCriticalMind, reconcile } = require('../../plugins/critical-mind/factory.js');

const STATEMENTS = [
	'PRO: pro argument one about cost',
	'PRO: pro argument two about speed',
	'PRO: pro argument three about morale',
	'PRO: pro argument four about focus',
	'CON: con argument one about risk',
	'CON: con argument two about coordination',
];

// a scripted ask: viewpoints → explore cites → gen (thesis w/ witnesses) → SAME/NEW → synth
function scriptedAsk() {
	return async ( q ) => {
		const u = String(q.user);
		if ( /Name the 2 main DISTINCT points of view/.test(u) )
			return /PRO statements/.test(u) ? 'V: pro efficiency\nV: pro wellbeing' : 'V: con delivery risk\nV: con coordination cost';
		if ( /Which statements GENUINELY make this exact point/.test(u) ) {
			if ( /Point of view/.test(u) )                                       // explore leaves
				return /pro efficiency/.test(u) ? 'cites: p1, p2'
					: /con delivery risk/.test(u) ? 'cites: c1'
					: 'cites: NONE';                                              // pro wellbeing + con coordination stay OPEN
			return 'cites: NONE';                                                 // cluster leaves → full-slate fallback
		}
		if ( /Propose ONE NEW/.test(u) ) {
			if ( /UNUSED statements:[\s\S]*p3/.test(u) ) return 'THESIS: a new pro angle | cites: p3, p4';
			if ( /UNUSED statements:[\s\S]*c2/.test(u) ) return 'THESIS: a fused con angle | cites: c2, c1';   // c1 already used → only 1 valid witness → gate refusal
			return 'NONE';
		}
		if ( /restatement of one known point/.test(u) ) return 'NEW';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		if ( /Summarize the (PRO|CON) case/.test(u) ) return 'one-line synthesis.';
		if ( /Rewrite the report/.test(u) ) return 'polished text.';
		throw new Error('unexpected prompt: ' + u.slice(0, 80));
	};
}

test('C9 critique — witness gate + generation + honest UNDECIDED + prose from the ledger', async () => {
	const stages = [];
	const cm = createCriticalMind({ ask: scriptedAsk(), onStage: ( s, m ) => stages.push(s + ' ' + m) });
	const r = await cm.run({ topic: 'Should we adopt X?', statements: STATEMENTS });

	assert.equal(r.frameStatus, 'MATERIAL');                                     // caller material, announced
	assert.equal(r.pool.length, 6);
	// explore: V1 established (p1+p2), V3 established (c1), V2/V4 OPEN — an unproven point is NEVER faked
	const v1 = r.ledger.find(( e ) => e.text === 'pro efficiency' );
	assert.deepEqual(v1.witnesses, ['p1', 'p2']);
	assert.equal(r.ledger.filter(( e ) => e.status === 'open' ).length, 2);
	// generation: the pro thesis is admitted on 2 unused witnesses; the con try dies at the gate
	// (c1 is already a used witness → only c2 left → <2) — 0-fabrication is structural
	const g1 = r.ledger.find(( e ) => e.kind === 'generated' );
	assert.ok(g1 && g1.side === 'PRO');
	assert.deepEqual(g1.witnesses, ['p3', 'p4']);
	assert.equal(r.ledger.filter(( e ) => e.kind === 'generated' ).length, 1);
	// counts PRO 2 vs CON 1 → margin 1 < 3 on MATERIAL → probe says CONTESTED → honest UNDECIDED
	assert.deepEqual(r.counts, { PRO: 2, CON: 1 });
	assert.equal(r.verdict, 'UNDECIDED');
	assert.equal(r.threshold, 3);
	assert.equal(r.norm.status, 'CONTESTED');
	// prose renders from the LEDGER: frame caveat, witness quotes, open points, bottom line
	assert.match(r.prose, /Frame status: \*\*MATERIAL\*\*/);
	assert.match(r.prose, /pro argument one about cost/);                        // witness quoted verbatim
	assert.match(r.prose, /could not be established/);
	assert.match(r.prose, /no verdict is rendered/);
});

test('C9 critique — mechanical verdict at margin ≥ 3, zero model weighing', async () => {
	// 2 established PRO viewpoints + 1 generated PRO thesis vs 0 CON → margin 3 → mechanical PRO
	const ask = async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(PRO\): vpB/.test(u) ) return 'cites: p2';
		if ( /Point of view \(CON\)/.test(u) ) return 'cites: NONE';             // both CON viewpoints stay OPEN
		if ( /Which statements/.test(u) ) return 'cites: NONE';                  // cluster leaves → fallback
		if ( /Propose ONE NEW/.test(u) ) return /p3/.test(u) ? 'THESIS: extra pro one | cites: p3, p4' : 'NONE';
		if ( /restatement/.test(u) ) return 'NEW';
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'PRO', text: 'vpB' }, { side: 'CON', text: 'vpC' }, { side: 'CON', text: 'vpD' }] });
	assert.equal(r.frameStatus, 'DECLARED');
	assert.deepEqual(r.counts, { PRO: 3, CON: 0 });
	assert.equal(r.verdict, 'PRO');                                              // mechanical, by counts
	assert.match(r.prose, /the verdict is mechanical/);
});

test('C9 critique — settled-norm basis: a question that was never really open gets its verdict, LABELED advisory', async () => {
	// margin below the bound BUT the forced-choice contestedness probe says SETTLED CON, and the
	// counts do not lean the other way → verdict CON with basis 'settled-norm' (announced prior).
	const ask = async ( q ) => {
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
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'CON', text: 'vpC' }] });
	assert.deepEqual(r.counts, { PRO: 1, CON: 1 });                              // tied — below the bound
	assert.equal(r.verdict, 'CON');
	assert.equal(r.basis, 'settled-norm');
	assert.match(r.prose, /settled norm, not of the counts/);
	assert.match(r.prose, /ADVISORY prior/);
});

test('C9 critique — FREE frame: two-step brainstorm — unlabeled list, then ONE forced-choice label per statement', async () => {
	const labeled = [];
	const ask = async ( q ) => {
		const u = String(q.user);
		if ( /Reply one per line, each: S:/.test(u) )
			return 'S: it saves a lot of money\nS: no serious framework permits it\nS: it speeds decisions up\nS: it erodes accountability\nS: bananas are yellow\nS: it boosts morale';
		if ( /Reply ONLY one of: PRO \| CON \| OFF-TOPIC/.test(u) ) {
			const s = (u.match(/Statement: ([^\n]+)/) || [])[1] || '';
			labeled.push(s);
			if ( /bananas/.test(s) ) return 'OFF-TOPIC';
			return /no serious framework|erodes/.test(s) ? 'CON' : 'PRO';
		}
		if ( /Name the 2 main DISTINCT/.test(u) ) return 'V: some viewpoint';
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return 'NONE';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		return 'NONE';
	};
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'Should we adopt X?' });
	assert.equal(r.frameStatus, 'FREE');
	assert.equal(labeled.length, 6);                                             // every candidate gets its own forced-choice call
	assert.equal(r.pool.length, 5);                                              // the OFF-TOPIC one is dropped, announced
	// the side comes from the FORCED CHOICE, never from anything in the listed text — this exact
	// statement shape ("no serious framework permits it") was mislabeled PRO by the one-step prompt
	const mis = r.pool.find(( a ) => /no serious framework/.test(a.text) );
	assert.equal(mis.side, 'CON');
	assert.deepEqual(r.pool.map(( a ) => a.id ), ['p1', 'c1', 'p2', 'c2', 'p3']);
});

test('C9 critique — FREE frame: a short list gets ONE bounded "list MORE" re-ask (dedup, no forced balance)', async () => {
	let listCalls = 0;
	const ask = async ( q ) => {
		const u = String(q.user);
		if ( /Reply one per line, each: S:/.test(u) ) {
			listCalls++;
			if ( !/do NOT repeat/.test(u) ) return 'S: duty must prevail always\nS: suffering matters more than rules\nS: discipline holds the unit together';
			assert.match(u, /Already listed/);                                   // the re-ask carries the already-listed block
			return 'S: duty must prevail always\nS: compassion can outweigh orders\nS: accountability needs witnesses';   // 1 duplicate + 2 new
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
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'T?' });
	assert.equal(listCalls, 2);                                                  // initial + exactly ONE re-ask
	assert.equal(r.pool.length, 5);                                              // 3 + 3 − 1 duplicate
	assert.ok(!r.error);
});

test('C9 critique — NEG: an all-OFF-TOPIC brainstorm yields NO pool, never a faked one', async () => {
	const ask = async ( q ) => {
		const u = String(q.user);
		if ( /Reply one per line, each: S:/.test(u) ) return 'S: alpha alpha\nS: beta beta\nS: gamma gamma\nS: delta delta';
		if ( /Reply ONLY one of: PRO \| CON \| OFF-TOPIC/.test(u) ) return 'OFF-TOPIC';
		return 'NONE';
	};
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'T?' });
	assert.match(r.error, /pool too small/);
	assert.equal(r.verdict, 'UNDECIDED');
	assert.equal(r.pool.length, 0);
});

test('C9 critique — explore retries: an OPEN point retries on the STANCE SLICE; opposite-side cites are gate-dropped', async () => {
	let vpBCalls = 0;
	const ask = async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		// vpB: full pool (contains c1) → NONE; PRO slice (no c-ids rendered) → real cites. The v1.1 ladder.
		if ( /Point of view \(PRO\): vpB/.test(u) ) { vpBCalls++; return /c1/.test(u) ? 'cites: NONE' : 'cites: p3, p4'; }
		if ( /Point of view \(CON\): vpC/.test(u) ) return 'cites: c2, p2';      // p2 = opposite side → must be dropped, not admitted
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return 'NONE';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'PRO', text: 'vpB' }, { side: 'CON', text: 'vpC' }] });
	const b = r.ledger.find(( e ) => e.text === 'vpB' );
	assert.equal(b.status, 'active');
	assert.deepEqual(b.witnesses, ['p3', 'p4']);
	assert.equal(vpBCalls, 2);                                                   // round 1 + exactly ONE retry (then established)
	assert.deepEqual(r.ledger.find(( e ) => e.text === 'vpC' ).witnesses, ['c2']);   // stance gate: p2 dropped
	assert.deepEqual(r.counts, { PRO: 2, CON: 1 });
});

test('C9 re-root — reconcile (JTMS): an out-of-pool witness retracts its entry only; a witness leaving the pool cascades to every citer', () => {
	const pool = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'c1' }];
	const ledger = [
		{ key: 'V1', side: 'PRO', witnesses: ['p1'], status: 'active' },
		{ key: 'V2', side: 'PRO', witnesses: ['p2', 'p3'], status: 'active' },
		{ key: 'G1', side: 'PRO', witnesses: ['p1', 'c1'], status: 'active' },   // shares p1 with V1
		{ key: 'GX', side: 'CON', witnesses: ['x9', 'x8'], status: 'active' },   // injected bogus thesis, out-of-pool witnesses (NEG-ledger)
	];
	// NEG-ledger: only the injected out-of-pool entry retracts; its bad witnesses do NOT drag down the p1-citers
	let out = reconcile(ledger, pool, []);
	assert.deepEqual(out, ['GX']);
	assert.equal(ledger.find(( e ) => e.key === 'GX' ).status, 'retracted');
	assert.equal(ledger.find(( e ) => e.key === 'V1' ).status, 'active');
	assert.equal(ledger.find(( e ) => e.key === 'G1' ).status, 'active');
	// CASCADE via shared dead support: drop p1 from the pool → V1 AND G1 (both cite p1) fall together; V2 (p2,p3) survives
	out = reconcile(ledger, [{ id: 'p2' }, { id: 'p3' }, { id: 'c1' }], []);
	assert.deepEqual(out.sort(), ['G1', 'V1']);
	assert.equal(ledger.find(( e ) => e.key === 'V2' ).status, 'active');
});

test('C9 re-root — G3 placement: generation does NOT run on a decidable + fully-explored node (rounds 0, journal exposed)', async () => {
	let genSeen = false;
	const ask = async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(PRO\): vpB/.test(u) ) return 'cites: p2';
		if ( /Point of view \(PRO\): vpC/.test(u) ) return 'cites: p3';
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) { genSeen = true; return 'NONE'; }
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'PRO', text: 'vpB' }, { side: 'PRO', text: 'vpC' }] });
	assert.deepEqual(r.counts, { PRO: 3, CON: 0 });                              // decisive at explore (margin 3 ≥ 3), nothing open
	assert.equal(genSeen, false);                                                // G3: not one generation call issued
	assert.equal(r.rounds, 0);
	assert.equal(r.verdict, 'PRO');
	assert.match(r.prose, /the verdict is mechanical/);
	assert.ok(Array.isArray(r.journal) && r.journal.filter(( j ) => /^R0 established/.test(j) ).length === 3);
	assert.ok(!r.journal.some(( j ) => /^R1/.test(j) ));                         // no re-root round ran
});

test('C9 re-root — single-pass guard: generation is ONE proven pass, unused args are NOT mined by a 2nd round (uncertified-margin inflation guard)', async () => {
	const DEEP = [];
	for ( let i = 1; i <= 10; i++ ) DEEP.push('PRO: pro statement ' + i );       // p1..p10 — deep enough for a 2nd round to have mined more
	DEEP.push('CON: con one'); DEEP.push('CON: con two');                        // c1,c2 — vpB stays open (would keep a K=2 loop re-rooting)
	const ask = async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(CON\): vpB/.test(u) ) return 'cites: NONE';         // stays OPEN
		if ( /Point of view/.test(u) ) return 'cites: NONE';
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';         // cluster leaves → full-slate fallback
		if ( /Propose ONE NEW PRO/.test(u) ) {
			const block = u.split('UNUSED statements:')[1] || '';                 // cite the first two genuinely-unused PRO ids in the slate
			const ids = block.match(/p\d+/g) || [];
			return ids.length >= 2 ? 'THESIS: another pro point | cites: ' + ids[0] + ', ' + ids[1] : 'NONE';
		}
		if ( /Propose ONE NEW CON/.test(u) ) return 'NONE';
		if ( /restatement of one known point/.test(u) ) return 'NEW';
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'T?', statements: DEEP,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'CON', text: 'vpB' }] });
	// round 1 caps at GEN_TRIES=3 theses (p2..p7); p8,p9,p10 stay unused — a 2nd generation round is
	// deliberately NOT run (it would inflate the count past the bound by mining majority coverage)
	assert.equal(r.rounds, 1);                                                    // ONE re-root generation pass, never two
	const gen = r.ledger.filter(( e ) => e.kind === 'generated' );
	assert.equal(gen.length, 3);
	assert.ok(gen.every(( e ) => e.round === 1 ));
	assert.ok(!r.journal.some(( j ) => /^R2/.test(j) ));                          // no second round in the journal
	const cited = new Set(r.ledger.flatMap(( e ) => e.witnesses || [] ));
	assert.ok(!cited.has('p8') && !cited.has('p9') && !cited.has('p10'));         // the leftover unused args are left un-mined
	assert.equal(r.ledger.find(( e ) => e.text === 'vpB' ).status, 'open');       // the open CON point is never faked
});

test('C9 dialectic — opt-in cross-refutation enriches a contested node with anchored attackers; counts/verdict NEVER move', async () => {
	const ask = async ( q ) => {
		const u = String(q.user);
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(CON\): vpC/.test(u) ) return 'cites: c1';
		if ( /Point of view/.test(u) ) return 'cites: NONE';
		if ( /Which statements GENUINELY/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return 'NONE';
		if ( /genuinely CONTESTED/.test(u) ) return 'CONTESTED';
		if ( /SPECIFICALLY CONTRADICT/.test(u) ) {
			if ( /Established point \(PRO\): vpA/.test(u) ) return 'cites: c2, p3';   // c2 opposite-side (kept) · p3 same-side (stance-dropped)
			if ( /Established point \(CON\): vpC/.test(u) ) return 'cites: p2';
			return 'cites: NONE';
		}
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'CON', text: 'vpC' }], dialectic: true });
	// counts/verdict are the SAME as without dialectic — the attack is an annotation, not a tie-breaker
	assert.deepEqual(r.counts, { PRO: 1, CON: 1 });
	assert.equal(r.verdict, 'UNDECIDED');
	const a = r.ledger.find(( e ) => e.text === 'vpA' ), c = r.ledger.find(( e ) => e.text === 'vpC' );
	assert.equal(a.contested, true);
	assert.deepEqual(a.attackers, ['c2']);                                       // opposite-side kept; same-side p3 dropped by the stance gate
	assert.equal(c.contested, true);
	assert.deepEqual(c.attackers, ['p2']);
	assert.match(r.prose, /contested — attacked by/);
});

test('C9 dialectic — placement: cross-refutation runs ONLY on a contested node, never on a decided one; OFF by default', async () => {
	let refuteSeen = false;
	const ask = async ( q ) => {
		const u = String(q.user);
		if ( /SPECIFICALLY CONTRADICT/.test(u) ) { refuteSeen = true; return 'cites: NONE'; }
		if ( /Point of view \(PRO\): vpA/.test(u) ) return 'cites: p1';
		if ( /Point of view \(PRO\): vpB/.test(u) ) return 'cites: p2';
		if ( /Point of view \(CON\)/.test(u) ) return 'cites: NONE';
		if ( /Which statements/.test(u) ) return 'cites: NONE';
		if ( /Propose ONE NEW/.test(u) ) return /p3/.test(u) ? 'THESIS: extra pro one | cites: p3, p4' : 'NONE';
		if ( /restatement/.test(u) ) return 'NEW';
		if ( /Summarize/.test(u) ) return 'syn.';
		return 'NONE';
	};
	const cm = createCriticalMind({ ask });
	const r = await cm.run({ topic: 'T?', statements: STATEMENTS,
		viewpoints: [{ side: 'PRO', text: 'vpA' }, { side: 'PRO', text: 'vpB' }, { side: 'CON', text: 'vpC' }, { side: 'CON', text: 'vpD' }], dialectic: true });
	assert.equal(r.verdict, 'PRO');                                              // mechanical margin 3 → decided
	assert.equal(refuteSeen, false);                                             // dialectic SKIPPED on a decided node (placement)
});

test('C9 critique — MCP tool exposure: present iff critiqueAsk is wired, typed payload', async () => {
	const { defaultTools } = require('../../lib/sg/mcp.js');
	assert.ok(!defaultTools({}).some(( t ) => t.name === 'critique' ));
	const tools = defaultTools({ critiqueAsk: scriptedAsk() });
	const tool = tools.find(( t ) => t.name === 'critique' );
	assert.ok(tool && tool.inputSchema.required.includes('topic'));
	const out = await tool.call({ topic: 'Should we adopt X?', statements: STATEMENTS });
	assert.equal(out.frameStatus, 'MATERIAL');
	assert.equal(out.verdict, 'UNDECIDED');
	assert.ok(Array.isArray(out.ledger) && out.ledger.length >= 4);
	assert.match(out.prose, /Bottom line/);
});
