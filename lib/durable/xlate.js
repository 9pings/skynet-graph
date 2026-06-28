/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * xlate — C-xlate v0 (the conception's "translation" step, component C-xlate). Compile ONE skynet method into a
 * WORKFLOW-NET definition the durable executor (`checkpoint-store.js` + `interpreter.js`) runs over a stream of
 * case records. This is the bridge from the BUILT/validated method (the belief-view, decidable, traceable) to
 * the EXECUTE side (durable, mass, crash-resumable) — the §0.1 build/execute separation.
 *
 * The method SPEC is the compact declarative form of the Brick-1/3 example (`tests/integration/method-select`):
 *   {
 *     name,
 *     select: { on?:[factKeys], rules:[{ when:"<expr over typed case facts>", method }], fallback:<methodName> },
 *     methods: {
 *       <name>: {
 *         steps?: [{ task:"Ns::fn" }],            // a linear path of micro-tasks (the for/fold path)
 *         map?:   { over:"<collKey>", body:[{ task }], elemKey?:"elem", empty?:"<place>",
 *                   reduce?: { monoid:"sum"|… , key?, into? } | { task:"Ns::fold" } }   // Brick-1 fan-out + fan-IN
 *       }
 *     }
 *   }
 *
 * compileMethod → a net { start, sinks, fail, transitions:[ ... ] } where a transition is one of:
 *   { kind:'select', from, gates:[{ when, to }], fallback }   typed routing (selectCluster's gates → places)
 *   { kind:'task',   from, task, to }                         a provider micro-task step (memoized by Layer B)
 *   { kind:'map',    from, over, elemKey, bodyStart, empty }  unordered FAN-OUT, one child token per element
 *   { kind:'join',   from, foldPlace }                        the cardinality JOIN (fan-in): park until all
 *                                                             siblings arrive, then spawn ONE collector (Layer A)
 *   { kind:'fold',   from, reduce, to }                       reduce the collected siblings → one value (Layer B)
 *
 * v0 scope (honest, per §4B / §9.2): select + linear task paths + map FAN-OUT, and — NEW — the fold-back /
 * cardinality JOIN (`map.reduce`): the body's last step routes to a join place, the completing arrival spawns a
 * collector, the fold reduces it (a declared monoid = pure/order-independent, or a micro-task). A `map` WITHOUT a
 * `reduce` is the prior behaviour (each element flows to a sink independently — no rejoin).
 */

const START = 'start', DONE = 'done', FAIL = 'failed';

function entryOf( method ) { return '@' + method; }          // a method's in-place (distinct from step/body places)

/**
 * Compile a method spec → a workflow-net def. Pure (no IO). Throws on a malformed spec.
 */
function compileMethod( spec ) {
	if ( !spec || !spec.methods ) throw new Error('compileMethod: spec.methods is required');
	const transitions = [];
	const sel = spec.select;

	if ( sel ) {
		const gates = (sel.rules || []).map(( r ) => {
			if ( !r.when || !r.method ) throw new Error('compileMethod: a select rule needs { when, method }');
			if ( !spec.methods[r.method] ) throw new Error(`compileMethod: select rule routes to unknown method "${r.method}"`);
			return { when: r.when, to: entryOf(r.method) };
		});
		if ( sel.fallback && !spec.methods[sel.fallback] ) throw new Error(`compileMethod: fallback method "${sel.fallback}" is undefined`);
		transitions.push({ id: 'select', from: START, kind: 'select', gates, fallback: sel.fallback ? entryOf(sel.fallback) : FAIL });
	}

	for ( const m of Object.keys(spec.methods) ) compileBody(m, spec.methods[m], transitions);

	// with no select, the single method is the entry — wire start → its in-place via a no-op task.
	if ( !sel ) {
		const names = Object.keys(spec.methods);
		if ( names.length !== 1 ) throw new Error('compileMethod: a spec without a `select` must have exactly one method');
		transitions.unshift({ id: 'enter', from: START, kind: 'task', task: null, to: entryOf(names[0]) });
	}

	const net = { start: START, sinks: [DONE], fail: FAIL, transitions };
	const issues = validateNet(net);
	if ( issues.length ) throw new Error('compileMethod: malformed net — ' + issues.join('; '));
	return net;
}

function compileBody( m, def, transitions ) {
	def = def || {};
	const steps = def.steps || [];
	let place = entryOf(m);

	steps.forEach(( step, i ) => {
		const last = i === steps.length - 1 && !def.map;
		const to = last ? DONE : (m + '#' + (i + 1));
		transitions.push({ id: m + '.s' + i, from: place, kind: 'task', task: step.task != null ? step.task : null, to });
		place = to;
	});

	if ( def.map ) {
		const map = def.map;
		if ( !map.over ) throw new Error(`compileMethod: map in method "${m}" needs an \`over\` collection key`);
		const reduce = map.reduce;
		const joinPlace = m + '@join', foldPlace = m + '@fold';
		const bodyEnd = reduce ? joinPlace : DONE;                // with a reduce, the body REJOINS at the join place
		const bsteps = map.body || [];
		const bodyStart = bsteps.length ? (m + '@body') : bodyEnd;
		// empty collection: with a reduce, still produce the monoid IDENTITY (route to the fold over [] siblings).
		transitions.push({ id: m + '.map', from: place, kind: 'map', over: map.over, elemKey: map.elemKey || 'elem',
			bodyStart, empty: map.empty || (reduce ? foldPlace : DONE) });
		let bp = bodyStart;
		bsteps.forEach(( step, i ) => {
			const to = i === bsteps.length - 1 ? bodyEnd : (m + '@body#' + (i + 1));
			transitions.push({ id: m + '.body.s' + i, from: bp, kind: 'task', task: step.task != null ? step.task : null, to });
			bp = to;
		});
		if ( reduce ) {                                          // the fan-IN: park-until-complete → spawn collector → fold
			transitions.push({ id: m + '.join', from: joinPlace, kind: 'join', foldPlace });
			transitions.push({ id: m + '.fold', from: foldPlace, kind: 'fold', reduce, to: DONE });
		}
	} else if ( !steps.length ) {
		transitions.push({ id: m + '.noop', from: place, kind: 'task', task: null, to: DONE });  // a degenerate empty method
	}
}

/**
 * Structural lint (validate the STRUCTURE, not the grammar — methodology §0.6): every place a transition routes
 * TO must be a sink/fail or have its own outgoing transition (no dangling place that strands a token); no two
 * transitions share a `from` place (the marking is 1-out per place — `select` is the only multi-way, via gates).
 * @returns string[] of issues (empty = sound).
 */
function validateNet( net ) {
	const issues = [], froms = new Set(), terminals = new Set([].concat(net.sinks || [], net.fail || []));
	const targets = [];
	for ( const t of net.transitions ) {
		if ( froms.has(t.from) ) issues.push(`two transitions leave place "${t.from}" (marking is 1-out per place)`);
		froms.add(t.from);
		if ( t.kind === 'select' ) { (t.gates || []).forEach(( g ) => targets.push(g.to)); if ( t.fallback ) targets.push(t.fallback); }
		else if ( t.kind === 'map' ) { targets.push(t.bodyStart); targets.push(t.empty); }
		else if ( t.kind === 'join' ) targets.push(t.foldPlace);
		else targets.push(t.to);                                // task / fold
	}
	for ( const tgt of targets ) if ( !terminals.has(tgt) && !froms.has(tgt) )
		issues.push(`place "${tgt}" is routed-to but has no outgoing transition and is not a sink`);
	if ( !froms.has(net.start) ) issues.push(`the start place "${net.start}" has no outgoing transition`);
	return issues;
}

// index transitions by their `from` place (one per place) — the interpreter's dispatch table.
function indexByFrom( net ) {
	const byFrom = {};
	for ( const t of net.transitions ) byFrom[t.from] = t;
	return byFrom;
}

module.exports = { compileMethod, validateNet, indexByFrom, entryOf, places: { START, DONE, FAIL } };
