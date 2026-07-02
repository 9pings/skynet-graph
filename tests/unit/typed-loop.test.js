'use strict';
/**
 * typed-loop — the fused RECURSIVE TYPED decompose operator (NEXT #1 fidelity work).
 * loop.js's emergent depth (model decides atomic/split) + TYPED per-step content: each child step carries a
 * canon-snapped `stepKind` (closed enum, fail-closed) + `stepIndex`, prose rides UNTRACKED keys — so a real
 * engine decompose trace is K1-crystallizable (the cont.⁷ finding: loop.js writes prose on children → fails K1).
 * Pure unit level: providers called directly with a fake scope (same style as loop.js's own coverage).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTypedDecomposeProviders, TYPED_PROSE_KEYS } = require('../../lib/authoring/typed-loop.js');

const scopeOf = ( facts ) => ({ _: facts });
const call = ( fn, facts ) => new Promise(( res, rej ) => fn(null, null, scopeOf(facts), null, ( e, tpl ) => e ? rej(e) : res(tpl)));
const SEG = { _id: 'T1', originNode: 'S', targetNode: 'G', Segment: true };
const KINDS = { enum: ['retrieve', 'transform', 'validate', 'emit'], synonyms: { retrieve: ['fetch'] } };

test('expand writes a canon-snapped stepKind + stepIndex on each child; prose stays on untracked keys', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, expandFn: () => [
		{ stepKind: 'Retrieve', description: 'pull the rows' },      // case-normalized snap
		{ stepKind: 'emit', description: 'write the report' },
	] });
	const tpl = await call(P.AI.expand, SEG);
	assert.equal(tpl[0].$_id, '_parent');
	assert.deepEqual(tpl[0].expandedInto, ['T1_s0', 'T1_s1']);
	const kids = tpl.filter(( o ) => o.Segment);
	assert.equal(kids.length, 2);
	assert.equal(kids[0].stepKind, 'retrieve');
	assert.equal(kids[0].stepIndex, 0);
	assert.equal(kids[0].description, 'pull the rows');              // prose kept, but on an UNTRACKED key
	assert.equal(kids[1].stepKind, 'emit');
	assert.equal(kids[1].stepIndex, 1);
	// the chain wires origin → mid → target, and the created MID node carries the typed plan-state
	const mid = tpl.find(( o ) => o.Node);
	assert.ok(mid && mid._id === 'T1_m0');
	assert.equal(mid.state, 'plan-retrieve');
	assert.equal(kids[0].originNode, 'S');
	assert.equal(kids[0].targetNode, 'T1_m0');
	assert.equal(kids[1].originNode, 'T1_m0');
	assert.equal(kids[1].targetNode, 'G');
});

test('a synonym-ring alias snaps to the member (deterministic thesaurus, not the raw surface)', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, expandFn: () => [{ stepKind: 'fetch' }, { stepKind: 'emit' }] });
	const kids = (await call(P.AI.expand, SEG)).filter(( o ) => o.Segment);
	assert.equal(kids[0].stepKind, 'retrieve');
	assert.equal(kids[0].stepVia, 'synonym');
});

test('an out-of-vocab stepKind is FAIL-CLOSED: no typed stepKind fact, raw kept on an untracked key', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, expandFn: () => [{ stepKind: 'banana' }, { stepKind: 'emit' }] });
	const kids = (await call(P.AI.expand, SEG)).filter(( o ) => o.Segment);
	assert.ok(!('stepKind' in kids[0]));                             // the typed spine never carries a guess
	assert.equal(kids[0].StepKindMiss, true);
	assert.equal(kids[0].stepKindRaw, 'banana');
	const mid = (await call(P.AI.expand, SEG)).find(( o ) => o.Node);
	assert.ok(!('state' in mid));                                    // no typed plan-state minted from a miss
});

test('maxBranch caps the fan-out; an empty expansion degrades to an Atomic leaf', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, maxBranch: 2,
		expandFn: () => [{ stepKind: 'retrieve' }, { stepKind: 'transform' }, { stepKind: 'emit' }] });
	const kids = (await call(P.AI.expand, SEG)).filter(( o ) => o.Segment);
	assert.equal(kids.length, 2);
	const P0 = makeTypedDecomposeProviders({ stepKinds: KINDS, expandFn: () => [] });
	const tpl = await call(P0.AI.expand, SEG);
	assert.equal(tpl.Atomic, true);
});

test('the depth floor forces Atomic WITHOUT spending an eval call (the loop.js contract, inherited)', async () => {
	let evals = 0;
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, maxDepth: 2, evalFn: () => { evals++; return { atomic: false }; } });
	const atFloor = await call(P.AI.evalComplexity, Object.assign({}, SEG, { depth: 2 }));
	assert.equal(atFloor.Atomic, true);
	assert.equal(evals, 0);                                          // floored → no model spend
	const below = await call(P.AI.evalComplexity, Object.assign({}, SEG, { depth: 1 }));
	assert.equal(below.NeedsSplit, true);
	assert.equal(evals, 1);
});

test('TYPED_PROSE_KEYS names every untracked prose key the operator writes (the crystallizer contract)', () => {
	for ( const k of ['label', 'description', 'answer', 'stepKindRaw'] ) assert.ok(TYPED_PROSE_KEYS.includes(k), k);
});
