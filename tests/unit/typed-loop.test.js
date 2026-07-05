'use strict';
/**
 * typed-loop — the fused RECURSIVE TYPED decompose operator (NEXT #1 fidelity work; Laurie confront A+B applied).
 * Typed canon-snapped steps + STAMPED per-child eval verdicts (the mined patch carries the re-fire guards) +
 * the discriminating key in Expand's require (the premise captures it). Pure unit level: providers called
 * directly with a fake scope (same style as loop.js's own coverage).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTypedDecomposeProviders, typedLoopConceptTree, mountTemplate, TYPED_PROSE_KEYS } = require('../../lib/authoring/typed-loop.js');

const scopeOf = ( facts ) => ({ _: facts });
const call = ( fn, facts ) => new Promise(( res, rej ) => fn(null, null, scopeOf(facts), null, ( e, tpl ) => e ? rej(e) : res(tpl)));
const SEG = { _id: 'T1', originNode: 'S', targetNode: 'G', Segment: true };
const KINDS = { enum: ['retrieve', 'transform', 'validate', 'emit'], synonyms: { retrieve: ['fetch'] } };

test('opts.stepFacts — declared TYPED per-step content facts ride the child (the param the LGG will hole into a slot); undeclared keys never leak', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, maxDepth: 3, stepFacts: ['group'], expandFn: () => [
		{ stepKind: 'retrieve', group: 'overdue' },
		{ stepKind: 'emit', group: 'paid', rogue: 'never' },
	] });
	const tpl = await call(P.AI.expand, SEG);
	const kids = tpl.filter(( o ) => o.Segment);
	assert.equal(kids[0].group, 'overdue');
	assert.equal(kids[1].group, 'paid');
	assert.ok(!('rogue' in kids[1]), 'an undeclared step key NEVER reaches the graph (whitelist-only)');
});

test('expand writes a canon-snapped stepKind + stepIndex + a STAMPED eval verdict on each child; prose untracked', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, maxDepth: 3, expandFn: () => [
		{ stepKind: 'Retrieve', atomic: false, description: 'pull the rows' },   // model says: this step re-splits
		{ stepKind: 'emit', description: 'write the report' },                   // atomic by default
	] });
	const tpl = await call(P.AI.expand, SEG);
	assert.equal(tpl[0].$_id, '_parent');
	assert.deepEqual(tpl[0].expandedInto, ['T1_s0', 'T1_s1']);
	const kids = tpl.filter(( o ) => o.Segment);
	assert.equal(kids.length, 2);
	assert.equal(kids[0].stepKind, 'retrieve');
	assert.equal(kids[0].stepIndex, 0);
	assert.equal(kids[0].description, 'pull the rows');                          // prose kept, on an UNTRACKED key
	// the stamped verdicts — the guards ride the SAME patch (Laurie A: a mounted replay cannot re-fire eval)
	assert.equal(kids[0].EvalComplexity, true);
	assert.equal(kids[0].NeedsSplit, true);
	assert.ok(!kids[0].Atomic);
	assert.equal(kids[1].EvalComplexity, true);
	assert.equal(kids[1].Atomic, true);
	// the chain wires origin → mid → target; the created MID node carries the typed plan-state
	const mid = tpl.find(( o ) => o.Node);
	assert.ok(mid && mid._id === 'T1_m0');
	assert.equal(mid.state, 'plan-retrieve');
	assert.equal(kids[0].originNode, 'S');
	assert.equal(kids[1].targetNode, 'G');
});

test('the depth floor forces Atomic on every child at expand time (no NeedsSplit past the floor)', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, maxDepth: 1,
		expandFn: () => [{ stepKind: 'retrieve', atomic: false }, { stepKind: 'emit' }] });
	const kids = (await call(P.AI.expand, SEG)).filter(( o ) => o.Segment);       // children land at depth 1 == floor
	assert.equal(kids[0].Atomic, true);
	assert.ok(!kids[0].NeedsSplit);
});

test('a synonym-ring alias snaps to the member (deterministic thesaurus, not the raw surface)', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, expandFn: () => [{ stepKind: 'fetch' }, { stepKind: 'emit' }] });
	const kids = (await call(P.AI.expand, SEG)).filter(( o ) => o.Segment);
	assert.equal(kids[0].stepKind, 'retrieve');
	assert.equal(kids[0].stepVia, 'synonym');
});

test('an out-of-vocab stepKind is FAIL-CLOSED: no typed stepKind fact, raw kept untracked, no plan-state', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, expandFn: () => [{ stepKind: 'banana' }, { stepKind: 'emit' }] });
	const tpl = await call(P.AI.expand, SEG);
	const kids = tpl.filter(( o ) => o.Segment);
	assert.ok(!('stepKind' in kids[0]));                                          // the typed spine never carries a guess
	assert.equal(kids[0].StepKindMiss, true);
	assert.equal(kids[0].stepKindRaw, 'banana');
	assert.ok(!('state' in tpl.find(( o ) => o.Node)));                           // no typed plan-state minted from a miss
});

test('maxBranch caps the fan-out; an empty expansion degrades to an Atomic leaf', async () => {
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, maxBranch: 2,
		expandFn: () => [{ stepKind: 'retrieve' }, { stepKind: 'transform' }, { stepKind: 'emit' }] });
	assert.equal((await call(P.AI.expand, SEG)).filter(( o ) => o.Segment).length, 2);
	const P0 = makeTypedDecomposeProviders({ stepKinds: KINDS, expandFn: () => [] });
	assert.equal((await call(P0.AI.expand, SEG)).Atomic, true);
});

test('the root depth floor forces Atomic WITHOUT spending an eval call (the loop.js contract, inherited)', async () => {
	let evals = 0;
	const P = makeTypedDecomposeProviders({ stepKinds: KINDS, maxDepth: 2, evalFn: () => { evals++; return { atomic: false }; } });
	const atFloor = await call(P.AI.evalComplexity, Object.assign({}, SEG, { depth: 2 }));
	assert.equal(atFloor.Atomic, true);
	assert.equal(evals, 0);
});

test('typedLoopConceptTree puts the discriminating key in Expand.require (the premise captures it — Laurie B)', () => {
	const t = typedLoopConceptTree();
	const c = t.childConcepts.Task.childConcepts;
	assert.deepEqual(c.Expand.require, ['Task', 'NeedsSplit', 'stepKind']);
	const t2 = typedLoopConceptTree({ sigKey: 'taskKind' });
	assert.deepEqual(t2.childConcepts.Task.childConcepts.Expand.require, ['Task', 'NeedsSplit', 'taskKind']);
	const tr = typedLoopConceptTree({ reactive: true });
	assert.ok(tr.childConcepts.Task.childConcepts.Rollup);
});

test('mountTemplate grounds a relativized template onto a site: _parent → the root id + the root eval stamp', () => {
	const tpl = [
		{ $_id: '_parent', Expand: true, expandedInto: ['⟦@base⟧_s0'] },
		{ _id: '⟦@base⟧_s0', Segment: true, originNode: '⟦@ref:origin⟧', targetNode: '⟦@ref:target⟧', stepKind: 'emit', EvalComplexity: true, Atomic: true },
	];
	const m = mountTemplate(tpl, { rootId: 'F1', origin: 'X', target: 'Y' });
	assert.equal(m[0].$$_id, 'F1');
	assert.ok(!('$_id' in m[0]));
	assert.equal(m[0].EvalComplexity, true);                                      // the mount decision subsumes the root eval
	assert.equal(m[0].NeedsSplit, true);
	assert.equal(m[1]._id, 'F1_s0');
	assert.equal(m[1].originNode, 'X');
	assert.equal(m[1].targetNode, 'Y');
	// an unbound frontier ref → REFUSE the whole mount (never partial)
	assert.equal(mountTemplate(tpl, { rootId: 'F1', origin: 'X' }), null);
	// create mode: the task segment is CREATED WITH its mounted structure in ONE mutation (the boot-race fix —
	// a mount pushed after the segment exists races the providers and the spend is not elided)
	const c = mountTemplate(tpl, { rootId: 'F2', origin: 'X', target: 'Y', create: true, facts: { stepKind: 'etl' } });
	assert.equal(c[0]._id, 'F2');
	assert.ok(!('$$_id' in c[0]));
	assert.equal(c[0].Segment, true);
	assert.equal(c[0].originNode, 'X');
	assert.equal(c[0].targetNode, 'Y');
	assert.equal(c[0].stepKind, 'etl');
	assert.equal(c[0].NeedsSplit, true);
});

test('TYPED_PROSE_KEYS names every untracked prose key the operator writes (the crystallizer contract)', () => {
	for ( const k of ['label', 'description', 'answer', 'stepKindRaw'] ) assert.ok(TYPED_PROSE_KEYS.includes(k), k);
});
