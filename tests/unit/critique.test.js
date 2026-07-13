'use strict';
// C9 createCriticalMind — the external critical mind combo: witness gate, fuse, anchored
// generation (0-fabrication is STRUCTURAL: witnesses must be unused in-pool same-side ids),
// the certification-aware verdict (mechanical only at the measured margin bound), prose from
// the ledger, and the MCP `critique` tool exposure.
const { test } = require('node:test');
const assert = require('node:assert');
const { createCriticalMind } = require('../../lib/combos/critique.js');

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
