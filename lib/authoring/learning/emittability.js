/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * emittability — the SIGNATURE-STABILITY / paraphrase-consistency profiler (roadmap STAGE-0 Grammar-P1
 * instrument, 2026-07-01). Read-only measurement: given the intake `FactsDigest` a small model produces
 * for many PARAPHRASES of the same latent task, does the typed signature stay STABLE? Everything
 * downstream (dispatch, cache, call-elision, method reuse) keys on that digest; if paraphrases fragment
 * the key, the memo never hits (K1 fragmentation) — so this is the component SCREEN feeding the
 * end-to-end call-count gate (paper-dll arms). It is NOT itself the make-or-break gate (Laurie confront).
 *
 * TWO failure modes, not one (Laurie confront — the load-bearing correction):
 *   • FRAGMENTATION (cheap): paraphrases of ONE task scatter into several digests → wasted calls.
 *     Measured by within-task agreement (`collisionProb`, the unbiased Simpson estimator).
 *   • COLLISION (correctness-fatal): TWO DIFFERENT tasks land on the SAME digest → the memo returns the
 *     WRONG method. Measured by cross-task HOMOGENEITY of the pooled partition (V-measure).
 * A scheme that maps EVERYTHING to one tuple scores perfect within-task agreement and is catastrophic;
 * only the pooled two-partition view (reference=task vs induced=digest) catches that. So we report BOTH,
 * with a HIGHER bar on homogeneity than on completeness.
 *
 * Chance correction (the vacuousness alarm): raw agreement can't tell "stable" from "always emits the same
 * enum". Fleiss' κ (1971) subtracts the pooled-marginal chance agreement → κ→0 under mode collapse even as
 * raw agreement→1 (the κ paradox under skew is here a FEATURE). NOTE for the memo, chance agreement is REAL
 * value (a hit is a hit), so `collisionProb` is the OPERATIONAL number and κ is the VALIDITY/discrimination
 * number — reported side by side, never conflated.
 *
 * The "by construction" split (the crux): grammar-constrained decoding guarantees FORMAT VALIDITY + VOCAB
 * CLOSURE (digest drawn from a finite known set → H(D|T) bounded). It does NOT guarantee SEMANTIC
 * consistency (which enum member → H(D|T)≈0, nuisance-invariance in the Information-Bottleneck sense) — and
 * can DISTORT it (Park et al. 2024, Grammar-Aligned Decoding). So to measure the semantic half you must NET
 * OUT format: compare arms only on inputs where BOTH emitted an in-vocab label (`crossArmAgreement`).
 *
 * `untyped` is NOT dropped (survivorship bias) — it is its own digest class ⊥; `typedRate` is reported
 * separately from the digest agreement. Refs: Simpson 1949; Fleiss 1971; Rosenberg & Hirschberg 2007
 * (V-measure); Hubert & Arabie 1985 (ARI); Errica et al. 2025 (sensitivity/consistency of LM labels).
 *
 * Pure + synchronous (unit-tested). No engine coupling — it consumes plain intake-result records.
 */

var UNTYPED = '⊥';   // ⊥ — the digest class for a non-typed (out-of-vocab / errored) intake.

// the digest CLASS of one intake result: its FactsDigest when typed, else ⊥.
function signatureClass( r ) {
	return (r && r.status === 'typed' && r.digest != null) ? String(r.digest) : UNTYPED;
}

function countBy( items, keyOf ) {
	var m = new Map();
	items.forEach(function ( x ) { var k = keyOf(x); m.set(k, (m.get(k) || 0) + 1); });
	return m;
}

function log2( x ) { return Math.log(x) / Math.LN2; }

// Shannon entropy (bits) of a count map over N items.
function entropyOf( counts, N ) {
	if ( !N ) return 0;
	var h = 0;
	counts.forEach(function ( n ) { if ( n > 0 ) { var p = n / N; h -= p * log2(p); } });
	return h;
}

/**
 * Within-task statistics for ONE task's paraphrase results.
 * @param results [{status, digest}]  the K paraphrase intake results for one latent task.
 * @param classOf (optional) override the class projection (for per-field marginals).
 * @returns { K, typedRate, collisionProb, modalCoverage, effectiveSignatures, numClasses, counts }
 *   collisionProb   — UNBIASED Simpson estimator Σ n_i(n_i-1)/[K(K-1)] = P(two paraphrases collide on the
 *                     same digest) = the memo-hit event. null when K<2. PRIMARY.
 *   modalCoverage   — max n_i / K. SECONDARY (upward-biased at small K — flag, don't lead with it).
 *   effectiveSignatures — 1/Σ p_i^2 (plug-in Hill-2): how many memo keys one task splinters into.
 */
