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
 */
var defaults  = require('./defaults.js');
var appliance = require('./appliance.js');

module.exports = {
	resolveComboDefaults: defaults.resolveComboDefaults,
	buildAsk            : defaults.buildAsk,
	createAppliance     : appliance.createAppliance
	// createDurableRunner / createLearningLibrary / createSelfMod land with their phases (P2-P4).
};
