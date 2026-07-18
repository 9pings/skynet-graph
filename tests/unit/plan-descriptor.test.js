'use strict';
/**
 * R9 — the `plan` ROADMAP instance-type descriptor (plugins/planner/descriptor.js): a named
 * persistent plan agents grow/complete over days; plan_sync becomes the `sync` ACTION (task-mirror
 * reused verbatim); the C7 needs invariant guards the door.
 *
 * PRE-REGISTERED BARS:
 *  GO        create(task, steps wired by needs) → snapshot exposes the FRONTIER (open steps whose
 *            needs are all done) → addSteps grows the plan → complete moves the frontier → sync
 *            emits create/complete ops against a null mirror, and the fed-back mirror makes the
 *            second sync EMPTY (idempotent) → reopen emits the `reopen` op with its reason.
 *  NEGATIVE  a step needing what nobody produces = the WHOLE batch refused, typed + NAMED (both
 *            at create — throw — and at addSteps — {refused, reason} through the runner);
 *            duplicate id refused; complete/reopen on wrong status refused with the actual status.
 *  BY        steps carry their writer (runner-stamped); a complete overwrites `by` on the fact
 *            (last-writer policy — history lives in the atoms).
 *  DETERM    the GO scenario re-run yields byte-identical snapshots.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPlugin, resolvePlugins } = require('../../lib/plugins/index.js');
const { validateDescriptor, createInstance, runAction } = require('../../lib/plugins/descriptor.js');

const PLANNER_DIR = path.join(__dirname, '..', '..', 'plugins', 'planner');
const d = loadPlugin(PLANNER_DIR).descriptor;

const SEED = { task: 'Ship the launch demo', steps: [
	{ id: 'record', title: 'Record the demo film', needs: ['script'] },
	{ id: 'script', title: 'Write the demo script' },
	{ id: 'post', title: 'Post on r/LocalLLaMA', needs: ['record'] }
] };
const boot = () => createInstance(d, { seed: SEED, conceptMap: {}, label: 'plan-test' });

test('the planner plugin ships the descriptor; it validates; resolvePlugins claims type `plan`', () => {
	assert.ok(d, 'entrypoints.descriptor loaded');
	assert.equal(d.type, 'plan');
	assert.equal(validateDescriptor(d), d);
	const resolved = resolvePlugins([loadPlugin(PLANNER_DIR)]);
	assert.ok(resolved.descriptors && resolved.descriptors.plan, 'resolvePlugins collects the plan type');
});

test('GO: frontier → addSteps → complete moves it → sync ops + idempotent mirror → reopen op', async () => {
	const inst = await boot();
	const g = inst.graph;

	const s1 = await runAction(g, d, 'snapshot', {}, {});
	assert.deepEqual(s1.frontier, ['script'], 'only the needs-free step is actionable');
	assert.deepEqual(s1.counts, { open: 3, done: 0 });

	// day 2: the plan grows (needs may point at EXISTING steps)
	const add = await runAction(g, d, 'addSteps', { steps: [{ id: 'thumb', title: 'Cut a thumbnail', needs: ['record'] }] }, { agent: 'agentB' });
	assert.equal(add.ok, true);

	await runAction(g, d, 'complete', { step: 'script' }, { agent: 'agentA' });
	const s2 = await runAction(g, d, 'snapshot', {}, {});
	assert.deepEqual(s2.frontier, ['record'], 'completing the need OPENS the dependent step');
	assert.equal(s2.steps.find(( s ) => s.id === 'script' ).status, 'done');

	// sync against a null mirror: full create set + the complete; feeding the mirror back = EMPTY delta
	const m1 = await runAction(g, d, 'sync', {}, {});
	assert.equal(m1.ops.filter(( o ) => o.op === 'create' ).length, 4, 'every step mirrored');
	assert.ok(m1.ops.some(( o ) => o.op === 'complete' && o.id === 'script' ));
	const rec = m1.ops.find(( o ) => o.op === 'create' && o.id === 'record' );
	assert.deepEqual(rec.blockedBy, [], 'a done need no longer blocks');
	const m2 = await runAction(g, d, 'sync', { mirror: m1.mirror }, {});
	assert.deepEqual(m2.ops, [], 'same state twice = empty delta (idempotent)');

	// the JTMS-style lane: reopen emits the op no host does natively
	await runAction(g, d, 'reopen', { step: 'script' }, { agent: 'agentC' });
	const m3 = await runAction(g, d, 'sync', { mirror: m2.mirror }, {});
	assert.deepEqual(m3.ops.map(( o ) => [o.op, o.id] ), [['reopen', 'script']]);
	assert.match(m3.ops[0].reason, /premise drifted|reopened/);

	// BY: last-writer at the door; the atoms keep the history (instances_revisions names authors)
	const s3 = await runAction(g, d, 'snapshot', {}, {});
	assert.equal(s3.steps.find(( s ) => s.id === 'thumb' ).by, 'agentB');
	assert.equal(s3.steps.find(( s ) => s.id === 'script' ).by, 'agentC', 'the reopen is the last write on the fact');
	g.destroy();
});

test('NEGATIVE: needs-nobody-produces refuses the WHOLE batch, typed + NAMED — create throws, addSteps refuses as data', async () => {
	assert.throws(() => d.create({ task: 't', steps: [{ id: 'a', title: 'A', needs: ['ghost'] }] }),
		/needs nobody produces: a needs "ghost"/, 'create names the hole');

	const inst = await boot();
	const r = await runAction(inst.graph, d, 'addSteps', { steps: [
		{ id: 'ok', title: 'fine' },
		{ id: 'bad', title: 'broken', needs: ['nowhere'] }
	] }, { agent: 'A' });
	assert.equal(r.refused, true);
	assert.match(r.reason, /bad needs "nowhere"/, 'the refusal NAMES step and need');
	const s = await runAction(inst.graph, d, 'snapshot', {}, {});
	assert.ok(!s.steps.some(( x ) => x.id === 'ok' ), 'the WHOLE batch is refused — no partial write');

	const dup = await runAction(inst.graph, d, 'addSteps', { steps: [{ id: 'script', title: 'again' }] }, { agent: 'A' });
	assert.match(dup.reason, /duplicate step id "script"/);
	inst.graph.destroy();
});

test('NEGATIVE: status transitions are guarded and name the actual status; unknown step named', async () => {
	const inst = await boot();
	const g = inst.graph;
	assert.match((await runAction(g, d, 'complete', { step: 'ghost' }, { agent: 'A' })).reason, /unknown step "ghost"/);
	assert.match((await runAction(g, d, 'reopen', { step: 'script' }, { agent: 'A' })).reason, /is open, not done/);
	await runAction(g, d, 'complete', { step: 'script' }, { agent: 'A' });
	assert.match((await runAction(g, d, 'complete', { step: 'script' }, { agent: 'A' })).reason, /is done, not open/);
	g.destroy();
});

test('DETERMINISM: the GO scenario re-run yields byte-identical snapshots', async () => {
	async function scenario() {
		const inst = await boot();
		await runAction(inst.graph, d, 'addSteps', { steps: [{ id: 'thumb', title: 'Cut a thumbnail', needs: ['record'] }] }, { agent: 'B' });
		await runAction(inst.graph, d, 'complete', { step: 'script' }, { agent: 'A' });
		const out = JSON.stringify(await runAction(inst.graph, d, 'snapshot', {}, {}));
		inst.graph.destroy();
		return out;
	}
	assert.equal(await scenario(), await scenario());
});
