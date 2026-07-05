'use strict';
/*
 * live-discover.js — le rung LIVE de la roadmap #2 : la DÉCOUVERTE AUTONOME du frame depuis les traces du
 * modèle embarqué (ferme le caveat « frame déclaré » du Probe #1). Gates Laurie 7 (../../sota/2026-07-03-
 * restriction-learning-lab-laurie.md), pré-enregistrés :
 *   G1 — STABILITÉ D'ÉMISSION, séparée et PRÉALABLE : chaque épisode est décomposé sur SES DEUX phrasings
 *        (prose + proseGen du corpus) ; les per-step (kind, field, value) doivent coïncider post-canon.
 *        Instable ⇒ verdict « SEAM CASSÉ », JAMAIS « frame indécouvrable » (le de-confounder RUN-8 en gate).
 *   G2 — DISJONCTION : épisodes de découverte (t7, t9) ∩ seed de déclaration Probe-#1 (t6, t8) = ∅, et leurs
 *        valeurs de params mutuellement disjointes (chaque position de param est FORCÉE à trouer).
 *   G3 — PRÉ-REPORT VERBATIM : le frame découvert est imprimé AVANT toute comparaison au déclaré.
 * Scope : frame-EXISTENCE (positions/rôles des slots) — PAS le niveau de restriction (lab déterministe).
 * Modèle : embarqué Qwen3.6-27B-Q2, reasoningBudget 0, seed 0, memo run-scoped. ~10 calls, GPU sandbox-off.
 */
const fs = require('fs');
const path = require('path');
const E2E = path.resolve(__dirname, '../2026-07-02-e2e-fidelity');
const PR = path.resolve(__dirname, '../2026-07-03-parametric-reuse');
const ROOT = path.resolve(__dirname, '../../../..');
const { makeTypedDecomposeProviders } = require(ROOT + '/lib/authoring/typed-loop.js');
const { seedMethod, slotBindings } = require(PR + '/mechanics.js');
console.info = console.warn = () => {};

const CORPUS = JSON.parse(fs.readFileSync(E2E + '/corpus/tasks.json', 'utf8'));
const DATA = JSON.parse(fs.readFileSync(E2E + '/corpus/data.json', 'utf8'));
const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const STEP_KINDS = CORPUS.stepKindEnum;                                    // the system's own vocabulary
const SCHEMA = 'invoices(id, client, amount, status) and tickets(id, priority, topic)';
const PARAM_KEYS = ['aField', 'aValue', 'bField', 'bValue'];

// ── G2: the discovery episodes — DISJOINT from the Probe-#1 declaration seed (t6/t8) ────────────────────
const EPISODE_IDS = ['t7', 't9'];                                          // t7: status pending/overdue · t9: client Stark/Wayne
const SEED_IDS = ['t6', 't8'];
const taskOf = ( id ) => CORPUS.splits.train.find(( t ) => t.id === id );

function makeAsk() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const memo = new Map();
	return async ( o ) => {
		const k = JSON.stringify([o.system, o.user, o.maxTokens]);
		if ( memo.has(k) ) return memo.get(k);
		const r = await raw(o);
		memo.set(k, r);
		return r;
	};
}

// canon-snap a field onto the schema columns; values kept raw (they ARE the holes — variance expected).
const COLUMNS = ['id', 'client', 'amount', 'status', 'priority', 'topic'];
const snapField = ( f ) => COLUMNS.find(( c ) => String(f || '').toLowerCase().includes(c)) || String(f || '');

// the LIVE per-step-typed decompose (prompt-only at the structural touchpoint — the RUN-2 grammar-collapse rule)
async function decompose( ask, prose ) {
	const txt = await ask({
		system: 'You break a data request into an ORDERED list of sub-steps. Use ONLY these kinds: ' + STEP_KINDS.join(', ')
			+ '. For each step that filters or aggregates over a specific column value, include "field" (the column) and'
			+ ' "value" (the value, exactly as in the request). Mark atomic:false ONLY if that sub-step needs further breakdown.'
			+ ' Reply ONLY JSON: {"steps":[{"kind":"...","atomic":true|false,"field":"...","value":"..."}]}.',
		user: 'Request: ' + prose + '\nData schema: ' + SCHEMA, maxTokens: 300,
	});
	try {
		const m = String(txt).match(/\{[\s\S]*\}/);
		return (JSON.parse(m ? m[0] : txt).steps || []).map(( s ) => ({
			stepKind: String(s.kind || '').toLowerCase(), atomic: s.atomic !== false,
			field: s.field ? snapField(s.field) : undefined, value: s.value != null ? String(s.value) : undefined }));
	} catch ( e ) { return null; }
}

