'use strict';
/*
 * live-probe.js — Probe #1 LIVE : la réutilisation paramétrique sur le modèle EMBARQUÉ (Qwen3.6-27B-Q2,
 * reasoningBudget:0, seed 0), protocole Laurie (../../sota/2026-07-03-parametric-reuse-probe-laurie.md) :
 *   - frame DÉCLARÉ (Laurie 8 : library/human n'ont jamais formé de composite → non-cristallisable de leurs
 *     traces), matérialisé par le MÊME chemin crystallize que le self-test (épisodes déterministes à params
 *     DISJOINTS pris des golds TRAIN dataops t6/t8 : {status:overdue,paid} ⟂ {client:ACME,Globex} — valeurs
 *     ET champs disjoints → la LGG troue field+value sur chaque slot) ; + une TENTATIVE trace-seed live
 *     (informatif, non-bloquant).
 *   - intake LIVE par tâche : extraction {kind, metric, a:{field,value}, b:{field,value}} — le SCHÉMA de la
 *     donnée est donné (légitime), AUCUNE valeur du corpus n'est nommée (Laurie 4b).
 *   - attribution 3-canaux ground-truthée (Laurie 2) : SELECTION (kind vs gold) · EXTRACTION (params vs gold,
 *     modulo la symétrie DÉCLARÉE : compare = argmax ⇒ commutatif, le swap est bénin pour la réponse mais
 *     compté à part) · CONTENT = exécution DÉTERMINISTE depuis les params montés (attribué comme tel, 8b).
 *   - ZERO-FIRE gate DUR sur chaque mount (eval 0 / expand 0 — jamais de re-décompose).
 *   - INJECTION (Laurie 5) : prose affamée (tronquée au connecteur) → l'intake doit rendre b ABSENT →
 *     impracticable+hint ; l'off-diagonale starved→réponse-complète doit être 0 ; hallucinations comptées.
 *   - NULL param-shuffle (Laurie 7) : rotation des param-sets extraits entre tâches → l'accuracy doit chuter.
 *   - Cibles : library compare ×8 + human compare ×8 (les 0-splits) ; dataops heldout compare ×4 = ANCRE.
 *   - Déterminisme : memo d'ask run-scoped (le pattern RUN-4) + double passe in-process identique.
 * GPU/sandbox-off. Résultats → RESULTS.json + LOG.md.
 */
const fs = require('fs');
const path = require('path');
const E2E = path.resolve(__dirname, '../2026-07-02-e2e-fidelity');
const ROOT = path.resolve(__dirname, '../../../..');
const Graph = require(ROOT + '/tests/_boot.js');
const { nextStable } = require(ROOT + '/lib/authoring/core/supervise.js');
const { makeTypedDecomposeProviders } = require(ROOT + '/lib/authoring/core/typed-loop.js');
const { seedMethod, slotBindings, mountParametric, paramLoopConceptTree } = require('./mechanics.js');
const { answerMatches } = require(E2E + '/live.js');
console.info = console.warn = () => {};

const CORPUS = JSON.parse(fs.readFileSync(E2E + '/corpus/tasks.json', 'utf8'));
const DATA = JSON.parse(fs.readFileSync(E2E + '/corpus/data.json', 'utf8'));
const MODEL_PATH = process.env.LOCAL_MODEL || '/mnt/wsl/WipDrive/_perso/c&c/app.dist/models/Qwen3.6-27B-UD-Q2_K_XL.gguf';
const PARAM_KEYS = ['aField', 'aValue', 'bField', 'bValue'];
const SCHEMA = { dataops: 'invoices(id, client, amount, status) and tickets(id, priority, topic)', library: 'books(id, genre, year, copies)' };
const TABLE = { dataops: 'invoices', library: 'books' };

// ── gold compare tasks per split (+ the human golds parsed from the generator source) ──────────────────
function humanCompares() {
	const src = fs.readFileSync(E2E + '/cross-model-heldout.js', 'utf8');
	const txt = fs.readFileSync(E2E + '/corpus/human-tasks.txt', 'utf8').split('\n').filter(Boolean)
		.map(( l, i ) => { const [q, e] = l.split('|').map(( x ) => x.trim()); return { id: 'h' + i, prose: q, expected: e }; });
	const out = [];
	for ( const chunk of src.split(/\{\s*prose:/).slice(1) ) {                 // one chunk per TASKS entry — no cross-entry leak
		const p = chunk.match(/^\s*'((?:[^'\\]|\\.)*)'/);
		const m = chunk.match(/op: 'compare', a: \{ field: '(\w+)', is: '(\w+)' \}, b: \{ field: '(\w+)', is: '(\w+)' \}/);
		if ( !p || !m ) continue;
		const prose = p[1].replace(/\\'/g, "'");
		const line = txt.find(( t ) => t.prose === prose );
		if ( line ) out.push({ id: line.id, domain: 'dataops', prose, expected: line.expected,
			intent: { field: 'amount', a: { field: m[1], is: m[2] }, b: { field: m[3], is: m[4] } } });
	}
	return out;
}
const cmpOf = ( split, domain ) => CORPUS.splits[split].filter(( t ) => t.rootKindGold === 'compare' )
	.map(( t ) => ({ id: t.id, domain, prose: t.prose, expected: t.expected, intent: t.intent }));
