/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * makeSplitServe — the RECURSIVE composite path (KG-SPLIT GO, 2026-07-10). Single-shot emission of a COMPOSED
 * shape was REFUTED live (Q6 oriented: 0% strict / 14% relaxed — `2026-07-09-reachability-composed`); what works
 * is the recursive chain, proven live on the same corpus (55% strict / 64% relaxed / 86% kind / 0% plain
 * false-positives — `2026-07-10-recursive-split`):
 *
 *   kind-route (SET-OP / NESTED / PLAIN) → SPLIT the NL question into STANDALONE sub-questions →
 *   plain-decompose EACH sub-question with the proven oriented emission → assemble `operand|op`.
 *
 * The split is where the lift lives: a standalone sub-question decomposes at the plain rate (~78%) because the
 * sub-query no longer LEAKS into the outer reading and the certified-atom menu no longer has to steer a composite
 * question. This is what makes the COMPOSED certified vocabulary (blend/combine classes, KG-6) DISPATCHABLE — the
 * named lever for growing the trusted tier.
 *
 * The brick owns NO model (à-nu doctrine): `split` and `plain` are injected. FAIL-CLOSED routing: a malformed,
 * conflicting, or throwing split falls back to the plain path on the ORIGINAL query (tagged `fallback:true`) —
 * the router never invents a composition and never blocks a query. Honest residual (do NOT claim it): the NESTED
 * outer-with-VALUE-placeholder decomposes at ~2/6 live; set-ops are the proven half (intersect 6/6 strict).
 *
 *   const sv = makeSplitServe({ split, plain });
 *   const r = await sv.serve(query);   // { shape, kind:'plain'|'setop'|'nested', parts?, sameOperand?, fallback? }
 *
 * @param opts.split  REQUIRED async (query) => { setop:'none'|'intersect'|'except'|'union', nested:bool, q1, q2 }
 *                    — the NL splitter (an LLM call; see the kill-gate's SYS_SPLIT prompt + grammar).
 * @param opts.plain  REQUIRED async (question) => shape — the PROVEN oriented plain decomposer (menu-glossed,
 *                    canonical-order prompt; the grammar is format-insurance only — signature-stability finding).
 * @param opts.ops    optional array — accepted set-ops (default ['intersect','except','union']).
 * @returns {{ serve, stats }}
 */
function makeSplitServe( opts ) {
	opts = opts || {};
	if ( typeof opts.split !== 'function' ) throw new Error('makeSplitServe needs opts.split (async query -> {setop, nested, q1, q2})');
	if ( typeof opts.plain !== 'function' ) throw new Error('makeSplitServe needs opts.plain (async question -> shape) — the proven plain decomposer');
	var OPS = Array.isArray(opts.ops) && opts.ops.length ? opts.ops : ['intersect', 'except', 'union'];
	var stats = { served: 0, plain: 0, setop: 0, nested: 0, fallback: 0 };

	async function plainFallback( query ) {
		stats.plain++; stats.fallback++;
		return { shape: await opts.plain(query), kind: 'plain', fallback: true };
	}

	async function serve( query ) {
		stats.served++;
		var k;
		try { k = await opts.split(query) || {}; } catch ( _e ) { return plainFallback(query); }
		var isSet = OPS.indexOf(k.setop) >= 0;
		// fail-closed routing: conflicting (setop AND nested) or malformed (set-op without both sides) → plain.
		if ( (isSet && k.nested) || (isSet && !(k.q1 && k.q2)) || (k.nested && !k.q1) ) return plainFallback(query);
		if ( isSet ) {
			var s1 = await opts.plain(String(k.q1));
			var s2 = await opts.plain(String(k.q2));
			stats.setop++;
			return { shape: s1 + '|' + k.setop, kind: 'setop', sameOperand: s1 === s2, parts: { q1: k.q1, q2: k.q2, s1: s1, s2: s2 } };
		}
		if ( k.nested ) {
			var outer = await opts.plain(String(k.q1));
			stats.nested++;
			return { shape: outer + '|n', kind: 'nested', parts: { q1: k.q1, inner: k.q2 || '', s1: outer } };
		}
		stats.plain++;
		return { shape: await opts.plain(query), kind: 'plain' };   // plain: the ORIGINAL query, not q1 (no drift)
	}

	return { serve: serve, stats: stats };
}

module.exports = { makeSplitServe: makeSplitServe };
