'use strict';
/*
 * Copyright 2026 Nathanael Braun <pp9ping@gmail.com>
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
/**
 * plan — the ROADMAP instance-type descriptor (R9 of the instance service): a named persistent
 * PLAN agents grow and complete over days, read by bounded projection — the structured task-memory
 * pillar as a workspace. The HOST declares the steps (the division of labor that holds since R1a:
 * the small model as decomposer is a published negative); the type guarantees the STRUCTURE:
 *
 *   create({task, steps?})      steps = [{id, title, needs?: [ids]}] — the needs wiring is checked
 *       OFFLINE at the door (a step needing what nobody produces = the whole batch REFUSED, typed
 *       + NAMED, the C7 invariant carried to the persistent plan). A refused create throws; a
 *       refused action returns {refused, reason} through the runner.
 *   addSteps {steps}            append steps (same check against current+new; duplicate id refused)
 *   update {step, title}        retitle a step (`step` = the step id — the name `id` is the tool
 *       envelope's instance id, a collision the MCP generation refuses fail-closed)
 *   complete {step}             open → done (attributed — the atoms keep who did what)
 *   reopen {step, reason?}      done → open with a reason — what the sync mirrors as the JTMS-style
 *       `reopen` op (v1: explicit; premise-drift auto-retraction = a later rung, consigned)
 *   snapshot (read)             {task, steps, counts, frontier} — frontier = open steps whose needs
 *       are ALL done (what is actionable NOW)
 *   sync {mirror?} (read)       plan_sync AS AN ACTION on the persistent plan: diffPlanToTaskOps
 *       (task-mirror, reused verbatim) between this plan and the CALLER's mirror — the mirror
 *       state belongs to each host (its own native task list), the PLAN is the shared instance.
 *       Feed the returned `mirror` back on the next call; ops: create/update/complete/reopen.
 *
 * `by` on a step fact = the LAST writer at the door (R2 conflict policy: last-writer on the fact,
 * full history in the revision atoms — `instances_revisions` names every author). No clocks, no
 * minted ids (`step-<id>` literal) — replay-deterministic. Zero grammar: the alphabet is plain
 * typed facts (Plan / PlanStep / sid / title / needs / status / reason). [ZERO-CORE]
 */
function requireEither( pkgName, relPath ) {
	try { return require(pkgName); }
	catch ( e ) { if ( e.code !== 'MODULE_NOT_FOUND' ) throw e; return require(relPath); }
}
const { diffPlanToTaskOps } = requireEither('skynet-graph/lib/authoring/core/task-mirror.js', '../../lib/authoring/core/task-mirror.js');

const sidOf = ( s ) => String(s && s.id != null ? s.id : '').trim();

/** Normalize + check a step batch against the already-present sids. Returns {steps}|{refused,reason}. */
function checkSteps( incoming, presentSids ) {
	const steps = [];
	const all = new Set(presentSids);
	for ( const s of incoming || [] ) {
		const sid = sidOf(s);
		const title = String(s && s.title || '').trim();
		if ( !sid || !title ) return { refused: true, reason: 'each step needs {id, title} (got id="' + sid + '", title="' + title + '")' };
		if ( all.has(sid) ) return { refused: true, reason: 'duplicate step id "' + sid + '"' };
		all.add(sid);
		steps.push({ sid, title, needs: (Array.isArray(s.needs) ? s.needs : []).map(String) });
	}
	// the OFFLINE needs pre-check (the C7 invariant): every need must be produced by SOME step
	const missing = [];
	steps.forEach(( s ) => s.needs.forEach(( n ) => { if ( !all.has(n) ) missing.push({ step: s.sid, needs: n }); }) );
	if ( missing.length )
		return { refused: true, reason: 'needs nobody produces: ' + missing.map(( m ) => m.step + ' needs "' + m.needs + '"' ).join(' · ') };
	return { steps };
}

