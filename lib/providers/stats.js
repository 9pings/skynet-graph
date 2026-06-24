/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * L1 graded-evidence statistics — hierarchical Beta-Binomial shrinkage along the IS-A
 * backbone (the bounded probabilistic layer; doc/WIP/HANDOFF.md §7 Tier 2; experiment A).
 * Zero core change, and ADDITIVE: the deterministic socle is untouched — this only writes
 * SNAPPED reliability facts that a downstream `ensure` gates on (graded evidence as a
 * discrete fact + a threshold, the L1 frame, never a raw float on a defeasant gate).
 *
 * The statistical point (A3): at small n a per-leaf success rate is high-variance; shrinking
 * it toward the parent "grand mean" prior (θ̂ = (n·x̄ + κ·prior)/(n+κ)) cuts MSE ≈7× at n=2,
 * with the advantage decaying as n grows. The barrier point (A2): the leaf consumes the prior
 * SNAPPED to its own grain (the bucket midpoint), and the downstream gate keys on the snapped
 * reliability RANK — so sub-bucket noise doesn't churn the memo (snapping costs only ~1–4% MSE).
 *
 *   const { createStats, shrinkageConceptTree } = require('./stats');
 *   register(Graph, [ createStats() ]);     // wires Stats::report / Stats::grandMean / Stats::shrink
 *   // pool the children's grand mean, then (a host wave later, once the prior exists)
 *   // shrink each leaf toward the SNAPPED prior and gate Trusted on the snapped rank.
 *
 * Hierarchical ordering: the grand-mean prior must exist before a leaf can shrink toward it.
 * That is the "offline between revisions" pattern — pool first (its own settle), then add the
 * shrink wave — not a live two-level reactive pool (which would need cross-object aggregation,
 * roadmap #8). The pool reduces a race-free {__push} obs array gated on its cardinality.
 */

// ---- reliability bands: snap a probability to a discrete rank + the band MIDPOINT (the
// snapped prior the synthesis mandates). 4 bands, edges 0.5/0.75/0.9. Override via opts.bands. ----
var RELIABILITY_BANDS = [
	{ max: 0.5, label: 'low', rank: 0, mid: 0.25 },
	{ max: 0.75, label: 'med', rank: 1, mid: 0.625 },
	{ max: 0.9, label: 'high', rank: 2, mid: 0.825 },
	{ label: 'certain', rank: 3, mid: 0.95 }
];

function bandOf( p, bands ) {
	bands = bands || RELIABILITY_BANDS;
	for ( var i = 0; i < bands.length; i++ )
		if ( bands[i].max == null || p < bands[i].max ) return { rank: bands[i].rank, label: bands[i].label, mid: bands[i].mid };
	var last = bands[bands.length - 1];
	return { rank: last.rank, label: last.label, mid: last.mid };
}

/**
 * Beta-Binomial shrinkage of a leaf rate toward a prior.
 *   θ̂ = (n·x̄ + κ·prior) / (n + κ)
 * @param o.succ   leaf successes
 * @param o.tot    leaf trials (n)
 * @param o.prior  the (snapped) parent prior in [0,1]
 * @param o.kappa  shrinkage strength (pseudo-count); larger -> more pooling
 * @returns { theta, raw, n }  raw = the un-shrunk x̄ (0.5 when n=0)
 */
function shrink( o ) {
	o = o || {};
	var n = Number(o.tot) || 0,
	    succ = Number(o.succ) || 0,
	    prior = o.prior == null ? 0.5 : Number(o.prior),
	    kappa = o.kappa == null ? 8 : Number(o.kappa),
	    raw = n ? succ / n : 0.5,
	    theta = (n * raw + kappa * prior) / (n + kappa);
	return { theta: theta, raw: raw, n: n };
}

/**
 * Empirical-Bayes shrinkage strength κ from a set of per-leaf raw rates at trial size n:
 * κ ≈ n · (within-leaf sampling variance) / (between-leaf signal variance). Large when the
 * leaves barely differ beyond sampling noise (pool hard); small when they genuinely spread.
 * @param rawRates array of per-leaf x̄ in [0,1]
 * @param n        trials per leaf
 */
function empiricalBayesKappa( rawRates, n ) {
	var M = (rawRates || []).length;
	if ( !M || !n ) return 0;
	var gm = rawRates.reduce(function ( a, b ) { return a + b; }, 0) / M,
	    varRaw = rawRates.reduce(function ( a, b ) { return a + (b - gm) * (b - gm); }, 0) / M,
	    sampVar = gm * (1 - gm) / Math.max(1, n),
	    betweenVar = Math.max(1e-4, varRaw - sampVar);
	return sampVar / betweenVar * n;
}

/**
 * Build the L1 statistics provider fragment (host opt-in, like createVerifier).
 * @param opts.bands  default reliability bands (per-concept override via the concept's `stats.bands`)
 * @param opts.kappa  default shrinkage strength (default 8)
 * @returns { Stats: { report, grandMean, shrink } }
 *
 * Concept wiring:
 *   Stats::report     { require:['Cat'], provider:['Stats::report'], stats:{ poolId:'pool', succKey:'succ', totKey:'tot' } }
 *   Stats::grandMean  { require:['PoolRoot'], ensure:['$obs.length==$expected'], provider:['Stats::grandMean'] }
 *   Stats::shrink     { require:['Cat','Report'], provider:['Stats::shrink'], stats:{ poolId:'pool', priorKey:'pHat0Bucket', kappa:8 } }
 * shrink emits <as>thetaHat / <as>rawHat / <as>relRank / <as>relBucket / <as>priorMid (gate on relRank).
 */
function createStats( opts ) {
	opts = opts || {};
	var defaultBands = opts.bands,
	    defaultKappa = opts.kappa == null ? 8 : opts.kappa;

	return {
		Stats: {
			// each leaf appends its (succ,tot) into the pool's obs array (race-free {__push}).
			report: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({ poolId: 'pool', succKey: 'succ', totKey: 'tot' }, concept._schema && concept._schema.stats, argz && argz[0]),
				    push = { __push: { succ: scope._[cfg.succKey], tot: scope._[cfg.totKey] } },
				    poolWrite = { $$_id: cfg.poolId },
				    self = { $_id: '_parent' };
				self[concept._name] = true;
				poolWrite[cfg.obsKey || 'obs'] = push;
				cb(null, [self, poolWrite]);
			},

			// reduce the pooled obs -> the grand mean, SNAPPED to its band (the prior the leaves consume).
			grandMean: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({ as: '' }, concept._schema && concept._schema.stats, argz && argz[0]),
				    obs = scope._[cfg.obsKey || 'obs'] || [],
				    s = 0, t = 0;
				for ( var i = 0; i < obs.length; i++ ) { s += obs[i].succ; t += obs[i].tot; }
				var pHat0 = t ? s / t : 0.5,
				    b = bandOf(pHat0, cfg.bands || defaultBands),
				    as = cfg.as || '',
				    facts = { $_id: '_parent' };
				facts[concept._name] = true;
				facts[as + 'pHat0'] = pHat0;
				facts[as + 'pHat0Rank'] = b.rank;
				facts[as + 'pHat0Bucket'] = b.label;
				facts[as + 'pHat0Mid'] = b.mid;          // the snapped prior midpoint
				facts[as + 'pooledSucc'] = s;
				facts[as + 'pooledTot'] = t;
				cb(null, facts);
			},

			// shrink the leaf toward the parent's SNAPPED prior; snap θ̂ to a reliability rank.
			shrink: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({ poolId: 'pool', priorKey: 'pHat0Bucket', succKey: 'succ', totKey: 'tot', as: '' },
					concept._schema && concept._schema.stats, argz && argz[0]),
				    bands = cfg.bands || defaultBands,
				    pool = graph.getEtty(cfg.poolId)._,
				    priorMid, r;
				// consume the SNAPPED prior (the band midpoint) — barrier-clean, no continuous leak.
				// Prefer an explicit midpoint fact (grandMean writes pHat0Mid); else resolve it from
				// the pool's snapped band label.
				if ( cfg.priorMidKey ) {
					priorMid = pool[cfg.priorMidKey];
				} else {
					var label = pool[cfg.priorKey],
					    band = (bands || RELIABILITY_BANDS).filter(function ( x ) { return x.label === label; })[0];
					priorMid = band ? band.mid : 0.5;
				}
				r = shrink({ succ: scope._[cfg.succKey], tot: scope._[cfg.totKey], prior: priorMid, kappa: cfg.kappa == null ? defaultKappa : cfg.kappa });
				var b = bandOf(r.theta, bands),
				    as = cfg.as || '',
				    facts = { $_id: '_parent' };
				facts[concept._name] = true;
				facts[as + 'thetaHat'] = r.theta;
				facts[as + 'rawHat'] = r.raw;
				facts[as + 'relRank'] = b.rank;
				facts[as + 'relBucket'] = b.label;
				facts[as + 'priorMid'] = priorMid;
				cb(null, facts);
			}
		}
	};
}

