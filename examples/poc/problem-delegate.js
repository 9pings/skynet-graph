/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * FLAGSHIP — SUB-PROBLEM DELEGATION to a forked SUB-AGENT (the Level-1 "possible-worlds" regime). When a
 * segment is a self-contained, hard sub-problem, the grammar does not decompose it inline: a `Delegate`
 * concept FORKS an independent sub-graph (a sub-agent in its own world, with its OWN concept pool /
 * capability), seeds it with ONLY the local context (the sub-problem's endpoint states + the adjacent
 * hand-off), runs it to a fixpoint, and MERGES BACK ONLY the bounded plan through a SNAPPED FRONTIER —
 * the sub-agent's internal segments / candidates / scores stay in the fork and never pollute the parent.
 * This is the engine's bounded-context promise applied to delegation: the parent's plan carries a one-line
 * summary of a whole sub-problem; the elaboration lived (and died) in the fork.
 *
 * Two capabilities coexist in ONE provider registry under DISTINCT namespaces (`P::` for the parent,
 * `Sub::` for the sub-agent) — so the sub-agent can run a DIFFERENT grammar/content (e.g. the DAG
 * migration solver) with NO global state swap. The frontier crossing is CHECKED (`validateMergeProjection`
 * via `fork-driver`), so an internal fact cannot leak across the sub-graph boundary.
 *
 *   node examples/poc/problem-delegate.js                 (deterministic: parent delegates a DB-migration sub-problem to the DAG sub-agent)
 *   MODE=llm LLM_NO_THINK=1 LLM_BASE=http://localhost:5000 LLM_MODEL=qwen36-q2-vram node examples/poc/problem-delegate.js
 */
global.__SERVER__ = true;
const Graph = require('../../lib/graph/index.js');
const { nextStable } = require('../../lib/authoring/supervise.js');
const { providers, conceptTree, pathSteps } = require('./problem-paths.js');
const { checkedProjection } = require('./fork-driver.js');
const { makeDagDomainContent, LABEL } = require('./problem-domain-dag.js');

const out = (...a) => process.stdout.write(a.join(' ') + '\n');

// the parent grammar = the base problem-paths grammar + a Delegate concept (fires on a flagged segment).
const delegateTree = { common: { childConcepts: Object.assign({}, conceptTree.common.childConcepts, {
	Delegate: { _id: 'Delegate', _name: 'Delegate', require: ['Segment', 'toDelegate', 'originNode:reached'], provider: ['P::delegate'] }   // gated in PATH ORDER, like Resolve, so the sub-agent gets the adjacent hand-off
}) } };

// the SUB-AGENT's concept pool: the same base grammar but under the `Sub::` provider namespace, so it can
// run a different content (capability) alongside the parent without a global swap.
function namespaced( tree, ns ) {
	const copy = JSON.parse(JSON.stringify(tree));
	(function walk( node ) {
		if ( node.provider ) node.provider = node.provider.map((p) => typeof p === 'string' ? p.replace(/^P::/, ns + '::') : p);
		if ( node.childConcepts ) Object.keys(node.childConcepts).forEach((k) => walk(node.childConcepts[k]));
	})(copy.common ? copy.common : copy);
	return copy;
}
const subTree = namespaced(conceptTree, 'Sub');

/**
 * The Delegate provider. `subStats` accrues delegation accounting. The sub-agent's capability is whatever
 * is registered under `Sub::` (set up by `solveWithDelegation`). Only the declared `frontier` keys cross.
 */
function makeDelegate( subStats ) {
	const frontier = ['Delegate', 'step', 'subStepCount', 'reached'];        // the snapped interface OUT
	return function delegate( graph, concept, scope, argz, cb ) {
		const seg = scope._;
		// local context IN: the sub-problem's endpoint states + the adjacent hand-off (origin.reached).
		const oN = graph.getEtty(seg.originNode)._, tN = graph.getEtty(seg.targetNode)._;
		const subStart = seg.subStart != null ? seg.subStart : oN.state;
		const subGoal  = seg.subGoal  != null ? seg.subGoal  : tN.state;
		const handoff  = oN.reached != null ? oN.reached : ('start: ' + subStart);
		const sNode = { _id: 'S', Node: true, state: subStart, isStart: true, reached: handoff };
		const gNode = { _id: 'G', Node: true, state: subGoal, isGoal: true };
		if ( seg.subStartKind ) sNode.kind = seg.subStartKind;               // typed sub-problem (e.g. the DAG migration)
		if ( seg.subGoalKind ) gNode.kind = seg.subGoalKind;
		const childSeed = { lastRev: 0, nodes: [sNode, gNode],
			segments: [{ _id: 'root', Segment: true, Root: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, label: 'sub: ' + (seg.label || seg._id) }] };

		const child = graph.fork(childSeed, { conceptMap: subTree, label: 'sub-agent:' + seg._id });
		nextStable(child).then(function () {
			const cr = child.getEtty('root')._, steps = pathSteps(child, 'S', 'G');
			subStats.delegations++; subStats.subSteps += steps.length;
			// snapped frontier OUT: the parent sees ONLY the bounded plan + the hand-off forward.
			const project = ( ch ) => [
				{ $_id: '_parent', Delegate: true, step: '⟦delegated⟧ ' + (cr.solution || steps.join(' / ')), subStepCount: steps.length },
				{ $$_id: seg.targetNode, reached: cr.solution || steps.join(' / ') }
			];
			// validate the boundary BEFORE crossing — an internal fact would throw frontier-leak.
			const tpl = project(child);
			tpl.forEach(function ( t ) { checkedProjection(() => t, frontier.concat(['$_id', '$$_id', 'originNode', 'targetNode'])); });
			child.destroy();
			cb(null, tpl);
		}).catch(function ( e ) { child && child.destroy && child.destroy(); cb(e); });
	};
}

