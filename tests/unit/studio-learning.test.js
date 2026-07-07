'use strict';
/**
 * Studio LEARNING ops (track 4 — the LearningPanel's session surface). Deterministic, no browser:
 *   • declare → propose → ADMITTED through the gate (mergeRingProposals: member ∈ enum ∧ confluence),
 *     provenance-tagged 'studio';
 *   • a bad proposal is REJECTED with its reason (no such key / member not in enum / breaks confluence);
 *   • RETRACT = the recoverability guarantee: removal DE-LOCKS the corrected proposal;
 *   • export/import `.sgc kind:'lattice'`: an empty session ADOPTS the canon, a grown one merges THROUGH
 *     the same gate (a conflicting shipped ring is rejected, not merged);
 *   • providerTrace falls back to the SHARED logger when no graph is loaded (the `sg serve --studio` seam);
 *   • deleteConcept CASCADE (F4-b VERIFIED): deleting a live concept un-casts it from the objects.
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const { test } = require('node:test');
const assert = require('node:assert');
const Graph = require('../../lib/index.js');
const Session = require('../../lib/studio/session.js');
const { createLogger } = require('../../lib/graph/log.js');

test('learning — declare → propose → ADMITTED through the gate, provenance-tagged; the readout carries the rings', () => {
	const s = new Session('t1', { Graph });
	s.declareKey({ key: 'unit', enum: 'celsius, kelvin' });
	const r = s.proposeAlias({ key: 'unit', member: 'celsius', alias: 'centigrade' });
	assert.equal(r.admitted.length, 1, 'the alias went through the gate');
	assert.deepEqual(r.rings, [{ key: 'unit', member: 'celsius', alias: 'centigrade' }]);
	const reg = s.registry().registry;
	assert.equal(reg.ringProvenance['unit::centigrade'].via, 'studio', 'the admission is provenance-tagged');
	assert.notEqual(reg.version, 'v1', 'an admission bumps the registry version (the invalidation signal)');
});

test('learning — rejections carry their gate reason (no such key / member not in enum / breaks confluence)', () => {
	const s = new Session('t2', { Graph });
	s.declareKey({ key: 'unit', enum: ['celsius', 'kelvin'] });
	assert.match(s.proposeAlias({ key: 'nope', member: 'x', alias: 'y' }).rejected[0].reason, /no such enum key/);
	assert.match(s.proposeAlias({ key: 'unit', member: 'fahrenheit', alias: 'f' }).rejected[0].reason, /member not in the enum/);
	s.proposeAlias({ key: 'unit', member: 'celsius', alias: 'degrees' });
	const conflict = s.proposeAlias({ key: 'unit', member: 'kelvin', alias: 'degrees' });   // same alias, other member
	assert.match(conflict.rejected[0].reason, /breaks confluence/, 'first-writer-wins-under-confluence');
});

test('learning — RETRACT de-locks the corrected proposal (recoverability is the soundness guarantee)', () => {
	const s = new Session('t3', { Graph });
	s.declareKey({ key: 'sev', enum: ['low', 'high'] });
	s.proposeAlias({ key: 'sev', member: 'low', alias: 'catastrophic' });                     // the WRONG admission
	assert.equal(s.proposeAlias({ key: 'sev', member: 'high', alias: 'catastrophic' }).rejected.length, 1, 'blocked by the wrong ring');
	const rt = s.retractAlias({ key: 'sev', alias: 'catastrophic' });
	assert.equal(rt.retracted, true);
	assert.equal(rt.member, 'low', 'the retraction reports what the alias mapped to');
	const fixed = s.proposeAlias({ key: 'sev', member: 'high', alias: 'catastrophic' });
	assert.equal(fixed.admitted.length, 1, 'after retraction the CORRECT proposal is admissible');
});

test('learning — .sgc lattice round-trip: an empty session ADOPTS; a grown one merges THROUGH the gate', () => {
	const a = new Session('tA', { Graph });
	a.declareKey({ key: 'unit', enum: ['celsius', 'kelvin'] });
	a.proposeAlias({ key: 'unit', member: 'celsius', alias: 'centigrade' });
	const bundle = a.exportLattice({ name: 'demo' });
	assert.equal(bundle.kind, 'lattice');

	// empty session → ADOPT the packaged canon wholesale (its rings come along).
	const b = new Session('tB', { Graph });
	const rb = b.importLattice({ bundle });
	assert.equal(rb.adopted, true);
	assert.deepEqual(rb.rings, [{ key: 'unit', member: 'celsius', alias: 'centigrade' }]);

	// grown session with a CONFLICTING ring → the shipped alias is REJECTED by the same gate, not merged.
	const c = new Session('tC', { Graph });
	c.importLattice({ bundle: a.exportLattice({ name: 'base', version: bundle.manifest.version }) });
	c.proposeAlias({ key: 'unit', member: 'kelvin', alias: 'degc' });   // locks 'degc' → kelvin
	const conflicting = a.proposeAlias({ key: 'unit', member: 'celsius', alias: 'degc' });   // A maps degc → celsius
	assert.equal(conflicting.admitted.length, 1);
	const rc = c.importLattice({ bundle: a.exportLattice({ name: 'demo2', version: c.registry().registry.version }) });
	assert.ok(rc.rejected.some(( x ) => x.alias === 'degc' && /confluence/.test(x.reason)),
		'the conflicting shipped ring was rejected by the confluence gate');
});

test('learning — providerTrace falls back to the SHARED logger with no graph (the `sg serve --studio` seam)', () => {
	const logger = createLogger({ console: false, level: 'log' });
	logger.log('[frontier] what is the capital of France?');
	logger.log('[cache] what is the capital of France?');
	const s = new Session('t4', { Graph, logger });
	assert.equal(s.graph, null, 'no graph loaded');
	const recs = s.providerTrace(10);
	assert.equal(recs.length, 2, 'the shared ring buffer surfaces in the trace with zero extra wiring');
	assert.match(recs[1].msg, /\[cache\]/);
});

test('learning — deleteConcept CASCADE verified (F4-b): the deleted concept un-casts from live objects', async () => {
	const s = new Session('t5', { Graph });
	Graph._providers = {};
	s.loadCorpus({
		conceptMap: { common: { childConcepts: { Far: { _id: 'Far', _name: 'Far', require: 'Distance', assert: ['$Distance.inKm > 300'] } } } },
		seed: { lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }],
		        segments: [{ _id: 'seg', originNode: 'a', targetNode: 'b', Distance: { inKm: 400 } }] }
	});
	await new Promise(( res ) => s.once('state', res));   // first settle
	const cast = s.state().objects.find(( o ) => o._id === 'seg');
	assert.equal(cast.Far, true, 'the concept cast on the live segment');

	const settled = new Promise(( res ) => s.once('state', res));
	s.deleteConcept('Far');
	await settled;                                         // the cascade re-stabilizes
	const after = s.state().objects.find(( o ) => o._id === 'seg');
	assert.notEqual(after.Far, true, 'deleting the concept un-cast it from the object (cascade re-eval)');
	s._destroy();
});
