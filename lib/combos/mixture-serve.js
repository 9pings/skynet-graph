/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * C8 — the MIXTURE-RUNTIME server (owner "cerveau gauche × LLM intuitif", 2026-07-09). A cheap local model,
 * ORIENTED by a forged certified-method stock, serves what a trust-gate can vouch for at 0 big-model cost, and
 * ESCALATES the rest to a bigger/frontier tier (the tiered corrector, proven 10/16). A thin assembly over the
 * proven arc — orientation (exact 5→8/36 gold-free, `WIP/experiments/2026-07-09-orientation` + `…-mixture-runtime`)
 * + tiered correction (`…-tiered-correction`) — adding only the runtime trust-gate.
 *
 * ⟐ THE HONEST GUARANTEE (kill-gated live on Spider, Ministral-8B; the confront de-leaked the numbers):
 *   1. 0-FALSE lives on the LEARNED CERTIFIED LAYER, never on the decomposition PICK. The stock's shapes are
 *      gold-certified at forge time (`stock.js#goldGate`); at runtime a shape is only ever SERVED-AS-CERTIFIED if
 *      it is in that vocabulary. We NEVER claim the small's chosen shape is correct — that is "pas gagné" (owner).
 *   2. ORIENTATION improves the SCORE, not the soundness: the certified menu lifts the small's exact-match
 *      (+3/36 gold-free, measured) — a quality lever, cost-free, no guarantee attached.
 *   3. The TRUST-GATE is a CONFIDENCE gate, not a truth oracle. The only gate that reached 0-false live is
 *      CROSS-AGREEMENT — the small's oriented shape EQUALS an INDEPENDENT predictor's shape (surface k-NN). Two
 *      independent signals concurring = trustable (100% precision live, ~38% recall). Self-consistency and a
 *      self-fit check did NOT separate correct from a confidently-wrong misread (a systematic misread is stable).
 *      ⚠ INDEPENDENCE IS LOAD-BEARING (live finding): the cross-agreement precision COLLAPSES (100%→60% live) if
 *      `proposeMenu` and `predict` share the SAME surface signal — the menu then STEERS the small toward the very
 *      shape the predictor will name, so "agreement" is circular. Wire the FLAT certified menu (default) for
 *      orientation and keep `predict` as the independent signal; do NOT surface-narrow the menu AND predict from
 *      the same k-NN (narrowing is a large-stock optimization, but then use a DIFFERENT independent predictor).
 *   4. ESCALATION carries the residual: whatever the trust-gate does not vouch for goes to the big tier (no false
 *      negative — the caller always gets an answer). The big model, not the gate, is what corrects a misread.
 *   5. PRE-ROUTING is where the amortization actually lives (Fable-review correction, verified on the memoized
 *      traces `WIP/experiments/2026-07-09-amortization-e2e/prerouting.js`): gate-AFTER-small makes every query pay
 *      the small pass, so a high escalation rate costs MORE than big-alone (+28% live). A TEXT-ONLY router that
 *      sends predicted-uncovered queries STRAIGHT to the big tier (skipping the wasted small pass) turns the same
 *      k-NN predictor into +2%, and a perfect covered/uncovered router into −18%. `preRoute` wires that router
 *      BEFORE the small call; it never touches the trust decision (a pre-routed serve is a plain escalation).
 * So: closed-vocabulary soundness + a small MEASURED 0-false trusted tier + a raw-score lift + escalation of the
 * rest. The amortization is `1 − escalation-rate`; grow it by growing the stock / a tighter independent predictor,
 * and CAPTURE it by pre-routing (route-then-gate, never pay-small-first).
 *
 * Bricks stay usable "à nu": `small`/`big`/`proposeMenu`/`predict` are all INJECTED (the combo owns no model and
 * no corpus). `makeSurfaceDispatch` is an optional helper that builds `proposeMenu`+`predict` from a labelled
 * anchor corpus (TF-IDF k-NN) — the surface signal is real (+20 pts over permuted-labels) but modest over the
 * frequency prior, so it is an OPTIMIZATION (narrow a large stock + feed the cross-agreement gate), never load-bearing.
 *
 *   const sd = makeSurfaceDispatch({ anchors: [{text, shape}, …], k: 5 });
 *   const mx = createMixtureServe({ certifiedShapes, small, big, proposeMenu: sd.proposeMenu, predict: sd.predict });
 *   const r = await mx.serve(query);   // { shape, tier:'local-trusted'|'escalated'|'local-untrusted', certified, … }
 *
 * @param opts.certifiedShapes  REQUIRED array<string> — the learned 0-false vocabulary (from the forged `.sgc` stock).
 * @param opts.small     REQUIRED async (query, menu) => shape — the cheap tier-1 model, oriented by `menu`.
 * @param opts.big       optional async (query, menu) => shape — the tier-2 escalation (frontier corrector). Absent
 *                       → an untrusted result is returned tagged `local-untrusted` (the host decides), never forced.
 * @param opts.proposeMenu optional (query) => array<string> — the oriented menu (surface-narrowed); default = the
 *                       flat certified vocabulary (already gold-free; narrowing is the optional optimization).
 * @param opts.predict   optional (query) => shape — an INDEPENDENT shape predictor (surface k-NN). Enables the
 *                       default CROSS-AGREEMENT trust-gate. Without it (and without `trust`) nothing is auto-trusted
 *                       (fail-closed: everything escalates) — we never auto-trust a bare certified shape (47% live).
 * @param opts.trust     optional (query, shape, ctx{menu,predicted}) => bool — override the trust predicate.
 * @param opts.preRoute  optional true | (query, ctx{predicted,menu}) => bool — route-then-gate (the amortization
 *                       capture): decided BEFORE the small call; `true` routes a query whose predicted shape is
 *                       OUTSIDE the certified vocabulary straight to `big` (needs `predict`); a function is a
 *                       custom router (return true = go direct). Inert without a `big` tier (fail-safe: the small
 *                       path still serves). A pre-routed record is `tier:'escalated', preRouted:true`.
 * @param opts.onServe   optional (record) => void — a per-serve hook (telemetry).
 * @returns {{ serve, stats, certifiedShapes }}
 */
