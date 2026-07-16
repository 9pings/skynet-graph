/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * glossary — the P2 cross-round terminology REFERENCE (the "glossaire de campagne"): a persistent,
 * lattice-backed store of canonical GROUNDED notions (theses / arguments / tags) that follows the pool
 * BETWEEN refinement rounds. It is the condition of a reliable re-split (the C9 re-plan / the generative
 * loop's round 2): without a managed reference, duplicates go invisible, meaning drifts, and a re-split
 * cites phantom keys. It is [ZERO-CORE] — it ASSEMBLES organs that already exist and are tested:
 *
 *   • RECONCILIATION composes TWO gates (they compose, they do not compete):
 *       – witness-overlap ≥ θ = the GROUNDED semantic selector — which existing notion a new term duplicates
 *         (it picks the ring MEMBER). Same denominator as the generative loop's merge check (critique.js).
 *       – `registry.js#mergeRingProposals` = the SAFETY + AUDIT layer — it admits the alias under CONFLUENCE
 *         (a surface phrasing can never denote TWO notions → no silent collision), tags provenance, and BUMPS
 *         the version (the invalidation signal that version-gates stale caches/digests). A bad merge is
 *         RETRACTABLE (`retractRingAlias`) — a plain Set (the harness) can do none of this.
 *   • ENTRY-level JTMS retract (a notion whose witnesses left the pool) cascades via the uniform in-pool test
 *     — the same structural reconcile the C9/boucle-generative harness proved, here over the PERSISTENT store.
 *
 * Modelled as a registry with ONE Tier-2 key `notion` whose `enum` GROWS as notions are harvested (the
 * canonical ids) and whose `synonyms[id]` holds the surface phrasings; the ring primitives operate
 * generically on `reg.keys[key]`, so a hand-built single-key registry is a legal registry.
 *
 *   const g = createGlossary();
 *   g.harvest({ text: 'open-source maximizes adoption', witnesses: ['p1','p3'], side: 'PRO' });  // → {status:'added', id:'n1'}
 *   g.harvest({ text: 'openness drives uptake',        witnesses: ['p1','p4'], side: 'PRO' });  // → {status:'merged', id:'n1'} (overlap 0.5, alias audited)
 *   g.inject();                                                                                  // citable vocabulary block
 *   g.reconcile(pool);                                                                           // JTMS entry-retract (witnesses gone → cascade)
 *
 * NOTE: a notion enters the ring only when GROUNDED (≥1 witness) — 0-fabrication: harvest never invents a
 * witness, inject renders only the store. An ungrounded (open) point is not a canonical notion yet.
 */
const { digest, normToken } = require('../../providers/canonicalize.js');
const { mergeRingProposals, retractRingAlias, creditRingAlias } = require('../lattice/registry.js');
const { clusterByGrounding, arbitrate } = require('../lattice/granularity.js');

const overlapOf = ( a, b ) => {                                                 // |shared| / |candidate|, candidate = a
	if ( !a.length ) return 0;
	const set = new Set(b);
	return a.filter(( x ) => set.has(x) ).length / a.length;
};

function createGlossary( opts ) {
	opts = opts || {};
	const KEY = opts.key || 'notion';
	const THETA = opts.overlap != null ? opts.overlap : 0.5;
	// a legal single-key registry (Tier-2, open interior); the ring primitives read `reg.keys[key]` generically.
	let registry = { version: 'v1', frozen: false, conflicts: [], ringProvenance: {},
		keys: { [KEY]: { tier: 2, enum: [], synonyms: {}, producers: [], consumers: [], values: [] } } };
	const entries = new Map();                                                  // id -> { id, text, witnesses[], side, type, round, provenance, status, aliases[] }
	let counter = 0;

	const memberOfAlias = ( text ) => {                                        // the notion a surface phrasing already denotes (or null)
		const na = normToken(text), syn = registry.keys[KEY].synonyms || {};
		for ( const m of Object.keys(syn) ) if ( (syn[m] || []).some(( a ) => normToken(a) === na ) ) return m;
		return null;
	};
	const propose = ( member, alias, via ) => {                                // admit an alias through the CONFLUENCE gate; swap in the grown (versioned) registry on admit
		const r = mergeRingProposals(registry, [{ key: KEY, member, alias, via: via || 'harvest' }]);
		if ( r.admitted.length ) { registry = r.registry; return { admitted: true }; }
		return { admitted: false, reason: (r.rejected[0] && r.rejected[0].reason) || 'rejected' };
	};

	/**
	 * Harvest one grounded element into the glossary. Returns the reconciliation outcome:
	 *   { status:'added', id }          a NEW canonical notion
	 *   { status:'merged', id, alias }  a duplicate of `id` (surface identity OR grounded overlap ≥ θ) — alias audited
	 *   { status:'conflict', id, rejectedReason }  the surface would denote TWO notions — SURFACED, never silently merged
	 *   { status:'ungrounded' }         no witness → not a canonical notion (0-fabrication)
	 * @param entry { text, witnesses:[argId], side?, type?, round?, provenance? }
	 */
	function harvest( entry ) {
		const text = String((entry && entry.text) || '').trim();
		const witnesses = ((entry && entry.witnesses) || []).slice();
		if ( !text ) return { status: 'ungrounded', reason: 'no text' };
		if ( !witnesses.length ) return { status: 'ungrounded', reason: 'no witness (0-fabrication: a notion enters the ring only when grounded)' };
		const side = entry.side != null ? String(entry.side).toUpperCase() : null;

		// (1) SURFACE IDENTITY — the exact phrasing already names a notion → that notion, definitively.
		const surf = memberOfAlias(text);
		if ( surf ) { entries.get(surf).aliases.push({ text, witnesses, via: 'surface' }); return { status: 'merged', id: surf, alias: text }; }

		// (2) GROUNDED OVERLAP — witness-overlap ≥ θ picks the member; the ring gate admits/audits the alias.
		let best = null, bestOv = 0;
		for ( const e of entries.values() ) {
			if ( e.status !== 'active' || !e.witnesses.length ) continue;
			if ( side && e.side && e.side !== side ) continue;                 // never merge across sides
			const ov = overlapOf(witnesses, e.witnesses);
			if ( ov > bestOv ) { bestOv = ov; best = e; }
		}
		if ( best && bestOv >= THETA ) {
			const r = propose(best.id, text, entry.provenance);
			if ( r.admitted ) { best.aliases.push({ text, witnesses, via: entry.provenance || 'harvest' }); return { status: 'merged', id: best.id, alias: text }; }
			return { status: 'conflict', id: best.id, rejectedReason: r.reason };   // confluence refused — SURFACED, not silently collided
		}

		// (3) NEW GROUNDED NOTION — extend the enum, register its text as the first alias (version bumps).
		const id = 'n' + (++counter);
		registry.keys[KEY].enum = registry.keys[KEY].enum.concat([id]);
		const r = propose(id, text, entry.provenance);
		if ( !r.admitted ) {                                                    // the text already denotes another notion → a disguised merge into its owner
			registry.keys[KEY].enum = registry.keys[KEY].enum.filter(( x ) => x !== id );
			const owner = memberOfAlias(text);
			if ( owner ) { entries.get(owner).aliases.push({ text, witnesses, via: 'surface-late' }); return { status: 'merged', id: owner, alias: text }; }
			counter--; return { status: 'conflict', id: null, rejectedReason: r.reason };
		}
		entries.set(id, { id, text, witnesses: witnesses.slice(), side, type: entry.type || null,
			round: entry.round != null ? entry.round : 0, provenance: entry.provenance || 'harvest', status: 'active', aliases: [] });
		return { status: 'added', id };
	}

	/**
	 * JTMS entry-retract over the PERSISTENT store — an active notion whose witnesses no longer ALL live in the
	 * pool is retracted. The uniform in-pool test gives the CASCADE for free (a shared witness leaving drops
	 * every notion citing it; a notion retracted for one bad witness never drags down notions sharing its
	 * still-valid witnesses). Pure + structural; identical logic to critique.js#reconcile, over the store.
	 * @returns retracted ids
	 */
	function reconcile( pool ) {
		const inPool = new Set((pool || []).map(( a ) => typeof a === 'string' ? a : a.id ));
		const retracted = [];
		for ( const e of entries.values() )
			if ( e.status === 'active' && e.witnesses.length && !e.witnesses.every(( w ) => inPool.has(w) ) ) { e.status = 'retracted'; retracted.push(e.id); }
		return retracted;
	}

	/** Render the canonical notions as a deterministic, sorted CITABLE-VOCABULARY block (the re-découpe injection). */
	function inject( o ) {
		o = o || {};
		const activeOnly = o.activeOnly !== false;
		const list = [...entries.values()].filter(( e ) => (activeOnly ? e.status === 'active' : true) && (!o.side || e.side === o.side) );
		if ( !list.length ) return '';
		return list.map(( e ) => '- ' + e.id + ': ' + e.text + (e.side ? ' [' + e.side + ']' : '') ).join('\n');
	}
	/** The set of citable notion ids — a re-ask that cites a key OUTSIDE this set is a phantom (caught by validation). */
	function citableKeys( o ) {
		o = o || {};
		const activeOnly = o.activeOnly !== false;
		return new Set([...entries.values()].filter(( e ) => (activeOnly ? e.status === 'active' : true)).map(( e ) => e.id ));
	}

	/** Retract a bad merge (a wrong alias) — the un-learn verb; bumps the version (the invalidation signal). */
	function retractAlias( id, alias ) {
		const r = retractRingAlias(registry, KEY, alias); registry = r.registry;
		const e = entries.get(id); if ( e ) e.aliases = e.aliases.filter(( a ) => normToken(a.text) !== normToken(alias) );
		return { retracted: r.retracted, member: r.member, version: registry.version };
	}
	/** Credit a verified reuse of an alias — support++, NEVER bumps the version (resolution semantics unchanged). */
	function credit( alias ) {
		const r = creditRingAlias(registry, KEY, alias); registry = r.registry;
		return { member: r.member, support: r.support, version: registry.version };
	}

	// P2 granularity ARBITER over the active notions — group them into grounded dimensions (co-citation of
	// witnesses) and return the lazy-2-régime frame verdict (coherent | mixed=the re-plan TOO-NARROW signal |
	// unstructured=escalate to Q2). Delegates to granularity.js; the glossary just supplies its active notions.
	const activeItems = ( o ) => [...entries.values()].filter(( e ) => e.status === 'active' && e.witnesses.length )
		.map(( e ) => ({ id: e.id, witnesses: e.witnesses, side: e.side }) );
	return {
		harvest, reconcile, inject, citableKeys, retractAlias, credit,
		cluster: ( o ) => clusterByGrounding(activeItems(o), o),
		arbitrate: ( o ) => arbitrate(activeItems(o), o),
		notions: ( o ) => [...entries.values()].filter(( e ) => !(o && o.activeOnly) || e.status === 'active' ),
		get: ( id ) => entries.get(id) || null,
		version: () => registry.version,
		snapshot: () => ({ version: registry.version, notions: [...entries.values()].map(( e ) => ({ ...e, aliases: e.aliases.slice() })),
			rings: JSON.parse(JSON.stringify(registry.keys[KEY].synonyms || {})), provenance: Object.assign({}, registry.ringProvenance) }),
		fingerprint: () => digest({ v: registry.version, n: [...entries.values()].map(( e ) => e.id + ':' + e.status + ':' + e.witnesses.join(',') ).sort() })
	};
}

module.exports = { createGlossary, overlapOf };
