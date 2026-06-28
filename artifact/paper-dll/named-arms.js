'use strict';
/*
 * Copyright 2026 Nathanael Braun — AGPL-3.0-or-later.
 *
 * #10 — the NAMED-SYSTEM arms for the head-to-head (the "venue lifter"). Three faithful, minimal
 * re-implementations of the agent-memory systems reviewers cite, behind the SAME uniform iface as
 * arms.js (`async (stream, env) => result`, every model call through the shared `track`). They are
 * NOT strawmen: each is given its FAIREST shot (its strongest faithful configuration) AND a paired
 * ablation knob that doubles as the negative control (turn the distinctive mechanism OFF → it goes
 * stale, proving the recovery comes from the mechanism, not the harness).
 *
 *   MEMGPT     Packer et al., arXiv:2310.08560 (2023; → Letta). Tiered memory (core / archival),
 *              self-edit by function-call, memory pressure. Reuse on a typed key (amortizes); at the
 *              audit a heartbeat surfaces it → self-edit pages it into CORE memory (a model turn) →
 *              the whole flagged (region,kind) class is re-decided (COARSE: high AND low) with the
 *              core blob carried in every prompt. Recovers, but coarse + paging-cost + larger ctx.
 *              opts.surface=false → never pages → stale (NEG CONTROL).
 *   REFLEXION  Shinn et al., NeurIPS 2023, arXiv:2303.11366. Actor → Evaluator (a DELAYED audit
 *              failure signal) → Self-Reflection (a model call) → bounded episodic memory → prose
 *              prepended on later trials of the class. Has NO decision memo → one Actor call PER
 *              record (calls ≈ N). Recovers reactively after an observed failure (a lag).
 *              opts.feedback=false → Regime 1, no signal → stale (NEG CONTROL).
 *   GRAPHRAG   Edge et al., Microsoft, arXiv:2404.16130 (2024). Offline batch index: communities
 *              (= typed classes) + LLM community summaries (context = the community's members), then
 *              retrieve-then-generate per decision. The offline index is BLIND to the silent audit →
 *              stale on drift. opts.reindex=true → an operator-triggered BATCH re-summary of audited
 *              communities at the audit boundary (coarse, per-community) → recovers, at batch cost.
 *
 * The decisive, HONEST contrast (not "STRUCT uniquely recovers" — given its fairest shot each named
 * system can): STRUCT recovers via an IN-ENGINE, per-entry, declarative contract re-assertion at
 * ZERO extra LLM cost and SELECTIVELY (only the violated entries); every named system pays a
 * mechanism-specific tax — paging + coarse over-eviction (MemGPT), an LLM call per record + a
 * recovery lag (Reflexion), or a batch re-summarization (GraphRAG).
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { track, newCounters, finalize, typedKey } = require('./arms.js');

const classOf = ( r ) => `${r.region}|${r.kind}`;            // a (region,kind) class == an audit target == a community

/** Reflexion's Evaluator: a DELAYED failure signal. Pre-audit everything is correct (no signal); post-audit a
 *  stale approval on an audited class is contradicted by the (exogenous) audit → a per-record failure label.
 *  This is the steelman surfacing (Regime 2): Reflexion is NOT handed the audit Set — it must DISCOVER the
 *  drift through an observed failure (hence the recovery lag). Returns {correct,shouldBe} | null. */
function makeFeedback( workload ) {
	return ( rec, action ) => {
		if ( rec.index < workload.auditAt ) return null;                      // pre-audit: no drift to observe
		const want = workload.truth(rec);
		return action === want ? null : { correct: false, shouldBe: want };
	};
}

// ── MEMGPT: tiered memory + self-edit-by-function-call + memory pressure ──────────────────────────
async function memgpt( stream, env, opts = {} ) {
	const surface = opts.surface !== false;                                  // fairest shot by default
	const c = newCounters(), actions = [];
	const core = [];                            // CORE memory: a bounded prose block, rides in EVERY prompt
	const CORE_CAP = 6;                         // exceeding it → a recursive-summary FLUSH (a model turn)
	const archival = new Map();                 // external archival store: typedKey → action
	const revalidated = new Set();              // typed keys of a flagged class already re-decided once (then re-cached)
	let paged = false;
	for ( const r of stream ) {
		const audited = env.workload.activeAuditAt(r.index);
		// FAIREST SHOT: a system/heartbeat event surfaces the exogenous audit; MemGPT can only "see" it by
		// self-editing it into core memory — a function-call = a model TURN (faithful: paging costs a call).
		if ( surface && audited.size && !paged ) {
			paged = true;
			core.push('AUDIT ' + [...audited].join(','));
			await track(c, env, { record: { kind: 'memedit', region: '-', tier: '-', score: '-' }, skillText: core.join(' ; ') });
			if ( core.length > CORE_CAP ) {                                  // memory pressure → recursive summary
				await track(c, env, { record: { kind: 'flush', region: '-', tier: '-', score: '-' }, skillText: core.join(' ; ') });
				core.splice(0, core.length, `summary(${core.length} facts)`);
			}
		}
		const known = new Set(core.filter(( l ) => l.startsWith('AUDIT')).flatMap(( l ) => l.slice(6).split(',')));
		const flagged = known.has(classOf(r));                               // COARSE: the whole (region,kind) class
		const k = typedKey(r);
		const needRedecide = flagged && !revalidated.has(k);                 // re-decide each key of a flagged class ONCE
		if ( archival.has(k) && !needRedecide ) { actions[r.index] = archival.get(k); continue; }   // recall reuse: 0 calls
		// the core blob (skillText) rides in the prompt → its size is measured into tokens/maxContext.
		const action = await track(c, env, { record: r, knownAudited: known, skillText: core.join(' ; ') });
		archival.set(k, action); if ( flagged ) revalidated.add(k); actions[r.index] = action;
	}
	return finalize('MEMGPT', c, actions);
}

