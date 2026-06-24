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
 * Straight-Through Estimator (STE) training for concept-networks (doc/WIP/HANDOFF.md §7 Tier 4;
 * experiment E5). Zero core change — an OFFLINE trainer (run between revisions, not in the cast
 * loop) plus a provider that bakes the learned weights into a concept doing HARD forward
 * inference. Train SOFT (sigmoid + SGD), infer HARD (step/threshold cast) with the same weights:
 * the straight-through estimator, consistent with the canonicalization barrier (a hard discrete
 * cast at inference, continuous only during offline training).
 *
 * The thesis it makes operational (E5, the user's founding intuition): the TOPOLOGY decides what
 * is learnable. A single log-linear unit learns AND but never XOR; adding a hidden layer (depth
 * in the concept topology) turns the unlearnable into the learnable — measured, not asserted.
 *
 *   const { trainNet, predictHard, createNet, netConceptTree } = require('./ste');
 *   const fit = trainNet(X, Y, { layers: [2, 3, 1], restarts: 8 });   // offline
 *   register(Graph, [ createNet(fit.net, { inputKeys: ['x0', 'x1'] }) ]); // bake -> Net::infer (hard)
 *
 * NOT a substitute for the deterministic socle: this trains a bounded feed-forward concept-net
 * offline. Cross-strata credit assignment for continuous weights across the full graph is open R&D.
 */

function sigmoid( x ) { return 1 / (1 + Math.exp(-x)); }
function dSigmoidFromOutput( y ) { return y * (1 - y); }   // σ'(z) in terms of a = σ(z)

// Initialise an MLP for the given layer sizes [n_in, ..., n_out]; weights/biases in [-1,1].
function initNet( layers, rng ) {
	rng = rng || Math.random;
	var W = [], b = [];
	for ( var l = 1; l < layers.length; l++ ) {
		var rows = layers[l], cols = layers[l - 1], Wl = [], bl = [];
		for ( var i = 0; i < rows; i++ ) {
			var row = [];
			for ( var j = 0; j < cols; j++ ) row.push(rng() * 2 - 1);
			Wl.push(row);
			bl.push(rng() * 2 - 1);
		}
		W.push(Wl); b.push(bl);
	}
	return { layers: layers.slice(), W: W, b: b };
}

// Soft forward pass; returns the activation vector of every layer (acts[0] = input).
function forward( net, x ) {
	var acts = [x.slice()];
	for ( var l = 0; l < net.W.length; l++ ) {
		var Wl = net.W[l], bl = net.b[l], a = acts[acts.length - 1], out = [];
		for ( var i = 0; i < Wl.length; i++ ) {
			var z = bl[i];
			for ( var j = 0; j < Wl[i].length; j++ ) z += Wl[i][j] * a[j];
			out.push(sigmoid(z));
		}
		acts.push(out);
	}
	return acts;
}

// One SGD step (MSE loss) on a single example.
function trainStep( net, x, y, lr ) {
	var acts = forward(net, x), L = net.W.length, deltas = new Array(L);
	var outA = acts[L], dL = [];
	for ( var i = 0; i < outA.length; i++ ) dL.push((outA[i] - y[i]) * dSigmoidFromOutput(outA[i]));
	deltas[L - 1] = dL;
	for ( var l = L - 2; l >= 0; l-- ) {
		var Wnext = net.W[l + 1], dNext = deltas[l + 1], a = acts[l + 1], d = [];
		for ( var iH = 0; iH < a.length; iH++ ) {
			var s = 0;
			for ( var k = 0; k < Wnext.length; k++ ) s += Wnext[k][iH] * dNext[k];
			d.push(s * dSigmoidFromOutput(a[iH]));
		}
		deltas[l] = d;
	}
	for ( var ll = 0; ll < L; ll++ ) {
		var aPrev = acts[ll], Wl = net.W[ll], bl = net.b[ll], dd = deltas[ll];
		for ( var r = 0; r < Wl.length; r++ ) {
			for ( var c = 0; c < Wl[r].length; c++ ) Wl[r][c] -= lr * dd[r] * aPrev[c];
			bl[r] -= lr * dd[r];
		}
	}
}

// Mean squared error over a dataset.
function mseLoss( net, X, Y ) {
	var s = 0;
	for ( var i = 0; i < X.length; i++ ) {
		var o = forward(net, X[i]).pop();
		for ( var j = 0; j < o.length; j++ ) s += (o[j] - Y[i][j]) * (o[j] - Y[i][j]);
	}
	return s / X.length;
}

/**
 * Train an MLP offline (SOFT — sigmoid + SGD), with random restarts to escape bad inits.
 * @param X        inputs (array of number vectors)
 * @param Y        targets (array of number vectors)
 * @param opts.layers    layer sizes (default [n_in, 2, n_out]); the TOPOLOGY that gates learnability
 * @param opts.epochs    passes over the data (default 3000)
 * @param opts.lr        learning rate (default 0.5)
 * @param opts.restarts  random restarts; keep the best (default 6)
 * @param opts.rng       seedable RNG for reproducibility (default Math.random)
 * @returns { net, loss }  the lowest-loss net
 */
function trainNet( X, Y, opts ) {
	opts = opts || {};
	var layers = opts.layers || [X[0].length, 2, Y[0].length],
	    epochs = opts.epochs || 3000, lr = opts.lr || 0.5, restarts = opts.restarts || 6, rng = opts.rng || Math.random,
	    best = null;
	for ( var r = 0; r < restarts; r++ ) {
		var net = initNet(layers, rng);
		for ( var e = 0; e < epochs; e++ )
			for ( var i = 0; i < X.length; i++ ) trainStep(net, X[i], Y[i], lr);
		var loss = mseLoss(net, X, Y);
		if ( !best || loss < best.loss ) best = { net: net, loss: loss };
	}
	return best;
}

/**
 * Straight-through HARD inference: the SAME learned weights, but every unit is a STEP (z≥0 → 1)
 * instead of a sigmoid — i.e. each layer's activation is snapped (round(σ(z))). This is the cast
 * the engine performs; it equals the rounded soft prediction on a well-separated trained net (E5).
 */
function predictHard( net, x ) {
	var a = x.slice();
	for ( var l = 0; l < net.W.length; l++ ) {
		var Wl = net.W[l], bl = net.b[l], out = [];
		for ( var i = 0; i < Wl.length; i++ ) {
			var z = bl[i];
			for ( var j = 0; j < Wl[i].length; j++ ) z += Wl[i][j] * a[j];
			out.push(z >= 0 ? 1 : 0);
		}
		a = out;
	}
	return a;
}

/**
 * Bake a trained net into a provider fragment (host opt-in). The provider reads the input facts
 * and writes the HARD prediction — offline-trained weights, hard inference in the engine.
 * @param net           a trained net (from trainNet().net)
 * @param opts.inputKeys default input fact keys (per-concept override via the concept's `net`)
 * @returns { Net: { infer } }
 *
 * Concept wiring: { require:['input'], provider:['Net::infer'], net:{ inputKeys:['x0','x1'], as:'' } }
 * Emits the self-flag + <as>pred (a scalar for a single output, else the vector).
 */
function createNet( net, opts ) {
	opts = opts || {};
	return {
		Net: {
			infer: function ( graph, concept, scope, argz, cb ) {
				var cfg = Object.assign({ inputKeys: opts.inputKeys || [], as: '' },
					concept._schema && concept._schema.net, argz && argz[0]),
				    x = cfg.inputKeys.map(function ( k ) { return Number(scope._[k]); }),
				    y = predictHard(net, x),
				    facts = { $_id: '_parent' };
				facts[concept._name] = true;
				facts[cfg.as + 'pred'] = y.length === 1 ? y[0] : y;
				cb(null, facts);
			}
		}
	};
}

/** A ready-made inference concept fragment for a baked net. */
function netConceptTree( opts ) {
	opts = opts || {};
	return {
		childConcepts: {
			Net: {
				_id: 'Net', _name: 'Net',
				require: [opts.require || 'input'],
				provider: ['Net::infer'],
				net: { inputKeys: opts.inputKeys || [], as: opts.as || '' }
			}
		}
	};
}

module.exports = {
	trainNet: trainNet,
	predictHard: predictHard,
	forward: forward,
	mseLoss: mseLoss,
	createNet: createNet,
	netConceptTree: netConceptTree
};
