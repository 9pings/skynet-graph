'use strict';
/*
 * F6 / U1 — CROSS-PROBLEM STRUCTURAL TRANSFER, measured on the REAL engine.
 *
 * The decisive-experiment gate (study §7/§9) PASSED on the F6-INDEPENDENT pillars and put F6 ON the
 * critical path: finding #30 — a STRUCTURAL decision (one that CREATES a sub-graph: an intermediate node
 * + child segments) bakes ABSOLUTE object ids at derivation time, so the flat content-addressed cache
 * (`providers/cache.js`) cannot transfer it to a related-but-DIFFERENT problem (replaying the stored
 * absolute ids injects the wrong id-space → unsound / crash). The E0 cross-problem-structural-transfer
 * number is therefore 0 today.
 *
 * THIS experiment makes that number NON-ZERO and SOUND, via `authoring/abstract.js#methodTransform`
 * (relativize-on-store / bind-on-replay), keyed on the TYPED K1 signature. Three engine runs of the SAME
 * one-level structural decomposition, each in its OWN id-space (so transfer is genuinely cross-problem):
 *
 *   A : kindX → kindY   (cold — the model decides the method; cost 1)
 *   B : kindX → kindY   (SAME typed transition, DIFFERENT node ids/states — the transfer target)
 *   C : kindP → kindQ   (DIFFERENT transition — the NEGATIVE CONTROL: must pay, no false replay)
 *
 * compared across three cache modes:
 *   (none) no cache              — A,B,C each pay (the baseline)
 *   (flat) cache keyed on {X,Y}  — B HITS but replays A's ABSOLUTE ids → UNSOUND (reproduces #30 live)
 *   (F6)   flat key + transform  — B replays at 0 calls, REBASED onto B's id-space (sound); C still pays
 */
global.__SERVER__ = true;
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const Graph = require(ROOT + '/lib/graph/index.js');
const { nextStable } = require(ROOT + '/lib/authoring/supervise.js');
const { createProviderCache } = require(ROOT + '/lib/providers/cache.js');
const { methodTransform } = require(ROOT + '/lib/authoring/abstract.js');
const out = ( ...a ) => process.stdout.write(a.join(' ') + '\n');

// the grammar: ONE structural decomposition. Plan fires on a Segment flagged `toPlan`; it inserts an
// intermediate node + two child segments (atomic — they carry no `toPlan`, so Plan does not recurse).
const conceptTree = { common: { childConcepts: {
	Plan: { _id: 'Plan', _name: 'Plan', require: ['Segment', 'toPlan'], provider: ['P::plan'] }
} } };

// the model-stand-in: `plan` is COUNTED (each call = one model call). It reads the typed endpoint KINDS
// (the K1 signature) and emits a STRUCTURAL template with ABSOLUTE ids derived from the cast segment id
// and wired to the cast segment's endpoints — exactly the #30 shape.
function countingPlan() {
	const n = { calls: 0 };
	function plan( graph, concept, scope, argz, cb ) {
		n.calls++;
		const seg = scope._, base = seg._id;
		const mid = base + '_m0';
		// the model "decides" the intermediate's kind/state from the typed transition (the cached content).
		const interKind = seg.originKind + '~' + seg.targetKind;
		cb(null, [
			{ $_id: '_parent', Plan: true, Decomposed: true },
			{ _id: mid, Node: true, kind: interKind, state: 'mid<' + seg.originKind + '→' + seg.targetKind + '>' },
			{ _id: base + '_a0', Segment: true, originNode: seg.originNode, targetNode: mid, parentSeg: base, label: 'A' },
			{ _id: base + '_b0', Segment: true, originNode: mid, targetNode: seg.targetNode, parentSeg: base, label: 'B' }
		]);
	}
	return { plan, n };
}

// the TYPED signature key (the K1 surface): two problems with the same kind-transition share a key.
const sigKey = ( g, c, s ) => ({ originKind: s._.originKind, targetKind: s._.targetKind });
// where the call-site frontier ids live on the cast segment (for relativize/instantiate).
const transform = methodTransform({ frontier: { origin: 'originNode', target: 'targetNode' } });

// a problem in its OWN id-space: prefix every id so A/B/C never share a node — genuine cross-problem.
function seedFor( p ) {
	const S = p.pfx + 'S', G = p.pfx + 'G', R = p.pfx + 'root';
	return { lastRev: 0,
		nodes: [{ _id: S, Node: true, kind: p.fromKind, state: p.from }, { _id: G, Node: true, kind: p.toKind, state: p.to }],
		segments: [{ _id: R, Segment: true, originNode: S, targetNode: G, toPlan: true, originKind: p.fromKind, targetKind: p.toKind, depth: 0 }] };
}

async function runProblem( p, providers ) {
	Graph._providers = providers;
	const g = new Graph(seedFor(p), { label: p.pfx, isMaster: true, autoMount: true, conceptSets: ['common'], bagRefManagers: {}, logLevel: 'error' }, conceptTree);
	let crashed = null;
	try { await nextStable(g); } catch ( e ) { crashed = e.message; }
	return { graph: g, crashed };
}

