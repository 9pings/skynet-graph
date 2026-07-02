/*
 * Copyright 2026 Nathanael Braun
 * @author : Nathanael BRAUN <pp9ping@gmail.com>
 *
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * typed-loop — the fused RECURSIVE TYPED decompose operator (ZERO-CORE, host-side).
 *
 * `loop.js#makeDecomposeProviders` gives the emergent-depth decompose loop (the MODEL decides atomic-vs-split,
 * depth-floored), but its expand writes PROSE on the children (`label`/`description`) — so a real decompose trace
 * fails K1 and is NOT crystallizable (the cont.⁷ #1 confront finding). This operator fuses the two requirements:
 *
 *   emergent depth (loop.js, inherited verbatim)  ×  TYPED per-step content:
 *     - each child step carries `stepKind` — canon-snapped onto a CLOSED enum via the deterministic barrier
 *       (`canonValue`: exact + case/ws-normalized + curated synonym ring, FAIL-CLOSED — an out-of-vocab kind
 *       never mints a typed fact; it rides `StepKindMiss:true` + the raw surface on the untracked `stepKindRaw`),
 *     - `stepIndex` (typed position), and the created MID node carries the typed `state:'plan-<kind>'`,
 *     - prose (`label`/`description`/`answer`/`stepKindRaw`) stays on UNTRACKED keys (`TYPED_PROSE_KEYS` — feed it
 *       to `crystallizeStructural`'s `proseKeys` / `mineMethods opts.proseKeys`),
 *
 * so the engine's OWN decompose trace becomes K1-crystallizable: the typed structure crystallizes, the varying
 * free text stays per-instance. Same concept tree as loop.js (`loopConceptTree` — only the providers differ);
 * eval/answer/rollup/reportUp are delegated to `makeDecomposeProviders` untouched.
 *
 * expandFn(scope) -> [{ stepKind, name?, description? }, ...]   (vs loop.js's { name, description })
 */
const { makeDecomposeProviders, loopConceptTree, reactiveLoopConceptTree, synthesize } = require('./loop.js');
const { canonValue } = require('../providers/canonicalize.js');

/** Every untracked prose key the operator writes — the crystallizer contract (pass as `proseKeys`). */
const TYPED_PROSE_KEYS = ['label', 'description', 'answer', 'stepKindRaw'];

function makeTypedDecomposeProviders( opts ) {
	opts = opts || {};
	var spec      = Array.isArray(opts.stepKinds) ? { enum: opts.stepKinds } : (opts.stepKinds || { enum: [] }),
	    maxBranch = opts.maxBranch || 4,
	    expandFn  = opts.expandFn || function () { return []; },
	    base      = makeDecomposeProviders(opts);                    // eval/answer/rollup/reportUp inherited verbatim

	base.AI.expand = function ( graph, concept, scope, argz, cb ) {
		Promise.resolve(expandFn(scope)).then(function ( raw ) {
			var steps = (raw || []).slice(0, maxBranch);
			if ( !steps.length ) return cb(null, { $_id: '_parent', Expand: true, Atomic: true });// nothing to split -> leaf
			var baseId   = scope._._id,
			    origin   = scope._.originNode,
			    target   = scope._.targetNode,
			    depth    = (scope._.depth || 0) + 1,
			    childIds = steps.map(function ( _, i ) { return baseId + '_s' + i; }),
			    tpl      = [{ $_id: '_parent', Expand: true, expandedInto: childIds }],
			    prev     = origin;
			steps.forEach(function ( st, i ) {
				var last  = i === steps.length - 1,
				    tnode = last ? target : baseId + '_m' + i,
				    snap  = canonValue(st.stepKind, spec),
				    child = {
					    _id: childIds[i], Segment: true, originNode: prev, targetNode: tnode,
					    depth: depth, parentSeg: baseId, stepIndex: i,
					    label: st.name, description: st.description
				    };
				if ( snap.miss ) { child.StepKindMiss = true; child.stepKindRaw = String(st.stepKind); }
				else { child.stepKind = snap.value; if ( snap.via ) child.stepVia = snap.via; }
				// the created MID node carries the typed plan-state (never the external target — frontier untouched);
				// a miss mints NO typed state (fail-closed on the node too).
				if ( !last ) tpl.push(snap.miss ? { _id: tnode, Node: true } : { _id: tnode, Node: true, state: 'plan-' + snap.value });
				tpl.push(child);
				prev = tnode;
			});
			cb(null, tpl);
		}).catch(function ( e ) { cb(null, { $_id: '_parent', Expand: true, Atomic: true, llmError: e.message }); });
	};
	return base;
}

module.exports = {
	makeTypedDecomposeProviders: makeTypedDecomposeProviders,
	TYPED_PROSE_KEYS           : TYPED_PROSE_KEYS,
	// re-exports so a host needs ONE require for the typed loop
	loopConceptTree            : loopConceptTree,
	reactiveLoopConceptTree    : reactiveLoopConceptTree,
	synthesize                 : synthesize
};
