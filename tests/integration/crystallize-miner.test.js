'use strict';
/**
 * crystallization MINER (#13 / §4.1) — the structural-method induction loop with the antiUnify-in-the-loop
 * soundness check and the K1-ceiling guard. Extends crystallize.test.js (the provider-fusion crystallizer) to
 * STRUCTURAL methods: a cast that CREATES a sub-graph (intermediate node + child segments). A method crystallizes
 * iff its firings across ≥minCount sites generalize to ONE stable Plotkin-LGG skeleton whose content is a function
 * of the typed K1 signature. Each claim carries a NEGATIVE CONTROL (the test is not vacuous).
 *
 * Phase 1 here = Gap B+D (mineMethods over the enriched trace). Gap C (born-defeasible contract) and Gap A
 * (crystallizeStructural → 0-call replay) are the later tests in this file.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { methodTrace } = require('../../lib/authoring/mine.js');
const { synthesizeContract } = require('../../lib/authoring/crystallize.js');
const { checkCompose, assertPost } = require('../../lib/authoring/contract.js');
console.log = console.info = console.warn = () => {};

// A deterministic STRUCTURAL provider: insert one intermediate node between origin & target. The derived content
// (the intermediate `state`) is a FUNCTION of the typed premise `kind` (the K1 signature) — so the method is
// signature-determined (sound to crystallize). `calls` records each real provider invocation.
const STATE = { hard: 'split-hard', easy: 'split-easy' };
function makeRefine() {
	const calls = [];
	const Refine = {
		refine( g, c, scope, argz, cb ) {
			calls.push(scope._._id);
			const base = scope._._id, origin = scope._.originNode, target = scope._.targetNode, mid = base + '_m0';
			const state = STATE[scope._.kind] || 'split-?';
			cb(null, [
				{ $_id: '_parent', Refine: true, Refined: true, alts: [{ mid: state, segA: base + '_a0', segB: base + '_b0' }] },
				{ _id: mid, Node: true, state },
				{ _id: base + '_a0', Segment: true, originNode: origin, targetNode: mid, parentSeg: base },
				{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: target, parentSeg: base },
			]);
		},
	};
	return { Refine, calls };
}
const TREE = { childConcepts: {
	Refine: { _id: 'Refine', _name: 'Refine', require: ['Segment', 'kind'], ensure: ['!$Refined'], provider: ['Refine::refine'] },
} };
const node = ( id ) => ({ _id: id });
const seg = ( id, o, t, kind ) => ({ _id: id, originNode: o, targetNode: t, kind });

async function bootMine( seed, providers, opts ) {
	Graph._providers = Object.assign({}, Graph._providers, providers);
	const mt = methodTrace();
	const g = new Graph(JSON.parse(JSON.stringify(seed)), {
		label: 'miner', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error',
	}, { common: JSON.parse(JSON.stringify(TREE)) });
	mt.listen(g);
	await nextStable(g);
	const methods = mt.methods(TREE, Object.assign({ knownIds: new Set(Object.keys(g._objById)) }, opts));
	return { g, mt, methods };
}

test('mineMethods: a recurrent structural method on ≥minCount sites is stable, signature-determined, admissible', async () => {
	const { Refine, calls } = makeRefine();
	const seed = { lastRev: 0,
		nodes: [node('S'), node('G'), node('A'), node('B'), node('C'), node('D')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard'), seg('E3', 'C', 'D', 'easy') ] };
	const { methods } = await bootMine(seed, { Refine });
	assert.equal(calls.length, 3, 'cold: each site is a real provider call');

	const m = methods.find(( x ) => x.concept === 'Refine');
	assert.ok(m, 'the Refine structural method is mined');
	assert.equal(m.count, 3, 'three distinct call sites in one bucket (content varies by kind but the structure is one)');
	assert.equal(m.stable, true, 'the firings generalize to ONE Plotkin-LGG skeleton');
	assert.equal(m.signatureDetermined, true, 'content (state/alts.mid) is a function of the typed premise kind');
	assert.equal(m.admissible, true);
	assert.deepEqual(m.frontier, ['f0', 'f1'], 'two frontier endpoints (origin/target) inferred as call-site holes');
	// the K1 transfer table: one parameterized template PER premise class (hard, easy) — two classes here.
	assert.equal(Object.keys(m.templatesByDigest).length, 2, 'one template per signature class');
	// the content-vars are the model-derived content (state / alts.mid), NOT engine bookkeeping (_rev stripped).
	assert.ok(m.contentVars.some(( p ) => /state/.test(p)), 'the derived intermediate state is a content-var');
	assert.ok(!m.contentVars.some(( p ) => /_rev|_origin/.test(p)), 'engine bookkeeping (_rev/_origin) is stripped, not a content-var');
});

test('NEG 1 — a one-off structural firing does NOT crystallize (count < minCount)', async () => {
	const { Refine } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G')], segments: [ seg('E1', 'S', 'G', 'hard') ] };
	const { methods } = await bootMine(seed, { Refine }, { minCount: 2 });
	const m = methods.find(( x ) => x.concept === 'Refine');
	assert.ok(m, 'it is still mined as a (1-site) bucket');
	assert.equal(m.count, 1);
	assert.equal(m.admissible, false, 'a single observation is not a recurrence → not admissible');
});

test('NEG 2 — a structurally DIFFERENT firing lands in a different bucket (no false merge)', async () => {
	// Refine inserts ONE intermediate; Refine2 inserts TWO. Same concept name would conflate them only if the
	// content-blind structural key collided — it must not.
	const { Refine } = makeRefine();
	const Refine2 = { refine( g, c, scope, argz, cb ) {     // a DIFFERENT structure: two intermediates
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, m0 = base + '_m0', m1 = base + '_m1';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true },
			{ _id: m0, Node: true, state: 'x' }, { _id: m1, Node: true, state: 'y' },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: m0, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: m0, targetNode: m1, parentSeg: base },
			{ _id: base + '_c0', Segment: true, originNode: m1, targetNode: t, parentSeg: base },
		]);
	} };
	// route E1/E2 to the 1-intermediate provider, E9/E10 to the 2-intermediate one by tagging kind.
	const Router = { refine( g, c, scope, argz, cb ) {
		return (scope._.kind === 'double' ? Refine2.refine : Refine.refine)(g, c, scope, argz, cb);
	} };
	const seed = { lastRev: 0,
		nodes: [node('S'), node('G'), node('A'), node('B'), node('P'), node('Q'), node('R'), node('T')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard'), seg('E9', 'P', 'Q', 'double'), seg('E10', 'R', 'T', 'double') ] };
	const { methods } = await bootMine(seed, { Refine: Router });
	const buckets = methods.filter(( x ) => x.concept === 'Refine');
	assert.equal(buckets.length, 2, 'two distinct structural skeletons → two buckets (no conflation)');
	const counts = buckets.map(( b ) => b.count).sort();
	assert.deepEqual(counts, [2, 2], 'each structure recurs twice, separately');
	for ( const b of buckets ) assert.equal(b.stable, true, 'within a bucket the firings are shape-compatible');
});

test('NEG 3 — K1 ceiling: same premise, DIFFERENT content → NOT signature-determined → refused', async () => {
	// a provider whose content depends on a HIDDEN counter, not the premise: two sites with the SAME premise
	// (kind=hard) get DIFFERENT content → content is not a function of the typed signature → the prose case.
	let tick = 0;
	const Wobble = { refine( g, c, scope, argz, cb ) {
		const base = scope._._id, o = scope._.originNode, t = scope._.targetNode, mid = base + '_m0';
		const state = 'wobble-' + (tick++);                  // NOT a function of the premise
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true, alts: [{ mid: state, segA: base + '_a0', segB: base + '_b0' }] },
			{ _id: mid, Node: true, state },
			{ _id: base + '_a0', Segment: true, originNode: o, targetNode: mid, parentSeg: base },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: t, parentSeg: base },
		]);
	} };
	const seed = { lastRev: 0,
		nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };  // SAME premise, both hard
	const { methods } = await bootMine(seed, { Refine: Wobble });
	const m = methods.find(( x ) => x.concept === 'Refine');
	assert.ok(m, 'mined as a bucket (the structure recurs)');
	assert.equal(m.count, 2);
	assert.equal(m.stable, true, 'structure is stable…');
	assert.equal(m.signatureDetermined, false, '…but content varies within one premise class → not signature-determined');
	assert.equal(m.admissible, false, 'the K1 ceiling refuses it (would graveyard a wrong typed fact through the cascade)');
});

// ─────────────────────────────── Gap C — born-defeasible contract ───────────────────────────────────
test('Gap C — the crystallized method is born with a fragment-expressible defeasible contract', async () => {
	const { Refine } = makeRefine();
	const seed = { lastRev: 0,
		nodes: [node('S'), node('G'), node('A'), node('B'), node('C'), node('D')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard'), seg('E3', 'C', 'D', 'easy') ] };
	const { methods } = await bootMine(seed, { Refine });
	const m = methods.find(( x ) => x.concept === 'Refine');

	const contract = synthesizeContract({ concept: 'Refine', read: ['Segment', 'kind'], instances: m.instances, equivKeys: ['Refined'] });
	assert.ok(contract, 'a contract is synthesized');
	assert.deepEqual(contract.post, ['Refined==true'], 'the post is the observed invariant (presence), in-fragment');
	assert.ok(contract.write.includes('Refined') && contract.write.includes('Refine'), 'write = produced facts ∪ self-flag');
	assert.deepEqual(contract.read, ['Segment', 'kind'], 'read = the signature keys');
	assert.equal(contract.effect, 'pure');
});

test('Gap C — checkCompose admits the crystallized method against a downstream consumer (box CLOSED)', async () => {
	const { Refine } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };
	const { methods } = await bootMine(seed, { Refine });
	const m = methods.find(( x ) => x.concept === 'Refine');
	const m1 = { name: 'Refine', contract: synthesizeContract({ concept: 'Refine', read: ['Segment', 'kind'], instances: m.instances, equivKeys: ['Refined'] }) };
	// a downstream method that REQUIRES the segment to be Refined.
	const m2 = { name: 'Report', contract: { read: ['Refined'], write: ['Reported'], pre: ['$Refined==true'], post: ['Reported==true'], effect: 'pure' } };
	const r = checkCompose(m1, m2);
	assert.equal(r.verdict, 'sound', 'post(Refine) ⊨ pre(Report) over the shared key Refined');
	assert.deepEqual(r.shared, ['Refined']);
});

test('Gap C — assertPost BLAMES the crystallized method on a drift case (the defeasible monitor)', async () => {
	const { Refine } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };
	const { methods } = await bootMine(seed, { Refine });
	const m = methods.find(( x ) => x.concept === 'Refine');
	const contract = synthesizeContract({ concept: 'Refine', read: ['Segment', 'kind'], instances: m.instances, equivKeys: ['Refined'] });
	// a case that VIOLATES the induced post (a drift left it un-refined) — the runtime monitor fires blame.
	const bad = assertPost(contract, { Refine: true, Refined: false }, ['Refine', 'Refined'], {});
	assert.equal(bad.ok, false);
	assert.ok(bad.blame && bad.violations.some(( v ) => v.kind === 'post-violated'), 'the induced post is asserted and blamed on violation');
	// the conforming case passes (the monitor is not vacuous).
	const good = assertPost(contract, { Refine: true, Refined: true }, ['Refine', 'Refined'], {});
	assert.equal(good.ok, true);
});

test('Gap C NEG — a structured (non-fragment) output → no contract (refuse the contract path, K1)', async () => {
	const { Refine } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'easy') ] };
	const { methods } = await bootMine(seed, { Refine });
	const m = methods.find(( x ) => x.concept === 'Refine');
	// `alts` is an array of objects — not expressible in the abstract-domain fragment → refuse.
	const contract = synthesizeContract({ concept: 'Refine', read: ['Segment', 'kind'], instances: m.instances, equivKeys: ['alts'] });
	assert.equal(contract, null, 'a post over a structured output is not fragment-expressible → no defeasible contract');
});

// ─────────────────────────────── Gap A — STRUCTURAL crystallization (re-mountable, 0-call replay) ──────────────
const { crystallizeStructural, adopt } = require('../../lib/authoring/crystallize.js');

async function bootGrammar( seed, conceptMap ) {
	const g = new Graph(JSON.parse(JSON.stringify(seed)), {
		label: 'adopt', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error',
	}, conceptMap);
	await nextStable(g);
	return g;
}

test('Gap A — crystallizeStructural re-mounts a learned sub-graph on a fresh site at 0 model calls', async () => {
	const { Refine, calls } = makeRefine();
	const seed = { lastRev: 0,
		nodes: [node('S'), node('G'), node('A'), node('B'), node('C'), node('D')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard'), seg('E3', 'C', 'D', 'easy') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine' });
	assert.equal(res.admitted, true, 'an admissible structural method is crystallized');
	assert.ok(res.candidate.schema.contract, 'the crystal is born with a defeasible contract');
	const learnt = calls.length;                                  // real provider calls spent LEARNING (3)
	assert.equal(learnt, 3);

	// adopt into a FRESH, otherwise-EMPTY grammar (the original Refine provider is NOT wired here, so a cold call is
	// impossible) + a new site E4 whose premise class (kind=hard) was SEEN during learning.
	Graph._providers = {};
	const g2 = await bootGrammar({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('E4', 'X', 'Y', 'hard') ] },
		{ common: { childConcepts: {} } });
	const diff = await adopt(g2, res.candidate);                  // registers the crystal provider + installs the concept (memo-stable)
	assert.equal(diff.stable, true);
	await nextStable(g2);

	assert.equal(calls.length, learnt, '0 NEW real provider calls — the crystal binds a learned template (F6 transfer)');
	assert.ok(g2._objById['E4_m0'], 'the intermediate node is re-mounted on the fresh site');
	assert.equal(g2._objById['E4_m0']._etty._.state, 'split-hard', 'the learned content (kind=hard → split-hard) replayed verbatim');
	assert.equal(g2._objById['E4_a0']._etty._.originNode, 'X', 'the first child is wired to the NEW origin (structural hole rebound)');
	assert.equal(g2._objById['E4_b0']._etty._.targetNode, 'Y', 'the second child is wired to the NEW target');
	assert.equal(g2._objById['E4']._etty._.CrystalRefine, true, 'the crystal cast marker is set (no re-fire / divergence)');
	assert.ok(!g2._objById['E1_m0'] && !g2._objById['S'], 'no id-space from the learning episode leaked into the fresh graph (sound)');
});

test('Gap A NEG — an UNSEEN signature class bypasses (no false replay, no divergence)', async () => {
	const { Refine, calls } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };   // only kind=hard learned
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine' });
	assert.equal(res.admitted, true);
	const learnt = calls.length;

	Graph._providers = {};
	// a fresh site with an UNSEEN premise class (kind=novel) → the crystal must NOT replay a hard template onto it.
	const g2 = await bootGrammar({ lastRev: 0, nodes: [node('X'), node('Y')], segments: [ seg('E4', 'X', 'Y', 'novel') ] },
		{ common: { childConcepts: {} } });
	await adopt(g2, res.candidate);
	await nextStable(g2);

	assert.equal(calls.length, learnt, 'no real provider call (the crystal has no cold model)');
	assert.ok(!g2._objById['E4_m0'], 'no sub-graph re-mounted for the unseen signature (no false replay)');
	assert.equal(g2._objById['E4']._etty._.CrystalRefine, true, 'cast as a NO-OP marker → it does not re-fire (no divergence)');
	assert.ok(g2.getRevisions().length < 50, 'bounded (no apply-cap runaway)');
});

test('Gap A NEG — a one-off episode yields no admissible structural method', async () => {
	const { Refine } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G')], segments: [ seg('E1', 'S', 'G', 'hard') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'] });
	assert.equal(res.admitted, false);
	assert.equal(res.candidate, null);
	assert.match(res.reason, /no admissible structural method/);
});

test('Gap A NEG — the authoritative K1 re-check REFUSES a signature that does not determine content', async () => {
	// hard→split-hard and easy→split-easy are distinct methods keyed on `kind`. Force the replay signature to EXCLUDE
	// kind (signatureKeys=['Segment']): now both classes collide on one signature with different content → the
	// crystal would silently mis-replay → the re-check must REFUSE (never first-wins).
	const { Refine } = makeRefine();
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B'), node('C'), node('D')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard'), seg('E3', 'C', 'D', 'easy') ] };
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine', signatureKeys: ['Segment'] });
	assert.equal(res.admitted, false);
	assert.match(res.reason, /signature-insufficient/);
	// CONTROL: the default signature (includes kind) DOES determine content → admitted (the re-check is not vacuous).
	const ok = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine' });
	assert.equal(ok.admitted, true, 'with kind in the signature, content IS determined → admitted');
});

test('Gap A NEG — a require key ECHOED by the cast is refused (premise capture is post-apply → unreliable)', async () => {
	// REGRESSION (adversarial-review finding): if the cast overwrites one of its own require keys (a normalize/echo
	// pattern), its post-cast mined value differs from the pre-cast value, and excluding it from the replay signature
	// would silently MIS-REPLAY onto an unseen value. A single-value corpus must NOT crystallize such a method.
	const echo = { refine( g, c, scope, argz, cb ) {
		const b = scope._._id, o = scope._.originNode, t = scope._.targetNode, m = b + '_m0', st = STATE[scope._.kind] || '?';
		cb(null, [
			{ $_id: '_parent', Refine: true, Refined: true, kind: 'norm-' + scope._.kind, alts: [{ mid: st }] },  // echoes `kind`
			{ _id: m, Node: true, state: st },
			{ _id: b + '_a0', Segment: true, originNode: o, targetNode: m, parentSeg: b },
			{ _id: b + '_b0', Segment: true, originNode: m, targetNode: t, parentSeg: b },
		]);
	} };
	const seed = { lastRev: 0, nodes: [node('S'), node('G'), node('A'), node('B')],
		segments: [ seg('E1', 'S', 'G', 'hard'), seg('E2', 'A', 'B', 'hard') ] };   // single-value corpus (all hard)
	const res = await crystallizeStructural({ episodeTree: TREE, seed, providers: { Refine: echo }, equivKeys: ['Refined'], idFor: () => 'CrystalRefine' });
	assert.equal(res.admitted, false, 'an echoed require key → refuse (no silent mis-replay on an unseen value)');
	assert.match(res.reason, /require-key-overwritten/);
});
