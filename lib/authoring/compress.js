/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * compress — the DIGRAM-grain AFFINITY MINER (the long-filed compress.js, finally built on evidence).
 *
 * WHY NOW. RUN 8 (e2e-fidelity) bounded whole-structure composition by whole-structure decode invariance:
 * on external/cross-domain prose a task class holds 4-5 decompose shapes (mode 38%) → no whole composite ever
 * forms → `synthesizeByBlend` has nothing to blend. The 2026-07-03 kill-gate (experiments/2026-07-03-digram-
 * invariance) measured the SAME captured shapes at DIGRAM grain — recurring pairs of ADJACENT typed steps —
 * and returned GO: top-digram support 1.0/0.875, coverage 0.98/0.92, net MDL gain 20/12% exactly where the
 * whole-structure read 0. This module mines that grain: the owner's affinity mechanism « AB qualifié · BC
 * adjacent ont une affinité → composer AC qualifié qui devient un slot » — a SEQUITUR/SUBDUE binary production
 * (nonterminal invention), affinity = MDL gain on OBSERVED digrams (linear in the trace, never |lattice|²).
 *
 * WHAT IT MINES (input = decompose shape-trees: `[{k:<stepKind>, c:[…children]}]` per task — the typed-loop
 * trace grain, also the RUN-8 diag-dump grain):
 *   - `mineDigrams`        recurring adjacent sibling pairs (support = tasks, multiplicity-weighted);
 *   - `subExpansionIndex`  the DISPATCHABLE form: (parentKind→kind | kind) → unique observed expansion body,
 *                          under the online K1 rule (conflicting bodies → undetermined, never first-wins) —
 *                          the ctx grain splits classes the kind grain conflates (the granularity lever at
 *                          the LEVEL grain instead of the root);
 *   - `foldSubpaths`       admission under the mdl.js ΔL objective (its step-alphabet face: savedBits −
 *                          encodeBits − taxBits, same three terms — mdl.js states the concept-schema face);
 *   - `toExpandPatch`      mint a typed-loop-PARITY expand patch from a mined body (the mount/guard
 *                          conventions ride the template: stamped EvalComplexity + Atomic|NeedsSplit, the
 *                          plan-state mid nodes, the `_s`/`_m` id scheme) — a mined subpath mounts EXACTLY
 *                          like a live expand, so the #33 re-fire guard discipline is preserved;
 *   - `mineForest`         the method-FOREST skeleton: per class, the observed variant multiset + the digrams
 *                          shared across ≥2 variants (a concept-method is a LIBRARY of alternative subpaths
 *                          for one abstract problem — the concept-method design (the lattice preprint); the variants are its body,
 *                          the shared digrams its common sub-methods).
 *
 * Fail-closed: a node with no typed `k` mines as the literal kind `∅` — it supports nothing typed and a body
 * containing it stays mintable-but-quarantined (the caller sees the ∅). Kinds are NEVER invented.
 *
 * NON-GOAL (measured, not assumed): whether dispatching mined sub-expansions nets out ELIDED calls against
 * the on-demand `synthesizeByBlend`+`indexMethod` baseline is the replay experiment's question
 * (experiments/2026-07-03-digram-miner-elision), per the cont.⁶/⁷ baseline discipline — MDL gain is a
 * compression floor, not an elision.
 */

const NIL = '∅'; // fail-closed kind for a malformed (k-less) node
const TOP = '⊤'; // the synthetic parent of a task root

const kindOf = ( node ) => (node && typeof node.k === 'string') ? node.k : NIL;
const childrenOf = ( node ) => (node && Array.isArray(node.c)) ? node.c : [];
const isAtomic = ( node ) => childrenOf(node).length === 0;
const digramKey = ( a, b ) => a + '→' + b;

/** The canonical BODY of one expansion: the child step-list with atomicity flags — the exact per-level memo
 *  canon of the fidelity harness (a dispatch must predict the kinds AND the split-vs-atomic verdicts). */
const bodyOf = ( children ) => children.map(( ch ) => ({ k: kindOf(ch), a: isAtomic(ch) }));
const bodyKey = ( body ) => JSON.stringify(body);

