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
 * Combos — THIN, delivered assemblies over the shipped bricks (roadmap P1+, design doc
 * doc/WIP/2026-07-05-combos-design.md). Each combo composes existing library bricks with the §4
 * product posture (defaults.js) wired ON; it never adds new logic (a missing piece goes into the
 * brick, not here) and the underlying bricks stay usable "à nu". Reached lazily via `Graph.combos`.
 *
 *   createAppliance         C1 — typed-QA appliance (intake→reason-loop→typed refusal→memo)   [P1]
 *   createDurableRunner     C2 — durable workflow executor                                    [P4]
 *   createLearningLibrary   C3 — learning method library                                      [P2-P3]
 *   createSelfMod           C5 — supervised self-modification (opt-in, guarded)               [P3-bis]
 *   createProxyCache        C6 — local-first proxy cache / distiller (cover→serve / miss→escalate+enrich)
 */
var defaults  = require('./defaults.js');
var appliance = require('./appliance.js');
var learning  = require('./learning-library.js');
var durable   = require('./durable-runner.js');
var selfmod   = require('./self-mod.js');
var proxy     = require('./proxy-cache.js');

module.exports = {
	resolveComboDefaults : defaults.resolveComboDefaults,
	buildAsk             : defaults.buildAsk,
	createAppliance      : appliance.createAppliance,       // C1 — typed-QA appliance
	createLearningLibrary: learning.createLearningLibrary,  // C3 (P3 COMPLETE) — ladder + crystallizeFrom + learning forge (adaptOrForgeAsync) + blame/credit + .sgc
	createDurableRunner  : durable.createDurableRunner,     // C2 — durable workflow runner (compile/run/resume/audit)

	// C4 — the reactive KG (the engine's ORIGINAL Use-1: rule-KG + concepts + stabilization + travel/geo).
	// A trivial preset over Graph.fromDirs (builtins ON = geo + default llm) — the core + fromDirs stay the
	// real entry, usable "à nu"; this just names the historical capability. Lazy-required (avoids a load-time
	// cycle: lib/index.js → the Graph.combos getter → here → lib/index.js).
	reactiveKG: function ( opts ) { return require('../index.js').fromDirs(Object.assign({ builtins: true }, opts || {})); },

	// C5 — supervised self-modification (OPT-IN, guarded: author() requires a proposer; rollbackTo is the
	// reversibility guarantee). Edits the LIVE rules — a host builds it explicitly, never a default.
	createSelfMod: selfmod.createSelfMod,

	// C6 — local-first proxy cache / distiller: serve a query from the minimal local stock when COVERED,
	// escalate to the frontier model on a miss and enrich the stock in passing. The local side never
	// fabricates (0 hallucination); a miss escalates (no false neg); anti-drift + .sgc on demand. A thin
	// preset over createLearningLibrary (forge = the frontier ask).
	createProxyCache: proxy.createProxyCache,
	makeFrontierAsk : proxy.makeFrontierAsk,   // wire a chat backend (embedded gguf / endpoint) as the frontier ground-truth
	makeLocalCoverage: proxy.makeLocalCoverage // wire a small local model as the semantic-key + coverage-check judge
};
