/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * concept-net — a differentiable POPULATION of concept-units, trained end-to-end across the
 * composite (fixpoint) topology by implicit diff (equilibrium.js). Host-side, ZERO-CORE. Study
 * 2026-06-26 dynamic-concepts; the user's target shape: each concept-unit = a NN that DECIDES
 * whether to cast (the gate) × a NN that GENERATES the value it writes (the update):
 *
 *   contribution of unit i to its target fact = gate_i(ctx_i) · update_i(ctx_i)
 *   gate_i  = σ(W^g_i·ctx + b^g_i)   (cast decision; hard = step at inference, STE backward)
 *   update_i= σ(W^u_i·ctx + b^u_i)   (the value written when cast)
 *   ctx_i   = z[ unit_i.inputs ]     (the facts the unit reads — the WIRING / structure)
 *
 * One synchronous sweep F updates every computed fact from the current state; the population is
 * run to a fixpoint z*=F(z*) (a learned, gated equilibrium GNN). The structure (which fact each
 * unit reads, how many units) is the FORM that can evolve — add/remove units = structure search.
 * Input facts are clamped (constants), so the DEQ adjoint operates only on the COMPUTED subspace
 * (a clamped fact would be an identity row in J_z → I−J_z singular).
 *
 * This is the differentiable MIRROR of a population of engine concepts; a trained unit is baked
 * back into the real engine via ste.js (STE at the cast boundary) — that bridge is the next rung.
 */
const { solveFixpoint, implicitGrad, spectralRadius, numJac } = require('./equilibrium.js');

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * Build a population from a STRUCTURE spec (no params — those live in the θ vector trained on top).
 * @param spec.nFacts  total facts z[0..nFacts-1]
 * @param spec.inputs  indices of CLAMPED input facts (held constant across sweeps)
 * @param spec.units   [{ target, inputs:[...] }] — one unit per computed fact; inputs = the wiring
 * @param spec.out     the readout fact (full-z index) the loss is taken on
 */
function makePopulation( spec ) {
	const nFacts = spec.nFacts, inputs = (spec.inputs || []).slice();
	let off = 0;
	const units = spec.units.map((u) => {
		const L = u.inputs.length;                                   // ctx size
		const m = { target: u.target, inputs: u.inputs.slice(), L, oG: off, oGb: off + L, oU: off + L + 1, oUb: off + 2 * L + 1 };
		off += 2 * (L + 1);                                          // gate (L w + bias) + update (L w + bias)
		return m;
	});
	const nParams = off;
	const computed = [...new Set(units.map((u) => u.target))];       // the differentiable state coords (unique facts)
	const out = spec.out == null ? computed[computed.length - 1] : spec.out;
	const outC = computed.indexOf(out);

	// one synchronous sweep over the FULL z (input facts preserved); hard ⇒ gate is a step (cast).
	// Multiple units may target the same fact — their gate·update contributions SUM (a wide
	// population / mixture); one-unit-per-fact (a ring/chain) is the special case (sum of one).
	function F( z, th, opts ) {
		const hard = opts && opts.hard, zn = z.slice();
		for ( const u of units ) zn[u.target] = 0;                  // reset computed facts before accumulating
		for ( const u of units ) {
			let ag = th[u.oGb], au = th[u.oUb];
			for ( let k = 0; k < u.L; k++ ) { const c = z[u.inputs[k]]; ag += th[u.oG + k] * c; au += th[u.oU + k] * c; }
			const gate = hard ? (ag >= 0 ? 1 : 0) : sigmoid(ag);
			zn[u.target] += gate * sigmoid(au);
		}
		return zn;
	}

	// scatter a computed-subvector zc into a full z with inputs clamped to `xv`; gather the reverse
	const scatter = (zc, xv) => { const z = new Array(nFacts).fill(0); for ( const i of inputs ) z[i] = xv; computed.forEach((j, c) => { z[j] = zc[c]; }); return z; };
	const gather = (z) => computed.map((j) => z[j]);
	// reduced sweep on the computed subspace (what the DEQ differentiates)
	const stepC = (zc, th, xv, opts) => gather(F(scatter(zc, xv), th, opts));

	return {
		nFacts, inputs, units, nParams, computed, out, outC, F, scatter, gather, stepC,
		randomParams( rng, scale ) { rng = rng || Math.random; scale = scale == null ? 1 : scale; const t = new Array(nParams); for ( let i = 0; i < nParams; i++ ) t[i] = (rng() * 2 - 1) * scale; return t; },
		/** Run the population to its fixpoint for input value xv. hard ⇒ cast decisions are STEP. */
		settle( th, xv, opts ) { return solveFixpoint((zc) => stepC(zc, th, xv, opts), new Array(this.computed.length).fill(0), { maxIter: (opts && opts.maxIter) || 2000, tol: (opts && opts.tol) || 1e-12 }); },
	};
}