/** Every horizontal sibling sequence of a tree (as kind arrays): the top-level array + each node's children. */
function siblingSequences( topArr ) {
	const seqs = [];
	const stack = [topArr];
	while ( stack.length ) {
		const arr = stack.pop();
		seqs.push(arr.map(kindOf));
		for ( const node of arr ) { const kids = childrenOf(node); if ( kids.length ) stack.push(kids); }
	}
	return seqs;
}

/**
 * Mine recurring adjacent digrams over a shape corpus.
 * @param entries [{ cls, mult=1, tree }] — tree = the task root's expansion, `[{k,c}]`
 * @returns { digrams:[{a,b,key,support,occurrences}], tasks, pairOccurrences } — support = # tasks
 *          (multiplicity-weighted) containing the digram ≥ once; occurrences overlap (raw adjacency count).
 */
function mineDigrams( entries, opts ) {
	opts = opts || {};
	const support = new Map(), occurrences = new Map();
	let tasks = 0, pairOccurrences = 0;
	for ( const e of entries ) {
		const mult = e.mult == null ? 1 : e.mult;
		tasks += mult;
		const present = new Set();
		for ( const seq of siblingSequences(e.tree) )
			for ( let i = 0; i + 1 < seq.length; i++ ) {
				const k = digramKey(seq[i], seq[i + 1]);
				present.add(k);
				occurrences.set(k, (occurrences.get(k) || 0) + mult);
				pairOccurrences += mult;
			}
		for ( const k of present ) support.set(k, (support.get(k) || 0) + mult);
	}
	const digrams = [...support.entries()]
		.map(( [key, sup] ) => { const i = key.indexOf('→'); return { a: key.slice(0, i), b: key.slice(i + 1), key, support: sup, occurrences: occurrences.get(key) }; })
		.sort(( x, y ) => (y.support - x.support) || (x.key < y.key ? -1 : 1));
	return { digrams, tasks, pairOccurrences };
}

/**
 * The DISPATCHABLE index of observed sub-expansions, at two key grains:
 *   kind grain  — key = the expanding node's stepKind (≈ the fidelity harness's per-level memo);
 *   ctx grain   — key = parentKind→stepKind (splits classes the kind grain conflates).
 * Online K1 rule at dispatch: a key maps to a body ONLY if exactly one distinct body was ever observed for it
 * (conflict → undetermined, refuse — never first-wins/majority) AND its support ≥ minSupport.
 */
