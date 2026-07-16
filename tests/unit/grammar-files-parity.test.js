'use strict';
/*
 * Copyright 2026 Nathanael Braun
 * AGPL-3.0-or-later. See <https://www.gnu.org/licenses/>.
 */
// Regression PINS for the grammar→files extraction (owner rule: no grammar hard-coded in JS).
// Each EXPECTED below is the pre-refactor inline literal kept VERBATIM as the parity control:
// the file-built trees must stay deep-equal to what the code used to declare inline. If a pin
// goes red, the extracted files DRIFTED from the shipped grammar — fix the files, not the pin.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { loopConceptTree, reactiveLoopConceptTree } = require('../../lib/authoring/loop.js');
const { supportConceptTree } = require('../../lib/authoring/support.js');
const { selectConceptTree } = require('../../lib/providers/semiring.js');
const { buildConceptTree } = require('../../lib/authoring/concepts.js');
const { loadPlugin } = require('../../lib/plugins/load.js');

// ── the decompose-loop literal as shipped in lib/authoring/loop.js pre-extraction ──
const EXP_LOOP = {
	childConcepts: {
		Task: {
			_id: 'Task', _name: 'Task', require: 'Segment',
			childConcepts: {
				EvalComplexity: { _id: 'EvalComplexity', _name: 'EvalComplexity', require: ['Task'], provider: ['AI::evalComplexity'] },
				Expand        : { _id: 'Expand', _name: 'Expand', require: ['Task', 'NeedsSplit'], provider: ['AI::expand'] },
				Answer        : { _id: 'Answer', _name: 'Answer', require: ['Task', 'Atomic'], provider: ['AI::answer'] }
			}
		}
	}
};

// the two reactive-synthesis concepts the reactive variant adds (pre-extraction literal)
const EXP_REPORT_UP = { _id: 'ReportUp', _name: 'ReportUp', require: ['Task', 'Answered', 'parentSeg'], provider: ['AI::reportUp'] };
const EXP_ROLLUP    = { _id: 'Rollup', _name: 'Rollup', require: ['Task', 'expandedInto'], ensure: ['$answeredBy.length == $expandedInto.length'], provider: ['AI::rollup'] };

test('loopConceptTree == the pre-refactor inline literal', () => {
	assert.deepStrictEqual(loopConceptTree, EXP_LOOP);
});

test('reactiveLoopConceptTree == loop + ReportUp/Rollup (pre-refactor literal)', () => {
	const exp = JSON.parse(JSON.stringify(EXP_LOOP));
	Object.assign(exp.childConcepts.Task.childConcepts, { ReportUp: EXP_REPORT_UP, Rollup: EXP_ROLLUP });
	assert.deepStrictEqual(reactiveLoopConceptTree, exp);
});

test('supportConceptTree(criteria) == the pre-refactor inline literal (Select stays parametric)', () => {
	const CRIT = { conf: ['low', 'mid', 'high'], cost: { dir: 'min' } }, LEX = ['conf', 'cost'];
	// Select is NOT in files — it is built at call time from the host's criteria (parametric, same
	// status as the CtxProj factory providers). The pin re-derives it with the same builder+opts.
	const sel = selectConceptTree({ criteria: CRIT, lex: LEX, idKey: undefined, contribKey: 'candidates', require: ['Task', 'Atomic'] });
	const exp = {
		childConcepts: {
			Task: {
				_id: 'Task', _name: 'Task', require: 'Segment',
				childConcepts: {
					EvalComplexity: { _id: 'EvalComplexity', _name: 'EvalComplexity', require: ['Task'], provider: ['AI::evalComplexity'] },
					Expand        : { _id: 'Expand', _name: 'Expand', require: ['Task', 'NeedsSplit'], provider: ['AI::expand'] },
					Propose       : { _id: 'Propose', _name: 'Propose', require: ['Task', 'Atomic'], provider: ['Support::propose'] },
					Select        : sel.childConcepts.Select,
					Adopt         : { _id: 'Adopt', _name: 'Adopt', require: ['Task', 'selectedId'], provider: ['Support::adopt'] },
					ReportUp      : EXP_REPORT_UP,
					Rollup        : EXP_ROLLUP
				}
			}
		}
	};
	assert.deepStrictEqual(supportConceptTree({ criteria: CRIT, lex: LEX }), exp);
});

test('forge Plan grammar (files) == the pre-refactor inline TREE literal', () => {
	const tree = buildConceptTree(path.join(__dirname, '..', '..', 'plugins', 'forge', 'concepts', 'forge'));
	assert.deepStrictEqual(tree, {
		childConcepts: {
			Plan: { _id: 'Plan', _name: 'Plan', require: ['Segment', 'taskKind'], ensure: ['!$Planned'], provider: ['Plan::plan'] }
		}
	});
});

test('planner + forge plugins load their grammar sets via loadPlugin', () => {
	const planner = loadPlugin(path.join(__dirname, '..', '..', 'plugins', 'planner'));
	assert.deepStrictEqual(Object.keys(planner.concepts).sort(), ['loop', 'loop-reactive', 'planner', 'support']);
	assert.deepStrictEqual(planner.providerNamespaces, ['CtxProj', 'Support']);
	const forge = loadPlugin(path.join(__dirname, '..', '..', 'plugins', 'forge'));
	assert.deepStrictEqual(Object.keys(forge.concepts), ['forge']);
	assert.deepStrictEqual(forge.providerNamespaces, ['Plan']);
	assert.ok(forge.concepts.forge.childConcepts.Plan, 'the forge set carries the Plan concept');
});