/** A ring of K concept-units (a genuine cycle: fact0=input → u1 → u2 → … → uK → back to u1). */
function ringPopulation( K, opts ) {
	opts = opts || {};
	const units = [];
	for ( let i = 1; i <= K; i++ ) units.push({ target: i, inputs: i === 1 ? [0, K] : [i - 1] });
	return makePopulation({ nFacts: K + 1, inputs: [0], units, out: opts.out == null ? K : opts.out });
}

/** An ACYCLIC chain of K concept-units (a DAG: fact0=input → u1 → u2 → … → uK). The engine bridge
 *  starts here — a DAG cascades in topological order, no value-change re-derivation / re-cast loop. */
function chainPopulation( K, opts ) {
	opts = opts || {};
	const units = [];
	for ( let i = 1; i <= K; i++ ) units.push({ target: i, inputs: [i - 1] });
	return makePopulation({ nFacts: K + 1, inputs: [0], units, out: opts.out == null ? K : opts.out });
}

/** A WIDE population: K parallel units all reading the input fact and SUMMING into one readout
 *  fact (a mixture / one-hidden-layer of gate×update bumps). Unlike a chain (which collapses under
 *  [0,1]-squashing), capacity grows with K — the topology where the FORM genuinely needs to evolve. */
function widePopulation( K ) {
	const units = [];
	for ( let i = 0; i < K; i++ ) units.push({ target: 1, inputs: [0] });
	return makePopulation({ nFacts: 2, inputs: [0], units, out: 1 });
}

/**
 * BAKE a trained population into REAL engine concepts + providers (the mirror↔engine bridge,
 * the analogue of ste.js#createNet for a multi-unit population). Each unit → a concept whose
 * provider reads its input facts `f<i>`, does the HARD gate × update with the frozen weights, and
 * writes its target fact `f<target>` + its self-flag `U<target>` (finding #1). `require` keys on
 * the PRODUCER unit's self-flag (or 'input' for a clamped input fact) — so an acyclic population
 * cascades in topological order to a terminal state. Bake only an ACYCLIC population (a DAG); a
 * cyclic one needs the value-change re-derivation work (#22) first.
 * @returns { conceptTree: { childConcepts }, providers: { Pop } }
 */
function bakePopulation( pop, theta ) {
	const inputSet = new Set(pop.inputs);
	const producer = {};
	for ( const u of pop.units ) producer[u.target] = 'U' + u.target;
	const childConcepts = {}, provFns = {};
	for ( const u of pop.units ) {
		const name = 'U' + u.target;
		const require = [...new Set(u.inputs.map((i) => (inputSet.has(i) ? 'input' : producer[i])))];
		childConcepts[name] = { _id: name, _name: name, require, provider: ['Pop::' + name] };
		provFns[name] = (function ( unit, nm ) {
			return function ( graph, concept, scope, argz, cb ) {
				let ag = theta[unit.oGb], au = theta[unit.oUb];
				for ( let k = 0; k < unit.L; k++ ) { const c = Number(scope._['f' + unit.inputs[k]]); ag += theta[unit.oG + k] * c; au += theta[unit.oU + k] * c; }
				const gate = ag >= 0 ? 1 : 0, upd = sigmoid(au), facts = { $_id: '_parent' };
				facts[nm] = true; facts['f' + unit.target] = gate * upd;
				cb(null, facts);
			};
		})(u, name);
	}
	return { conceptTree: { childConcepts }, providers: { Pop: provFns } };
}

/** Mean-squared fixpoint-output loss over a dataset (X = input values, T = targets on the readout). */
function loss( pop, th, X, T, opts ) {
	let s = 0;
	for ( let i = 0; i < X.length; i++ ) s += (pop.settle(th, X[i], opts).z[pop.outC] - T[i]) ** 2;
	return s / X.length;
}

/**
 * Implicit-diff gradient dL/dθ over the whole population. Forward fixpoint uses the requested
 * regime (hard ⇒ STE); the backward Jacobians J_z, J_θ are taken from the SOFT sweep at z*
 * (the straight-through surrogate). Returns { grad, rho } (rho = mean spectral radius, instrument).
 */
