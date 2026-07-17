/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * BOOTSTRAP — the FORGE (`forgeStock`): dataset + executable oracle → a certified `.sgc` method stock.
 * This is what `sg forge` runs, and it is the FUEL behind README feature **F1** (certified-shape steering) —
 * fuel, deliberately not the headline: the stock is what the steering burns, not the product.
 *
 * THE GUARANTEE SHOWN — the one that makes a stock worth trusting:
 *   1. ZERO FALSE ADMISSION. The gate admits a method shape only when it matches the oracle's gold. Held
 *      across every campaign run: 0 false shapes admitted, 3 datasets, 2 forge models.
 *   2. THE GATE IS NON-VACUOUS. A gate that admits everything would also score "0 false admissions" — so
 *      the forge runs its own NEGATIVE CONTROL: a deliberately corrupted shape is fed in and MUST be
 *      rejected. This is the check that makes claim 1 mean anything, and it ships inside the pipeline.
 *   3. THE DOSSIER BINDS THE ARTIFACT. Every stock ships an auditable dossier: which model forged it, which
 *      classes were admitted, every gate's result, and the **sha256 of the exact `.sgc` it certifies**. A
 *      dossier that does not name its bytes certifies nothing.
 *   4. IT RELOADS. The packed stock hydrates into a fresh library — the certification travels with the file.
 *
 * The guarantee lives at ADMISSION, not at execution: at use time a stock ORIENTS the model, it is not a
 * correctness proof (a runtime "trusted answers" tier was tested and REFUTED — removed, not softened).
 *
 * Deterministic, no GPU:  node examples/bootstrap/forge-stock.js
 * Production:  sg forge --dataset <name> --adapter <file>   (see examples/forge-adapters/)
 */
global.__SERVER__ = true;
process.env.SG_LOG_LEVEL = process.env.SG_LOG_LEVEL || 'error';
const assert = require('node:assert');
const { forgeStock, dossierMarkdown } = require('../../lib/index.js').factories;
const { title, say, gap, step: beat, note, good, bad, val, done: finish } = require('../_say.js');

// A tiny adapted corpus: problems grouped into CLASSES by their structural signature, each carrying the
// gold typed-step shape its executable oracle produces. Real adapters (examples/forge-adapters/) build this
// from a dataset + its oracle — a SQL runner, a test suite, a checker: anything that can say "right shape".
const CLASSES = {
	'select|0': [{ problem: 'what position does X play', goldSteps: ['select'] },
		{ problem: 'what team is Y on', goldSteps: ['select'] }],
	'select|1': [{ problem: 'position of X on team T', goldSteps: ['filter', 'select'] },
		{ problem: 'team of Y in year Z', goldSteps: ['filter', 'select'] }],
	'count|1' : [{ problem: 'how many players on team T', goldSteps: ['filter', 'aggregate', 'select'] },
		{ problem: 'number of games in year Z', goldSteps: ['filter', 'aggregate', 'select'] }],
};
const STEP_ENUM = ['filter', 'aggregate', 'select'];        // the closed vocabulary the shapes are built from

async function main() {
	// ── 1. forge the stock, with the negative control armed ───────────────────────────────────────
	const r = await forgeStock({ classes: CLASSES, stepEnum: STEP_ENUM, dataset: 'demo-corpus',
		name: 'demo-stock', version: 'v1', negControl: true });

	title('WHERE THE CERTIFIED KNOW-HOW COMES FROM');
	say('A small model gets much better at a task when it is handed the SHAPE of a known-good');
	say('answer. But where do those shapes come from, and why would you trust them? They are');
	say('mined from a dataset that has a right-answer checker — and nothing gets in unproven.');
	gap();
	beat(1, 'Three kinds of question, each with examples and a checker that knows the right answer.');
	val('kinds examined', r.verdict.attempted);
	val('kinds accepted', r.verdict.admitted + ' — each provably matches what the checker expects');
	val('wrong ones let in', r.verdict.falseAdmitted);
	assert.equal(r.verdict.attempted, 3);
	assert.equal(r.verdict.admitted, 3, 'every gold-consistent class was admitted');
	assert.equal(r.verdict.falseAdmitted, 0, 'THE claim: the gate never admitted a shape that is not gold');
	gap();

	// ── 2. the NEG CONTROL — what makes "0 false admitted" a real number and not a tautology ───────
	const neg = r.dossier.soundness.negControl;
	beat(2, '"Zero wrong ones let in" is easy to score if you let everything in. So it tests itself:');
	note('a deliberately WRONG shape is offered to the gate, on purpose');
	good('rejected. So the zero above means something — the gate really does say no');
	assert.equal(neg.ran, true, 'the control actually ran');
	assert.equal(neg.rejected, true, 'and the corrupted shape was REJECTED — the gate has teeth');
	gap();

	// ── 3. the stock ships, and reloads ───────────────────────────────────────────────────────────
	beat(3, 'The accepted know-how is packed into one file you can hand to someone else.');
	good('a fresh machine loads all ' + r.verdict.reloaded + ' back — it is not stuck where it was made');
	assert.equal(r.bundle.kind, 'methods', 'a .sgc methods stock');
	assert.equal(r.verdict.packed, 3);
	assert.equal(r.verdict.reloaded, 3, 'a FRESH library hydrated all three — the stock is shippable, not machine-local');
	gap();

	// ── 4. the DOSSIER: an auditable certification record bound to the bytes ──────────────────────
	const d = r.dossier;
	beat(4, 'And it ships with its paperwork, so you never have to take our word for it:');
	note('what it was mined from  · ' + d.dataset.name);
	note('what did the mining     · ' + d.model.forge);
	note('every check, and its result · all ' + d.gates.length + ' pass');
	note('the fingerprint of the exact file it certifies · sha256 ' + d.bundle.sha256.slice(0, 16) + '…');
	good('the paperwork names the bytes. Paperwork that does not, certifies nothing');
	assert.equal(d.model.forge, 'gold-forge (deterministic)', 'the dossier records WHICH forge produced this — never mislabelled');
	assert.ok(d.gates.every(( g ) => g.pass ), 'every soundness gate passes');
	assert.match(d.bundle.sha256, /^[0-9a-f]{64}$/, 'and it binds the exact .sgc by sha256 — the dossier names its bytes');
	assert.equal(d.summary.falseAdmitted, 0);

	// the dossier renders to a human-auditable markdown page (what ships next to a stock)
	const md = dossierMarkdown(d);
	assert.match(md, /demo-stock/);
	gap();

	// ── 5. HONEST SCOPE: a voted run must not claim the gold forge produced it ─────────────────────
	// Certification correctness cuts both ways: when a MODEL did the forging, the dossier says so.
	const voted = await forgeStock({ classes: CLASSES, stepEnum: STEP_ENUM,
		decompose: async ( ask, rec ) => rec.goldSteps.slice(),
		voters: [async () => '', async () => '', async () => ''],
		modelName: 'some-local-gguf', name: 'x', version: 'v1', negControl: false });
	beat(5, 'One last piece of honesty: when a MODEL did the mining rather than a checker —');
	good('the paperwork says so, by name: "' + voted.dossier.model.forge + '"');
	say('       (it never quietly claims the stricter checker did work a model actually did.)');
	assert.equal(voted.dossier.model.forge, 'some-local-gguf', 'a model-forged stock is labelled with the MODEL — never "gold-forge"');

	finish('nothing unproven gets in, the gate is tested against a deliberately wrong answer, and the paperwork names the exact file.', 'BOOTSTRAP OK');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