/**
 * A ready-made hierarchical-shrinkage fragment. Returns the two waves separately because the
 * prior must exist before the leaves shrink (the offline-between-revisions ordering):
 *   .pool   — the PoolRoot/Pool (grandMean) + Cat/Report concepts (wave 1, boot it);
 *   .shrink — the Reliability (shrink) + Trusted gate concept (wave 2, addConcept once pooled).
 * @param opts.kappa        shrinkage strength
 * @param opts.trustedRank  the Trusted gate threshold on the snapped rank (default 2 = high)
 * @param opts.poolId       the pool object id (default 'pool')
 */
function shrinkageConceptTree( opts ) {
	opts = opts || {};
	var poolId = opts.poolId || 'pool',
	    trustedRank = opts.trustedRank == null ? 2 : opts.trustedRank,
	    stats = { poolId: poolId };
	if ( opts.kappa != null ) stats.kappa = opts.kappa;
	return {
		pool: {
			childConcepts: {
				PoolRoot: {
					_id: 'PoolRoot', _name: 'PoolRoot', require: ['PoolRoot'],
					childConcepts: {
						Pool: { _id: 'Pool', _name: 'Pool', require: ['PoolRoot'], ensure: ['$obs.length==$expected'], provider: ['Stats::grandMean'] }
					}
				},
				Cat: {
					_id: 'Cat', _name: 'Cat', require: ['Cat'],
					childConcepts: {
						Report: { _id: 'Report', _name: 'Report', require: ['Cat'], provider: ['Stats::report'], stats: { poolId: poolId } }
					}
				}
			}
		},
		shrink: {
			_id: 'Reliability', _name: 'Reliability', require: ['Cat', 'Report'], provider: ['Stats::shrink'], stats: stats,
			childConcepts: {
				Trusted: { _id: 'Trusted', _name: 'Trusted', require: ['Reliability'], ensure: ['$relRank>=' + trustedRank] }
			}
		}
	};
}

module.exports = {
	RELIABILITY_BANDS: RELIABILITY_BANDS,
	bandOf: bandOf,
	shrink: shrink,
	empiricalBayesKappa: empiricalBayesKappa,
	createStats: createStats,
	shrinkageConceptTree: shrinkageConceptTree
};