/**
 * Solve a parent problem whose content may flag sub-segments for delegation (via a `plan` returning
 * `{ delegate: {from,to,startKind?,goalKind?} }`). `parentC` is the parent capability, `subC` the
 * sub-agent capability — registered under `P::` and `Sub::` so both run in the same process, no swap.
 */
async function solveWithDelegation( problem, parentC, subC, opts ) {
	opts = opts || {};
	const subStats = { delegations: 0, subSteps: 0 };
	const P = providers(parentC, opts.parent || {}).P;
	const Sub = providers(subC, opts.sub || {}).P;
	Graph._providers = { P: Object.assign({}, P, { delegate: makeDelegate(subStats) }), Sub };

	const sNode = { _id: 'S', Node: true, state: problem.start, isStart: true, reached: 'start: ' + problem.start };
	const gNode = { _id: 'G', Node: true, state: problem.goal, isGoal: true };
	if ( problem.startKind ) sNode.kind = problem.startKind;
	if ( problem.goalKind ) gNode.kind = problem.goalKind;
	const seed = { lastRev: 0, nodes: [sNode, gNode],
		segments: [{ _id: 'root', Segment: true, Root: true, originNode: 'S', targetNode: 'G', depth: 0, onPath: true, label: 'solve the problem' }] };
	const g = new Graph(seed, { label: opts.label || 'delegate', isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, delegateTree);
	await nextStable(g);
	const root = g.getEtty('root')._;
	return { graph: g, steps: pathSteps(g, 'S', 'G'), solution: root && root.solution, subStats };
}

// ---- DEMO parent content: deliver a feature, where the DB-migration sub-problem is DELEGATED to the DAG sub-agent ----
const SPEC = 'a feature spec needing a schema change', NEEDS = 'the database needs migrating', SHIPPED = 'the feature shipped';
function makeParentContent() {
	// a small ordered delivery: a prep step, then the migration sub-problem (delegated to the DAG sub-agent).
	return {
		plan: async ( { from, to } ) => {
			if ( from === SPEC && to === SHIPPED ) return { mids: [{ state: NEEDS }] };       // root → prep, then ship
			if ( from === NEEDS && to === SHIPPED )                                            // THIS sub-problem is delegated to the DAG sub-agent
				return { delegate: { from: LABEL.current, to: LABEL.migrated, startKind: 'current', goalKind: 'migrated' } };
			return { atomic: true };                                                          // segA (spec → needs-migrating) is a direct prep step
		},
		score: async () => 0,
		resolve: async ( { from, to } ) => `${from}  ⇒  ${to}`,
		summarize: async ( steps ) => `Delivery (${steps.length} steps):\n   - ` + steps.join('\n   - ')
	};
}

async function main() {
	const mode = process.env.MODE || 'stub';
	out(`\nFLAGSHIP problem-delegate — a parent delegates a self-contained sub-problem to a forked SUB-AGENT  (mode=${mode})\n`);
	const parentC = makeParentContent();
	const subC = makeDagDomainContent({ zeroDowntime: true });   // the DAG sub-agent solves current→migrated in-vocabulary (0 LLM)

	const r = await solveWithDelegation(
		{ start: 'a feature spec needing a schema change', goal: 'the feature shipped' },
		parentC, subC, { sub: { maxDepth: 16, alts: 3 }, label: 'delegate-demo' });

	out('PARENT plan (the delegated sub-problem appears as ONE bounded step):');
	r.steps.forEach((s, i) => out(`   ${i + 1}. ${s}`));
	out(`\n   delegations: ${r.subStats.delegations}   (sub-steps solved in the fork, NOT in the parent: ${r.subStats.subSteps})`);
	out(`   parent objects: ${Object.keys(r.graph._objById).length}  (the sub-agent's internal objects were destroyed with the fork)\n`);
}

module.exports = { solveWithDelegation, delegateTree, subTree, makeParentContent, namespaced };
if ( require.main === module ) main().catch((e) => { console.error(e); process.exit(1); });