function subExpansionIndex( opts ) {
	opts = opts || {};
	const minSupport = opts.minSupport == null ? 2 : opts.minSupport;
	const byKind = new Map(), byCtx = new Map(); // key → Map(bodyKey → {body, support})
	const bump = ( map, key, body, mult ) => {
		let bodies = map.get(key);
		if ( !bodies ) map.set(key, bodies = new Map());
		const bk = bodyKey(body);
		const cur = bodies.get(bk);
		if ( cur ) cur.support += mult; else bodies.set(bk, { body, support: mult });
	};
	const walk = ( arr, parentKind, mult ) => {
		for ( const node of arr ) {
			const kids = childrenOf(node);
			if ( !kids.length ) continue;
			const body = bodyOf(kids), k = kindOf(node);
			bump(byKind, k, body, mult);
			bump(byCtx, digramKey(parentKind, k), body, mult);
			walk(kids, k, mult);
		}
	};
	return {
		/** Observe ONE production (a single paid expand: parentKind→kind emitted `body`) — the STREAMING grain:
		 *  a live/replay loop must accrue exactly what was derived, never a whole tree at once (future leak). */
		observeProduction( parentKind, kind, body, mult ) {
			mult = mult == null ? 1 : mult;
			bump(byKind, kind, body, mult);
			bump(byCtx, digramKey(parentKind == null ? TOP : parentKind, kind), body, mult);
		},
		/** Observe one task's shape. site = { rootKind, mult=1 } — the root's own expansion is indexed too
		 *  (kind = rootKind, ctx = ⊤→rootKind). */
		observe( tree, site ) {
			site = site || {};
			const mult = site.mult == null ? 1 : site.mult;
			const rootKind = site.rootKind || TOP;
			bump(byKind, rootKind, bodyOf(tree), mult);
			bump(byCtx, digramKey(TOP, rootKind), bodyOf(tree), mult);
			walk(tree, rootKind, mult);
		},
		/** parentKind null → kind grain; else ctx grain. → {body, support} | null (undetermined/unseen/under-support). */
		dispatch( parentKind, kind ) {
			const bodies = parentKind == null ? byKind.get(kind) : byCtx.get(digramKey(parentKind, kind));
			if ( !bodies || bodies.size !== 1 ) return null;               // unseen, or K1-undetermined (≥2 bodies)
			const only = bodies.values().next().value;
			return only.support >= minSupport ? { body: only.body, support: only.support } : null;
		},
		/** The RUN-8 false-hit discipline: a dispatched body contradicted by ground truth INVALIDATES exactly
		 *  the used key at the used grain (parentKind null = kind grain) — it goes undetermined, never re-fires. */
		invalidate( parentKind, kind ) {
			const map = parentKind == null ? byKind : byCtx;
			const key = parentKind == null ? kind : digramKey(parentKind, kind);
			const bodies = map.get(key);
			if ( bodies ) bodies.set('⊥', { body: null, support: 0 });     // a 2nd distinct entry ⇒ K1-undetermined
		},
		stats() {
			const summarize = ( map ) => { let determined = 0, undetermined = 0;
				for ( const bodies of map.values() ) (bodies.size === 1 ? determined++ : undetermined++);
				return { keys: map.size, determined, undetermined }; };
			return { kind: summarize(byKind), ctx: summarize(byCtx), minSupport };
		},
	};
}

/**
 * Fold admission under the mdl.js ΔL objective, step-alphabet face (same three terms as mdl.js — which states
 * the concept-schema face; one objective, two alphabets):
 *   savedBits  = folds·log2(N)          each non-overlapping fold names 1 nonterminal instead of 2 symbols
 *   encodeBits = 2·log2(N)              the nonterminal's body, paid once (the dictionary)
 *   taxBits    = R·(log2(N+1)−log2(N))  the match-cost tax: +1 alphabet symbol raises EVERY parse
 *   ΔL = encodeBits + taxBits − savedBits ; admit iff ΔL < 0 ∧ support ≥ minSupport
 * Folds are counted greedily (most-frequent-by-occurrence first, non-overlapping within a sibling sequence) —
 * the SEQUITUR single pass; dlAfter = dlBefore + Σ_admitted ΔL (a ranking proxy, documented as such).
 */
function foldSubpaths( entries, opts ) {
	opts = opts || {};
	const minSupport = opts.minSupport == null ? 2 : opts.minSupport;
	const { digrams } = mineDigrams(entries);

	// alphabet + corpus size (weighted symbol count)
	const alphabet = new Set();
	let R = 0;
	const work = []; // flat {kinds, mult, consumed} sequence instances for the greedy fold
	for ( const e of entries ) {
		const mult = e.mult == null ? 1 : e.mult;
		for ( const seq of siblingSequences(e.tree) ) {
			for ( const k of seq ) { alphabet.add(k); R += mult; }
			if ( seq.length >= 2 ) work.push({ kinds: seq, mult, consumed: new Array(seq.length).fill(false) });
		}
	}
	const N = Math.max(alphabet.size, 2);
	const log2 = ( x ) => Math.log(x) / Math.LN2;
	const dlBefore = R * log2(N);
	const taxBits = R * (log2(N + 1) - log2(N));

	const ranked = digrams.slice().sort(( x, y ) => (y.occurrences - x.occurrences) || (x.key < y.key ? -1 : 1));
	const subpaths = [];
	let dlAfter = dlBefore;
	for ( const d of ranked ) {
		let folds = 0;
		for ( const w of work ) {
			const K = w.kinds, C = w.consumed;
			for ( let i = 0; i + 1 < K.length; i++ )
				if ( !C[i] && !C[i + 1] && K[i] === d.a && K[i + 1] === d.b ) { C[i] = C[i + 1] = true; folds += w.mult; i++; }
		}
		const saved = folds * log2(N), encode = 2 * log2(N);
		const delta = encode + taxBits - saved;
		const admitted = delta < 0 && d.support >= minSupport;
		if ( admitted ) dlAfter += delta;
		subpaths.push(Object.assign({}, d, { folds, dl: { saved, encode, tax: taxBits, delta }, admitted }));
	}
	return { subpaths, dlBefore, dlAfter, alphabet: [...alphabet].sort() };
}

