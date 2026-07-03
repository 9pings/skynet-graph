'use strict';
/**
 * parametric — role-typed slots over an LGG skeleton (the Probe-#1 mechanics promoted, 2026-07-03): slot
 * binding (antiUnify holes ARE the slots, role = stepKind#stepIndex), the fail-closed parametric mount
 * (typed hint, never partial), and per-SLOT blame provenance (slotPostFrom/attributeSlotBlame — the H3
 * postFrom doctrine at slot grain: only a failure localized to exactly ONE role is admissible negative
 * evidence; shared/unknown/mixed → discarded). Pure unit level.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slotBindings, mountParametric, slotPostFrom, attributeSlotBlame } = require('../../lib/authoring/parametric.js');

// a crystallized-then-LGG'd method skeleton (the methodContentHoles output shape): two param-holed
// aggregate steps + a constant check step — the Probe-#1 compare frame.
const seg = ( sid, extra ) => Object.assign({
	_id: '⟦@base⟧_s' + sid, Segment: true, originNode: '⟦@ref:origin⟧', targetNode: '⟦@ref:target⟧',
	EvalComplexity: true, Atomic: true }, extra);
const GEN = { stable: true, contentVars: ['v0', 'v1', 'v2', 'v3'], skeleton: [
	{ $_id: '_parent', Expand: true, expandedInto: ['⟦@base⟧_s0', '⟦@base⟧_s1', '⟦@base⟧_s2'] },
	seg(0, { stepKind: 'aggregate', stepIndex: 0, field: { '§var': 'v0' }, value: { '§var': 'v1' } }),
	seg(1, { stepKind: 'aggregate', stepIndex: 1, field: { '§var': 'v2' }, value: { '§var': 'v3' } }),
	seg(2, { stepKind: 'check', stepIndex: 2 }),
] };
const PARAMS = { 'aggregate#0.field': 'status', 'aggregate#0.value': 'overdue',
	'aggregate#1.field': 'status', 'aggregate#1.value': 'paid' };

test('slotBindings — the antiUnify holes read as role-typed slots (role = stepKind#stepIndex, key = the holed fact)', () => {
	const slots = slotBindings(GEN);
	assert.deepEqual(slots.map(( s ) => s.role + '.' + s.key ),
		['aggregate#0.field', 'aggregate#0.value', 'aggregate#1.field', 'aggregate#1.value']);
	assert.ok(slots.every(( s ) => s.stepKind === 'aggregate' ));
});

test('mountParametric — complete params mount in ONE create-mode mutation, holes filled from the typed params', () => {
	const slots = slotBindings(GEN);
	const m = mountParametric(GEN, slots, { rootId: 'M1', origin: 'X', target: 'Y', create: true, facts: { stepKind: 'compare' } }, PARAMS);
	assert.equal(m.status, 'complete');
	assert.equal(m.mutation[0]._id, 'M1');
	assert.equal(m.mutation[0].stepKind, 'compare');
	assert.deepEqual(m.mutation.slice(1, 3).map(( s ) => s.field + '=' + s.value ), ['status=overdue', 'status=paid']);
	assert.deepEqual(m.values, { v0: 'status', v1: 'overdue', v2: 'status', v3: 'paid' }, 'fill-time provenance exposed');
});

test('mountParametric — a bare role key binds a single-holed role', () => {
	const gen1 = { skeleton: [
		{ $_id: '_parent', Expand: true, expandedInto: ['⟦@base⟧_s0'] },
		seg(0, { stepKind: 'aggregate', stepIndex: 0, value: { '§var': 'v0' } }),
	] };
	const m = mountParametric(gen1, slotBindings(gen1), { rootId: 'M2', origin: 'X', target: 'Y' }, { 'aggregate#0': 'overdue' });
	assert.equal(m.status, 'complete');
	assert.equal(m.mutation[1].value, 'overdue');
});

test('mountParametric — a missing param is FAIL-CLOSED: typed hint, NOTHING mounted (never a partial mount)', () => {
	const slots = slotBindings(GEN);
	const starved = Object.assign({}, PARAMS);
	delete starved['aggregate#1.value'];
	const m = mountParametric(GEN, slots, { rootId: 'M3', origin: 'X', target: 'Y' }, starved);
	assert.equal(m.status, 'impracticable');
	assert.deepEqual(m.hint, [{ role: 'aggregate#1', key: 'value', stepKind: 'aggregate' }]);
	assert.ok(!m.mutation);
});

test('mountParametric — an unbound frontier ref refuses the whole mount', () => {
	const slots = slotBindings(GEN);
	const m = mountParametric(GEN, slots, { rootId: 'M4', origin: 'X' }, PARAMS);    // no target
	assert.equal(m.status, 'impracticable');
	assert.equal(m.hint[0].role, 'frontier');
});

test('slotPostFrom — provenance is minted where the atoms are declared; a two-role atom reads `shared`', () => {
	const { post, postSlots } = slotPostFrom({
		'aggregate#0': ['$sum.a >= 0', 'rows.a>0'],
		'aggregate#1': ['$sum.b >= 0', 'rows.a > 0'],                                  // canon-collides with aggregate#0's
	});
	assert.deepEqual(post, ['$sum.a >= 0', 'rows.a>0', '$sum.b >= 0']);
	assert.equal(postSlots['sum.a>=0'], 'aggregate#0');
	assert.equal(postSlots['sum.b>=0'], 'aggregate#1');
	assert.equal(postSlots['rows.a>0'], 'shared');
});

test('attributeSlotBlame — a failure localized to ONE role is admissible negative evidence for that slot', () => {
	const { postSlots } = slotPostFrom({ 'aggregate#0': ['rows.a>0'], 'aggregate#1': ['rows.b>0'] });
	const r = attributeSlotBlame({ postSlots, failedAtoms: ['$rows.a > 0'] });        // surface variance vs declaration
	assert.deepEqual(r, { perAtom: [{ atom: '$rows.a > 0', role: 'aggregate#0' }], role: 'aggregate#0', admissible: true });
});

test('attributeSlotBlame — shared, unknown, mixed-role, or empty failures are INADMISSIBLE (the blame-gate)', () => {
	const { postSlots } = slotPostFrom({ 'aggregate#0': ['rows.a>0', 'total>0'], 'aggregate#1': ['rows.b>0', 'total>0'] });
	const shared = attributeSlotBlame({ postSlots, failedAtoms: ['total>0'] });
	assert.deepEqual([shared.admissible, shared.role, shared.perAtom[0].role], [false, null, 'unlocalized']);
	const unknown = attributeSlotBlame({ postSlots, failedAtoms: ['neverDeclared==1'] });
	assert.equal(unknown.admissible, false);
	const mixed = attributeSlotBlame({ postSlots, failedAtoms: ['rows.a>0', 'rows.b>0'] });
	assert.deepEqual([mixed.admissible, mixed.role], [false, null]);
	assert.equal(attributeSlotBlame({ postSlots, failedAtoms: [] }).admissible, false);
	// contract carrier face: the provenance rides a contract object
	const viaContract = attributeSlotBlame({ contract: { postSlots }, failedAtoms: ['rows.b>0'] });
	assert.deepEqual([viaContract.admissible, viaContract.role], [true, 'aggregate#1']);
});