function grad( pop, th, X, T, opts ) {
	const g = new Array(pop.nParams).fill(0); let rhoSum = 0;
	for ( let i = 0; i < X.length; i++ ) {
		const zc = pop.settle(th, X[i], opts).z;
		const gl = new Array(pop.computed.length).fill(0);
		gl[pop.outC] = 2 * (zc[pop.outC] - T[i]) / X.length;
		const Jz = numJac((z) => pop.stepC(z, th, X[i], { hard: false }), zc);          // soft surrogate
		const Jt = numJac((t) => pop.stepC(zc, t, X[i], { hard: false }), th);
		const r = implicitGrad(Jz, Jt, gl, opts && opts.mode ? { mode: opts.mode } : { mode: 'direct' });
		for ( let k = 0; k < pop.nParams; k++ ) g[k] += r.grad[k];
		rhoSum += spectralRadius(Jz, { iters: 60 });
	}
	return { grad: g, rho: rhoSum / X.length };
}

/**
 * Train a population to a teacher map via implicit diff + Adam. @returns { theta, loss0, loss, rho }.
 */
function train( pop, conf ) {
	const X = conf.X, T = conf.T, steps = conf.steps || 1500, lr = conf.lr || 0.05, hard = !!conf.hard;
	let th = (conf.theta0 || pop.randomParams(conf.rng, conf.initScale)).slice();
	const loss0 = loss(pop, th, X, T, { hard });
	const mm = th.map(() => 0), vv = th.map(() => 0), b1 = 0.9, b2 = 0.999;
	let rho = 0;
	for ( let s = 1; s <= steps; s++ ) {
		const r = grad(pop, th, X, T, { hard }); rho = r.rho;
		for ( let k = 0; k < th.length; k++ ) { mm[k] = b1 * mm[k] + (1 - b1) * r.grad[k]; vv[k] = b2 * vv[k] + (1 - b2) * r.grad[k] * r.grad[k]; th[k] -= lr * (mm[k] / (1 - b1 ** s)) / (Math.sqrt(vv[k] / (1 - b2 ** s)) + 1e-8); }
	}
	return { theta: th, loss0, loss: loss(pop, th, X, T, { hard }), rho };
}

/**
 * Evolve the population FORM by success: grow the structure one unit at a time, training each
 * candidate, and KEEP a larger form only while the added unit earns its keep — loss must improve by
 * more than `margin` (a utility / MDL gate, the continuous cousin of abstraction.js). Growth stops
 * at the parsimonious size that fits the task: too few units underfit, the right size fits, more
 * don't pay for themselves. "Their form may need to evolve" + favor-by-success, made mechanical.
 * @param conf.makePop (K)->population   build a population of K units (e.g. K => chainPopulation(K))
 * @param conf.X/T      the task (inputs, targets on the readout)
 * @param conf.K0/maxK  size bounds (default 1 .. 6)
 * @param conf.margin   min loss improvement to justify one more unit (default 1e-3)
 * @param conf.rngFor   (K)->rng   per-size seeded RNG (default Math.random)
 * @returns { K, pop, theta, loss, history:[{K,loss,params}] }
 */
function evolve( conf ) {
	const makePop = conf.makePop, X = conf.X, T = conf.T, maxK = conf.maxK || 6;
	const margin = conf.margin == null ? 1e-3 : conf.margin, steps = conf.steps || 1200, lr = conf.lr || 0.05;
	const scale = conf.initScale == null ? 0.5 : conf.initScale, rngFor = conf.rngFor || (() => Math.random), hard = !!conf.hard;
	const history = []; let best = null, prev = Infinity;
	for ( let K = conf.K0 || 1; K <= maxK; K++ ) {
		const pop = makePop(K);
		const r = train(pop, { X, T, steps, lr, hard, theta0: pop.randomParams(rngFor(K), scale) });
		history.push({ K, loss: r.loss, params: pop.nParams });
		if ( prev - r.loss > margin ) { best = { K, pop, theta: r.theta, loss: r.loss }; prev = r.loss; }
		else break;                                            // utility gate: the new unit didn't pay for itself
	}
	return { K: best.K, pop: best.pop, theta: best.theta, loss: best.loss, history };
}

module.exports = { makePopulation, ringPopulation, chainPopulation, widePopulation, bakePopulation, loss, grad, train, evolve };
