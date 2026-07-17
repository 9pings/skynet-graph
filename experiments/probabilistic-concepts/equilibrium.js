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
 * equilibrium — implicit differentiation through a forward-chaining FIXPOINT (the DEQ method),
 * for learning across the COMPOSITE concept topology. Host-side, ZERO-CORE. Study
 * docs/WIP/studies/2026-06-26-concepts-dynamiques-grammaire-induction.md; theory brief = Laurie.
 *
 * The engine's stabilization is a Picard iteration z_{t+1}=F(z_t,θ) driven to a fixpoint
 * z*=F(z*,θ). To train params θ that live inside concept-nets, we want dL(z*)/dθ WITHOUT
 * differentiating through the iteration. Differentiate the fixpoint condition instead
 * (Almeida/Pineda 1987; DEQ, Bai-Kolter-Koltun 2019):
 *
 *   J_z := ∂F/∂z |_{z*}   (n×n)        J_θ := ∂F/∂θ |_{z*}   (n×p)   — ONE sweep, at z*
 *   dz* / dθ = (I − J_z)^{-1} J_θ
 *   dL/dθ  = (∇_z L) (I − J_z)^{-1} J_θ
 *
 * Reverse mode (never form the inverse): solve the adjoint (I − J_z)^T u = ∇_z L once, then
 * dL/dθ = J_θ^T u. Well-posed iff ρ(J_z) < 1 (the contraction that also makes the forward
 * fixpoint exist & be unique). Neumann: (I − J_z)^{-1} = Σ_k J_z^k, so u_K = Σ_{k≤K}(J_z^T)^k g
 * — the truncation depth K is the exact analogue of the engine's apply-cap, and its bias ~ρ^K
 * binds precisely as ρ→1. This module is the differentiable MIRROR of the composite topology;
 * the real engine stays discrete (a trained net is baked back via ste.js, STE at the boundary).
 *
 *   const fp = solveFixpoint((z) => F(z, θ, x), z0, { maxIter, tol });
 *   const { grad } = implicitGrad(jacZ(fp.z), jacTheta(fp.z), gradL, { mode: 'direct' });
 */

// ---- small dense linear algebra (POC scale, n ≲ tens — a direct solve is free) ----

// Solve A u = b by Gaussian elimination with partial pivoting. A is n×n (row-major), b is n.
function solveLinear( A, b ) {
	const n = b.length, M = A.map((row, i) => row.slice().concat(b[i]));   // augmented
	for ( let col = 0; col < n; col++ ) {
		let piv = col;
		for ( let r = col + 1; r < n; r++ ) if ( Math.abs(M[r][col]) > Math.abs(M[piv][col]) ) piv = r;
		if ( Math.abs(M[piv][col]) < 1e-300 ) throw new Error('equilibrium: singular system (I − J_z not invertible; ρ ≥ 1?)');
		if ( piv !== col ) { const tmp = M[piv]; M[piv] = M[col]; M[col] = tmp; }
		for ( let r = 0; r < n; r++ ) {
			if ( r === col ) continue;
			const f = M[r][col] / M[col][col];
			for ( let c = col; c <= n; c++ ) M[r][c] -= f * M[col][c];
		}
	}
	return M.map((row, i) => row[n] / row[i]);
}

// (J^T v)[i] = Σ_j J[j][i] v[j]   — transpose-times-vector (J is r×c, v is r → c-vector)
function matTvec( J, v ) {
	const r = J.length, c = r ? J[0].length : 0, out = new Array(c).fill(0);
	for ( let i = 0; i < r; i++ ) for ( let j = 0; j < c; j++ ) out[j] += J[i][j] * v[i];
	return out;
}

/**
 * Picard iteration to a fixpoint z* = F(z*). Faithful to the engine's stabilization sweep.
 * @returns { z, iters, residual, converged }  residual = max|z_{t+1} − z_t|.
 */
function solveFixpoint( F, z0, opts ) {
	opts = opts || {};
	const maxIter = opts.maxIter || 1000, tol = opts.tol == null ? 1e-12 : opts.tol;
	let z = z0.slice(), iters = 0, residual = Infinity;
	for ( ; iters < maxIter; ) {
		const zn = F(z);
		residual = 0;
		for ( let i = 0; i < zn.length; i++ ) residual = Math.max(residual, Math.abs(zn[i] - z[i]));
		z = zn; iters++;
		if ( residual < tol ) break;
	}
	return { z: z, iters: iters, residual: residual, converged: residual < tol };
}

