'use strict';
/*
 * _mission — le GRAPHE DE CROYANCE de la mission (l'idiome validé par probe-retraction.js, ZERO-CORE) :
 *   · faits = cellules typées `c_<row>_<col>` sur un nœud par table + résultats dérivés `r_<step>` ;
 *   · un concept par étape admise : require les cellules, ensure null-guardé `$used_* == null || $c == $used_*`,
 *     provider DÉTERMINISTE (résout les args-REFS → valeurs courantes → execProgram ; 0 LLM) ;
 *   · cleaner = reset used_* + CONSTAT typé (la raison du reopen) → uncast sélectif + re-fire + cascade
 *     push-forward vers le nœud mission (étapes de composition) ;
 *   · rebuild-from-checkpoint : le gate RE-VÉRIFIE chaque méthode au load (shape ∈ certified, fail-closed).
 *
 * La méthode admise (par étape) : { stepId, tbl, steps: [{op, args: [ {cell:{r,c}} | {v} | {k} ]}], feeds: [] }
 *   {cell} = référence de cellule (paramétrée : un erratum change le résultat) · {v} = littéral non paramétré
 *   (match ambigu, flaggé) · {k} = résultat d'une étape précédente du programme (#k).
 */
const NRG = require('path').join(__dirname, '..', '..');    // le repo lui-même (fusion NRG→skynet-graph faite)
const Graph = require(NRG + '/lib/graph/index.js');
const { nextStable } = require(NRG + '/lib/authoring/supervise.js');
const { recordConstat } = require(NRG + '/lib/providers/constat.js');
const A = require(NRG + '/examples/forge-adapters/finqa.js');

async function settle( g ) {
	for ( let i = 0; i < 80; i++ ) {
		await nextStable(g);
		if ( !g._unstable.length && !g._triggeredCastCount ) {
			await new Promise(( r ) => setImmediate(r));
			if ( !g._unstable.length && !g._triggeredCastCount ) return;
		}
	}
	throw new Error('mission graph did not settle');
}
const cellKey = ( r, c ) => 'c_' + r + '_' + c;
const cast = ( g, id, k ) => !!(g._objById[id] && g._objById[id]._etty._mappedConcepts[k]);
const fact = ( g, id, k ) => g._objById[id] && g._objById[id]._etty._[k];

/**
 * createMission({ certified, tables, methods }) → { graph, fires, ingestErratum, snapshotPlan, facts, rejected }
 * @param tables   { tblId: table (rows) }   — les tables du rapport (cellules numériques → faits)
 * @param methods  [ méthode admise ]        — voir le format en tête ; RE-GATÉES au load (fail-closed)
 * @param plan     [ {id, title, needs} ]    — les étapes déclarées (compute + composition + synthèse)
 */
