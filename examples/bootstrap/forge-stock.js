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

	console.log('verdict →', JSON.stringify({ attempted: r.verdict.attempted, admitted: r.verdict.admitted, falseAdmitted: r.verdict.falseAdmitted, pass: r.verdict.pass }));
	assert.equal(r.verdict.attempted, 3);
	assert.equal(r.verdict.admitted, 3, 'every gold-consistent class was admitted');
	assert.equal(r.verdict.falseAdmitted, 0, 'THE claim: the gate never admitted a shape that is not gold');

	// ── 2. the NEG CONTROL — what makes "0 false admitted" a real number and not a tautology ───────
	const neg = r.dossier.soundness.negControl;
	console.log('neg     →', JSON.stringify({ ran: neg.ran, rejected: neg.rejected }), '← a deliberately corrupted shape was offered to the gate');
	assert.equal(neg.ran, true, 'the control actually ran');
	assert.equal(neg.rejected, true, 'and the corrupted shape was REJECTED — the gate has teeth');

	// ── 3. the stock ships, and reloads ───────────────────────────────────────────────────────────
	console.log('stock   →', JSON.stringify({ kind: r.bundle.kind, packed: r.verdict.packed, reloaded: r.verdict.reloaded }));
	assert.equal(r.bundle.kind, 'methods', 'a .sgc methods stock');
	assert.equal(r.verdict.packed, 3);
	assert.equal(r.verdict.reloaded, 3, 'a FRESH library hydrated all three — the stock is shippable, not machine-local');

	// ── 4. the DOSSIER: an auditable certification record bound to the bytes ──────────────────────
	const d = r.dossier;
	console.log('dossier →', JSON.stringify({ dataset: d.dataset.name, forge: d.model.forge, classes: d.classes.length, gates: d.gates.length + ' all pass', sha256: d.bundle.sha256.slice(0, 16) + '…' }));
	assert.equal(d.model.forge, 'gold-forge (deterministic)', 'the dossier records WHICH forge produced this — never mislabelled');
	assert.ok(d.gates.every(( g ) => g.pass ), 'every soundness gate passes');
	assert.match(d.bundle.sha256, /^[0-9a-f]{64}$/, 'and it binds the exact .sgc by sha256 — the dossier names its bytes');
	assert.equal(d.summary.falseAdmitted, 0);

	// the dossier renders to a human-auditable markdown page (what ships next to a stock)
	const md = dossierMarkdown(d);
	assert.match(md, /demo-stock/);
	console.log('rendered→ dossierMarkdown():', md.split('\n')[0]);

	// ── 5. HONEST SCOPE: a voted run must not claim the gold forge produced it ─────────────────────
	// Certification correctness cuts both ways: when a MODEL did the forging, the dossier says so.
	const voted = await forgeStock({ classes: CLASSES, stepEnum: STEP_ENUM,
		decompose: async ( ask, rec ) => rec.goldSteps.slice(),
		voters: [async () => '', async () => '', async () => ''],
		modelName: 'some-local-gguf', name: 'x', version: 'v1', negControl: false });
	console.log('voted   →', JSON.stringify({ forge: voted.dossier.model.forge, voters: voted.dossier.model.voters }));
	assert.equal(voted.dossier.model.forge, 'some-local-gguf', 'a model-forged stock is labelled with the MODEL — never "gold-forge"');

	console.log('BOOTSTRAP OK — 0 false admissions, proven non-vacuous by a live neg-control; the stock reloads and its dossier binds the exact .sgc by sha256');
}
main().catch(( e ) => { console.error(e); process.exit(1); });