/**
 * Mint the typed-loop-PARITY expand patch for a mined body — byte-for-byte what `makeTypedDecomposeProviders`'
 * expand emits for the same steps at the same site (minus prose, which a mined subpath never carries): the
 * `$_id:'_parent'` header with `Expand:true + expandedInto`, per-step Segment children carrying the STAMPED
 * `EvalComplexity` + `Atomic|NeedsSplit` guards (#33 — a mounted subpath must never re-fire the providers),
 * the typed `state:'plan-<kind>'` mid nodes, and the `_s`/`_m` id scheme `mountTemplate` grounds.
 * @param steps [{kind, atomic=true}]   @param site {baseId, origin, target, depth=1}
 */
function toExpandPatch( steps, site ) {
	const baseId = site.baseId, depth = site.depth == null ? 1 : site.depth;
	const childIds = steps.map(( _, i ) => baseId + '_s' + i);
	const tpl = [{ $_id: '_parent', Expand: true, expandedInto: childIds }];
	let prev = site.origin;
	steps.forEach(( st, i ) => {
		const last = i === steps.length - 1;
		const tnode = last ? site.target : baseId + '_m' + i;
		const child = { _id: childIds[i], Segment: true, originNode: prev, targetNode: tnode,
			depth, parentSeg: baseId, stepIndex: i, EvalComplexity: true };
		if ( st.atomic !== false ) child.Atomic = true; else child.NeedsSplit = true;
		child.stepKind = st.kind;
		if ( !last ) tpl.push({ _id: tnode, Node: true, state: 'plan-' + st.kind });
		tpl.push(child);
		prev = tnode;
	});
	return tpl;
}

/**
 * The method-FOREST skeleton per class: the observed variant multiset (the alternative subpaths that ARE the
 * concept-method's body — the concept-method design (the lattice preprint)) + the digrams shared across ≥2 distinct variants (the
 * common sub-methods the miner would fold).
 * @returns { classes: { <cls>: { variants:[{tree,mult,canon}], shared:[digramKey] } } }
 */
function mineForest( entries ) {
	const classes = {};
	for ( const e of entries ) {
		const mult = e.mult == null ? 1 : e.mult;
		const cls = classes[e.cls] = classes[e.cls] || { variants: [], _byCanon: new Map() };
		const canon = JSON.stringify(e.tree);
		const cur = cls._byCanon.get(canon);
		if ( cur ) cur.mult += mult;
		else { const v = { tree: e.tree, mult, canon }; cls._byCanon.set(canon, v); cls.variants.push(v); }
	}
	for ( const cls of Object.values(classes) ) {
		const inVariants = new Map(); // digramKey → # distinct variants containing it
		for ( const v of cls.variants ) {
			const present = new Set();
			for ( const seq of siblingSequences(v.tree) )
				for ( let i = 0; i + 1 < seq.length; i++ ) present.add(digramKey(seq[i], seq[i + 1]));
			for ( const k of present ) inVariants.set(k, (inVariants.get(k) || 0) + 1);
		}
		cls.shared = [...inVariants.entries()].filter(( [, n] ) => n >= 2).map(( [k] ) => k).sort();
		delete cls._byCanon;
	}
	return { classes };
}

module.exports = { mineDigrams, subExpansionIndex, foldSubpaths, toExpandPatch, mineForest,
	NIL, TOP, bodyOf, siblingSequences };