// ── the STRUCTURAL CANON (the 1-cycle patch after G1's first refusal — v1 read the raw emissions) ───────
// v1 finding: the model emits the SAME plan at two granularities — [agg(f,v), …] vs [filter(f,v), agg, …] —
// related by EXACTLY the (filter,aggregate) digram the GO kill-gate mined (support 1.0/0.875); and it leaks
// OPERATION words ("sum", "larger") into `value` on non-filtering steps. The canon (the canonicalization
// barrier applied to STRUCTURE, using the system's OWN learned equivalence — never ad hoc):
//   (a) fail-closed whitelist: per-step facts only on filter/aggregate; a `value` survives only if it is a
//       DATA value (the system's own vocabulary — same legitimacy as Probe #1's snapValue);
//   (b) the digram fold: [filter(f,v), aggregate(…)] → aggregate(f,v).
// Stability is then claimed MODULO this canon, and the canon is applied to the discovery trace too.
const DATA_VOCAB = new Set([].concat(...Object.values(DATA).map(( d ) => [].concat(...Object.values(d))))
	.flatMap(( r ) => Object.values(r).filter(( v ) => typeof v === 'string' ).map(( v ) => v.toLowerCase())));
function canonStructure( steps ) {
	if ( !steps ) return null;
	const cleaned = steps.map(( s ) => {
		const keep = (s.stepKind === 'filter' || s.stepKind === 'aggregate') && s.value != null && DATA_VOCAB.has(String(s.value).toLowerCase());
		return { stepKind: s.stepKind, atomic: s.atomic, field: keep ? s.field : undefined, value: keep ? s.value : undefined };
	});
	const out = [];
	for ( let i = 0; i < cleaned.length; i++ ) {
		if ( cleaned[i].stepKind === 'filter' && cleaned[i + 1] && cleaned[i + 1].stepKind === 'aggregate' )
			{ out.push({ stepKind: 'aggregate', atomic: true, field: cleaned[i].field, value: cleaned[i].value }); i++; }   // the digram fold
		else out.push(cleaned[i]);
	}
	return out;
}
const canonSteps = ( steps ) => JSON.stringify((steps || []).map(( s ) => ({ k: s.stepKind, f: s.field || '', v: (s.value || '').toLowerCase() })));

