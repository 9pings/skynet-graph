'use strict';
/**
 * Grammar graph (lib/authoring/core/grammar-graph.js) — the concept↔fact bipartite view that
 * powers the Studio GrammarGraph: per-concept produced/consumed facts WITH polarity, the
 * cross-corpus links, the silent writer-collisions, the external entry points, and the
 * forkPlan tiling overlay. Pure; tested on the real corpora + synthetic polarity/links.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { conceptFactGraph } = require('../../lib/authoring/core/grammar-graph');
const { buildConceptTree } = require('../../lib/authoring/core/concepts');

const corpus = (set) => buildConceptTree(path.join(__dirname, '../../concepts', set));
const factOf = (g, key) => g.facts.find((f) => f.key === key);
const conceptOf = (g, name) => g.concepts.find((c) => c.name === name);

// ---- real `common`: tiling overlay + entry points + provider kind ----
test('common: derives the tiling separators, the external entry points, and provider kind', () => {
	const g = conceptFactGraph({ common: corpus('common') });
	// the decompose pass identifies Distance & Stay as the separator interface on `common`
	assert.ok(g.tiling, 'tiling overlay present');
	assert.ok(g.tiling.separators.includes('Distance'), 'Distance is a separator');
	assert.ok(g.tiling.separators.includes('Stay'), 'Stay is a separator');
	// Node/Segment/Position are required but produced by NO concept -> external entry points
	assert.ok(g.entryPoints.includes('Node'), 'Node is an entry point (seed/engine input)');
	assert.ok(g.entryPoints.includes('Segment'), 'Segment is an entry point');
	// Distance is computed by the CommonGeo provider
	assert.equal(conceptOf(g, 'Distance').kind, 'provider', 'Distance casts via a provider');
	assert.equal(conceptOf(g, 'Distance').set, 'common', 'concept tagged with its set');
});

// ---- real `clinical`: the defeasance concept's flags + a read edge ----
test('clinical: Diagnosis carries its lifecycle flags and reads the lab verdict', () => {
	const g = conceptFactGraph({ clinical: corpus('clinical') });
	const dx = conceptOf(g, 'Diagnosis');
	assert.ok(dx, 'Diagnosis concept present');
	assert.equal(dx.flags.cleaner, true, 'Diagnosis declares a cleaner (Constat::record) — a retraction hook');
	// it gates on the lab verdict (ensure $labVerdict==...) -> a read edge on that fact
	const reads = g.edges.filter((e) => e.kind === 'reads' && e.concept === 'Diagnosis').map((e) => e.fact);
	assert.ok(reads.includes('labVerdict'), 'Diagnosis reads labVerdict');
});

// ---- synthetic: polarity of a negated dependency (defeasance edge) ----
test('extracts NEGATIVE polarity on a `!$fact` ensure dependency', () => {
	const tree = { childConcepts: {
		Producer: { _name: 'Producer', applyMutations: { flag: true } },
		Guard: { _name: 'Guard', require: 'Anchor', ensure: ['!$flag'] }
	} };
	const g = conceptFactGraph({ s: tree });
	// Producer produces `flag`; Guard reads it negatively
	assert.deepEqual(factOf(g, 'flag').producedBy, ['Producer']);
	const read = g.edges.find((e) => e.kind === 'reads' && e.concept === 'Guard' && e.fact === 'flag');
	assert.ok(read, 'Guard reads flag');
	assert.equal(read.polarity, '-', 'the !$flag dependency is negative (defeasance)');
	assert.equal(read.via, 'ensure');
	// the positive `require: Anchor` edge is + and is an entry point (nothing produces Anchor)
	const reqEdge = g.edges.find((e) => e.kind === 'reads' && e.concept === 'Guard' && e.fact === 'Anchor');
	assert.equal(reqEdge.polarity, '+');
	assert.equal(reqEdge.via, 'require');
	assert.ok(g.entryPoints.includes('Anchor'));
});

// ---- synthetic: a fact written in two different sets is a SILENT collision ----
test('flags a writer-collision when two sets produce the same fact', () => {
	const a = { childConcepts: { A: { _name: 'A', applyMutations: { leadTime: 1 } } } };
	const b = { childConcepts: { B: { _name: 'B', applyMutations: { leadTime: 2 } } } };
	const g = conceptFactGraph({ supply: a, clinical: b });
	const col = g.collisions.find((c) => c.fact === 'leadTime');
	assert.ok(col, 'leadTime collision detected');
	assert.deepEqual(col.sets.sort(), ['clinical', 'supply']);
});

// ---- synthetic: a fact produced in one set and consumed in another is a cross-corpus link ----
test('derives a cross-corpus link when set A produces a fact set B consumes', () => {
	const a = { childConcepts: { Writer: { _name: 'Writer', applyMutations: { shared: true } } } };
	const b = { childConcepts: { Reader: { _name: 'Reader', require: 'shared' } } };
	const g = conceptFactGraph({ A: a, B: b });
	const link = g.crossCorpus.find((l) => l.fact === 'shared');
	assert.ok(link, 'cross-corpus link on `shared`');
	assert.equal(link.fromSet, 'A');
	assert.equal(link.toSet, 'B');
	// `shared` is produced here, so it is NOT an entry point
	assert.ok(!g.entryPoints.includes('shared'));
});

// ---- non-vacuous control: a purely-positive grammar has no negative edges ----
test('control: a grammar with no negation yields no negative read edges', () => {
	const tree = { childConcepts: {
		P: { _name: 'P', applyMutations: { x: true } },
		Q: { _name: 'Q', ensure: ['$x==true'] }
	} };
	const g = conceptFactGraph({ s: tree });
	assert.equal(g.edges.filter((e) => e.kind === 'reads' && e.polarity === '-').length, 0);
});
