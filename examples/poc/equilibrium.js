/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * Composite-topology convergence POC (structure-learning v0; study 2026-06-26; Laurie's brief).
 * Question: in a simple NN you apply a gradient and it converges — does learning CONVERGE on our
 * COMPOSITE topology, where the "network" is a graph of concepts run to a FIXPOINT (not a fixed
 * feed-forward pass)? Answer (here, on the minimal genuinely-cyclic model): YES, via implicit
 * differentiation / DEQ — differentiate the fixpoint condition, don't unroll. Run:
 *
 *   node examples/poc/equilibrium.js
 *
 * This is the differentiable MIRROR of the engine's stabilization; a trained concept-net is baked
 * back into the real (discrete) engine via ste.js (STE at the cast boundary). CPU, offline.
 */
const { solveFixpoint, implicitGrad, spectralRadius } = require('../../experiments/probabilistic-concepts/equilibrium.js');

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const dsig = (a) => a * (1 - a);

// 2-fact positive cycle (C1 smooth back-edge, C2 gated). θ=[w1,w2,u1,u2].
function twoCycle( mode, Tb ) {
	const hard = mode === 'hard'; Tb = Tb || 0.6;
	const d2at = (z, th, x) => dsig(sigmoid((th[1] * z[0] + th[3] * x) / (hard ? Tb : 1))) / (hard ? Tb : 1);
	return {
		F( z, th, x ) { const a2 = th[1] * z[0] + th[3] * x; return [sigmoid(th[0] * z[1] + th[2] * x), hard ? (a2 >= 0 ? 1 : 0) : sigmoid(a2)]; },
		jacZ( z, th, x ) { const d1 = dsig(sigmoid(th[0] * z[1] + th[2] * x)); return [[0, th[0] * d1], [th[1] * d2at(z, th, x), 0]]; },
		jacTheta( z, th, x ) { const d1 = dsig(sigmoid(th[0] * z[1] + th[2] * x)), d2 = d2at(z, th, x); return [[d1 * z[1], 0, d1 * x, 0], [0, d2 * z[0], 0, d2 * x]]; },
	};
}
const fixpoint = (m, th, x) => solveFixpoint((z) => m.F(z, th, x), [0, 0], { maxIter: 5000, tol: 1e-12 });
const loss = (m, th, X, t) => { let s = 0; for (let i = 0; i < X.length; i++) s += (fixpoint(m, th, X[i]).z[0] - t[i]) ** 2; return s / X.length; };
function gradImplicit( m, th, X, t ) {
	const g = new Array(th.length).fill(0);
	for (let i = 0; i < X.length; i++) { const z = fixpoint(m, th, X[i]).z, gl = [2 * (z[0] - t[i]) / X.length, 0]; const r = implicitGrad(m.jacZ(z, th, X[i]), m.jacTheta(z, th, X[i]), gl, { mode: 'direct' }); for (let k = 0; k < th.length; k++) g[k] += r.grad[k]; }
	return g;
}
function adam( gradFn, th0, steps, lr ) {
	let th = th0.slice(); const mm = th.map(() => 0), vv = th.map(() => 0), b1 = 0.9, b2 = 0.999;
	for (let s = 1; s <= steps; s++) { const g = gradFn(th); for (let k = 0; k < th.length; k++) { mm[k] = b1 * mm[k] + 0.1 * g[k]; vv[k] = b2 * vv[k] + 0.001 * g[k] * g[k]; th[k] -= lr * (mm[k] / (1 - b1 ** s)) / (Math.sqrt(vv[k] / (1 - b2 ** s)) + 1e-8); } }
	return th;
}

const X = [-1, -0.6, -0.2, 0.2, 0.6, 1];

console.log('\nComposite-topology convergence POC — implicit differentiation through a fixpoint\n');

// 1) does the gradient method converge on the composite (cyclic) topology?
const soft = twoCycle('soft');
const teacher = [1.5, 2.0, 0.5, -0.5];
const t = X.map((x) => fixpoint(soft, teacher, x).z[0]);
const th0 = [0.4, 0.6, 0.0, 0.0];
console.log('1. TRAIN a student to a teacher\'s FIXPOINT map (implicit gradient, Adam):');
console.log(`   loss ${loss(soft, th0, X, t).toFixed(6)} (start)  →  ${[1000, 3000].map((n) => loss(soft, adam((th) => gradImplicit(soft, th, X, t), th0, n, 0.03), X, t)).map((l) => l.toExponential(1)).join('  →  ')}  (converges)`);

// 2) why a fixpoint (and not a fixed-depth unroll): the cycle's geometric tail
console.log('\n2. The CYCLE is load-bearing — a fixed-depth unroll can\'t represent the fixpoint map:');
const zStar = fixpoint(soft, teacher, 0.5).z[0];
const kSweep = (K) => { let z = [0, 0]; for (let i = 0; i < K; i++) z = soft.F(z, teacher, 0.5); return z[0]; };
console.log('   |unroll_K − fixpoint|: ' + [1, 2, 5, 20, 60].map((K) => `K=${K}:${Math.abs(kSweep(K) - zStar).toExponential(1)}`).join('  '));

// 3) the regime: ρ→1 ⇒ slow forward / deep Neumann (apply-cap = truncation depth)
console.log('\n3. The ρ→1 regime (linear cycle z\'=[α·z2+.1, α·z1+.2], ρ=|α| exactly):');
console.log('   α(=ρ) → forward sweeps-to-1e-10:  ' + [0.3, 0.5, 0.7, 0.9, 0.95].map((a) => { const r = solveFixpoint((z) => [a * z[1] + 0.1, a * z[0] + 0.2], [0, 0], { maxIter: 1e5, tol: 1e-10 }); return `ρ=${a}:${r.iters}`; }).join('  '));

// 4) the discrete cast: STE revives the gate's dead hard-gradient
console.log('\n4. STE (hard cast) — the gate weight\'s pure-hard gradient is DEAD; the surrogate revives it:');
const hard = twoCycle('hard');
const thH = [1.4, 2.2, 0.3, 0.4];
const tH = X.map((x) => fixpoint(hard, thH, x).z[0]).map((v) => v - 0.05);
const giH = gradImplicit(hard, thH, X, tH);
const fd = (k) => { const a = thH.slice(), b = thH.slice(); a[k] += 1e-5; b[k] -= 1e-5; return (loss(hard, a, X, tH) - loss(hard, b, X, tH)) / 2e-5; };
console.log(`   gate weight w2:  hard FD-gradient ${fd(1).toExponential(1)} (dead)   vs   STE implicit gradient ${giH[1].toExponential(1)} (alive)`);
console.log('   smooth-path w1:  hard FD-gradient ' + fd(0).toExponential(1) + '   vs   STE implicit gradient ' + giH[0].toExponential(1) + ' (agree)\n');

console.log('→ Learning DOES converge on the composite/fixpoint topology — implicit diff (DEQ) gives the');
console.log('  exact gradient in O(1) memory, contraction ρ<1 is the condition, STE bridges the hard cast.\n');