function perTaskStats( results, classOf ) {
	classOf = classOf || signatureClass;
	var K = results.length;
	var typed = results.filter(function ( r ) { return r && r.status === 'typed'; }).length;
	var counts = countBy(results, classOf);
	var sumNiNi1 = 0, sumP2 = 0, modal = 0;
	counts.forEach(function ( n ) { sumNiNi1 += n * (n - 1); sumP2 += (n / K) * (n / K); if ( n > modal ) modal = n; });
	return {
		K: K,
		typedRate: K ? typed / K : 0,
		collisionProb: K > 1 ? sumNiNi1 / (K * (K - 1)) : null,
		modalCoverage: K ? modal / K : 0,
		effectiveSignatures: sumP2 > 0 ? 1 / sumP2 : 0,
		numClasses: counts.size,
		counts: counts,
	};
}

/**
 * Pooled two-partition agreement over ALL tasks (reference partition = taskId, induced = digest class).
 * @param groups [{ taskId, results:[{status,digest}] }]
 * @returns { N, homogeneity, completeness, vMeasure, ari, miBits, hClass, hCluster }
 *   homogeneity  — 1 - H(task|digest)/H(task): each digest holds ONE task = COLLISION-FREE (the safety
 *                  direction; bar it HIGH).
 *   completeness — 1 - H(digest|task)/H(digest): each task's paraphrases share ONE digest = consistency.
 *   vMeasure     — harmonic mean (the rate-distortion pair collapsed to one number; report H & C too).
 *   ari          — Adjusted Rand Index (chance-corrected pooled agreement, Hubert & Arabie 1985).
 */
function poolAgreement( groups, classOf ) {
	classOf = classOf || signatureClass;
	var points = [];
	groups.forEach(function ( g ) { g.results.forEach(function ( r ) { points.push({ cls: g.taskId, clu: classOf(r) }); }); });
	var N = points.length;
	if ( !N ) return { N: 0, homogeneity: 1, completeness: 1, vMeasure: 1, ari: 1, miBits: 0, hClass: 0, hCluster: 0 };

	var classCounts = countBy(points, function ( p ) { return p.cls; });
	var cluCounts   = countBy(points, function ( p ) { return p.clu; });
	// joint contingency table keyed "clsclu"
	var joint = countBy(points, function ( p ) { return p.cls + '' + p.clu; });

	var hClass = entropyOf(classCounts, N), hCluster = entropyOf(cluCounts, N);
	// H(class|cluster) = Σ_k (|k|/N) H(class within k) = H(class,cluster) - H(cluster)
	var hJoint = entropyOf(joint, N);
	var hClassGivenClu = hJoint - hCluster;         // ≥0 (numerical clamp below)
	var hCluGivenClass = hJoint - hClass;
	if ( hClassGivenClu < 0 ) hClassGivenClu = 0;
	if ( hCluGivenClass < 0 ) hCluGivenClass = 0;

	var homogeneity  = hClass  === 0 ? 1 : 1 - hClassGivenClu / hClass;
	var completeness = hCluster === 0 ? 1 : 1 - hCluGivenClass / hCluster;
	var vMeasure = (homogeneity + completeness) === 0 ? 0 : 2 * homogeneity * completeness / (homogeneity + completeness);
	var miBits = hCluster - hCluGivenClass;         // I(class;cluster)

	// ── Adjusted Rand Index (Hubert & Arabie 1985) ──
	var choose2 = function ( n ) { return n * (n - 1) / 2; };
	var sumJoint = 0; joint.forEach(function ( n ) { sumJoint += choose2(n); });
	var sumA = 0; classCounts.forEach(function ( n ) { sumA += choose2(n); });
	var sumB = 0; cluCounts.forEach(function ( n ) { sumB += choose2(n); });
	var totPairs = choose2(N);
	var expected = totPairs ? (sumA * sumB) / totPairs : 0;
	var maxIndex = (sumA + sumB) / 2;
	var ari = (maxIndex - expected) === 0 ? 1 : (sumJoint - expected) / (maxIndex - expected);

	return { N: N, homogeneity: homogeneity, completeness: completeness, vMeasure: vMeasure, ari: ari, miBits: miBits, hClass: hClass, hCluster: hCluster };
}

/**
 * Fleiss' κ (1971) over tasks: items = tasks, ratings = the K paraphrase digest-classes, categories = the
 * union of digest classes seen. The vacuousness alarm: mode collapse → Pe→1 → κ→0 (or vacuous). Handles
 * per-item K_i (generalized). @returns { kappa, Pbar, Pe, vacuous }
 */
