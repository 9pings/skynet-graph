/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * registry — the interface-alphabet REGISTRY (Σ_sep), G-1 rung 3b: the STAGE-1 keystone as a FIRST-CLASS,
 * CURATED, VERSIONED object (the owner's library CATALOG). It promotes the DERIVED separator alphabet
 * (`decompose.js#bagInterface.sigmaSep`) + the typed value vocabulary (enum members / curated synonym RINGS /
 * grain / sort, from `prompt.facts`) from scattered-per-concept to ONE object where the vocabulary LIVES,
 * versioned and enforceable. It is the home of three things this session built separately:
 *   • the curated SYNONYM RINGS (rung 1) — now sourced FROM the registry (`specForKey`), not re-inlined per concept;
 *   • the cross-method COHERENCE (rung 3) — now checkable against the FROZEN canon, not just within one tree;
 *   • the borderline PROPOSALS (rung 2) — admitted via `mergeRingProposals` (confluence re-checked), converging the ring.
 *
 * TIERS (the soundness/flexibility split — §9 vocab topology): a key ∈ `sigmaSep` (a cross-tile SEPARATOR) is
 * **Tier-1** (the closed, frozen, producer↔consumer interface); everything else is **Tier-2** (open interior). Freezing
 * is on Tier-1 only — a new Tier-1 value must go through a validated proposal (version bump); Tier-2 stays open.
 *
 *   const reg = freezeRegistry(deriveRegistry(tree), 'v1');   // derive + stamp the canon
 *   const spec = specForKey(reg, 'severity');                 // { enum, synonyms } for canonValue — the ring lives here
 *   const reg2 = mergeRingProposals(reg, borderlineProposals);// admit validated aliases → the ring converges (v2)
 *   const { errors } = checkTreeAgainstRegistry(otherTree, reg);// enforce: no off-canon Tier-1 value / un-registered key
 */
const { eachConcept, refsOf, refKeyOf } = require('../core/validate.js');
const { conceptCliques, bagInterface } = require('../core/decompose.js');
const { compileEnumMap, normToken } = require('../../providers/canonicalize.js');

// the literal STRING values an applyMutations template WRITES per key (a closed-vocab value written by a template —
// part of the reachable vocabulary). Same discipline as validate.js#templateStringValues (kept local for independence).
function templateValues( tpl, out ) {
	out = out || {};
	(function walk( n ) {
		if ( Array.isArray(n) ) return n.forEach(walk);
		if ( n && typeof n === 'object' ) for ( const k in n ) {
			const v = n[k];
			if ( typeof v === 'string' && k[0] !== '$' && k !== '_id' && v[0] !== '$' ) (out[k] = out[k] || new Set()).add(v);
			else if ( v && typeof v === 'object' ) walk(v);
		}
	})(tpl);
	return out;
}

const uniq = ( xs ) => [...new Set(xs)];

/**
 * Derive the registry from a concept tree (does not FREEZE it — that is `freezeRegistry`). Total: any confluence
 * conflict in the merged rings is RECORDED (`reg.conflicts`), never thrown (a tree can be inconsistent; the caller gates).
 * @returns { version:null, frozen:false, keys:{ <key>: entry }, conflicts:[{key,error}] }
 *   entry = { tier:1|2, enum?:[..], synonyms?:{member:[alias]}, grain?, sort?, producers:[name], consumers:[name], values:[..] }
 */
function deriveRegistry( tree ) {
	const sep = new Set(bagInterface(conceptCliques(tree)).sigmaSep);   // the cross-tile separator alphabet (a Tier-1 signal)
	const keys = Object.create(null);
	const ent = ( k ) => (keys[k] = keys[k] || { producers: new Set(), consumers: new Set(), values: new Set() });

	eachConcept(tree, ( c ) => {
		if ( !c._name ) return;
		const schema = c._schema || c;
		ent(c._name).producers.add(c._name);                            // the self-flag is produced by the concept
		const facts = schema.prompt && schema.prompt.facts;
		if ( facts ) for ( const key of Object.keys(facts) ) {
			const spec = facts[key], e = ent(key);
			e.producers.add(c._name);
			if ( spec && spec.enum ) {
				e.enum = uniq([...(e.enum || []), ...spec.enum]);
				for ( const m of spec.enum ) e.values.add(m);
				if ( spec.synonyms ) { e.synonyms = e.synonyms || {};
					for ( const member of Object.keys(spec.synonyms) )
						e.synonyms[member] = uniq([...(e.synonyms[member] || []), ...(spec.synonyms[member] || [])]); }
			}
			if ( spec && spec.grain != null ) e.grain = spec.grain;
			if ( spec && spec.sort != null ) e.sort = spec.sort;
		}
		const tv = templateValues(schema.applyMutations);               // template writes → producer + reachable values
		for ( const key of Object.keys(tv) ) { const e = ent(key); e.producers.add(c._name); for ( const v of tv[key] ) e.values.add(v); }
		for ( const r of refsOf(schema.require, false).concat(refsOf(schema.ensure, true), refsOf(schema.assert, true)) )
			ent(refKeyOf(r).key).consumers.add(c._name);                // a gate → consumer of the key
	});

	const conflicts = [];
	const out = { version: null, frozen: false, keys: {}, conflicts };
	for ( const k of Object.keys(keys) ) {
		const e = keys[k];
		// Tier-1 = a cross-tile SEPARATOR (sigmaSep) OR a typed enum interface that is BOTH produced and consumed (an
		// actual interface vocabulary — the sigmaSep structural cut can miss it on small trees). Else Tier-2 (interior).
		const tier = (sep.has(k) || (e.enum && e.producers.size && e.consumers.size)) ? 1 : 2;
		const entry = { tier, producers: [...e.producers].sort(), consumers: [...e.consumers].sort(), values: [...e.values].sort() };
		if ( e.enum ) entry.enum = e.enum;
		if ( e.synonyms ) entry.synonyms = e.synonyms;
		if ( e.grain != null ) entry.grain = e.grain;
		if ( e.sort != null ) entry.sort = e.sort;
		if ( entry.enum ) { try { compileEnumMap(specForEntry(entry)); } catch ( err ) { conflicts.push({ key: k, error: err.message }); } }
		out.keys[k] = entry;
	}
	return out;
}

// a canonValue spec ({enum, synonyms, grain}) for a registry ENTRY — the source of truth for the barrier (the ring LIVES here).
function specForEntry( entry ) {
	const spec = {};
	if ( entry.enum ) spec.enum = entry.enum;
	if ( entry.synonyms ) spec.synonyms = entry.synonyms;
	if ( entry.grain != null ) spec.grain = entry.grain;
	return spec;
}
/** The canonValue spec for a registry KEY, or null if the key carries no typed vocabulary. */
function specForKey( reg, key ) {
	const entry = reg && reg.keys && reg.keys[key];
	if ( !entry || (!entry.enum && entry.grain == null) ) return null;
	return specForEntry(entry);
}

/**
 * Resolve a `prompt.facts` schema against the registry: a spec `{ ref: '<key>' }` is REPLACED by the registry's canonical
 * spec for that key (enum + ring + grain) — so a concept REFERENCES the registry vocabulary instead of re-inlining the
 * ring (one source of truth; the ring lives in the registry). A local `from` (the raw reply key) is preserved. A spec
 * without `ref` passes through unchanged. An unknown/non-typed ref is left AS-IS and reported in `unresolved` (the caller
 * decides: an author-time ERROR, or a runtime untyped/CanonMiss).
 * @returns { facts, unresolved:[{key,ref}] }
 */
function resolveFactsSchema( factsSchema, registry ) {
	const facts = {}, unresolved = [];
	for ( const key of Object.keys(factsSchema || {}) ) {
		const spec = factsSchema[key] || {};
		if ( spec.ref ) {
			const rspec = specForKey(registry, spec.ref);
			if ( rspec ) facts[key] = Object.assign(rspec, spec.from != null ? { from: spec.from } : {});
			else { facts[key] = spec; unresolved.push({ key, ref: spec.ref }); }
		} else facts[key] = spec;
	}
	return { facts, unresolved };
}

/** Stamp a version + FREEZE the registry (Tier-1 becomes the closed canon; Tier-2 stays open). Returns a new object. */
function freezeRegistry( reg, version ) {
	return Object.assign({}, reg, { frozen: true, version: version == null ? (reg.version || 'v1') : version });
}

/**
 * Admit borderline / LILO ring PROPOSALS into the registry (propose-only → validated). Each `{key, alias, member}` is
 * added to key's ring iff (a) member is a registered enum member of key, and (b) the resulting ring stays CONFLUENT
 * (the critical-pair check — `compileEnumMap` does not throw). Rejected proposals are returned; on any admit the version
 * bumps. Never mutates the input registry.
 * @returns { registry, admitted:[{key,alias,member}], rejected:[{key,alias,member,reason}] }
 */
function mergeRingProposals( reg, proposals ) {
	const keys = JSON.parse(JSON.stringify(reg.keys || {}));
	const provenance = Object.assign({}, reg.ringProvenance || {});   // parallel { <provKey> -> {member,via} } — audit + retraction handle
	const admitted = [], rejected = [];
	for ( const p of (proposals || []) ) {
		const entry = keys[p.key];
		if ( !entry || !entry.enum ) { rejected.push(Object.assign({ reason: 'no such enum key' }, p)); continue; }
		if ( entry.enum.indexOf(p.member) < 0 ) { rejected.push(Object.assign({ reason: 'member not in the enum' }, p)); continue; }
		const trial = { enum: entry.enum, synonyms: Object.assign({}, entry.synonyms) };
		trial.synonyms[p.member] = uniq([...(trial.synonyms[p.member] || []), p.alias]);
		try { compileEnumMap(trial); }
		catch ( err ) { rejected.push(Object.assign({ reason: 'breaks confluence: ' + err.message }, p)); continue; }
		entry.synonyms = trial.synonyms; admitted.push(p);
		// PROVENANCE (Laurie confront): tag every admitted alias with its source. Model-independent value — it makes an
		// admission AUDITABLE and RETRACTABLE (the outcome-blame loop / a curator can find + retractRingAlias a model-
		// sourced entry). Keyed post-normToken so it lines up with canonValue's lookup + retractRingAlias.
		provenance[provKey(p.key, p.alias)] = { member: p.member, via: p.via || 'proposal' };
	}
	const version = admitted.length ? bumpVersion(reg.version) : reg.version;
	return { registry: Object.assign({}, reg, { keys, version, ringProvenance: provenance }), admitted, rejected };
}
const provKey = ( key, alias ) => key + '::' + normToken(alias);

/**
 * RETRACT a synonym-ring ALIAS — the un-learn verb for the ring, and the actual DEFUSER of a bad autonomous admission
 * (Laurie confront: "8/8 does not certify an oracle" — Rule-of-Three 95% upper bound ≈ 37% on 8 samples; so soundness
 * rests on RECOVERABILITY, not oracle reliability. A strong model lowers the RATE of a wrong admit; retraction bounds the
 * DAMAGE). It is the vocabulary-level sibling of relearn.js's blame→un-learn, and the "teeth" that make the registry's
 * "audited + retractable" envelope actually TRUE (there was no retraction path — the ring only ever ADDED).
 *
 * Removes `alias` (by normToken) from every member's ring under `key`, which DE-LOCKS it: because mergeRingProposals is
 * first-writer-wins-under-confluence, a wrong `catastrophic→low` blocks the correct `catastrophic→high` ("breaks
 * confluence"); after retraction the corrected proposal is admissible (removal can never break confluence). The version
 * bumps iff something changed — and the bump IS the invalidation signal (B8 version-gates the replay paths, so a digest/
 * cache entry typed via the retracted alias is gated, not silently served stale). Never mutates the input registry.
 * @returns { registry, retracted:bool, member:(the member the alias mapped to, or null) }
 */
function retractRingAlias( reg, key, alias ) {
	const keys = JSON.parse(JSON.stringify(reg.keys || {}));
	const entry = keys[key];
	const na = normToken(alias);
	let member = null, changed = false;
	if ( entry && entry.synonyms ) {
		for ( const m of Object.keys(entry.synonyms) ) {
			const before = entry.synonyms[m] || [];
			const after = before.filter(( a ) => normToken(a) !== na);
			if ( after.length !== before.length ) { member = m; changed = true; }
			if ( after.length ) entry.synonyms[m] = after; else delete entry.synonyms[m];
		}
		if ( Object.keys(entry.synonyms).length === 0 ) delete entry.synonyms;
	}
	const provenance = Object.assign({}, reg.ringProvenance || {});
	if ( provenance[provKey(key, alias)] ) { delete provenance[provKey(key, alias)]; changed = true; }
	const version = changed ? bumpVersion(reg.version) : reg.version;
	return { registry: Object.assign({}, reg, { keys, version, ringProvenance: provenance }), retracted: changed, member };
}
function bumpVersion( v ) {
	const m = /^v(\d+)$/.exec(String(v || 'v1'));
	return m ? 'v' + (Number(m[1]) + 1) : String(v || 'v1') + '+1';
}

/**
 * The vocabulary-grain ADMISSION rule (G4) — the ratchet's teeth applied to a surface ALIAS. Pure decision:
 * given the episode verdicts under the TWO counterfactuals (with the proposed alias→member mapping applied,
 * and without any mapping), admit iff the alias is LOAD-BEARING for the success — the verdict passes WITH it
 * and fails WITHOUT it (the vacuity guard: a benign word whose episode succeeds anyway must never enter the
 * ring). LOCALIZATION (a single pending alias exercised per episode — the 8d credit discipline, see
 * parametric.js#attributeSlotCredit) is the CALLER's tooth: this rule assumes the two verdicts are
 * attributable to THIS alias. Member-UNIQUENESS over the whole enum is deliberately NOT required — on one
 * episode members are verdict-equivalent by category class (requiring uniqueness would self-seal a correct
 * alias forever, the lab's C-arm defect at vocab grain); intra-class discrimination = the semantic prior
 * (the model's proposal picks the member) + the defeasible envelope (support via `creditRingAlias`, damage
 * bounded by `retractRingAlias`). Report `equivalents` (how many members would also pass) as a DIAGNOSTIC,
 * never a gate.
 * @param opts { member, withAlias:bool, withoutAlias:bool }
 * @returns { admit, reason } — reason ∈ admit|no-proposal|vacuous|failed-verify
 */
function decideRingAdmission( opts ) {
	if ( !opts || !opts.member || opts.member === 'none' ) return { admit: false, reason: 'no-proposal' };
	if ( opts.withoutAlias ) return { admit: false, reason: 'vacuous' };
	if ( !opts.withAlias ) return { admit: false, reason: 'failed-verify' };
	return { admit: true, reason: 'admit' };
}

/**
 * CREDIT a ring alias on a VERIFIED reuse — the `confiance` half of the defeasible ring's {source, confiance}
 * envelope (`via` = the source, `support` = verified-use count; the reading a curator or a selection pressure
 * consumes). Rule-of-Three stays the doctrine: support bounds what verified use can certify — soundness rests
 * on RECOVERABILITY (retractRingAlias), never on the count. An AUTHORED alias (in a ring with no provenance
 * entry) gets `{via:'authored'}` on first credit, so confidence reads uniformly across sources. Does NOT bump
 * the version: support changes no resolution semantics, so version-gated replay/caches must not invalidate on
 * credit. Never mutates the input registry.
 * @returns { registry, member, support } — support = the new count, or null when the alias resolves nowhere under key.
 */
function creditRingAlias( reg, key, alias ) {
	const entry = reg && reg.keys && reg.keys[key];
	const na = normToken(alias);
	let member = null;
	if ( entry && entry.synonyms )
		for ( const m of Object.keys(entry.synonyms) )
			if ( (entry.synonyms[m] || []).some(( a ) => normToken(a) === na) ) { member = m; break; }
	if ( member == null ) return { registry: reg, member: null, support: null };   // exact enum words are not ring entries
	const provenance = Object.assign({}, reg.ringProvenance || {});
	const pk = provKey(key, alias);
	const prev = provenance[pk] || { member, via: 'authored' };
	provenance[pk] = Object.assign({}, prev, { support: (prev.support || 0) + 1 });
	return { registry: Object.assign({}, reg, { ringProvenance: provenance }), member, support: provenance[pk].support };
}

/**
 * Enforce a concept tree against a registry — "crystallize/dispatch consult the registry". Two findings, kept sound:
 *   • off-canon VALUE (ERROR when frozen) — a concept types a key with an enum value the registry's enum for that key
 *     does NOT list. A registered enum IS the closed vocabulary for that key (any tier), so this is a clear canon
 *     divergence → hard error on a frozen canon (a warning otherwise). SOUND: no false errors — subset trees are clean.
 *   • un-registered enum KEY (WARN) — the tree types an enum key the registry does not know. This is ADVISORY, never a
 *     hard error: it may be a legit Tier-2 (interior) extension OR a Tier-1 omission — the curator decides. (Freezing
 *     cannot soundly hard-refuse an unknown key without knowing it MUST be Tier-1.)
 * @returns { errors, warnings }  each `{ concept, kind, message }`.
 */
function checkTreeAgainstRegistry( tree, reg ) {
	const errors = [], warnings = [];
	const frozen = !!(reg && reg.frozen);
	const known = (reg && reg.keys) || {};
	eachConcept(tree, ( c ) => {
		if ( !c._name ) return;
		const facts = (c._schema || c).prompt && (c._schema || c).prompt.facts;
		if ( !facts ) return;
		for ( const key of Object.keys(facts) ) {
			const spec = facts[key];
			if ( !spec || !spec.enum ) continue;
			const entry = known[key];
			if ( !entry || !entry.enum ) {                              // an enum key the canon does not know → advisory only
				warnings.push({ concept: c._name, kind: 'unregistered-interface-key', message: `typed interface key "${key}" is not in the registry — register it (Tier-1) or confirm it is a Tier-2 interior extension` });
				continue;
			}
			for ( const v of spec.enum ) if ( entry.enum.indexOf(v) < 0 )   // a value outside the registered closed vocabulary
				(frozen ? errors : warnings).push({ concept: c._name, kind: 'off-canon-value', tier: entry.tier,
					message: `key "${key}" value "${v}" is not in the registry enum {${entry.enum.join(', ')}} — the tree diverged from the canon; add it via a validated proposal` });
		}
	});
	return { errors, warnings };
}

// "validate consults the registry" — compose the author-time structural validator with the registry enforcement (kept
// here, not in validate.js, to avoid a require cycle: registry already depends on validate). Merges both finding sets.
function validateWithRegistry( tree, reg, opts ) {
	const base = require('../core/validate.js').validateConceptTree(tree, opts);
	const ren = checkTreeAgainstRegistry(tree, reg);
	return { errors: base.errors.concat(ren.errors), warnings: base.warnings.concat(ren.warnings) };
}

// ─────────────────────────── the AUTONOMOUS convergence loop (the living catalog — sibling of relearn.js) ──────────────
//
// The engine drives borderline PROPOSAL → validated ring GROWTH as REACTIVE concepts at the stabilize fixpoint, with NO
// host glue (mirrors `relearn.js`'s blame→revise loop). A proposer (the rung-2 borderline gate, or any) deposits a
// proposal on a FRESH proxy node (`proposalTemplate`, #22-safe: one node → one fire); a `RegistryMerge` meta-concept
// (`require:['proposalMember'], ensure:['!$merged']`) fires; `Reg::merge` admits it via `mergeRingProposals` (member∈enum
// ∧ CONFLUENCE re-checked) into a MUTABLE registry container so every closure (the `resolveFacts` seam) sees the grown
// ring — the exogenous vocabulary CONVERGES autonomously. An invalid proposal is REJECTED (registry unchanged) but still
// marks `merged` (no re-fire / no `divergent`, the #33 GOTCHA). Curation stays a gate: `mergeRingProposals` is the gate.

/** The reactive convergence flow as a concept tree. @param opts.name  meta-concept id (default 'RegistryMerge'). */
function registryLoopTree( opts ) {
	opts = opts || {};
	const name = (opts && opts.name) || 'RegistryMerge';
	const tree = { childConcepts: {} };
	tree.childConcepts[name] = { _id: name, _name: name, require: ['proposalMember'], ensure: ['!$merged'], provider: ['Reg::merge'] };
	return tree;
}

/** Build a proposal-deposit template (a FRESH proxy node per proposal → RegistryMerge fires exactly once). `via` carries
 *  the source (e.g. 'llm-borderline') into the admit provenance. */
function proposalTemplate( proposal, id ) {
	return { $$_id: id, proposalKey: proposal.key, proposalAlias: proposal.alias, proposalMember: proposal.member, proposalVia: proposal.via };
}

/**
 * The reactive merge provider (host opt-in, like `makeRelearnProviders`). `Reg::merge` admits the pending proposal into a
 * MUTABLE registry container (so the grown ring is visible to every closure — the living catalog).
 * @param opts.regBox  { registry } — the mutable container (merge swaps in the grown registry). Or pass opts.registry.
 * @param opts.onMerge optional (mergeResult, regBox) => void — a hook (audit / persist the versioned registry).
 * @returns { Reg: { merge } }
 */
function makeRegistryLoopProviders( opts ) {
	opts = opts || {};
	const regBox = opts.regBox || { registry: opts.registry };
	return { Reg: {
		merge: function ( graph, concept, scope, argz, cb ) {
			const e = (scope && scope._) || {};
			const p = { key: e.proposalKey, alias: e.proposalAlias, member: e.proposalMember, via: e.proposalVia };
			const r = mergeRingProposals(regBox.registry, [p]);
			regBox.registry = r.registry;                            // swap in the grown registry (closures re-read it)
			if ( opts.onMerge ) { try { opts.onMerge(r, regBox); } catch ( _e ) {} }
			cb(null, { $_id: '_parent', RegistryMerge: true, merged: true,   // self-flag + re-fire guard (#33)
				registryVersion: regBox.registry.version, admitted: r.admitted.length > 0,
				rejectedReason: r.rejected.length ? r.rejected[0].reason : null });
		}
	} };
}

module.exports = { deriveRegistry, freezeRegistry, specForKey, resolveFactsSchema, mergeRingProposals, retractRingAlias, decideRingAdmission, creditRingAlias, checkTreeAgainstRegistry, validateWithRegistry,
	registryLoopTree, proposalTemplate, makeRegistryLoopProviders };
