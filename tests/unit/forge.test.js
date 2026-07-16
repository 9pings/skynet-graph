'use strict';
// forge (M3) — the stock FABRICATION pipeline, promoted from the WikiSQL pilot into a tested brick:
// class-grouped adapted corpus -> per class: forge decomposition -> engine trace -> crystallize ->
// GOLD-GATE -> packStock -> .sgc + a VALIDATION DOSSIER (the certification asset). Tested deterministically
// (gold-forge stub, GPU-free): the pipeline admits the gold-consistent classes, packs a reloadable .sgc,
// the neg-control (a deliberately wrong shape) is REJECTED, and the dossier reports it all with 0 false
// admitted. The --live path (the real embedded model as the forge) is exercised separately.
const test = require('node:test');
const assert = require('node:assert');
const { forgeStock } = require('../../plugins/forge/combo.js');

// a tiny adapted corpus: three classes, each rec already carries its gold typed-step shape.
const CLASSES = {
	'select|0': [{ problem: 'what position does X play', goldSteps: ['select'] }, { problem: 'what team is Y on', goldSteps: ['select'] }],
	'select|1': [{ problem: 'position of X on team T', goldSteps: ['filter', 'select'] }, { problem: 'team of Y in year Z', goldSteps: ['filter', 'select'] }],
	'count|1':  [{ problem: 'how many players on team T', goldSteps: ['filter', 'aggregate', 'select'] }, { problem: 'number of games in year Z', goldSteps: ['filter', 'aggregate', 'select'] }]
};
const STEP_ENUM = ['filter', 'aggregate', 'select'];

test('forge (deterministic) — every gold-consistent class is admitted; the stock packs to a reloadable .sgc', async () => {
	const r = await forgeStock({ classes: CLASSES, stepEnum: STEP_ENUM, name: 'demo-stock', version: 'v1', negControl: false });
	assert.equal(r.verdict.attempted, 3);
	assert.equal(r.verdict.admitted, 3, 'all three gold-consistent classes admitted by the gate');
	assert.equal(r.verdict.falseAdmitted, 0, 'the gate never admits a shape != gold');
	assert.equal(r.bundle.kind, 'methods', 'a .sgc methods stock is produced');
	assert.equal(r.verdict.packed, 3, 'the .sgc carries the admitted methods');
	assert.equal(r.verdict.reloaded, 3, 'a fresh library reloads them (cross-deployment ship-ability)');
	assert.equal(r.verdict.pass, true);
});

test('forge (deterministic) — the neg-control (a corrupted shape) is REJECTED by the gold-gate (non-vacuous)', async () => {
	const r = await forgeStock({ classes: CLASSES, stepEnum: STEP_ENUM, name: 'demo-stock', version: 'v1', negControl: true });
	assert.equal(r.dossier.soundness.negControl.ran, true);
	assert.equal(r.dossier.soundness.negControl.rejected, true, 'a deliberately wrong shape did NOT get admitted');
});

test('forge — the VALIDATION DOSSIER is a complete, structured certification record', async () => {
	const r = await forgeStock({ classes: CLASSES, stepEnum: STEP_ENUM, name: 'demo-stock', version: 'v1', dataset: 'demo-corpus', negControl: true });
	const d = r.dossier;
	assert.equal(d.dataset.name, 'demo-corpus');
	assert.equal(d.model.forge, 'gold-forge (deterministic)', 'the dossier records which forge produced the stock');
	assert.equal(d.classes.length, 3);
	for ( const c of d.classes ) {
		assert.ok(c.sig && c.goldShape && typeof c.admitted === 'boolean', 'each class row is complete: ' + JSON.stringify(c));
	}
	assert.equal(d.summary.admitted, 3);
	assert.equal(d.summary.falseAdmitted, 0);
	assert.ok(Array.isArray(d.gates) && d.gates.every(( g ) => g.pass), 'all soundness gates pass');
	assert.equal(d.bundle.methods, 3);
	assert.match(d.bundle.sha256, /^[0-9a-f]{64}$/, 'the dossier binds the exact .sgc it certifies by sha256');
	assert.equal(d.verdict.pass, true);
});

test('forge — a VOTED run reports the model as the forge in the dossier, never "gold-forge" (certification correctness)', async () => {
	const decompose = async ( ask, rec ) => rec.goldSteps.slice();   // ignore the ask value; the voters just need to be present
	const voters = [async () => '', async () => '', async () => ''];
	const r = await forgeStock({ classes: CLASSES, stepEnum: STEP_ENUM, decompose, voters, modelName: 'test-model', name: 'x', version: 'v1', negControl: false });
	assert.equal(r.dossier.model.forge, 'test-model', 'a voted run used the model — the dossier must not mislabel it gold-forge');
	assert.equal(r.dossier.model.voters, 3);
	assert.equal(r.verdict.admitted, 3);
});

test('forge — a class whose forge is INCONSISTENT across instances is refused (yield is bounded by consistency, soundness is not)', async () => {
	// a custom decompose that returns a WRONG (shorter) shape for one instance of 'count|1' → inconsistent → refused,
	// but the two clean classes still admit. The stock stays clean; only the yield drops.
	let call = 0;
	const decompose = async ( ask, rec ) => {
		if ( rec.sig === 'count|1' && call++ === 1 ) return rec.goldSteps.slice(0, 1);   // one instance mis-decomposed
		return rec.goldSteps.slice();
	};
	const r = await forgeStock({ classes: CLASSES, stepEnum: STEP_ENUM, decompose, name: 'demo', version: 'v1', negControl: false });
	const count1 = r.dossier.classes.find(( c ) => c.sig === 'count|1' );
	assert.equal(count1.admitted, false, 'the inconsistent class is not admitted');
	assert.equal(count1.reason, 'model-inconsistent');
	assert.equal(r.verdict.admitted, 2, 'the two consistent classes still make the stock');
	assert.equal(r.verdict.falseAdmitted, 0, 'still 0 false — soundness held while yield dropped');
});