function createMixtureServe( opts ) {
	opts = opts || {};
	var shapes = opts.certifiedShapes;
	if ( !Array.isArray(shapes) || !shapes.length ) throw new Error('createMixtureServe needs opts.certifiedShapes (the learned certified vocabulary from the forged stock)');
	if ( typeof opts.small !== 'function' ) throw new Error('createMixtureServe needs opts.small (async (query, menu) -> shape) — the cheap tier-1 model');
	var certified = Object.create(null); shapes.forEach(function ( s ) { certified[s] = true; });
	var big = (typeof opts.big === 'function') ? opts.big : null;
	var proposeMenu = (typeof opts.proposeMenu === 'function') ? opts.proposeMenu : function () { return shapes; };
	var predict = (typeof opts.predict === 'function') ? opts.predict : null;
	// default trust = CROSS-AGREEMENT when an independent predictor is given; else fail-closed (never auto-trust).
	var trust = (typeof opts.trust === 'function') ? opts.trust
		: (predict ? function ( q, shape, ctx ) { return shape === ctx.predicted; } : function () { return false; });
	var onServe = (typeof opts.onServe === 'function') ? opts.onServe : null;
	// pre-router (route-then-gate): default = predicted shape outside the certified vocabulary → go direct to big.
	var router = (typeof opts.preRoute === 'function') ? opts.preRoute
		: (opts.preRoute ? function ( q, ctx ) { return !certified[ctx.predicted]; } : null);
	if ( router && !predict && typeof opts.preRoute !== 'function' ) throw new Error('createMixtureServe preRoute:true needs opts.predict (the text-only covered/uncovered signal) — or pass a custom router function');
	var stats = { served: 0, localTrusted: 0, escalated: 0, localUntrusted: 0, preRouted: 0 };

	async function serve( query ) {
		stats.served++;
		var menu = proposeMenu(query) || shapes;
		var predicted = predict ? predict(query) : undefined;   // ONE predict call: shared by the router and the gate
		if ( router && big && router(query, { predicted: predicted, menu: menu }) ) {
			var dshape = await big(query, menu);
			stats.preRouted++; stats.escalated++;
			var drec = { shape: dshape, tier: 'escalated', certified: !!certified[dshape], trusted: false, preRouted: true, predicted: predicted };
			if ( onServe ) onServe(Object.assign({ query: query }, drec));
			return drec;
		}
		var shape = await opts.small(query, menu);
		var isCert = !!certified[shape];
		var trusted = isCert && !!trust(query, shape, { menu: menu, predicted: predicted });
		var rec;
		if ( trusted ) {
			stats.localTrusted++;
			rec = { shape: shape, tier: 'local-trusted', certified: true, trusted: true, predicted: predicted };
		} else if ( big ) {
			var bshape = await big(query, menu);
			stats.escalated++;
			rec = { shape: bshape, tier: 'escalated', certified: !!certified[bshape], trusted: false, local: shape, predicted: predicted };
		} else {
			stats.localUntrusted++;
			rec = { shape: shape, tier: 'local-untrusted', certified: isCert, trusted: false, predicted: predicted };
		}
		if ( onServe ) onServe(Object.assign({ query: query }, rec));
		return rec;
	}

	return { serve: serve, stats: stats, certifiedShapes: shapes.slice() };
}

// --- makeSurfaceDispatch: the KG-1 surface signal promoted to a reusable brick (TF-IDF k-NN over labelled anchors).

