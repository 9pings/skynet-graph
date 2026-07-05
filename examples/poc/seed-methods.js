'use strict';
/**
 * PoC — SEEDING base concept-methods from a dictionary of abstractions, then JUDGING the seed population
 * (owner asks, 2026-07-05: a dictionary of common abstractions to seed base concept-methods "for humans" +
 * an explorer to judge the created population's quality / openness / coverage). Deterministic, 0 model calls.
 *
 * The study `doc/WIP/studies/2026-07-05-abstractions-dictionary-seed.md` recommends Conceptual-Dependency
 * primitive ACTs (Schank) as the cleanest hand-seedable map "typed signature → typed decomposition": each ACT
 * is a case-frame over a CLOSED role set. Here we author FIVE ACTs as typed decomposition schemas (the role
 * sequence IS the method shape), gold-gate them (a correct schema admits; a corrupted one is rejected — the
 * SAME `stock.js#goldGate` that keeps a model-forged stock clean, here over hand-authored seeds), pack them to
 * a portable `.sgc`, and run `method-explorer` to report the seed population's COVERAGE (which ACTs of the
 * declared set have a method — and the GAPS) and OPENNESS (distinct classes, reuse, entropy).
 *
 * NB — an ILLUSTRATIVE seed: we represent the STRUCTURE of the well-known primitive-act frames (roles as typed
 * step-kinds) to exercise the pipeline, not to reproduce any text. The point is the machinery: seed → verify →
 * ship → judge.
 *
 *   node seed-methods.js
 */
global.__SERVER__ = true;
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { goldGate, packStock } = require(ROOT + '/lib/authoring/stock.js');
const { unpackMethods } = require(ROOT + '/lib/authoring/method-pack.js');
const { describeLibrary, formatLibrary } = require(ROOT + '/lib/authoring/method-explorer.js');
const { makeLibrary, indexMethod, dispatch } = require(ROOT + '/lib/authoring/library.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

// The GOLD shapes: each CD primitive ACT as an ordered typed role sequence (the canonical decomposition).
// The full closed set (the declared class-space the explorer measures coverage against).
const CD_GOLD = {
	PTRANS: ['actor', 'object', 'source', 'destination'],   // change of physical location
	ATRANS: ['actor', 'object', 'donor', 'recipient'],      // change of an abstract relationship (e.g. possession)
	MTRANS: ['actor', 'info', 'source', 'recipient'],       // transfer of information
	INGEST: ['actor', 'object', 'destination'],             // take something inside
	GRASP:  ['actor', 'object'],                            // physical grasp
	PROPEL: ['actor', 'object', 'direction'],               // apply a force
	MOVE:   ['actor', 'bodypart'],                          // move a body part
	SPEAK:  ['actor', 'sound'],                             // produce a sound
	ATTEND: ['actor', 'sense', 'stimulus'],                 // direct a sense organ
	EXPEL:  ['actor', 'object', 'source'],                  // push something out
	PTRANS_SELF: ['actor', 'source', 'destination'],        // self-locomotion (a PTRANS with actor==object)
};
const DECLARED = Object.keys(CD_GOLD);                     // the 11-ACT declared class-space

// author a seed method for an ACT: a candidate carrying the shape (roles) as its decomposition + one template.
function authorMethod( act, shape ) {
	return { id: 'cd_' + act, act, shape: shape.slice(),
		schema: { signatureKeys: ['act'], frontier: { params: [{ name: 'actor', role: 'endpoint' }] } },
		signatureKeys: ['act'], frontier: { params: [{ name: 'actor', role: 'endpoint' }] },
		templatesBySig: { [act]: { shape: shape.slice() } } };
}

function runSeedMethods() {
	// SEED five ACTs (the study's recommended starter slice), each authored to its gold shape — plus ONE
	// deliberately CORRUPTED author (a wrong role sequence) as the neg-control the gate must reject.
	const SEED = ['PTRANS', 'ATRANS', 'MTRANS', 'INGEST', 'GRASP'];
	const authored = SEED.map(( act ) => ({ act, method: authorMethod(act, CD_GOLD[act]) }));
	const badAuthored = { act: 'PTRANS', method: authorMethod('PTRANS', ['actor', 'object']) };   // wrong shape (missing source/destination)

	// GOLD-GATE each: admit iff the authored role sequence matches the ACT's gold shape (consistent, single seed).
	const admitted = [], rejected = [];
	for ( const a of authored.concat([badAuthored]) ) {
		const g = goldGate({ modelShapes: [a.method.shape], goldSteps: CD_GOLD[a.act], crystallized: true });
		(g.admitted ? admitted : rejected).push({ act: a.act, sig: a.act, candidate: a.method, reason: g.reason, corrupt: a === badAuthored });
	}

	// PACK the admitted seeds to a portable .sgc (keyed on the ACT signature) + reload (portability).
	const bundle = packStock(admitted.map(( a ) => ({ sig: a.sig, candidate: a.candidate })), { name: 'cd-seed', version: 'v1', structureKey: 'act' });
	const reloaded = (unpackMethods(bundle).methods || []).length;

	// DISPATCH O(1): index the seeds, dispatch one ACT's signature → the bucket lookup returns it.
	const lib = makeLibrary();
	admitted.forEach(( a ) => indexMethod(lib, a.candidate));
	const disp = dispatch(lib, { signatureKeys: ['act'], frontier: admitted[0].candidate.frontier }, { act: 'PTRANS' });

	// JUDGE the seed population with the explorer (coverage vs the DECLARED 11-ACT space → the gaps; openness).
	const report = describeLibrary(bundle.methods, { expected: { act: DECLARED } });

	return { admitted, rejected, packedN: admitted.length, reloaded, dispatch: disp, report, DECLARED };
}

module.exports = { runSeedMethods, CD_GOLD };

if ( require.main === module ) {
	const r = runSeedMethods();
	out('\n=== SEED base concept-methods from a dictionary of abstractions (CD primitive ACTs) ===\n');
	out(formatLibrary(r.report));
	out('');
	out(`gold-gate: ${r.admitted.length} admitted, ${r.rejected.length} rejected (neg-control corrupt PTRANS → ${r.rejected.find(( x ) => x.corrupt ) ? 'REJECTED ✅' : 'ADMITTED ❌'})`);
	out(`.sgc: packed ${r.packedN}, reloaded ${r.reloaded} · dispatch(PTRANS): scanned ${r.dispatch.scanned}/${r.dispatch.total} · candidates ${r.dispatch.candidates.length}`);
	const cov = r.report.population.coverage.find(( c ) => c.key === 'act' );
	out(`coverage: ${cov.covered}/${cov.expected} ACTs seeded · GAPS: ${cov.missing.join(', ')}`);
	process.exit(0);
}
