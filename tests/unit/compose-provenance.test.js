'use strict';
/**
 * compose-hotspot PROVENANCE layer (G-0, confront-reshaped) — the interleave-robust structural go/no-go. The flat
 * screen (compose-hotspot's contiguous RE-PAIR) tallies method-id adjacency in EMISSION order; but the engine's
 * stabilize loop emits data-flow-independent firings in a NON-deterministic order, so a real composite A→B→C
 * surfaces INTERLEAVED (e.g. [A,D,B,E,C]) and the contiguous tally MISSES it — a false NEGATIVE (the expensive gate
 * error). The provenance layer tallies producer→consumer PROVENANCE edges (same-target last-writer) and extracts the
 * data-flow CHAINS, so the composite is recognised regardless of interleaving. Each claim carries a discriminating
 * NEGATIVE control; the CENTRAL claim uses the FLAT screen on the same emission order as the negative control (it
 * proves the flat screen's false-negative that provenance fixes). Pure, ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../lib/authoring/learning/compose-hotspot');

const rowFor = ( rows, leaf ) => rows.find(( r ) => r.composite.join('>') === leaf.join('>'));
// a firing: { task, rev, concept, target, reads:[key], writes:[key] }
const fire = ( task, rev, concept, target, reads, writes ) => ({ task, rev, concept, target, reads: reads || [], writes: writes || [] });

test('provenanceEdges — same-target last-writer hash-join (G-c: provenance, not value-matching)', () => {
	// A writes "a" on T; B reads "a" writes "b" on T; C reads "b" on T. Two edges A→B (via a), B→C (via b).
	const firings = [
		fire('X', 0, 'A', 'T', [], ['a']),
		fire('X', 1, 'B', 'T', ['a'], ['b']),
		fire('X', 2, 'C', 'T', ['b'], []),
	];
	const edges = C.provenanceEdges(firings);
	const has = ( from, to, via ) => edges.some(( e ) => e.fromConcept === from && e.toConcept === to && e.via === via );
	assert.ok(has('A', 'B', 'a'), 'A→B via the key A wrote and B read');
	assert.ok(has('B', 'C', 'b'), 'B→C via the key B wrote and C read');
	assert.equal(edges.length, 2, 'exactly the two data-flow edges (no spurious edge)');
});

test('G-c NEG — a shared VALUE with no produce→consume key relation yields NO edge', () => {
	// A and B both mention value "v" but B does NOT read a key A wrote → no provenance edge (value-matching would
	// invent one; provenance must not). A writes "a"; B reads "z" (which nobody wrote) → no edge.
	const firings = [ fire('X', 0, 'A', 'T', [], ['a']), fire('X', 1, 'B', 'T', ['z'], []) ];
	assert.equal(C.provenanceEdges(firings).length, 0, 'no producer wrote key "z" → no edge (provenance, not value coincidence)');
});

test('G-c NEG — a producer on a DIFFERENT target does not feed the consumer (same-target only, Q3)', () => {
	const firings = [ fire('X', 0, 'A', 'T', [], ['a']), fire('X', 1, 'B', 'U', ['a'], []) ];  // B on a DIFFERENT target U
	assert.equal(C.provenanceEdges(firings).length, 0, 'cross-target provenance is out of scope (compress.js) → no edge');
});

test('CENTRAL — interleave robustness: an INTERLEAVED composite A→B→C is recovered as a chain (flat screen MISSES it)', () => {
	// One task X, emission order [A, D, B, E, C]: the A→B→C data-flow composite (on target T) is interleaved with an
	// unrelated D→E chain (on target U). rev = emission order (the non-deterministic stabilize order).
	const firings = [
		fire('X', 0, 'A', 'T', [], ['a']),
		fire('X', 1, 'D', 'U', [], ['d']),          // interleaved noise (different sub-problem)
		fire('X', 2, 'B', 'T', ['a'], ['b']),
		fire('X', 3, 'E', 'U', ['d'], []),          // interleaved noise
		fire('X', 4, 'C', 'T', ['b'], []),
	];
	const chains = C.provenanceChains(firings);
	const abc = chains.find(( ch ) => ch.seq.join('>') === 'A>B>C');
	assert.ok(abc, 'the data-flow composite A→B→C is recovered as ONE chain despite the interleaving');
	assert.deepEqual(abc.firings, [0, 2, 4], 'the chain spans the provenance-linked firings (revs 0,2,4), skipping the noise');
	const de = chains.find(( ch ) => ch.seq.join('>') === 'D>E' );
	assert.ok(de, 'the independent D→E chain is a separate chain');

	// NEGATIVE CONTROL — the FLAT screen on the raw EMISSION order [A,D,B,E,C] does NOT see A→B or B→C (contiguous
	// pairs are A-D, D-B, B-E, E-C). This is the false-negative provenance fixes.
	const t = C.trackCompositions(); t.observe({ taskSig: 'X', seq: ['A', 'D', 'B', 'E', 'C'] });
	const flatRows = C.composeHotspots(t, { minCount: 1, minDistinctTasks: 1 });
	assert.ok(!rowFor(flatRows, ['A', 'B']), 'FLAT screen (emission order) never forms the A∘B pair — the false negative');
	assert.ok(!rowFor(flatRows, ['B', 'C']), 'FLAT screen never forms the B∘C pair either');
});

test('compose-candidate — a cross-DISTINCT-task composite A→B recurs (via provenance, both tasks interleaved)', () => {
	// Task X: A→B→C interleaved with noise; Task Y: A→B→D2 interleaved with noise. Both share the A→B sub-composite
	// across DISTINCT whole-tasks → compress.js would pay (whole-task memo can't cover it).
	const mk = ( task, tail ) => [
		fire(task, 0, 'A', 'T', [], ['a']),
		fire(task, 1, 'N', 'U', [], ['n']),             // noise firing between A and B
		fire(task, 2, 'B', 'T', ['a'], ['b']),
		fire(task, 3, tail, 'T', ['b'], []),            // the divergent tail (C vs D2)
	];
	const firings = []
		.concat(mk('X', 'C')).concat(mk('X', 'C'))       // task X twice
		.concat(mk('Y', 'D2')).concat(mk('Y', 'D2'));    // task Y twice
	// disambiguate revs per task-occurrence: give each its own rev block (rev only needs to be monotone WITHIN a task
	// occurrence; here tasks repeat, so bump revs so provenance stays within each occurrence's block).
	firings.forEach(( f, i ) => { f.rev = i; });
	// re-tag task occurrences so distinctTasks counts the WHOLE-TASK sig (X, Y), not the occurrence.
	const chains = C.provenanceChains(firings);
	const ab = chains.filter(( ch ) => ch.seq.slice(0, 2).join('>') === 'A>B' );
	assert.ok(ab.length >= 2, 'A→B is a provenance sub-chain in both tasks');

	const t = C.trackFromFirings(firings);
	const rows = C.composeHotspots(t, { minCount: 2, minDistinctTasks: 2 });
	const abRow = rowFor(rows, ['A', 'B']);
	assert.ok(abRow, 'the A∘B composite is detected');
	assert.equal(abRow.verdict, 'compose-candidate', 'frequent ∧ cross-DISTINCT-task ∧ compressible → GO');
	assert.equal(abRow.distinctTasks, 2, 'across the two DISTINCT whole-tasks X and Y');
	assert.equal(C.anyComposeCandidate(rows), true, 'go: compress.js would pay');
});

test('OFF-RAMP — a composite recurring only WITHIN one whole-task is already-flat-covered (distinctTasks=1)', () => {
	// Task W has FIVE parallel A→B chains (same whole-task, repeated sub-structure). The whole-task memo already
	// serves every recurrence → no compress.js candidate (the honest off-ramp).
	const firings = [];
	for ( let i = 0; i < 5; i++ ) {
		const T = 'seg' + i;
		firings.push(fire('W', i * 2, 'A', T, [], ['a']));
		firings.push(fire('W', i * 2 + 1, 'B', T, ['a'], []));
	}
	const t = C.trackFromFirings(firings);
	const rows = C.composeHotspots(t, { minCount: 3, minDistinctTasks: 2 });
	const ab = rowFor(rows, ['A', 'B']);
	assert.ok(ab, 'A∘B is extracted (it recurs)…');
	assert.equal(ab.verdict, 'already-flat-covered', '…but only inside ONE whole-task → flat memo serves it');
	assert.equal(C.anyComposeCandidate(rows), false, 'no-go');
});

test('G-a CEILING — a FORK breaks the chain at the fan node (fork-join composite out of scope for the poly gate)', () => {
	// A→B, then B forks to C and D (B has out-degree 2). The chain A→B→C is NOT captured as one path (fork boundary);
	// A→B is a chain, C and D are separate. A DOCUMENTED ceiling (fork-join needs a SUBDUE beam, not the poly gate).
	const firings = [
		fire('X', 0, 'A', 'T', [], ['a']),
		fire('X', 1, 'B', 'T', ['a'], ['b']),
		fire('X', 2, 'C', 'T', ['b'], []),          // reads b
		fire('X', 3, 'D', 'T', ['b'], []),          // ALSO reads b → B out-degree 2 (fork)
	];
	const chains = C.provenanceChains(firings);
	// B has out-degree 2 → A→B is NOT a chain edge (outDeg(B)==1 required for B→C to be a chain edge; but here the
	// FORK is at B's out side: outDeg(B)=2 → neither B→C nor B→D is a chain edge; and A→B IS a chain edge iff
	// outDeg(A)=1 ∧ inDeg(B)=1 → true, so A→B is a length-2 chain, C/D isolated).
	const abc = chains.find(( ch ) => ch.seq.join('>').startsWith('A>B>C') );
	assert.ok(!abc, 'the fork composite A→B→C is NOT captured as a single path (G-a ceiling)');
	const ab = chains.find(( ch ) => ch.seq.join('>') === 'A>B' );
	assert.ok(ab, 'A→B (up to the fork boundary) is still a chain');
});

test('too-rare / no-recurrence — distinct non-recurring chains yield no candidate', () => {
	const firings = [
		fire('X', 0, 'A', 'T', [], ['a']), fire('X', 1, 'B', 'T', ['a'], []),
		fire('Y', 2, 'P', 'T', [], ['p']), fire('Y', 3, 'Q', 'T', ['p'], []),
	];
	const t = C.trackFromFirings(firings);
	const rows = C.composeHotspots(t, { minCount: 2, minDistinctTasks: 2 });
	assert.equal(C.anyComposeCandidate(rows), false, 'no cross-task recurrence → no-go');
});

test('unstable PROXY — a cross-task composite whose OUTPUT diverges is flagged unstable (cheap K1 proxy, not certification)', () => {
	// A→B recurs across X and Y, but B's outKey diverges every occurrence → the cheap stability proxy flags unstable.
	// (This is the resultKeyOf annotation, NOT the full antiUnify certification — that is compress.js's job.)
	let n = 0;
	const mk = ( task ) => {
		const id = n++;
		return [
			fire(task, id * 2, 'A', 'T' + id, [], ['a']),
			Object.assign(fire(task, id * 2 + 1, 'B', 'T' + id, ['a'], ['b']), { outKey: 'div-' + id }),  // diverges
		];
	};
	const firings = [].concat(mk('X'), mk('Y'), mk('X'), mk('Y'));
	const t = C.trackFromFirings(firings, { stability: true });
	const rows = C.composeHotspots(t, { minCount: 2, minDistinctTasks: 2 });
	const ab = rowFor(rows, ['A', 'B']);
	assert.ok(ab, 'A∘B detected (frequent, cross-task)…');
	assert.equal(ab.stable, false, '…but its output diverges across occurrences → the proxy flags it');
	assert.equal(ab.verdict, 'unstable', 'refused by the cheap proxy (compress.js would re-check with antiUnify)');
});