const stepTpl = ( s ) => ({ $$_id: 'step-' + s.sid, PlanStep: true, sid: s.sid, title: s.title, needs: s.needs, status: 'open' });

/** All PlanStep facts, sid-ordered (stable projection). */
function readSteps( g ) {
	return Object.keys(g._objById)
		.map(( id ) => g.getEtty(id) )
		.filter(( e ) => e && e.get('PlanStep') )
		.map(( e ) => ({ id: e.get('sid'), title: e.get('title'), needs: e.get('needs') || [], status: e.get('status'),
			by: e.get('by'), ...(e.get('reason') ? { reason: e.get('reason') } : {}) }) )
		.sort(( a, b ) => a.id < b.id ? -1 : 1);
}
function snapshot( g ) {
	const steps = readSteps(g);
	const done = new Set(steps.filter(( s ) => s.status === 'done' ).map(( s ) => s.id ));
	const frontier = steps.filter(( s ) => s.status === 'open' && s.needs.every(( n ) => done.has(n) )).map(( s ) => s.id );
	const counts = { open: 0, done: 0 };
	steps.forEach(( s ) => { counts[s.status] = (counts[s.status] || 0) + 1; });
	const plan = g.getEtty('plan');
	return { task: plan && plan.get('task'), steps, counts, frontier };
}
/** A status transition template, or a NAMED refusal. */
function transition( g, id, from, to, extra ) {
	const sid = String(id || '').trim();
	const e = g.getEtty('step-' + sid);
	if ( !e || !e.get('PlanStep') ) return { refused: true, reason: 'unknown step "' + sid + '"' };
	if ( e.get('status') !== from ) return { refused: true, reason: 'step "' + sid + '" is ' + e.get('status') + ', not ' + from };
	return [{ $$_id: 'step-' + sid, status: to, ...(extra || {}) }];
}

module.exports = {
	type       : 'plan',
	version    : '1.0.0',
	conceptSets: [],
	concurrency: ['shared-sequenced', 'fork-merge'],

	create: function ( seed ) {
		const task = String(seed && seed.task || '').trim();
		if ( !task ) throw new Error('plan: seed.task is required');
		const r = checkSteps(seed && seed.steps, []);
		if ( r.refused ) throw new Error('plan: ' + r.reason);
		return [{ $$_id: 'plan', Plan: true, task }].concat(r.steps.map(stepTpl));
	},

	actions: {
		addSteps: {
			write: true, input: { steps: 'array' },
			apply: function ( g, args ) {
				const r = checkSteps(args.steps, readSteps(g).map(( s ) => s.id ));
				if ( r.refused ) return r;
				if ( !r.steps.length ) return null;
				return r.steps.map(stepTpl);
			}
		},
		update: {
			write: true, input: { step: 'string', title: 'string' },
			apply: function ( g, args ) {
				const title = String(args.title || '').trim();
				if ( !title ) return { refused: true, reason: 'update needs a non-empty title' };
				const sid = String(args.step || '').trim();
				const e = g.getEtty('step-' + sid);
				if ( !e || !e.get('PlanStep') ) return { refused: true, reason: 'unknown step "' + sid + '"' };
				return [{ $$_id: 'step-' + sid, title: title }];
			}
		},
		complete: {
			write: true, input: { step: 'string' },
			apply: ( g, args ) => transition(g, args.step, 'open', 'done')
		},
		reopen: {
			write: true, input: { step: 'string', reason: 'string?' },
			apply: ( g, args ) => transition(g, args.step, 'done', 'open',
				{ reason: String(args.reason || 'premise drifted (reopened)') })
		},
		snapshot: { write: false, input: {}, project: snapshot },
		sync: {
			write: false, input: { mirror: 'object?' },
			project: function ( g, args ) {
				return diffPlanToTaskOps(snapshot(g), (args && args.mirror) || null);
			}
		}
	},

	projections: {
		summary: function ( g ) {
			const s = snapshot(g);
			return { task: s.task, counts: s.counts, frontier: s.frontier };
		}
	}
};