// ── REFLEXION: actor → evaluator → self-reflection → bounded episodic memory → retry ──────────────
async function reflexion( stream, env, opts = {} ) {
	const useFeedback = opts.feedback !== false;                             // steelman (Regime 2) by default
	const c = newCounters(), actions = [];
	const memory = new Map();                   // episodic buffer: classKey → [reflection prose]
	const believed = new Set();                 // beliefs distilled from reflections (prose made causal)
	const OMEGA = 3;                            // bounded sliding window (Reflexion caps stored reflections)
	const feedback = env.workload.feedback || makeFeedback(env.workload);
	for ( const r of stream ) {
		const k = classOf(r);
		const skillText = (memory.get(k) || []).join(' ; ');                 // PREPENDED prose → grows ctx (bounded by Ω)
		// ACTOR: an LLM call EVERY record — Reflexion has NO content-addressed decision memo.
		let action = await track(c, env, { record: r, knownAudited: believed, skillText });
		if ( useFeedback ) {
			const sig = feedback(r, action);                                 // EVALUATOR: a delayed audit failure signal
			if ( sig && sig.correct === false ) {
				// SELF-REFLECTION: a model call emitting verbal feedback (charged faithfully via track).
				await track(c, env, { record: r, skillText, forcedAction: sig.shouldBe });
				const buf = memory.get(k) || [];
				buf.push(`${r.region}/${r.kind}: ${sig.shouldBe} (audit non-compliant)`);
				while ( buf.length > OMEGA ) buf.shift();                     // bounded episodic memory
				memory.set(k, buf); believed.add(k);
				// RETRY the task with the fresh reflection prepended (Reflexion's trial loop).
				action = await track(c, env, { record: r, knownAudited: believed, skillText: buf.join(' ; ') });
			}
		}
		actions[r.index] = action;
	}
	return finalize('REFLEXION', c, actions);
}

// ── GRAPHRAG: offline community-summary index + retrieve-then-generate, with a batch re-index path ─
async function graphrag( stream, env, opts = {} ) {
	const reindex = !!opts.reindex;                                          // faithful default = offline, never refreshed
	const c = newCounters(), actions = [];
	const auditAt = env.workload.auditAt;
	const summaries = new Map();                // community → { audited:bool }  (the durable answer artifact)

	// OFFLINE INDEX BUILD over the pre-audit corpus: group records into communities (= typed classes) and
	// summarize each over its full membership (an LLM call; context = the community's members). Blind to the audit.
	const byComm = new Map();
	for ( const r of stream ) if ( r.index < auditAt ) {
		if ( !byComm.has(classOf(r)) ) byComm.set(classOf(r), []);
		byComm.get(classOf(r)).push(r);
	}
	for ( const [comm, members] of byComm ) {
		await track(c, env, { record: { kind: 'summary', region: comm, tier: '-', score: '-' }, history: members.map(( m ) => ({ record: m, action: '-' })) });
		summaries.set(comm, { audited: false });
	}

	let reindexed = false;
	for ( const r of stream ) {
		const comm = classOf(r);
		// a community absent from the offline index (a held-out region) is indexed on first sight.
		if ( !summaries.has(comm) ) {
			await track(c, env, { record: { kind: 'summary', region: comm, tier: '-', score: '-' }, history: [{ record: r, action: '-' }] });
			summaries.set(comm, { audited: false });
		}
		// RE-INDEX (operator-triggered BATCH at the audit boundary): re-summarize audited communities, folding
		// in the audit. Coarse — per community, not per entry; it cannot express a per-approval defeater.
		if ( reindex && !reindexed && r.index >= auditAt ) {
			reindexed = true;
			for ( const [cm, s] of summaries ) if ( env.workload.auditedSet.has(cm) ) {
				const members = byComm.get(cm) || [];
				await track(c, env, { record: { kind: 'resummary', region: cm, tier: '-', score: '-' }, history: members.map(( m ) => ({ record: m, action: '-' })) });
				s.audited = true;
			}
		}
		// DECISION: retrieve the community summary and answer from it (grounded generation = a model call).
		const s = summaries.get(comm);
		const known = s.audited ? new Set([comm]) : new Set();               // the summary "knows" the audit only post-reindex
		const action = await track(c, env, { record: r, knownAudited: known, skillText: `[community ${comm} summary]` });
		actions[r.index] = action;
	}
	return finalize('GRAPHRAG', c, actions);
}

// the headline arms default to their FAIREST shot; the ⊘/↻ variants are the paired ablations / negative controls.
const NAMED_ARMS = {
	MEMGPT: ( s, e ) => memgpt(s, e, { surface: true }),
	'MEMGPT-BLIND': ( s, e ) => memgpt(s, e, { surface: false }),
	REFLEXION: ( s, e ) => reflexion(s, e, { feedback: true }),
	'REFLEXION-BLIND': ( s, e ) => reflexion(s, e, { feedback: false }),
	GRAPHRAG: ( s, e ) => graphrag(s, e, { reindex: false }),
	'GRAPHRAG-REINDEX': ( s, e ) => graphrag(s, e, { reindex: true }),
};

module.exports = { NAMED_ARMS, memgpt, reflexion, graphrag, makeFeedback, classOf };