// inspect the decomposition that landed in problem p's graph: the intermediate node + its two child
// segments, and whether every structural id stays inside p's OWN id-space (soundness).
function inspect( g, p ) {
	const S = p.pfx + 'S', G = p.pfx + 'G', R = p.pfx + 'root';
	const ids = Object.keys(g._objById);
	const mid = g.getEtty(R + '_m0'), a0 = g.getEtty(R + '_a0'), b0 = g.getEtty(R + '_b0');
	const created = ids.filter(( id ) => /_(m|a|b)\d/.test(id));
	// SOUND iff: the rebased objects exist under p's base, a0 wires p.S→mid, b0 wires mid→p.G, and NO
	// created id or wiring references a foreign id-space (a different problem's prefix).
	const foreignPrefix = ( v ) => typeof v === 'string' && /^(A|B|C)/.test(v) && v.indexOf(p.pfx) !== 0 && /^(A|B|C)(S|G|root)/.test(v);
	const wiredOk = !!(a0 && b0 && a0._.originNode === S && a0._.targetNode === R + '_m0' && b0._.originNode === R + '_m0' && b0._.targetNode === G);
	const noForeign = created.every(( id ) => id.indexOf(p.pfx) === 0 ) &&
		[a0, b0].every(( s ) => s && !foreignPrefix(s._.originNode) && !foreignPrefix(s._.targetNode));
	const decomposed = !!(mid && a0 && b0);
	return { decomposed, wiredOk, sound: decomposed && wiredOk && noForeign, created, interKind: mid && mid._.kind };
}

async function mode( label, problems, makeProviders ) {
	const plan = countingPlan();
	const providers = makeProviders(plan);
	const rows = [];
	for ( const p of problems ) {
		const before = plan.n.calls;
		const { graph, crashed } = await runProblem(p, providers);
		const cost = plan.n.calls - before;
		const ins = crashed ? { decomposed: false, wiredOk: false, sound: false, created: [], interKind: null } : inspect(graph, p);
		rows.push({ p: p.pfx, cost, crashed, ins });
	}
	return { label, rows };
}

async function main() {
	out('\nF6 / U1 — cross-problem STRUCTURAL transfer (the E0/#30 number, today 0 → non-zero + sound)\n');
	const problems = [
		{ pfx: 'A', fromKind: 'X', toKind: 'Y', from: 'x0', to: 'y0' },
		{ pfx: 'B', fromKind: 'X', toKind: 'Y', from: 'x1', to: 'y1' },   // same typed transition, different id-space
		{ pfx: 'C', fromKind: 'P', toKind: 'Q', from: 'p0', to: 'q0' }    // different transition (negative control)
	];

	const none = await mode('none ', problems, ( plan ) => ({ P: { plan: plan.plan } }));
	const flat = await mode('flat ', problems, ( plan ) => { const cache = createProviderCache(); return { P: cache.wrapFragment({ P: { plan: plan.plan } }, { 'P::plan': sigKey }).P }; });
	const f6   = await mode('F6   ', problems, ( plan ) => { const cache = createProviderCache(); return { P: cache.wrapFragment({ P: { plan: plan.plan } }, { 'P::plan': sigKey }, { 'P::plan': transform }).P }; });

	for ( const m of [none, flat, f6] ) {
		out(`mode ${m.label}:`);
		for ( const r of m.rows ) {
			const tag = r.crashed ? `CRASH (${r.crashed.slice(0, 48)})` : (r.ins.sound ? 'sound' : (r.ins.decomposed ? 'UNSOUND (foreign id-space)' : 'no decomposition'));
			out(`   ${r.p}: ${r.cost} model-call(s)   ${tag}` + (r.ins.created.length ? `   created=[${r.ins.created.join(',')}]` : ''));
		}
		out('');
	}

	const B = ( m ) => m.rows.find(( r ) => r.p === 'B' );
	const C = ( m ) => m.rows.find(( r ) => r.p === 'C' );
	out('VERDICT:');
	out(`  • baseline (no cache):    B pays ${B(none).cost}  (every problem re-derives the method)`);
	out(`  • flat cache (#30 live):  B ${flat.rows.find(r=>r.p==='B').crashed ? 'CRASHES' : 'is ' + (B(flat).ins.sound ? 'sound?!' : 'UNSOUND')}  — replaying A's absolute ids into B's id-space`);
	out(`  • F6 transform:           B pays ${B(f6).cost}  and is ${B(f6).ins.sound ? 'SOUND (rebased onto B)' : 'UNSOUND'};  C (neg. control) pays ${C(f6).cost}`);
	const win = B(f6).cost === 0 && B(f6).ins.sound && C(f6).cost === 1 && (flat.rows.find(r=>r.p==='B').crashed || !B(flat).ins.sound);
	out(`\n  ⇒ cross-problem STRUCTURAL transfer is now SOUND + NON-ZERO: ${win ? 'YES' : 'NO'}`);
	process.exit(win ? 0 : 2);
}

module.exports = { conceptTree, countingPlan, sigKey, transform, seedFor, runProblem, inspect, mode };
if ( require.main === module ) main().catch(( e ) => { console.error(e); process.exit(1); });
