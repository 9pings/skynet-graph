'use strict';
/**
 * §6.4 WIDEN — the S-boundary CLIMB (candidate elimination, Mitchell 1982), the symmetric counterpart of the built
 * narrow loop (`reviseOnBlame` = the G-descent). Refined by the 2026-06-30 Laurie confront — five soundness lines,
 * each a discriminating neg-control:
 *   pt1  enum/observed UNION by default (a numeric HULL admits the unobserved gap → unsound under frozen elision);
 *        the hull is opt-in AND forces INSTANCE.
 *   pt2  the clamp is FREE if the widen is ADDITIVE: preserve every `!=` blame nogood; `normalize`'s `ne` excludes it.
 *   pt4  widen does NOT consume μ (a success ≠ a deopt); it has its OWN megamorphic WIDTH cap (PIC degradation).
 *   pt3  G2 fix = recordWiden demotes FROZEN→INSTANCE (so assertPost re-guards the newly-admitted cases).
 *   pt5  a positive must carry a methodId that GOVERNS the widened value (target ∪ siblings) — a cross-method
 *        positive (a §6.2 M_new success fed for M_donor) is REJECTED (no borrowing evidence across a contract boundary).
 * ZERO-CORE.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { widenOnVerified, satisfies } = require('../../lib/authoring/contract.js');
const { createMountController } = require('../../lib/authoring/mount.js');

const P = ( value, methodId ) => ({ value, methodId });

// ── pt1 / the S-climb: enum union of OBSERVED positives ──────────────────────────────────────────────────────
test('widenOnVerified — enum UNION of observed positives (the S-boundary climb); an unobserved value is NOT admitted', () => {
	const c = { read: ['region'], pre: ["$region in ['EU']"], write: ['x'], post: ['$x==true'], effect: 'pure' };
	const out = widenOnVerified(c, [P('US', 'M'), P('JP', 'M')], { discriminator: 'region', target: 'M' });
	assert.ok(satisfies(out.contract.pre, { region: 'EU' }) && satisfies(out.contract.pre, { region: 'US' }) && satisfies(out.contract.pre, { region: 'JP' }), 'EU∪US∪JP all admitted');
	assert.ok(!satisfies(out.contract.pre, { region: 'MX' }), 'an UNOBSERVED region is NOT admitted (observed-union, never a hull)');
	assert.ok(!out.forceInstance, 'an enum union does not force instance');
});

// ── pt2 / the free clamp: ADDITIVE widen preserves the `!=` blame nogood ──────────────────────────────────────
test('widenOnVerified — ADDITIVE: a surviving `!=` blame nogood is preserved → EU is NEVER re-admitted (never crosses G)', () => {
	// EU was blamed earlier (a `!=` nogood); a CONTRADICTORY positive {EU} now appears — G must win.
	const c = { read: ['region'], pre: ["$region in ['US']", "$region!='EU'"], effect: 'pure' };
	const out = widenOnVerified(c, [P('EU', 'M'), P('JP', 'M')], { discriminator: 'region', target: 'M' });
	assert.ok(!satisfies(out.contract.pre, { region: 'EU' }), 'the EU blame nogood is preserved — never re-admitted even though EU appeared in the positives');
	assert.ok(satisfies(out.contract.pre, { region: 'JP' }) && satisfies(out.contract.pre, { region: 'US' }), 'genuine positives (JP) + the prior allow (US) are admitted');
	assert.ok(out.clamped.indexOf('EU') >= 0, 'EU is reported as clamped by G');
});

// ── pt5 / method-identity: no borrowing evidence across a contract boundary (the §6.2 finding) ────────────────
test('widenOnVerified NEG — a positive from a DIFFERENT method (a §6.2 M_new success) is REJECTED for M_donor', () => {
	const cDonor = { read: ['region'], pre: ["$region in ['EU']"], effect: 'pure' };
	const out = widenOnVerified(cDonor, [P('JP', 'M_new')], { discriminator: 'region', target: 'M_donor' });
	assert.ok(!satisfies(out.contract.pre, { region: 'JP' }), 'M_donor is NOT widened to admit JP on the basis of a DIFFERENT method succeeding');
	assert.deepEqual(out.accepted, [], 'no positive accepted (method-identity mismatch)');
	assert.equal(out.rejected.length, 1, 'the cross-method positive is reported as rejected');
});

test('widenOnVerified — SIBLING-MERGE: bucket-siblings each verified on their OWN pre merge into one polymorphic method', () => {
	// two siblings M_EU (region==EU) and M_JP (region==JP); merge into M_EU admitting both (PIC-coalescing).
	const cEU = { read: ['region'], pre: ["$region in ['EU']"], effect: 'pure' };
	const out = widenOnVerified(cEU, [P('JP', 'M_JP')], { discriminator: 'region', target: 'M_EU', siblings: ['M_JP'] });
	assert.ok(satisfies(out.contract.pre, { region: 'EU' }) && satisfies(out.contract.pre, { region: 'JP' }), 'a declared sibling’s positive merges in (region in [EU,JP])');
});

// ── pt1 / numeric: observed-union default, hull is opt-in AND forces INSTANCE ─────────────────────────────────
test('widenOnVerified — numeric default is observed-UNION (not a hull): the gap is NOT admitted', () => {
	const c = { read: ['x'], pre: ['$x in [1]'], effect: 'pure' };
	const out = widenOnVerified(c, [P(3, 'M'), P(7, 'M')], { discriminator: 'x', target: 'M' });
	assert.ok(satisfies(out.contract.pre, { x: 3 }) && satisfies(out.contract.pre, { x: 7 }), 'observed values admitted');
	assert.ok(!satisfies(out.contract.pre, { x: 5 }), 'x=5 (an unobserved GAP point) is NOT admitted by default — the hull-unsoundness is avoided');
	assert.ok(!out.forceInstance);
});

test('widenOnVerified — numeric HULL is opt-in AND forces INSTANCE (assertPost must guard every gap point, else G2)', () => {
	const c = { read: ['x'], pre: ['$x in [1]'], effect: 'pure' };
	const out = widenOnVerified(c, [P(3, 'M'), P(7, 'M')], { discriminator: 'x', target: 'M', numeric: 'hull' });
	assert.ok(satisfies(out.contract.pre, { x: 5 }), 'the hull admits the gap [1,7]');
	assert.equal(out.forceInstance, true, 'a hull FORCES INSTANCE (never FROZEN) — assertPost guards every gap point');
});

// ── pt3 + pt4 / mount.recordWiden: demote FROZEN→INSTANCE; OWN width cap, NOT μ ───────────────────────────────
test('recordWiden — demotes FROZEN→INSTANCE (closes G2) and does NOT consume the deopt budget μ', () => {
	const ctl = createMountController();
	ctl.decide('M', { reliability: 0.9, hitRate: 0.95, depth: 1, readOnlyFrontier: true });   // → frozen
	assert.equal(ctl.regimeOf('M'), 'frozen');
	const muBefore = ctl.deoptBudget('M');
	ctl.recordWiden('M');
	assert.equal(ctl.regimeOf('M'), 'instance', 'a widen demotes FROZEN→INSTANCE (assertPost re-guards the newly-admitted cases)');
	assert.equal(ctl.deoptBudget('M'), muBefore, 'a widen (a SUCCESS) does NOT consume μ — that budget is for failures (deopts) only');
});

test('recordWiden NEG — sound widens with ZERO failures do NOT pin to ESCALATE via μ; the megamorphic WIDTH cap does', () => {
	const ctl = createMountController({ thresholds: { widenCap: 3 } });
	ctl.decide('M', { reliability: 0.2 });                          // instance
	ctl.recordWiden('M'); ctl.recordWiden('M');
	assert.notEqual(ctl.regimeOf('M'), 'escalate', '2 widens, zero failures → NOT escalated');
	assert.equal(ctl.deoptBudget('M'), ctl.thresholds.maxDeopt, 'μ fully intact (a widen charges no deopt)');
	ctl.recordWiden('M');                                          // hits widenCap=3 → megamorphic
	assert.equal(ctl.regimeOf('M'), 'escalate', 'the megamorphic WIDTH cap (not μ) escalates an over-widened method (PIC degradation)');
});
