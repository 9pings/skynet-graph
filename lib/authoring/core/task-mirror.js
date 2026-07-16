/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * task-mirror — the graph plan DRIVES the host agent's native task list (owner 2026-07-10). The graph instance is
 * the authoritative multistep state (typed steps, needs/produces, frontier, JTMS); agent hosts (Claude Code,
 * OpenCode, …) have their own task tools. MCP is host→server — a server cannot invoke host tools — so the correct
 * realization is a TYPED DELTA the host applies VERBATIM to its own task system, AT ITS OWN CHOICE (SOFT lane,
 * pull-based: the LLM calls the sync when it wants a mirror, or never).
 *
 * `diffPlanToTaskOps(plan, mirror)` → { ops, mirror } — pure, deterministic (id-ordered), idempotent (same state
 * twice → empty delta). Neutral op vocabulary, host-agnostic:
 *   {op:'create',  id, subject, blockedBy[]}   a new step (blockedBy = its still-open needs)
 *   {op:'update',  id, subject}                the step title changed
 *   {op:'complete',id}                         the step reached done (a GATE-ADMITTED result, not a claim)
 *   {op:'reopen',  id, reason}                 ⟐ the JTMS differentiator: a completed step whose premise DRIFTED
 *                                              was retracted → the mirrored task must reopen. No host does this.
 * A step that VANISHES from the plan emits nothing (the mirror keeps it; the host decides its own hygiene).
 *
 * @param plan    { steps: [{ id, title, needs: [ids], status: 'open'|'done'|'retracted', reason? }] }
 * @param mirror  the previous return's `mirror` (or null on first sync).
 * @returns { ops: [...], mirror }   — feed `mirror` back on the next call.
 */
function diffPlanToTaskOps( plan, mirror ) {
	var steps = (plan && plan.steps || []).slice().sort(function ( a, b ) { return a.id < b.id ? -1 : 1; });
	var prev = (mirror && mirror.tasks) || {};
	var ops = [], tasks = {};
	var open = {}; steps.forEach(function ( s ) { if ( s.status !== 'done' ) open[s.id] = true; });
	steps.forEach(function ( s ) {
		var p = prev[s.id];
		var status = s.status === 'done' ? 'done' : 'open';
		if ( !p ) {
			ops.push({ op: 'create', id: s.id, subject: s.title, blockedBy: (s.needs || []).filter(function ( n ) { return open[n]; }) });
			if ( s.status === 'done' ) ops.push({ op: 'complete', id: s.id });
		} else {
			if ( p.subject !== s.title ) ops.push({ op: 'update', id: s.id, subject: s.title });
			if ( p.status !== 'done' && s.status === 'done' ) ops.push({ op: 'complete', id: s.id });
			if ( p.status === 'done' && s.status !== 'done' ) ops.push({ op: 'reopen', id: s.id, reason: s.reason || 'premise drifted (JTMS retraction)' });
		}
		tasks[s.id] = { subject: s.title, status: status };
	});
	// steps gone from the plan stay in the mirror untouched (no phantom deletes pushed at the host).
	Object.keys(prev).forEach(function ( id ) { if ( !tasks[id] ) tasks[id] = prev[id]; });
	return { ops: ops, mirror: { tasks: tasks } };
}

module.exports = { diffPlanToTaskOps: diffPlanToTaskOps };