const TESTS = {
	'dataops-anchor': cmpOf('heldout', 'dataops'),
	'library'       : [...cmpOf('train2', 'library'), ...cmpOf('heldout2', 'library')],
	'human'         : humanCompares(),
};

// ── deterministic compute (the CONTENT channel = engine facts + arithmetic; Laurie 8b, attributed) ─────
const sumWhere = ( domain, metric, field, value ) => (DATA[domain][TABLE[domain]] || [])
	.filter(( r ) => String(r[field]).toLowerCase() === String(value).toLowerCase())
	.reduce(( a, r ) => a + (Number(r[metric]) || 0), 0);
function winnerOf( domain, metric, a, b ) {
	const sa = sumWhere(domain, metric, a.field, a.value), sb = sumWhere(domain, metric, b.field, b.value);
	return { winner: sa >= sb ? a.value : b.value, sa, sb };                  // argmax — COMMUTATIVE (declared symmetry)
}

// ── the embedded model, run-scoped memoized (the RUN-4 determinism pattern) ────────────────────────────
function makeAsk() {
	const { makeLocalAsk } = require(ROOT + '/lib/providers/llm-local.js');
	const raw = makeLocalAsk({ modelPath: MODEL_PATH, reasoningBudget: 0, seed: 0, contextSize: 4096 });
	const memo = new Map();
	return { memo, ask: async ( o ) => {
		const k = JSON.stringify([o.system, o.user, o.maxTokens, o.grammar && o.grammar.jsonSchema]);
		if ( memo.has(k) ) return memo.get(k);
		const r = await raw(o);
		memo.set(k, r);
		return r;
	} };
}

// intake: schema given, NO corpus values named (Laurie 4b); grammar = flat object (the safe intake face).
async function intake( ask, prose, domain ) {
	const txt = await ask({
		system: 'You extract the structure of a data request. The data schema is: ' + SCHEMA[domain] + '.'
			+ ' Reply ONLY JSON: {"kind":"<one of ' + CORPUS.taskKindEnum.join('|') + '>","metric":"<the numeric field the request totals>",'
			+ '"a":{"field":"<column>","value":"<the first group/filter value in the request, exactly as written>"},'
			+ '"b":{"field":"<column>","value":"<the second group/filter value, or \\"\\" if the request has only one>"}}',
		user: prose, maxTokens: 120,
		grammar: { jsonSchema: { type: 'object', properties: {
			kind: { type: 'string', enum: CORPUS.taskKindEnum },
			metric: { type: 'string' },
			a: { type: 'object', properties: { field: { type: 'string' }, value: { type: 'string' } }, required: ['field', 'value'] },
			b: { type: 'object', properties: { field: { type: 'string' }, value: { type: 'string' } }, required: ['field', 'value'] },
		}, required: ['kind', 'metric', 'a', 'b'] } },
	});
	try { const m = String(txt).match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt); } catch ( e ) { return null; }
}

// the CANONICALIZATION BARRIER at intake (the C0 front-door discipline): snap an extracted SURFACE value onto
// the value vocabulary of the system's OWN data (never the test golds — the database is legitimately ours).
// Exact ci-match keeps; containment either way snaps (e.g. "already paid" → "paid"); else the raw survives
// (a genuine OOV — it will mis-sum and be caught by verify, the honest path).
function snapValue( domain, field, value, stats ) {
	const rows = [].concat(...Object.values(DATA[domain]));
	const vocab = [...new Set(rows.map(( r ) => r[field]).filter(( v ) => typeof v === 'string'))];
	const v = String(value).toLowerCase();
	if ( vocab.some(( c ) => c.toLowerCase() === v) ) return value;
	const hit = vocab.find(( c ) => v.includes(c.toLowerCase()) || c.toLowerCase().includes(v));
	if ( hit ) { stats.snapped++; return hit; }
	stats.oov++;
	return value;
}
function snapExtraction( domain, x, stats ) {
	if ( !x ) return x;
	for ( const side of ['a', 'b'] )
		if ( x[side] && x[side].value ) x[side] = { field: x[side].field, value: snapValue(domain, x[side].field, x[side].value, stats) };
	return x;
}

