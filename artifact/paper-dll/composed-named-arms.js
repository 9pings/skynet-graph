'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * M4 (deeper) — the NAMED agent-memory systems in their COMPOSED (2-link) form, behind the same iface
 * as composed-arms.js. Faithful minimal re-implementations (cf. named-arms.js), each given its FAIREST
 * shot + a paired ablation (the negative control). The composed measure exposes how each system's
 * recovery mechanism behaves ACROSS A METHOD CHAIN decide -> disburse:
 *
 *   MEMGPT-2     paging + COARSE re-decode of the flagged class — and the re-decode must run at BOTH
 *                links (link 2 reads the re-decided decision), so the paging+coarse tax + the core blob
 *                in every prompt are paid TWICE down the chain. Recovers both; tax compounds.
 *                (blind: never pages -> stale at both links = compounds.)
 *   REFLEXION-2  NO decision memo -> an actor call PER record PER link (calls ~ 2N) + a reflection/retry
 *                on the audit failure. The corrected decision propagates to link 2. Recovers; calls compound.
 *                (blind: no signal -> stale link 1 -> stale link 2 = compounds.)
 *   GRAPHRAG-2   offline community summaries PER link; retrieve-then-generate per decision per link. Blind
 *                to the silent audit -> stale at both. reindex = a BATCH re-summary of audited communities
 *                at BOTH links -> recovers, at twice the batch cost.
 *
 * The honest claim: each named system CAN recover (fairest shot), but its mechanism tax MULTIPLIES down
 * the chain (more calls / bigger ctx / batch×links), or — without the recovery hook — its staleness
 * COMPOUNDS link to link. STRUCT-2 re-asserts the contract in-engine (0 model calls for the re-check) and
 * re-derives ONLY the violated chain.
 */
const { track, newCounters } = require('./arms.js');
const { classOf, finalize2 } = require('./composed-arms.js');

const typedClass = ( r ) => `${r.kind}|${r.region}|${r.score}`;

/** the composed Evaluator (Reflexion): a DELAYED failure signal on the LINK-1 decision. Pre-audit nothing
 *  to observe; post-audit a stale approve on an audited class is contradicted by the (exogenous) audit. */
function makeFeedback( workload ) {
	return ( rec, action ) => {
		if ( rec.index < workload.auditAt ) return null;
		const want = workload.truth1(rec);
		return action === want ? null : { correct: false, shouldBe: want };
	};
}

// ── MEMGPT-2 ──────────────────────────────────────────────────────────────────────────────────────
async function memgpt2( stream, env, opts = {} ) {
	const surface = opts.surface !== false;
	const c = newCounters(), a1 = [], a2 = [];
	const core = [], CORE_CAP = 6;
	const archival = new Map();                 // typedKey -> { d, b }   (the composed answer)
	const revalidated = new Set();
	let paged = false;
	for ( const r of stream ) {
		const audited = env.workload.activeAuditAt(r.index);
		if ( surface && audited.size && !paged ) {
			paged = true; core.push('AUDIT ' + [...audited].join(','));
			await track(c, env, { task: 'decide', record: { kind: 'memedit', region: '-', tier: '-', score: '-' }, skillText: core.join(' ; ') });
			if ( core.length > CORE_CAP ) {
				await track(c, env, { task: 'decide', record: { kind: 'flush', region: '-', tier: '-', score: '-' }, skillText: core.join(' ; ') });
				core.splice(0, core.length, `summary(${core.length} facts)`);
			}
		}
		const known = new Set(core.filter(( l ) => l.startsWith('AUDIT')).flatMap(( l ) => l.slice(6).split(',')));
		const flagged = known.has(classOf(r));
		const k = typedClass(r);
		const needRedecide = flagged && !revalidated.has(k);
		if ( archival.has(k) && !needRedecide ) { const e = archival.get(k); a1[r.index] = e.d; a2[r.index] = e.b; continue; }
		// COARSE re-decode at BOTH links, with the core blob carried in every prompt (measured into ctx).
		const d = await track(c, env, { task: 'decide', record: r, knownAudited: known, skillText: core.join(' ; ') });
		const b = await track(c, env, { task: 'disburse', record: r, decision: d, skillText: core.join(' ; ') });
		archival.set(k, { d, b }); if ( flagged ) revalidated.add(k); a1[r.index] = d; a2[r.index] = b;
	}
	return finalize2('MEMGPT-2', c, a1, a2);
}

