'use strict';
/**
 * equilibrium — implicit-differentiation / DEQ through a forward-chaining FIXPOINT (study
 * 2026-06-26 dynamic-concepts, the composite-topology convergence POC; Laurie's brief).
 *
 * The engine's stabilization is a Picard iteration z_{t+1}=F(z_t,θ) to a fixpoint z*=F(z*,θ).
 * To train params θ inside concept-nets we need dL/dθ WITHOUT unrolling — differentiate the
 * fixpoint condition (DEQ): solve the adjoint (I − J_z)^T u = ∇_z L, then dL/dθ = J_θ^T u.
 *
 * The model under test is Laurie's minimal GENUINELY-CYCLIC composite: 2 facts in a positive
 * 2-cycle, C2 gated. A cycle is required — a DAG makes J_z nilpotent (ρ=0), so implicit==unrolled
 * and the whole exercise is vacuous. Here ρ=√|w1·w2·σ'1·σ'2| > 0.
 *
 * Stage A here is fully-soft (sigmoids everywhere) where implicit diff is EXACT — validated
 * against central finite-difference of the end-to-end loss (the independent oracle). STE (hard
 * cast) lands in equilibrium-learn.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { solveFixpoint, implicitGrad, spectralRadius } = require('../../experiments/probabilistic-concepts/equilibrium.js');

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const dsig = (a) => a * (1 - a);   // σ'(z) expressed from a=σ(z)

// 2-fact positive cycle, C2 soft-gated at temperature T. θ=[w1,w2,u1,u2], one input x.
//   z1' = σ(w1·z2 + u1·x)          (C1, the back-edge of the cycle)
//   z2' = σ((w2·z1 + u2·x)/T)      (C2, the gate — soft in Stage A)
function twoCycle( T ) {
	T = T || 1;
	return {
		out: 0,
		F( z, th, x ) {
			const [w1, w2, u1, u2] = th;
			return [sigmoid(w1 * z[1] + u1 * x), sigmoid((w2 * z[0] + u2 * x) / T)];
		},
		jacZ( z, th, x ) {
			const [w1, w2, u1, u2] = th;
			const d1 = dsig(sigmoid(w1 * z[1] + u1 * x));
			const d2 = dsig(sigmoid((w2 * z[0] + u2 * x) / T)) / T;
			return [[0, w1 * d1], [w2 * d2, 0]];
		},
		jacTheta( z, th, x ) {
			const [w1, w2, u1, u2] = th;
			const d1 = dsig(sigmoid(w1 * z[1] + u1 * x));
			const d2 = dsig(sigmoid((w2 * z[0] + u2 * x) / T)) / T;
			return [[d1 * z[1], 0, d1 * x, 0], [0, d2 * z[0], 0, d2 * x]];  // rows z1',z2' × cols w1,w2,u1,u2
		},
	};
}

const fixpoint = (m, th, x) => solveFixpoint((z) => m.F(z, th, x), [0, 0], { maxIter: 1000, tol: 1e-13 });
function loss( m, th, X, t ) { let s = 0; for (let i = 0; i < X.length; i++) { const z = fixpoint(m, th, X[i]).z; s += (z[m.out] - t[i]) ** 2; } return s / X.length; }
function gradFD( m, th, X, t, eps ) {
	eps = eps || 1e-6; const g = new Array(th.length);
	for (let k = 0; k < th.length; k++) { const a = th.slice(), b = th.slice(); a[k] += eps; b[k] -= eps; g[k] = (loss(m, a, X, t) - loss(m, b, X, t)) / (2 * eps); }
	return g;
}
function gradImplicit( m, th, X, t, opts ) {
	const g = new Array(th.length).fill(0);
	for (let i = 0; i < X.length; i++) {
		const z = fixpoint(m, th, X[i]).z;
		const gl = [0, 0]; gl[m.out] = 2 * (z[m.out] - t[i]) / X.length;
		const r = implicitGrad(m.jacZ(z, th, X[i]), m.jacTheta(z, th, X[i]), gl, opts);
		for (let k = 0; k < th.length; k++) g[k] += r.grad[k];
	}
	return g;
}

test('solveFixpoint converges on a contraction and reports iters/residual', () => {
	const r = solveFixpoint((z) => [0.5 * z[1] + 0.1, 0.5 * z[0] + 0.2], [0, 0], { maxIter: 500, tol: 1e-12 });
	assert.ok(r.converged, 'a contraction converges');
	assert.ok(r.residual < 1e-12);
	assert.ok(r.iters > 1 && r.iters < 500);
	// fixpoint check: z* ≈ F(z*)
	const f = [0.5 * r.z[1] + 0.1, 0.5 * r.z[0] + 0.2];
	assert.ok(Math.abs(f[0] - r.z[0]) < 1e-10 && Math.abs(f[1] - r.z[1]) < 1e-10);
});

test('IMPLICIT gradient (direct adjoint solve) matches finite-difference on the soft 2-cycle', () => {
	const m = twoCycle(1);
	const teacher = [1.5, 2.0, 0.5, -0.5];
	const X = [-1, -0.6, -0.2, 0.2, 0.6, 1];
	const t = X.map((x) => fixpoint(m, teacher, x).z[0]);       // targets = teacher's FIXPOINT output
	const th = [0.8, 1.2, 0.0, 0.0];                            // student, away from the teacher
	const gi = gradImplicit(m, th, X, t, { mode: 'direct' });
	const gf = gradFD(m, th, X, t, 1e-6);
	for (let k = 0; k < 4; k++)
		assert.ok(Math.abs(gi[k] - gf[k]) < 1e-4, `grad[${k}]: implicit ${gi[k]} vs FD ${gf[k]}`);
});

test('Neumann-K adjoint converges to the direct solve as K grows (error ~ ρ^K)', () => {
	const m = twoCycle(1);
	const X = [-0.5, 0.3], t = [0.4, 0.6], th = [1.0, 1.4, 0.2, -0.1];
	const gDirect = gradImplicit(m, th, X, t, { mode: 'direct' });
	const err = (K) => { const g = gradImplicit(m, th, X, t, { mode: { neumann: K } }); let e = 0; for (let k = 0; k < 4; k++) e = Math.max(e, Math.abs(g[k] - gDirect[k])); return e; };
	assert.ok(err(40) < 1e-6, 'deep Neumann ≈ direct');
	assert.ok(err(2) > err(20), 'truncation error shrinks with depth');
});

test('spectralRadius (power iteration) matches the analytic ρ=√|b·c| of the cycle', () => {
	const m = twoCycle(1);
	const th = [1.5, 2.0, 0.5, -0.5], x = 0.3;
	const z = fixpoint(m, th, x).z;
	const Jz = m.jacZ(z, th, x);
	const analytic = Math.sqrt(Math.abs(Jz[0][1] * Jz[1][0]));
	const rho = spectralRadius(Jz, { iters: 200 });
	assert.ok(analytic > 0 && analytic < 1, 'a real, contracting cycle (ρ∈(0,1))');
	assert.ok(Math.abs(rho - analytic) < 1e-3, `power ρ ${rho} vs analytic ${analytic}`);
});
