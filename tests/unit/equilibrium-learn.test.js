'use strict';
/**
 * equilibrium-learn — does learning CONVERGE on the composite (fixpoint) topology? (study
 * 2026-06-26; Laurie's brief, the campaign's central convergence POC). Stage A: train with the
 * implicit gradient and recover a teacher's FIXPOINT map; show the cycle is load-bearing (a
 * fixed-depth unroll can't represent it) and map the ρ→1 regime. Stage B: the STE hard-cast
 * ladder — interior gradient exact, the gate's dead hard-gradient revived by the straight-through
 * surrogate. CPU, offline, ZERO-CORE — the differentiable MIRROR of the engine's stabilization.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { solveFixpoint, implicitGrad, spectralRadius } = require('../../lib/authoring/equilibrium.js');

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const dsig = (a) => a * (1 - a);

// 2-fact positive cycle, C2 gated. soft: h=σ(·/T). hard: forward step, backward σ'(·/Tb)/Tb (STE).
function twoCycle( mode, T, Tb ) {
	T = T || 1; Tb = Tb || 1;
	const hard = mode === 'hard';
	return {
		out: 0,
		F( z, th, x ) {
			const [w1, w2, u1, u2] = th, a2 = (w2 * z[0] + u2 * x);
			return [sigmoid(w1 * z[1] + u1 * x), hard ? (a2 >= 0 ? 1 : 0) : sigmoid(a2 / T)];
		},
		jacZ( z, th, x ) {
			const [w1, w2, u1, u2] = th;
			const d1 = dsig(sigmoid(w1 * z[1] + u1 * x));
			const d2 = hard ? dsig(sigmoid((w2 * z[0] + u2 * x) / Tb)) / Tb : dsig(sigmoid((w2 * z[0] + u2 * x) / T)) / T;
			return [[0, w1 * d1], [w2 * d2, 0]];
		},
		jacTheta( z, th, x ) {
			const [w1, w2, u1, u2] = th;
			const d1 = dsig(sigmoid(w1 * z[1] + u1 * x));
			const d2 = hard ? dsig(sigmoid((w2 * z[0] + u2 * x) / Tb)) / Tb : dsig(sigmoid((w2 * z[0] + u2 * x) / T)) / T;
			return [[d1 * z[1], 0, d1 * x, 0], [0, d2 * z[0], 0, d2 * x]];
		},
		margin( z, th, x ) { const [, w2, , u2] = th; return Math.abs(w2 * z[0] + u2 * x); },  // gate pre-activation |·|
	};
}

const fixpoint = (m, th, x) => solveFixpoint((z) => m.F(z, th, x), [0, 0], { maxIter: 2000, tol: 1e-12 });
const loss = (m, th, X, t) => { let s = 0; for (let i = 0; i < X.length; i++) s += (fixpoint(m, th, X[i]).z[m.out] - t[i]) ** 2; return s / X.length; };
function gradImplicit( m, th, X, t, opts ) {
	const g = new Array(th.length).fill(0);
	for (let i = 0; i < X.length; i++) {
		const z = fixpoint(m, th, X[i]).z, gl = [0, 0];
		gl[m.out] = 2 * (z[m.out] - t[i]) / X.length;
		const r = implicitGrad(m.jacZ(z, th, X[i]), m.jacTheta(z, th, X[i]), gl, opts);
		for (let k = 0; k < th.length; k++) g[k] += r.grad[k];
	}
	return g;
}
function gradFD( m, th, X, t, eps ) {
	eps = eps || 1e-6; const g = new Array(th.length);
	for (let k = 0; k < th.length; k++) { const a = th.slice(), b = th.slice(); a[k] += eps; b[k] -= eps; g[k] = (loss(m, a, X, t) - loss(m, b, X, t)) / (2 * eps); }
	return g;
}
function adam( gradFn, th0, steps, lr ) {
	let th = th0.slice(); const mm = th.map(() => 0), vv = th.map(() => 0), b1 = 0.9, b2 = 0.999, e = 1e-8;
	for (let s = 1; s <= steps; s++) {
		const g = gradFn(th);
		for (let k = 0; k < th.length; k++) { mm[k] = b1 * mm[k] + (1 - b1) * g[k]; vv[k] = b2 * vv[k] + (1 - b2) * g[k] * g[k]; th[k] -= lr * (mm[k] / (1 - b1 ** s)) / (Math.sqrt(vv[k] / (1 - b2 ** s)) + e); }
	}
	return th;
}

const X = [-1, -0.6, -0.2, 0.2, 0.6, 1];

test('TRAINING CONVERGES on the composite fixpoint: the implicit gradient recovers a teacher map', () => {
	const m = twoCycle('soft');
	const teacher = [1.5, 2.0, 0.5, -0.5];
	const t = X.map((x) => fixpoint(m, teacher, x).z[0]);
	const th0 = [0.4, 0.6, 0.0, 0.0];
	assert.ok(loss(m, th0, X, t) > 1e-3, 'starts away from the teacher');
	const thT = adam((th) => gradImplicit(m, th, X, t, { mode: 'direct' }), th0, 3000, 0.03);
	assert.ok(loss(m, thT, X, t) < 1e-4, `implicit training drives the fixpoint loss to ~0 (got ${loss(m, thT, X, t)})`);
});

test('the CYCLE is load-bearing: a fixed-depth unroll cannot represent the fixpoint map', () => {
	const m = twoCycle('soft');
	const teacher = [1.5, 2.0, 0.5, -0.5], x = 0.5;
	const zStar = fixpoint(m, teacher, x).z[0];
	const kSweep = (K) => { let z = [0, 0]; for (let i = 0; i < K; i++) z = m.F(z, teacher, x); return z[0]; };
	assert.ok(Math.abs(kSweep(1) - zStar) > 1e-2, 'K=1 misses the fixpoint (the geometric tail of the cycle)');
	assert.ok(Math.abs(kSweep(1) - zStar) > Math.abs(kSweep(6) - zStar), 'the gap shrinks with unroll depth');
	assert.ok(Math.abs(kSweep(60) - zStar) < 1e-4, 'a deep unroll approaches the fixpoint (implicit gets it in O(1) memory)');
});

test('the ρ→1 regime: forward sweeps-to-fixpoint grow as ρ→1 (apply-cap = Neumann depth)', () => {
	// A LINEAR 2-cycle z'=[α·z2+0.1, α·z1+0.2] has J_z=[[0,α],[α,0]], ρ=|α| EXACTLY — no sigmoid
	// saturation to confound the regime law (iters ~ 1/|log ρ|). This is the clean instrument; the
	// saturating sigmoid model is what we TRAIN, the regime is a property of its linearization.
	const sweep = (a) => solveFixpoint((z) => [a * z[1] + 0.1, a * z[0] + 0.2], [0, 0], { maxIter: 100000, tol: 1e-10 });
	const rhoOf = (a) => spectralRadius([[0, a], [a, 0]], { iters: 200 });
	assert.ok(Math.abs(rhoOf(0.3) - 0.3) < 1e-3 && Math.abs(rhoOf(0.9) - 0.9) < 1e-3, 'ρ = |α| recovered by the instrument');
	const lo = sweep(0.3), hi = sweep(0.9);
	assert.ok(hi.iters > 3 * lo.iters, `ρ→1 ⇒ many more sweeps (${lo.iters} at ρ=.3 vs ${hi.iters} at ρ=.9)`);
});

test('STE Stage B: interior gradient is exact for smooth-path params; FD of the hard loss is alive there', () => {
	const m = twoCycle('hard', 1, 0.6);
	// params + data with a COMFORTABLE active margin (gate firmly cast), so no cast flips under FD
	const th = [1.4, 2.2, 0.3, 0.4];
	const t = X.map((x) => fixpoint(m, th, x).z[0]).map((v) => v - 0.05);   // small offset → nonzero loss
	for (const x of X) assert.ok(m.margin(fixpoint(m, th, x).z, th, x) > 0.5, 'gate well off threshold');
	const gi = gradImplicit(m, th, X, t, { mode: 'direct' });
	const gf = gradFD(m, th, X, t, 1e-5);
	// smooth-path params: w1 (idx 0), u1 (idx 2) feed the output through the SMOOTH C1 → implicit ≈ FD
	assert.ok(Math.abs(gi[0] - gf[0]) < 1e-3, `w1 smooth-path grad implicit ${gi[0]} vs FD ${gf[0]}`);
	assert.ok(Math.abs(gi[2] - gf[2]) < 1e-3, `u1 smooth-path grad implicit ${gi[2]} vs FD ${gf[2]}`);
});

test('STE Stage B: the gate has a DEAD hard-gradient (FD≈0) that the straight-through surrogate revives', () => {
	const m = twoCycle('hard', 1, 0.6);
	const th = [1.4, 2.2, 0.3, 0.4];
	const t = X.map((x) => fixpoint(m, th, x).z[0]).map((v) => v - 0.05);
	const gi = gradImplicit(m, th, X, t, { mode: 'direct' });
	const gf = gradFD(m, th, X, t, 1e-5);
	// gate params w2 (idx 1), u2 (idx 3) reach the output ONLY through the hard cast → FD is dead in the cell
	assert.ok(Math.abs(gf[1]) < 1e-6 && Math.abs(gf[3]) < 1e-6, 'pure-hard gradient to the gate is ~0 (quantized: dead)');
	assert.ok(Math.abs(gi[1]) > 1e-3, 'STE surrogate supplies a live descent signal to the gate weight');
});

test('STE Stage B: training with the STE gradient descends a hard-cast composite loss', () => {
	const m = twoCycle('hard', 1, 0.6);
	const teacher = [1.6, 2.4, 0.4, 0.5];
	const t = X.map((x) => fixpoint(m, teacher, x).z[0]);
	const th0 = [1.0, 1.6, 0.1, 0.2];
	const L0 = loss(m, th0, X, t);
	const thT = adam((th) => gradImplicit(m, th, X, t, { mode: 'direct' }), th0, 800, 0.05);
	assert.ok(loss(m, thT, X, t) < 0.5 * L0, `STE training reduces the hard-cast loss (${L0} → ${loss(m, thT, X, t)})`);
});
