'use strict';
/**
 * Concept-apply trace instrumentation: cfg.onConceptApply(record) fires once per
 * (concept apply -> mutation) with { rev, conceptId, conceptName, targetId, kind,
 * patch, ms, why }. Host-initiated mutations (no apply context) must NOT emit.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../../_lab/_boot.js');
const { register, createLLMProvider } = require('../../providers');
console.log = console.info = console.warn = () => {};

test('onConceptApply fires per concept-apply with attribution + why; host mutations do not', async () => {
	Graph._providers = {
		AI: { work(graph, concept, scope, argz, cb) { cb(null, { $_id: '_parent', Worked: true, result: 7 }); } }
	};
	const conceptMap = {
		common: {
			childConcepts: {
				Flag: { _id: 'Flag', _name: 'Flag', require: 'Segment' },                       // default branch
				Worked: { _id: 'Worked', _name: 'Worked', require: 'Segment', provider: ['AI::work'] } // provider branch
			}
		}
	};
	const seed = { lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }], segments: [{ _id: 's', originNode: 'a', targetNode: 'b' }] };

	const records = [];
	const g = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('trace test timed out')), 15000);
		let done = false;
		const graph = new Graph(seed, {
			label: 'trace', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onConceptApply(rec) { records.push(rec); },
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(graph); }
		}, conceptMap);
	});

	const flag = records.find((r) => r.conceptName === 'Flag');
	const worked = records.find((r) => r.conceptName === 'Worked');

	assert.ok(flag, 'a record was emitted for the default-branch concept Flag');
	assert.equal(flag.targetId, 's', 'attributed to the segment');
	assert.equal(flag.kind, 'default', 'kind = default');
	assert.equal(typeof flag.rev, 'number', 'carries the rev the patch landed in');
	assert.ok(Array.isArray(flag.patch) && JSON.stringify(flag.patch).includes('Flag'), 'patch is the applied mutation');
	assert.ok(Array.isArray(flag.why) && flag.why[0].require === 'Segment', 'why lists the resolved require');
	assert.ok(flag.why[0].value, 'why records the require value');

	assert.ok(worked, 'a record was emitted for the provider-branch concept Worked');
	assert.equal(worked.kind, 'provider', 'kind = provider');
	assert.ok(JSON.stringify(worked.patch).includes('result'), 'provider patch captured');
	assert.equal(typeof worked.ms, 'number', 'timing captured');

	// host-initiated mutation must NOT produce a trace record
	const before = records.length;
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('host-mutation stabilize timed out')), 10000);
		g.on('stabilize', function once() { g.un('stabilize', once); clearTimeout(timer); resolve(); });
		g.pushMutation({ $$_id: 's', note: 'host' }, 's');
		if (!g._running) g._taskFlow.run();
	});
	assert.equal(records.length, before, 'host pushMutation emitted no concept-apply record');
	assert.equal(g._objById['s']._etty._.note, 'host', 'host mutation still applied');
});

test('the bundled LLM provider reports prompt + reply into the trace record', async () => {
	register(Graph, [createLLMProvider({ ask: async () => 'reasoning... {"atomic": false}' })]);
	const conceptMap = {
		common: {
			childConcepts: {
				Classify: {
					_id: 'Classify', _name: 'Classify', require: 'Segment', provider: ['LLM::complete'],
					prompt: { system: 'You judge.', user: 'Step: ${label}', json: true }
				}
			}
		}
	};
	const seed = { lastRev: 0, nodes: [{ _id: 'a' }, { _id: 'b' }], segments: [{ _id: 's', originNode: 'a', targetNode: 'b', label: 'recon AD' }] };

	const records = [];
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('llm trace test timed out')), 15000);
		let done = false;
		new Graph(seed, {
			label: 'trace-llm', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {},
			onConceptApply(rec) { records.push(rec); },
			onStabilize() { if (done) return; done = true; clearTimeout(timer); resolve(); }
		}, conceptMap);
	});

	const rec = records.find((r) => r.conceptName === 'Classify');
	assert.ok(rec, 'Classify apply traced');
	assert.equal(rec.kind, 'provider');
	assert.ok(rec.prompt, 'prompt captured from the provider');
	assert.equal(rec.prompt.user, 'Step: recon AD', 'prompt user interpolated from scope');
	assert.equal(rec.prompt.system, 'You judge.');
	assert.ok(rec.reply.includes('atomic'), 'raw reply captured');
	assert.equal(rec.patch[0].atomic, false, 'parsed JSON landed as a fact in the patch');
});
