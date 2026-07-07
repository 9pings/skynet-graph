'use strict';
/**
 * C0 back-check DEPTH (roadmap FINIR F5 — closes the pending "back-check depth" implementation):
 * `makeProseBackCheck` = the ready-made INDEPENDENT verifier of a typed projection vs its source prose,
 * pluggable into createIntake({ backCheck }). Locks in:
 *   • pass — a faithful projection is certified 'pass';
 *   • fail + BLAME — an unfaithful one is 'fail' and the judged-wrong KEYS reach onBlame (localized, not
 *     just a global veto);
 *   • unverifiable → 'fail' (a garbled verdict never certifies);
 *   • no prose → ABSTAIN (undefined — never veto blind);
 *   • independence discipline: the checker sees prose + facts, and is a SEPARATE call (own ask fn);
 *   • wired through createIntake: a 'fail' downgrades the intake to `untyped` (Invariant 2 holds).
 */
global.__SERVER__ = true;
const { test } = require('node:test');
const assert = require('node:assert');
const { makeProseBackCheck } = require('../../lib/providers/intake.js');

const scopeWith = ( prose ) => ({ _: { prose } });

test('backcheck — faithful projection → pass (the checker is an independent call)', async () => {
	let seen = null;
	const bc = makeProseBackCheck({ ask: async ( m ) => { seen = m; return '{"faithful": true, "wrong": []}'; } });
	const v = await bc(null, null, scopeWith('the pump pressure is critical'), { severity: 'critical' });
	assert.equal(v, 'pass');
	assert.match(seen.system, /strict verifier/i);
	assert.match(seen.user, /PROSE: the pump pressure is critical/);
	assert.match(seen.user, /"severity":"critical"/, 'the checker sees BOTH the prose and the typed facts');
});

test('backcheck — unfaithful → fail + the wrong KEYS reach onBlame (localized blame)', async () => {
	let blamed = null;
	const bc = makeProseBackCheck({
		ask: async () => '{"faithful": false, "wrong": ["severity"]}',
		onBlame: ( keys ) => { blamed = keys; }
	});
	const v = await bc(null, null, scopeWith('all nominal today'), { severity: 'critical' });
	assert.equal(v, 'fail');
	assert.deepEqual(blamed, ['severity'], 'blame names WHICH key to re-extract');
});

test('backcheck — an unverifiable verdict never certifies (garbled reply → fail)', async () => {
	const bc = makeProseBackCheck({ ask: async () => 'hmm, looks fine to me' });
	assert.equal(await bc(null, null, scopeWith('x'), { a: 1 }), 'fail');
});

test('backcheck — no prose found → ABSTAIN (undefined), and proseOf overrides the source', async () => {
	const bc = makeProseBackCheck({ ask: async () => '{"faithful": true}' });
	assert.equal(await bc(null, null, { _: {} }, { a: 1 }), undefined, 'never veto blind');
	const custom = makeProseBackCheck({ ask: async ( m ) => /custom prose/.test(m.user) ? '{"faithful": true, "wrong": []}' : '{"faithful": false}',
	                                    proseOf: ( scope ) => scope._.inbound });
	assert.equal(await custom(null, null, { _: { inbound: 'custom prose here' } }, {}), 'pass');
});

test('backcheck — guard: needs an ask', () => {
	assert.throws(() => makeProseBackCheck({}), /needs opts\.ask/);
});
