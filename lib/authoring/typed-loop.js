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
 * depth-floored), but its trace is NOT K1-crystallizable/mountable, for THREE confronted reasons (the cont.⁷ #1
 * finding + the 2026-07-02 Laurie confront, verdicts A+B — each reproduced live by `probe-mount-elision.js`):
 *   1. its expand writes PROSE on the children (`label`/`description`) → same typed premise, varying patch →
 *      `signatureDetermined` falls → not crystallizable;
 *   2. the children's `EvalComplexity`/`Atomic` verdicts are OTHER casts, so a mined replay template (the
 *      per-cast patch) mounts children WITHOUT their self-flags → the providers re-fire on the mounted subtree
 *      (Entity.js:165 — the self-flag is the only re-fire guard, #33) → a mount elides NOTHING and can diverge;
 *   3. the structure-discriminating kind is written DATA, on no concept's require/assert → it never reaches the
 *      memo surface (`memoSurfaceKeys`) → `premiseOf` can't capture it → one constant signature for all
 *      structures → `signature-insufficient` refusal on any heterogeneous corpus.
 *
 * The fused operator fixes all three:
 *   - TYPED steps: each child carries `stepKind` — canon-snapped onto a CLOSED enum (`canonValue`: exact +
 *     case/ws-normalized + curated ring, FAIL-CLOSED — an out-of-vocab kind never mints a typed fact; it rides
 *     `StepKindMiss:true` + the raw surface on the untracked `stepKindRaw`) + `stepIndex`; the created MID node
 *     carries the typed `state:'plan-<kind>'`; prose stays on UNTRACKED keys (`TYPED_PROSE_KEYS` → `proseKeys`).
 *   - STAMPED eval verdicts (Laurie A): the model decides split-vs-atomic PER STEP at expand time, so the child
 *     is born `EvalComplexity:true` + (`Atomic:true` | `NeedsSplit:true`) IN THE SAME PATCH — the mined template
 *     carries the re-fire guards, `blendAtSegment` merges them through composites, and a mounted structure
 *     actually elides the calls. A step defaults to atomic (`atomic !== false`); the depth floor forces Atomic.
 *     A NeedsSplit child whose kind MISSED cannot expand (no typed key) — fail-closed, it escalates to the host.
 *   - SIGNATURE-CARRYING requires (Laurie B): `typedLoopConceptTree({ sigKey })` puts the discriminating typed
 *     key (default `stepKind`) into Expand's `require`, so the firing premise captures its VALUE and
 *     `signatureKeys` discriminate per class. The ROOT task carries the same key from intake.
 *
 * expandFn(scope) -> [{ stepKind, atomic?, name?, description? }, ...]
 */
const path = require('path');
const dmerge = require('deepmerge');
const { makeDecomposeProviders, synthesize } = require('./loop.js');
const { buildConceptTree } = require('./concepts.js');
const { canonValue } = require('../providers/canonicalize.js');
const { instantiate } = require('./abstract.js');

/** Every untracked prose key the operator writes — the crystallizer contract (pass as `proseKeys`). */
const TYPED_PROSE_KEYS = ['label', 'description', 'answer', 'stepKindRaw'];

/** The decompose concept tree with the discriminating typed key IN Expand's require (Laurie B). */
function typedLoopConceptTree( opts ) {
	opts = opts || {};
	var sigKey = opts.sigKey || 'stepKind';
	// The GRAMMAR lives in FILES — the planner plugin's `loop` (+ `loop-reactive`) sets, the same
	// single source as loopConceptTree (no duplicated literal). The TYPED variation is a parametric
	// PATCH, not a grammar: the discriminating typed key goes INTO Expand's require so the firing
	// premise captures its VALUE (Laurie B) — a generator, applied to the file-built tree.
	var SETS = path.join(__dirname, '..', '..', 'plugins', 'planner', 'concepts');
	var t = buildConceptTree(path.join(SETS, 'loop'));
	if ( opts.reactive ) t = dmerge(t, buildConceptTree(path.join(SETS, 'loop-reactive')));
	t.childConcepts.Task.childConcepts.Expand.require = ['Task', 'NeedsSplit', sigKey];
	return t;
}

function makeTypedDecomposeProviders( opts ) {
	opts = opts || {};
	var spec      = Array.isArray(opts.stepKinds) ? { enum: opts.stepKinds } : (opts.stepKinds || { enum: [] }),
	    maxDepth  = opts.maxDepth == null ? 2 : opts.maxDepth,
	    maxBranch = opts.maxBranch || 4,
	    expandFn  = opts.expandFn || function () { return []; },
	    stepFacts = opts.stepFacts || [],                            // TYPED per-step content keys the expand may emit
	    base      = makeDecomposeProviders(opts);                    // eval/answer/rollup/reportUp inherited verbatim

	base.AI.expand = function ( graph, concept, scope, argz, cb ) {
		Promise.resolve(expandFn(scope)).then(function ( raw ) {
			var steps = (raw || []).slice(0, maxBranch);
			if ( !steps.length ) return cb(null, { $_id: '_parent', Expand: true, Atomic: true });// nothing to split -> leaf
			var baseId   = scope._._id,
			    origin   = scope._.originNode,
			    target   = scope._.targetNode,
			    depth    = (scope._.depth || 0) + 1,
			    floored  = depth >= maxDepth,
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
					    label: st.name, description: st.description,
					    // the STAMPED verdict (Laurie A): the model decided split-vs-atomic for this step NOW,
					    // so the guard is part of THIS patch and a mounted replay cannot re-fire the providers.
					    EvalComplexity: true
				    };
				if ( floored || st.atomic !== false ) child.Atomic = true; else child.NeedsSplit = true;
				if ( snap.miss ) { child.StepKindMiss = true; child.stepKindRaw = String(st.stepKind); }
				else { child.stepKind = snap.value; if ( snap.via ) child.stepVia = snap.via; }
				// declared TYPED per-step content facts (a placed param, e.g. `group`) ride the child — the trace
				// grain the LGG holes into SLOTS ("under-qualified = abstract = a slot"); NEVER prose, whitelist-only.
				for ( var fi = 0; fi < stepFacts.length; fi++ )
					if ( st[stepFacts[fi]] !== undefined ) child[stepFacts[fi]] = st[stepFacts[fi]];
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

/**
 * Ground a crystallized/composed template for DIRECT mounting on a task segment (the arm's dispatch-mount —
 * a MUTATION, never a racing concept): instantiate holes onto the site, rebase the `$_id:'_parent'` entries
 * onto the root id, and stamp the root's own eval verdict (the mount decision subsumes EvalComplexity — the
 * root eval call is elided too). Returns null if a frontier ref is unbound (never a partial mount).
 *
 * ATOMICITY (the boot race): a live graph stabilizes as soon as the task segment exists — a mount pushed
 * AFTER the segment is seeded races the decompose providers (they fire before the mount lands and the spend
 * is NOT elided). So a mount-hit task must be created WITH its mounted structure in ONE mutation:
 * `site.create` makes the rebased `_parent` entry CREATE the task segment (Segment + frontier + site.facts)
 * instead of updating an existing one.
 * @param tpl     candidate.templatesBySig[sig] (relativized)
 * @param site    { rootId, origin, target, base?, create?, facts? }  base defaults to rootId (fresh id-space);
 *                facts = the task's typed facts (e.g. the sig key) when creating.
 */
function mountTemplate( tpl, site ) {
	var ground = instantiate(tpl, { base: site.base || site.rootId, refs: { origin: site.origin, target: site.target } });
	if ( !ground ) return null;
	var out = (Array.isArray(ground) ? ground : [ground]).map(function ( o ) {
		if ( o && o.$_id === '_parent' ) {
			var r = Object.assign({}, o, { EvalComplexity: true, NeedsSplit: true });
			delete r.$_id;
			if ( site.create )
				Object.assign(r, { _id: site.rootId, Segment: true, originNode: site.origin, targetNode: site.target }, site.facts || {});
			else r.$$_id = site.rootId;
			return r;
		}
		return o;
	});
	return out;
}

module.exports = {
	makeTypedDecomposeProviders: makeTypedDecomposeProviders,
	typedLoopConceptTree       : typedLoopConceptTree,
	mountTemplate              : mountTemplate,
	TYPED_PROSE_KEYS           : TYPED_PROSE_KEYS,
	synthesize                 : synthesize
};
