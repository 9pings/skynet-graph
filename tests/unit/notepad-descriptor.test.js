'use strict';
/**
 * R1 — the TYPE DESCRIPTOR contract + its first type, `notepad` (plugins/notepad).
 *
 * A type descriptor is the single artifact that drives the instance-service dispatch (and, later,
 * the generated MCP tools): `{ type, version, conceptSets, concurrency, create(seed)->template,
 * actions: { <name>: { write, input, apply|project } }, projections }`. It ships in a plugin under
 * `entrypoints.descriptor` (loaded like factories: loadPlugin puts it on `pluginObj.descriptor`,
 * resolvePlugins collects `descriptors` keyed by type, one claimer per type).
 *
 * The reference consumer is `lib/plugins/descriptor.js`: `validateDescriptor` (fail-closed shape
 * check), `createInstance` (boot a Graph + apply create(seed) through the sequenced path), and
 * `runAction` (typed dispatch; a WRITE action's returned template is stamped `by: ctx.agent` by the
 * RUNNER — attribution is enforced at the door, never left to descriptor authors; R0 decision:
 * `by` = passenger fact, [ZERO-CORE]).
 *
 * GO bar (roadmap R1): note[agent=A] → note[agent=B] → recall shows both with `by`.
 * Negative (roadmap R1): an out-of-band note (outside the action door / outside the typed alphabet)
 * does NOT appear in recall.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPlugin } = require('../../lib/plugins/index.js');
const { resolvePlugins } = require('../../lib/plugins/index.js');
const { validateDescriptor, createInstance, runAction } = require('../../lib/plugins/descriptor.js');

const NOTEPAD_DIR = path.join(__dirname, '..', '..', 'plugins', 'notepad');

function bootPad(seed) {
	const pl = loadPlugin(NOTEPAD_DIR);
	return createInstance(pl.descriptor, { seed, conceptMap: pl.concepts, label: 'pad-test' });
}

test('the plugin ships the descriptor: loadPlugin -> pluginObj.descriptor, resolvePlugins -> descriptors by type', () => {
	const pl = loadPlugin(NOTEPAD_DIR);
	assert.ok(pl.descriptor, 'entrypoints.descriptor is loaded onto the plugin object');
	assert.equal(pl.descriptor.type, 'notepad');
	assert.equal(validateDescriptor(pl.descriptor), pl.descriptor, 'the shipped descriptor validates');
	const resolved = resolvePlugins([pl]);
	assert.ok(resolved.descriptors && resolved.descriptors.notepad, 'resolvePlugins collects descriptors keyed by type');
	assert.equal(resolved.descriptors.notepad.type, 'notepad');
});

test('GO bar: note[agent=A] -> note[agent=B] -> recall shows BOTH with `by` (stamped by the runner)', async () => {
	const pad = await bootPad({ title: 'groceries' });
	// the descriptor's own apply template does NOT set `by` — the runner stamps it (enforced attribution)
	const d = loadPlugin(NOTEPAD_DIR).descriptor;
	const rawTpl = d.actions.note.apply(pad.graph, { text: 'probe' });
	(Array.isArray(rawTpl) ? rawTpl : [rawTpl]).forEach(item =>
		assert.ok(!('by' in item), 'descriptor authors never hand-write `by` — the runner owns attribution'));

	await runAction(pad.graph, d, 'note', { text: 'sweet+salty works' }, { agent: 'agentA' });
	await runAction(pad.graph, d, 'note', { text: 'texture is the issue' }, { agent: 'agentB' });
	const out = await runAction(pad.graph, d, 'recall', {}, { agent: 'agentA' });
	assert.equal(out.notes.length, 2, 'both notes recalled');
	assert.deepEqual(out.notes.map(n => n.by), ['agentA', 'agentB'], 'each note carries its writer');
	assert.deepEqual(out.notes.map(n => n.text), ['sweet+salty works', 'texture is the issue'], 'insertion order kept');
	pad.graph.destroy();
});

test('NEGATIVE (roadmap R1): an out-of-band note does not appear in recall', async () => {
	const pad = await bootPad({ title: 'x' });
	const d = loadPlugin(NOTEPAD_DIR).descriptor;
	await runAction(pad.graph, d, 'note', { text: 'legit' }, { agent: 'agentA' });
	// out-of-band 1: a raw set() outside the door (the engine never rejects it — R0 N2 — but the
	// typed alphabet keeps it out of the projection)
	pad.graph.getEtty('pad').set('sneak', 'oob', pad.graph);
	// out-of-band 2: a direct mutation that does NOT speak the type's alphabet (no NoteEntry)
	await new Promise(res => { pad.graph.pushMutation([{ _id: 'rogue', text: 'rogue text' }], null); pad.graph.stabilize(res); });
	const out = await runAction(pad.graph, d, 'recall', {}, { agent: 'agentA' });
	assert.equal(out.notes.length, 1, 'only the through-the-door note is recalled');
	assert.equal(out.notes[0].text, 'legit');
	pad.graph.destroy();
});

test('dispatch is typed: unknown action -> typed refusal (never a throw, never a silent no-op)', async () => {
	const pad = await bootPad({});
	const d = loadPlugin(NOTEPAD_DIR).descriptor;
	const r = await runAction(pad.graph, d, 'obliterate', {}, { agent: 'agentA' });
	assert.equal(r.refused, true);
	assert.match(r.reason, /unknown action/i);
	assert.ok(r.known.includes('note') && r.known.includes('recall'), 'the refusal names the known actions');
	pad.graph.destroy();
});

test('validateDescriptor is fail-closed: a write action without apply / a read action without project are rejected', () => {
	assert.throws(() => validateDescriptor({ type: 'x', version: '1.0.0', actions: { a: { write: true } } }),
		/write action .*apply/i, 'write action must carry apply');
	assert.throws(() => validateDescriptor({ type: 'x', version: '1.0.0', actions: { a: { write: false } } }),
		/read action .*project/i, 'read action must carry project');
	assert.throws(() => validateDescriptor({ version: '1.0.0', actions: {} }), /type/i, 'type is required');
	assert.throws(() => validateDescriptor({ type: 'x', actions: {} }), /version/i, 'version is required');
});

test('determinism: the GO scenario re-run yields byte-identical recall', async () => {
	async function scenario() {
		const pad = await bootPad({ title: 't' });
		const d = loadPlugin(NOTEPAD_DIR).descriptor;
		await runAction(pad.graph, d, 'note', { text: 'a' }, { agent: 'A' });
		await runAction(pad.graph, d, 'note', { text: 'b' }, { agent: 'B' });
		const out = await runAction(pad.graph, d, 'recall', {}, { agent: 'A' });
		pad.graph.destroy();
		return JSON.stringify(out);
	}
	assert.equal(await scenario(), await scenario());
});