// ── REFLEXION-2 ───────────────────────────────────────────────────────────────────────────────────
async function reflexion2( stream, env, opts = {} ) {
	const useFeedback = opts.feedback !== false;
	const c = newCounters(), a1 = [], a2 = [];
	const memory = new Map(), believed = new Set(), OMEGA = 3;
	const feedback = env.workload.feedback || makeFeedback(env.workload);
	for ( const r of stream ) {
		const k = classOf(r);
		const skillText = (memory.get(k) || []).join(' ; ');
		// ACTOR (link 1): a call EVERY record — no decision memo.
		let d = await track(c, env, { task: 'decide', record: r, knownAudited: believed, skillText });
		if ( useFeedback ) {
			const sig = feedback(r, d);
			if ( sig && sig.correct === false ) {
				await track(c, env, { task: 'decide', record: r, skillText, forcedAction: sig.shouldBe });  // SELF-REFLECTION
				const buf = memory.get(k) || [];
				buf.push(`${r.region}/${r.kind}: ${sig.shouldBe} (audit non-compliant)`);
				while ( buf.length > OMEGA ) buf.shift();
				memory.set(k, buf); believed.add(k);
				d = await track(c, env, { task: 'decide', record: r, knownAudited: believed, skillText: buf.join(' ; ') });  // RETRY
			}
		}
		a1[r.index] = d;
		// ACTOR (link 2): another call EVERY record, reading the (possibly corrected) decision.
		a2[r.index] = await track(c, env, { task: 'disburse', record: r, decision: d, skillText });
	}
	return finalize2('REFLEXION-2', c, a1, a2);
}

// ── GRAPHRAG-2 ────────────────────────────────────────────────────────────────────────────────────
async function graphrag2( stream, env, opts = {} ) {
	const reindex = !!opts.reindex;
	const c = newCounters(), a1 = [], a2 = [];
	const auditAt = env.workload.auditAt;
	const summaries = new Map();                 // community -> { audited:bool }

	// OFFLINE INDEX over the pre-audit corpus: a link-1 AND a link-2 summary per community (blind to the audit).
	const byComm = new Map();
	for ( const r of stream ) if ( r.index < auditAt ) {
		if ( !byComm.has(classOf(r)) ) byComm.set(classOf(r), []);
		byComm.get(classOf(r)).push(r);
	}
	for ( const [comm, members] of byComm ) {
		await track(c, env, { task: 'decide', record: { kind: 'summary', region: comm, tier: '-', score: '-' }, history: members.map(( m ) => ({ record: m, action: '-' })) });
		await track(c, env, { task: 'disburse', record: { kind: 'summary', region: comm, tier: '-', score: '-' }, decision: '-', history: members.map(( m ) => ({ record: m, action: '-' })) });
		summaries.set(comm, { audited: false });
	}

	let reindexed = false;
	for ( const r of stream ) {
		const comm = classOf(r);
		if ( !summaries.has(comm) ) {
			await track(c, env, { task: 'decide', record: { kind: 'summary', region: comm, tier: '-', score: '-' }, history: [{ record: r, action: '-' }] });
			await track(c, env, { task: 'disburse', record: { kind: 'summary', region: comm, tier: '-', score: '-' }, decision: '-', history: [{ record: r, action: '-' }] });
			summaries.set(comm, { audited: false });
		}
		// RE-INDEX (operator-triggered BATCH at the audit boundary): re-summarize audited communities at BOTH links.
		if ( reindex && !reindexed && r.index >= auditAt ) {
			reindexed = true;
			for ( const [cm, s] of summaries ) if ( env.workload.auditedSet.has(cm) ) {
				const members = byComm.get(cm) || [];
				await track(c, env, { task: 'decide', record: { kind: 'resummary', region: cm, tier: '-', score: '-' }, history: members.map(( m ) => ({ record: m, action: '-' })) });
				await track(c, env, { task: 'disburse', record: { kind: 'resummary', region: cm, tier: '-', score: '-' }, decision: '-', history: members.map(( m ) => ({ record: m, action: '-' })) });
				s.audited = true;
			}
		}
		// DECISION per record per link (retrieve-then-generate — no content-addressed memo).
		const s = summaries.get(comm);
		const known = s.audited ? new Set([comm]) : new Set();
		const d = await track(c, env, { task: 'decide', record: r, knownAudited: known, skillText: `[community ${comm} summary]` });
		const b = await track(c, env, { task: 'disburse', record: r, decision: d, skillText: `[community ${comm} summary]` });
		a1[r.index] = d; a2[r.index] = b;
	}
	return finalize2('GRAPHRAG-2', c, a1, a2);
}

const COMPOSED_NAMED_ARMS = {
	'MEMGPT-2': ( s, e ) => memgpt2(s, e, { surface: true }),
	'MEMGPT-2-BLIND': ( s, e ) => memgpt2(s, e, { surface: false }),
	'REFLEXION-2': ( s, e ) => reflexion2(s, e, { feedback: true }),
	'REFLEXION-2-BLIND': ( s, e ) => reflexion2(s, e, { feedback: false }),
	'GRAPHRAG-2': ( s, e ) => graphrag2(s, e, { reindex: false }),
	'GRAPHRAG-2-REINDEX': ( s, e ) => graphrag2(s, e, { reindex: true }),
};

module.exports = { COMPOSED_NAMED_ARMS, memgpt2, reflexion2, graphrag2, makeFeedback };
