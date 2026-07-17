'use strict';
/**
 * The integrated demo's GO/NO-GO bars — the VACUITY GUARD.
 *
 * The 7 pre-registered bars printed by `examples/integrated-demo/run.js` were once part-theater: three of
 * them could never fail (`['4 acts', true]` was a literal; `status !== 'ungated'` and `kind !== 'silent'`
 * compared against values no code path ever assigns). A check that cannot go red certifies nothing.
 * `_surface.js#buildVerdictChecks` now derives every bar from a run signal that CAN take the failing value;
 * this test is the negative control per bar — each one is shown red on its failure shape, so the bars can
 * never silently return to tautology.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildVerdictChecks } = require('../../examples/integrated-demo/_surface.js');

// a green fixture mirroring the recorded film's shape (refusal branch: force exercised, traced untrusted)
const green = () => ({
	actsSeen: ['ACT 1', 'ACT 2', 'ACT 3', 'ACT 4'],
	rows: [
		{ step: 's1', status: 'certified-shape' },
		{ step: 's2', status: 'open' },
		{ step: 'cmp', status: 'certified-shape' },
	],
	admitted: [{ stepId: 's1' }],
	methods: [
		{ stepId: 's1', steps: [
			{ op: 'subtract', args: [{ cell: { r: 1, c: 2 } }, { v: 3, ambiguous: true }] },
			{ op: 'divide', args: [{ k: 0 }] },
		] },
		{ stepId: 'cmp', steps: [{ op: 'greater', args: [{ input: 's1' }, { input: 's2' }] }] },
	],
	certifiedPlus: ['subtract>divide', 'greater'],
	trapFact: undefined,
	trapForce: { status: 'recorded-untrusted', certified: false },
	forcedLog: [{ proposal: { stepId: 'trap' }, meta: { forced: true, blame: 'shape ∉ referential' } }],
	driftA: { calls: 0, refired: 2, total: 9 },
	reopens: [{ id: 'cmp', op: 'reopen', reason: 'premise drifted: c_1_2 (rev 12)' }],
	replay: { same: true, calls: 0 },
	corrupted: { rejected: 1 },
});

const okOf = ( sig ) => buildVerdictChecks(sig).map(( c ) => c[1] );
const barNames = buildVerdictChecks(green()).map(( c ) => c[0] );

test('the film shape is GO: 7 bars, all green', () => {
	const checks = buildVerdictChecks(green());
	assert.equal(checks.length, 7);                       // README sells "7 checks" — pinned here
	checks.forEach(( [ n, ok ] ) => assert.equal(ok, true, n));
});

test('bar 1 goes red when an act did not run', () => {
	const sig = green(); sig.actsSeen = ['ACT 1', 'ACT 2', 'ACT 4'];
	assert.equal(okOf(sig)[0], false);
});

test('bar 2 goes red on a shown value with NO MCP admission behind it', () => {
	const sig = green(); sig.admitted = [];               // s1 still certified in the synthesis
	assert.equal(okOf(sig)[1], false);
});

test('bar 2 goes red on a bare unflagged literal (the invented number)', () => {
	const sig = green(); sig.methods[0].steps[0].args[1] = { v: 42 };
	assert.equal(okOf(sig)[1], false);
});

test('bar 2 goes red when the backing shape left the frozen referential', () => {
	const sig = green(); sig.certifiedPlus = ['greater'];
	assert.equal(okOf(sig)[1], false);
});

test('bar 3 goes red on a certified trap fact', () => {
	const sig = green(); sig.trapFact = { value: 123, cast: true };
	assert.equal(okOf(sig)[2], false);
});

test('bar 3 goes red if the trap ever reaches the admitted set', () => {
	const sig = green(); sig.admitted.push({ stepId: 'trap' });
	assert.equal(okOf(sig)[2], false);
});

test('bar 3 goes red if force ever ADMITS (certified true)', () => {
	const sig = green(); sig.trapForce = { status: 'admitted', certified: true };
	assert.equal(okOf(sig)[2], false);
});

test('bar 3 goes red if a force is NOT journal-traced', () => {
	const sig = green(); sig.forcedLog = [];
	assert.equal(okOf(sig)[2], false);
});

test('bar 4 goes red on model calls during the drift, on zero re-derivation, and on no selectivity', () => {
	for ( const driftA of [ { calls: 1, refired: 2, total: 9 }, { calls: 0, refired: 0, total: 9 }, { calls: 0, refired: 9, total: 9 } ] ) {
		const sig = green(); sig.driftA = driftA;
		assert.equal(okOf(sig)[3], false, JSON.stringify(driftA));
	}
});

test('bar 5 goes red on no reopen, and on a reopen without the reason', () => {
	for ( const reopens of [ [], [{ id: 'cmp', op: 'reopen' }] ] ) {
		const sig = green(); sig.reopens = reopens;
		assert.equal(okOf(sig)[4], false, JSON.stringify(reopens));
	}
});

test('bar 6 goes red on a divergent rebuild, and on a rebuild that called the model', () => {
	for ( const replay of [ { same: false, calls: 0 }, { same: true, calls: 3 } ] ) {
		const sig = green(); sig.replay = replay;
		assert.equal(okOf(sig)[5], false, JSON.stringify(replay));
	}
});

test('bar 7 goes red when the corrupted checkpoint slips through', () => {
	const sig = green(); sig.corrupted = { rejected: 0 };
	assert.equal(okOf(sig)[6], false);
});

test('the bars cover the 7 pre-registered DESIGN clauses by name', () => {
	for ( const frag of [ '4 acts', 'ungated', 'trap', 'drift-A', 'drift-B', 'replay', 'corrupted' ] )
		assert.ok(barNames.some(( n ) => n.indexOf(frag) >= 0 ), frag);
});