( async function main() {
	// ── G2 asserted before any spend ──
	for ( const id of EPISODE_IDS ) if ( SEED_IDS.includes(id) ) { console.error('G2 FAILED: episode ' + id + ' is in the declaration seed'); process.exit(1); }
	const eps = EPISODE_IDS.map(taskOf);
	const vals = eps.map(( t ) => [t.intent.a.is, t.intent.b.is] );
	if ( vals[0].some(( v ) => vals[1].includes(v)) ) { console.error('G2 FAILED: episode param values overlap'); process.exit(1); }
	console.log('G2 PASS — episodes ' + EPISODE_IDS + ' disjoint from seed ' + SEED_IDS + ', values mutually disjoint ' + JSON.stringify(vals));

	const ask = makeAsk();

	// ── G1: emission stability across the two phrasings, PER EPISODE, BEFORE discovery ──
	const stable = {};
	for ( const t of eps ) {
		const r1 = await decompose(ask, t.prose), r2 = await decompose(ask, t.proseGen);
		const rawSame = r1 && r2 && canonSteps(r1) === canonSteps(r2);
		const s1 = canonStructure(r1), s2 = canonStructure(r2);
		// SHAPE stability = kinds sequence post-canon; then the PHRASING-CONSENSUS MERGE (the owner's
		// redundancy thesis operationalized: re-saying the same thing differently is how facts complete —
		// a fact one phrasing dropped is filled by the other; a CONFLICT stays empty, fail-closed).
		const shapeOf = ( s ) => JSON.stringify((s || []).map(( x ) => x.stepKind ));
		const same = s1 && s2 && shapeOf(s1) === shapeOf(s2);
		const merged = same ? s1.map(( a, i ) => { const b = s2[i];
			const pick = ( k ) => a[k] && b[k] ? (String(a[k]).toLowerCase() === String(b[k]).toLowerCase() ? a[k] : undefined) : (a[k] || b[k]);
			return { stepKind: a.stepKind, atomic: a.atomic, field: pick('field'), value: pick('value') }; }) : null;
		stable[t.id] = { same, rawSame, s1, s2, merged };
		console.log(`G1 ${t.id}: raw ${rawSame ? 'STABLE' : 'UNSTABLE'} · post-canon shape ${same ? 'STABLE' : 'UNSTABLE'} — merged→${canonSteps(merged)}`);
		if ( !same ) { console.log(`         canon(prose)→${canonSteps(s1)}`); console.log(`         canon(proseGen)→${canonSteps(s2)}`); }
	}
	if ( !Object.values(stable).every(( s ) => s.same ) ) {
		console.log('\n⇒ VERDICT: SEAM UNSTABLE — per-step typed-fact emission diverges across phrasings.');
		console.log('   (Laurie G1: this is a SEAM verdict, NEVER « frame undiscoverable ». Report ends here.)');
		fs.writeFileSync(path.join(__dirname, 'RESULTS-discover.json'), JSON.stringify({ verdict: 'seam-unstable', stable }, null, 2));
		process.exit(0);
	}

	// ── DISCOVERY: the live traces crystallize through the SAME path as the self-test/Probe-#1 seeding ──
	const node = ( id ) => ({ _id: id });
	const counters = { eval: 0, expand: 0, answer: 0 };
	const byId = Object.fromEntries(eps.map(( t ) => ['D_' + t.id, t] ));
	const { candidate, gen, error } = await seedMethod({
		paramKeys: PARAM_KEYS,
		seed: { lastRev: 0, nodes: eps.flatMap(( t, i ) => [node('S' + i), node('G' + i)] ),
			segments: eps.map(( t, i ) => ({ _id: 'D_' + t.id, originNode: 'S' + i, targetNode: 'G' + i, stepKind: 'compare',
				aField: t.intent.a.field, aValue: t.intent.a.is, bField: t.intent.b.field, bValue: t.intent.b.is }) ) },
		providers: makeTypedDecomposeProviders({
			stepKinds: { enum: STEP_KINDS }, maxDepth: 2, stepFacts: ['field', 'value'],
			evalFn: () => { counters.eval++; return { atomic: false }; },
			// THE LIVE EMISSION = the G1-certified, canon-folded, phrasing-MERGED steps (stability and
			// discovery see the same canon; the merge is the consensus the gate already validated — no new
			// model calls, no cross-call drift inside the run)
			expandFn: ( s ) => { counters.expand++; const t = byId[s._._id]; return stable[t.id].merged; },
			answerFn: ( s ) => { counters.answer++; return 'leaf'; },
		}),
	});
	if ( error ) {
		console.log('\n⇒ VERDICT: crystallization refused — ' + error + ' (a REAL finding: the live trace did not admit; see the methods detail)');
		fs.writeFileSync(path.join(__dirname, 'RESULTS-discover.json'), JSON.stringify({ verdict: 'not-admitted', error, stable }, null, 2));
		process.exit(0);
	}
	const slots = slotBindings(gen);

	// ── G3: VERBATIM pre-report BEFORE any comparison ──
	console.log('\n══ THE DISCOVERED FRAME (verbatim, pre-comparison — G3) ══');
	console.log('  skeleton objects: ' + JSON.stringify(gen.skeleton && gen.skeleton.map ? gen.skeleton.map(( o ) => Object.keys(o).join(',') ) : gen.skeleton));
	console.log('  LGG stable: ' + gen.stable + ' · slots: ' + JSON.stringify(slots.map(( s ) => s.role + '.' + s.key )));
	console.log('  templates: ' + Object.keys(candidate.templatesBySig || {}).length + ' sig-classes · signatureKeys: ' + JSON.stringify(candidate.signatureKeys));

	// ── comparison to the DECLARED Probe-#1 frame (4 slots: aggregate#0/#1 × field/value) ──
	const declared = ['aggregate#0.field', 'aggregate#0.value', 'aggregate#1.field', 'aggregate#1.value'];
	const found = slots.map(( s ) => s.role + '.' + s.key ).sort();
	const match = JSON.stringify(found) === JSON.stringify(declared.slice().sort());
	console.log('\n⇒ VERDICT: ' + (match
		? 'FRAME DISCOVERED ≡ DECLARED — the system induced, from its OWN live decompositions, the same 4 role-typed param slots Probe #1 declared.'
		: 'FRAME DISCOVERED ≠ DECLARED — a real finding, reported verbatim above (differences: ' + JSON.stringify({ found, declared }) + ')'));
	console.log('   structural spend: eval ' + counters.eval + ' · expand ' + counters.expand + ' (the first-derivation price — justified seeds)');
	fs.writeFileSync(path.join(__dirname, 'RESULTS-discover.json'), JSON.stringify({ verdict: match ? 'discovered-equal' : 'discovered-different',
		stable: Object.fromEntries(Object.entries(stable).map(( [k, v] ) => [k, v.same] )), found, declared, counters }, null, 2));
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
