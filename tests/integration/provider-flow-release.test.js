'use strict';
/*
 * Regression: a provider's flow.wait() must be released on EVERY outcome — a mutation, NO mutation
 * (idempotent skip), or an error-only callback. Releasing only inside the `r && pushMutation` callback
 * leaked the lock when the provider returned no mutation, wedging the stabilize loop forever
 * (`_stabilizing` stuck true). (Bug P2; fixed in Concept.applyTo with releaseFlow().)
 */
const test = require('node:test');
const assert = require('node:assert');
const Graph = require('../_boot.js');
const { nextStable } = require('../../lib/authoring/core/supervise.js');

function settleOrTimeout(g, ms) {
  return Promise.race([
    nextStable(g).then(() => false),
    new Promise((res) => setTimeout(() => res(true), ms)),
  ]);
}

function boot(label, providerCb) {
  // distinct provider namespace per case so sequential tests don't alias the closure
  const ns = 'FlowT_' + label;
  Graph._providers = Object.assign({}, Graph._providers, { [ns]: { go(graph, concept, scope, argz, cb) { providerCb(cb); } } });
  const seed = { lastRev: 0, nodes: [{ _id: 'n', trig: true }], segments: [] };
  const tree = { childConcepts: { Probe: { _id: 'Probe', _name: 'Probe', require: ['trig'], provider: [ns + '::go'] } } };
  // small applyCap so a deliberately self-flag-less provider terminates fast via the backstop instead of looping long
  return new Graph(seed, { label, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error', applyCap: 8 }, { common: tree });
}

test('provider returning a mutation settles (control)', async () => {
  const g = boot('mut', (cb) => cb(null, { $_id: '_parent', Probe: true, v: 1 }));
  assert.strictEqual(await settleOrTimeout(g, 3000), false, 'graph should settle');
  assert.strictEqual(g._stabilizing, false, '_stabilizing must be cleared');
});

test('provider returning NO mutation does not deadlock the stabilize loop (P2)', async () => {
  const g = boot('nullR', (cb) => cb(null, null));
  assert.strictEqual(await settleOrTimeout(g, 3000), false, 'no-mutation cb must release the flow (no deadlock)');
  assert.strictEqual(g._stabilizing, false, '_stabilizing must not be stuck true');
});

test('provider returning an error does not deadlock the stabilize loop (P2)', async () => {
  const g = boot('err', (cb) => cb(new Error('boom')));
  assert.strictEqual(await settleOrTimeout(g, 3000), false, 'error cb must release the flow (no deadlock)');
  assert.strictEqual(g._stabilizing, false, '_stabilizing must not be stuck true');
});
