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
 * graph-net — a SHARED-WEIGHT message-passing population over an arbitrary graph: ONE node-update
 * rule (a gate-NN × update-NN) applied at every node, reading a permutation-invariant aggregate of
 * its neighbours, run to a FIXPOINT, trained by the same implicit-diff/DEQ machinery (equilibrium.js).
 * A quantized equilibrium GNN — the substrate generalised from concept-net's fixed structures to an
 * actual graph, so it (a) handles real graph problems where recurrence is essential and (b)
 * GENERALISES to new graphs (one rule everywhere = the distillation payoff). Host-side, ZERO-CORE.
 * Study 2026-06-26 (see doc/concept-learning.md); the rung after the population substrate.
 *
 * Unit: z'[i] = gate_i · cand_i, both σ over ctx_i = [ mean(neighbour states), own state ]; weights
 * SHARED across nodes (θ = 6 numbers, any graph size). Seed-initialised: settle starts from z0.
 *
 * CLAMPED nodes (`opts.clamp`) are held fixed at their z0 value — the "grounded" anchors for a
 * SEED-ANCHORED propagation problem (e.g. known types propagating across a dependency graph). This
 * matters: an UNCLAMPED equilibrium GNN OVERSMOOTHS to the consensus fixpoint (washes out the seed →
 * cannot do symmetry-breaking labelling, finding #26); a clamp breaks the symmetry so the fixpoint is
 * seed-determined and learnable. The DEQ adjoint runs on the FREE (non-clamped) subspace (a clamped
 * node is an identity J_z row → I−J_z singular).
 *
 *   const gp = graphPopulation(n, edges, { clamp: [0] });   // node 0 = the grounded source
 *   const r  = trainGraph(gp, episodes, { steps, lr });      // episodes: [{ z0, target }]
 *   const z  = gp.settle(r.theta, z0).z;                      // propagate a NEW graph, no oracle
 */
const { solveFixpoint, implicitGrad, numJac, spectralRadius } = require('./equilibrium.js');

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

function graphPopulation( n, edges, opts ) {
	opts = opts || {};
	const clamp = new Set(opts.clamp || []);
	const free = []; for ( let i = 0; i < n; i++ ) if ( !clamp.has(i) ) free.push(i);
	const nb = Array.from({ length: n }, () => []);
	for ( const [a, b] of (edges || []) ) { nb[a].push(b); nb[b].push(a); }
	const nParams = 6;                       // [Wg_agg, Wg_self, bg, Wu_agg, Wu_self, bu] — SHARED
	function F( z, th ) {
		const zn = z.slice();
		for ( const i of free ) {            // clamped nodes keep z[i]
			const ne = nb[i]; let agg = 0;
			for ( const j of ne ) agg += z[j];
			agg = ne.length ? agg / ne.length : 0;
			const self = z[i];
			zn[i] = sigmoid(th[0] * agg + th[1] * self + th[2]) * sigmoid(th[3] * agg + th[4] * self + th[5]);
		}
		return zn;
	}
	const scatter = (zf, z0) => { const z = z0.slice(); free.forEach((j, c) => { z[j] = zf[c]; }); return z; };  // clamped from z0
	const gather = (z) => free.map((j) => z[j]);
	const freeStep = (zf, z0, th) => gather(F(scatter(zf, z0), th));   // the reduced sweep the DEQ differentiates
	return {
		n, nParams, F, neighbors: nb, clamp: [...clamp], free, scatter, gather, freeStep,
		settle( th, z0, o ) { return solveFixpoint((z) => F(z, th), z0.slice(), { maxIter: (o && o.maxIter) || 3000, tol: (o && o.tol) || 1e-12 }); },
		settleFree( th, z0, o ) { const r = solveFixpoint((zf) => freeStep(zf, z0, th), gather(z0), { maxIter: (o && o.maxIter) || 3000, tol: (o && o.tol) || 1e-12 }); return { zfree: r.z, z: scatter(r.z, z0), iters: r.iters, converged: r.converged }; },
		randomParams( rng, scale ) { rng = rng || Math.random; scale = scale == null ? 1 : scale; const t = new Array(nParams); for ( let i = 0; i < nParams; i++ ) t[i] = (rng() * 2 - 1) * scale; return t; },
	};
}

/** Mean-squared per-FREE-node loss over episodes [{ z0, target }]. */
function graphLoss( gp, th, episodes ) {
	let s = 0, cnt = 0;
	for ( const ep of episodes ) { const z = gp.settle(th, ep.z0).z; for ( const i of gp.free ) { s += (z[i] - ep.target[i]) ** 2; cnt++; } }
	return s / cnt;
}

/** Implicit-diff (DEQ) gradient of graphLoss wrt the shared θ (over the free subspace), summed. */
function graphGrad( gp, th, episodes ) {
	const g = new Array(gp.nParams).fill(0), N = episodes.length * gp.free.length;
	for ( const ep of episodes ) {
		const r = gp.settleFree(th, ep.z0), zf = r.zfree;
		const gl = zf.map((v, c) => 2 * (v - ep.target[gp.free[c]]) / N);
		const Jz = numJac((zz) => gp.freeStep(zz, ep.z0, th), zf), Jt = numJac((tt) => gp.freeStep(zf, ep.z0, tt), th);
		const gr = implicitGrad(Jz, Jt, gl, { mode: 'direct' });
		for ( let k = 0; k < gp.nParams; k++ ) g[k] += gr.grad[k];
	}
	return g;
}

/** Train the shared node-rule on episodes (Adam). @returns { theta, loss0, loss }. */
function trainGraph( gp, episodes, conf ) {
	conf = conf || {};
	const steps = conf.steps || 1500, lr = conf.lr || 0.05;
	let th = (conf.theta0 || gp.randomParams(conf.rng, conf.initScale)).slice();
	const loss0 = graphLoss(gp, th, episodes), mm = th.map(() => 0), vv = th.map(() => 0), b1 = 0.9, b2 = 0.999;
	for ( let s = 1; s <= steps; s++ ) {
		const gr = graphGrad(gp, th, episodes);
		for ( let k = 0; k < th.length; k++ ) { mm[k] = b1 * mm[k] + (1 - b1) * gr[k]; vv[k] = b2 * vv[k] + (1 - b2) * gr[k] * gr[k]; th[k] -= lr * (mm[k] / (1 - b1 ** s)) / (Math.sqrt(vv[k] / (1 - b2 ** s)) + 1e-8); }
	}
	return { theta: th, loss0, loss: graphLoss(gp, th, episodes) };
}

module.exports = { graphPopulation, graphLoss, graphGrad, trainGraph };
