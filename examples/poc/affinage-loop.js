'use strict';
/**
 * PoC (iii) — the AFFINAGE→LOCK-DÉFAISABLE policy, end-to-end on the real engine (owner Q#3, 2026-07-05).
 *
 * The owner's proposal: a generation policy that qualifies segments incrementally — a segment that does not
 * qualify (reaches the coverage frontier) TRIGGERS an affinage (the model/proposer proposes the missing
 * facet); if the affinage yields nothing, a KEY LOCKS / makes that affinage RARE; and the lock is DEFEASIBLE
 * (new evidence un-locks it — "rend rare", not permanent). This wires it from EXISTING bricks only (the
 * doctrine — no new engine logic): it is the `nogood.js` sound-skip pattern (learn-nogood.js) extended with a
 * coverage-amortization concept and a defeasible un-lock, over episodes (the store carried between them).
 *
 * THREE reactive concepts (the nogood ordering disciplines apply — cheap guards write their flags FIRST, their
 * own self-flag LAST, so the expensive trial's require-watcher re-tests with the flags already set):
 *   - Cover        (cheap): a kind whose facet is ALREADY admitted resolves at 0 affinage (amortization).
 *   - QualifyGuard (cheap): a kind that is nogood-LOCKED sound-skips the affinage (the lock = "rare").
 *   - Qualify      (expensive trial): fires ONLY at the frontier (not covered ∧ not locked) → the affinage:
 *       propose a facet → GATE (admit iff verified) → grow the admitted-facet ring (future 0-call) ; a
 *       dead-end (no proposal / refused) → recordNogood → LOCK.
 *
 * DÉFAISANCE (the owner's "rend rare, pas permanent"): a lock is a store entry, so removing it (on new
 * evidence) makes the kind retriable again — demonstrated against a control where the lock is kept (stays
 * skipped, never a false qualification). The vocabulary-grain sibling of this un-lock is the registry ring's
 * `retractRingAlias`; here the facet-grain lock is the nogood store (per the owner's "facettes / sous-treillis").
 *
 * All deterministic (a stub proposer): a qualifiable kind proposes its true facet (admit + grow); a HARD kind
 * proposes nothing (dead-end → lock); a WRONG proposal is refused by the gate (never admitted — 0 false facet).
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { createNogood, recordNogood, guardTrial, nogoodGuardConcept } = require('../../lib/providers/nogood');

// ── the domain oracle: each kind's TRUE facet (the gate verifies against it). A kind absent here has no
//    qualifying facet under the CURRENT knowledge → the proposer dead-ends → the affinage locks it. ─────────
const TRUE_FACET = { fever: 'general', cough: 'respiratory', rash: 'dermatological', nausea: 'digestive' };

// the proposer (the affinage organ — a stub for the model). `knowledge` = the kinds it can currently qualify;
// `wrongOn` = kinds it mis-proposes (to exercise the gate's refusal → 0 false admitted).
function makeProposer( knowledge, wrongOn ) {
	wrongOn = wrongOn || new Set();
	return ( kind ) => {
		if ( wrongOn.has(kind) ) return 'WRONG';                 // a mis-proposal — the gate must refuse it
		return knowledge.has(kind) ? TRUE_FACET[kind] : null;    // null = dead-end (nothing to propose)
	};
}
const GATE = ( kind, cat ) => cat != null && cat === TRUE_FACET[kind];   // admit iff the facet is verified

function makeProviders( propose, meter ) {
	return {
		// Cover (cheap) — amortization: a kind with an ALREADY-admitted facet resolves at 0 affinage.
		Aff: {
			cover: function ( graph, concept, scope, argz, cb ) {
				const kind = scope._.kind, mem = graph.getEtty('mem')._, facets = mem.facets || [];
				const f = facets.find(( x ) => x.kind === kind );
				const out = { $_id: '_parent' };
				if ( f ) { out.qualified = true; out.category = f.category; }   // resolved facts FIRST
				out.Cover = true;                                              // the cast marker + trigger, self-flag LAST (GOTCHA + discipline 2)
				cb(null, out);
			},
			// Qualify (expensive trial) — the AFFINAGE: propose → gate → admit+grow, or dead-end → LOCK.
			qualify: function ( graph, concept, scope, argz, cb ) {
				const kind = scope._.kind, id = scope._._id;
				meter.affinage.push(id);                                       // an affinage attempt was spent
				const cat = propose(kind);
				const out = [{ $_id: '_parent', Qualify: true },               // the cast marker (GOTCHA: a wired provider must self-flag)
					{ $$_id: 'mem', affinageRuns: { __push: id } }];
				if ( GATE(kind, cat) ) {                                       // ADMIT → grow the admitted-facet ring
					out[0].qualified = true; out[0].category = cat;
					out.push({ $$_id: 'mem', facets: { __push: { kind, category: cat } } });
				} else {                                                       // dead-end (no / refused proposal) → LOCK
					out[0].qualifyFailed = true;
					out.push(recordNogood({ ctxKey: kind, trial: 'Qualify' }));
				}
				cb(null, out);
			}
		}
	};
}

const TREE = { common: { childConcepts: {
	Cover       : { _id: 'Cover', _name: 'Cover', require: ['Segment', 'kind'], provider: ['Aff::cover'] },
	QualifyGuard: nogoodGuardConcept({ require: ['Segment', 'kind'], name: 'QualifyGuard' }),
	// the trial defers on both cheap guards' self-flags, skips a covered kind (!$qualified) AND a locked one (!$skip_Qualify).
	Qualify     : guardTrial({ _id: 'Qualify', _name: 'Qualify', require: ['Segment', 'kind', 'Cover', 'QualifyGuard'],
		ensure: ['!$qualified'], provider: ['Aff::qualify'] }, { trial: 'Qualify', guard: 'QualifyGuard' })
} } };
const CFG = { label: 'affinage', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' };

function seed( stream, facets, nogoods ) {
	return {
		lastRev: 0,
		nodes: [{ _id: 'S' }, { _id: 'T' }, { _id: 'mem', facets: facets || [], nogoods: nogoods || [], affinageRuns: [] }],
		segments: stream.map(( kind, i ) => ({ _id: 'seg' + i, originNode: 'S', targetNode: 'T', Segment: true, kind }))
	};
}

async function episode( stream, facets, nogoods, propose, wrongOn ) {
	const meter = { affinage: [] };
	Graph._providers = Object.assign({}, createNogood(), makeProviders(propose, meter));
	const g = new Graph(seed(stream, facets, nogoods), CFG, TREE);
	await nextStable(g);
	const mem = g._objById['mem']._etty._;
	const qualified = {}, skipped = [];
	stream.forEach(( kind, i ) => {
		const e = g._objById['seg' + i]._etty._;
		qualified['seg' + i] = { kind, qualified: !!e.qualified, category: e.category || null, fired: !!e.Qualify, failed: !!e.qualifyFailed };
		if ( e.skip_Qualify && !e.Qualify ) skipped.push('seg' + i);
	});
	return {
		affinageCalls: meter.affinage.length,
		facets: (mem.facets || []).slice(),
		nogoods: (mem.nogoods || []).map(( n ) => n.ctxKey).sort(),
		qualified, skipped,
		divergent: stream.map(( _, i ) => 'seg' + i).filter(( id ) => g._objById[id]._etty._.divergent),
		revs: g.getRevisions ? g.getRevisions().length : null
	};
}

// ── the campaign: cold learn → warm amortize+skip → defease (recover) vs control (stays locked) ──────────────
async function runAffinageLoop() {
	const KNOWN = new Set(['fever', 'cough', 'rash', 'nausea']);
	// E1 (cold): fever/cough/nausea are qualifiable ; "quux" is HARD (not in TRUE_FACET → dead-end → lock) ;
	//            "rash" is mis-proposed → the gate refuses it (0 false admitted, and it too gets locked).
	const cold = await episode(['fever', 'cough', 'nausea', 'quux', 'rash'],
		[], [], makeProposer(KNOWN, new Set(['rash'])), null);

	// E2 (warm): SAME kinds, carrying the learned facets + locks. Qualifiable → Cover (0 affinage, amortized) ;
	//            locked (quux, rash) → skip (0 affinage). The affinage spend collapses.
	const warm = await episode(['fever', 'cough', 'nausea', 'quux', 'rash'],
		cold.facets, cold.nogoods.map(( k ) => ({ ctxKey: k, trial: 'Qualify' })), makeProposer(KNOWN), null);

	// E3 (DEFEASE): new evidence — "quux" becomes qualifiable (add its true facet + the proposer now knows it),
	//               and we RETRACT quux's lock (remove it from the carried store). It re-attempts → qualifies.
	TRUE_FACET.quux = 'general';
    const known2 = new Set([...KNOWN, 'quux']);
	const keptLocks = cold.nogoods.filter(( k ) => k !== 'quux' ).map(( k ) => ({ ctxKey: k, trial: 'Qualify' }));   // quux un-locked
	const defeased = await episode(['quux'], cold.facets, keptLocks, makeProposer(known2), null);

	// CONTROL: same new evidence but the lock is KEPT (not retracted) → quux stays skipped (rare = sound, no
	// false qualification slips in just because the world changed; the un-lock must be an explicit act).
	const keptAll = cold.nogoods.map(( k ) => ({ ctxKey: k, trial: 'Qualify' }));
	const control = await episode(['quux'], cold.facets, keptAll, makeProposer(known2), null);
	delete TRUE_FACET.quux;   // restore the oracle for a clean re-run

	return { cold, warm, defeased, control };
}

module.exports = { runAffinageLoop };

// runnable directly for a quick look.
if ( require.main === module ) runAffinageLoop().then(( r ) => {
	const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');
	out('\n=== AFFINAGE→LOCK-DÉFAISABLE (owner Q#3) ===');
	out('E1 cold   : affinage ' + r.cold.affinageCalls + ' · admis(facettes) ' + r.cold.facets.map(( f ) => f.kind + '→' + f.category).join(',') + ' · lockés ' + JSON.stringify(r.cold.nogoods));
	out('E2 warm   : affinage ' + r.warm.affinageCalls + ' (amortissement+lock) · skippés ' + JSON.stringify(r.warm.skipped));
	out('E3 défaisé: quux qualified=' + r.defeased.qualified.seg0.qualified + ' category=' + r.defeased.qualified.seg0.category + ' (le lock retiré → re-qualifie)');
	out('   contrôle: quux qualified=' + r.control.qualified.seg0.qualified + ' skippé=' + (r.control.skipped.length > 0) + ' (lock gardé → reste rare, 0 fausse qualif)');
	process.exit(0);
} ).catch(( e ) => { console.error(e); process.exit(1); });