/**
 * Implicit (DEQ) gradient dL/dθ = J_θ^T u where (I − J_z)^T u = gradL.
 * @param Jz     ∂F/∂z at z*  (n×n)
 * @param Jtheta ∂F/∂θ at z*  (n×p)
 * @param gradL  ∇_z L at z*  (n)
 * @param opts.mode  'direct' (dense solve, the gold value) | { neumann: K } (truncated series)
 * @returns { grad (p), u (n) }
 */
function implicitGrad( Jz, Jtheta, gradL, opts ) {
	opts = opts || {};
	const n = gradL.length;
	let u;
	if ( opts.mode && opts.mode.neumann != null ) {
		// u = Σ_{k=0..K} (Jz^T)^k gradL  — each step is one VJP v ↦ Jz^T v (Jacobian-free)
		const K = opts.mode.neumann;
		u = gradL.slice();
		let term = gradL.slice();
		for ( let k = 0; k < K; k++ ) {
			term = matTvec(Jz, term);                       // Jz^T · term
			for ( let i = 0; i < n; i++ ) u[i] += term[i];
		}
	} else {
		// direct: A = (I − Jz)^T,  A[i][j] = δ_ij − Jz[j][i]
		const A = [];
		for ( let i = 0; i < n; i++ ) { const row = new Array(n); for ( let j = 0; j < n; j++ ) row[j] = (i === j ? 1 : 0) - Jz[j][i]; A.push(row); }
		u = solveLinear(A, gradL);
	}
	return { grad: matTvec(Jtheta, u), u: u };
}

/**
 * Central finite-difference Jacobian of fn: R^d → R^n, returned as n×d. The general way to get
 * J_z / J_θ of one composite sweep F without hand-deriving per-unit VJPs — at POC scale (n,d ≲
 * tens) it's cheap and exact-to-O(ε²). For an STE (hard-gate) population, feed it the SOFT sweep
 * (sigmoid gates) at z* — that IS the straight-through surrogate Jacobian for the backward.
 */
function numJac( fn, point, eps ) {
	eps = eps || 1e-6;
	const d = point.length, f0 = fn(point), n = f0.length;
	const J = Array.from({ length: n }, () => new Array(d));
	for ( let k = 0; k < d; k++ ) {
		const a = point.slice(), b = point.slice(); a[k] += eps; b[k] -= eps;
		const fa = fn(a), fb = fn(b);
		for ( let i = 0; i < n; i++ ) J[i][k] = (fa[i] - fb[i]) / (2 * eps);
	}
	return J;
}

/**
 * Spectral radius of J_z — the regime instrument (ρ→1 ⇒ slow forward, deep Neumann, large
 * gradient). Estimated as the geometric-mean growth rate ρ = lim ‖J_z^k v‖^{1/k} (a normalized
 * power iteration averaging the per-step log-growth). Unlike a last-step power-iteration estimate
 * this is correct when the dominant eigenvalues are TIED in magnitude or complex — e.g. the cycle
 * J_z=[[0,b],[c,0]] has eigenvalues ±√(b·c) (equal magnitude), where the per-step factors form a
 * 2-cycle whose geometric mean is exactly √(b·c).
 */
function spectralRadius( Jz, opts ) {
	opts = opts || {};
	const iters = opts.iters || 100, burn = opts.burn == null ? Math.floor((opts.iters || 100) / 2) : opts.burn, n = Jz.length;
	const matVec = (M, v) => M.map((row) => row.reduce((s, m, j) => s + m * v[j], 0));
	let v = new Array(n).fill(0).map((_, i) => 1 / Math.sqrt(n) + 1e-3 * (i % 2 ? -1 : 1));  // off-axis seed
	let sumLog = 0, count = 0;
	for ( let k = 0; k < iters; k++ ) {
		const w = matVec(Jz, v);
		const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
		if ( norm < 1e-300 ) return 0;
		if ( k >= burn ) { sumLog += Math.log(norm); count++; }
		v = w.map((x) => x / norm);
	}
	return count ? Math.exp(sumLog / count) : 0;
}

module.exports = { solveFixpoint, implicitGrad, spectralRadius, solveLinear, matTvec, numJac };