var STOP = { 'the': 1, 'a': 1, 'an': 1, 'of': 1, 'to': 1, 'in': 1, 'on': 1, 'for': 1, 'and': 1, 'or': 1, 'is': 1, 'are': 1, 'was': 1, 'were': 1, 'be': 1, 'with': 1, 'by': 1, 'at': 1, 'as': 1, 'from': 1, 'that': 1, 'this': 1, 'these': 1, 'those': 1, 'what': 1, 'which': 1, 'who': 1, 'how': 1, 'many': 1, 'much': 1, 'list': 1, 'show': 1, 'give': 1, 'find': 1, 'name': 1, 'number': 1, 'count': 1, 'all': 1, 'each': 1, 'every': 1, 'their': 1, 'its': 1, 'there': 1 };
function tokenize( s ) { return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(function ( w ) { return w && w.length > 1 && !STOP[w]; }); }
function vectorize( toks, idf ) {
	var tf = {}, i; for ( i = 0; i < toks.length; i++ ) tf[toks[i]] = (tf[toks[i]] || 0) + 1;
	var v = {}, n = 0, w; for ( w in tf ) { var x = tf[w] * (idf[w] || 0); v[w] = x; n += x * x; }
	n = Math.sqrt(n) || 1; for ( w in v ) v[w] /= n; return v;
}
function cosine( a, b ) { var s = 0, x = a, y = b, w; if ( Object.keys(a).length > Object.keys(b).length ) { x = b; y = a; } for ( w in x ) if ( y[w] ) s += x[w] * y[w]; return s; }

/**
 * Build the surface-dispatch pair (`proposeMenu` + `predict`) from a labelled anchor corpus — the same signal the
 * KG-1 kill-gate measured (real geometry, +20 pts over permuted-labels; modest over the frequency prior, so an
 * optimization). Deterministic (pure TF-IDF, index-stable tie-breaks). The anchors are TRAINING queries of the
 * certified classes (their `shape` is the training label) — no runtime gold.
 * @param opts.anchors  REQUIRED array<{ text, shape }> — labelled training queries.
 * @param opts.k        proposal menu size (default 5).
 * @returns {{ proposeMenu, predict }} — proposeMenu(query) => top-k distinct shapes (cosine-vote); predict(query)
 *          => the single top-1 shape (for the cross-agreement trust-gate).
 */
function makeSurfaceDispatch( opts ) {
	opts = opts || {};
	var anchors = opts.anchors;
	if ( !Array.isArray(anchors) || !anchors.length ) throw new Error('makeSurfaceDispatch needs opts.anchors ([{text, shape}])');
	var K = opts.k == null ? 5 : opts.k;
	var toks = anchors.map(function ( a ) { return tokenize(a.text); });
	var df = {}; toks.forEach(function ( t ) { var seen = {}, i; for ( i = 0; i < t.length; i++ ) if ( !seen[t[i]] ) { seen[t[i]] = 1; df[t[i]] = (df[t[i]] || 0) + 1; } });
	var idf = {}, w; for ( w in df ) idf[w] = Math.log((anchors.length + 1) / (df[w] + 1)) + 1;
	var vecs = toks.map(function ( t ) { return vectorize(t, idf); });

	// ranked (shape -> summed cosine) over ALL anchors, ties broken by lexical shape then first-seen index.
	function rankShapes( query ) {
		var qv = vectorize(tokenize(query), idf), byShape = {}, i;
		for ( i = 0; i < anchors.length; i++ ) { var sh = anchors[i].shape, s = cosine(qv, vecs[i]); byShape[sh] = (byShape[sh] || 0) + s; }
		return Object.keys(byShape).sort(function ( a, b ) { return (byShape[b] - byShape[a]) || (a < b ? -1 : 1); });
	}
	return {
		proposeMenu: function ( query ) { return rankShapes(query).slice(0, K); },
		predict: function ( query ) { return rankShapes(query)[0] || null; }
	};
}

/**
 * qualifyMenu — present the certified shapes with their SLOT QUALIFICATIONS so the small conforms to the reference
 * vocabulary instead of deviating off-menu (the owner's "meilleure qualification des slots"). Kill-gated live: a
 * slot-glossed menu lifted in-stock exact-match +3/18 (8→11) over the opaque shape strings, because the loss is
 * CONFORMANCE (the small emits an off-reference shape), not selection-among-options (KG-3). Pure/deterministic; the
 * host supplies the domain gloss (a step→meaning map — the "role" the lattice types each slot with).
 * @param shapes    array<string> — the certified shapes (e.g. "join>filter>select").
 * @param glossMap  { <stepKind>: "human meaning" } — the per-slot role. Missing kinds echo the kind.
 * @param sep       the step separator inside a shape (default '>').
 * @returns array<string> — each shape annotated "shape (kind=meaning, …)" for the orientation prompt.
 */
function qualifyMenu( shapes, glossMap, sep ) {
	var s = sep || '>', g = glossMap || {};
	return (shapes || []).map(function ( shape ) {
		var parts = String(shape).split(s).map(function ( k ) { return k + '=' + (g[k] || k); });
		return shape + ' (' + parts.join(', ') + ')';
	});
}

module.exports = { createMixtureServe: createMixtureServe, makeSurfaceDispatch: makeSurfaceDispatch, qualifyMenu: qualifyMenu };