function fleissKappa( groups, classOf ) {
	classOf = classOf || signatureClass;
	var perItem = groups.map(function ( g ) {
		var K = g.results.length;
		var counts = countBy(g.results, classOf);
		var sumSq = 0; counts.forEach(function ( n ) { sumSq += n * n; });
		var Pi = K > 1 ? (sumSq - K) / (K * (K - 1)) : null;   // = the unbiased Simpson for this item
		return { counts: counts, K: K, Pi: Pi };
	}).filter(function ( it ) { return it.Pi != null; });
	if ( !perItem.length ) return { kappa: null, Pbar: null, Pe: null, vacuous: true };

	var Pbar = perItem.reduce(function ( s, it ) { return s + it.Pi; }, 0) / perItem.length;
	var totalRatings = perItem.reduce(function ( s, it ) { return s + it.K; }, 0);
	var catTotals = new Map();
	perItem.forEach(function ( it ) { it.counts.forEach(function ( n, cat ) { catTotals.set(cat, (catTotals.get(cat) || 0) + n); }); });
	var Pe = 0; catTotals.forEach(function ( n ) { var p = n / totalRatings; Pe += p * p; });
	var vacuous = (1 - Pe) < 1e-12;
	return { kappa: vacuous ? null : (Pbar - Pe) / (1 - Pe), Pbar: Pbar, Pe: Pe, vacuous: vacuous };
}

/**
 * Cross-arm SEMANTIC agreement, format NETTED OUT (the (a)/(b)-isolating comparison — Laurie + SOTA).
 * Given two arms' results ALIGNED by input index, restrict to inputs where BOTH are `typed`
 * (both in-vocab) and report the fraction whose digest AGREES. This is what tells whether the grammar
 * constraint changes the SEMANTIC choice vs a format-guaranteed control — could be ≤0 (Park et al. 2024).
 * @param a,b  aligned arrays [{status,digest}] (same inputs, same order).
 * @returns { nBothTyped, agree, agreeFraction, aTypedRate, bTypedRate }
 */
function crossArmAgreement( a, b ) {
	var n = Math.min(a.length, b.length), both = 0, agree = 0, at = 0, bt = 0;
	for ( var i = 0; i < n; i++ ) {
		var ta = a[i] && a[i].status === 'typed', tb = b[i] && b[i].status === 'typed';
		if ( ta ) at++; if ( tb ) bt++;
		if ( ta && tb ) { both++; if ( String(a[i].digest) === String(b[i].digest) ) agree++; }
	}
	return { nBothTyped: both, agree: agree, agreeFraction: both ? agree / both : null, aTypedRate: n ? at / n : 0, bTypedRate: n ? bt / n : 0 };
}

/**
 * Aggregate profile for one arm over many paraphrase-task groups.
 * @param groups [{ taskId, results:[{status,digest,facts?}] }]
 * @param opts.fields  optional [fieldName...] → also report per-field MARGINAL stability (a low marginal
 *                     localizes the instability + flags a field that should be DEMOTED off the tracked digest).
 * @returns aggregate (per-task array, means with the replication unit = TASK, pooled agreement, κ, marginals)
 */
function profile( groups, opts ) {
	opts = opts || {};
	var perTask = groups.map(function ( g ) {
		var s = perTaskStats(g.results);
		return { taskId: g.taskId, K: s.K, typedRate: s.typedRate, collisionProb: s.collisionProb, modalCoverage: s.modalCoverage, effectiveSignatures: s.effectiveSignatures, numClasses: s.numClasses };
	});
	var withCollision = perTask.filter(function ( t ) { return t.collisionProb != null; });
	var mean = function ( arr, f ) { return arr.length ? arr.reduce(function ( s, x ) { return s + f(x); }, 0) / arr.length : null; };

	var out = {
		nTasks: groups.length,                                          // the replication unit for population claims
		perTask: perTask,
		meanCollisionProb: mean(withCollision, function ( t ) { return t.collisionProb; }),
		meanModalCoverage: mean(perTask, function ( t ) { return t.modalCoverage; }),
		meanTypedRate: mean(perTask, function ( t ) { return t.typedRate; }),
		minCollisionProb: withCollision.length ? Math.min.apply(null, withCollision.map(function ( t ) { return t.collisionProb; })) : null,
		pool: poolAgreement(groups),
		fleiss: fleissKappa(groups),
	};
	if ( opts.fields ) {
		out.marginals = {};
		opts.fields.forEach(function ( field ) {
			var proj = function ( r ) {
				if ( !r || r.status !== 'typed' || !r.facts || r.facts[field] == null ) return UNTYPED;
				return field + '=' + String(r.facts[field]);
			};
			var pt = groups.map(function ( g ) { var s = perTaskStats(g.results, proj); return { taskId: g.taskId, collisionProb: s.collisionProb, modalCoverage: s.modalCoverage }; });
			var wc = pt.filter(function ( t ) { return t.collisionProb != null; });
			out.marginals[field] = { perTask: pt, meanCollisionProb: mean(wc, function ( t ) { return t.collisionProb; }), pool: poolAgreement(groups, proj) };
		});
	}
	return out;
}

module.exports = {
	UNTYPED: UNTYPED,
	signatureClass: signatureClass,
	perTaskStats: perTaskStats,
	poolAgreement: poolAgreement,
	fleissKappa: fleissKappa,
	crossArmAgreement: crossArmAgreement,
	profile: profile,
	_entropyOf: entropyOf,   // exported for the unit test
};
