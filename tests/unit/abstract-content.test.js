'use strict';
/**
 * content-hole generalization (abstract.js) — the antiUnify content-forge adapt operator (creative loop, brick C,
 * the richer adapt; study 2026-06-30-creative-loop-two-level-grammar.md "conceptual blending"). Discover WHICH
 * leaves of a method are CONTENT (vary across its instances) vs SKELETON (shared), so a controller forges only the
 * holes. Field-AGNOSTIC (no hard-coded field name) — each claim carries a discriminating NEG control. ZERO-CORE, pure.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generalizeContent, fillContentHoles } = require('../../lib/authoring/abstract.js');

// two parameterized templates of ONE method: same structural skeleton (holes ⟦@base⟧/⟦@ref:o⟧ + the literal X),
// content differs at `label` ONLY (a field that is NOT `state` → proves discovery is field-agnostic).
const A = [{ $$_id: '⟦@base⟧', X: true }, { $$_id: '⟦@base⟧_m', label: 'foo', originNode: '⟦@ref:o⟧' }];
const B = [{ $$_id: '⟦@base⟧', X: true }, { $$_id: '⟦@base⟧_m', label: 'bar', originNode: '⟦@ref:o⟧' }];

test('generalizeContent — auto-discovers the content hole (field-agnostic), keeps the skeleton', () => {
	const g = generalizeContent([A, B]);
	assert.equal(g.stable, true);
	assert.deepEqual(g.contentVars.map(( c ) => c.path), ['[1].label'], 'the VARYING leaf is the only content hole — no hard-coded field');
	// the skeleton holes the content leaf and keeps everything else (structural holes + the agreeing literal X) verbatim.
	assert.deepEqual(g.skeleton[1].label, { '§var': '[1].label' }, 'content leaf → hole');
	assert.equal(g.skeleton[0].X, true, 'an agreeing literal is kept, not holed');
	assert.equal(g.skeleton[1].originNode, '⟦@ref:o⟧', 'a structural hole is kept, not treated as content');
	assert.equal(g.skeleton[1].$$_id, '⟦@base⟧_m', 'a created-id hole is kept');
});

test('generalizeContent — NEG: a single template cannot reveal content holes (need ≥2 differing instances)', () => {
	const g = generalizeContent([A]);
	assert.equal(g.stable, false, 'one instance → no LGG → not stable');
	assert.deepEqual(g.contentVars, [], 'nothing to forge');
});

test('generalizeContent — NEG: shape-incompatible templates do not share a skeleton', () => {
	const C = [{ $$_id: '⟦@base⟧', X: true }];                       // a different SHAPE (one element, no mid)
	const g = generalizeContent([A, C]);
	assert.equal(g.stable, false, 'a shape mismatch with the first → not stable (excluded from the union)');
});

test('fillContentHoles — fills every hole; NEG: an unforged hole returns null (no undefined leaf baked)', () => {
	const g = generalizeContent([A, B]);
	const filled = fillContentHoles(g.skeleton, { '[1].label': 'baz' });
	assert.equal(filled[1].label, 'baz', 'the content hole is filled with the forged value');
	assert.equal(filled[1].originNode, '⟦@ref:o⟧', 'structural holes survive (to be instantiated at the call site)');
	assert.equal(filled[0].X, true, 'the skeleton is intact');
	// NEG — a missing forge for a hole must REFUSE (null), never silently bake an `undefined` leaf.
	assert.equal(fillContentHoles(g.skeleton, {}), null, 'an unforged hole → null (refuse)');
});

test('generalizeContent — three instances union their content holes (≥2, folded)', () => {
	const A2 = [{ $$_id: '⟦@base⟧', kind: 'k1' }, { $$_id: '⟦@base⟧_m', label: 'foo' }];
	const B2 = [{ $$_id: '⟦@base⟧', kind: 'k2' }, { $$_id: '⟦@base⟧_m', label: 'bar' }];
	const C2 = [{ $$_id: '⟦@base⟧', kind: 'k3' }, { $$_id: '⟦@base⟧_m', label: 'baz' }];
	const g = generalizeContent([A2, B2, C2]);
	assert.equal(g.stable, true);
	assert.deepEqual(g.contentVars.map(( c ) => c.path).sort(), ['[0].kind', '[1].label'], 'BOTH varying leaves discovered across the 3 instances');
});
