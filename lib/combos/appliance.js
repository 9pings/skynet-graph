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
 * C1 — the typed-QA APPLIANCE (roadmap P1 / design doc §3, §11). A THIN assembly over shipped
 * bricks: the prose→typed front door (Intake), the packaged reason loop (createReasonLoop) over the
 * `concepts/_substrate` grammar, the durable content-addressed memo (cache), and the answer/refusal
 * projection — with the §4 product posture wired ON by default (defaults.js).
 *
 * `answer(q)` seeds the question as prose, settles, and projects a DISCRIMINATED result: either an
 * `answered` result (the synthesized answer + its confidence band) or a TYPED `refused` result that
 * NAMES the missing requirement (an intake barrier miss) or the exhausted strategy (an answer-side
 * stuck) — never a wrong answer, never a bare failure. This is the differentiator: the system follows
 * the typed SPEC (refuse when the input isn't faithfully typed) rather than world-plausibility.
 *
 * NO new logic lives here (anti-sclerosis): the appliance reads DISCRETE facts the bricks already
 * emit (`IntakeStatus`, `IntakeMissing`, `answer`, `strategiesExhausted`, `confBand`) and chains
 * brick calls. It never re-derives a verdict, and it never keys on a raw concept-name fact of a
 * pure-assert concept (e.g. `Frontier` lingers after uncast — CLAUDE.md footgun); cast checks go
 * through `_mappedConcepts`.
 *
 * @param opts.concepts   domain concept dir(s) or a pre-built conceptMap (the `_substrate` reasoning
 *                        grammar is always merged in). Omit for a neutral typed-QA appliance.
 * @param opts.ask        REQUIRED (opt-in): a function, or `{ localModel:'<gguf>' }` (embedded).
 * @param opts.verify     optional: `checks` for createVerifier (a verdict gates the Claim chain).
 * @param opts.store      optional: a memo store (default in-memory content-addressed cache).
 * @param opts.maxDepth / opts.maxBranch  reason-loop bounds (see createReasonLoop).
 * @param opts.*          the §4 knobs via resolveComboDefaults (failClosed/gate/memo/validate/…).
 * @returns {{ answer, settle, graph, memo, close }}
 *   answer(question, opts?) => Promise<Result>
 *     Result = { status:'answered', answer, confBand, memoHit }
 *            | { status:'refused', reason:'untyped'|'partial'|'no-strategy', missing:[key…], prose }
 */

var path = require('path');
var Graph = require('../graph');
var defaults = require('./defaults.js');
var loadConceptMap = require('../load.js').loadConceptMap;
var providers = require('../providers');
var validateOrThrow = require('../authoring/validate.js').validateOrThrow;
var nextStable = require('../authoring/supervise.js').nextStable;

var SUBSTRATE_DIR = path.join(__dirname, '..', '..', 'concepts', '_substrate');

// a stable, content-derived id for a question (djb2). Same question → same intake node → same
// deterministic sub-tree ids → a repeat is served from the persisted sub-graph (0 model calls),
// and the leaf `answer` memo amortizes shared sub-steps across DIFFERENT questions.
function qidFor( question ) {
	var h = 5381, s = String(question);
	for ( var i = 0; i < s.length; i++ ) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return '__ask_' + (h >>> 0).toString(36);
}

function createAppliance( opts ) {
	opts = opts || {};
	var d   = defaults.resolveComboDefaults(opts);
	var ask = defaults.buildAsk(d);                       // throws if no backend (opt-in)

	// ── 1. concept map: the domain set(s) + the reasoning substrate (always merged) ──────────────
	var conceptMap;
	if ( opts.conceptMap ) conceptMap = Object.assign({}, opts.conceptMap);
	else {
		var dirs = opts.concepts ? (Array.isArray(opts.concepts) ? opts.concepts.slice() : [opts.concepts]) : [];
		dirs.push(SUBSTRATE_DIR);
		conceptMap = loadConceptMap(dirs);
	}
	if ( !conceptMap._substrate ) Object.assign(conceptMap, loadConceptMap(SUBSTRATE_DIR));
	var conceptSets = Object.keys(conceptMap);

	// ── 2. author-time validation (default ON): reject prose-on-dependency-edges, missing _name … ──
	if ( d.validate ) for ( var set in conceptMap ) validateOrThrow(conceptMap[set]);

	// ── 3. providers: intake (front door) + the packaged reason loop + optional verifier ─────────
	var intakeFrag = providers.createIntake({ ask: ask });
	var reasonFrag = providers.createReasonLoop({ ask: ask, maxDepth: opts.maxDepth, maxBranch: opts.maxBranch });
	var verifyFrag = opts.verify ? providers.createVerifier({ checks: opts.verify }) : null;

	// ── 4. durable memo (default ON): wrap only the CONTENT-producing providers; the CanonMiss
	//       fail-closed in the cache keeps a non-typed intake un-cacheable (a refusal always
	//       re-calls, by design). STRUCTURAL providers are NOT memoized — expand/seedTask return
	//       templates with ids derived from the CURRENT segment, so a cached template carries stale
	//       ids and mis-wires a different question's sub-tree; and reportUp/rollup are deterministic
	//       / fire-once. Cross-question amortization comes from the leaf `answer` cache (a shared
	//       sub-step label hits); same-question 0-call replay comes from the content-stable id +
	//       the fast path in answer() (the sub-graph persists and is reused). ────────────────────
	var memo = null;
	if ( d.memo ) {
		memo = providers.createProviderCache({ store: opts.store });
		var kfs = providers.keyFromScope;
		intakeFrag = memo.wrapFragment(intakeFrag, { 'Intake::type': kfs({ facts: ['rawText'], require: ['rawText'] }) });
		reasonFrag = memo.wrapFragment(reasonFrag, {
			'AI::evalComplexity': kfs({ facts: ['label', 'depth'], require: ['label'] }),
			'AI::answer'        : kfs({ facts: ['label'], require: ['label'] }),
			'AI::confidence'    : kfs({ facts: ['label', 'answer'], require: ['label'] }),
			'AI::expand'        : false,   // structural (id-generating) — a cached template carries stale ids
			'AI::rollup'        : false,   // fires once per task on the completion gate (memo gives nothing)
			'AI::seedTask'      : false,   // structural + deterministic (no ask)
			'AI::reportUp'      : false    // deterministic fan-in (no ask)
		});
	}

	// ── 5. wire the providers (process-global; one appliance per process — engine constraint) ─────
	var frags = [intakeFrag, reasonFrag];
	if ( verifyFrag ) frags.push(verifyFrag);
	providers.register(Graph, frags);

	// ── 6. the graph ─────────────────────────────────────────────────────────────────────────────
	var graph = new Graph({}, {
		label: 'appliance', isMaster: true, autoMount: true, conceptSets: conceptSets,
		bagRefManagers: {}, logLevel: d.logLevel, logger: opts.logger
	}, conceptMap);

	// ── the answer/refusal projection: PURE reads of discrete facts the bricks already emit ───────
	// (keyed by the question's intake node id; the memo is CONTENT-addressed — rawText/label — so a
	//  fresh id per question still replays bit-identically on a repeat question.)
	function project( qid ) {
		var q = graph._objById[qid], task = graph._objById[qid + '_task'];
		var qf = q && q._etty._;
		if ( !qf ) return { status: 'refused', reason: 'untyped', missing: [], prose: null };
		// intake-side refusal: a barrier miss never became a typed task.
		if ( qf.IntakeStatus !== 'typed' ) {
			return {
				status : 'refused',
				reason : qf.IntakeStatus || 'untyped',            // 'untyped' | 'partial'
				missing: Array.isArray(qf.IntakeMissing) ? qf.IntakeMissing.slice() : [],
				prose  : qf.intakeNarrative != null ? qf.intakeNarrative : null
			};
		}
		var tf = task && task._etty._;
		// answer-side stuck: typed but no strategy routed it.
		if ( !tf || tf.strategiesExhausted || tf.answer == null )
			return { status: 'refused', reason: 'no-strategy', missing: [], prose: qf.intakeNarrative != null ? qf.intakeNarrative : null };
		return { status: 'answered', answer: tf.answer, confBand: tf.confBand || null };
	}

	// is this question's sub-graph fully settled (answered, refused, or stuck)? → the fast-path replay.
	function isResolved( qid ) {
		var q = graph._objById[qid], qf = q && q._etty._;
		if ( !qf || qf.IntakeStatus == null ) return false;
		if ( qf.IntakeStatus !== 'typed' ) return true;                         // an intake-side refusal is terminal
		var t = graph._objById[qid + '_task'], tf = t && t._etty._;
		return !!(tf && (tf.answer != null || tf.strategiesExhausted));
	}

	return {
		graph: graph,
		memo : memo,   // expose the cache (stats/store) — P1.c reads memo.stats for the G4 replay gate
		settle: function () { return nextStable(graph); },
		close: function () { if ( graph && graph.destroy ) graph.destroy(); },

		/** answer a question → a typed answer or a typed refusal (see Result above). */
		answer: function ( question, aopts ) {
			aopts = aopts || {};
			var qid = qidFor(question);
			// fast path: this exact question is already resolved in the graph → replay it, 0 model calls.
			if ( isResolved(qid) ) return Promise.resolve(project(qid));
			return new Promise(function ( resolve, reject ) {
				var to = aopts.timeout || 120000;
				var timer = setTimeout(function () { graph.un('stabilize', done); reject(new Error('appliance.answer timed out after ' + to + 'ms')); }, to);
				var settled = false;
				function done() {
					if ( settled || !isResolved(qid) ) return;
					settled = true; clearTimeout(timer); graph.un('stabilize', done); resolve(project(qid));
				}
				graph.on('stabilize', done);
				try {
					graph.pushMutation({ $$_id: qid, Node: true, rawText: String(question) }, null);
				} catch ( e ) { clearTimeout(timer); graph.un('stabilize', done); reject(e); }
			});
		}
	};
}

module.exports = { createAppliance: createAppliance };
