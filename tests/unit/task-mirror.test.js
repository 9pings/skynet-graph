'use strict';
/**
 * task-mirror — the graph plan DRIVES the host agent's native task list (owner 2026-07-10: "l'instance devrait
 * générer les tool calls pour gérer les task lists client"). MCP is host→server, so the correct realization is a
 * TYPED DELTA the host applies verbatim: `diffPlanToTaskOps(plan, mirror)` → neutral ops (create/update/complete/
 * reopen) + the new mirror. Deterministic, pure. The JTMS differentiator: a retracted step whose task was completed
 * emits `reopen` with the drift reason — no host task system does that on its own.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diffPlanToTaskOps } = require('../../lib/authoring/task-mirror.js');
const { defaultTools } = require('../../lib/sg/mcp.js');

const P = ( steps ) => ({ steps });

test('first sync — every step becomes a create, blockedBy = its still-open needs, deterministic order', () => {
	const { ops, mirror } = diffPlanToTaskOps(P([
		{ id: 's2', title: 'assemble', needs: ['s1'], status: 'open' },
		{ id: 's1', title: 'fetch', needs: [], status: 'open' }
	]), null);
	assert.deepEqual(ops, [
		{ op: 'create', id: 's1', subject: 'fetch', blockedBy: [] },
		{ op: 'create', id: 's2', subject: 'assemble', blockedBy: ['s1'] }
	], 'ordered by id, deps mapped to blockedBy');
	assert.equal(mirror.tasks.s1.status, 'open');
});

test('progress sync — a step gone done emits complete; an unchanged step emits NOTHING (idempotent)', () => {
	const first = diffPlanToTaskOps(P([{ id: 's1', title: 'fetch', needs: [], status: 'open' }]), null);
	const { ops } = diffPlanToTaskOps(P([{ id: 's1', title: 'fetch', needs: [], status: 'done' }]), first.mirror);
	assert.deepEqual(ops, [{ op: 'complete', id: 's1' }]);
	const again = diffPlanToTaskOps(P([{ id: 's1', title: 'fetch', needs: [], status: 'done' }]),
		diffPlanToTaskOps(P([{ id: 's1', title: 'fetch', needs: [], status: 'done' }]), first.mirror).mirror);
	assert.deepEqual(again.ops, [], 'same state twice → empty delta');
});

test('JTMS reopen — a completed task whose step RETRACTS emits reopen with the reason', () => {
	let m = diffPlanToTaskOps(P([{ id: 's1', title: 'fetch', needs: [], status: 'done' }]), null).mirror;
	const { ops } = diffPlanToTaskOps(P([{ id: 's1', title: 'fetch', needs: [], status: 'retracted', reason: 'premise IN.temp drifted' }]), m);
	assert.deepEqual(ops, [{ op: 'reopen', id: 's1', reason: 'premise IN.temp drifted' }]);
});

test('title change emits update; a step VANISHED from the plan emits nothing (the mirror keeps it, host decides)', () => {
	let m = diffPlanToTaskOps(P([{ id: 's1', title: 'fetch', needs: [], status: 'open' }, { id: 's2', title: 'x', needs: [], status: 'open' }]), null).mirror;
	const { ops } = diffPlanToTaskOps(P([{ id: 's1', title: 'fetch the catalog', needs: [], status: 'open' }]), m);
	assert.deepEqual(ops, [{ op: 'update', id: 's1', subject: 'fetch the catalog' }]);
});

test('plan_sync MCP tool — wired on w.plan.snapshot, holds the mirror across calls, reset resends all', async () => {
	let plan = P([{ id: 's1', title: 'fetch', needs: [], status: 'open' }]);
	const tools = defaultTools({ plan: { snapshot: () => plan } });
	const t = tools.find(( x ) => x.name === 'plan_sync');
	assert.ok(t, 'plan_sync appears when w.plan is wired');
	assert.match(t.description, /apply|native task|verbatim/i, 'the description tells the host to apply ops to its own task system');
	const r1 = await t.call({});
	assert.equal(r1.taskOps[0].op, 'create');
	plan = P([{ id: 's1', title: 'fetch', needs: [], status: 'done' }]);
	const r2 = await t.call({});
	assert.deepEqual(r2.taskOps, [{ op: 'complete', id: 's1' }], 'the held mirror makes the second sync a delta');
	const r3 = await t.call({ reset: true });
	assert.equal(r3.taskOps[0].op, 'create', 'reset resends the full state');
});
