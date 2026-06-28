'use strict';
/**
 * C-contract — the defeasible separation-triple checker (design §2/§9.1/§11.6). Pure-logic contract:
 *   - per-key ABSTRACT-DOMAIN entailment (interval + finite-domain), NOT atom-by-atom — proven by an integer-gap
 *     ACCEPT and a subtle REFUSE (it's interval reasoning, not string matching);
 *   - the checker NEVER false-accepts — out-of-fragment (disjunction / relational / under-determined) → 'escalate';
 *   - the three soundness GATES the ⊨ check structurally cannot do: G1 frame-completeness (runtime touched-vs-
 *     declared), G2 effect-tag → ground-truth oracle, G3 footprint-cycle rejection;
 *   - blame on a violated INDUCED post = contract REVISION (specialize the pre), not removal.
 * Every claim has a NEGATIVE CONTROL (the case that SHOULD fail / refuse does).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../lib/authoring/contract.js');

const K = ( atoms, k ) => C.normalize(atoms).byKey[k];
const ek = ( post, pre, k ) => C.entailsKey(K(post, k), K(pre, k));

test('per-key ABSTRACT-DOMAIN entailment — interval reasoning, not atom matching', () => {
	// the two cases an atom-by-atom checker gets WRONG:
	assert.equal(ek(['x>3 && x<5'], ['x==4'], 'x'), 'yes', 'integer gap: (3,5)∩ℤ = {4} ⊨ x==4');
	assert.equal(ek(['x>=5 && x<=5'], ['x==5'], 'x'), 'yes', 'two-sided collapse ⊨ equality');
	// negative control: a SUBTLE non-entailment a sloppy checker would wave through
	assert.equal(ek(['x>=5'], ['x>=7'], 'x'), 'no', 'x>=5 admits 5,6 which x>=7 forbids → NOT ⊨');
	assert.equal(ek(['x>=7'], ['x>=5'], 'x'), 'yes', 'the sound direction holds');
	// rational literal DEMOTES integer reasoning (soundness: (3.0,5) over ℝ admits 3.5 ≠ 4)
	assert.equal(ek(['x>3.0 && x<5'], ['x==4'], 'x'), 'no', 'no integer gap over rationals');
	// ≠ in the pre must be respected
	assert.equal(ek(['x>=1 && x<=9'], ['x>=1 && x<=9 && x!=4'], 'x'), 'no', 'post admits 4 which pre excludes');
	assert.equal(ek(['x>=1 && x<=9 && x!=4'], ['x>=1 && x<=9 && x!=4'], 'x'), 'yes', 'matching exclusion ⊨');
});

test('categorical (enum/id) entailment — allow-set ⊆, ≠-exclusion', () => {
	assert.equal(ek(["s=='paid'"], ["s in ['paid','refunded']"], 's'), 'yes', '{paid} ⊆ {paid,refunded}');
	assert.equal(ek(["s=='draft'"], ["s=='approved'"], 's'), 'no', 'the contradiction pair');
	assert.equal(ek(["s=='paid'"], ["s!='draft'"], 's'), 'yes', 'paid ≠ draft → satisfies the exclusion');
	assert.equal(ek(["s=='draft'"], ["s!='draft'"], 's'), 'no', 'draft violates s!=draft');
	assert.equal(C.entailsKey(undefined, K(["s=='approved'"], 's')), 'unknown', 'the UNDER-DETERMINED gap → escalate, never a false yes');
});

test('parseAtom refuses the out-of-fragment forms (never silently mis-parses)', () => {
	assert.equal(C.parseAtom("a=='x' || b=='y'").refuse, 'disjunction', 'disjunction left to escalation');
	assert.equal(C.parseAtom('total == limit').refuse, 'relational', 'a two-key compare is relational (bare rhs id)');
	assert.equal(C.parseAtom('f(x) > 0').refuse, 'function-call', 'a function call is out-of-fragment');
	// the accepted forms
	assert.deepEqual(C.parseAtom("status == 'paid'"), { key: 'status', op: '==', value: 'paid', int: undefined });
	assert.deepEqual(C.parseAtom('amount >= 10'), { key: 'amount', op: '>=', value: 10, int: true });
	assert.equal(C.parseAtom("k in ['a', 'b']").op, 'in', 'in-list parses');
});

test('checkCompose — the rubber-stamp NEGATIVE CONTROL: the contradiction pair must REFUSE at compose-time', () => {
	const draft = { name: 'M1', contract: { write: ['status'], post: ["status=='draft'"], effect: 'pure' } };
	const needsApproved = { name: 'M2', contract: { read: ['status'], pre: ["status=='approved'"], effect: 'pure' } };
	assert.equal(C.checkCompose(draft, needsApproved).verdict, 'unsound', 'draft↛approved caught BEFORE running (not deferred to runtime)');
	// flip M1's post → the SAME pair is now sound (proves it is not refusing everything)
	const approved = { name: 'M1', contract: { write: ['status'], post: ["status=='approved'"], effect: 'pure' } };
	assert.equal(C.checkCompose(approved, needsApproved).verdict, 'sound', 'approved→approved admits');
});

test('checkCompose — a real pipeline admits; a wider post is correctly REFUSED (the under-discharge)', () => {
	const norm = { name: 'Normalize', contract: { read: ['raw'], write: ['score'], post: ['score>=0 && score<=100'], effect: 'pure' } };
	const grade = { name: 'Grade', contract: { read: ['score'], pre: ['score>=0 && score<=100'], write: ['grade'], effect: 'pure' } };
	assert.equal(C.checkCompose(norm, grade).verdict, 'sound', '[0,100] ⊨ [0,100]');
	// negative control: a method whose post is WIDER than the consumer's pre is unsound (the discounted-total trap)
	const badNorm = { name: 'BadNormalize', contract: { read: ['raw'], write: ['score'], post: ['score>=0 && score<=200'], effect: 'pure' } };
	assert.equal(C.checkCompose(badNorm, grade).verdict, 'unsound', '[0,200] ⊄ [0,100] → caught');
});

test('checkCompose — out-of-fragment + the under-determined gap → ESCALATE (never false-sound)', () => {
	const m2 = { name: 'M2', contract: { read: ['s'], pre: ["s=='ok' || s=='warn'"], effect: 'pure' } };  // disjunction
	const m1 = { name: 'M1', contract: { write: ['s'], post: ["s=='ok'"], effect: 'pure' } };
	assert.equal(C.checkCompose(m1, m2).verdict, 'escalate', 'a disjunctive pre escalates to a micro-LLM open-box');
	// the under-determined gap: M1 WRITES the key M2 reads but its post leaves it unconstrained
	const m1free = { name: 'M1', contract: { write: ['s', 'x'], post: ["s=='set'"], effect: 'pure' } };
	const m2x = { name: 'M2', contract: { read: ['x'], pre: ['x>0'], effect: 'pure' } };
	assert.equal(C.checkCompose(m1free, m2x).verdict, 'escalate', 'post says nothing about x → escalate, not bless');
});

test('G2 — an effecting M1 post must be confirmed by a ground-truth ORACLE (the most dangerous hole)', () => {
	const ship = { name: 'Ship', contract: { write: ['shipped'], post: ['shipped==true'], effect: 'external' } };
	const notify = { name: 'Notify', contract: { read: ['shipped'], pre: ['shipped==true'], effect: 'internal' } };
	// NO oracle → escalate (a clean typed post on an external effect must NOT be silently blessed)
	assert.equal(C.checkCompose(ship, notify).verdict, 'escalate', 'effecting post without an oracle escalates');
	assert.ok(C.checkCompose(ship, notify).needsOracle, 'flagged as needing a ground-truth probe');
	// an oracle that CONFIRMS → sound; an oracle that DISAGREES → escalate
	assert.equal(C.checkCompose(ship, notify, { oracle: () => true }).verdict, 'sound', 'oracle confirms → compose');
	assert.equal(C.checkCompose(ship, notify, { oracle: () => false }).verdict, 'escalate', 'oracle disagrees → do not compose');
});

test('G3 — footprintCycles rejects a coupled retractable cycle, passes an acyclic chain (neg ctrl)', () => {
	// A writes k1 (B reads), B writes k2 (A reads) → a 2-cycle of retractable methods → oscillation risk
	const A = { name: 'A', contract: { read: ['k2'], write: ['k1'], effect: 'internal' } };
	const B = { name: 'B', contract: { read: ['k1'], write: ['k2'], effect: 'internal' } };
	const cyc = C.footprintCycles([A, B]);
	assert.equal(cyc.length, 1, 'the A↔B cycle is detected');
	assert.deepEqual(cyc[0].sort(), ['A', 'B']);
	// negative control: an acyclic chain A→B (B reads what A writes, no back-edge) → no cycle
	const B2 = { name: 'B', contract: { read: ['k1'], write: ['k3'], effect: 'internal' } };
	assert.equal(C.footprintCycles([A, B2]).length, 0, 'an acyclic chain is fine');
	// a cycle of PURE methods is not retractable → not rejected (pure recompute terminates)
	const Ap = { name: 'A', contract: { read: ['k2'], write: ['k1'], effect: 'pure' } };
	const Bp = { name: 'B', contract: { read: ['k1'], write: ['k2'], effect: 'pure' } };
	assert.equal(C.footprintCycles([Ap, Bp]).length, 0, 'a pure cycle is not flagged');
});

test('assertPost — G1 frame-completeness catches an UNDECLARED write (the silent frame hole)', () => {
	const contract = { write: ['total'], post: ['total>=0'], effect: 'pure' };
	// the body touched `inventory` — a key NOT in its declared write-footprint (an under-declared frame)
	const r = C.assertPost(contract, { total: 50, inventory: 9 }, ['total', 'inventory']);
	assert.equal(r.ok, false, 'an undeclared write fails the frame check');
	assert.ok(r.violations.some(( v ) => v.kind === 'undeclared-write' && v.detail === 'inventory'), 'blames the undeclared key');
	// negative control: only the declared key touched → ok
	assert.equal(C.assertPost(contract, { total: 50 }, ['total']).ok, true, 'a declared-only write passes');
});

test('assertPost — a violated INDUCED post fires blame; a holding post is ok', () => {
	const contract = { write: ['eta'], post: ['eta<=2'], effect: 'pure' };
	assert.equal(C.assertPost(contract, { eta: 2 }, ['eta']).ok, true, 'post holds on the case');
	const bad = C.assertPost(contract, { eta: 7 }, ['eta']);   // the international case the domestic-trained post mis-claims
	assert.equal(bad.ok, false, 'a wrong learned post is caught at settle');
	assert.equal(bad.blame.kind, 'post-violated', 'blame attributed to the post');
});

test('assertPost — G2: an external-effect post is NOT trusted on the internal fact (oracle required)', () => {
	const contract = { write: ['refund'], post: ["refund=='completed'"], effect: 'external' };
	const facts = { refund: 'completed' };                      // the internal fact says success...
	assert.equal(C.assertPost(contract, facts, ['refund']).ok, false, 'no oracle → effecting post unverified');
	// ...but a held-out ORACLE disagrees (a chargeback already reversed the charge) → blame, not a silent pass
	const dis = C.assertPost(contract, facts, ['refund'], { oracle: () => false });
	assert.ok(dis.violations.some(( v ) => v.kind === 'oracle-disagrees' ), 'the oracle catches what the internal post cannot');
	assert.equal(C.assertPost(contract, facts, ['refund'], { oracle: () => true }).ok, true, 'oracle confirms → ok');
});

test('reviseOnBlame — a violated post SPECIALIZES the precondition (CEGIS), it does not remove the method', () => {
	const contract = { read: ['dest'], write: ['eta'], pre: [], post: ['eta<=2'], effect: 'pure' };
	const revised = C.reviseOnBlame(contract, { key: 'dest', value: 'international' });
	assert.ok(revised.pre.includes("$dest!='international'"), 'the failing case is excluded from applicability');
	assert.ok(revised.read.includes('dest'), 'the discriminating key joins the read-footprint');
	assert.deepEqual(contract.pre, [], 'the original contract is not mutated (a new version)');
});

test('satisfies + reviseOnBlame CLOSE the un-learn loop: the revised pre excludes the failing case, admits others', () => {
	const contract = { read: ['score'], write: ['decision'], pre: ['score>=700'], post: ["decision=='approve'"], effect: 'internal' };
	// before: a EU app and a US app (both score 720) are BOTH admitted by the over-general pre
	assert.equal(C.satisfies(contract.pre, { score: 720, region: 'EU' }), true, 'EU admitted before revision');
	assert.equal(C.satisfies(contract.pre, { score: 720, region: 'US' }), true, 'US admitted before revision');
	// a EU case failed (non-compliant) → revise the pre with the discriminating fact
	const revised = C.reviseOnBlame(contract, { key: 'region', value: 'EU' });
	// after: EU is EXCLUDED (the library un-learned the over-general claim) but US still ADMITTED (surgical, not removal)
	assert.equal(C.satisfies(revised.pre, { score: 720, region: 'EU' }), false, 'EU now excluded (un-learned)');
	assert.equal(C.satisfies(revised.pre, { score: 720, region: 'US' }), true, 'US still admitted (not over-retracted)');
	// negative control: a low score is excluded by the original gate regardless
	assert.equal(C.satisfies(revised.pre, { score: 650, region: 'US' }), false, 'the original score gate still holds');
});

test('acceptRate — the MEASURED typed-coverage fraction (refuse-everything does not trivially pass)', () => {
	const r = C.acceptRate(['sound', 'sound', 'escalate', 'unsound', 'sound']);
	assert.equal(r.sound, 3); assert.equal(r.escalate, 1); assert.equal(r.unsound, 1); assert.equal(r.n, 5);
	assert.equal(r.rate, 0.6, 'the coverage fraction is reported, not assumed');
});
