'use strict';
/**
 * canon — the canonicalization barrier as a brick (promoted 2026-07-03 from the two live uses: the Probe #1
 * intake value-snap and the live-discover structural canon). Value snap (exact/containment/OOV-raw), the
 * structural canon (fail-closed fact whitelist + learned digram folds, to fixpoint), fold specs derived from
 * compress.js mineDigrams output, and the shape/canon comparison keys. Pure unit level.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { snapToVocab, foldsFromDigrams, makeStructuralCanon, shapeKey, canonKey } = require('../../lib/authoring/learning/canon.js');
const { mineDigrams } = require('../../lib/authoring/learning/compress.js');

const VOCAB = ['paid', 'overdue', 'ACME', 'Globex'];

test('snapToVocab — exact ci-match KEEPS the surface form', () => {
	const stats = {};
	assert.deepEqual(snapToVocab('Paid', VOCAB, stats), { value: 'Paid', verdict: 'exact' });
	assert.equal(stats.kept, 1);
});

test('snapToVocab — containment either way SNAPS to the canonical form', () => {
	const stats = {};
	assert.deepEqual(snapToVocab('already paid', VOCAB, stats), { value: 'paid', verdict: 'snapped' });
	assert.deepEqual(snapToVocab('Glob', VOCAB, stats), { value: 'Globex', verdict: 'snapped' });
	assert.equal(stats.snapped, 2);
});

test('snapToVocab — a genuine OOV survives RAW and is counted (the honest path: verify catches it downstream)', () => {
	const stats = {};
	assert.deepEqual(snapToVocab('cancelled', VOCAB, stats), { value: 'cancelled', verdict: 'oov' });
	assert.equal(stats.oov, 1);
});

test('snapToVocab — empty/null never containment-matches (a "" value must not snap onto the first vocab entry)', () => {
	assert.equal(snapToVocab('', VOCAB, {}).verdict, 'oov');
	assert.equal(snapToVocab(null, VOCAB, {}).verdict, 'oov');
});

// ── the structural canon: the live-discover configuration, as the reference fixture ─────────────────────
const mkCanon = () => makeStructuralCanon({
	factKeys : ['field', 'value'],
	factKinds: ['filter', 'aggregate'],
	vocab    : VOCAB,
	folds    : [{ a: 'filter', b: 'aggregate', into: 'aggregate' }],
});

test('whitelist — facts drop on non-fact kinds, and drop FAIL-CLOSED when the gate value is out of vocab', () => {
	const canon = mkCanon();
	const out = canon([
		{ stepKind: 'check', atomic: true, field: 'status', value: 'paid' },      // wrong kind → facts drop
		{ stepKind: 'aggregate', atomic: true, field: 'amount', value: 'sum' },   // leaked OPERATION word → drop BOTH
		{ stepKind: 'aggregate', atomic: true, field: 'status', value: 'Paid' },  // in vocab (ci) → kept
	]);
	assert.deepEqual(out, [
		{ stepKind: 'check', atomic: true },
		{ stepKind: 'aggregate', atomic: true },
		{ stepKind: 'aggregate', atomic: true, field: 'status', value: 'Paid' },
	]);
});

test('digram fold — [filter(f,v), aggregate] folds to aggregate(f,v); the two granularities of ONE plan canon-equal', () => {
	const canon = mkCanon();
	const coarse = [
		{ stepKind: 'aggregate', atomic: true, field: 'status', value: 'paid' },
		{ stepKind: 'aggregate', atomic: true, field: 'status', value: 'overdue' },
		{ stepKind: 'check', atomic: true }, { stepKind: 'emit', atomic: true },
	];
	const fine = [
		{ stepKind: 'filter', atomic: true, field: 'status', value: 'paid' }, { stepKind: 'aggregate', atomic: true },
		{ stepKind: 'filter', atomic: true, field: 'status', value: 'overdue' }, { stepKind: 'aggregate', atomic: true },
		{ stepKind: 'check', atomic: true }, { stepKind: 'emit', atomic: true },
	];
	assert.equal(canonKey(canon(fine), { factKeys: ['field', 'value'] }),
		canonKey(canon(coarse), { factKeys: ['field', 'value'] }),
		'the exact live-discover cycle-2 claim, as a unit invariant');
	assert.equal(shapeKey(canon(fine)), JSON.stringify(['aggregate', 'aggregate', 'check', 'emit']));
});

test('fold fact-merge — one side carries; ci-equal keeps; a CONFLICT drops the key (parallel-over-collapse)', () => {
	const canon = mkCanon();
	const out = canon([
		{ stepKind: 'filter', field: 'status', value: 'paid' },
		{ stepKind: 'aggregate', field: 'status', value: 'overdue' },             // conflict on value, agree on field
	]);
	assert.deepEqual(out, [{ stepKind: 'aggregate', field: 'status' }], 'value dropped, field kept');
});

test('fold runs to FIXPOINT — a chain re-exposes a foldable digram after the first pass', () => {
	const canon = makeStructuralCanon({
		factKeys: ['value'], vocab: VOCAB,
		folds   : [{ a: 'filter', b: 'filter', into: 'filter' }, { a: 'filter', b: 'aggregate', into: 'aggregate' }],
	});
	const out = canon([{ stepKind: 'filter', value: 'paid' }, { stepKind: 'filter', value: 'paid' }, { stepKind: 'aggregate' }]);
	assert.deepEqual(out, [{ stepKind: 'aggregate', value: 'paid' }]);
});

test('fail-closed I/O — null in → null out; the input is never mutated', () => {
	const canon = mkCanon();
	assert.equal(canon(null), null);
	assert.equal(canon(undefined), null);
	const steps = [{ stepKind: 'filter', field: 'status', value: 'paid' }, { stepKind: 'aggregate' }];
	const frozen = JSON.stringify(steps);
	canon(steps);
	assert.equal(JSON.stringify(steps), frozen);
});

test('foldsFromDigrams — mined digrams above minSupport become fold specs (the fold is LEARNED, never ad hoc)', () => {
	const n = ( k, ...c ) => ({ k, c });
	const mined = mineDigrams([
		{ cls: 'compare', mult: 2, tree: [n('filter'), n('aggregate'), n('check')] },
		{ cls: 'compare', mult: 1, tree: [n('filter'), n('aggregate'), n('emit')] },
	]);
	const folds = foldsFromDigrams(mined.digrams, { minSupport: 3 });
	assert.deepEqual(folds, [{ a: 'filter', b: 'aggregate', into: 'aggregate' }],
		'(filter,aggregate) support 3 admitted; (aggregate,check)/(aggregate,emit) support <3 filtered');
});

test('shapeKey/canonKey — null-safe, ci on fact values, kinds-only vs full digest', () => {
	assert.equal(shapeKey(null), null);
	assert.equal(canonKey(null), null);
	const a = [{ stepKind: 'aggregate', field: 'Status', value: 'PAID' }];
	const b = [{ stepKind: 'aggregate', field: 'status', value: 'paid' }];
	assert.equal(canonKey(a, { factKeys: ['field', 'value'] }), canonKey(b, { factKeys: ['field', 'value'] }));
});

test('snapToVocab — AMBIGUOUS containment stays OOV (fail-closed): a hypernym surface never snaps arbitrarily', () => {
	const stats = {};
	const r = snapToVocab('plug', ['europlug', 'usplug', 'ukplug'], stats);
	assert.equal(r.verdict, 'oov', "'plug' matches several vocab words — snapping to the first would be an arbitrary wrong pick");
	assert.equal(r.value, 'plug', 'the raw surface survives (the honest path)');
	assert.deepEqual(r.ambiguous, ['europlug', 'usplug', 'ukplug'], 'the candidate set is reported for a downstream disambiguator');
	assert.equal(stats.ambiguous, 1);
	assert.equal(snapToVocab('europ', ['europlug', 'usplug'], {}).verdict, 'snapped', 'UNIQUE containment still snaps');
});
