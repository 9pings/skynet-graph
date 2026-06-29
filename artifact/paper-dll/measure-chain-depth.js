'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the COMPOSITION-DEPTH scaling measure: how compounded staleness and the recovery tax scale
 * with the LENGTH L of a learned method chain (chain-depth.js). Deterministic stub by default; live:
 *
 *   node artifact/paper-dll/measure-chain-depth.js                       # stub, L = 1..5
 *   MODEL=qwen36-q2-vram BASE=http://localhost:5000 node artifact/paper-dll/measure-chain-depth.js   # live, L = 1..3
 *
 * The honest result it measures (NOT "STRUCT's call advantage grows with L" — both amortize ~linearly in L,
 * so that ratio is ~constant): what scales with chain depth is (i) a surface memory's COMPOUNDING DEPTH —
 * CBR-L is wrong at ALL L links on the drifted class (∝ L); and (ii) STRUCT's recovery efficiency — its
 * DRIFT-TAX is O(1) in L (the cascade re-derives only link 1; every downstream re-derivation is elided by
 * read-set keying), whereas any coarse chain re-derivation is O(L). STRUCT is correct at every L and depth.
 */
const path = require('path');
const D = require('./chain-depth.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

async function main() {
	const live = !!process.env.MODEL;
	let model;
	if ( live ) {
		const { makeAsk } = require(path.resolve(__dirname, '../..') + '/lib/providers/llm.js');
		const ask = makeAsk({ base: process.env.BASE || 'http://localhost:5000', api: 'openai',
			model: process.env.MODEL, extraBody: { chat_template_kwargs: { enable_thinking: false } } });
		model = D.makeModel('live', { ask });
	} else model = D.makeModel('stub');

	const Ls = live ? [1, 2, 3] : [1, 2, 3, 4, 5];
	const wlOpts = live ? { kinds: ['loan', 'refund'], regions: ['EU', 'US'], heldOutRegion: 'none', audited: [{ region: 'EU', kind: 'loan' }], preCycles: 2, postCycles: 2 }
		: { audited: [{ region: 'EU', kind: 'loan' }] };
	out(`CHAIN-DEPTH SCALING ${live ? '(LIVE model=' + process.env.MODEL + ')' : '(deterministic stub)'} — chain length L\n`);
	out('L | arm         | calls | compound-depth | correct | drift-tax');
	out('--|-------------|------:|---------------:|:-------:|---------:');
	const rec = {};   // rec[arm][L] = {calls, compoundingDepth, allOk, driftTax}
	for ( const L of Ls ) {
		const w = D.makeChainWorkload(L, wlOpts);
		const w0 = D.makeChainWorkload(L, Object.assign({}, wlOpts, { audited: [] }));
		for ( const name of ['NAIVE-L', 'CBR-L', 'REFLEXION-L', 'STRUCT-L'] ) {
			const res = await D.CHAIN_ARMS[name](w, model);
			const s = D.score(res.A, w);
			const cold = await D.CHAIN_ARMS[name](w0, model);
			const driftTax = res.calls - cold.calls;
			( rec[name] || ( rec[name] = {} ) )[L] = { calls: res.calls, compoundingDepth: s.compoundingDepth, allOk: s.allOk, driftTax };
			out(`${L} | ${name.padEnd(11)} | ${String(res.calls).padStart(5)} | ${String(s.compoundingDepth).padStart(9)} / ${L} | ` +
				`${s.allOk ? '  ✓    ' : ' STALE '} | ${String(driftTax).padStart(8)}`);
		}
		out('--|-------------|------:|---------------:|:-------:|---------:');
	}

	// ── the scaling verdict ──
	out('\nVERDICT (chain-depth scaling):');
	const cbrCompoundsWithL = Ls.every(( L ) => rec['CBR-L'][L].compoundingDepth === L );
	const structConstTax = Ls.every(( L ) => rec['STRUCT-L'][L].driftTax === rec['STRUCT-L'][Ls[0]].driftTax );
	const structAlwaysCorrect = Ls.every(( L ) => rec['STRUCT-L'][L].allOk );
	const structAmortizes = Ls.every(( L ) => rec['STRUCT-L'][L].calls < rec['NAIVE-L'][L].calls );
	out(`  CBR-L compounding-depth == L at every L (staleness ∝ chain depth): ${cbrCompoundsWithL ? 'YES' : 'NO'}`);
	out(`  STRUCT-L drift-tax constant in L (O(1) recovery, == ${rec['STRUCT-L'][Ls[0]].driftTax}): ${structConstTax ? 'YES' : 'NO'}`);
	out(`  STRUCT-L correct at every L and depth: ${structAlwaysCorrect ? 'YES' : 'NO'}`);
	out(`  STRUCT-L amortizes vs NAIVE-L at every L: ${structAmortizes ? 'YES' : 'NO'}`);
	const pass = cbrCompoundsWithL && structConstTax && structAlwaysCorrect && structAmortizes;
	out(`  ⇒ ${pass ? 'PASS — the deeper the chain, the wider STRUCT\'s defeasance gap (compounding ∝L, recovery O(1))' : 'FAIL'}`);
}
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
