/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * compose-hotspot — the COMPOSITIONAL-recurrence go/no-go DETECTOR (roadmap STAGE-0 gate; the depth-≥2
 * analog of `hotspot.js`). It answers the one shared front kill-gate of the composed roadmap: *does the
 * workload COMPOSE?* — before building the (substantial, still-absent) `compress.js` operator.
 *
 * Why a pre-test (the honest off-ramp, mirroring hotspot): the flat LEAF/whole-task memo ALREADY elides a
 * recurrent typed slice at 0 calls. So minting a persisted depth-≥2 "method-of-methods" buys NOTHING unless a
 * SUB-composite recurs across DISTINCT whole-tasks — i.e. the shared sub-work that whole-task crystallization
 * cannot cover (X=A∘B∘C and Y=A∘B∘D both contain A∘B, but X≠Y so neither's crystallized method serves the other).
 * That is the precise "compress pays" condition; the detector separates it from "already-flat-covered".
 *
 * Signal = RE-PAIR (Larsson & Moffat 2000): repeatedly replace the most-frequent adjacent method-pair with a new
 * symbol → recovers the composition TREE/hierarchy and the MDL saving cheaply. A recurring composite tree
 * linearizes to a recurring subsequence, so a contiguous-pair tally has NO false negatives for the GATE (spurious
 * pairs are filtered by the cross-task + utility gates downstream — the operator-grade SEQUITUR/Stitch/DreamCoder
 * corpus-MDL is `compress.js`'s job, not the gate's).
 *
 * The four-way verdict per candidate composite S (analog of hotspot's four):
 *   too-rare            — count(S) < minCount                             (not enough volume)
 *   already-flat-covered— frequent BUT distinctTasks(S) < minDistinctTasks (only inside ONE repeated whole-task →
 *                         whole-task memo already serves it; compression is redundant — THE off-ramp)
 *   unstable            — frequent ∧ cross-task BUT the composite's result is NOT a function of its typed input
 *                         (K1-insufficient at the composite level; only checked when result keys are provided)
 *   compose-candidate   — FREQUENT ∧ CROSS-TASK (≥ minDistinctTasks) ∧ COMPRESSIBLE (savedCalls > 0)
 * Utility is in CALLS (Minton): savedCalls(S) ≈ distinctTasks(S) − 1 forge-calls elided over the whole-task
 * baseline, minus library bloat. `anyComposeCandidate(rows)` is the go/no-go boolean for `compress.js`.
 *
 * HONEST SCOPE: on a DESIGNED workload the planted composite is found by construction — a positive result
 * validates the INSTRUMENT + QUANTIFIES the saving, it does NOT establish that real domains compose. Run the
 * detector on a REAL dispatch trace to answer that (the instrument is the deliverable; cf. hotspot's "no
 * candidate on today's workload"). Pure + synchronous.
 *
 * ─────────────────────────── PROVENANCE layer (confront-reshaped 2026-07-01, Laurie Q2/Q4 + babble/Stitch SOTA) ──
 * The flat tally above keys on CONTIGUOUS method-id adjacency in a per-task EMISSION-order sequence. But the engine's
 * stabilize loop is a fixpoint over `_unstable`, so the emission order of data-flow-INDEPENDENT firings is NOT
 * deterministic: on a multi-subproblem task a real composite A→B→C surfaces INTERLEAVED as [A,D,B,E,C] and the
 * contiguous tally MISSES it (a false NEGATIVE — the EXPENSIVE gate error: it would wrongly FILE compress.js when it
 * would pay). The fix: tally producer→consumer PROVENANCE edges (interleave-robust) and extract the DATA-FLOW CHAINS,
 * then RE-PAIR those clean chains — so a composite is recognised by its data-flow, regardless of interleaving.
 * `provenanceEdges` is the tally, `provenanceChains` the extraction, `trackFromFirings` feeds `composeHotspots`.
 *
 * The poly / iso-free GUARDS (Laurie — dropping any one re-summons a named NP-hardness):
 *   G-a  candidates are PATHS: an internal chain node has in-degree = out-degree = 1 WITHIN the task DAG. A fork/join
 *        (fan-in/out > 1) is a chain BOUNDARY. Fork-join composites are OUT of scope for the poly gate (SUBDUE-beam
 *        territory, not poly / not exact) — a DOCUMENTED CEILING, not a silent drop. [drop → frequent-subgraph mining,
 *        subgraph-iso NP-complete: Yan-Han gSpan ICDM'02, Cook'71]
 *   G-b  cross-task grouping is the RE-PAIR canonical-STRING recurrence over the path's concept sequence (a path's
 *        topological order is unique) — never a pairwise graph-iso test. [drop → graph canonicalization / GI]
 *   G-c  edges come from PROVENANCE (a producer WROTE a key the consumer READ, SAME target, earlier rev) via a
 *        (target,key) last-writer hash-join — never value-matching (a shared value across many objects = a needless
 *        m×n blowup + semantically spurious edges).
 *   Q3   SAME-TARGET only (single relativization base). Cross-linked-target provenance (a producer on segment X
 *        feeding a child segment Y) is MULTI-BASE (needs a third `⟦@internal⟧` hole kind) and belongs to compress.js.
 * The gate stops at DETECTION (G-d): "does ANY sound cross-task PATH-composite recur?". The antiUnify CERTIFICATION
 * (`mine.js#mineMethods` lifted to the composite) + the MDL non-overlap SELECTION (MWIS/B&B) are compress.js's front
 * half (babble-generator + Stitch-selector, minus the e-graph), NOT the gate — a false GO is cheap (compress.js
 * refuses the unstable composite via its own `signatureDetermined`/leak guards), a false NO-GO is expensive.
 */

var SEP = '\u001f';

/**
 * A tally you feed one entry per task: the ordered SEQUENCE of method ids it dispatched, its whole-task
 * signature (so cross-task recurrence is distinguishable from a repeated whole-task), and optionally a
 * per-occurrence result key (for the composite-level K1-stability gate).
 */
function trackCompositions() {
	var tasks = [];   // [{ taskSig, seq:[methodId...], resultBySpan?:{ "i:j": resultKey } }]
	return {
		tasks: tasks,
		/** @param e { taskSig, seq:[id...], resultKeyOf?(i,j)->key }  — resultKeyOf spans the composite seq[i..j] */
		observe: function ( e ) {
			tasks.push({ taskSig: e.taskSig != null ? String(e.taskSig) : (e.seq || []).join('>'),
				seq: (e.seq || []).map(String), resultKeyOf: e.resultKeyOf || null });
		},
		reset: function () { tasks.length = 0; },
	};
}

// count adjacent pairs across the corpus; return the most frequent (count ≥ 2) with its distinct-task set.
function bestPair( corpus ) {
	var count = new Map(), tasksOf = new Map();
	for ( var t = 0; t < corpus.length; t++ ) {
		var seq = corpus[t].seq, sig = corpus[t].taskSig;
		for ( var i = 0; i < seq.length - 1; i++ ) {
			var p = seq[i] + SEP + seq[i + 1];
			count.set(p, (count.get(p) || 0) + 1);
			var s = tasksOf.get(p); if ( !s ) { s = new Set(); tasksOf.set(p, s); } s.add(sig);
		}
	}
	var best = null, bc = 1;
	count.forEach(function ( c, p ) { if ( c > bc ) { bc = c; best = p; } });
	return best ? { pair: best, count: bc, tasks: tasksOf.get(best) } : null;
}

// replace every non-overlapping occurrence of (a,b) with `sym` in each sequence (left-to-right, greedy).
function replacePair( corpus, a, b, sym ) {
	for ( var t = 0; t < corpus.length; t++ ) {
		var seq = corpus[t].seq, out = [];
		for ( var i = 0; i < seq.length; i++ ) {
			if ( i < seq.length - 1 && seq[i] === a && seq[i + 1] === b ) { out.push(sym); i++; }
			else out.push(seq[i]);
		}
		corpus[t].seq = out;
	}
}

// expand a composite symbol back to its primitive-method leaf sequence (the flattened tree).
function expand( sym, rules ) {
	var r = rules[sym];
	if ( !r ) return [sym];
	return expand(r.expansion[0], rules).concat(expand(r.expansion[1], rules));
}

/**
 * Detect compositional recurrence. Pure (no engine, no model).
 * @param tracker  a trackCompositions() collector (or { tasks })
 * @param opts.minCount          volume floor on a composite's occurrences (default 3)
 * @param opts.minDistinctTasks  cross-task floor: # DISTINCT whole-tasks a composite must span (default 2)
 * @returns [{ composite:[leafId...], size, count, distinctTasks, savedCalls, mdlSymbols, stable, verdict, reason }]
 *          sorted compose-candidates first, then by savedCalls. verdict ∈
 *          { 'compose-candidate', 'unstable', 'already-flat-covered', 'too-rare' }.
 */
function composeHotspots( tracker, opts ) {
	opts = opts || {};
	var minCount = opts.minCount != null ? opts.minCount : 3;
	var minDist  = opts.minDistinctTasks != null ? opts.minDistinctTasks : 2;
	var tasks = (tracker && tracker.tasks) || tracker || [];

	// working copy (RE-PAIR mutates the sequences) + a parallel copy for the stability span lookup.
	var corpus = tasks.map(function ( t ) { return { taskSig: t.taskSig, seq: t.seq.slice(), resultKeyOf: t.resultKeyOf }; });
	var rules = {};            // sym -> { expansion:[a,b], count, tasks:Set }
	var nextSym = 0;

	// RE-PAIR: greedily fold the most-frequent adjacent pair into a fresh symbol, recording the rule.
	while ( true ) {
		var bp = bestPair(corpus);
		if ( !bp || bp.count < 2 ) break;
		var parts = bp.pair.split(SEP);
		var sym = '§' + (nextSym++);
		rules[sym] = { expansion: [parts[0], parts[1]], count: bp.count, tasks: bp.tasks };
		replacePair(corpus, parts[0], parts[1], sym);
	}

	// stability (optional): a composite is K1-UNSTABLE if, for its occurrences sharing an input, results diverge.
	// v0 proxy via caller-provided resultKeyOf over the composite's leaf span: two occurrences of the SAME leaf
	// sequence whose result keys differ ⇒ the composite result is not a function of the (structural) input.
	function stabilityOf( leafSeq ) {
		var seen = null, saw = false;
		for ( var t = 0; t < tasks.length; t++ ) {
			var seq = tasks[t].seq, rk = tasks[t].resultKeyOf; if ( !rk ) continue;
			for ( var i = 0; i + leafSeq.length <= seq.length; i++ ) {
				var match = true;
				for ( var j = 0; j < leafSeq.length; j++ ) if ( seq[i + j] !== leafSeq[j] ) { match = false; break; }
				if ( !match ) continue;
				var key = rk(i, i + leafSeq.length - 1); if ( key == null ) continue;
				saw = true;
				if ( seen == null ) seen = key; else if ( seen !== key ) return false;   // diverged → unstable
			}
		}
		return saw ? true : null;   // null = unconfirmed (no result data)
	}

	var rows = Object.keys(rules).map(function ( sym ) {
		var r = rules[sym];
		var leaf = expand(sym, rules);
		var distinctTasks = r.tasks.size;
		var savedCalls = Math.max(0, distinctTasks - 1);           // forge-calls elided over the whole-task baseline
		var mdlSymbols = (r.count - 1) * (leaf.length - 1) - 1;    // RE-PAIR description-length saving (symbols)
		var stable = stabilityOf(leaf);
		var verdict, reason;
		if ( r.count < minCount ) {
			verdict = 'too-rare'; reason = 'count ' + r.count + ' < minCount ' + minCount;
		} else if ( distinctTasks < minDist ) {
			verdict = 'already-flat-covered';
			reason = 'distinctTasks ' + distinctTasks + ' < ' + minDist + ' — only inside one repeated whole-task; whole-task memo already serves it';
		} else if ( stable === false ) {
			verdict = 'unstable'; reason = 'the composite result is not a function of its typed input (K1-insufficient at the composite level)';
		} else {
			verdict = 'compose-candidate';
			reason = 'frequent ∧ cross-task (' + distinctTasks + ' distinct tasks) ∧ compressible (saves ~' + savedCalls + ' forge-calls)'
				+ (stable == null ? '; stability UNCONFIRMED (no result data)' : '');
		}
		return { composite: leaf, size: leaf.length, count: r.count, distinctTasks: distinctTasks,
			savedCalls: savedCalls, mdlSymbols: mdlSymbols, stable: stable, verdict: verdict, reason: reason };
	});

	var rank = { 'compose-candidate': 0, 'unstable': 1, 'already-flat-covered': 2, 'too-rare': 3 };
	rows.sort(function ( a, b ) { return (rank[a.verdict] - rank[b.verdict]) || (b.savedCalls - a.savedCalls) || (b.count - a.count); });
	return rows;
}

// ─────────────────────────── PROVENANCE tally + DATA-FLOW chain extraction (the interleave-robust signal) ──────────
//
// A FIRING record (one per dispatched method / concept apply):
//   { task, rev, concept, target, reads:[key…], writes:[key…] }
// `task` = the whole-task signature (so cross-DISTINCT-task recurrence is distinguishable — the off-ramp); `rev` = the
// engine's monotonic apply order (the total order, from the onConceptApply record); `concept` = the method-id SYMBOL
// (two firings of one crystallized method share it — the gate keys on the method, not its content, per G-d liberal
// gate); `reads`/`writes` = the require/premise keys consumed and the produced-fact keys (self-flag + template keys).

/**
 * The PROVENANCE tally (G-c): same-target producer→consumer edges via an (target,key) LAST-WRITER hash-join. A
 * consumer C's read of key K binds to the most-recent EARLIER firing that wrote K on the SAME target — provenance,
 * never value-matching. Pure, O(Σ reads). @returns [{ from, to, via, fromConcept, toConcept, task, target }] (from/to
 * are the producer/consumer `rev`s).
 */
function provenanceEdges( firings ) {
	var byTask = new Map();
	for ( var i = 0; i < (firings || []).length; i++ ) {
		var f = firings[i]; if ( !f || f.concept == null ) continue;
		if ( !byTask.has(f.task) ) byTask.set(f.task, []);
		byTask.get(f.task).push(f);
	}
	var edges = [];
	byTask.forEach(function ( fs, task ) {
		fs = fs.slice().sort(function ( a, b ) { return (a.rev || 0) - (b.rev || 0); });
		var lastWriter = new Map();                                  // "target SEP key" -> the most-recent writer firing
		for ( var j = 0; j < fs.length; j++ ) {
			var f = fs[j];
			for ( var r = 0; r < (f.reads || []).length; r++ ) {    // resolve reads against PRIOR writers (before recording this firing's writes)
				var k = f.reads[r], w = lastWriter.get(f.target + SEP + k);
				if ( w && w !== f ) edges.push({ from: w.rev, to: f.rev, via: k, fromConcept: w.concept, toConcept: f.concept, task: task, target: f.target });
			}
			for ( var wI = 0; wI < (f.writes || []).length; wI++ ) lastWriter.set(f.target + SEP + f.writes[wI], f);
		}
	});
	return edges;
}

/**
 * Extract per-task maximal DATA-FLOW CHAINS (G-a paths) from the provenance edges. An edge from→to is a CHAIN EDGE iff
 * outDeg(from)==1 ∧ inDeg(to)==1 in the task DAG (both endpoints linearly connected); chain edges form vertex-disjoint
 * simple paths (rev-monotone ⇒ acyclic). A fork/join breaks the chain (the fan node is a boundary — G-a ceiling). Each
 * maximal chain of ≥2 firings is a candidate composite. @returns [{ task, seq:[concept…], firings:[rev…], vias:[[key…]…] }].
 */
function provenanceChains( firings, opts ) {
	opts = opts || {};
	var edges = provenanceEdges(firings);
	var conceptByRev = new Map(), taskEdges = new Map();
	for ( var i = 0; i < (firings || []).length; i++ ) { var f = firings[i]; if ( f && f.concept != null ) conceptByRev.set(f.task + SEP + f.rev, f.concept); }
	for ( var e = 0; e < edges.length; e++ ) { var ed = edges[e]; if ( !taskEdges.has(ed.task) ) taskEdges.set(ed.task, []); taskEdges.get(ed.task).push(ed); }

	var chains = [];
	taskEdges.forEach(function ( es, task ) {
		// collapse parallel multi-key edges between the SAME (from,to) into one (a diamond via two keys is still ONE edge).
		var byPair = new Map();
		for ( var i = 0; i < es.length; i++ ) { var ed = es[i], pk = ed.from + '>' + ed.to;
			if ( !byPair.has(pk) ) byPair.set(pk, { from: ed.from, to: ed.to, vias: [] }); byPair.get(pk).vias.push(ed.via); }
		var uedges = Array.from(byPair.values());
		var outDeg = new Map(), inDeg = new Map();
		uedges.forEach(function ( ed ) { outDeg.set(ed.from, (outDeg.get(ed.from) || 0) + 1); inDeg.set(ed.to, (inDeg.get(ed.to) || 0) + 1); });
		var chainSucc = new Map(), isChainTo = new Set();
		uedges.forEach(function ( ed ) { if ( outDeg.get(ed.from) === 1 && inDeg.get(ed.to) === 1 ) { chainSucc.set(ed.from, ed); isChainTo.add(ed.to); } });
		chainSucc.forEach(function ( _e, from ) {
			if ( isChainTo.has(from) ) return;                       // not a start (mid-chain node)
			var revs = [from], vias = [], cur = from;
			while ( chainSucc.has(cur) ) { var ce = chainSucc.get(cur); revs.push(ce.to); vias.push(ce.vias); cur = ce.to; }
			if ( revs.length < 2 ) return;
			chains.push({ task: task, seq: revs.map(function ( rv ) { return conceptByRev.get(task + SEP + rv); }), firings: revs, vias: vias });
		});
	});
	return chains;
}

/**
 * Feed an enriched FIRING trace through the provenance layer into a `trackCompositions()` collector, so `composeHotspots`
 * runs the four-way verdict over the INTERLEAVE-ROBUST data-flow chains (not the raw emission order). This is the honest
 * structural go/no-go. @param opts.stability  if a firing carries an `outKey` (a canonical digest of the composite's
 * observed output), thread a `resultKeyOf` so the `unstable` verdict still fires (the cheap K1 PROXY — NOT the full
 * antiUnify certification, which is compress.js's job).
 */
function trackFromFirings( firings, opts ) {
	opts = opts || {};
	var t = trackCompositions();
	var chains = provenanceChains(firings, opts);
	var byRev = new Map();
	for ( var i = 0; i < (firings || []).length; i++ ) { var f = firings[i]; if ( f && f.concept != null ) byRev.set(f.task + SEP + f.rev, f); }
	for ( var c = 0; c < chains.length; c++ ) {
		var ch = chains[c], entry = { taskSig: ch.task, seq: ch.seq };
		if ( opts.stability ) entry.resultKeyOf = (function ( chain ) {
			return function ( _i, j ) { var f = byRev.get(chain.task + SEP + chain.firings[j]); return f && f.outKey != null ? String(f.outKey) : null; };
		})(ch);
		t.observe(entry);
	}
	return t;
}

// the go/no-go boolean: is there any compositional recurrence worth compressing?
function anyComposeCandidate( rows ) { return (rows || []).some(function ( r ) { return r.verdict === 'compose-candidate'; }); }

// total forge-calls a fully-built compress.js could elide (upper bound) across all candidates.
function potentialSavedCalls( rows ) {
	return (rows || []).reduce(function ( s, r ) { return s + (r.verdict === 'compose-candidate' ? r.savedCalls : 0); }, 0);
}

module.exports = {
	trackCompositions: trackCompositions,
	composeHotspots: composeHotspots,
	anyComposeCandidate: anyComposeCandidate,
	potentialSavedCalls: potentialSavedCalls,
	expand: expand,
	// the PROVENANCE layer (interleave-robust structural go/no-go)
	provenanceEdges: provenanceEdges,
	provenanceChains: provenanceChains,
	trackFromFirings: trackFromFirings,
};
