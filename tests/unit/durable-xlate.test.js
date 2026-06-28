'use strict';
/**
 * C-xlate v0 (pure): compile a method spec → a workflow-net def, and the structural lint. Negative controls:
 * the lint flags a dangling place + a duplicate `from`; compileMethod throws on a route to an unknown method.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileMethod, validateNet, indexByFrom } = require('../../lib/durable/xlate.js');
const { spec } = require('../../examples/poc/durable-flow.js');

test('compileMethod emits a sound net for the Brick-1/3 select+task+map spec', () => {
	const net = compileMethod(spec);
	assert.equal(net.start, 'start');
	assert.deepEqual(net.sinks, ['done']);
	assert.equal(validateNet(net).length, 0, 'the compiled net is structurally sound');

	const byFrom = indexByFrom(net);
	assert.equal(byFrom['start'].kind, 'select', 'start routes via a select');
	const gateTargets = byFrom['start'].gates.map(( g ) => g.to);
	assert.ok(gateTargets.includes('@mapRoute') && gateTargets.includes('@foldRoute'), 'gates route to the method in-places');
	assert.equal(byFrom['start'].fallback, '@micro', 'no-match falls back to the micro method');

	// the map route: classify task → a map transition fanning to a per-element body.
	assert.equal(byFrom['@mapRoute'].kind, 'task', 'mapRoute begins with the classify step');
	const mapT = net.transitions.find(( t ) => t.kind === 'map');
	assert.ok(mapT && mapT.over === 'coll' && mapT.elemKey === 'elem', 'the map transition fans out over `coll`');
});

test('validateNet flags a dangling target place (negative control)', () => {
	const bad = { start: 'start', sinks: ['done'], fail: 'failed', transitions: [
		{ id: 't', from: 'start', kind: 'task', task: 'X::y', to: 'nowhere' },   // 'nowhere' has no outgoing transition
	] };
	const issues = validateNet(bad);
	assert.ok(issues.some(( i ) => i.includes('nowhere')), 'a token-stranding dangling place is caught');
});

test('validateNet flags two transitions leaving one place (1-out invariant)', () => {
	const bad = { start: 'start', sinks: ['done'], fail: 'failed', transitions: [
		{ id: 'a', from: 'start', kind: 'task', task: 'X::y', to: 'done' },
		{ id: 'b', from: 'start', kind: 'task', task: 'X::z', to: 'done' },
	] };
	assert.ok(validateNet(bad).some(( i ) => i.includes('two transitions')), 'a non-1-out place is caught');
});

test('compileMethod throws on a select rule routing to an unknown method (negative control)', () => {
	assert.throws(() => compileMethod({ select: { rules: [{ when: '$k==1', method: 'ghost' }] }, methods: { real: { steps: [{ task: 'X::y' }] } } }),
		/unknown method "ghost"/);
});
