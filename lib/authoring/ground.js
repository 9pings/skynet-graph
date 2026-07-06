/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * ground.js — GOLD-MINED GROUNDING RINGS (the promoted core of the 2026-07-06 ring-grounding cells).
 *
 * The grounding problem: which declared vocab unit does a surface form (a question token, a model's raw
 * extraction) refer to? Lexical matching cannot learn it (paraphrases/synonyms miss) and a model's holistic
 * judgment errs — measured on two domains (entity→table: every deterministic variant ≤ the model's 0.764;
 * attribute vocab: a loose-prompt extractor grounds 0/18 hard paraphrases). The lattice's answer is the
 * defeasible SYNONYM RING grown from ORACLE-LABELED traffic behind the one admission gate — this module is
 * that miner, promoted after two cells exercised the identical shape (tables: joins 0.764→0.800, the first
 * lever to beat the model; attributes: 0→11/18 at 0 served-wrong, traps refused).
 *
 * Episodes → per-(alias, member) evidence → `registry.js#decideRingAdmission` (the per-unit counterfactual
 * gate) → `registry.js#mergeRingProposals` (confluence + provenance, retractable). THE GRAINS THAT MATTER
 * (each measured against its own failed variant):
 *   • support ≥ minSupport (default 3) — the df-2 fluke door under a noisy oracle (Rule-of-Three);
 *   • 0 counters, with an optional per-episode `verdict` able to return 'neutral' — the middle bucket
 *     (member ∈ gold but the grounded set over-shoots) must stay NEUTRAL: counting it against kills true
 *     aliases through lexical-base noise (0.800→0.733 measured);
 *   • vacuity BOTH by base (the episode's `base` set already grounds the member without rings) AND by prior
 *     (baseRate > maxBaseRate: a member the oracle nearly always contains is grounded by the prior alone —
 *     and a degenerate/constant oracle makes EVERYTHING vacuous → 0 admissions);
 *   • the DOCTRINE (the registry's own): zero-under-noise is NOT the claim at finite support — the claim is
 *     a BOUNDED admission rate under a structureless oracle plus RECOVERABILITY (provenance `via`, one
 *     retractRingAlias per bad alias, 10/10 localized flips measured). Alias grain: prefer STABLE surface
 *     tokens over model raw extractions (24 vs 9 aliases, serve 11 vs 2 — the same-pattern raw varies).
 *
 * @param episodes  [{ aliases:[string…], gold:Set|Array|string|null, base?:Set|Array }] — one oracle-labeled
 *                  occurrence: the surface forms seen, the oracle's member(s) (null = out-of-vocabulary), and
 *                  optionally the members already grounded WITHOUT rings (the lexical/enum base).
 * @param opts.registry   a registry to grow ({keys:{[key]:{enum,…}}}), or use opts.key+opts.enum to build one.
 * @param opts.key        the registry key the rings live under (default 'unit').
 * @param opts.enum       the closed member vocabulary (required unless opts.registry carries it).
 * @param opts.minSupport gate threshold (default 3).
 * @param opts.maxBaseRate vacuity-by-prior threshold (default 0.8).
 * @param opts.verdict    optional (episode, member) => 'support'|'counter'|'neutral' — defaults to
 *                        member∈gold → 'support' else 'counter'. (The subset/overshoot rule of the table cell
 *                        is a custom verdict; 'neutral' is the load-bearing middle bucket.)
 * @param opts.via        provenance tag (default 'gold-mined').
 * @returns { registry, admitted, rejected, stats:{ candidates, admitted, vacuous, countered, confluenceRejected } }
 */

var reg = require('./registry.js');

function toSet( v ) {
	if ( v == null ) return new Set();
	if ( v instanceof Set ) return v;
	if ( Array.isArray(v) ) return new Set(v);
	return new Set([v]);
}

function mineGroundingRings( episodes, opts ) {
	opts = opts || {};
	var registry = opts.registry;
	if ( !registry ) {
		if ( !Array.isArray(opts.enum) ) throw new Error('mineGroundingRings needs opts.registry or opts.enum (the closed member vocabulary)');
		registry = { keys: {}, version: 'v1' };
		registry.keys[opts.key || 'unit'] = { enum: opts.enum.slice() };
	}
	var key = opts.key || Object.keys(registry.keys)[0] || 'unit';
	var entry = registry.keys[key];
	if ( !entry || !Array.isArray(entry.enum) ) throw new Error('mineGroundingRings: registry key "' + key + '" has no enum');
	var members = entry.enum;
	var minSupport = opts.minSupport == null ? 3 : opts.minSupport;
	var maxBaseRate = opts.maxBaseRate == null ? 0.8 : opts.maxBaseRate;
	var verdict = opts.verdict || function ( ep, member ) { return toSet(ep.gold).has(member) ? 'support' : 'counter'; };

	// vacuity-by-prior: a member the oracle nearly always names is grounded by the prior alone.
	var eps = (episodes || []).map(function ( ep ) { return { aliases: [...new Set(ep.aliases || [])], gold: toSet(ep.gold), base: toSet(ep.base) }; });
	var baseRate = {};
	for ( var mi = 0; mi < members.length; mi++ ) {
		var m = members[mi];
		var n = 0;
		for ( var e = 0; e < eps.length; e++ ) if ( eps[e].gold.has(m) ) n++;
		baseRate[m] = eps.length ? n / eps.length : 0;
	}

	// per-(alias, member) evidence over the episodes.
	var stats = {};
	for ( var i = 0; i < eps.length; i++ ) {
		var ep = eps[i];
		for ( var a = 0; a < ep.aliases.length; a++ ) {
			var alias = String(ep.aliases[a]);
			if ( !alias ) continue;
			for ( var j = 0; j < members.length; j++ ) {
				var member = members[j];
				var v = verdict(ep, member);
				if ( v !== 'support' && v !== 'counter' ) continue;                    // 'neutral' — the middle bucket
				var k = alias.toLowerCase() + '::' + member;
				var s = stats[k] || (stats[k] = { alias: alias, member: member, support: 0, counter: 0, nonVacuous: 0 });
				if ( v === 'support' ) { s.support++; if ( !ep.base.has(member) ) s.nonVacuous++; }
				else s.counter++;
			}
		}
	}

	// the gate, per candidate — then the confluence-checked merge (provenance, retractable).
	var proposals = [];
	var vacuous = 0, countered = 0, candidates = 0;
	for ( var sk in stats ) {
		var c = stats[sk];
		if ( c.support + c.counter < Math.min(2, minSupport) ) continue;               // below any evidence bar — not a candidate
		candidates++;
		var d = reg.decideRingAdmission({
			member      : c.member,
			withAlias   : c.support >= minSupport && c.counter === 0,
			withoutAlias: c.nonVacuous === 0 || baseRate[c.member] > maxBaseRate
		});
		if ( d.reason === 'vacuous' ) { vacuous++; continue; }
		if ( !d.admit ) { countered++; continue; }
		proposals.push({ key: key, alias: c.alias, member: c.member, via: opts.via || 'gold-mined' });
	}
	var merged = reg.mergeRingProposals(registry, proposals);
	return {
		registry: merged.registry,
		admitted: merged.admitted,
		rejected: merged.rejected,
		stats: { candidates: candidates, admitted: merged.admitted.length, vacuous: vacuous, countered: countered, confluenceRejected: merged.rejected.length }
	};
}

/**
 * ringTouch — the serve-side half: which members do these surface forms ground to, through the grown ring?
 * (Both cells' serve loop.) Ambiguity is the CALLER's policy — the sound default is "unique member or refuse"
 * (the hybrid rescue of the attribute cell served 11/18 at 0 wrong with exactly that rule).
 * @returns Set<member>
 */
function ringTouch( aliases, registry, key ) {
	var entry = registry && registry.keys && registry.keys[key || Object.keys(registry.keys)[0]];
	var syn = (entry && entry.synonyms) || {};
	var norm = {};
	for ( var i = 0; i < (aliases || []).length; i++ ) norm[String(aliases[i]).toLowerCase().trim()] = true;
	var touched = new Set();
	for ( var m in syn ) {
		var ring = syn[m] || [];
		for ( var a = 0; a < ring.length; a++ )
			if ( norm[String(ring[a]).toLowerCase().trim()] ) { touched.add(m); break; }
	}
	return touched;
}

module.exports = { mineGroundingRings: mineGroundingRings, ringTouch: ringTouch };