async function createMission( o ) {
	const certified = o.certified;
	const fires = {};                                     // stepId → nb de fires provider (0-LLM + sélectivité)
	const rejected = [];                                  // méthodes refusées au re-gate (fail-closed)
	const registry = {};                                  // stepId → méthode (lu par le provider générique)

	// ── re-gate au load : shape ∈ référentiel gelé, sinon EXCLUE (jamais servie depuis un checkpoint corrompu) ──
	const methods = [];
	for ( const m of (o.methods || []) ) {
		const shape = m.steps.map(( s ) => s.op ).join('>');
		if ( certified.indexOf(shape) < 0 ) { rejected.push({ stepId: m.stepId, shape, blame: 'shape ∉ referential (re-gate at load)' }); continue; }
		methods.push(m); registry[m.stepId] = m;
	}

	// ── seed : un nœud par table (cellules numériques = faits typés), le nœud mission, le ledger constats ──
	const nodes = [{ _id: 'mission', isMission: true }];
	for ( const [ tblId, table ] of Object.entries(o.tables) ) {
		const n = { _id: tblId, isReport: true };
		(table || []).forEach(( row, ri ) => row.forEach(( c, ci ) => {
			const v = Number(String(c).replace(/[,$%()]/g, ''));
			if ( isFinite(v) && String(c).trim() !== '' ) n[cellKey(ri, ci)] = v;
		}));
		nodes.push(n);
	}

	// ── un concept par méthode admise : require cellules + (composition) inputs, ensure null-guardé par prémisse ──
	const childConcepts = {};
	for ( const m of methods ) {
		const prem = premiseKeys(m);                       // [{key(local), usedKey}]
		childConcepts['Step_' + m.stepId] = {
			_id: 'Step_' + m.stepId, _name: 'Step_' + m.stepId,
			require: [m.tbl ? 'isReport' : 'isMission'],
			assert: m.tbl ? ["$_id=='" + m.tbl + "'"] : undefined,
			// 2 clauses par prémisse : (a) présente (un erratum-retrait laisse l'étape OPEN, pas de re-fire loop) ;
			// (b) inchangée depuis la dérivation (drift → uncast → cleaner → re-dérivation). Null-guard 1er fire.
			ensure: prem.flatMap(( p ) => [ '$' + p.key + ' != null', '$' + p.usedKey + ' == null || $' + p.key + ' == $' + p.usedKey ] ),
			provider: ['Demo::step', m.stepId],
			cleaner: ['Demo::reset', m.stepId],
			constat: { claimKey: 'r_' + m.stepId, because: prem.map(( p ) => p.key ).join(',') },
		};
	}
	const tree = { common: { childConcepts } };

	Graph._providers = { Demo: {
		step( g, c, scope, argz, cb ) {
			const m = registry[argz[0]];
			fires[m.stepId] = (fires[m.stepId] || 0) + 1;
			const prem = premiseKeys(m);
			const vals = {};                                // key → valeur courante lue du graphe
			for ( const p of prem ) vals[p.key] = scope.getRef(p.key);
			// résolution refs → programme littéral → la calculette déterministe de l'adapter (inchangée)
			const prog = m.steps.map(( s ) => s.op + '(' + s.args.map(( a ) =>
				a.cell ? vals[cellKey(a.cell.r, a.cell.c)] : a.input ? vals['in_' + a.input] : a.k != null ? '#' + a.k : a.v
			).join(', ') + ')' ).join(', ');
			const r = A.execProgram(prog, []);
			if ( !r ) return cb(null, null);                // fail-closed : jamais un fait faux plutôt qu'un fait douteux
			const tpl = { $_id: '_parent', ['Step_' + m.stepId]: true, ['r_' + m.stepId]: r.value };
			for ( const p of prem ) tpl[p.usedKey] = vals[p.key];
			const out = [tpl];
			for ( const f of (m.feeds || []) ) out.push({ $$_id: f.node, ['in_' + m.stepId]: r.value });
			cb(null, out);
		},
		reset( g, c, scope, argz, cb ) {
			const m = registry[argz[0]];
			const tpl = { $_id: '_parent' };
			for ( const p of premiseKeys(m) ) tpl[p.usedKey] = null;
			// rétracte AUSSI les push-forward : une composition ne reste jamais « done » sur une prémisse rétractée
			const out = [tpl, recordConstat(g, c, scope, c._schema.constat)];
			for ( const f of (m.feeds || []) ) out.push({ $$_id: f.node, ['in_' + m.stepId]: null });
			cb(null, out);
		},
	} };

	const g = new Graph({ lastRev: 0, freeNodes: [{ _id: 'mem', lessons: [] }], nodes, segments: [] },
		{ label: 'mission', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, tree);
	await settle(g);

	return {
		graph: g, fires, rejected,
		ingestErratum: async ( tblId, r, c, value ) => {
			await new Promise(( res ) => g.ingest({ [tblId]: { [cellKey(r, c)]: value } }, res));
			await settle(g);
		},
		facts: () => {
			const out = {};
			for ( const m of methods ) out[m.stepId] = { value: fact(g, m.tbl || 'mission', 'r_' + m.stepId), cast: cast(g, m.tbl || 'mission', 'Step_' + m.stepId) };
			return out;
		},
		constats: () => (fact(g, 'mem', 'lessons') || []).slice(),
		snapshotPlan: () => ({ steps: (o.plan || []).map(( s ) => {
			const m = registry[s.id];
			const done = m ? cast(g, m.tbl || 'mission', 'Step_' + s.id)
				: (s.derivedFrom ? s.derivedFrom.every(( d ) => registry[d] && cast(g, registry[d].tbl || 'mission', 'Step_' + d) ) : false);
			const lessons = (fact(g, 'mem', 'lessons') || []).filter(( l ) => l.kind === 'Step_' + s.id );
			const last = lessons[lessons.length - 1];
			return { id: s.id, title: s.title, needs: s.needs || [], status: done ? 'done' : 'open',
				reason: !done && last ? 'premise drifted: ' + last.retractedBecause + ' (rev ' + last.atRev + ')' : undefined };
		}) }),
	};
}

/** les clés de prémisse d'une méthode : cellules (table) et inputs (composition), + la clé used_ appariée. */
function premiseKeys( m ) {
	const seen = new Set(), out = [];
	m.steps.forEach(( s ) => s.args.forEach(( a ) => {
		const key = a.cell ? cellKey(a.cell.r, a.cell.c) : a.input ? 'in_' + a.input : null;
		if ( key && !seen.has(key) ) { seen.add(key); out.push({ key, usedKey: 'used_' + m.stepId + '_' + out.length }); }
	}));
	return out;
}

module.exports = { createMission, premiseKeys, cellKey };
