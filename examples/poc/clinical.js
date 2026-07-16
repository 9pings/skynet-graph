'use strict';
/**
 * Clinical grammar — the NICHE demonstrator: inter-premise DEFEASANCE. A diagnosis derived
 * from a lab is RETRACTED (with its medication cascading) the moment the lab is refuted, and
 * a typed CONSTAT record (the Q6 shape) is deposited on a surviving anchor. The deterministic
 * JTMS retraction IS the differentiator (the Zep foil made runnable, R2-safe).
 *
 * The diagnosis enum is written by a provider (stubbing the LLM, R2: the rule only gates +
 * retracts, never decides). Roadmap: doc/WIP/plans/2026-06-24-poc-roadmap-learning-tiling.md §3.1.
 *   node examples/poc/clinical.js
 */
global.__SERVER__ = true;
const path = require('path');
const Graph = require('../../lib/graph/index.js');
const { buildConceptTree } = require('../../lib/authoring/core/concepts');
const { createConstat } = require('../../lib/providers/constat');

const CLINICAL = path.join(__dirname, '..', '..', 'concepts', 'clinical');

function makeClinicalProviders() {
	return Object.assign({
		Dx: {
			diagnose( graph, concept, scope, argz, cb ) {       // the LLM writes the typed diagnosis enum (stubbed)
				cb(null, { $_id: '_parent', Diagnosis: true, diagnosis: 'ckd', confBand: 'high' });
			},
			prescribe( graph, concept, scope, argz, cb ) {
				cb(null, { $_id: '_parent', Medication: true, medication: 'lisinopril' });
			}
		}
	}, createConstat());   // Q6 typed constat record (Constat::record cleaner), on a surviving anchor
}

function clinicalSeed() {
	return {
		lastRev: 0,
		freeNodes: [{ _id: 'mem', lessons: [] }],
		// creatinine 2.4 mg/dL (> refHigh 1.3) -> out of range -> a CKD diagnosis; lab initially verified
		nodes: [{ _id: 'enc1', encounter: true, analyte: 'creatinine', value: 2.4, unit: 'mg/dL', refHigh: 1.3, refLow: 0.6, labVerdict: 'pass' }],
		segments: []
	};
}

// stabilize the chain, then REFUTE the lab and re-stabilize; return both states + the constat.
function runClinicalDefeasance() {
	Graph._providers = makeClinicalProviders();
	const tree = buildConceptTree(CLINICAL);
	return new Promise(( resolve, reject ) => {
		const timer = setTimeout(() => reject(new Error('clinical defeasance timed out')), 20000);
		let phase = 0; const snap = {};
		new Graph(clinicalSeed(), {
			label: 'clinical', isMaster: true, autoMount: true, conceptSets: ['clinical'], bagRefManagers: {}, logLevel: 'error',
			onStabilize( g ) {
				try {
					const e = g._objById['enc1']._etty._;
					if ( phase === 0 ) {
						phase = 1;
						snap.before = { Observation: !!e.Observation, LabValue: !!e.LabValue, OutOfRange: !!e.OutOfRange,
							Diagnosis: !!e.Diagnosis, diagnosis: e.diagnosis, Medication: !!e.Medication, medication: e.medication };
						g.pushMutation({ $$_id: 'enc1', labVerdict: 'fail' }, 'enc1');   // a corrected reading fails verification
						if ( !g._running ) g._taskFlow.run();
					} else if ( phase === 1 ) {
						clearTimeout(timer);
						snap.after = { Diagnosis: !!e.Diagnosis, Medication: !!e.Medication, OutOfRange: !!e.OutOfRange,
							lessons: g._objById['mem']._etty._.lessons };
						resolve(snap);
					}
				} catch ( err ) { clearTimeout(timer); reject(err); }
			}
		}, { clinical: tree });
	});
}

module.exports = { runClinicalDefeasance, makeClinicalProviders, clinicalSeed, CLINICAL };

if ( require.main === module ) {
	runClinicalDefeasance().then(( s ) => {
		console.log('\n=== Clinical defeasance — a refuted lab retracts the diagnosis (the niche) ===\n');
		console.log('BEFORE refute:', JSON.stringify(s.before));
		console.log('AFTER refute :', JSON.stringify({ Diagnosis: s.after.Diagnosis, Medication: s.after.Medication, OutOfRange: s.after.OutOfRange }));
		console.log('constat      :', JSON.stringify(s.after.lessons));
		process.exit(0);
	}).catch(( e ) => { console.error(e); process.exit(1); });
}