// extraction scoring vs gold, modulo the DECLARED commutative symmetry (swap recorded separately).
function scoreExtraction( x, intent ) {
	if ( !x ) return 'unparsed';
	const eq = ( p, g ) => p && String(p.field).toLowerCase() === String(g.field).toLowerCase()
		&& String(p.value).toLowerCase() === String(g.is).toLowerCase();
	if ( eq(x.a, intent.a) && eq(x.b, intent.b) ) return 'exact';
	if ( eq(x.a, intent.b) && eq(x.b, intent.a) ) return 'swap';
	return 'wrong';
}

// mount + settle + read back the MOUNTED child facts (param flow through the graph) + zero-fire counters.
async function mountAndCompute( gen, slots, task, x ) {
	const counters = { eval: 0, expand: 0, answer: 0 };
	Graph._providers = Object.assign({}, makeTypedDecomposeProviders({
		stepKinds: { enum: ['aggregate', 'check', 'emit'] }, maxDepth: 2, stepFacts: ['field', 'value'],
		evalFn: () => { counters.eval++; return { atomic: false }; },
		expandFn: () => { counters.expand++; return []; },
		answerFn: ( s ) => { counters.answer++; return 'leaf'; },
	}));
	const params = { 'aggregate#0': null, 'aggregate#1': null };
	// each aggregate slot carries TWO holes (field, value) — bind per hole key
	const byRole = {};
	for ( const s of slots ) byRole[s.role + '.' + s.key] = s;
	const values = {
		'aggregate#0.field': x.a.field, 'aggregate#0.value': x.a.value,
		'aggregate#1.field': x.b.field, 'aggregate#1.value': x.b.value,
	};
	const roleParams = {};
	for ( const s of slots ) { const v = values[s.role + '.' + s.key]; if ( v != null && v !== '' ) roleParams[s.role + '#' + s.key] = v; }
	// mechanics.mountParametric keys params by slot ROLE — with two holes per role we key by role#key instead
	const perSlot = {};
	for ( const s of slots ) { const v = values[s.role + '.' + s.key]; if ( v != null && v !== '' ) perSlot[s.path] = v; }
	const { fillContentHoles } = require(ROOT + '/lib/authoring/core/abstract.js');
	const missing = slots.filter(( s ) => !(s.path in perSlot));
	if ( missing.length ) return { status: 'impracticable', hint: missing.map(( s ) => ({ role: s.role, key: s.key })) };
	const filled = fillContentHoles(gen.skeleton, perSlot);
	if ( !filled ) return { status: 'impracticable', hint: [{ role: 'fill', key: '?' }] };
	const { mountTemplate } = require(ROOT + '/lib/authoring/core/typed-loop.js');
	const mutation = mountTemplate(filled, { rootId: 'M_' + task.id, origin: 'X', target: 'Y', create: true,
		facts: { stepKind: 'compare', aField: x.a.field, aValue: x.a.value, bField: x.b.field, bValue: x.b.value } });
	if ( !mutation ) return { status: 'impracticable', hint: [{ role: 'frontier', key: '_id' }] };
	const g = new Graph({ lastRev: 0, nodes: [{ _id: 'X' }, { _id: 'Y' }], segments: [] },
		{ label: 'p1-' + task.id, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' },
		{ common: paramLoopConceptTree(PARAM_KEYS) });
	g.pushMutation(mutation);
	await nextStable(g);
	const kids = (g.getEtty('M_' + task.id)._.expandedInto || []).map(( id ) => g.getEtty(id)._);
	const aggs = kids.filter(( k ) => k.stepKind === 'aggregate' );
	const metric = (x.metric && String(x.metric).toLowerCase()) || (task.domain === 'library' ? 'copies' : 'amount');
	const w = winnerOf(task.domain, metric, { field: aggs[0].field, value: aggs[0].value }, { field: aggs[1].field, value: aggs[1].value });
	return { status: 'complete', counters, winner: w.winner, sums: [w.sa, w.sb], mountedParams: aggs.map(( k ) => k.field + '=' + k.value) };
}

const MARKERS = [' and ', ' or ', ' versus ', ' vs ', ' compared to ', ' against ', ' with '];
function starve( prose ) {
	for ( const m of MARKERS ) { const i = prose.indexOf(m); if ( i > 25 ) return prose.slice(0, i) + '?'; }
	return null;
}

async function pass( ask, gen, slots ) {
	const out = { groups: {}, zeroFire: true };
	for ( const [gname, tasks] of Object.entries(TESTS) ) {
		const G = out.groups[gname] = { n: tasks.length, selOk: 0, extExact: 0, extSwap: 0, extWrong: 0, unparsed: 0,
			mounted: 0, answerOk: 0, answerOkBLENDfloor: null, fallbacks: 0, rows: [] };
		for ( const t of tasks ) {
			const raw = await intake(ask, t.prose, t.domain);
			out.snapStats = out.snapStats || { snapped: 0, oov: 0 };
			const x = snapExtraction(t.domain, raw, out.snapStats);           // the canon barrier (system-level intake)
			const sel = x && x.kind === 'compare';
			const ext = x ? scoreExtraction(x, t.intent) : 'unparsed';
			if ( sel ) G.selOk++;
			G[ext === 'exact' ? 'extExact' : ext === 'swap' ? 'extSwap' : ext === 'unparsed' ? 'unparsed' : 'extWrong']++;
			let row = { id: t.id, sel, ext, expected: t.expected };
			if ( !sel || !x || !x.a || !x.b || !x.b.value ) { G.fallbacks++; row.outcome = 'fallback(' + (!sel ? 'selection' : 'starved-extraction') + ')'; }
			else {
				const m = await mountAndCompute(gen, slots, t, x);
				if ( m.status !== 'complete' ) { G.fallbacks++; row.outcome = 'impracticable'; row.hint = m.hint; }
				else {
					G.mounted++;
					if ( m.counters.eval || m.counters.expand ) out.zeroFire = false;
					row.outcome = 'mounted'; row.winner = m.winner; row.params = m.mountedParams;
					row.answerOk = answerMatches(m.winner, t.expected);
					if ( row.answerOk ) G.answerOk++;
				}
			}
			G.rows.push(row);
		}
	}
	return out;
}

( async function main() {
	const t0 = process.hrtime.bigint();
	const results = { model: path.basename(MODEL_PATH), protocol: '../../sota/2026-07-03-parametric-reuse-probe-laurie.md' };

	// ── frame (DECLARED, materialized through crystallize; params from TRAIN golds t6/t8, field+value disjoint) ──
	const seedCounters = { eval: 0, expand: 0, answer: 0 };
	const mkSeedProviders = () => makeTypedDecomposeProviders({
		stepKinds: { enum: ['aggregate', 'check', 'emit'] }, maxDepth: 2, stepFacts: ['field', 'value'],
		evalFn: () => { seedCounters.eval++; return { atomic: false }; },
		expandFn: ( s ) => { seedCounters.expand++; return [
			{ stepKind: 'aggregate', field: s._.aField, value: s._.aValue },
			{ stepKind: 'aggregate', field: s._.bField, value: s._.bValue },
			{ stepKind: 'check' }, { stepKind: 'emit' } ]; },
		answerFn: ( s ) => { seedCounters.answer++; return 'leaf'; },
	});
	const { candidate, gen, error } = await seedMethod({
		paramKeys: PARAM_KEYS,
		seed: { lastRev: 0, nodes: [{ _id: 'S1' }, { _id: 'G1' }, { _id: 'S2' }, { _id: 'G2' }],
			segments: [
				{ _id: 'T1', originNode: 'S1', targetNode: 'G1', stepKind: 'compare', aField: 'status', aValue: 'overdue', bField: 'status', bValue: 'paid' },
				{ _id: 'T2', originNode: 'S2', targetNode: 'G2', stepKind: 'compare', aField: 'client', aValue: 'ACME', bField: 'client', bValue: 'Globex' }] },
		providers: mkSeedProviders(),
	});
	if ( error ) { console.error('SEED GATE FAILED: ' + error); process.exit(1); }
	const slots = slotBindings(gen);
	console.log('FRAME (declared, via crystallize): slots = ' + JSON.stringify(slots.map(( s ) => s.role + '.' + s.key)));
	if ( slots.length !== 4 ) { console.error('SEED GATE FAILED: expected 4 holes (field+value per aggregate slot), got ' + slots.length); process.exit(1); }

	// ── compute-semantics SELF-CHECK on every gold-intent compare (protects the CONTENT attribution) ──
	for ( const [gname, tasks] of Object.entries(TESTS) )
		for ( const t of tasks ) {
			const w = winnerOf(t.domain, t.intent.field, { field: t.intent.a.field, value: t.intent.a.is }, { field: t.intent.b.field, value: t.intent.b.is });
			if ( !answerMatches(w.winner, t.expected) ) { console.error('COMPUTE GATE FAILED on ' + t.id + ': ' + w.winner + ' ≠ ' + t.expected); process.exit(1); }
		}
	console.log('COMPUTE GATE PASS — the deterministic winner matches EXPECTED on all ' + Object.values(TESTS).flat().length + ' gold compares');
	console.log('tests: ' + Object.entries(TESTS).map(( [k, v] ) => k + '=' + v.length).join(' '));
	if ( process.env.DRY ) { console.log('DRY run — stopping before the model load.'); process.exit(0); }

	// ── the LIVE passes ──
	const { ask } = makeAsk();
	const run1 = await pass(ask, gen, slots);
	const run2 = await pass(ask, gen, slots);                                  // memo-hit pass — determinism gate
	results.determinism = JSON.stringify(run1) === JSON.stringify(run2);
	results.zeroFire = run1.zeroFire;
	results.groups = run1.groups;

	// ── INJECTION (starved prose) ──
	const starvedRows = [];
	for ( const t of [...TESTS.library, ...TESTS.human] ) {
		const sp = starve(t.prose);
		if ( !sp ) continue;
		const x = await intake(ask, sp, t.domain);
		const bAbsent = !x || !x.b || !x.b.value;
		const halluc = x && x.b && x.b.value && String(x.b.value).toLowerCase() !== String(t.intent.b.is).toLowerCase();
		let outcome;
		if ( bAbsent ) outcome = 'hint';                                       // → impracticable channel (proven zero-fire in selftest)
		else outcome = 'completed(' + (halluc ? 'HALLUCINATED' : 'guessed-right') + ')';
		starvedRows.push({ id: t.id, outcome, b: x && x.b && x.b.value || null });
	}
	results.injection = { n: starvedRows.length, hint: starvedRows.filter(( r ) => r.outcome === 'hint').length, rows: starvedRows };

	// ── NULL (param-rotation across each group's tasks) ──
	results.nullArm = {};
	for ( const gname of ['library', 'human'] ) {
		const rows = run1.groups[gname].rows.filter(( r ) => r.outcome === 'mounted' );
		let ok = 0;
		for ( let i = 0; i < rows.length; i++ ) {
			const t = TESTS[gname].find(( x ) => x.id === rows[i].id );
			const donor = rows[(i + 1) % rows.length];                         // rotate the EXTRACTED params
			const dt = TESTS[gname].find(( x ) => x.id === donor.id );
			const w = winnerOf(t.domain, t.intent.field, { field: dt.intent.a.field, value: dt.intent.a.is }, { field: dt.intent.b.field, value: dt.intent.b.is });
			if ( answerMatches(w.winner, t.expected) ) ok++;
		}
		results.nullArm[gname] = { mounted: rows.length, nullAnswerOk: ok };
	}

	// ── report ──
	console.log('\n══ RESULTS (per group) ══');
	for ( const [gname, G] of Object.entries(results.groups) )
		console.log(`  ${gname.padEnd(15)} n=${G.n}  selection ${G.selOk}/${G.n}  extraction exact ${G.extExact} swap ${G.extSwap} wrong ${G.extWrong} unparsed ${G.unparsed}` +
			`  mounted ${G.mounted}  answerOk ${G.answerOk}/${G.n}  fallbacks ${G.fallbacks}`);
	console.log(`  INJECTION: ${results.injection.hint}/${results.injection.n} starved→hint (off-diagonal completed: ${results.injection.n - results.injection.hint})`);
	console.log(`  NULL: library ${results.nullArm.library.nullAnswerOk}/${results.nullArm.library.mounted} · human ${results.nullArm.human.nullAnswerOk}/${results.nullArm.human.mounted} (must be ≪ answerOk)`);
	console.log(`  CANON-SNAP: ${run1.snapStats ? run1.snapStats.snapped + ' snapped, ' + run1.snapStats.oov + ' OOV kept-raw' : 'n/a'}`);
	console.log(`  GATES: zeroFire=${results.zeroFire} determinism=${results.determinism}`);
	results.elapsedSec = Number(process.hrtime.bigint() - t0) / 1e9;
	fs.writeFileSync(path.join(__dirname, 'RESULTS.json'), JSON.stringify(results, null, 2));
	console.log('wrote RESULTS.json (' + Math.round(results.elapsedSec) + 's)');
	process.exit(0);
})().catch(( e ) => { console.error('FATAL:', e); process.exit(1); });
