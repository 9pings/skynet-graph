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
 * Instance-type DESCRIPTOR — the contract + its reference consumer.
 *
 * A type descriptor is the single artifact an instance service dispatches on (and, later, generates
 * typed MCP tools from — one tool per action, schema'd by `input`):
 *
 *   { type: 'notepad', version: '1.0.0',
 *     conceptSets: [...],                          // grammar the type needs merged at boot
 *     concurrency: ['shared-sequenced', ...],      // modes THIS type supports
 *     create(seed) -> mutation template,           // seed a fresh instance
 *     actions: {
 *       <name>: { write: true,  input: <schema>, apply(g, args, ctx) -> template },   // a WRITE verb
 *       <name>: { write: false, input: <schema>, project(g, args)   -> data },        // a READ verb
 *     },
 *     projections: { <name>(g) -> data } }         // bounded reads outside the action set
 *
 * The three helpers here are what a store rides:
 *   validateDescriptor(d)                   fail-closed shape check (author-time + load-time)
 *   createInstance(d, {seed, conceptMap})   boot a settled Graph + apply create(seed), sequenced
 *   runAction(g, d, name, args, ctx)        typed dispatch — unknown action = a TYPED refusal
 *
 * ATTRIBUTION IS ENFORCED AT THE DOOR (R0 decision, [ZERO-CORE]): a WRITE action's returned template
 * is stamped `by: ctx.agent` on every item by the RUNNER — descriptor authors never hand-write it, so
 * it cannot be forgotten; a write without `ctx.agent` is refused. The `by` passenger fact rides the
 * three provenance surfaces (object facts, diffRevisions, the `_revs[].tpl` atoms), proven by
 * WIP R0 2026-07-18. `input` schemas are carried for the MCP tool generation layer; argument
 * validation lives at that boundary, not here.
 */
const Graph = require('../graph/index.js');
const { nextStable } = require('../authoring/core/supervise.js');

function validateDescriptor( d ) {
	if ( !d || typeof d !== 'object' ) throw new Error('descriptor: not an object');
	if ( !d.type || typeof d.type !== 'string' ) throw new Error('descriptor: `type` is required (a string)');
	if ( !d.version || typeof d.version !== 'string' ) throw new Error("descriptor '" + d.type + "': `version` is required (a semver string)");
	if ( d.create && typeof d.create !== 'function' ) throw new Error("descriptor '" + d.type + "': `create` must be a function (seed) -> template");
	var actions = d.actions || {};
	if ( !Object.keys(actions).length ) throw new Error("descriptor '" + d.type + "': `actions` must declare at least one action");
	Object.keys(actions).forEach(function ( name ) {
		var a = actions[name];
		if ( !a || typeof a !== 'object' ) throw new Error("descriptor '" + d.type + "': action '" + name + "' is not an object");
		if ( a.write ) {
			if ( typeof a.apply !== 'function' ) throw new Error("descriptor '" + d.type + "': write action '" + name + "' must carry apply(g, args, ctx) -> template");
		}
		else if ( typeof a.project !== 'function' ) throw new Error("descriptor '" + d.type + "': read action '" + name + "' must carry project(g, args) -> data");
	});
	return d;
}

/**
 * Boot a settled Graph for a descriptor and apply its create(seed) template through the
 * sequenced mutation path. `conceptMap` comes from the plugin bundle (pl.concepts) or a
 * resolvePlugins() merge; the boot conf keys on the descriptor's declared conceptSets.
 * @returns {Promise<{graph: Graph, descriptor}>}
 */
async function createInstance( d, opts ) {
	opts = opts || {};
	validateDescriptor(d);
	var conf = {
		label      : opts.label || ('sg-' + d.type),
		isMaster   : true, autoMount: true,
		conceptSets: d.conceptSets || [],
		bagRefManagers: {}, logLevel: 'error',
		...(opts.conf || {})
	};
	var g = new Graph({ lastRev: 0 }, conf, opts.conceptMap || {});
	await nextStable(g);
	if ( typeof d.create === 'function' ) {
		var tpl = d.create(opts.seed);
		if ( tpl ) await new Promise(function ( res ) { g.pushMutation(tpl, null); g.stabilize(res); });
	}
	return { graph: g, descriptor: d };
}

/**
 * Typed dispatch of one action. READ action -> project(g, args). WRITE action -> apply's template,
 * stamped `by: ctx.agent` per item, pushed through the sequenced path, settled.
 * Unknown action / missing agent on a write / an apply that yields nothing -> a TYPED refusal
 * `{ refused, reason, known }` — never a throw, never a silent no-op.
 */
async function runAction( g, d, name, args, ctx ) {
	ctx = ctx || {};
	var actions = d.actions || {};
	var a = actions[name];
	var known = Object.keys(actions);
	if ( !a ) return { refused: true, reason: "unknown action '" + name + "' on type '" + d.type + "'", known: known };
	if ( !a.write ) return a.project(g, args || {});
	if ( !ctx.agent ) return { refused: true, reason: "write action '" + name + "' requires ctx.agent (attribution is first-class)", known: known };
	var tpl = await a.apply(g, args || {}, ctx);            // apply MAY be async (e.g. gathers evidence first)
	if ( !tpl || (Array.isArray(tpl) && !tpl.length) )
		return { refused: true, reason: "action '" + name + "' produced no mutation (gate refused)", known: known };
	tpl = (Array.isArray(tpl) ? tpl : [tpl]).map(function ( item ) { return { ...item, by: ctx.agent }; });
	await new Promise(function ( res ) { g.pushMutation(tpl, null); g.stabilize(res); });
	return { ok: true, action: name, by: ctx.agent };
}

module.exports = { validateDescriptor, createInstance, runAction };
